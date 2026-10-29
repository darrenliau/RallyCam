import { useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import type { Corners, Pt } from '../analysis/court';
import { colors } from '../theme';

type Key = keyof Corners;
const KEYS: Key[] = ['farLeft', 'farRight', 'nearRight', 'nearLeft'];
const SIZE = 44;

function Handle({ at, onMove }: { at: Pt; onMove: (p: Pt) => void }) {
  const start = useRef(at);
  const latest = useRef({ at, onMove });
  latest.current = { at, onMove };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { start.current = latest.current.at; },
      onPanResponderMove: (_, g) => latest.current.onMove({ x: start.current.x + g.dx, y: start.current.y + g.dy }),
    }),
  ).current;
  return (
    <View {...pan.panHandlers} style={[s.handle, { left: at.x - SIZE / 2, top: at.y - SIZE / 2 }]} accessibilityLabel="Drag to a court corner">
      <View style={s.knob} />
    </View>
  );
}

/** Four draggable corners. The user lines them up with the outer corners of the doubles court. */
export function CourtAligner({ corners, onChange, width, height }: { corners: Corners; onChange: (c: Corners) => void; width: number; height: number }) {
  const points = KEYS.map((k) => `${corners[k].x},${corners[k].y}`).join(' ');
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Polygon points={points} fill="rgba(200,240,74,0.12)" stroke={colors.near[0]} strokeWidth={2} />
      </Svg>
      {KEYS.map((k) => (
        <Handle key={k} at={corners[k]} onMove={(p) => onChange({ ...corners, [k]: p })} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  handle: { position: 'absolute', width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  knob: { width: 22, height: 22, borderRadius: 11, borderWidth: 3, borderColor: colors.near[0], backgroundColor: 'rgba(0,0,0,0.35)' },
});
