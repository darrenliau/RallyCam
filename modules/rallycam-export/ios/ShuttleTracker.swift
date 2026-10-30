import Foundation

/// First attempt at following the shuttle by looking for small things that move fast.
/// This is a Swift copy of src/analysis/shuttleMotion.ts. Keep the two the same: the TypeScript version has the tests.
/// The method is described at the top of that file.

struct ShuttleCandidate {
  var x: Double
  var y: Double
  var area: Int
  var contrast: Double
  /// Inside a player's box: probably a hand, a racket or a foot.
  var inPlayer = false
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
  var born: Double
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

/// Where a player is, widened to cover the arms and racket, in the pixels of the watched area (see playerMask in shuttleMotion.ts).
func playerMask(_ person: CGRect, boundsW: CGFloat, boundsH: CGFloat) -> CGRect {
  let x0 = max(0, person.minX - 0.5 * person.width)
  let x1 = min(boundsW, person.minX + 1.5 * person.width)
  let y0 = max(0, person.minY - 0.25 * person.height)
  let y1 = min(boundsH, person.minY + 1.05 * person.height)
  return CGRect(x: x0, y: y0, width: max(0, x1 - x0), height: max(0, y1 - y0))
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
  private let shakeFraction = 0.012
  private let maxCandidates = 12
  private let hotRadius = 14.0
  private let hotFrames = 10
  private let hotCount = 4
  private let maxTrackAge = 1.2

  private var frames: [[UInt8]] = [[], [], []]   // newest, previous, the one before
  private var width = 0
  private var height = 0
  private var prevT = 0.0
  private var haveFrames = 0
  private(set) var track: ShuttleTrack?
  private var seeds: [Seed] = []
  private var recent: [[ShuttleCandidate]] = []
  private var maskHistory: [[CGRect]] = []

  func reset() {
    haveFrames = 0
    track = nil
    seeds = []
    recent = []
    maskHistory = []
  }

  /// `plane` is the camera's luma plane. (x0, y0, w, h) is the area to watch, in pixels. `t` is the frame time in seconds.
  func update(plane: UnsafePointer<UInt8>, stride: Int, x0: Int, y0: Int, w: Int, h: Int, t: Double, masks: [CGRect] = []) -> ShuttleResult {
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
    // The change between frames also shows where a player was a moment ago, so keep the last few positions of each mask
    maskHistory.append(masks)
    if maskHistory.count > 3 { maskHistory.removeFirst() }
    var covered = [Bool](repeating: false, count: cw * ch)
    for m in maskHistory.joined() {
      let cx0 = max(0, Int(m.minX) / cellSize), cx1 = min(cw - 1, Int(m.maxX) / cellSize)
      let cy0 = max(0, Int(m.minY) / cellSize), cy1 = min(ch - 1, Int(m.maxY) / cellSize)
      if cx0 > cx1 || cy0 > cy1 { continue }
      for cy in cy0...cy1 { for cx in cx0...cx1 { covered[cy * cw + cx] = true } }
    }
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
              let c = cellRow + x / cellSize
              if !covered[c] { active += 1 }   // players moving must not make the picture look shaken
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

    let candidates = dropBackground(blobs(count: cellCount, diff: cellDiff, cw: cw, ch: ch, covered: covered))
    follow(candidates, t: obsT)
    return ShuttleResult(candidates: candidates, track: track, activeFraction: activeFraction, shaky: false)
  }

  private func blobs(count: [UInt16], diff: [UInt32], cw: Int, ch: Int, covered: [Bool]) -> [ShuttleCandidate] {
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
      let cxm = min(cw - 1, Int(sx / Double(area)))
      let cym = min(ch - 1, Int(sy / Double(area)))
      out.append(ShuttleCandidate(
        x: sx / Double(area) * Double(cellSize),
        y: sy / Double(area) * Double(cellSize),
        area: area,
        contrast: Double(sumDiff) / Double(area),
        inPlayer: covered[cym * cw + cxm]
      ))
    }
    // blobs on a player come last, so they do not crowd the shuttle out of the list
    func score(_ c: ShuttleCandidate) -> Double { c.contrast * Double(c.area) * (c.inPlayer ? 0.25 : 1) }
    out.sort { score($0) > score($1) }
    return Array(out.prefix(maxCandidates))
  }

  /// Remove blobs that have been at about the same spot in several of the last few frames.
  private func dropBackground(_ found: [ShuttleCandidate]) -> [ShuttleCandidate] {
    let keep = found.filter { c in
      var n = 0
      for frame in recent where frame.contains(where: { hypot($0.x - c.x, $0.y - c.y) < hotRadius }) { n += 1 }
      return n < hotCount
    }
    recent.append(found)
    if recent.count > hotFrames { recent.removeFirst() }
    return keep
  }

  private func miss() {
    guard var tr = track else { seeds = []; return }
    tr.misses += 1
    track = tr.misses > maxMisses ? nil : tr
  }

  private func follow(_ cands: [ShuttleCandidate], t: Double) {
    if let tr = track {
      if t - tr.born > maxTrackAge { track = nil; seeds = []; return }
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
        track = ShuttleTrack(x: best.x, y: best.y, vx: 0.6 * vx + 0.4 * tr.vx, vy: 0.6 * vy + 0.4 * tr.vy, hits: tr.hits + 1, misses: 0, confirmed: true, t: t, born: tr.born)
      } else {
        miss()
      }
      return
    }

    // no track yet: grow short chains of blobs that move the same way. Blobs on a player never start one.
    let free = cands.filter { !$0.inPlayer }
    var next: [Seed] = []
    var used = Set<Int>()
    for s in seeds {
      let dt = max(1e-3, t - s.t)
      var best = -1
      var bestScore = Double.infinity
      for (i, c) in free.enumerated() where !used.contains(i) {
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
        let c = free[best]
        let seed = Seed(x: c.x, y: c.y, t: t, vx: (c.x - s.x) / dt, vy: (c.y - s.y) / dt, hits: s.hits + 1)
        if seed.hits >= confirmHits {
          track = ShuttleTrack(x: seed.x, y: seed.y, vx: seed.vx, vy: seed.vy, hits: seed.hits, misses: 0, confirmed: true, t: t, born: t)
          seeds = []
          return
        }
        next.append(seed)
      }
    }
    for (i, c) in free.enumerated() where !used.contains(i) && next.count < 24 {
      next.append(Seed(x: c.x, y: c.y, t: t, vx: 0, vy: 0, hits: 1))
    }
    seeds = next
  }
}
