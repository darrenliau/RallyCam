import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deleteMatch, getMatch, saveRallies, type MatchRecord } from '../../db/matches';
import { editRally, otherSide, sideLabel } from '../../engine/scoring';
import { describeMatch, formatClock, gameScores, resultLine } from '../../engine/format';
import { longestRun, progression, rallyStats } from '../../engine/stats';
import { Button, Card, Label, Stat } from '../../components/ui';
import { ScoreChart } from '../../components/ScoreChart';
import { colors } from '../../theme';

export default function MatchReview() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [match, setMatch] = useState<MatchRecord | null>(null);
  const reload = useCallback(() => { getMatch(id).then(setMatch); }, [id]);
  useEffect(reload, [reload]);

  const player = useVideoPlayer(match?.videoUri ?? null);

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
        <Text style={s.muted}>{new Date(match.createdAt).toLocaleString()} · {resultLine(state)} {state.config.bestOf > 1 ? `(${gameScores(state)})` : ''}</Text>
      </View>

      {match.videoUri ? (
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
      <Button kind="ghost" label="Delete match" onPress={remove} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
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
