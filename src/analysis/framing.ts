/**
 * Auto-framing: which part of the full (0.5x) picture the viewer is shown, and how it glides as play moves.
 *
 * Everything the app analyses stays in the *reference frame*, the full picture of the ultra-wide camera (court corners, trackers, court
 * map). A `Window` says which part of it is shown (and recorded): its centre and its width as a fraction of the reference frame. The
 * shown picture has the same shape as the frame, so its height is the same fraction of the frame's height. `w` = 1 is the full picture
 * (the 0.5x view), `WIDE_RATIO` is the closer view of the main (1x) lens.
 */

export interface Window { cx: number; cy: number; w: number }
export interface P { x: number; y: number }

/** How much of the 0.5x picture the 1x lens shows, across. About a half; to be measured by comparing one still from each lens. */
export const WIDE_RATIO = 0.5;

export const fullWindow = (): Window => ({ cx: 0.5, cy: 0.5, w: 1 });

/** Keeps a window inside the picture and no tighter than `minW`. */
export function clampWindow(win: Window, minW = WIDE_RATIO): Window {
  const w = Math.min(1, Math.max(minW, win.w));
  const half = w / 2;
  return { w, cx: Math.min(1 - half, Math.max(half, win.cx)), cy: Math.min(1 - half, Math.max(half, win.cy)) };
}

/** A point of the reference frame as a fraction of the shown picture (0..1 inside the window, outside it when not shown). */
export function worldToView(p: P, win: Window): P {
  return { x: (p.x - (win.cx - win.w / 2)) / win.w, y: (p.y - (win.cy - win.w / 2)) / win.w };
}

/** The inverse: a point of the shown picture as a point of the reference frame. */
export function viewToWorld(p: P, win: Window): P {
  return { x: win.cx - win.w / 2 + p.x * win.w, y: win.cy - win.w / 2 + p.y * win.w };
}

/** Something to keep in view: a player or the shuttle, in the reference frame, with its speed in frame fractions per second if known. */
export interface Subject extends P { vx?: number; vy?: number }

export interface FramingOptions {
  /** Room kept around the subjects, as a fraction of the window. */
  margin: number;
  /** Seconds ahead a moving subject is expected to be, so the view widens before it leaves. */
  lead: number;
  /** The tightest window allowed. */
  minW: number;
  /** Seconds with nothing tracked before the view goes back to the full picture. */
  lostAfterS: number;
  /** How fast the view widens and tightens, in octaves (doublings of the width) a second. */
  widenRate: number;
  tightenRate: number;
  /** When a subject is already outside the window: how fast to widen. */
  urgentRate: number;
  /** The view only tightens after the wanted window has been this much tighter for this long. */
  tightenDwellS: number;
  /** ...and tighter by at least this fraction of the current width (otherwise it is jitter). */
  deadZone: number;
  /** How fast the centre follows, as a time constant in seconds. */
  panTimeS: number;
  /** A lens zoom cannot pan: the centre stays in the middle. */
  panLocked: boolean;
}

export const DEFAULT_FRAMING: FramingOptions = {
  margin: 0.12, lead: 0.4, minW: WIDE_RATIO, lostAfterS: 2,
  widenRate: 0.35, tightenRate: 0.1, urgentRate: 0.9, tightenDwellS: 1.5, deadZone: 0.08, panTimeS: 0.6, panLocked: false,
};

/** The smallest window that holds every subject (and where each is expected to be soon) with the margin, or null when there are none. */
export function wantedWindow(subjects: Subject[], opts: FramingOptions): { win: Window; hold: boolean } | null {
  if (!subjects.length) return null;
  const pts: P[] = [];
  for (const s of subjects) {
    pts.push({ x: s.x, y: s.y });
    if (s.vx != null && s.vy != null) pts.push({ x: s.x + s.vx * opts.lead, y: s.y + s.vy * opts.lead });
  }
  const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
  // the window is square in fractions (same shape as the frame), so it must span the larger of the two
  const need = Math.max(x1 - x0, y1 - y0) / (1 - 2 * opts.margin);
  const win = clampWindow({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: need }, opts.minW);
  return { win, hold: false };
}

/** Is any subject outside the shown picture (or in its outer margin, where it is about to leave)? */
export function anyOutside(subjects: Subject[], win: Window, inner = 0.97): boolean {
  return subjects.some((s) => {
    const v = worldToView(s, win);
    return v.x < 1 - inner || v.x > inner || v.y < 1 - inner || v.y > inner;
  });
}

/**
 * Decides the window, step by step. Call `update` a few times a second (or on every frame) with what is tracked now. It widens fast
 * and tightens slowly, never tightens on a jitter, and goes back to the full picture when nothing has been tracked for a while: a
 * window that misses the game cannot be undone in the saved video, so the safe failure is wide.
 */
export class Framer {
  private win: Window;
  private lastT: number | null = null;
  private lastSeenT: number | null = null;
  private tighterSince: number | null = null;
  private opts: FramingOptions;

  constructor(start: Window = fullWindow(), opts: Partial<FramingOptions> = {}) {
    this.opts = { ...DEFAULT_FRAMING, ...opts };
    this.win = clampWindow(start, this.opts.minW);
  }

  get window(): Window { return this.win; }

  setOptions(opts: Partial<FramingOptions>) { this.opts = { ...this.opts, ...opts }; }

  /** Jump to a window (for example the start window after the court is locked). */
  reset(win: Window, t: number) {
    this.win = clampWindow(win, this.opts.minW);
    this.lastT = t;
    this.lastSeenT = t;
    this.tighterSince = null;
  }

  update(t: number, subjects: Subject[]): Window {
    const o = this.opts;
    const dt = this.lastT == null ? 0 : Math.max(0, Math.min(0.5, t - this.lastT));
    this.lastT = t;
    if (this.lastSeenT == null) this.lastSeenT = t;
    if (subjects.length) this.lastSeenT = t;

    const wanted = wantedWindow(subjects, o);
    const lost = !wanted && t - this.lastSeenT >= o.lostAfterS;
    const target = wanted ? wanted.win : lost ? fullWindow() : this.win; // nothing tracked just now: hold the window for a moment
    const urgent = anyOutside(subjects, this.win);

    let w = this.win.w;
    if (target.w > w * 1.01 || lost) {
      this.tighterSince = null;
      const rate = urgent ? o.urgentRate : o.widenRate;
      w = Math.min(target.w, w * Math.pow(2, rate * dt));
    } else if (target.w < w * (1 - o.deadZone)) {
      this.tighterSince ??= t;
      if (t - this.tighterSince >= o.tightenDwellS) w = Math.max(target.w, w * Math.pow(2, -o.tightenRate * dt));
    } else {
      this.tighterSince = null;
    }

    const k = urgent ? 1 : 1 - Math.exp(-dt / o.panTimeS);
    let cx = this.win.cx + (target.cx - this.win.cx) * k;
    let cy = this.win.cy + (target.cy - this.win.cy) * k;
    if (o.panLocked) { cx = 0.5; cy = 0.5; }
    this.win = clampWindow({ cx, cy, w }, o.minW);
    return this.win;
  }
}
