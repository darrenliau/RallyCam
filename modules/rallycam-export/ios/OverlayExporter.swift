import AVFoundation
import UIKit

enum ExportError: LocalizedError {
  case noVideoTrack
  case reader(String)
  case writer(String)
  case cancelled

  var isCancelled: Bool {
    if case .cancelled = self { return true }
    return false
  }

  var errorDescription: String? {
    switch self {
    case .noVideoTrack: return "The file has no video track."
    case .reader(let m): return "Could not read the video: \(m)"
    case .writer(let m): return "Could not write the video: \(m)"
    case .cancelled: return "Export cancelled."
    }
  }
}

/// Reads a video frame by frame, draws the overlay scene onto each frame and writes a new H.264 file.
/// Audio is decoded and written again as AAC. Runs on a background queue and reports progress from 0 to 1.
final class OverlayExporter {
  private let lock = NSLock()
  private var cancelFlag = false

  func cancel() {
    lock.lock()
    cancelFlag = true
    lock.unlock()
  }

  private var isCancelled: Bool {
    lock.lock()
    defer { lock.unlock() }
    return cancelFlag
  }

  func run(
    videoURL: URL,
    sceneURL: URL,
    outURL: URL,
    fps: Double,
    progress: @escaping (Double) -> Void,
    completion: @escaping (Result<URL, Error>) -> Void
  ) {
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        try self.export(videoURL: videoURL, sceneURL: sceneURL, outURL: outURL, fps: fps, progress: progress)
        completion(.success(outURL))
      } catch {
        try? FileManager.default.removeItem(at: outURL)
        completion(.failure(error))
      }
    }
  }

  private func export(videoURL: URL, sceneURL: URL, outURL: URL, fps: Double, progress: @escaping (Double) -> Void) throws {
    let sceneData = try Data(contentsOf: sceneURL)
    let scene = try JSONDecoder().decode(SceneFile.self, from: sceneData)
    let renderer = OverlayRenderer(file: scene)

    let asset = AVURLAsset(url: videoURL)
    guard let videoTrack = asset.tracks(withMediaType: .video).first else { throw ExportError.noVideoTrack }

    // The overlay is laid out for the upright picture. Frames may be stored rotated, with a transform that turns them upright.
    let transform = videoTrack.preferredTransform
    let rawSize = videoTrack.naturalSize
    let upright = rawSize.applying(transform)
    let overlayScale = abs(upright.width) / CGFloat(scene.width)
    let rawW = Int(rawSize.width)
    let rawH = Int(rawSize.height)
    let startTime = videoTrack.timeRange.start
    let durationSeconds = max(0.001, CMTimeGetSeconds(asset.duration))
    let outFps = fps > 0 ? fps : max(1, Double(videoTrack.nominalFrameRate))

    try? FileManager.default.removeItem(at: outURL)

    // --- reading ---
    let reader = try AVAssetReader(asset: asset)
    let videoOutput = AVAssetReaderTrackOutput(
      track: videoTrack,
      outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    )
    videoOutput.alwaysCopiesSampleData = false
    guard reader.canAdd(videoOutput) else { throw ExportError.reader("cannot read the video track") }
    reader.add(videoOutput)

    var audioOutput: AVAssetReaderTrackOutput?
    if let audioTrack = asset.tracks(withMediaType: .audio).first {
      let output = AVAssetReaderTrackOutput(
        track: audioTrack,
        outputSettings: [
          AVFormatIDKey: kAudioFormatLinearPCM,
          AVLinearPCMBitDepthKey: 16,
          AVLinearPCMIsFloatKey: false,
          AVLinearPCMIsBigEndianKey: false,
          AVLinearPCMIsNonInterleaved: false,
          AVSampleRateKey: 44100,
          AVNumberOfChannelsKey: 2,
        ]
      )
      if reader.canAdd(output) {
        reader.add(output)
        audioOutput = output
      }
    }

    // --- writing ---
    let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
    let bitRate = Int(Double(rawW * rawH) * outFps * 0.12)
    let videoInput = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: rawW,
        AVVideoHeightKey: rawH,
        AVVideoCompressionPropertiesKey: [
          AVVideoAverageBitRateKey: bitRate,
          AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
          AVVideoExpectedSourceFrameRateKey: Int(outFps),
        ],
      ]
    )
    videoInput.expectsMediaDataInRealTime = false
    videoInput.transform = transform
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: videoInput,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: rawW,
        kCVPixelBufferHeightKey as String: rawH,
      ]
    )
    guard writer.canAdd(videoInput) else { throw ExportError.writer("cannot add the video input") }
    writer.add(videoInput)

    var audioInput: AVAssetWriterInput?
    if audioOutput != nil {
      let input = AVAssetWriterInput(
        mediaType: .audio,
        outputSettings: [
          AVFormatIDKey: kAudioFormatMPEG4AAC,
          AVSampleRateKey: 44100,
          AVNumberOfChannelsKey: 2,
          AVEncoderBitRateKey: 128_000,
        ]
      )
      input.expectsMediaDataInRealTime = false
      if writer.canAdd(input) {
        writer.add(input)
        audioInput = input
      } else {
        audioOutput = nil
      }
    }

    guard reader.startReading() else { throw ExportError.reader(reader.error?.localizedDescription ?? "unknown") }
    guard writer.startWriting() else { throw ExportError.writer(writer.error?.localizedDescription ?? "unknown") }
    writer.startSession(atSourceTime: startTime)

    // --- the loops ---
    let group = DispatchGroup()
    let stateLock = NSLock()
    var failure: Error?
    func fail(_ error: Error) {
      stateLock.lock()
      if failure == nil { failure = error }
      stateLock.unlock()
    }

    // video
    let frameInterval = fps > 0 ? 1.0 / fps : 0
    var nextKeep = -Double.infinity
    var videoDone = false
    group.enter()
    videoInput.requestMediaDataWhenReady(on: DispatchQueue(label: "rallycam.export.video")) { [self] in
      while videoInput.isReadyForMoreMediaData && !videoDone {
        if isCancelled {
          videoDone = true
          videoInput.markAsFinished()
          group.leave()
          return
        }
        guard let sample = videoOutput.copyNextSampleBuffer() else {
          videoDone = true
          videoInput.markAsFinished()
          group.leave()
          return
        }
        let pts = CMSampleBufferGetPresentationTimeStamp(sample)
        let seconds = CMTimeGetSeconds(CMTimeSubtract(pts, startTime))

        // keep only about `fps` frames per second (a 120 fps recording is cut down to 30, say)
        if frameInterval > 0 {
          if nextKeep != -Double.infinity && seconds + 1e-4 < nextKeep { continue }
          nextKeep = (nextKeep == -Double.infinity || seconds > nextKeep + frameInterval) ? seconds + frameInterval : nextKeep + frameInterval
        }

        guard
          let source = CMSampleBufferGetImageBuffer(sample),
          let pool = adaptor.pixelBufferPool
        else { continue }
        var created: CVPixelBuffer?
        CVPixelBufferPoolCreatePixelBuffer(nil, pool, &created)
        guard let target = created else { continue }

        Self.render(
          source: source, target: target, renderer: renderer,
          atMs: seconds * 1000, transform: transform, scale: overlayScale
        )

        if !adaptor.append(target, withPresentationTime: pts) {
          fail(ExportError.writer(writer.error?.localizedDescription ?? "could not append a frame"))
          videoDone = true
          videoInput.markAsFinished()
          group.leave()
          return
        }
        progress(min(1, seconds / durationSeconds))
      }
    }

    // audio
    if let audioOutput, let audioInput {
      var audioDone = false
      group.enter()
      audioInput.requestMediaDataWhenReady(on: DispatchQueue(label: "rallycam.export.audio")) { [self] in
        while audioInput.isReadyForMoreMediaData && !audioDone {
          guard !isCancelled, let sample = audioOutput.copyNextSampleBuffer() else {
            audioDone = true
            audioInput.markAsFinished()
            group.leave()
            return
          }
          if !audioInput.append(sample) {
            fail(ExportError.writer(writer.error?.localizedDescription ?? "could not append audio"))
            audioDone = true
            audioInput.markAsFinished()
            group.leave()
            return
          }
        }
      }
    }

    group.wait()

    if isCancelled {
      reader.cancelReading()
      writer.cancelWriting()
      throw ExportError.cancelled
    }
    if let failure {
      reader.cancelReading()
      writer.cancelWriting()
      throw failure
    }
    if reader.status == .failed {
      writer.cancelWriting()
      throw ExportError.reader(reader.error?.localizedDescription ?? "unknown")
    }

    let finished = DispatchSemaphore(value: 0)
    writer.finishWriting { finished.signal() }
    finished.wait()
    if writer.status != .completed {
      throw ExportError.writer(writer.error?.localizedDescription ?? "unknown")
    }
    progress(1)
  }

  /// Copies the decoded frame into `target` and draws the overlay on top of it.
  private static func render(
    source: CVPixelBuffer, target: CVPixelBuffer, renderer: OverlayRenderer,
    atMs t: Double, transform: CGAffineTransform, scale: CGFloat
  ) {
    CVPixelBufferLockBaseAddress(source, .readOnly)
    CVPixelBufferLockBaseAddress(target, [])
    defer {
      CVPixelBufferUnlockBaseAddress(target, [])
      CVPixelBufferUnlockBaseAddress(source, .readOnly)
    }
    guard
      let sourceBase = CVPixelBufferGetBaseAddress(source),
      let targetBase = CVPixelBufferGetBaseAddress(target)
    else { return }

    let width = CVPixelBufferGetWidth(target)
    let height = CVPixelBufferGetHeight(target)
    let sourceStride = CVPixelBufferGetBytesPerRow(source)
    let targetStride = CVPixelBufferGetBytesPerRow(target)
    let rows = min(height, CVPixelBufferGetHeight(source))
    let rowBytes = min(min(sourceStride, targetStride), width * 4)
    for row in 0..<rows {
      memcpy(targetBase + row * targetStride, sourceBase + row * sourceStride, rowBytes)
    }

    guard let ctx = CGContext(
      data: targetBase,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: targetStride,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    ) else { return }

    // Pixel buffers have their origin at the bottom left. Work top-left, in the frame's stored orientation...
    ctx.translateBy(x: 0, y: CGFloat(height))
    ctx.scaleBy(x: 1, y: -1)
    // ...then undo the rotation the file asks players to apply, so the overlay ends up upright when the video is played.
    ctx.concatenate(transform.inverted())
    ctx.scaleBy(x: scale, y: scale)
    renderer.draw(into: ctx, atMs: t)
  }
}
