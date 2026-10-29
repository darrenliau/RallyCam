import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Ellipse, Line } from 'react-native-svg';
import { COURT_LINES, type CourtMap } from '../analysis/court';
import type { Track } from '../analysis/players';

export interface TagInfo { name: string; color: string }

/**
 * Court outline, a ring under each tracked player's feet and a name tag above them.
 * Rings and tags are sized from the camera perspective, so players near the camera look bigger.
 */
export function PlayerOverlay({
  map, width, height, tracks, tagFor, selected, onTagPress, showCourt = true,
}: {
  map: CourtMap; width: number; height: number; tracks: Track[];
  tagFor: (trackId: number) => TagInfo; selected: number | null; onTagPress: (trackId: number) => void; showCourt?: boolean;
}) {
  const placed = tracks.map((t) => {
    const foot = map.toScreen(t.u, t.v);
    const l = map.toScreen(t.u - 0.045, t.v);
    const r = map.toScreen(t.u + 0.045, t.v);
    const rx = Math.max(8, Math.abs(r.x - l.x) / 2);
    return { t, foot, rx, tag: tagFor(t.id) };
  });
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        {showCourt && COURT_LINES.map(([a, b], i) => {
          const p = map.toScreen(a[0], a[1]);
          const q = map.toScreen(b[0], b[1]);
          return <Line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#fff" strokeOpacity={0.55} strokeWidth={1.2} />;
        })}
        {placed.map(({ t, foot, rx, tag }) => (
          <Ellipse key={t.id} cx={foot.x} cy={foot.y} rx={rx} ry={rx * 0.34} stroke={tag.color} strokeWidth={2.5} fill="none" />
        ))}
      </Svg>
      {placed.map(({ t, foot, rx, tag }) => (
        <Pressable
          key={t.id}
          accessibilityRole="button"
          accessibilityLabel={`${tag.name} tag. Tap, then tap another tag to swap players.`}
          onPress={() => onTagPress(t.id)}
          style={[s.tag, { left: foot.x - 50, top: foot.y - rx * 2.6 - 24, borderLeftColor: tag.color }, selected === t.id && s.sel]}
        >
          <Text numberOfLines={1} style={s.tagText}>{tag.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  tag: { position: 'absolute', width: 100, alignItems: 'center', paddingVertical: 3, borderRadius: 6, borderLeftWidth: 4, backgroundColor: 'rgba(5,9,10,0.85)' },
  sel: { backgroundColor: '#fff' },
  tagText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
