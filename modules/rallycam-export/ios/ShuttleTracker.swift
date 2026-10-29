import Foundation

/// First attempt at following the shuttle by looking for small things that move fast.
/// This is a Swift copy of src/analysis/shuttleMotion.ts. Keep the two the same: the TypeScript version has the tests.
/// The method is described at the top of that file.

struct ShuttleCandidate {
  var x: Double
  var y: Double
  var area: Int
  var contrast: Double
}

struct ShuttleTrack {
  var x: Double
  var y: Double
  var vx: Double      // pixels per second
  var vy: Double
  var hits: Int
  var misses: Int
  var confirmed: Bool
  var t: Double
}

struct ShuttleResult {
  var candidates: [ShuttleCandidate]
  var track: ShuttleTrack?
  var activeFraction: Double
  var shaky: Bool
}

private struct Seed {
  var x: Double
  var y: Double
  var t: Double
  var vx: Double
  var vy: Double
  var hits: Int
}

final class MotionShuttleTracker {
  // the same numbers as DEFAULT_MOTION in shuttleMotion.ts
  private let diffThreshold = 24
  private let cellSize = 4
  private let minArea = 3
  private let maxArea = 260
  private let maxSize = 36
  private let gate = 220.0
  private let minStep = 6.0
  private let confirmHits = 3
  private let maxMisses = 8
  private let shakeFraction = 0.03
  private let maxCandidates = 12

  private var frames: [[UInt8]] = [[], [], []]   // newest, previous, the one before
  private var width = 0
  private var height = 0
  private var prevT = 0.0
  private var haveFrames = 0
  private(set) var track: ShuttleTrack?
  private var seeds: [Seed] = []

  func reset() {
    haveFrames = 0
    track = nil
    seeds = []
  }

  /// `plane` is the camera's luma plane. (x0, y0, w, h) is the area to watch, in pixels. `t` is the frame time in seconds.
  func update(plane: UnsafePointer<UInt8>, stride: Int, x0: Int, y0: Int, w: Int, h: Int, t: Double) -> ShuttleResult {
    if w != width || h != height {
      width = w
      height = h
      frames = [[UInt8](repeating: 0, count: w * h), [UInt8](repeating: 0, count: w * h), [UInt8](repeating: 0, count: w * h)]
      haveFrames = 0
      track = nil
      seeds = []
    }
    // Keep three frames: 0 is the newest, 1 the one before, 2 the one before that. The oldest buffer is reused for the new frame.
    frames = [frames[2], frames[0], frames[1]]
    frames[0].withUnsafeMutableBufferPointer { dst in
      for row in 0..<h {
        memcpy(dst.baseAddress! + row * w, plane + (y0 + row) * stride + x0, w)
      }
    }
    let obsT = prevT
    prevT = t
    haveFrames += 1
    if haveFrames < 3 { return ShuttleResult(candidates: [], track: track, activeFraction: 0, shaky: false) }

    let cw = (w + cellSize - 1) / cellSize
    let ch = (h + cellSize - 1) / cellSize
    var cellCount = [UInt16](repeating: 0, count: cw * ch)
    var cellDiff = [UInt32](repeating: 0, count: cw * ch)
    var active = 0

    frames[0].withUnsafeBufferPointer { cur in
      frames[1].withUnsafeBufferPointer { prev in
        frames[2].withUnsafeBufferPointer { prev2 in
          for y in 0..<h {
            let row = y * w
            let cellRow = (y / cellSize) * cw
            for x in 0..<w {
              let i = row + x
              let d1 = abs(Int(cur[i]) - Int(prev[i]))
              if d1 <= diffThreshold { continue }
              if abs(Int(prev[i]) - Int(prev2[i])) <= diffThreshold { continue }
              active += 1
              let c = cellRow + x / cellSize
              cellCount[c] += 1
              cellDiff[c] += UInt32(d1)
            }
          }
        }
      }
    }

    let activeFraction = Double(active) / Double(w * h)
    if activeFraction > shakeFraction {
      miss()
      return ShuttleResult(candidates: [], track: track, activeFraction: activeFraction, shaky: true)
    }

    let candidates = blobs(count: cellCount, diff: cellDiff, cw: cw, ch: ch)
    follow(candidates, t: obsT)
    return ShuttleResult(candidates: candidates, track: track, activeFraction: activeFraction, shaky: false)
  }

