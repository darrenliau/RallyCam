import * as Haptics from 'expo-haptics';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { courtMap, defaultCorners, type Corners } from '../analysis/court';
import { DistanceMeter, SimulatedTracker, type Track } from '../analysis/players';
import { CourtAligner } from '../components/CourtAligner';
import { PlayerOverlay, type TagInfo } from '../components/PlayerOverlay';
import { CourtMapCard, DistanceCard } from '../components/StatCards';
import { Button } from '../components/ui';
import { ScoreBoard } from '../components/ScoreBoard';
import { createMatch, finishMatch, saveRallies } from '../db/matches';
import { addRally, newMatch, undoLast } from '../engine/scoring';
import { formatClock } from '../engine/format';
import type { MatchConfig, MatchState, Side } from '../engine/types';
import { colors } from '../theme';

// Remembered between matches in this session so the user does not re-align every time.
let savedCorners: Corners | null = null;

export default function Record() {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { config: raw } = useLocalSearchParams<{ config: string }>();
  const config = useRef<MatchConfig>(JSON.parse(raw)).current;

  const [camPerm, askCam] = useCameraPermissions();
  const [micPerm, askMic] = useMicrophonePermissions();
  const camera = useRef<CameraView>(null);
  const recording = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const matchId = useRef<Promise<string>>(createMatch(config));
  const startedAt = useRef(0);
  const lastEnd = useRef(0);

  const [state, setState] = useState<MatchState>(() => newMatch(config));
  const [elapsed, setElapsed] = useState(0);
  const [recError, setRecError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);

  // Court alignment and player tags
  const [corners, setCorners] = useState<Corners>(() => savedCorners ?? defaultCorners(width, height));
  const [aligning, setAligning] = useState(true);
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

  const lockCourt = () => { savedCorners = corners; setAligning(false); };
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

  const startRecording = useCallback(() => {
    if (recording.current) return;
    startedAt.current = Date.now();
    recording.current = camera.current?.recordAsync().catch((e: Error) => { setRecError(e.message); return undefined; }) ?? null;
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
    camera.current?.stopRecording();
    const result = await recording.current;
    const id = await matchId.current;
    await finishMatch(id, result?.uri ?? null, Date.now() - startedAt.current);
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

  return (
    <View style={s.fill}>
      <CameraView ref={camera} style={StyleSheet.absoluteFill} mode="video" facing="back" onCameraReady={startRecording} />
      {aligning ? (
        <CourtAligner corners={corners} onChange={setCorners} width={width} height={height} />
      ) : (
        <PlayerOverlay map={map} width={width} height={height} tracks={tracks} tagFor={tagFor} selected={selected} onTagPress={onTagPress} />
      )}
      <View style={[s.top, { top: insets.top + 8 }]} pointerEvents="box-none">
        <View style={s.chipRow}>
          <View style={s.chip}>
            <View style={s.dot} />
            <Text style={s.chipText}>{recError ? 'Not recording' : formatClock(elapsed)}</Text>
          </View>
          {!aligning && (
            <Text style={s.chip2} onPress={() => setAligning(true)} accessibilityRole="button">Re-align court</Text>
          )}
        </View>
        <ScoreBoard state={state} />
        {recError && <Text style={s.err}>Recording failed: {recError}</Text>}
        {__DEV__ && (
          <View style={s.dev}>
            <Text style={s.devText}>Dev only. Automatic scoring is not built yet.</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button kind="ghost" label="Point: near" onPress={() => onPoint('A')} style={s.devBtn} />
              <Button kind="ghost" label="Point: far" onPress={() => onPoint('B')} style={s.devBtn} />
            </View>
            <Button kind="ghost" label={simulating ? 'Stop simulated players' : 'Simulate players'} onPress={toggleSimulation} style={s.devBtn} />
          </View>
        )}
      </View>
      {aligning && (
        <View style={[s.banner, { bottom: insets.bottom + 96 }]}>
          <Text style={s.bannerText}>Drag the four dots onto the outer corners of the court, then lock it in.</Text>
          <Button label="Lock court" onPress={lockCourt} />
        </View>
      )}
      {!aligning && tracks.length > 0 && (
        <View style={[s.cards, { bottom: insets.bottom + 84 }]} pointerEvents="none">
          <DistanceCard rows={names.map((name, i) => ({ name, color: colorOf(i), metres: meter.metres(i) }))} />
          <CourtMapCard tracks={tracks} tagFor={tagFor} />
        </View>
      )}
      <View style={[s.bottom, { paddingBottom: insets.bottom + 12 }]}>
        <Button kind="ghost" label="Fix last point" onPress={onUndo} disabled={state.rallies.length === 0} style={{ flex: 1 }} />
        <Button label={state.matchWinner ? 'Finish' : 'End match'} onPress={endMatch} disabled={ending} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  center: { justifyContent: 'center' },
  h: { color: colors.text, fontSize: 22, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 14 },
  top: { position: 'absolute', left: 12, right: 12, gap: 8 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip2: { color: '#fff', fontSize: 12, fontWeight: '600', backgroundColor: 'rgba(5,9,10,0.62)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden' },
  banner: { position: 'absolute', left: 16, right: 16, gap: 10, backgroundColor: 'rgba(5,9,10,0.85)', borderRadius: 16, padding: 14 },
  bannerText: { color: '#fff', fontSize: 14 },
  cards: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8 },
  chip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(5,9,10,0.62)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  chipText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  err: { color: '#fff', backgroundColor: 'rgba(200,40,30,0.85)', padding: 8, borderRadius: 8, fontSize: 12 },
  dev: { backgroundColor: 'rgba(5,9,10,0.7)', borderRadius: 12, padding: 8, gap: 6 },
  devText: { color: '#C8F04A', fontSize: 11 },
  devBtn: { flex: 1, minHeight: 40 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12 },
});
