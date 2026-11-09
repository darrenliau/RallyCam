import SwiftUI

/// Two pages, one above the other (turn the Digital Crown or swipe up): the picture with the score, and the score buttons.
struct ContentView: View {
  @ObservedObject var link: PhoneLink

  var body: some View {
    TabView {
      PreviewPage(link: link)
      ControlsPage(link: link)
    }
    .tabViewStyle(.verticalPage)
  }
}

/// The score, with who serves (and from which court) between the two sides. On both pages, so it is next to the buttons that change it.
struct ScoreRow: View {
  let s: RallyState

  var body: some View {
    HStack {
      Text("\(s.a ?? 0)").font(.title2.bold())
      Spacer()
      Text(serving).font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
      Spacer()
      Text("\(s.b ?? 0)").font(.title2.bold())
    }
  }

  private var serving: String {
    guard let side = s.serving else { return "" }
    return "\(side == "A" ? "◀" : "▶") \(s.server ?? "")\n\(s.court ?? "")"
  }
}

/// What the camera sees, with a recording dot and clock over it, and the score under it.
struct PreviewPage: View {
  @ObservedObject var link: PhoneLink

  var body: some View {
    let s = link.state ?? RallyState()
    VStack(spacing: 4) {
      ZStack(alignment: .topLeading) {
        picture
        if s.isRecording {
          HStack(spacing: 3) {
            Circle().fill(Color.red).frame(width: 6, height: 6)
            Text(s.clock).font(.caption2.monospacedDigit())
          }
          .padding(.horizontal, 5)
          .padding(.vertical, 2)
          .background(Color.black.opacity(0.55), in: Capsule())
          .padding(3)
        }
      }
      if s.isIdle {
        Text(s.lastNames ?? "No game running").font(.caption).multilineTextAlignment(.center)
      } else if s.isTraining {
        Text("Training").font(.headline)
      } else {
        ScoreRow(s: s)
      }
      Text(statusText(s)).font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
    }
    .padding(.horizontal, 2)
  }

  /// The latest picture, or why there is none. It is checked again every second, so a picture that stops coming says so.
  private var picture: some View {
    TimelineView(.periodic(from: .now, by: 1)) { context in
      let fresh = link.imageAt.map { context.date.timeIntervalSince($0) < 3 } ?? false
      ZStack {
        if let image = link.image {
          Image(uiImage: image)
            .resizable()
            .aspectRatio(16.0 / 9.0, contentMode: .fit)
            .opacity(fresh ? 1 : 0.35)
        } else {
          Rectangle().fill(Color.gray.opacity(0.25)).aspectRatio(16.0 / 9.0, contentMode: .fit)
        }
        if !fresh {
          Text(link.reachable ? (link.state?.isIdle == true ? "No game running" : "Waiting for the picture") : "Open RallyCam on the phone")
            .font(.caption2)
            .multilineTextAlignment(.center)
            .padding(4)
        }
      }
      .clipShape(RoundedRectangle(cornerRadius: 8))
    }
  }

  private func statusText(_ s: RallyState) -> String {
    if let over = s.over { return over == "A" ? "Game over: \(s.nameA ?? "near side") won" : "Game over: \(s.nameB ?? "far side") won" }
    if link.state == nil { return "" }
    if s.isIdle { return "Start one from the next page" }
    if s.locked == false { return "Frame the court, then lock and start" }
    if let free = s.freeMb, free < 2000 { return "Low storage: \(free / 1000) GB free" }
    return ""
  }
}

/// What the buttons can do depends on where the phone is: no game running (start one), setting up the court (lock it and start), or
/// recording (add a point for either side, undo, swap the last automatic point, end the game with a question first).
struct ControlsPage: View {
  @ObservedObject var link: PhoneLink
  @State private var confirmEnd = false

  var body: some View {
    let s = link.state ?? RallyState()
    ScrollView {
      VStack(spacing: 6) {
        if link.state == nil {
          Text("Open RallyCam on the phone").font(.footnote).multilineTextAlignment(.center)
        } else if s.isIdle {
          idleButtons(s)
        } else if s.locked == false && !s.isRecording {
          Button { link.send("lock") } label: { Text("Lock court and start").frame(maxWidth: .infinity) }
            .tint(.green)
          Text("Check the picture first. The court lines are set on the phone.").font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
        } else {
          recordingButtons(s)
        }
        if let note = link.note {
          Text(note).font(.caption2).foregroundStyle(.orange)
        }
      }
      .buttonStyle(.bordered)
    }
    .confirmationDialog("End it?", isPresented: $confirmEnd, titleVisibility: .visible) {
      Button(s.isTraining ? "End session" : "End game", role: .destructive) { link.send("end") }
      Button("Keep recording", role: .cancel) {}
    }
  }

  /// No game is running: start one like the last, or say there is no last one.
  @ViewBuilder
  private func idleButtons(_ s: RallyState) -> some View {
    if s.hasLast == true {
      Button { link.send("startGame") } label: { Text("Start game").frame(maxWidth: .infinity) }
        .tint(.green)
      Button { link.send("startTraining") } label: { Text("Start training").frame(maxWidth: .infinity) }
        .tint(.blue)
      Text("\(s.lastNames ?? "")\(s.lastVenue.map { " at \($0)" } ?? "")")
        .font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
    } else {
      Text("Start one game on the phone first, then the watch can start the next.").font(.footnote).multilineTextAlignment(.center)
    }
  }

  /// A court is locked: score buttons, undo, swap, end.
  @ViewBuilder
  private func recordingButtons(_ s: RallyState) -> some View {
    let playing = s.isRecording && !s.isOver && !s.isTraining
    if !s.isTraining {
      ScoreRow(s: s)
      Button { link.send("point", side: "A") } label: { Text("+ \(s.nameA ?? "Near side")").frame(maxWidth: .infinity) }
        .tint(.green)
        .disabled(!playing)
      Button { link.send("point", side: "B") } label: { Text("+ \(s.nameB ?? "Far side")").frame(maxWidth: .infinity) }
        .tint(.blue)
        .disabled(!playing)
      HStack(spacing: 6) {
        Button("Undo") { link.send("undo") }
          .disabled((s.points ?? 0) == 0)
        Button("Swap") { link.send("swap") }
          .disabled(s.last != "auto")
      }
    }
    Button(role: .destructive) { confirmEnd = true } label: { Text(s.isTraining ? "End session" : "End game").frame(maxWidth: .infinity) }
      .disabled(!s.isRecording && (s.points ?? 0) == 0)
  }
}
