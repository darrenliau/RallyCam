import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, usePathname } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { Capture } from '../../modules/rallycam-export/src/capture';
import { usesNativeCapture } from '../camera/RecorderView';
import { touchVenue } from '../db/venues';
import { lastGameConfig, parseLastGame } from '../lastGame';
import { updateSettings, useSettings } from '../settings';
import { buildIdleWatchState, parseWatchCommand, watchStartAllowed } from '../watchBridge';

/**
 * The Apple Watch while the Record screen is not open (the Record screen talks to the watch itself while it is):
 * - tells the watch there is no game running and what a new one would be (the last game's players and venue);
 * - starts a game or training when the watch asks, using the last game's setup, and the saved court of its venue, if it has one,
 *   so that recording starts at once;
 * - keeps the phone awake while the watch app is open, so the phone does not lock between games (a locked phone cannot start a
 *   camera, and the watch would only be able to say it cannot reach it).
 * Draws nothing.
 */
export function WatchLink() {
  const settings = useSettings();
  const pathname = usePathname();
  const last = useMemo(() => parseLastGame(settings.lastGame), [settings.lastGame]);
  const onRecord = pathname.startsWith('/record');
  const now = useRef({ onRecord, last });
  now.current = { onRecord, last };

  // what the watch should show while no game is running
  useEffect(() => {
    const native = Capture;
    if (!native || !usesNativeCapture || !settings.ready || onRecord) return;
    const send = () => native.sendWatchState(buildIdleWatchState(last));
    send();
    const id = setInterval(send, 3000);
    return () => clearInterval(id);
  }, [onRecord, last, settings.ready]);

  // a game or training started from the watch
  useEffect(() => {
    const native = Capture;
    if (!native || !usesNativeCapture) return;
    const sub = native.addListener('onWatchCommand', (e) => {
      const cmd = parseWatchCommand(e);
      if (!cmd || (cmd.kind !== 'startGame' && cmd.kind !== 'startTraining')) return;
      const { onRecord: open, last: setup } = now.current;
      if (!setup || !watchStartAllowed({ onRecord: open, hasLast: true })) return;
      const config = lastGameConfig(setup, cmd.kind === 'startTraining');
      if (setup.venueId) touchVenue(setup.venueId).catch(() => {});
      router.push({ pathname: '/record', params: { config: JSON.stringify(config), ...(setup.venueId ? { venueId: setup.venueId } : {}) } });
    });
    return () => sub.remove();
  }, []);

  // awake while the watch app is open
  useEffect(() => {
    const native = Capture;
    if (!native || !usesNativeCapture) return;
    let awake = false;
    const check = () => {
      const reachable = !!native.getWatchStatus().reachable;
      if (reachable && !awake) { awake = true; activateKeepAwakeAsync('watch').catch(() => {}); }
      else if (!reachable && awake) { awake = false; deactivateKeepAwake('watch').catch(() => {}); }
    };
    check();
    const id = setInterval(check, 3000);
    return () => { clearInterval(id); if (awake) deactivateKeepAwake('watch').catch(() => {}); };
  }, []);

  return null;
}

/** Saves the setup of the game just started, so the watch can start another one like it. */
export function rememberLastGame(game: { type: 'singles' | 'doubles'; players: { A: string[]; B: string[] }; venueId?: string; venueName?: string }) {
  updateSettings({ lastGame: JSON.stringify(game) }).catch(() => {});
}
