import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listMatches, type MatchRecord } from '../../db/matches';
import { longestRun, rallyStats } from '../../engine/stats';
import { Card, Stat } from '../../components/ui';
import { colors } from '../../theme';

export default function Stats() {
  const insets = useSafeAreaInsets();
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  useFocusEffect(useCallback(() => { listMatches().then(setMatches); }, []));

  const done = matches.filter((m) => m.state.matchWinner);
  const wins = done.filter((m) => m.state.matchWinner === 'A').length;
  const rallies = matches.flatMap((m) => m.state.rallies);
  const timed = rallies.filter((r) => r.startMs != null && r.endMs != null);
  const avg = timed.length ? timed.reduce((t, r) => t + (r.endMs! - r.startMs!), 0) / timed.length / 1000 : undefined;
  const bestRun = Math.max(0, ...matches.map((m) => longestRun(m.state)?.length ?? 0));
  const needsCheck = matches.reduce((t, m) => t + rallyStats(m.state).needsCheck, 0);

  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 24, gap: 10 }}>
      <Text style={s.title}>Stats</Text>
      {matches.length === 0 ? (
        <Card><Text style={s.muted}>Play a game and your numbers show up here.</Text></Card>
      ) : (
        <>
          <View style={s.row}>
            <Stat value={String(matches.length)} label="games" />
            <Stat value={`${wins}–${done.length - wins}`} label="win / loss" />
          </View>
          <View style={s.row}>
            <Stat value={avg ? `${avg.toFixed(1)}s` : '–'} label="avg time per point" />
            <Stat value={String(bestRun)} label="best points in a row" />
          </View>
          {needsCheck > 0 && <Card><Text style={s.muted}>{needsCheck} automatically scored points are marked for you to check.</Text></Card>}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  title: { color: colors.text, fontSize: 32, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 10 },
  muted: { color: colors.muted, fontSize: 14 },
});
