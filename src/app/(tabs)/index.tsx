import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listMatches, type MatchRecord } from '../../db/matches';
import { describeMatch, formatClock, resultLine } from '../../engine/format';
import { Button, Card, Label } from '../../components/ui';
import { useSettings } from '../../settings';
import { colors } from '../../theme';

export default function Matches() {
  const insets = useSafeAreaInsets();
  const [matches, setMatches] = useState<MatchRecord[] | null>(null);
  const settings = useSettings();
  // First launch: show how it works once
  useEffect(() => {
    if (settings.ready && !settings.guideSeen) router.push('/guide');
  }, [settings.ready, settings.guideSeen]);
  useFocusEffect(useCallback(() => { listMatches().then(setMatches); }, []));

  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 24, gap: 10 }}>
      <View style={s.head}>
        <Text style={s.title}>Matches</Text>
        <Pressable onPress={() => router.push('/settings')} accessibilityRole="button" accessibilityLabel="Settings" hitSlop={10}>
          <Text style={s.gear}>Settings</Text>
        </Pressable>
        <Button label="+ New match" onPress={() => router.navigate('/new')} style={{ minHeight: 40, paddingHorizontal: 14 }} />
      </View>
      {matches === null ? null : matches.length === 0 ? (
        <Card>
          <Text style={s.emptyTitle}>No games yet</Text>
          <Text style={s.muted}>Set the phone on a tripod behind the court, then start a game. The score is kept for you, and recording stops when someone reaches 21.</Text>
        </Card>
      ) : (
        <>
          <Label>Recent games</Label>
          {matches.map((m) => (
            <Pressable key={m.id} onPress={() => router.push(`/match/${m.id}`)}>
              <Card style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{describeMatch(m.state)}</Text>
                  <Text style={s.muted}>
                    {new Date(m.createdAt).toLocaleDateString()} · {m.state.matchWinner ? 'Game' : 'Unfinished game'} · {m.state.config.type}{m.venueName ? ` · ${m.venueName}` : ''}
                    {m.durationMs ? ` · ${formatClock(m.durationMs)}` : ''}
                  </Text>
                </View>
                <Text style={[s.result, { color: m.state.matchWinner === 'A' ? colors.green : m.state.matchWinner === 'B' ? colors.red : colors.muted }]}>{resultLine(m.state)}</Text>
              </Card>
            </Pressable>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  gear: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  title: { color: colors.text, fontSize: 32, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: 13, marginTop: 2 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  result: { fontSize: 24, fontWeight: '700' },
});
