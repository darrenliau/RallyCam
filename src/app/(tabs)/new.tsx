import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MatchConfig, MatchType } from '../../engine/types';
import { Button, Card, Label } from '../../components/ui';
import { colors, radius } from '../../theme';

function Segmented<T extends string | number>({ options, value, onChange }: { options: { label: string; value: T }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={s.seg}>
      {options.map((o) => (
        <Pressable key={String(o.value)} accessibilityRole="button" onPress={() => onChange(o.value)} style={[s.segBtn, o.value === value && s.segOn]}>
          <Text style={[s.segText, o.value === value && { color: colors.bg }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Field({ color, value, onChange, label }: { color: string; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <View style={s.field}>
      <View style={[s.dot, { backgroundColor: color }]} />
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} maxLength={12} style={s.input} placeholderTextColor={colors.muted} placeholder={label} />
    </View>
  );
}

export default function NewMatch() {
  const insets = useSafeAreaInsets();
  const [type, setType] = useState<MatchType>('singles');
  const [bestOf, setBestOf] = useState<1 | 3>(3);
  const [a, setA] = useState(['You', 'Mia']);
  const [b, setB] = useState(['Sam', 'Jun']);
  const n = type === 'singles' ? 1 : 2;
  const clean = (arr: string[], fallback: string[]) => arr.slice(0, n).map((v, i) => v.trim() || fallback[i]);

  const start = () => {
    const config: MatchConfig = {
      type, bestOf, firstServer: 'A',
      players: { A: clean(a, ['You', 'Mia']), B: clean(b, ['Sam', 'Jun']) },
    };
    router.push({ pathname: '/record', params: { config: JSON.stringify(config) } });
  };
  const set = (arr: string[], fn: (x: string[]) => void, i: number) => (v: string) => fn(arr.map((x, j) => (j === i ? v : x)));

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 24, gap: 12 }}>
        <Text style={s.title}>New match</Text>
        <Segmented value={type} onChange={setType} options={[{ label: 'Singles', value: 'singles' }, { label: 'Doubles', value: 'doubles' }]} />
        <Segmented value={bestOf} onChange={setBestOf} options={[{ label: 'One game', value: 1 }, { label: 'Best of 3', value: 3 }]} />
        <Card style={{ gap: 8 }}>
          <Label>Near side · closest to the camera</Label>
          {Array.from({ length: n }, (_, i) => (
            <Field key={i} label={`Near side player ${i + 1}`} color={colors.near[i]} value={a[i]} onChange={set(a, setA, i)} />
          ))}
        </Card>
        <Card style={{ gap: 8 }}>
          <Label>Far side · other end of the court</Label>
          {Array.from({ length: n }, (_, i) => (
            <Field key={i} label={`Far side player ${i + 1}`} color={colors.far[i]} value={b[i]} onChange={set(b, setB, i)} />
          ))}
        </Card>
        <Text style={s.hint}>Put the phone on a tripod behind the near baseline, so all four court corners are in view.</Text>
        <Button label="Start match" onPress={start} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  title: { color: colors.text, fontSize: 32, fontWeight: '700' },
  seg: { flexDirection: 'row', backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: radius.md, padding: 4 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 9 },
  segOn: { backgroundColor: '#fff' },
  segText: { color: colors.muted, fontWeight: '600', fontSize: 14 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  input: { flex: 1, backgroundColor: colors.bg, borderColor: colors.line, borderWidth: 1, borderRadius: 10, color: colors.text, fontSize: 16, paddingHorizontal: 12, paddingVertical: 10 },
  hint: { color: colors.muted, fontSize: 13 },
});
