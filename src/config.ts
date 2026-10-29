/**
 * Experimental features (debug panel, simulated players, shuttle and automatic scoring cards) show in development builds
 * and in TestFlight builds made with the "testflight" profile in eas.json, which sets EXPO_PUBLIC_EXPERIMENTS=1.
 * A store build leaves them out.
 */
export const EXPERIMENTS = __DEV__ || process.env.EXPO_PUBLIC_EXPERIMENTS === '1';

/**
 * Shuttle speed and shot count only have values when shuttle tracking works. Until then the cards would show dashes,
 * which looks unfinished in a store build, so they are hidden there and shown when experiments are on.
 */
export const HIDE_EMPTY_SHUTTLE = !EXPERIMENTS;
