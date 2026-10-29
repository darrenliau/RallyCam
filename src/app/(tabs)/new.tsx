import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createVenue, deleteVenue, listVenues, renameVenue, touchVenue, type Venue } from '../../db/venues';
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

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={[s.chip, on && s.chipOn]}>
      <Text style={[s.chipText, on && { color: colors.bg }]}>{label}</Text>
    </Pressable>
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
  const [a, setA] = useState(['You', 'Mia']);
  const [b, setB] = useState(['Sam', 'Jun']);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editName, setEditName] = useState<string | null>(null); // null = show the saved name
  const venue = venues.find((v) => v.id === venueId) ?? null;

  // Reload on focus so the most recently used venue is selected first.
  useFocusEffect(useCallback(() => {
    listVenues().then((list) => {
      setVenues(list);
      setVenueId((cur) => (cur && list.some((v) => v.id === cur) ? cur : list[0]?.id ?? null));
    });
  }, []));
  const pick = (v: Venue | null) => { setVenueId(v?.id ?? null); setEditName(null); setAdding(false); };
  const addVenue = async () => {
    const name = newName.trim();
    if (!name) return;
    const v = await createVenue(name);
    setVenues((list) => [v, ...list]);
    setNewName('');
    pick(v);
  };
  const saveName = async () => {
    const name = (editName ?? '').trim();
    if (!venue || !name || name === venue.name) return setEditName(null);
    await renameVenue(venue.id, name);
    setVenues((list) => list.map((v) => (v.id === venue.id ? { ...v, name } : v)));
    setEditName(null);
  };
  const removeVenue = () => {
    if (!venue) return;
    Alert.alert(`Delete ${venue.name}?`, 'Its saved court alignment is removed. Past games stay.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteVenue(venue.id); setVenues((l) => l.filter((v) => v.id !== venue.id)); pick(null); } },
    ]);
  };

  const n = type === 'singles' ? 1 : 2;
  const clean = (arr: string[], fallback: string[]) => arr.slice(0, n).map((v, i) => v.trim() || fallback[i]);

  const start = async () => {
    if (venueId) await touchVenue(venueId);
    const config: MatchConfig = {
      type, bestOf: 1, firstServer: 'A', // one game: the recording stops when someone wins it
      players: { A: clean(a, ['You', 'Mia']), B: clean(b, ['Sam', 'Jun']) },
    };
    router.push({ pathname: '/record', params: { config: JSON.stringify(config), ...(venueId ? { venueId } : {}) } });
  };
  const set = (arr: string[], fn: (x: string[]) => void, i: number) => (v: string) => fn(arr.map((x, j) => (j === i ? v : x)));

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 24, gap: 12 }}>
        <Text style={s.title}>New game</Text>
        <Segmented value={type} onChange={setType} options={[{ label: 'Singles', value: 'singles' }, { label: 'Doubles', value: 'doubles' }]} />
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
        <Card style={{ gap: 10 }}>
          <Label>Venue · remembers where the court is</Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
            <Chip label="No venue" on={!venue && !adding} onPress={() => pick(null)} />
            {venues.map((v) => <Chip key={v.id} label={v.name} on={v.id === venueId && !adding} onPress={() => pick(v)} />)}
            <Chip label="+ New venue" on={adding} onPress={() => { setAdding(true); setVenueId(null); }} />
          </ScrollView>
          {adding && (
            <View style={s.field}>
              <TextInput accessibilityLabel="New venue name" value={newName} onChangeText={setNewName} onSubmitEditing={addVenue} maxLength={30} placeholder="Venue name, e.g. Tuesday club hall" placeholderTextColor={colors.muted} style={s.input} />
              <Pressable accessibilityRole="button" onPress={addVenue}><Text style={s.link}>Add</Text></Pressable>
            </View>
          )}
          {venue && (
            <>
              <View style={s.field}>
                <TextInput accessibilityLabel="Venue name" value={editName ?? venue.name} onChangeText={setEditName} onEndEditing={saveName} maxLength={30} style={s.input} />
                <Pressable accessibilityRole="button" onPress={removeVenue}><Text style={[s.link, { color: colors.red }]}>Delete</Text></Pressable>
              </View>
              <Text style={s.hint}>{venue.corners ? 'Court alignment saved. The camera will start with it locked.' : 'No court alignment yet. Align it once during your next game and it is saved here.'}</Text>
            </>
          )}
        </Card>
        <Text style={s.hint}>Put the phone on a tripod behind the near baseline, so all four court corners are in view.</Text>
        <Text style={s.hint}>First to 21 wins, by 2 points, up to 30. Recording stops by itself when the game is won.</Text>
        <Button label="Start game" onPress={start} />
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
  chip: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: '#fff', borderColor: '#fff' },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  link: { color: colors.accent, fontWeight: '700', fontSize: 14 },
});
