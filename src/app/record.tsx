import * as Haptics from 'expo-haptics';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/ui';
import { ScoreBoard } from '../components/ScoreBoard';
import { createMatch, finishMatch, saveRallies } from '../db/matches';
import { addRally, newMatch, undoLast } from '../engine/scoring';
import { formatClock } from '../engine/format';
import type { MatchConfig, MatchState, Side } from '../engine/types';
import { colors } from '../theme';

export default function Record() {
  useKeepAwake();
  const insets = useSafeAreaInsets();
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
      <View style={[s.top, { top: insets.top + 8 }]}>
        <View style={s.chip}>
          <View style={s.dot} />
          <Text style={s.chipText}>{recError ? 'Not recording' : formatClock(elapsed)}</Text>
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
          </View>
        )}
      </View>
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
  chip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(5,9,10,0.62)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  chipText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  err: { color: '#fff', backgroundColor: 'rgba(200,40,30,0.85)', padding: 8, borderRadius: 8, fontSize: 12 },
  dev: { backgroundColor: 'rgba(5,9,10,0.7)', borderRadius: 12, padding: 8, gap: 6 },
  devText: { color: '#C8F04A', fontSize: 11 },
  devBtn: { flex: 1, minHeight: 40 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12 },
});
