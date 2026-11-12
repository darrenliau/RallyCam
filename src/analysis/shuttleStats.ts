import { COURT_L, COURT_W } from './court';
import type { ShuttleOnMap, ShuttleStats } from './shuttle';
import { landingCall, type FloorPoint, type RallyTrace } from './rallyEnd';
import { shotSpeed, type Floor } from './shotSpeed';
import { classifyShot, type ShotResult } from './shots';
import { packPose, type HitPose } from './pose';

/** A hitter's spot on the floor, with the id of the track it is (when known) so the body pose of that player can be found. */
export type Hitter = Floor & { track?: number };

/** One shot, named, when the next hit (or the landing) showed where it went. */
export interface ShotEvent extends ShotResult {
  /** Position in the rally, 1 is the serve. */
  number: number;
  /** Camera time of the hit, in seconds. */
  t: number;
  /** Track of the player who hit it. */
  track?: number;
  from: Floor | null;
  to: Floor | null;
  /** How the racket hand was held, and the stick figure of the hit (see pose.ts packPose), when a body pose was seen. */
  height?: 'overhead' | 'side' | 'low';
  pose?: number[];
}

/** A confirmed shuttle position from the camera. x and y are fractions of the frame, t is in seconds. */
export interface ShuttleSample { t: number; x: number; y: number }

/** Plausible shuttle speeds only. Beyond this the track jumped to something else. */
/** Above the fastest smash on record (about 137 m/s, 493 km/h), so no real shot is thrown away. */
const MAX_SPEED_MS = 150;
/**
 * Floor positions further outside the court than this (as fractions of its width and length) are not our shuttle: they are
 * the next court's players and rackets, which the watched area also covers. A shuttle in the air projects a little beyond the lines, hence the room.
 */
const OUTSIDE_U = 0.4;
const OUTSIDE_V = 0.5;

/** After this long without a sample the shuttle is considered gone. */
const GONE_AFTER_S = 1.2;
/** The shuttle was seen this recently, so it is still in the air. */
const FLYING_S = 0.25;
/** A shuttle that came down and was lost shows as landed for this long. */
const LANDED_S = 3;

/** Two hits are never closer than this. */
const MIN_HIT_GAP_S = 0.25;
/** A shot's speed is only worked out when the shuttle was seen this many times between the two hits: with fewer, a hit was probably missed or invented. */
const MIN_SAMPLES_PER_SHOT = 6;

/**
 * Turns the shuttle path into the numbers on the cards: a rough speed and a count of shots.
 *
 * Speed is an estimate and a poor one. The shuttle is in the air but the court map only knows about the floor, so the
 * image position is treated as a floor point. The result is about right for a shuttle low over the floor and too high
 * for one high above it. That is why the cards say "estimate".
 *
 * A shot is counted when the shuttle turns around (its direction on screen reverses), and for the first appearance of a rally.
 */
export class ShuttleEstimator {
  private last: (ShuttleSample & { u: number; v: number; air: boolean }) | null = null;
  private prevVel: { x: number; y: number } | null = null;
  private lastHitT = -Infinity;
  private shots = 0;
  private peakKmh = 0;
  private lastShotKmh = 0;
  private smoothMs = 0;
  private seen = false;
  private recent: ShuttleSample[] = [];
  private hit: FloorPoint | null = null;
  private first: FloorPoint | null = null;
  private lastVel: { x: number; y: number } | null = null;
  private hitImage: { t: number; x: number; y: number } | null = null;
  private firstImage: { t: number; x: number; y: number } | null = null;
  private lastFloor: FloorPoint | null = null;
  // Speed of a shot from where the two players stood at its two hits (see shotSpeed.ts); only when `hitterAt` is given
  private prevShot: { t: number; floor: Floor; track?: number; number: number } | null = null;
  private shotLog: ShotEvent[] = [];
  private lastShotType: ShotEvent['type'] | undefined;
  private shotsTaken = 0;
  private samplesSinceHit = 0;
  private strays = 0;

