import CoreImage
import CoreML
import CoreVideo
import Foundation

/// What the shuttle model made of one camera frame: where it saw the shuttle, as fractions of the frame, or nothing.
struct ShuttleModelFrame {
  var t: Double
  var x: Double?
  var y: Double?
}

/// Runs TrackNetV3, converted to Core ML (see Models/README.md), on the camera's frames.
///
/// The network looks at 8 frames in a row at 512 x 288 together with a picture of the empty background (the median of earlier
/// frames, which removes the players), and answers with one heatmap per frame. This class collects the frames, keeps the
/// background, runs the model on the Neural Engine and reads each heatmap's brightest spot. It mirrors how TrackNetV3's own
/// predict.py prepares its input (bg_mode "concat": the background first, then the frames, red-green-blue, divided by 255).
///
/// Everything slow happens on background queues. If the model falls behind, whole windows are dropped, so it stays in real time.
final class ShuttleModel {
  static let width = 512
  static let height = 288
  static let sequence = 8
  private static let channels = (sequence + 1) * 3
  private static let planeSize = width * height
  private static let threshold: Float = 0.5

  /// Called with the 8 frames of a finished window and how long the model took, in milliseconds.
  var onWindow: (([ShuttleModelFrame], Double) -> Void)?

  private let frameQueue = DispatchQueue(label: "rallycam.shuttlemodel.frames", qos: .userInitiated)
  private let predictQueue = DispatchQueue(label: "rallycam.shuttlemodel.predict", qos: .userInitiated)
  private let backgroundQueue = DispatchQueue(label: "rallycam.shuttlemodel.background", qos: .utility)
  private let ciContext = CIContext()

  // Read by JavaScript for the debug line, so guarded by `lock`
  private let lock = NSLock()
  private var enabled = false
  private var state = "off"        // off, loading, ready, missing, failed
  private var problem = ""
  private var model: MLModel?
  private var pending = 0
  private var predicting = false
  private var framesSeen = 0
  private var framesDropped = 0
  private var windows = 0
  private var windowsDropped = 0
  private var detections = 0
  private var predictMs = 0.0
  private var requestedCrop: CGRect?    // the court crop, fractions of the frame, top left origin; nil means none. Guarded by `lock`
  private var forceFull = false         // look at the whole frame for now, for example while the shuttle is out of the crop. Guarded by `lock`

  // Only touched on frameQueue
  private var small: CVPixelBuffer?
  private var inputs: [MLMultiArray] = []
  private var currentInput = 0
  private var windowCount = 0
  private var windowTimes = [Double](repeating: 0, count: ShuttleModel.sequence)
  private var lastT = -Double.infinity
  private static let whole = CGRect(x: 0, y: 0, width: 1, height: 1)
  /// An empty-court picture for one way of looking at the frame, kept up to date whichever view is in use, so switching is instant.
  private final class View {
    var samples: [[UInt8]] = []          // background samples, red-green-blue planes, oldest first
    var since = 0
    var background: [Float]?             // 3 planes, divided by 255
    var computing = false
  }
  private let views = [View(), View()]   // 0: the whole frame, 1: the court crop
  private var smallAlt: CVPixelBuffer?   // the view not in use, rendered for its background
  private var courtCrop: CGRect?         // the crop that view 1 was made for
  private var activeView = 0
  private var lastSampleT = -Double.infinity
  private static let sampleEvery = 0.25
  private static let maxSamples = 9
  private static let firstMedianAt = 5
  private static let medianEvery = 40   // 10 seconds: the median is the slowest step, so it is not redone often

  /// Looks at only this part of the frame (fractions, top left origin), so the shuttle is bigger to the model. Positions are still
  /// reported as fractions of the whole frame. All zeros means the whole frame. Takes effect at the next frame.
  func setCrop(x: Double, y: Double, w: Double, h: Double) {
    let valid = w > 0.2 && h > 0.2 && x >= 0 && y >= 0 && x + w <= 1.0001 && y + h <= 1.0001
    lock.lock()
    requestedCrop = valid ? CGRect(x: x, y: y, width: w, height: h) : nil
    lock.unlock()
  }

