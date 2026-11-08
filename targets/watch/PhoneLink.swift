import SwiftUI
import UIKit
import WatchConnectivity
import WatchKit

/// The link to the RallyCam app on the phone: it receives the camera picture and the state of the game, and sends the button presses.
/// WatchConnectivity only works while this app is open and the phone can be reached, so every send says what happened if it cannot.
final class PhoneLink: NSObject, ObservableObject, WCSessionDelegate {
  @Published var image: UIImage?
  @Published var imageAt: Date?
  @Published var state: RallyState?
  @Published var reachable = false
  @Published var note: String?

  override init() {
    super.init()
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    session.activate()
    // the latest state the phone left for us, if the app was opened after it was sent
    apply(session.receivedApplicationContext)
  }

  // MARK: to the phone

  /// "point" (with side "A" or "B"), "undo", "swap" (turn the last automatic point round) or "end".
  func send(_ command: String, side: String? = nil) {
    let session = WCSession.default
    guard session.activationState == .activated, session.isReachable else {
      flash("Phone not reachable")
      WKInterfaceDevice.current().play(.failure)
      return
    }
    var message: [String: Any] = ["command": command]
    if let side = side { message["side"] = side }
    session.sendMessage(message, replyHandler: { _ in }, errorHandler: { [weak self] _ in
      DispatchQueue.main.async {
        self?.flash("The phone did not answer")
        WKInterfaceDevice.current().play(.failure)
      }
    })
  }

  private func flash(_ text: String) {
    note = text
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
      if self?.note == text { self?.note = nil }
    }
  }

  // MARK: from the phone

  private func apply(_ message: [String: Any]) {
    guard let json = message["state"] as? String, let data = json.data(using: .utf8),
          let next = try? JSONDecoder().decode(RallyState.self, from: data) else { return }
    DispatchQueue.main.async {
      // a point was played: tap the wrist
      if let old = self.state, (next.points ?? 0) != (old.points ?? 0) {
        WKInterfaceDevice.current().play(.click)
      }
      self.state = next
    }
  }

  private func show(_ data: Data) {
    guard let picture = UIImage(data: data) else { return }
    DispatchQueue.main.async {
      self.image = picture
      self.imageAt = Date()
    }
  }

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    DispatchQueue.main.async { self.reachable = session.isReachable }
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    DispatchQueue.main.async { self.reachable = session.isReachable }
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    apply(message)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
    apply(message)
    replyHandler([:])
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    apply(applicationContext)
  }

  func session(_ session: WCSession, didReceiveMessageData messageData: Data) {
    show(messageData)
  }

  func session(_ session: WCSession, didReceiveMessageData messageData: Data, replyHandler: @escaping (Data) -> Void) {
    show(messageData)
    replyHandler(Data())  // the phone waits for this before it sends the next picture
  }
}
