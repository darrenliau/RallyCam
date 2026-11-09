import Foundation

/// What the phone tells the watch about the game (src/watchBridge.ts makes it). Every field is optional so that a phone app that is
/// newer or older than the watch app never stops it from reading what it can.
struct RallyState: Codable, Equatable {
  var screen: String?     // "record" while the phone is on its Record screen, "idle" when no game is running
  var hasLast: Bool?      // idle: there is a last game that a new one can copy
  var lastNames: String?  // idle: "You & Mia vs Sam & Jun"
  var lastVenue: String?  // idle: where it was
  var rec: Bool?          // recording now
  var secs: Int?          // seconds recorded
  var a: Int?             // score of the side nearest the camera
  var b: Int?             // score of the other side
  var nameA: String?      // who is on each side, for the buttons
  var nameB: String?
  var serving: String?    // "A" or "B"
  var court: String?      // "left" or "right"
  var server: String?     // who serves
  var fps: Int?
  var freeMb: Int?        // free storage on the phone
  var locked: Bool?       // the court is locked, so recording can start
  var points: Int?        // points played: it changes with every point
  var last: String?       // how the last point was given: "auto", "manual" or "none"
  var over: String?       // "A" or "B" once the game is won
  var training: Bool?     // nothing is scored
}

extension RallyState {
  var isRecording: Bool { rec ?? false }
  var isTraining: Bool { training ?? false }
  var isOver: Bool { over != nil }
  var isIdle: Bool { screen == "idle" }

  /// "3:07" or "1:02:09"
  var clock: String {
    let total = max(0, secs ?? 0)
    let h = total / 3600, m = (total % 3600) / 60, s = total % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
  }
}
