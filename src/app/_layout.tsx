import * as ScreenOrientation from 'expo-screen-orientation';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { purgeEmptyMatches } from '../db/matches';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../theme';

export default function RootLayout() {
  useEffect(() => { purgeEmptyMatches().catch(() => {}); }, []);
  // Every screen is portrait except Record, which locks itself to landscape.
  useEffect(() => { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {}); }, []);
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="record" options={{ gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="match/[id]" />
      </Stack>
    </>
  );
}
