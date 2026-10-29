import { StyleSheet, Text, View } from 'react-native';
import { currentGame, gamesWon, serverName } from '../engine/scoring';
import type { MatchState } from '../engine/types';
import { colors, radius } from '../theme';

export function ScoreBoard({ state }: { state: MatchState }) {
  const g = currentGame(state);
  const w = gamesWon(state);
  const { A, B } = state.config.players;
  const serving = state.serve.side;
  const multi = state.config.bestOf > 1;
  return (
    <View style={s.wrap}>
      <View style={s.row}>
        <Side name={A.join(' & ')} score={g.A} games={multi ? w.A : undefined} serving={serving === 'A'} align="left" />
        <View style={s.mid}>
          <Text style={s.midText}>{serving === 'A' ? '◀ serving' : 'serving ▶'}</Text>
        </View>
        <Side name={B.join(' & ')} score={g.B} games={multi ? w.B : undefined} serving={serving === 'B'} align="right" />
      </View>
      <Text style={s.server}>
        {state.matchWinner ? 'Match over' : `${serverName(state)} serves from the ${state.serve.court} court`}
      </Text>
    </View>
  );
}

function Side({ name, score, games, serving, align }: { name: string; score: number; games?: number; serving: boolean; align: 'left' | 'right' }) {
  return (
    <View style={[s.side, { alignItems: align === 'left' ? 'flex-start' : 'flex-end' }]}>
      <Text numberOfLines={1} style={[s.name, serving && { color: colors.text }]}>{name}</Text>
      <Text style={s.score}>{score}</Text>
      {games != null && <Text style={s.games}>Games {games}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: 'rgba(5,9,10,0.78)', borderRadius: radius.lg, paddingVertical: 8, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center' },
  side: { flex: 1 },
  name: { color: '#B7C5BE', fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  score: { color: '#fff', fontSize: 40, fontWeight: '700', lineHeight: 44 },
  games: { color: '#B7C5BE', fontSize: 11 },
  mid: { paddingHorizontal: 10 },
  midText: { color: '#B7C5BE', fontSize: 11, fontWeight: '600' },
  server: { color: '#B7C5BE', fontSize: 11, textAlign: 'center', marginTop: 2 },
});
