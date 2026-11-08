import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Ellipse, Line } from 'react-native-svg';
import { COURT_LINES, type CourtMap } from '../analysis/court';
import type { Track } from '../analysis/players';

export interface TagInfo { name: string; color: string }

/**
 * Court outline and a ring under each tracked player's feet (no name tags: they crowd the picture).
 * Rings are sized from the camera perspective, so players near the camera look bigger.
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
        // No name on the picture. The ring and the body above it are a tap target: tap one player, then another, to swap who is who.
        <Pressable
          key={t.id}
          accessibilityRole="button"
          accessibilityLabel={`${tag.name}. Tap, then tap another player to swap them.`}
          onPress={() => onTagPress(t.id)}
          style={{ position: 'absolute', left: foot.x - rx - 10, top: foot.y - rx * 2.6 - 14, width: 2 * rx + 20, height: rx * 2.6 + rx * 0.34 + 28 }}
        >
          {selected === t.id && (
            // only the player you picked shows a name, so you can see who you are about to swap
            <View style={[s.chip, { borderLeftColor: tag.color, left: rx + 10 - 50, top: -26 }]}>
              <Text numberOfLines={1} style={s.chipText}>{tag.name}</Text>
            </View>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  chip: { position: 'absolute', width: 100, alignItems: 'center', paddingVertical: 3, borderRadius: 6, borderLeftWidth: 4, backgroundColor: '#fff' },
  chipText: { color: '#05090A', fontSize: 12, fontWeight: '700' },
});
