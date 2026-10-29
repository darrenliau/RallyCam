/** What the shuttle tracker will report. Nothing produces real values yet (see README, Phase 3). */
export interface ShuttleStats {
  /** Estimated speed of the last shot in km/h. One camera cannot measure it exactly. */
  speedKmh: number;
  /** Shots seen in the current rally. */
  shots: number;
  lastShot?: { type: string; player: string; number: number };
}

const SHOT_TYPES: [string, number][] = [['CLEAR', 95], ['DROP', 55], ['SMASH', 215], ['NET SHOT', 30], ['DRIVE', 125], ['LIFT', 80]];

/** Made-up shuttle numbers for trying the screen without a tracker. Debug builds only. */
export class SimulatedShuttle {
  private timer: ReturnType<typeof setInterval> | null = null;
  private shots = 0;

  constructor(private players: string[]) {}

  /** Call when a point has been scored. */
  newRally() {
    this.shots = 0;
  }

  start(onStats: (s: ShuttleStats) => void) {
    this.stop();
    this.timer = setInterval(() => {
      this.shots++;
      const [type, speed] = SHOT_TYPES[Math.floor(Math.random() * SHOT_TYPES.length)];
      onStats({
        speedKmh: Math.round(speed * (0.85 + Math.random() * 0.3)),
        shots: this.shots,
        lastShot: { type, player: this.players[Math.floor(Math.random() * this.players.length)], number: this.shots },
      });
    }, 900);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