  /**
   * `toFloor` maps a frame position to court coordinates (0..1 across and along the court). It sets `air` when the point cannot be
   * on the floor (see floorPosition in court.ts): the position is then meaningless and is not used to decide anything.
   */
  /**
   * `hitterAt` says where on the floor the player who hit the shuttle was standing, given where the shuttle was in the frame at the hit
   * (the nearest player in the picture). It returns `undefined` when players are not being tracked (nothing is known), and `null`
   * when they are but none is near the shuttle. With it, a shot's speed comes from the two players' positions and the time between
   * the hits, which works for a shuttle in the air; without it, the speed is taken from the shuttle's own floor positions, which only
   * makes sense for one that is low over the floor. A change of direction with nobody near (`null`) is not a hit: it is the ceiling, a
   * wall, the net tape or a tracking glitch, so it is not counted as a shot (and does not flip who is thought to have hit last).
   */
  constructor(
    private toFloor: (x: number, y: number) => { u: number; v: number; air?: boolean },
    private hitterAt?: (hit: { t: number; x: number; y: number }) => Hitter | null | undefined,
    /** How the player on `track` held the racket around the time `t`, from their body pose. */
    private poseOf?: (track: number, t: number) => HitPose | null,
  ) {}

  newRally() {
    this.finishAtLanding();
    this.lastShotType = undefined;
    this.shots = 0;
    this.peakKmh = 0;
    this.lastShotKmh = 0;
    this.smoothMs = 0;
    this.prevVel = null;
    this.last = null;
    this.seen = false;
    this.hit = null;
    this.first = null;
    this.lastVel = null;
    this.hitImage = null;
    this.firstImage = null;
    this.lastFloor = null;
    this.prevShot = null;
    this.samplesSinceHit = 0;
    this.strays = 0;
  }

  push(s: ShuttleSample) {
    const { u, v, air = false } = this.toFloor(s.x, s.y);
    // a point that is on the floor and well outside the court is the next court's, a point that may be in the air is not judged by where it falls
    if (!air && (u < -OUTSIDE_U || u > 1 + OUTSIDE_U || v < -OUTSIDE_V || v > 1 + OUTSIDE_V)) return;
    this.recent.push(s);
    this.samplesSinceHit += 1;
    while (this.recent.length && s.t - this.recent[0].t > 1) this.recent.shift();
    const last = this.last;
    const gap = last ? s.t - last.t : Infinity;

    if (!last || gap > GONE_AFTER_S) {
      // a new flight starts. The first one in a rally is the serve.
      if (!this.seen || this.shots === 0) {
        this.count(s.t, u, v, air, s);
        if (!this.first) {
          this.first = { t: s.t, u, v, ...(air ? { air } : {}) };
          this.firstImage = { t: s.t, x: s.x, y: s.y };
        }
      }
      this.seen = true;
      this.prevVel = null;
      this.last = { ...s, u, v, air };
      if (!air) this.lastFloor = { t: s.t, u, v };
      return;
    }
    if (gap < 0.006) return; // two samples for the same moment

    const vel = { x: (s.x - last.x) / gap, y: (s.y - last.y) / gap };
    // speed needs two floor positions: in the air they mean nothing
    const metres = air || last.air ? NaN : Math.hypot((u - last.u) * COURT_W, (v - last.v) * COURT_L);
    const ms = metres / gap;
    if (ms <= MAX_SPEED_MS) {
      this.smoothMs = this.smoothMs ? 0.5 * this.smoothMs + 0.5 * ms : ms;
      this.peakKmh = Math.max(this.peakKmh, this.smoothMs * 3.6);
    }

    // A shuttle that is hardly moving (the very top of its flight) has no reliable direction: keep the last good one.
    if (Math.hypot(vel.x, vel.y) < 0.02) {
      this.last = { ...s, u, v, air };
      if (!air) this.lastFloor = { t: s.t, u, v };
      return;
    }

    const prev = this.prevVel;
    if (prev) {
      const dot = vel.x * prev.x + vel.y * prev.y;
      const norm = Math.hypot(vel.x, vel.y) * Math.hypot(prev.x, prev.y);
      if (norm > 0 && dot / norm < -0.2 && s.t - this.lastHitT >= MIN_HIT_GAP_S) {
        const hitter = this.hitterAt?.({ t: s.t, x: last.x, y: last.y });
        if (hitter === null) {
          this.strays += 1; // it turned with nobody near it: not a hit
        } else {
          if (!this.hitterAt) { this.lastShotKmh = this.peakKmh; this.peakKmh = 0; }
          this.count(s.t, last.u, last.v, last.air, last, hitter);
        }
      }
    }
    this.prevVel = vel;
    this.lastVel = vel;
    this.last = { ...s, u, v, air };
    if (!air) this.lastFloor = { t: s.t, u, v };
  }

  private count(t: number, u: number, v: number, air: boolean, at: { x: number; y: number }, hitter?: Hitter | null) {
    this.shots += 1;
    this.lastHitT = t;
    this.hit = { t, u, v, ...(air ? { air } : {}) };
    this.hitImage = { t, x: at.x, y: at.y };
    if (this.hitterAt) this.measureShot(t, hitter === undefined ? this.hitterAt({ t, x: at.x, y: at.y }) : hitter);
  }

