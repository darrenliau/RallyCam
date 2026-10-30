/**
 * Scores the shuttle tracker against a human's marks, so a change can be judged by numbers instead of a feeling.
 *
 * A label file says, for one clip: when the shuttle is in play (so a track outside those times is a false one), and the
 * shuttle's position at some moments (so a track at those moments can be called right or wrong).
 */

export interface LabelPoint { t: number; x: number; y: number }

export interface Labels {
  /** Frames per second of the clip. */
  fps: number;
  /** Times (seconds) when a shuttle can be seen in the air. */
  playIntervals: [number, number][];
  /** Where the shuttle was at those moments, in pixels of the full frame. */
  points: LabelPoint[];
}

/** What the tracker reported for one frame, in pixels of the full frame. */
export interface FrameResult {
  t: number;
  boxes: { x: number; y: number }[];
  track?: { x: number; y: number };
}

export interface Metrics {
  labelled: number;
  /** Share of labelled positions with a candidate blob nearby (the most the tracker could have used). */
  candidateRecall: number;
  /** Share of labelled positions where the track was on the shuttle. */
  trackRecall: number;
  /** Frames with a track, and how many of them were outside play or away from the shuttle's path. */
  trackFrames: number;
  falseFrames: number;
  /** Of the frames with a track that can be judged, the share that were on the shuttle. */
  precision: number;
  /** Separate runs of track frames that were false for most of their length. */
  falseTracks: number;
  /** Average distance (pixels) of the track from the shuttle where it was right. */
  meanError: number;
}

export interface EvalOptions {
  /** A candidate or track within this many pixels of a label counts as on it. */
  hitRadius?: number;
  /** A track frame within this many pixels of the interpolated label path counts as right. */
  pathRadius?: number;
  /** Labels further apart than this (seconds) are not joined into a path. */
  maxLabelGap?: number;
}

const inPlay = (t: number, labels: Labels) => labels.playIntervals.some(([a, b]) => t >= a && t <= b);

/** The shuttle's position at time t, by joining the labels on either side, or undefined if they are too far apart. */
export function labelledPosition(t: number, labels: Labels, maxGap: number): { x: number; y: number } | undefined {
  const pts = labels.points;
  let before: LabelPoint | undefined;
  let after: LabelPoint | undefined;
  for (const p of pts) {
    if (p.t <= t && (!before || p.t > before.t)) before = p;
    if (p.t >= t && (!after || p.t < after.t)) after = p;
  }
  if (!before || !after) return undefined;
  if (before.t === after.t) return { x: before.x, y: before.y };
  if (after.t - before.t > maxGap) return undefined;
  const k = (t - before.t) / (after.t - before.t);
  return { x: before.x + (after.x - before.x) * k, y: before.y + (after.y - before.y) * k };
}

export function evaluate(frames: FrameResult[], labels: Labels, options: EvalOptions = {}): Metrics {
  const hit = options.hitRadius ?? 25;
  const pathR = options.pathRadius ?? 45;
  const maxGap = options.maxLabelGap ?? 0.25;
  const frameAt = (t: number) => {
    const i = Math.round(t * labels.fps);
    return frames[Math.min(frames.length - 1, Math.max(0, i))];
  };

  let candHits = 0;
  let trackHits = 0;
  let errSum = 0;
  for (const p of labels.points) {
    const f = frameAt(p.t);
    if (!f) continue;
    if (f.boxes.some((b) => Math.hypot(b.x - p.x, b.y - p.y) <= hit)) candHits++;
    if (f.track && Math.hypot(f.track.x - p.x, f.track.y - p.y) <= hit) {
      trackHits++;
      errSum += Math.hypot(f.track.x - p.x, f.track.y - p.y);
    }
  }

  let trackFrames = 0;
  let right = 0;
  let wrong = 0;
  let falseRuns = 0;
  let run: { n: number; bad: number } | null = null;
  const close = () => {
    if (run && run.n > 0 && run.bad / run.n > 0.5) falseRuns++;
    run = null;
  };
  for (const f of frames) {
    if (!f.track) { close(); continue; }
    trackFrames++;
    run ??= { n: 0, bad: 0 };
    run.n++;
    let verdict: 'right' | 'wrong' | 'unknown';
    if (!inPlay(f.t, labels)) verdict = 'wrong'; // a track when no shuttle is in the air is false
    else {
      const truth = labelledPosition(f.t, labels, maxGap);
      verdict = !truth ? 'unknown' : Math.hypot(f.track.x - truth.x, f.track.y - truth.y) <= pathR ? 'right' : 'wrong';
    }
    if (verdict === 'right') right++;
    if (verdict === 'wrong') { wrong++; run.bad++; }
  }
  close();

  const n = labels.points.length;
  return {
    labelled: n,
    candidateRecall: n ? candHits / n : 0,
    trackRecall: n ? trackHits / n : 0,
    trackFrames,
    falseFrames: wrong,
    precision: right + wrong ? right / (right + wrong) : 1,
    falseTracks: falseRuns,
    meanError: trackHits ? errSum / trackHits : 0,
  };
}

/** One line for a table: easy to compare two runs. */
export function formatMetrics(m: Metrics): string {
  const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
  return `labelled ${m.labelled}  candidates found ${pct(m.candidateRecall)}  track on shuttle ${pct(m.trackRecall)}  precision ${pct(m.precision)}  false tracks ${m.falseTracks}  track frames ${m.trackFrames} (${m.falseFrames} false)  error ${m.meanError.toFixed(1)} px`;
}
