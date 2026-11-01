/**
 * Test features (debug panel, simulated players, the "Shuttle model" and "Keep a clean copy" switches, shuttle and automatic scoring
 * cards) show in every build: development, release and TestFlight. Only a store build leaves them out, and that is made with
 * EXPO_PUBLIC_STORE_BUILD=1, which the `production` profile in eas.json sets (the `testflight` profile sets it back to 0).
 */
export const EXPERIMENTS = process.env.EXPO_PUBLIC_STORE_BUILD !== '1';

/**
 * Shuttle speed and shot count only have values when shuttle tracking works. Until then the cards would show dashes,
 * which looks unfinished in a store build, so they are hidden there and shown when test features are on.
 */
export const HIDE_EMPTY_SHUTTLE = !EXPERIMENTS;