  /** The shot that ended with this hit: from the previous hitter's spot to this one, in the time between. */
  private measureShot(t: number, floor: Hitter | null | undefined) {
    const prev = this.prevShot;
    if (prev) {
      const r = floor && this.samplesSinceHit >= MIN_SAMPLES_PER_SHOT ? shotSpeed(prev.floor, floor, t - prev.t) : null;
      this.lastShotKmh = r ? r.kmh : 0; // no believable number: show none rather than the shot before
      this.finishShot(prev, floor ?? null, t - prev.t);
    }
    this.prevShot = floor ? { t, floor: { u: floor.u, v: floor.v }, track: floor.track, number: this.shots } : null;
    this.samplesSinceHit = 0;
  }

  /** Names the shot that began at `prev`: it went to `to` (the next hitter's spot, or where it came down) in `seconds`. */
  private finishShot(prev: { t: number; floor: Floor; track?: number; number: number }, to: Floor | null, seconds: number | null) {
    const pose = prev.track != null ? this.poseOf?.(prev.track, prev.t) ?? null : null;
    const r = classifyShot({ number: prev.number, from: prev.floor, to, seconds, height: pose?.height, previous: this.lastShotType });
    this.lastShotType = r.type;
    this.shotLog.push({
      ...r, number: prev.number, t: prev.t, track: prev.track, from: prev.floor, to,
      ...(pose ? { height: pose.height, pose: packPose(pose.pose) } : {}),
    });
  }

  /** The last shot of a rally has no next hit: it ends where the shuttle came down. */
  private finishAtLanding() {
    const prev = this.prevShot;
    const down = this.lastFloor;
    if (prev && down && this.lastVel && this.lastVel.y > 0 && down.t - prev.t > 0.15) {
      this.finishShot(prev, { u: down.u, v: down.v }, down.t - prev.t);
    }
    this.prevShot = null;
  }

  /** The shots named since this was last called, oldest first. */
  takeShots(): ShotEvent[] {
    const out = this.shotLog.slice(this.shotsTaken);
    this.shotsTaken = this.shotLog.length;
    return out;
  }

  /** What happened so far in this rally, for deciding who won it (see rallyEnd.ts). */
  trace(): RallyTrace {
    const l = this.last;
    return {
      shots: this.shots, lastHit: this.hit, firstSeen: this.first, descending: !!this.lastVel && this.lastVel.y > 0,
      lastSeen: l ? { t: l.t, u: l.u, v: l.v, ...(l.air ? { air: true } : {}) } : null,
      lastFloor: this.lastFloor, hitImage: this.hitImage, firstImage: this.firstImage,
      ...(this.strays ? { strays: this.strays } : {}),
    };
  }

  /** What to show now, or null if the shuttle has not been seen for a while. */
  stats(now: number): ShuttleStats | null {
    if (!this.last || now - this.last.t > GONE_AFTER_S) return null;
    // with hitters known, only a measured shot counts; the shuttle's own floor speed is not used (in the air it means nothing)
    const kmh = this.hitterAt ? this.lastShotKmh : this.lastShotKmh > 0 ? this.lastShotKmh : this.peakKmh;
    return { speedKmh: Math.round(kmh), shots: this.shots };
  }

  /**
   * Where to draw the shuttle on the court map. While it is being tracked it is `flying` (in play). When it stops being
   * seen while moving down the picture, it is shown as `landed` at that spot for a few seconds, with an in or out call.
   * A shuttle lost while going up or sideways (behind a player, out of the picture) shows nothing.
   */
  onMap(now: number, singles: boolean): ShuttleOnMap | null {
    const l = this.last;
    if (!l) return null;
    const age = now - l.t;
    // in the air its floor position means nothing, so there is nothing to draw on the court map
    if (l.air) return null;
    if (age <= FLYING_S) return { u: l.u, v: l.v, phase: 'flying' };
    if (age <= LANDED_S && this.shots >= 1 && this.lastVel && this.lastVel.y > 0) {
      return { u: l.u, v: l.v, phase: 'landed', inBounds: landingCall(l, singles).inBounds };
    }
    return null;
  }

  /** The last fraction of a second of the path, oldest first, in frame fractions. */
  trail(now: number, maxAge = 0.5): { x: number; y: number }[] {
    return this.recent.filter((p) => now - p.t <= maxAge).map((p) => ({ x: p.x, y: p.y }));
  }
}
