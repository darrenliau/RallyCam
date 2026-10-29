import AVFoundation
import CoreImage
import UIKit
import Vision

struct CaptureInfo {
  let fps: Int
  let width: Int
  let height: Int
}

enum CaptureError: LocalizedError {
  case notAuthorized(String)
  case noCamera
  case setup(String)

  var errorDescription: String? {
    switch self {
    case .notAuthorized(let what): return "\(what) access has not been allowed."
    case .noCamera: return "No back camera was found."
    case .setup(let m): return "Could not start the camera: \(m)"
    }
  }
}

private enum RecordingState {
  case idle
  case armed      // waiting for the next video frame to open the file
  case recording
  case stopping
}

/// Owns the camera. It shows a live preview, finds people in the court area, and records a video with the overlay
/// drawn onto every frame, so the file is finished the moment recording stops.
final class CaptureController: NSObject {
  static let shared = CaptureController()

  let session = AVCaptureSession()

  // Callbacks to JavaScript
  var onDetections: (([[String: Double]]) -> Void)?
  var onError: ((String) -> Void)?

  private let sessionQueue = DispatchQueue(label: "rallycam.capture.session")
  private let videoQueue = DispatchQueue(label: "rallycam.capture.video", qos: .userInitiated)
  private let audioQueue = DispatchQueue(label: "rallycam.capture.audio")
  private let detectQueue = DispatchQueue(label: "rallycam.capture.detect", qos: .utility)
  private let overlayQueue = DispatchQueue(label: "rallycam.capture.overlay", qos: .userInitiated)

  private let videoOutput = AVCaptureVideoDataOutput()
  private let audioOutput = AVCaptureAudioDataOutput()
  private let ciContext = CIContext()

  private var frameWidth = 1920
  private var frameHeight = 1080
  private var configured = false

  // Overlay: replaced by JavaScript a few times a second, composited onto every recorded frame.
  private let overlayLock = NSLock()
  private var overlayImage: CIImage?

  // Detection
  private let detectLock = NSLock()
  private var detectionROI: CGRect?   // fractions of the frame, top left origin
  private var detectBusy = false
  private var lastDetect = CACurrentMediaTime()

  // Recording. `state` and the writer objects are only touched on videoQueue, except audioOpen (guarded by audioLock).
  private var state = RecordingState.idle
  private var recordingURL: URL?
  private var outputFps = 60.0
  private var writer: AVAssetWriter?
  private var videoInput: AVAssetWriterInput?
  private var audioInput: AVAssetWriterInput?
  private var adaptor: AVAssetWriterInputPixelBufferAdaptor?
  private var sessionStart = CMTime.invalid
  private var nextKeep = -Double.infinity
  private let audioLock = NSLock()
  private var audioOpen = false

  // MARK: session

  func start(targetFps: Int, completion: @escaping (Result<CaptureInfo, Error>) -> Void) {
    sessionQueue.async {
      do {
        let info = try self.configureAndRun(targetFps: targetFps)
        completion(.success(info))
      } catch {
        completion(.failure(error))
      }
    }
  }

  private func configureAndRun(targetFps: Int) throws -> CaptureInfo {
    let fps = try configure(targetFps: targetFps)
    frameWidth = 1920
    frameHeight = 1080
    if !session.isRunning { session.startRunning() }
    return CaptureInfo(fps: fps, width: frameWidth, height: frameHeight)
  }

