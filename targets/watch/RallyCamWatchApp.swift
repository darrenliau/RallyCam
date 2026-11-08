import SwiftUI

/// The RallyCam watch app: a small live picture of what the phone is recording, the score, and buttons to add, undo or swap a point.
@main
struct RallyCamWatchApp: App {
  @StateObject private var link = PhoneLink()

  var body: some Scene {
    WindowGroup {
      ContentView(link: link)
    }
  }
}
