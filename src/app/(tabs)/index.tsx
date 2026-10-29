import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listMatches, type MatchRecord } from '../../db/matches';
import { describeMatch, formatClock, resultLine } from '../../engine/format';
import { Button, Card, Label } from '../../components/ui';
import { colors } from '../../theme';

export default function Matches() {
  const insets = useSafeAreaInsets();
  const [matches, setMatches] = useState<MatchRecord[] | null>(null);
  useFocusEffect(useCallback(() => { listMatches().then(setMatches); }, []));

  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 24, gap: 10 }}>
      <View style={s.head}>
        <Text style={s.title}>Matches</Text>
        <Button label="+ New match" onPress={() => router.navigate('/new')} style={{ minHeight: 40, paddingHorizontal: 14 }} />
      </View>
      {matches === null ? null : matches.length === 0 ? (
        <Card>
          <Text style={s.emptyTitle}>No matches yet</Text>
          <Text style={s.muted}>Set the phone on a tripod behind the court, then start a match. The score is kept for you.</Text>
        </Card>
      ) : (
        <>
          <Label>Recent</Label>
          {matches.map((m) => (
            <Pressable key={m.id} onPress={() => router.push(`/match/${m.id}`)}>
              <Card style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{describeMatch(m.state)}</Text>
                  <Text style={s.muted}>
                    {new Date(m.createdAt).toLocaleDateString()} · {m.state.config.type}
                    {m.durationMs ? ` · ${formatClock(m.durationMs)}` : ''}
                  </Text>
                </View>
                <Text style={[s.result, { color: m.state.matchWinner === 'B' ? colors.red : colors.green }]}>{resultLine(m.state)}</Text>
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
  title: { color: colors.text, fontSize: 32, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: 13, marginTop: 2 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  result: { fontSize: 24, fontWeight: '700' },
});
