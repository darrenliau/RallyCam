import { useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { dragTo, handlePosition, startDrag, type DragState } from '../analysis/alignerDrag';
import type { Corners, Pt } from '../analysis/court';
import { colors } from '../theme';

type Key = keyof Corners;
const KEYS: Key[] = ['farLeft', 'farRight', 'nearRight', 'nearLeft'];
const SIZE = 44;

function Handle({ corner, width, height, onMove }: { corner: Pt; width: number; height: number; onMove: (p: Pt) => void }) {
  const drag = useRef<DragState>(startDrag(corner, width, height));
  const latest = useRef({ corner, width, height, onMove });
  latest.current = { corner, width, height, onMove };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { const l = latest.current; drag.current = startDrag(l.corner, l.width, l.height); },
      onPanResponderMove: (_, g) => {
        const l = latest.current;
        const r = dragTo(drag.current, g.dx, g.dy, l.width, l.height);
        drag.current = r.state;
        l.onMove(r.corner);
      },
    }),
  ).current;
  // A corner off the screen (a wide lens or a camera close to the court) is drawn on the screen edge, dashed; dragging it moves it further.
  const { at, offScreen } = handlePosition(corner, width, height);
  return (
    <View {...pan.panHandlers} style={[s.handle, { left: at.x - SIZE / 2, top: at.y - SIZE / 2 }]} accessibilityLabel={offScreen ? 'Court corner off the screen. Drag to move it.' : 'Drag to a court corner'}>
      <View style={[s.knob, offScreen && s.knobOff]} />
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
        <Handle key={k} corner={corners[k]} width={width} height={height} onMove={(p) => onChange({ ...corners, [k]: p })} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  handle: { position: 'absolute', width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  knob: { width: 22, height: 22, borderRadius: 11, borderWidth: 3, borderColor: colors.near[0], backgroundColor: 'rgba(0,0,0,0.35)' },
  knobOff: { width: 30, height: 30, borderRadius: 15, borderStyle: 'dashed', backgroundColor: 'rgba(200,240,74,0.25)' },
});
