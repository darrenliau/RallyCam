import type { Rally } from '../engine/types';

/**
 * Where finished rallies come from. Phase 2 will implement this with the on-device
 * shuttle and player tracker. Until then the Record screen only has the dev buttons.
 */
export interface AnalysisSource {
  start(onRally: (rally: Rally) => void): void;
  stop(): void;
}
