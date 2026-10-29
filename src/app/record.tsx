import * as Haptics from 'expo-haptics';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import * as ScreenOrientation from 'expo-screen-orientation';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { courtMap, defaultCorners, denormalizeCorners, normalizeCorners, type Corners } from '../analysis/court';
import { FRAME_ASPECT, personDetector } from '../analysis/detector';
import { DistanceMeter, SimulatedTracker, type Track } from '../analysis/players';
import { DetectorPlayerTracker } from '../analysis/tracker';
import { CourtAligner } from '../components/CourtAligner';
import { PlayerOverlay, type TagInfo } from '../components/PlayerOverlay';
import { CourtMapCard, DistanceCard } from '../components/StatCards';
import { RecorderView, isExpoGo } from '../camera/RecorderView';
import type { RecorderHandle } from '../camera/types';
import { Button } from '../components/ui';
import { ScoreBoard } from '../components/ScoreBoard';
import { createMatch, finishMatch, saveRallies } from '../db/matches';
import { getVenue, saveVenueCorners, type Venue } from '../db/venues';
import { addRally, newMatch, undoLast } from '../engine/scoring';
import { formatClock } from '../engine/format';
import type { MatchConfig, MatchState, Side } from '../engine/types';
import { colors } from '../theme';

// Remembered between matches in this session so the user does not re-align every time.
const savedCorners: Record<string, Corners> = {};