  private func blobs(count: [UInt16], diff: [UInt32], cw: Int, ch: Int) -> [ShuttleCandidate] {
    var seen = [Bool](repeating: false, count: cw * ch)
    var out: [ShuttleCandidate] = []
    var stack: [Int] = []
    for start in 0..<count.count {
      if count[start] < 2 || seen[start] { continue }
      var area = 0
      var sumDiff = 0
      var sx = 0.0
      var sy = 0.0
      var minX = cw, maxX = 0, minY = ch, maxY = 0
      stack.removeAll(keepingCapacity: true)
      stack.append(start)
      seen[start] = true
      while let c = stack.popLast() {
        let cx = c % cw
        let cy = c / cw
        let n = Int(count[c])
        area += n
        sumDiff += Int(diff[c])
        sx += (Double(cx) + 0.5) * Double(n)
        sy += (Double(cy) + 0.5) * Double(n)
        minX = min(minX, cx); maxX = max(maxX, cx)
        minY = min(minY, cy); maxY = max(maxY, cy)
        var neighbours: [Int] = []
        if cx > 0 { neighbours.append(c - 1) }
        if cx < cw - 1 { neighbours.append(c + 1) }
        if cy > 0 { neighbours.append(c - cw) }
        if cy < ch - 1 { neighbours.append(c + cw) }
        for nb in neighbours where !seen[nb] && count[nb] >= 2 {
          seen[nb] = true
          stack.append(nb)
        }
      }
      let size = max(maxX - minX + 1, maxY - minY + 1) * cellSize
      if area < minArea || area > maxArea || size > maxSize { continue }
      out.append(ShuttleCandidate(
        x: sx / Double(area) * Double(cellSize),
        y: sy / Double(area) * Double(cellSize),
        area: area,
        contrast: Double(sumDiff) / Double(area)
      ))
    }
    out.sort { $0.contrast * Double($0.area) > $1.contrast * Double($1.area) }
    return Array(out.prefix(maxCandidates))
  }

  private func miss() {
    guard var tr = track else { seeds = []; return }
    tr.misses += 1
    track = tr.misses > maxMisses ? nil : tr
  }

  private func follow(_ cands: [ShuttleCandidate], t: Double) {
    if let tr = track {
      let dt = max(1e-3, t - tr.t)
      let px = tr.x + tr.vx * dt
      let py = tr.y + tr.vy * dt
      var best: ShuttleCandidate?
      var bestD = Double.infinity
      for c in cands {
        let d = hypot(c.x - px, c.y - py)
        if d < bestD { bestD = d; best = c }
      }
      if let best, bestD <= gate * 0.6 + Double(tr.misses) * 20 {
        let vx = (best.x - tr.x) / dt
        let vy = (best.y - tr.y) / dt
        track = ShuttleTrack(x: best.x, y: best.y, vx: 0.6 * vx + 0.4 * tr.vx, vy: 0.6 * vy + 0.4 * tr.vy, hits: tr.hits + 1, misses: 0, confirmed: true, t: t)
      } else {
        miss()
      }
      return
    }

    // no track yet: grow short chains of blobs that move the same way
    var next: [Seed] = []
    var used = Set<Int>()
    for s in seeds {
      let dt = max(1e-3, t - s.t)
      var best = -1
      var bestScore = Double.infinity
      for (i, c) in cands.enumerated() where !used.contains(i) {
        let dx = c.x - s.x
        let dy = c.y - s.y
        let step = hypot(dx, dy)
        if step < minStep || step > gate { continue }
        if s.hits >= 2 {
          let sv = hypot(s.vx, s.vy) * dt
          if step < 0.4 * sv || step > 2.5 * sv { continue }
          if dx * s.vx + dy * s.vy <= 0.5 * step * hypot(s.vx, s.vy) { continue }
        }
        let score = s.hits >= 2 ? hypot(c.x - (s.x + s.vx * dt), c.y - (s.y + s.vy * dt)) : step
        if score < bestScore { bestScore = score; best = i }
      }
      if best >= 0 {
        used.insert(best)
        let c = cands[best]
        let seed = Seed(x: c.x, y: c.y, t: t, vx: (c.x - s.x) / dt, vy: (c.y - s.y) / dt, hits: s.hits + 1)
        if seed.hits >= confirmHits {
          track = ShuttleTrack(x: seed.x, y: seed.y, vx: seed.vx, vy: seed.vy, hits: seed.hits, misses: 0, confirmed: true, t: t)
          seeds = []
          return
        }
        next.append(seed)
      }
    }
    for (i, c) in cands.enumerated() where !used.contains(i) && next.count < 24 {
      next.append(Seed(x: c.x, y: c.y, t: t, vx: 0, vy: 0, hits: 1))
    }
    seeds = next
  }
}
