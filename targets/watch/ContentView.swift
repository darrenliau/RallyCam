import SwiftUI

struct ContentView: View {
  var body: some View {
    VStack(spacing: 6) {
      Image(systemName: "video.fill")
        .font(.title2)
        .foregroundStyle(.green)
      Text("RallyCam")
        .font(.headline)
      Text("Watch link is coming")
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
    .padding()
  }
}
