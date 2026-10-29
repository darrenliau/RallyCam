import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, space } from '../theme';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Button({
  label, onPress, kind = 'primary', disabled, style,
}: { label: string; onPress: () => void; kind?: 'primary' | 'ghost'; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.btn, kind === 'primary' ? s.btnPrimary : s.btnGhost, (pressed || disabled) && { opacity: 0.6 }, style]}
    >
      <Text style={s.btnText}>{label}</Text>
    </Pressable>
  );
}

export const Label = ({ children }: { children: ReactNode }) => <Text style={s.label}>{children}</Text>;

export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <Card style={{ flex: 1 }}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </Card>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: radius.lg, padding: space.md },
  btn: { minHeight: 52, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  btnPrimary: { backgroundColor: colors.accent },
  btnGhost: { backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  label: { color: colors.muted, fontSize: 11, fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase' },
  statValue: { color: colors.text, fontSize: 28, fontWeight: '700' },
  statLabel: { color: colors.muted, fontSize: 12, marginTop: 2 },
});
