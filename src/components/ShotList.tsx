import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import type { ShotRecord } from '../analysis/overlay';
import { unpackPose } from '../analysis/pose';
import { stickFigure } from '../analysis/stickman';
import { colors, radius } from '../theme';

const FIG_W = 64;
const FIG_H = 96;
const MAP_W = 52;
const MAP_H = 96;

/** A stick figure of the hit. */
export function Stickman({ pose, color = colors.text, width = FIG_W, height = FIG_H }: { pose: number[]; color?: string; width?: number; height?: number }) {
  const p = unpackPose(pose);
  const fig = p ? stickFigure(p, width, height) : null;
  if (!fig) return <View style={{ width, height }} />;
  return (
    <Svg width={width} height={height}>
      {fig.lines.map((l, i) => <Line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={color} strokeWidth={2.5} strokeLinecap="round" />)}
      {fig.head && <Circle cx={fig.head.cx} cy={fig.head.cy} r={fig.head.r} stroke={color} strokeWidth={2.5} fill="none" />}
    </Svg>
  );
}

/** The court from above, the net across the middle, with the shot drawn from where it was hit to where it went. */
export function ShotPath({ from, to, color, width = MAP_W, height = MAP_H }: { from: ShotRecord['from']; to: ShotRecord['to']; color: string; width?: number; height?: number }) {
  const m = 4;
  const X = (u: number) => m + Math.min(1, Math.max(0, u)) * (width - 2 * m);
  const Y = (v: number) => m + Math.min(1, Math.max(0, v)) * (height - 2 * m);
  return (
    <Svg width={width} height={height}>
      <Rect x={m} y={m} width={width - 2 * m} height={height - 2 * m} stroke={colors.line} strokeWidth={1.5} fill="none" />
      <Line x1={m - 2} y1={height / 2} x2={width - m + 2} y2={height / 2} stroke={colors.muted} strokeWidth={1.5} />
      {from && to && <Path d={`M ${X(from.u)} ${Y(from.v)} L ${X(to.u)} ${Y(to.v)}`} stroke={color} strokeWidth={2} strokeDasharray="4 3" fill="none" />}
      {to && <Circle cx={X(to.u)} cy={Y(to.v)} r={3} fill={color} />}
      {from && <Circle cx={X(from.u)} cy={Y(from.v)} r={4} fill={colors.text} stroke={color} strokeWidth={2} />}
    </Svg>
  );
}

/** The shots of a game, each with its stick figure and where it went. Tapping one jumps the video to it. */
export function ShotList({ shots, names, colorOf, onSeek }: { shots: ShotRecord[]; names: string[]; colorOf: (player: number) => string; onSeek?: (ms: number) => void }) {
  return (
    <View style={{ gap: 8 }}>
      {shots.map((sh, i) => {
        const color = sh.player != null ? colorOf(sh.player) : colors.muted;
        const bits = [
          sh.player != null ? names[sh.player] : null,
          sh.kmh ? `${sh.kmh} km/h` : null,
          sh.metres ? `${sh.metres} m` : null,
        ].filter(Boolean).join(' · ');
        return (
          <Pressable key={i} onPress={() => onSeek?.(Math.max(0, sh.t - 1500))} accessibilityRole="button" style={s.row}>
            {sh.pose ? <Stickman pose={sh.pose} color={color} /> : <View style={{ width: FIG_W, height: FIG_H, alignItems: 'center', justifyContent: 'center' }}><Text style={s.none}>no pose</Text></View>}
            <ShotPath from={sh.from} to={sh.to} color={color} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[s.type, { color }]}>{sh.type}{sh.confidence < 0.5 ? ' ?' : ''}</Text>
              <Text style={s.muted}>Shot {sh.number}{bits ? ` · ${bits}` : ''}</Text>
              <Text style={s.muted}>{sh.height ? `hit ${sh.height === 'overhead' ? 'above the head' : sh.height === 'low' ? 'low' : 'at the side'}` : 'from position and speed only'}{sh.confidence < 0.5 ? ' · a guess' : ''}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: radius.md, padding: 8 },
  type: { fontSize: 18, fontWeight: '800' },
  muted: { color: colors.muted, fontSize: 12 },
  none: { color: colors.muted, fontSize: 11 },
});