export default function Record() {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { config: raw, venueId } = useLocalSearchParams<{ config: string; venueId?: string }>();
  const config = useRef<MatchConfig>(JSON.parse(raw)).current;

  // Matches are filmed in landscape: the court is wide and the phone sits on a tripod. Everything else stays portrait.
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    return () => { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {}); };
  }, []);

  const [camPerm, askCam] = useCameraPermissions();
  const [micPerm, askMic] = useMicrophonePermissions();
  const recorder = useRef<RecorderHandle>(null);
  const recordingStarted = useRef(false);
  const matchId = useRef<Promise<string>>(createMatch(config, venueId));
  const startedAt = useRef(0);
  const lastEnd = useRef(0);

  const [state, setState] = useState<MatchState>(() => newMatch(config));
  const [elapsed, setElapsed] = useState(0);
  const [recError, setRecError] = useState<string | null>(null);
  const [fps, setFps] = useState<number | undefined>(undefined);
  const [ending, setEnding] = useState(false);

  // Court alignment and player tags
  const sizeKey = `${Math.round(width)}x${Math.round(height)}`;
  const [dragged, setDragged] = useState<Corners | null>(null);
  const [venue, setVenue] = useState<Venue | null>(null);
  const [venueLoaded, setVenueLoaded] = useState(!venueId);
  const [aligning, setAligning] = useState(true);
  const [staleCourt, setStaleCourt] = useState(false);
  const venueCorners = venue?.corners ? denormalizeCorners(venue.corners, width, height) : null;
  const corners = dragged ?? venueCorners ?? savedCorners[sizeKey] ?? defaultCorners(width, height);

  // A venue with a saved court starts locked, unless this screen is a different shape from when it was saved.
  useEffect(() => {
    if (!venueId) return;
    getVenue(venueId).then((v) => {
      setVenue(v);
      if (v?.corners) {
        const aspect = width / height;
        const differs = v.aspect != null && Math.abs(v.aspect - aspect) / v.aspect > 0.03;
        setStaleCourt(differs);
        setAligning(differs);
      }
      setVenueLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId]);
  const map = useMemo(() => courtMap(corners), [corners]);
  const nNear = config.players.A.length;
  const names = useMemo(() => [...config.players.A, ...config.players.B], [config]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [assign, setAssign] = useState<number[]>(() => names.map((_, i) => i)); // track id -> player index
  const assignRef = useRef(assign);
  assignRef.current = assign;
  const [selected, setSelected] = useState<number | null>(null);
  const meter = useRef(new DistanceMeter()).current;
  const simulator = useRef<SimulatedTracker | null>(null);
  const [simulating, setSimulating] = useState(false);

  const colorOf = (player: number) => (player < nNear ? colors.near[player] : colors.far[player - nNear]);
  const tagFor = useCallback((id: number): TagInfo => {
    const p = assignRef.current[id] ?? id;
    return { name: names[p], color: p < nNear ? colors.near[p] : colors.far[p - nNear] };
  }, [names, nNear]);

  const onTracks = useCallback((t: Track[]) => {
    meter.update(t, (id) => assignRef.current[id] ?? id);
    setTracks(t);
  }, [meter]);

  const toggleSimulation = () => {
    if (simulator.current) {
      simulator.current.stop();
      simulator.current = null;
      setSimulating(false);
      setTracks([]);
    } else {
      simulator.current = new SimulatedTracker(nNear, names.length - nNear);
      simulator.current.start(onTracks);
      setSimulating(true);
    }
  };
  useEffect(() => () => simulator.current?.stop(), []);

  // Real tracking, once a native detector is registered. It starts when the court is locked.
  const mapRef = useRef(map);
  mapRef.current = map;
  const sizeRef = useRef({ width, height });
  sizeRef.current = { width, height };
  useEffect(() => {
    if (aligning || !personDetector) return;
    const tracker = new DetectorPlayerTracker(
      personDetector(),
      () => mapRef.current,
      () => ({ frameAspect: FRAME_ASPECT, screenW: sizeRef.current.width, screenH: sizeRef.current.height }),
      { nNear, nFar: names.length - nNear },
    );
    tracker.start(onTracks);
    return () => tracker.stop();
  }, [aligning, nNear, names.length, onTracks]);

  const lockCourt = () => {
    savedCorners[sizeKey] = corners;
    if (venue) {
      const norm = normalizeCorners(corners, width, height);
      saveVenueCorners(venue.id, norm, width / height);
      setVenue({ ...venue, corners: norm, aspect: width / height });
      setDragged(null);
    }
    setStaleCourt(false);
    setAligning(false);
  };
  const onTagPress = (id: number) => {
    if (selected == null) return setSelected(id);
    if (selected !== id) {
      setAssign((a) => {
        const next = [...a];
        [next[selected], next[id]] = [next[id], next[selected]];
        return next;
      });
    }
    setSelected(null);
  };

  useEffect(() => {
    if (!camPerm?.granted && camPerm?.canAskAgain) askCam();
    if (!micPerm?.granted && micPerm?.canAskAgain) askMic();
  }, [camPerm, micPerm, askCam, askMic]);

  useEffect(() => {
    const id = setInterval(() => startedAt.current && setElapsed(Date.now() - startedAt.current), 500);
    return () => clearInterval(id);
  }, []);

  const onReady = useCallback(() => {
    if (recordingStarted.current) return;
    recordingStarted.current = true;
    startedAt.current = Date.now();
    recorder.current?.start().catch((e: Error) => setRecError(e.message));
  }, []);

  const persist = useCallback(async (next: MatchState) => {
    setState(next);
    await saveRallies(await matchId.current, next.rallies);
  }, []);

  /** Called by the analysis source in Phase 2. Until then only the dev buttons call it. */
  const onPoint = useCallback((winner: Side) => {
    const now = Date.now() - startedAt.current;
    const next = addRally(state, { winner, startMs: lastEnd.current, endMs: now, source: 'manual' });
    lastEnd.current = now;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    persist(next);
  }, [state, persist]);

  const onUndo = () => persist(undoLast(state));

  const endMatch = async () => {
    setEnding(true);
    const uri = await recorder.current?.stop().catch(() => undefined);
    const id = await matchId.current;
    await finishMatch(id, uri ?? null, Date.now() - startedAt.current);
    router.replace(`/match/${id}`);
  };

  if (!camPerm || !micPerm) return <View style={s.fill} />;
  if (!camPerm.granted || !micPerm.granted) {
    return (
      <View style={[s.fill, s.center, { padding: 24, gap: 12 }]}>
        <Text style={s.h}>Camera and microphone needed</Text>
        <Text style={s.muted}>RallyCam films the match and listens for racket hits. Allow both in your phone settings to continue.</Text>
        <Button label="Allow access" onPress={() => { askCam(); askMic(); }} />
        <Button label="Back" kind="ghost" onPress={() => router.back()} />
      </View>
    );
  }

  const L = insets.left + 12;
  const R = insets.right + 12;
  const T = insets.top + 8;
  const B = insets.bottom + 12;
  const boardW = Math.min(360, width - 2 * (L + 170));
  const lowFps = fps != null && fps < 60;

  return (
    <View style={s.fill}>
      <RecorderView ref={recorder} style={StyleSheet.absoluteFill} onReady={onReady} onError={setRecError} onFps={setFps} />
      {!venueLoaded ? null : aligning ? (
        <CourtAligner corners={corners} onChange={setDragged} width={width} height={height} />
      ) : (
        <PlayerOverlay map={map} width={width} height={height} tracks={tracks} tagFor={tagFor} selected={selected} onTagPress={onTagPress} />
      )}

      <View style={[s.chipRow, { left: L, top: T }]} pointerEvents="box-none">
        <View style={s.chip}>
          <View style={s.dot} />
          <Text style={s.chipText}>{recError ? 'Not recording' : formatClock(elapsed)}</Text>
        </View>
        <View style={s.chip}>
          <Text style={[s.chipText, lowFps && { color: colors.amber }]}>
            {isExpoGo ? 'Standard fps (Expo Go)' : fps != null ? `${fps} fps` : '… fps'}
          </Text>
        </View>
        {!aligning && <Text style={s.chip2} onPress={() => setAligning(true)} accessibilityRole="button">Re-align court</Text>}
      </View>

      <View style={{ position: 'absolute', top: T, left: (width - boardW) / 2, width: boardW }} pointerEvents="none">
        <ScoreBoard state={state} />
      </View>

      {(recError || lowFps) && (
        <Text style={[s.err, { top: T + 96, left: (width - 360) / 2, width: 360 }, !recError && { backgroundColor: 'rgba(160,110,20,0.9)' }]}>
          {recError ? `Recording failed: ${recError}` : `Only ${fps} fps on this phone. Fast shots will blur, so tracking will be less accurate.`}
        </Text>
      )}

      {__DEV__ && (
        <View style={[s.dev, { top: T, right: R }]}>
          <Text style={s.devText}>Dev only. Automatic scoring is not built yet.</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button kind="ghost" label="Near" onPress={() => onPoint('A')} style={s.devBtn} />
            <Button kind="ghost" label="Far" onPress={() => onPoint('B')} style={s.devBtn} />
          </View>
          <Button kind="ghost" label={simulating ? 'Stop simulation' : 'Simulate players'} onPress={toggleSimulation} style={s.devBtn} />
        </View>
      )}

      {!aligning && tracks.length > 0 && (
        <>
          <View style={{ position: 'absolute', left: L, top: T + 40 }} pointerEvents="none">
            <CourtMapCard tracks={tracks} tagFor={tagFor} />
          </View>
          <View style={{ position: 'absolute', left: L, bottom: B }} pointerEvents="none">
            <DistanceCard rows={names.map((name, i) => ({ name, color: colorOf(i), metres: meter.metres(i) }))} />
          </View>
        </>
      )}

      {venueLoaded && aligning && (
        <View style={[s.banner, { bottom: B, left: (width - 440) / 2, width: 440 }]}>
          <Text style={s.bannerText}>
            {staleCourt ? 'This phone\'s screen is a different shape from when the court was saved. Check the four dots. ' : 'Drag the four dots onto the outer corners of the court, then lock it in. '}
            {venue ? `It is saved for ${venue.name}.` : ''}
          </Text>
          <Button label="Lock court" onPress={lockCourt} />
        </View>
      )}

      <View style={[s.actions, { right: R, bottom: B }]}>
        <Button kind="ghost" label="Fix last point" onPress={onUndo} disabled={state.rallies.length === 0} />
        <Button label={state.matchWinner ? 'Finish' : 'End match'} onPress={endMatch} disabled={ending} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  center: { justifyContent: 'center' },
  h: { color: colors.text, fontSize: 22, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 14 },
  chipRow: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(5,9,10,0.62)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  chip2: { color: '#fff', fontSize: 12, fontWeight: '600', backgroundColor: 'rgba(5,9,10,0.62)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  chipText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  banner: { position: 'absolute', gap: 10, backgroundColor: 'rgba(5,9,10,0.85)', borderRadius: 16, padding: 14 },
  bannerText: { color: '#fff', fontSize: 14 },
  err: { position: 'absolute', color: '#fff', backgroundColor: 'rgba(200,40,30,0.85)', padding: 8, borderRadius: 8, fontSize: 12, overflow: 'hidden' },
  dev: { position: 'absolute', width: 210, backgroundColor: 'rgba(5,9,10,0.7)', borderRadius: 12, padding: 8, gap: 6 },
  devText: { color: '#C8F04A', fontSize: 11 },
  devBtn: { flex: 1, minHeight: 36 },
  actions: { position: 'absolute', width: 160, gap: 8 },
});
