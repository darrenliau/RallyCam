import UIKit

/// The scene file written by src/export/ass.ts (buildScene). All coordinates are in a space `width` wide.
struct SceneFile: Decodable {
  let width: Double
  let height: Double
  let items: [SceneItemJSON]
}

struct SceneItemJSON: Decodable {
  let k: String        // "s" shape, "t" text
  let l: Int           // layer
  let a: Double        // start, ms
  let b: Double        // end, ms
  let x: Double
  let y: Double
  let mx: Double?      // glide target
  let my: Double?
  let d: String?       // shape path: m, l and b commands
  let c: String        // colour #RRGGBB
  let o: Double?       // fill opacity
  let sc: String?      // outline colour
  let sw: Double?      // outline width
  let s: String?       // text
  let z: Double?       // font size
  let w: Int?          // bold
  let an: Int?         // 7 left, 8 centre, 9 right
  let sp: Double?      // letter spacing
}

private func color(_ hex: String, alpha: CGFloat = 1) -> UIColor {
  var h = hex
  if h.hasPrefix("#") { h.removeFirst() }
  var value: UInt64 = 0
  Scanner(string: h).scanHexInt64(&value)
  return UIColor(
    red: CGFloat((value >> 16) & 0xFF) / 255,
    green: CGFloat((value >> 8) & 0xFF) / 255,
    blue: CGFloat(value & 0xFF) / 255,
    alpha: alpha
  )
}

/// "m 0 0 l 10 0 b 12 0 12 0 12 4 ..." to a path. Closed, like ASS drawings.
private func parsePath(_ d: String) -> CGPath {
  let path = CGMutablePath()
  let tokens = d.split(separator: " ")
  func num(_ index: Int) -> CGFloat {
    guard index < tokens.count, let v = Double(tokens[index]) else { return 0 }
    return CGFloat(v)
  }
  var i = 0
  while i < tokens.count {
    switch tokens[i] {
    case "m":
      path.move(to: CGPoint(x: num(i + 1), y: num(i + 2)))
      i += 3
    case "l":
      path.addLine(to: CGPoint(x: num(i + 1), y: num(i + 2)))
      i += 3
    case "b":
      path.addCurve(
        to: CGPoint(x: num(i + 5), y: num(i + 6)),
        control1: CGPoint(x: num(i + 1), y: num(i + 2)),
        control2: CGPoint(x: num(i + 3), y: num(i + 4))
      )
      i += 7
    default:
      i += 1
    }
  }
  path.closeSubpath()
  return path
}

final class SceneItem {
  let layer: Int
  let start: Double
  let end: Double
  let x: Double
  let y: Double
  let moveX: Double?
  let moveY: Double?

  // shape
  let path: CGPath?
  let fill: UIColor?
  let stroke: UIColor?
  let strokeWidth: CGFloat

  // text
  let text: NSString?
  let attributes: [NSAttributedString.Key: Any]
  let anchor: Int

  init(_ j: SceneItemJSON) {
    layer = j.l
    start = j.a
    end = j.b
    x = j.x
    y = j.y
    moveX = j.mx
    moveY = j.my
    if j.k == "s", let d = j.d {
      path = parsePath(d)
      let opacity = CGFloat(j.o ?? 1)
      fill = opacity > 0 ? color(j.c, alpha: opacity) : nil
      if let sw = j.sw, sw > 0 {
        stroke = color(j.sc ?? j.c)
        strokeWidth = CGFloat(sw)
      } else {
        stroke = nil
        strokeWidth = 0
      }
      text = nil
      attributes = [:]
      anchor = 7
    } else {
      path = nil
      fill = nil
      stroke = nil
      strokeWidth = 0
      text = (j.s ?? "") as NSString
      let size = CGFloat(j.z ?? 20)
      attributes = [
        .font: UIFont.systemFont(ofSize: size, weight: (j.w ?? 0) == 1 ? .bold : .regular),
        .foregroundColor: color(j.c),
        .kern: CGFloat(j.sp ?? 0),
      ]
      anchor = j.an ?? 7
    }
  }
}

/// Draws the overlay for one moment of the video. Call `draw` with times that only go forward.
final class OverlayRenderer {
  let sceneWidth: Double
  private let items: [SceneItem]   // sorted by start time
  private var next = 0
  private var active: [SceneItem] = []

  init(file: SceneFile) {
    sceneWidth = file.width
    items = file.items.map(SceneItem.init).sorted { $0.start < $1.start }
  }

  /// `ctx` must already be set up so that (0, 0) is the top left and one unit is one scene unit.
  func draw(into ctx: CGContext, atMs t: Double) {
    while next < items.count, items[next].start <= t {
      active.append(items[next])
      next += 1
    }
    active.removeAll { $0.end <= t }
    for item in active.sorted(by: { $0.layer < $1.layer }) {
      drawItem(item, ctx, t)
    }
  }

  private func drawItem(_ item: SceneItem, _ ctx: CGContext, _ t: Double) {
    var x = item.x
    var y = item.y
    if let mx = item.moveX, let my = item.moveY, item.end > item.start {
      let f = min(1, max(0, (t - item.start) / (item.end - item.start)))
      x += (mx - x) * f
      y += (my - y) * f
    }

    ctx.saveGState()
    defer { ctx.restoreGState() }

    if let path = item.path {
      ctx.translateBy(x: CGFloat(x), y: CGFloat(y))
      ctx.addPath(path)
      if let fill = item.fill, let stroke = item.stroke {
        ctx.setFillColor(fill.cgColor)
        ctx.setStrokeColor(stroke.cgColor)
        ctx.setLineWidth(item.strokeWidth)
        ctx.drawPath(using: .fillStroke)
      } else if let fill = item.fill {
        ctx.setFillColor(fill.cgColor)
        ctx.fillPath()
      } else if let stroke = item.stroke {
        ctx.setStrokeColor(stroke.cgColor)
        ctx.setLineWidth(item.strokeWidth)
        ctx.strokePath()
      }
    } else if let text = item.text {
      UIGraphicsPushContext(ctx)
      defer { UIGraphicsPopContext() }
      let width = text.size(withAttributes: item.attributes).width
      var left = CGFloat(x)
      if item.anchor == 8 { left -= width / 2 } else if item.anchor == 9 { left -= width }
      text.draw(at: CGPoint(x: left, y: CGFloat(y)), withAttributes: item.attributes)
    }
  }
}
