import { EXPERIMENTS } from '../config';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usesNativeCapture } from '../camera/RecorderView';
import { Capture } from '../../modules/rallycam-export/src/capture';
import { Card, Label } from '../components/ui';
import { ANALYSIS_MB_PER_MINUTE, formatBytes, freeSpaceBytes, videosFolderStats } from '../export/storage';
import { QUALITY, mbPerMinute, updateSettings, useSettings, type VideoQuality } from '../settings';
import { colors, radius } from '../theme';

type WatchStatus = { supported: boolean; paired?: boolean; installed?: boolean; reachable?: boolean };

/** What to tell the user about the link to their Apple Watch. */
function watchLine(w: WatchStatus | null): string {
  if (!w) return 'Looking for a watch…';
  if (!w.supported) return 'This phone cannot link to a watch.';
  if (!w.paired) return 'No Apple Watch is paired with this phone.';
  if (!w.installed) return 'The RallyCam watch app is not installed yet. Open the Watch app on the phone and install RallyCam.';
  if (w.reachable) return 'Connected: the watch app is open.';
  return 'Ready. Open RallyCam on the watch to see the camera.';
}

export default function Settings() {
  const insets = useSafeAreaInsets();
  const settings = useSettings();
  const [storage, setStorage] = useState({ free: 0, used: 0, count: 0 });
  useFocusEffect(useCallback(() => {
    const v = videosFolderStats();
    setStorage({ free: freeSpaceBytes(), used: v.bytes, count: v.count });
  }, []));
  // Is the watch paired, does it have the app, can it be reached: looked at again every couple of seconds while this screen is open
  const [watch, setWatch] = useState<WatchStatus | null>(null);
  useFocusEffect(useCallback(() => {
    const native = Capture;
    if (!native) return;
    const read = () => setWatch(native.getWatchStatus());
    read();
    const id = setInterval(read, 2000);
    return () => clearInterval(id);
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
              <Label>Apple Watch</Label>
              <Text style={s.muted}>Shows a small live picture of the camera on your watch while you record, and has buttons to add, undo or swap a point. Open RallyCam on the watch to use it.</Text>
            </View>
            <Switch value={settings.watchPreview} onValueChange={(v) => updateSettings({ watchPreview: v })} accessibilityLabel="Watch preview" />
          </View>
          <Text style={s.muted}>{watchLine(watch)}</Text>
        </Card>
      )}

      {usesNativeCapture && (
        <Card style={{ gap: 6 }}>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Label>Shuttle tracking · experimental</Label>
              <Text style={s.muted}>Tries to follow the shuttle with the camera and shows its path. It is an early test and will often be wrong. Leave it off for normal games.</Text>
            </View>
            <Switch value={settings.experimentalShuttle} onValueChange={(v) => updateSettings({ experimentalShuttle: v })} accessibilityLabel="Experimental shuttle tracking" />
          </View>
          {EXPERIMENTS && (
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Label>Shuttle model · experimental</Label>
                <Text style={s.muted}>
                  Uses the trained TrackNetV3 model on the Neural Engine instead of the simple tracker. It needs the model file in the build (see ios/Models/README.md) and Shuttle tracking above to be on. If the file is missing, the simple tracker is used and the debug panel says so.
                </Text>
              </View>
              <Switch value={settings.shuttleModel} onValueChange={(v) => updateSettings({ shuttleModel: v })} accessibilityLabel="Shuttle model" />
            </View>
          )}
          {EXPERIMENTS && (
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Label>Shot types · experimental</Label>
                <Text style={s.muted}>
                  Names each shot (serve, clear, drop, smash, net shot, drive) and draws a stick figure of how it was hit, using the body pose of the players nearest the shuttle. Needs Shuttle tracking above to be on and the players to be tracked. A hot phone slows it down or stops it.
                </Text>
              </View>
              <Switch value={settings.shotTypes} onValueChange={(v) => updateSettings({ shotTypes: v })} accessibilityLabel="Shot types" />
            </View>
          )}
          {EXPERIMENTS && (
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Label>Follow camera moves · experimental</Label>
                <Text style={s.muted}>
                  While recording, checks every few seconds whether the phone or tripod has moved. A small steady move moves the court with it; a big one shows a warning to set the court again. Turn it off if the court ever jumps for no reason.
                </Text>
              </View>
              <Switch value={settings.courtFollow} onValueChange={(v) => updateSettings({ courtFollow: v })} accessibilityLabel="Follow camera moves" />
            </View>
          )}
          {EXPERIMENTS && settings.shuttleModel && (
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Label>Crop to the court · experimental</Label>
                <Text style={s.muted}>
                  Shows the model only the court and the air above it, so the shuttle is bigger to it. If the shuttle leaves that area it looks at the whole picture for a couple of seconds. Turn it off to always look at the whole picture.
                </Text>
              </View>
              <Switch value={settings.cropModel} onValueChange={(v) => updateSettings({ cropModel: v })} accessibilityLabel="Crop the shuttle model to the court" />
            </View>
          )}
          {EXPERIMENTS && settings.shuttleModel && (
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Label>Only this court · experimental</Label>
                <Text style={s.muted}>
                  Ignores shuttles that are not over the court you aligned, so the courts beside it do not count. Turn it off if shuttles on your own court are being missed.
                </Text>
              </View>
              <Switch value={settings.courtOnly} onValueChange={(v) => updateSettings({ courtOnly: v })} accessibilityLabel="Follow the shuttle only over this court" />
            </View>
          )}
        </Card>
      )}

      {EXPERIMENTS && (
        <Card style={{ gap: 4 }}>
          <Label>Test build</Label>
          <Text style={s.muted}>Experimental features are on in this build: the debug panel and "Simulate players" on the Record screen, shuttle speed and shot cards, and the shuttle log on the Review screen. Please send feedback from TestFlight.</Text>
        </Card>
      )}

      {usesNativeCapture && EXPERIMENTS && (
        <Card style={{ gap: 6 }}>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Label>Keep a clean copy · experimental</Label>
              <Text style={s.muted}>
                Also saves each game with no overlay drawn on it, 960 pixels wide, about {Math.round(ANALYSIS_MB_PER_MINUTE)} MB a minute on top of the normal video. The shuttle model needs a picture without the score and tags on it. Share it from the game's page.
              </Text>
            </View>
            <Switch value={settings.keepAnalysisCopy} onValueChange={(v) => updateSettings({ keepAnalysisCopy: v })} accessibilityLabel="Keep a clean copy for analysis" />
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
