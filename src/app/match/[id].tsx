import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { courtMap, defaultCorners } from '../../analysis/court';
import { cornersInBox, snapshotAt, stateAt, type OverlayData } from '../../analysis/overlay';
import { deleteMatch, getMatch, getOverlay, saveRallies, type MatchRecord } from '../../db/matches';
import { editRally, otherSide, sideLabel } from '../../engine/scoring';
import { describeMatch, formatClock, gameScores, resultLine } from '../../engine/format';
import { longestRun, progression, rallyStats } from '../../engine/stats';
import { Button, Card, Label, Stat } from '../../components/ui';
import { MatchOverlay } from '../../components/MatchOverlay';
import { ScoreChart } from '../../components/ScoreChart';
import { colors } from '../../theme';

export default function MatchReview() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [match, setMatch] = useState<MatchRecord | null>(null);
  const reload = useCallback(() => { getMatch(id).then(setMatch); }, [id]);
  useEffect(reload, [reload]);

  const player = useVideoPlayer(match?.videoUri ?? null);

  // The overlay saved while recording is drawn over the video again, in step with the playback time.
  const { width: screenW } = useWindowDimensions();
  const [overlay, setOverlay] = useState<OverlayData | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [playMs, setPlayMs] = useState(0);
  useEffect(() => { getOverlay(id).then(setOverlay); }, [id]);
  useEffect(() => {
    const timer = setInterval(() => setPlayMs(player.currentTime * 1000), 200);
    return () => clearInterval(timer);
  }, [player]);

  if (!match) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  const { state } = match;
  const stats = rallyStats(state);
  const run = longestRun(state);

  const flip = async (i: number) => {
    const next = editRally(state, i, { winner: otherSide(state.rallies[i].winner), source: 'manual' });
    await saveRallies(match.id, next.rallies);
    reload();
  };
  const jump = (ms?: number) => {
    if (match.videoUri && ms != null) { player.currentTime = ms / 1000; player.play(); }
  };
  const remove = async () => { await deleteMatch(match.id); router.back(); };

  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 12 }}>
      <Pressable onPress={() => router.back()}><Text style={s.back}>‹ Back</Text></Pressable>
      <View>
        <Text style={s.title}>{describeMatch(state)}</Text>
        <Text style={s.muted}>{new Date(match.createdAt).toLocaleString()}{match.venueName ? ` · ${match.venueName}` : ''} · {resultLine(state)} {state.config.bestOf > 1 ? `(${gameScores(state)})` : ''}</Text>
      </View>

      {match.videoUri && overlay ? (
        <>
          <Pressable onPress={() => setShowOverlay((v) => !v)} accessibilityRole="button">
            <Text style={s.toggle}>Overlay: {showOverlay ? 'on' : 'off'} (tap to switch)</Text>
          </Pressable>
          {(() => {
            const boxW = screenW - 32;
            const canvasW = 780;
            const canvasH = canvasW / overlay.frameAspect;
            const k = boxW / canvasW;
            const { A, B } = state.config.players;
            const names = [...A, ...B];
            const nNear = A.length;
            const snap = snapshotAt(overlay.snapshots, playMs);
            const colorOf = (i: number) => (i < nNear ? colors.near[i] : colors.far[i - nNear]);
            const map = courtMap(cornersInBox(overlay.corners ?? defaultCorners(1, 1), canvasW, canvasH));
            return (
              <View style={{ width: boxW, height: boxW / overlay.frameAspect, borderRadius: 14, overflow: 'hidden', backgroundColor: '#000' }}>
                <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="contain" />
                {showOverlay && (
                  <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: canvasW, height: canvasH, transformOrigin: 'top left', transform: [{ scale: k }] }}>
                    <MatchOverlay
                      width={canvasW}
                      height={canvasH}
                      inset={{ l: 12, r: 12, t: 10, b: 12 }}
                      map={map}
                      tracks={snap?.tracks ?? []}
                      tagFor={(tid) => { const p = snap?.assign[tid] ?? tid; return { name: names[p] ?? '', color: colorOf(p) }; }}
                      state={stateAt(state.config, state.rallies, playMs)}
                      distanceRows={names.map((name, i) => ({ name, color: colorOf(i), metres: snap?.dist[i] ?? null }))}
                      shuttle={snap?.shuttle ?? null}
                      mapTop={10}
                    />
                  </View>
                )}
              </View>
            );
          })()}
        </>
      ) : match.videoUri ? (
        <VideoView player={player} style={s.video} nativeControls contentFit="contain" />
      ) : (
        <Card><Text style={s.muted}>No video was saved for this match.</Text></Card>
      )}

      <View style={s.row}>
        <Stat value={String(stats.count)} label="rallies" />
        <Stat value={stats.avgSeconds ? `${stats.avgSeconds.toFixed(1)}s` : '–'} label="average rally" />
        <Stat value={run ? String(run.length) : '–'} label="best run" />
      </View>

      {progression(state).map((p) => (
        <Card key={p.game}>
          <Label>Game {p.game} score</Label>
          <ScoreChart data={p} />
        </Card>
      ))}

      <Label>Every point · tap a time to jump there</Label>
      {state.rallies.map((r, i) => {
        const flagged = r.source === 'auto' && (r.confidence ?? 1) < 0.6;
        return (
          <Card key={i} style={[s.rally, flagged && { borderColor: colors.amber }]}>
            <Text style={s.num}>{i + 1}</Text>
            <Pressable style={{ flex: 1 }} onPress={() => jump(r.startMs)}>
              <Text style={s.who}>{sideLabel(state.config, r.winner)} won the point</Text>
              <Text style={s.muted}>
                {r.startMs != null ? formatClock(r.startMs) : '–'}
                {r.shots != null ? ` · ${r.shots} shots` : ''}
                {flagged ? ' · check this one' : ''}
              </Text>
            </Pressable>
            <Pressable onPress={() => flip(i)} accessibilityRole="button" accessibilityLabel="Change who won this point"><Text style={s.fix}>Change</Text></Pressable>
          </Card>
        );
      })}
      <Button kind="ghost" label="Delete game" onPress={remove} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  toggle: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  back: { color: colors.muted, fontSize: 16 },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 13 },
  video: { width: '100%', aspectRatio: 9 / 16, maxHeight: 420, borderRadius: 14, backgroundColor: '#000' },
  row: { flexDirection: 'row', gap: 8 },
  rally: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  num: { color: colors.muted, fontSize: 18, fontWeight: '700', width: 28 },
  who: { color: colors.text, fontSize: 14, fontWeight: '600' },
  fix: { color: colors.accent, fontWeight: '600', fontSize: 13 },
});