  /// While true the model looks at the whole frame even if a crop is set. The crop's own background is kept meanwhile.
  func setFullFrame(_ full: Bool) {
    lock.lock(); forceFull = full; lock.unlock()
  }

  // MARK: switching on and off

  func setEnabled(_ on: Bool) {
    lock.lock()
    let was = enabled
    enabled = on
    let loaded = model != nil
    if on && !was && !loaded { state = "loading"; problem = "" }
    if !on { state = loaded ? "ready" : "off" }
    lock.unlock()
    if on && !was && !loaded { predictQueue.async { self.load() } }
    if !on { frameQueue.async { self.windowCount = 0 } }
  }

  func status() -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    return [
      "state": state, "problem": problem, "enabled": enabled, "framesSeen": framesSeen, "framesDropped": framesDropped,
      "windows": windows, "windowsDropped": windowsDropped, "detections": detections, "predictMs": predictMs,
    ]
  }

  private func fail(_ newState: String, _ text: String) {
    NSLog("RallyCam: shuttle model \(newState): \(text)")
    lock.lock(); state = newState; problem = text; lock.unlock()
  }

  // MARK: loading

  private func load() {
    guard let source = ShuttleModel.locate() else {
      fail("missing", "the model file (TrackNetV3.mlpackage) is not in this build; see ios/Models/README.md")
      return
    }
    do {
      let compiled = try ShuttleModel.compiled(source)
      let config = MLModelConfiguration()
      config.computeUnits = .cpuAndNeuralEngine
      let loaded = try MLModel(contentsOf: compiled, configuration: config)
      guard loaded.modelDescription.inputDescriptionsByName["frames"] != nil,
            loaded.modelDescription.outputDescriptionsByName["heatmaps"] != nil else {
        fail("failed", "the model does not have the inputs and outputs RallyCam expects (frames, heatmaps)")
        return
      }
      lock.lock(); model = loaded; state = "ready"; problem = ""; lock.unlock()
      NSLog("RallyCam: shuttle model loaded from \(compiled.lastPathComponent)")
    } catch {
      fail("failed", error.localizedDescription)
    }
  }

  /// Finds the model in the app: as a compiled folder or a package, in the module's resource bundle or the main bundle.
  private static func locate() -> URL? {
    var bundles: [Bundle] = [Bundle.main, Bundle(for: ShuttleModel.self)]
    for b in bundles {
      if let rb = b.url(forResource: "RallyCamModels", withExtension: "bundle"), let nested = Bundle(url: rb) { bundles.append(nested) }
    }
    for b in bundles {
      for ext in ["mlmodelc", "mlpackage"] {
        if let url = b.url(forResource: "TrackNetV3", withExtension: ext) { return url }
      }
    }
    return nil
  }

  /// A package has to be compiled once. The compiled copy is kept in Application Support and reused while it is newer than the package.
  private static func compiled(_ source: URL) throws -> URL {
    if source.pathExtension == "mlmodelc" { return source }
    let fm = FileManager.default
    let support = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let cached = support.appendingPathComponent("TrackNetV3.mlmodelc")
    func modified(_ url: URL) -> Date? { (try? fm.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date }
    if fm.fileExists(atPath: cached.path), let a = modified(cached), let b = modified(source), a >= b { return cached }
    let temporary = try MLModel.compileModel(at: source)
    try? fm.removeItem(at: cached)
    try fm.copyItem(at: temporary, to: cached)
    return cached
  }

  // MARK: frames in

  /// Offer a camera frame. Cheap: the real work is queued, and the frame is dropped if the model is behind.
  func push(_ pixelBuffer: CVPixelBuffer, time: Double) {
    lock.lock()
    let on = enabled && model != nil
    let busy = pending >= 2
    if on { framesSeen += 1 }
    if on && busy { framesDropped += 1 }
    if on && !busy { pending += 1 }
    lock.unlock()
    guard on, !busy else { return }
    frameQueue.async {
      self.process(pixelBuffer, time: time)
      self.lock.lock(); self.pending -= 1; self.lock.unlock()
    }
  }

  private func makeBuffers() -> Bool {
    if small == nil {
      var buffer: CVPixelBuffer?
      let attrs: [String: Any] = [kCVPixelBufferMetalCompatibilityKey as String: true, kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any]()]
      CVPixelBufferCreate(nil, ShuttleModel.width, ShuttleModel.height, kCVPixelFormatType_32BGRA, attrs as CFDictionary, &buffer)
      small = buffer
    }
    if smallAlt == nil {
      var buffer: CVPixelBuffer?
      let attrs: [String: Any] = [kCVPixelBufferMetalCompatibilityKey as String: true, kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any]()]
      CVPixelBufferCreate(nil, ShuttleModel.width, ShuttleModel.height, kCVPixelFormatType_32BGRA, attrs as CFDictionary, &buffer)
      smallAlt = buffer
    }
    if inputs.isEmpty {
      let shape: [NSNumber] = [1, NSNumber(value: ShuttleModel.channels), NSNumber(value: ShuttleModel.height), NSNumber(value: ShuttleModel.width)]
      guard let a = try? MLMultiArray(shape: shape, dataType: .float32), let b = try? MLMultiArray(shape: shape, dataType: .float32) else {
        fail("failed", "could not allocate the model's input")
        return false
      }
      // the code below writes planes one after the other, so the array must be laid out that way
      let expected = [ShuttleModel.channels * ShuttleModel.planeSize, ShuttleModel.planeSize, ShuttleModel.width, 1]
      if a.strides.map({ $0.intValue }) != expected {
        fail("failed", "the model's input has an unexpected memory layout \(a.strides)")
        return false
      }
      inputs = [a, b]
    }
    return small != nil
  }

  /// Shrinks the part `rect` (fractions, top left origin) of the frame to 512 x 288. Lanczos is the closest Core Image has to the
  /// bicubic resize the model was trained with.
  private func render(_ pixelBuffer: CVPixelBuffer, _ rect: CGRect, into target: CVPixelBuffer) {
    let sourceW = CGFloat(CVPixelBufferGetWidth(pixelBuffer))
    let sourceH = CGFloat(CVPixelBufferGetHeight(pixelBuffer))
    // Core Image's origin is the bottom left, so the top left fractions are flipped
    let part = CGRect(x: rect.minX * sourceW, y: (1 - rect.maxY) * sourceH, width: rect.width * sourceW, height: rect.height * sourceH)
    let scale = CGFloat(ShuttleModel.height) / part.height
    let aspect = (CGFloat(ShuttleModel.width) / part.width) / scale
    let image = CIImage(cvPixelBuffer: pixelBuffer).cropped(to: part).transformed(by: CGAffineTransform(translationX: -part.minX, y: -part.minY)).applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: scale, kCIInputAspectRatioKey: aspect])
    ciContext.render(image, to: target, bounds: CGRect(x: 0, y: 0, width: ShuttleModel.width, height: ShuttleModel.height), colorSpace: CGColorSpaceCreateDeviceRGB())
  }

  private func process(_ pixelBuffer: CVPixelBuffer, time t: Double) {
    guard makeBuffers(), let small else { return }
    // frames were lost for a moment: the window must be of frames in a row, so start it again
    if windowCount > 0 && t - lastT > 0.08 { windowCount = 0 }
    lastT = t

    // which view: the court crop when there is one, unless the whole frame was asked for
    lock.lock(); let wanted = requestedCrop; let full = forceFull; lock.unlock()
    if wanted != courtCrop {
      // the court was moved: the crop view's background was made for another place
      courtCrop = wanted
      views[1].samples = []; views[1].since = 0; views[1].background = nil
    }
    let view = (courtCrop != nil && !full) ? 1 : 0
    if view != activeView { activeView = view; windowCount = 0 }   // a window must be of one view
    let rect = view == 1 ? courtCrop! : ShuttleModel.whole

    render(pixelBuffer, rect, into: small)

    CVPixelBufferLockBaseAddress(small, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(small, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(small) else { return }
    let stride = CVPixelBufferGetBytesPerRow(small)

    if t - lastSampleT >= ShuttleModel.sampleEvery {
      lastSampleT = t
      addBackgroundSample(views[view], base, stride)
      // and the other view's, so it is ready the moment it is needed
      if courtCrop != nil, let alt = smallAlt {
        render(pixelBuffer, view == 1 ? ShuttleModel.whole : courtCrop!, into: alt)
        CVPixelBufferLockBaseAddress(alt, .readOnly)
        if let altBase = CVPixelBufferGetBaseAddress(alt) { addBackgroundSample(views[1 - view], altBase, CVPixelBufferGetBytesPerRow(alt)) }
        CVPixelBufferUnlockBaseAddress(alt, .readOnly)
      }
    }
    guard views[view].background != nil else { return }   // the first seconds only collect the background

    let input = inputs[currentInput]
    let out = input.dataPointer.assumingMemoryBound(to: Float.self)
    let plane = ShuttleModel.planeSize
    let first = (3 + 3 * windowCount) * plane
    for y in 0..<ShuttleModel.height {
      let row = base.advanced(by: y * stride).assumingMemoryBound(to: UInt8.self)
      let o = y * ShuttleModel.width
      for x in 0..<ShuttleModel.width {
        let p = row + x * 4   // blue, green, red, alpha
        out[first + o + x] = Float(p[2]) / 255
        out[first + plane + o + x] = Float(p[1]) / 255
        out[first + 2 * plane + o + x] = Float(p[0]) / 255
      }
    }
    windowTimes[windowCount] = t
    windowCount += 1
    if windowCount == ShuttleModel.sequence { finishWindow(input) }
  }

  private func finishWindow(_ input: MLMultiArray) {
    windowCount = 0
    lock.lock()
    let busy = predicting
    if busy { windowsDropped += 1 } else { predicting = true }
    lock.unlock()
    // still busy with the last window: skip this one, and keep filling the same array
    if busy { return }
    if let bg = views[activeView].background {
      bg.withUnsafeBufferPointer { (src: UnsafeBufferPointer<Float>) -> Void in
        _ = memcpy(input.dataPointer, src.baseAddress!, 3 * ShuttleModel.planeSize * MemoryLayout<Float>.size)
      }
    }
    let times = windowTimes
    let used = activeView == 1 ? (courtCrop ?? ShuttleModel.whole) : ShuttleModel.whole
    currentInput = 1 - currentInput
    predictQueue.async { self.predict(input, times: times, crop: used) }
  }

  // MARK: background

  private func addBackgroundSample(_ view: View, _ base: UnsafeMutableRawPointer, _ stride: Int) {
    let plane = ShuttleModel.planeSize
    var sample = [UInt8](repeating: 0, count: 3 * plane)
    for y in 0..<ShuttleModel.height {
      let row = base.advanced(by: y * stride).assumingMemoryBound(to: UInt8.self)
      let o = y * ShuttleModel.width
      for x in 0..<ShuttleModel.width {
        let p = row + x * 4
        sample[o + x] = p[2]
        sample[plane + o + x] = p[1]
        sample[2 * plane + o + x] = p[0]
      }
    }
    view.samples.append(sample)
    if view.samples.count > ShuttleModel.maxSamples { view.samples.removeFirst() }
    view.since += 1
    let due = view.background == nil ? view.samples.count >= ShuttleModel.firstMedianAt : view.since >= ShuttleModel.medianEvery
    if due && !view.computing {
      view.computing = true
      view.since = 0
      let snapshot = view.samples
      backgroundQueue.async {
        let median = ShuttleModel.median(of: snapshot)
        self.frameQueue.async {
          // a crop that was replaced while this was being worked out left its samples empty: do not use the old picture
          if !view.samples.isEmpty { view.background = median }
          view.computing = false
        }
      }
    }
  }

  /// The middle value of each pixel across the samples: a player who moves about is not in it.
  private static func median(of samples: [[UInt8]]) -> [Float] {
    let n = samples.count
    let count = 3 * planeSize
    var result = [Float](repeating: 0, count: count)
    var column = [UInt8](repeating: 0, count: n)
    for i in 0..<count {
      for k in 0..<n { column[k] = samples[k][i] }
      column.sort()
      result[i] = Float(column[n / 2]) / 255
    }
    return result
  }

  // MARK: prediction

  private func predict(_ input: MLMultiArray, times: [Double], crop: CGRect) {
    defer { lock.lock(); predicting = false; lock.unlock() }
    lock.lock(); let model = self.model; lock.unlock()
    guard let model else { return }
    let started = CFAbsoluteTimeGetCurrent()
    do {
      let provider = try MLDictionaryFeatureProvider(dictionary: ["frames": MLFeatureValue(multiArray: input)])
      let result = try model.prediction(from: provider)
      guard let heat = result.featureValue(for: "heatmaps")?.multiArrayValue else {
        fail("failed", "the model gave no heatmaps")
        return
      }
      let frames = ShuttleModel.decode(heat, times: times).map { f -> ShuttleModelFrame in
        guard let x = f.x, let y = f.y else { return f }
        // fractions of the crop back to fractions of the whole frame
        return ShuttleModelFrame(t: f.t, x: Double(crop.minX) + x * Double(crop.width), y: Double(crop.minY) + y * Double(crop.height))
      }
      let ms = (CFAbsoluteTimeGetCurrent() - started) * 1000
      lock.lock()
      windows += 1
      detections += frames.filter { $0.x != nil }.count
      predictMs = predictMs == 0 ? ms : 0.8 * predictMs + 0.2 * ms
      lock.unlock()
      onWindow?(frames, ms)
    } catch {
      fail("failed", error.localizedDescription)
    }
  }

  /// For each frame, the brightest point of its heatmap if it is above 0.5, refined to the centre of the bright area around it.
  private static func decode(_ heat: MLMultiArray, times: [Double]) -> [ShuttleModelFrame] {
    let strides = heat.strides.map { $0.intValue }
    guard strides.count == 4 else { return times.map { ShuttleModelFrame(t: $0, x: nil, y: nil) } }
    let frameStride = strides[1], rowStride = strides[2], colStride = strides[3]
    let isHalf = heat.dataType == .float16
    let raw = UnsafeRawPointer(heat.dataPointer)
    @inline(__always) func value(_ index: Int) -> Float {
      isHalf ? halfToFloat(raw.load(fromByteOffset: index * 2, as: UInt16.self)) : raw.load(fromByteOffset: index * 4, as: Float.self)
    }

    return times.enumerated().map { f, t in
      let base = f * frameStride
      var best: Float = -1
      var bx = 0, by = 0
      for y in 0..<height {
        let row = base + y * rowStride
        for x in 0..<width {
          let v = value(row + x * colStride)
          if v > best { best = v; bx = x; by = y }
        }
      }
      guard best > threshold else { return ShuttleModelFrame(t: t, x: nil, y: nil) }
      // centre of the pixels above the threshold within 6 pixels of the peak
      var sx = 0.0, sy = 0.0, sw = 0.0
      for y in max(0, by - 6)...min(height - 1, by + 6) {
        for x in max(0, bx - 6)...min(width - 1, bx + 6) {
          let v = value(base + y * rowStride + x * colStride)
          if v > threshold { sx += Double(x) * Double(v); sy += Double(y) * Double(v); sw += Double(v) }
        }
      }
      let cx = sw > 0 ? sx / sw : Double(bx)
      let cy = sw > 0 ? sy / sw : Double(by)
      return ShuttleModelFrame(t: t, x: (cx + 0.5) / Double(width), y: (cy + 0.5) / Double(height))
    }
  }
}

/// Half precision (as Core ML may return it) to Float, without relying on the Float16 type, which not every build target has.
@inline(__always) private func halfToFloat(_ h: UInt16) -> Float {
  let sign = UInt32(h & 0x8000) << 16
  let exponent = UInt32(h >> 10) & 0x1F
  let mantissa = UInt32(h & 0x3FF)
  var bits: UInt32
  if exponent == 0 {
    if mantissa == 0 {
      bits = sign
    } else {
      var m = mantissa
      var e: UInt32 = 127 - 15 + 1
      while m & 0x400 == 0 { m <<= 1; e -= 1 }
      m &= 0x3FF
      bits = sign | (e << 23) | (m << 13)
    }
  } else if exponent == 31 {
    bits = sign | 0x7F80_0000 | (mantissa << 13)
  } else {
    bits = sign | ((exponent + 112) << 23) | (mantissa << 13)
  }
  return Float(bitPattern: bits)
}
