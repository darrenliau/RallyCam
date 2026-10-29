import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import type { Track } from '../analysis/players';
import type { ShuttleStats } from '../analysis/shuttle';
import type { TagInfo } from './PlayerOverlay';

export function DistanceCard({ rows }: { rows: { name: string; color: string; metres: number | null }[] }) {
  return (
    <View style={s.card}>
      <Text style={s.label}>Distance covered</Text>
      {rows.map((r) => (
        <View key={r.name} style={s.row}>
          <View style={[s.dot, { backgroundColor: r.color }]} />
          <Text numberOfLines={1} style={s.name}>{r.name}</Text>
          <Text style={s.value}>{r.metres == null ? '–' : `~${Math.round(r.metres)} m`}</Text>
        </View>
      ))}
    </View>
  );
}

/** Top-down court with one dot per tracked player. Far end of the court is at the top. */
export function CourtMapCard({ tracks, tagFor }: { tracks: Track[]; tagFor: (id: number) => TagInfo }) {
  return (
    <View style={[s.card, { width: 104 }]}>
      <Text style={s.label}>Court map</Text>
      <Svg viewBox="0 0 80 108" width="100%" style={{ aspectRatio: 80 / 108, marginTop: 4 }}>
        <Rect x={6} y={4} width={68} height={100} fill="none" stroke="#6F8279" />
        <Line x1={6} y1={54} x2={74} y2={54} stroke="#6F8279" strokeDasharray="2 2" />
        <Line x1={12} y1={4} x2={12} y2={104} stroke="#6F8279" strokeDasharray="2 2" />
        <Line x1={68} y1={4} x2={68} y2={104} stroke="#6F8279" strokeDasharray="2 2" />
        {tracks.map((t) => (
          <Circle key={t.id} cx={6 + t.u * 68} cy={4 + t.v * 100} r={4} fill={tagFor(t.id).color} stroke="#0B1210" />
        ))}
      </Svg>
    </View>
  );
}

/** Shuttle speed and shot count. Shows dashes, with the reason, until a shuttle tracker is feeding it. */
export function ShuttleCards({ stats }: { stats: ShuttleStats | null }) {
  return (
    <View style={{ gap: 6, width: 168 }}>
      <View style={s.card}>
        <Text style={s.label}>Shuttle speed</Text>
        <Text style={s.big}>
          {stats ? `~${stats.speedKmh}` : '–'}
          <Text style={s.unit}> km/h</Text>
        </Text>
        <Text style={s.caption}>{stats ? 'last shot · estimate' : 'needs shuttle tracking'}</Text>
      </View>
      <View style={s.card}>
        <Text style={s.label}>Shots this rally</Text>
        <Text style={s.big}>{stats ? String(stats.shots).padStart(2, '0') : '–'}</Text>
        {stats?.lastShot && (
          <Text style={s.shot}>{stats.lastShot.type} <Text style={s.caption}>{stats.lastShot.player} · shot {stats.lastShot.number}</Text></Text>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  big: { color: '#fff', fontSize: 28, fontWeight: '700', lineHeight: 32 },
  unit: { color: '#C8F04A', fontSize: 12, fontWeight: '600' },
  caption: { color: '#8FA198', fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase' },
  shot: { color: '#C8F04A', fontSize: 14, fontWeight: '700' },
  card: { backgroundColor: 'rgba(8,14,12,0.84)', borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderRadius: 12, padding: 8 },
  label: { color: '#C6D3CC', fontSize: 10, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { flex: 1, color: '#fff', fontSize: 13, minWidth: 60 },
  value: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