  /// Sets up the camera, microphone and outputs. Returns the frame rate the camera will really run at.
  private func configure(targetFps: Int) throws -> Int {
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else { throw CaptureError.notAuthorized("Camera") }
    let micAllowed = AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else { throw CaptureError.noCamera }

    // Pick a 1080p format that can run at the wanted frame rate (120 where the phone has it).
    var best: (format: AVCaptureDevice.Format, fps: Int)?
    for format in device.formats {
      let dims = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
      guard dims.width == 1920, dims.height == 1080 else { continue }
      guard CMFormatDescriptionGetMediaSubType(format.formatDescription) == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange else { continue }
      let maxFps = Int(format.videoSupportedFrameRateRanges.map { $0.maxFrameRate }.max() ?? 30)
      let achievable = min(maxFps, targetFps)
      if best == nil || achievable > best!.fps { best = (format, achievable) }
    }
    guard let chosen = best else { throw CaptureError.setup("no 1080p format") }

    session.beginConfiguration()
    defer { session.commitConfiguration() }
    if !configured {
      session.sessionPreset = .inputPriority
      let input = try AVCaptureDeviceInput(device: device)
      guard session.canAddInput(input) else { throw CaptureError.setup("cannot add the camera") }
      session.addInput(input)

      videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange]
      videoOutput.alwaysDiscardsLateVideoFrames = true
      videoOutput.setSampleBufferDelegate(self, queue: videoQueue)
      guard session.canAddOutput(videoOutput) else { throw CaptureError.setup("cannot add the video output") }
      session.addOutput(videoOutput)

      if micAllowed, let mic = AVCaptureDevice.default(for: .audio), let micInput = try? AVCaptureDeviceInput(device: mic), session.canAddInput(micInput) {
        session.addInput(micInput)
        audioOutput.setSampleBufferDelegate(self, queue: audioQueue)
        if session.canAddOutput(audioOutput) { session.addOutput(audioOutput) }
      }
      configured = true
    }

    do {
      try device.lockForConfiguration()
      device.activeFormat = chosen.format
      let duration = CMTime(value: 1, timescale: CMTimeScale(chosen.fps))
      device.activeVideoMinFrameDuration = duration
      device.activeVideoMaxFrameDuration = duration
      device.unlockForConfiguration()
    } catch {
      throw CaptureError.setup(error.localizedDescription)
    }

