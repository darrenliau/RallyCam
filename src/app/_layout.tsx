import * as ScreenOrientation from 'expo-screen-orientation';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { recoverUnfinishedGames } from '../db/matches';
import { fileBytes, resolveStoredUri } from '../export/storage';
import { StatusBar } from 'expo-status-bar';
import { WatchLink } from '../components/WatchLink';
import { colors } from '../theme';

export default function RootLayout() {
  useEffect(() => { recoverUnfinishedGames((uri) => fileBytes(resolveStoredUri(uri))).catch(() => {}); }, []);
  // Every screen is portrait except Record, which locks itself to landscape.
  useEffect(() => { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {}); }, []);
  return (
    <>
      <StatusBar style="light" />
      <WatchLink />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="record" options={{ gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="match/[id]" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="guide" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}
