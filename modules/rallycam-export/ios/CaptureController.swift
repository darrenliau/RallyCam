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
  /// true when the camera was taken away (phone call, another app, background), false when it came back
  var onInterruption: ((Bool, String) -> Void)?
  /// "nominal", "fair", "serious", "critical" or "shutdown": how hot or strained the phone is
  var onPressure: ((String) -> Void)?
  private var pressureObservation: NSKeyValueObservation?

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
  private var outputWidth = 1920
  private var outputHeight = 1080
  private var outputBitRate = 14_000_000
  private var writer: AVAssetWriter?
  private var videoInput: AVAssetWriterInput?
  private var audioInput: AVAssetWriterInput?
  private var adaptor: AVAssetWriterInputPixelBufferAdaptor?
  private var sessionStart = CMTime.invalid
  private var nextKeep = -Double.infinity
  private let audioLock = NSLock()
  private var audioOpen = false

  // Counters for the on-screen diagnostics (dev builds): is the overlay reaching the video?
  private let statsLock = NSLock()
  private var pushes = 0
  private var decoded = 0
  private var failed = 0
  private var composited = 0
  private var withOverlay = 0
  private var lastProblem = ""
  private var lens = ""
  private var framesIn = 0
  private var luma = -1                 // average brightness of the camera picture, 0 (black) to 255
  private var audioBuffers = 0
  private var audioPeak: Float = 0      // loudest sample since the last status read, 0 to 1
  private var deviceName = ""
  private var activeDevice: AVCaptureDevice?

  private func bump(_ change: () -> Void) {
    statsLock.lock()
    change()
    statsLock.unlock()
  }

  func status() -> [String: Any] {
    statsLock.lock()
    defer { audioPeak = 0; statsLock.unlock() }
    return [
      "overlayPushes": pushes,
      "overlayDecoded": decoded,
      "overlayFailed": failed,
      "framesWritten": composited,
      "framesWithOverlay": withOverlay,
      "lastProblem": lastProblem,
      "lens": lens,
      "running": session.isRunning,
      "framesIn": framesIn,
      "luma": luma,
      "audioBuffers": audioBuffers,
      "audioLevel": Double(audioPeak),
      "audioInFile": audioInput != nil,
      "device": deviceName,
      "exposureMs": (activeDevice.map { CMTimeGetSeconds($0.exposureDuration) * 1000 }) ?? 0,
      "iso": Double(activeDevice?.iso ?? 0),
      "interrupted": !session.isRunning,
    ]
  }

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
    NSLog("RallyCam: starting the camera, wanted \(targetFps) fps")
    let fps = try configure(targetFps: targetFps)
    frameWidth = 1920
    frameHeight = 1080
    observeSession()
    if !session.isRunning { session.startRunning() }
    NSLog("RallyCam: camera session running = \(session.isRunning), \(fps) fps, lens \(lens)")
    return CaptureInfo(fps: fps, width: frameWidth, height: frameHeight)
  }

  private var observing = false

  /// Reports camera problems that happen after start (another app took the camera, a hardware error, and so on).
  private func observeSession() {
    guard !observing else { return }
    observing = true
    let center = NotificationCenter.default
    _ = center.addObserver(forName: AVCaptureSession.runtimeErrorNotification, object: session, queue: nil) { [weak self] note in
      let message = (note.userInfo?[AVCaptureSessionErrorKey] as? Error)?.localizedDescription ?? "unknown"
      NSLog("RallyCam: camera error: \(message)")
      self?.onError?("The camera stopped: \(message)")
    }
    _ = center.addObserver(forName: AVCaptureSession.wasInterruptedNotification, object: session, queue: nil) { [weak self] note in
      let raw = (note.userInfo?[AVCaptureSessionInterruptionReasonKey] as? Int) ?? 0
      let reason = CaptureController.describe(interruption: raw)
      NSLog("RallyCam: camera interrupted: \(reason)")
      self?.onInterruption?(true, reason)
    }
    _ = center.addObserver(forName: AVCaptureSession.interruptionEndedNotification, object: session, queue: nil) { [weak self] _ in
      NSLog("RallyCam: camera interruption ended")
      self?.onInterruption?(false, "")
    }
  }

  static func describe(interruption raw: Int) -> String {
    switch raw {
    case 1: return "the app was in the background"
    case 2: return "another app is using the microphone"
    case 3: return "another app is using the camera"
    case 4: return "the camera is not available while two apps share the screen"
    case 5: return "the phone is too hot or under too much load"
    default: return "the camera was taken away"
    }
  }

  /// Tells JavaScript when the phone starts to overheat, so it can warn before the camera is slowed down.
  private func watchPressure(of device: AVCaptureDevice) {
    pressureObservation = device.observe(\.systemPressureState, options: [.new]) { [weak self] device, _ in
      let level: String
      switch device.systemPressureState.level {
      case .nominal: level = "nominal"
      case .fair: level = "fair"
      case .serious: level = "serious"
      case .critical: level = "critical"
      case .shutdown: level = "shutdown"
      default: level = "unknown"
      }
      NSLog("RallyCam: system pressure \(level)")
      self?.onPressure?(level)
    }
  }

  /// The best 1080p format of a camera for the wanted frame rate, and the rate it can really do.
  private func bestFormat(of device: AVCaptureDevice, targetFps: Int) -> (format: AVCaptureDevice.Format, fps: Int)? {
    var best: (format: AVCaptureDevice.Format, fps: Int)?
    for format in device.formats {
      let dims = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
      guard dims.width == 1920, dims.height == 1080 else { continue }
      guard CMFormatDescriptionGetMediaSubType(format.formatDescription) == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange else { continue }
      let maxFps = Int(format.videoSupportedFrameRateRanges.map { $0.maxFrameRate }.max() ?? 30)
      let achievable = min(maxFps, targetFps)
      if best == nil || achievable > best!.fps { best = (format, achievable) }
    }
    return best
  }

  /// Sets up the camera, microphone and outputs. Returns the frame rate the camera will really run at.
  private func configure(targetFps: Int) throws -> Int {
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else { throw CaptureError.notAuthorized("Camera") }
    let micAllowed = AVCaptureDevice.authorizationStatus(for: .audio) == .authorized

    // The ultra-wide camera (0.5x) sees more of the court from close range. The listed order is the preference: it
    // wins unless the main camera can run at a higher frame rate.
    var chosen: (device: AVCaptureDevice, format: AVCaptureDevice.Format, fps: Int, lens: String)?
    for (type, name) in [(AVCaptureDevice.DeviceType.builtInUltraWideCamera, "ultra-wide"), (.builtInWideAngleCamera, "wide")] {
      guard let device = AVCaptureDevice.default(type, for: .video, position: .back), let pick = bestFormat(of: device, targetFps: targetFps) else { continue }
      if chosen == nil || pick.fps > chosen!.fps { chosen = (device, pick.format, pick.fps, name) }
    }
    guard let chosen else { throw CaptureError.noCamera }
    let device = chosen.device

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
      // Straight court lines matter for the court mapping. The ultra-wide camera bends them unless this is on.
      if device.isGeometricDistortionCorrectionSupported { device.isGeometricDistortionCorrectionEnabled = true }
      device.unlockForConfiguration()
    } catch {
      throw CaptureError.setup(error.localizedDescription)
    }

    // Upright landscape frames, so the overlay and the saved video need no rotation. No stabilisation: the court must not move.
    if let connection = videoOutput.connection(with: .video) {
      connection.videoOrientation = CaptureController.currentVideoOrientation()
      if connection.isVideoStabilizationSupported { connection.preferredVideoStabilizationMode = .off }
    }
    statsLock.lock()
    lens = chosen.lens
    activeDevice = device
    deviceName = device.localizedName
    statsLock.unlock()
    watchPressure(of: device)
    return chosen.fps
  }

  func stop(completion: @escaping () -> Void) {
    sessionQueue.async {
      if self.session.isRunning { self.session.stopRunning() }
      // Remove everything, so the next start chooses the camera again and sets up from scratch.
      self.session.beginConfiguration()
      for input in self.session.inputs { self.session.removeInput(input) }
      for output in self.session.outputs { self.session.removeOutput(output) }
      self.session.commitConfiguration()
      self.configured = false
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
    bump { pushes += 1 }
    overlayQueue.async {
      let scene: SceneFile
      do {
        guard let data = json.data(using: .utf8) else { throw CaptureError.setup("overlay text is not UTF-8") }
        scene = try JSONDecoder().decode(SceneFile.self, from: data)
      } catch {
        self.bump { self.failed += 1; self.lastProblem = "overlay decode: \(error)" }
        return
      }
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
      guard let image = ctx.makeImage() else {
        self.bump { self.failed += 1; self.lastProblem = "overlay image could not be made" }
        return
      }
      self.overlayLock.lock()
      self.overlayImage = CIImage(cgImage: image)
      self.overlayLock.unlock()
      self.bump { self.decoded += 1 }
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

  func startRecording(url: URL, outputFps: Double, width: Int, height: Int, bitRate: Int) {
    bump { pushes = 0; decoded = 0; failed = 0; composited = 0; withOverlay = 0; lastProblem = "" }
    videoQueue.async {
      self.recordingURL = url
      self.outputFps = outputFps > 0 ? outputFps : 60
      self.outputWidth = width > 0 ? width : 1920
      self.outputHeight = height > 0 ? height : 1080
      self.outputBitRate = bitRate > 0 ? bitRate : 14_000_000
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
      // Write the file in pieces, so a game that is cut off (app killed, battery died) can still be played up to that moment.
      w.movieFragmentInterval = CMTime(seconds: 5, preferredTimescale: 600)
      // `width` and `height` are the camera frame. The file may be smaller (see the quality setting).
      let v = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: outputWidth,
        AVVideoHeightKey: outputHeight,
        AVVideoCompressionPropertiesKey: [
          AVVideoAverageBitRateKey: outputBitRate,
          AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
          AVVideoExpectedSourceFrameRateKey: Int(outputFps),
        ],
      ])
      v.expectsMediaDataInRealTime = true
      let a = AVPixelBufferAdaptorFactory.make(for: v, width: outputWidth, height: outputHeight)
      guard w.canAdd(v) else { throw CaptureError.setup("cannot add the video input") }
      w.add(v)

      var audio: AVAssetWriterInput?
      if session.outputs.contains(audioOutput) {
        var settings = audioOutput.recommendedAudioSettingsForAssetWriter(writingTo: .mp4) as? [String: Any]
        if settings == nil || settings?.isEmpty == true {
          // Uncompressed audio cannot go in an .mp4, so ask for AAC explicitly
          settings = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVNumberOfChannelsKey: 1,
            AVSampleRateKey: 44100,
            AVEncoderBitRateKey: 96_000,
          ]
        }
        NSLog("RallyCam: audio writer settings \(String(describing: settings))")
        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
        input.expectsMediaDataInRealTime = true
        if w.canAdd(input) { w.add(input); audio = input } else { NSLog("RallyCam: the video file cannot take the audio input") }
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
    let overlay = currentOverlay()
    if let overlay { image = overlay.composited(over: image) }
    // The overlay is drawn at camera size first, then everything is scaled down to the size of the file.
    let sourceWidth = CGFloat(CVPixelBufferGetWidth(pixelBuffer))
    let sourceHeight = CGFloat(CVPixelBufferGetHeight(pixelBuffer))
    if Int(sourceWidth) != outputWidth || Int(sourceHeight) != outputHeight {
      image = image.transformed(by: CGAffineTransform(scaleX: CGFloat(outputWidth) / sourceWidth, y: CGFloat(outputHeight) / sourceHeight))
    }
    ciContext.render(image, to: target)
    let ok = adaptor.append(target, withPresentationTime: time)
    bump {
      if ok { composited += 1; if overlay != nil { withOverlay += 1 } } else { lastProblem = "a video frame could not be written" }
    }
    if !ok, let w = writer, w.status == .failed {
      // Most often the phone is out of space. Stop writing and tell the user, instead of pretending to record.
      state = .idle
      onError?("The video stopped saving: \(w.error?.localizedDescription ?? "unknown reason"). The score is still kept.")
    }
  }
}

extension CaptureController {
  /// Average brightness (0 to 255) of a camera frame, from a coarse grid of the luma plane. Near 0 means the picture is black.
  static func brightness(of buffer: CVPixelBuffer) -> Int {
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    guard CVPixelBufferGetPlaneCount(buffer) > 0, let base = CVPixelBufferGetBaseAddressOfPlane(buffer, 0) else { return -1 }
    let width = CVPixelBufferGetWidthOfPlane(buffer, 0)
    let height = CVPixelBufferGetHeightOfPlane(buffer, 0)
    let stride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0)
    var total = 0
    var count = 0
    for gy in 0..<9 {
      for gx in 0..<16 {
        let x = (gx * 2 + 1) * width / 32
        let y = (gy * 2 + 1) * height / 18
        total += Int(base.load(fromByteOffset: y * stride + x, as: UInt8.self))
        count += 1
      }
    }
    return count > 0 ? total / count : -1
  }

  /// Loudest sample in an audio buffer, 0 to 1.
  static func peak(of sample: CMSampleBuffer) -> Float {
    guard
      let format = CMSampleBufferGetFormatDescription(sample),
      let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee,
      let block = CMSampleBufferGetDataBuffer(sample)
    else { return 0 }
    var length = 0
    var pointer: UnsafeMutablePointer<Int8>?
    guard CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &pointer) == kCMBlockBufferNoErr,
          let base = pointer
    else { return 0 }
    var peak: Float = 0
    if asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0 && asbd.mBitsPerChannel == 32 {
      let count = length / 4
      base.withMemoryRebound(to: Float.self, capacity: count) { p in
        for i in 0..<count { peak = max(peak, abs(p[i])) }
      }
    } else if asbd.mBitsPerChannel == 16 {
      let count = length / 2
      base.withMemoryRebound(to: Int16.self, capacity: count) { p in
        for i in 0..<count { peak = max(peak, abs(Float(p[i])) / 32768) }
      }
    }
    return peak
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
      let peak = CaptureController.peak(of: sampleBuffer)
      bump { audioBuffers += 1; audioPeak = max(audioPeak, peak) }
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
    if framesIn % 30 == 0 {
      let measured = CaptureController.brightness(of: pixelBuffer)
      bump { luma = measured }
    }
    bump {
      framesIn += 1
      if framesIn == 1 { NSLog("RallyCam: first camera frame, \(CVPixelBufferGetWidth(pixelBuffer))x\(CVPixelBufferGetHeight(pixelBuffer))") }
    }

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