    // Upright landscape frames, so the overlay and the saved video need no rotation. No stabilisation: the court must not move.
    if let connection = videoOutput.connection(with: .video) {
      connection.videoOrientation = CaptureController.currentVideoOrientation()
      if connection.isVideoStabilizationSupported { connection.preferredVideoStabilizationMode = .off }
    }
    return chosen.fps
  }

  func stop(completion: @escaping () -> Void) {
    sessionQueue.async {
      if self.session.isRunning { self.session.stopRunning() }
      completion()
    }
  }

  /// The interface is locked to landscape, but it can be either way round.
  static func currentVideoOrientation() -> AVCaptureVideoOrientation {
    var orientation = UIInterfaceOrientation.landscapeRight
    let read = {
      if let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first {
        orientation = scene.interfaceOrientation
      }
    }
    if Thread.isMainThread { read() } else { DispatchQueue.main.sync(execute: read) }
    // The screen may still be turning to landscape when the camera starts. Frames must always be landscape.
    if let o = AVCaptureVideoOrientation(rawValue: orientation.rawValue), o == .landscapeLeft || o == .landscapeRight { return o }
    return .landscapeRight
  }

  /// Called when the phone is turned the other way round.
  func refreshOrientation() {
    let o = CaptureController.currentVideoOrientation()
    sessionQueue.async {
      if let c = self.videoOutput.connection(with: .video), c.isVideoOrientationSupported { c.videoOrientation = o }
    }
  }

  // MARK: overlay

  /// `json` is a scene file (see OverlayScene.swift) whose items are all visible now. It replaces the previous overlay.
  func setOverlay(json: String) {
    overlayQueue.async {
      guard let data = json.data(using: .utf8), let scene = try? JSONDecoder().decode(SceneFile.self, from: data) else { return }
      let renderer = OverlayRenderer(file: scene)
      let w = self.frameWidth
      let h = self.frameHeight
      guard let ctx = CGContext(
        data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
      ) else { return }
      ctx.translateBy(x: 0, y: CGFloat(h))
      ctx.scaleBy(x: 1, y: -1)
      let scale = CGFloat(w) / CGFloat(scene.width)
      ctx.scaleBy(x: scale, y: scale)
      renderer.draw(into: ctx, atMs: 0)
      guard let image = ctx.makeImage() else { return }
      self.overlayLock.lock()
      self.overlayImage = CIImage(cgImage: image)
      self.overlayLock.unlock()
    }
  }

  private func currentOverlay() -> CIImage? {
    overlayLock.lock()
    defer { overlayLock.unlock() }
    return overlayImage
  }

  // MARK: detection

  /// `roi` is the court area as fractions of the frame (top left origin). Pass nil to turn detection off.
  func setDetection(roi: CGRect?) {
    detectLock.lock()
    detectionROI = roi
    detectLock.unlock()
  }

  private func detectIfDue(_ pixelBuffer: CVPixelBuffer) {
    let now = CACurrentMediaTime()
    detectLock.lock()
    let roi = detectionROI
    let due = roi != nil && !detectBusy && now - lastDetect >= 0.066
    if due { detectBusy = true; lastDetect = now }
    detectLock.unlock()
    guard due, let roi else { return }

    detectQueue.async {
      defer {
        self.detectLock.lock()
        self.detectBusy = false
        self.detectLock.unlock()
      }
      let fw = CGFloat(CVPixelBufferGetWidth(pixelBuffer))
      let fh = CGFloat(CVPixelBufferGetHeight(pixelBuffer))
      // Core Image has its origin at the bottom left
      let crop = CGRect(x: roi.minX * fw, y: (1 - roi.maxY) * fh, width: roi.width * fw, height: roi.height * fh)
      let scale = min(1, 960 / crop.width)
      let outW = max(16, Int(crop.width * scale))
      let outH = max(16, Int(crop.height * scale))
      var small: CVPixelBuffer?
      CVPixelBufferCreate(nil, outW, outH, kCVPixelFormatType_32BGRA, [kCVPixelBufferMetalCompatibilityKey as String: true] as CFDictionary, &small)
      guard let target = small else { return }
      let image = CIImage(cvPixelBuffer: pixelBuffer)
        .cropped(to: crop)
        .transformed(by: CGAffineTransform(translationX: -crop.minX, y: -crop.minY))
        .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
      self.ciContext.render(image, to: target)

      let request = VNDetectHumanRectanglesRequest()
      request.upperBodyOnly = false
      do { try VNImageRequestHandler(cvPixelBuffer: target, options: [:]).perform([request]) } catch { return }
      let boxes: [[String: Double]] = (request.results ?? []).map { o in
        let b = o.boundingBox   // normalised to the crop, origin bottom left
        return [
          "x": Double(roi.minX + b.minX * roi.width),
          "y": Double(roi.minY + (1 - b.maxY) * roi.height),
          "w": Double(b.width * roi.width),
          "h": Double(b.height * roi.height),
          "score": Double(o.confidence),
        ]
      }
      self.onDetections?(boxes)
    }
  }

  // MARK: recording

  func startRecording(url: URL, outputFps: Double) {
    videoQueue.async {
      self.recordingURL = url
      self.outputFps = outputFps > 0 ? outputFps : 60
      self.nextKeep = -Double.infinity
      self.state = .armed
    }
  }

  func stopRecording(completion: @escaping (URL?, Error?) -> Void) {
    videoQueue.async {
      guard self.state == .recording, let writer = self.writer else {
        self.state = .idle
        completion(nil, nil)
        return
      }
      self.state = .stopping
      self.audioLock.lock()
      self.audioOpen = false
      self.audioLock.unlock()
      self.videoInput?.markAsFinished()
      self.audioInput?.markAsFinished()
      writer.finishWriting {
        let url = writer.outputURL
        let error: Error? = writer.status == .completed ? nil : writer.error
        self.videoQueue.async {
          self.writer = nil
          self.videoInput = nil
          self.audioInput = nil
          self.adaptor = nil
          self.state = .idle
        }
        completion(error == nil ? url : nil, error)
      }
    }
  }

  /// Opens the file when the first frame after "start" arrives, so it has the real frame size and start time.
  private func openWriter(width: Int, height: Int, firstTime: CMTime) {
    guard let url = recordingURL else { state = .idle; return }
    do {
      try? FileManager.default.removeItem(at: url)
      let w = try AVAssetWriter(outputURL: url, fileType: .mp4)
      let bitRate = Int(Double(width * height) * outputFps * 0.12)
      let v = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
        AVVideoCompressionPropertiesKey: [
          AVVideoAverageBitRateKey: bitRate,
          AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
          AVVideoExpectedSourceFrameRateKey: Int(outputFps),
        ],
      ])
      v.expectsMediaDataInRealTime = true
      let a = AVPixelBufferAdaptorFactory.make(for: v, width: width, height: height)
      guard w.canAdd(v) else { throw CaptureError.setup("cannot add the video input") }
      w.add(v)

      var audio: AVAssetWriterInput?
      if session.outputs.contains(audioOutput) {
        let settings = audioOutput.recommendedAudioSettingsForAssetWriter(writingTo: .mp4) as? [String: Any]
        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
        input.expectsMediaDataInRealTime = true
        if w.canAdd(input) { w.add(input); audio = input }
      }

      guard w.startWriting() else { throw CaptureError.setup(w.error?.localizedDescription ?? "cannot start writing") }
      w.startSession(atSourceTime: firstTime)
      writer = w
      videoInput = v
      adaptor = a
      audioLock.lock()
      audioInput = audio
      sessionStart = firstTime
      audioOpen = audio != nil
      audioLock.unlock()
      state = .recording
    } catch {
      state = .idle
      onError?("Recording could not start: \(error.localizedDescription)")
    }
  }

  private func appendVideo(_ pixelBuffer: CVPixelBuffer, time: CMTime) {
    guard let adaptor, let videoInput, videoInput.isReadyForMoreMediaData, let pool = adaptor.pixelBufferPool else { return }
    var created: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &created)
    guard let target = created else { return }
    var image = CIImage(cvPixelBuffer: pixelBuffer)
    if let overlay = currentOverlay() { image = overlay.composited(over: image) }
    ciContext.render(image, to: target)
    _ = adaptor.append(target, withPresentationTime: time)
  }
}

