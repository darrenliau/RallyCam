import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { Button } from '../components/ui';
import { updateSettings } from '../settings';
import { colors } from '../theme';

/** Top-down court with the phone behind the near baseline and its view cone. */
function SetupDiagram() {
  return (
    <Svg viewBox="0 0 220 200" width="100%" style={{ aspectRatio: 220 / 200, maxHeight: 240 }}>
      <Rect x={50} y={10} width={120} height={150} fill="none" stroke="#6F8279" strokeWidth={1.5} />
      <Line x1={50} y1={85} x2={170} y2={85} stroke="#C6D3CC" strokeWidth={2} />
      <Line x1={63} y1={10} x2={63} y2={160} stroke="#6F8279" strokeWidth={1} />
      <Line x1={157} y1={10} x2={157} y2={160} stroke="#6F8279" strokeWidth={1} />
      <Line x1={110} y1={10} x2={110} y2={50} stroke="#6F8279" strokeWidth={1} />
      <Line x1={110} y1={120} x2={110} y2={160} stroke="#6F8279" strokeWidth={1} />
      {/* view cone from the phone */}
      <Path d="M110 180 L20 10 L200 10 Z" fill="rgba(200,240,74,0.12)" stroke="#C8F04A" strokeWidth={1} strokeDasharray="4 3" />
      <Rect x={98} y={176} width={24} height={14} rx={4} fill="#C8F04A" />
      <Rect x={105} y={171} width={10} height={6} rx={2} fill="#C8F04A" />
      <SvgText x={110} y={199} fontSize={9} fill="#C6D3CC" textAnchor="middle">phone on a tripod</SvgText>
      <SvgText x={110} y={80} fontSize={9} fill="#C6D3CC" textAnchor="middle">net</SvgText>
    </Svg>
  );
}

const PAGES = [
  { title: 'Put the phone behind the court', body: 'Use a tripod behind one baseline, about 1.5 to 2 metres high and in the middle. Hold the phone in landscape. All four outer corners of the court must be in view. In a hall with several courts, aim at yours and keep it in the middle of the picture.', diagram: true },
  { title: 'Choose Game or Training', body: 'Game keeps the score for you. Training follows the players and the shuttle but keeps no score. Choose singles or doubles, type the names, and pick a venue so RallyCam remembers where the court is.', diagram: false },
  { title: 'Line up the court', body: 'RallyCam draws the court lines from the camera. Drag any dot that is off onto its corner, then tap Lock court. Recording starts when you lock it. Do not turn the phone or move the tripod during the game.', diagram: false },
  { title: 'Points are automatic', body: 'In a Game, RallyCam watches the shuttle and gives each point. If one is wrong, tap Wrong, swap, or use Fix last point. The + buttons still add a point by hand. The game stops by itself at 21. In Training, tap End session when you are done.', diagram: false },
  { title: 'After the game', body: 'The video has the score, player tags, court map and distance drawn in. Review shows every point and flags the ones RallyCam was unsure about. It also keeps a clean copy of the video and the shuttle log, which you can share.', diagram: false },
];

export default function Guide() {
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(0);
  const last = page === PAGES.length - 1;
  const p = PAGES[page];

  // Swipe left for the next tip and right for the previous one. Only mostly sideways drags count, so swiping down still closes the screen.
  const swipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > 1.5 * Math.abs(g.dy),
    onPanResponderRelease: (_, g) => {
      if (g.dx < -50) setPage((n) => Math.min(n + 1, PAGES.length - 1));
      else if (g.dx > 50) setPage((n) => Math.max(n - 1, 0));
    },
  }), []);

  const done = async () => {
    await updateSettings({ guideSeen: true });
    router.back();
  };

  return (
    <View style={[s.wrap, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]} {...swipe.panHandlers}>
      <Text style={s.step}>{page + 1} of {PAGES.length}</Text>
      <Text style={s.title}>{p.title}</Text>
      {p.diagram && <SetupDiagram />}
      <Text style={s.body}>{p.body}</Text>
      <View style={{ flex: 1 }} />
      <View style={s.dots}>
        {PAGES.map((_, i) => <View key={i} style={[s.dot, i === page && s.dotOn]} />)}
      </View>
      <View style={s.buttons}>
        {page > 0 ? <Button kind="ghost" label="Back" onPress={() => setPage(page - 1)} style={{ flex: 1 }} /> : <Button kind="ghost" label="Skip" onPress={done} style={{ flex: 1 }} />}
        <Button label={last ? 'Got it' : 'Next'} onPress={last ? done : () => setPage(page + 1)} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20, gap: 14 },
  step: { color: colors.muted, fontSize: 13, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  title: { color: colors.text, fontSize: 30, fontWeight: '700' },
  body: { color: colors.muted, fontSize: 17, lineHeight: 24 },
  dots: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.line },
  dotOn: { backgroundColor: colors.accent },
  buttons: { flexDirection: 'row', gap: 10 },
});
