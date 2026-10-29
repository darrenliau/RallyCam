/**
 * Shuttle speed and shot count only have values once shuttle tracking exists. Until then the cards would show dashes,
 * which looks unfinished in a store build, so they are hidden there and still shown in development builds.
 */
export const HIDE_EMPTY_SHUTTLE = !__DEV__;
