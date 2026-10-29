import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import type { Progression } from '../engine/stats';
import { colors } from '../theme';

const W = 320;
const H = 130;

/** Running score for one game: green is side A, amber is side B. */
export function ScoreChart({ data }: { data: Progression }) {
  const n = Math.max(1, data.A.length - 1);
  const max = Math.max(21, ...data.A, ...data.B);
  const x = (i: number) => 24 + (i * (W - 40)) / n;
  const y = (v: number) => H - 15 - (v * (H - 30)) / max;
  const line = (a: number[]) => a.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  const ticks = [0, 7, 14, 21].filter((t) => t <= max);
  return (
    <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={undefined} style={{ aspectRatio: W / H }}>
      {ticks.map((t) => (
        <Line key={t} x1={24} x2={W - 16} y1={y(t)} y2={y(t)} stroke={colors.line} />
      ))}
      {ticks.map((t) => (
        <SvgText key={`l${t}`} x={16} y={y(t) + 3} fontSize={9} fill={colors.muted} textAnchor="end">{t}</SvgText>
      ))}
      <Path d={line(data.B)} stroke={colors.amber} strokeWidth={2} fill="none" />
      <Path d={line(data.A)} stroke={colors.green} strokeWidth={2.5} fill="none" />
    </Svg>
  );
}
