import SwiftUI

/// The RallyCam watch app. Phase 0: it only has to build, install and open, to prove the watch target works with Expo prebuild and
/// Xcode Cloud. The link to the phone, the live preview and the score buttons come in the next phases.
@main
struct RallyCamWatchApp: App {
  var body: some Scene {
    WindowGroup {
      ContentView()
    }
  }
}