/// Small helper so the adaptor settings live in one place.
enum AVPixelBufferAdaptorFactory {
  static func make(for input: AVAssetWriterInput, width: Int, height: Int) -> AVAssetWriterInputPixelBufferAdaptor {
    AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: input,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
        kCVPixelBufferMetalCompatibilityKey as String: true,
      ]
    )
  }
}

extension CaptureController: AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureAudioDataOutputSampleBufferDelegate {
  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    if output === audioOutput {
      audioLock.lock()
      defer { audioLock.unlock() }
      guard audioOpen, let input = audioInput, input.isReadyForMoreMediaData else { return }
      // audio from before the first video frame is dropped
      if CMTimeCompare(CMSampleBufferGetPresentationTimeStamp(sampleBuffer), sessionStart) < 0 { return }
      _ = input.append(sampleBuffer)
      return
    }

    guard output === videoOutput, let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)

    detectIfDue(pixelBuffer)

    if state == .armed {
      openWriter(width: CVPixelBufferGetWidth(pixelBuffer), height: CVPixelBufferGetHeight(pixelBuffer), firstTime: pts)
    }
    if state == .recording {
      // keep about `outputFps` frames per second of the 120 the camera delivers
      let seconds = CMTimeGetSeconds(pts)
      let interval = 1.0 / outputFps
      if nextKeep != -Double.infinity && seconds + 1e-4 < nextKeep { return }
      nextKeep = (nextKeep == -Double.infinity || seconds > nextKeep + interval) ? seconds + interval : nextKeep + interval
      appendVideo(pixelBuffer, time: pts)
    }
  }
}
