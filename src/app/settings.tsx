import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usesNativeCapture } from '../camera/RecorderView';
import { Card, Label } from '../components/ui';
import { formatBytes, freeSpaceBytes, videosFolderStats } from '../export/storage';
import { QUALITY, mbPerMinute, updateSettings, useSettings, type VideoQuality } from '../settings';
import { colors, radius } from '../theme';

export default function Settings() {
  const insets = useSafeAreaInsets();
  const settings = useSettings();
  const [storage, setStorage] = useState({ free: 0, used: 0, count: 0 });
  useFocusEffect(useCallback(() => {
    const v = videosFolderStats();
    setStorage({ free: freeSpaceBytes(), used: v.bytes, count: v.count });
  }, []));

  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 12 }}>
      <Pressable onPress={() => router.back()} accessibilityRole="button"><Text style={s.back}>‹ Back</Text></Pressable>
      <Text style={s.title}>Settings</Text>

      <Card style={{ gap: 8 }}>
        <Label>Video quality</Label>
        {(Object.keys(QUALITY) as VideoQuality[]).map((q) => {
          const p = QUALITY[q];
          const on = settings.quality === q;
          return (
            <Pressable key={q} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => updateSettings({ quality: q })} style={[s.option, on && s.optionOn]}>
              <View style={{ flex: 1 }}>
                <Text style={[s.optionTitle, on && { color: colors.bg }]}>{p.label}</Text>
                <Text style={[s.muted, on && { color: colors.bg }]}>{p.note}</Text>
              </View>
              <Text style={[s.optionSize, on && { color: colors.bg }]}>~{Math.round(mbPerMinute(p))} MB/min</Text>
            </Pressable>
          );
        })}
        {!usesNativeCapture && <Text style={s.muted}>This applies to the iPhone camera in the full app. Expo Go and Android use their own camera settings.</Text>}
      </Card>

      <Card style={{ gap: 6 }}>
        <Label>Storage</Label>
        <Text style={s.value}>{formatBytes(storage.used)} <Text style={s.muted}>used by {storage.count} video{storage.count === 1 ? '' : 's'}</Text></Text>
        <Text style={s.value}>{Number.isFinite(storage.free) ? formatBytes(storage.free) : '–'} <Text style={s.muted}>free on this phone</Text></Text>
        <Text style={s.muted}>To free space, open a game and tap "Delete video". The score and stats are kept.</Text>
      </Card>

      {usesNativeCapture && (
        <Card style={{ gap: 6 }}>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Label>Shuttle tracking · experimental</Label>
              <Text style={s.muted}>Tries to follow the shuttle with the camera and shows its path. It is an early test and will often be wrong. Leave it off for normal games.</Text>
            </View>
            <Switch value={settings.experimentalShuttle} onValueChange={(v) => updateSettings({ experimentalShuttle: v })} accessibilityLabel="Experimental shuttle tracking" />
          </View>
        </Card>
      )}

      <Pressable onPress={() => router.push('/guide')} accessibilityRole="button">
        <Card><Text style={s.link}>How RallyCam works ›</Text></Card>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  back: { color: colors.muted, fontSize: 16 },
  title: { color: colors.text, fontSize: 32, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 13 },
  value: { color: colors.text, fontSize: 18, fontWeight: '600' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12 },
  optionOn: { backgroundColor: '#fff', borderColor: '#fff' },
  optionTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  optionSize: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  link: { color: colors.accent, fontSize: 16, fontWeight: '600' },
});
