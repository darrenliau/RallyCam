import CoreImage
import Foundation
import ImageIO
import UIKit
import WatchConnectivity

/// The link to the RallyCam watch app (targets/watch).
///
/// What the phone sends: a small picture of what the camera sees, a few times a second, and the state of the game (score, time and so on).
/// What it receives: button presses from the watch (a point for one side, undo, swap the last point, end the game), which it passes to
/// JavaScript as the `onWatchCommand` event.
///
/// WatchConnectivity only delivers messages while the watch app is open and the phone is reachable. Everything here gives up quietly when
/// it is not, and the picture is dropped, never queued, if the watch cannot keep up, so the camera is never slowed down by the watch.
final class WatchBridge: NSObject, WCSessionDelegate {
  static let shared = WatchBridge()

  /// Called (on any thread) with a command message from the watch: ["command": "point" | "undo" | "swap" | "end", "side": "A" | "B"].
  var onCommand: (([String: Any]) -> Void)?

  private let lock = NSLock()
  private var started = false
  private var enabled = false
  private var sending = false
  private var sendingSince = Date.distantPast
  private var lastSentAt = -Double.infinity   // camera time of the last picture sent, in seconds
  private var minGap = 0.25                    // seconds between pictures: 4 a second
  private let queue = DispatchQueue(label: "rallycam.watch.preview", qos: .utility)
  private let context = CIContext()

  /// The width of the picture sent to the watch, in pixels. The watch's screen is about 200 points wide.
  private static let pictureWidth: CGFloat = 192
  private static let jpegQuality = 0.35

  // MARK: session

  func start() {
    lock.lock()
    let already = started
    started = true
    lock.unlock()
    guard !already, WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    session.activate()
  }

  /// Is a watch paired, does it have the app, can it be reached now. For the Settings screen.
  func status() -> [String: Any] {
    guard WCSession.isSupported() else { return ["supported": false] }
    let session = WCSession.default
    return [
      "supported": true,
      "paired": session.isPaired,
      "installed": session.isWatchAppInstalled,
      "reachable": session.isReachable,
    ]
  }

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
  func sessionDidBecomeInactive(_ session: WCSession) {}
  func sessionDidDeactivate(_ session: WCSession) { session.activate() }

  // MARK: from the watch

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    onCommand?(message)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
    onCommand?(message)
    replyHandler(["ok": true])
  }

  // MARK: to the watch

  /// Sends the state of the game (a JSON text made by JavaScript). The latest one is also kept for a watch app that is opened later.
  func sendState(_ json: String) {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.activationState == .activated else { return }
    let message: [String: Any] = ["state": json]
    if session.isReachable {
      session.sendMessage(message, replyHandler: nil, errorHandler: nil)
    }
    try? session.updateApplicationContext(message)
  }

  func setPreview(_ on: Bool) {
    lock.lock()
    enabled = on
    lock.unlock()
  }

  /// A hot phone sends fewer pictures, and at the worst none, so the camera and the recording come first.
  func setPressure(_ level: String) {
    lock.lock()
    switch level {
    case "serious": minGap = 0.5
    case "critical", "shutdown": minGap = 4
    default: minGap = 0.25
    }
    lock.unlock()
  }

  /// Offered every camera frame. Cheap unless a picture is due: it returns at once when the preview is off, the watch cannot be reached,
  /// the last picture is still on its way, or it is too soon.
  func offer(_ pixelBuffer: CVPixelBuffer, time: Double) {
    lock.lock()
    let on = enabled
    let gap = minGap
    var due = on && !sending && time - lastSentAt >= gap
    // a picture whose answer never came must not stop the preview for good
    if on && sending && Date().timeIntervalSince(sendingSince) > 1.5 {
      sending = false
      due = time - lastSentAt >= gap
    }
    if due {
      sending = true
      sendingSince = Date()
      lastSentAt = time
    }
    lock.unlock()
    guard due, WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.activationState == .activated, session.isReachable else { finished(); return }
    queue.async { [weak self] in
      guard let self = self, let data = self.jpeg(pixelBuffer) else { self?.finished(); return }
      session.sendMessageData(data, replyHandler: { [weak self] _ in self?.finished() }, errorHandler: { [weak self] _ in self?.finished() })
    }
  }

  private func finished() {
    lock.lock()
    sending = false
    lock.unlock()
  }

  /// The camera picture, shrunk to the watch's size and compressed hard: 3 to 6 thousand bytes.
  private func jpeg(_ pixelBuffer: CVPixelBuffer) -> Data? {
    let image = CIImage(cvPixelBuffer: pixelBuffer)
    let width = image.extent.width
    guard width > 0, let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
    let scale = WatchBridge.pictureWidth / width
    let small = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    let quality = CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String)
    return context.jpegRepresentation(of: small, colorSpace: space, options: [quality: WatchBridge.jpegQuality])
  }
}
