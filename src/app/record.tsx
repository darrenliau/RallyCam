import * as Haptics from 'expo-haptics';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import * as ScreenOrientation from 'expo-screen-orientation';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { courtMap, defaultCorners, denormalizeCorners, normalizeCorners, type Corners } from '../analysis/court';
import { DetectionBridge, FRAME_ASPECT } from '../analysis/detector';
import { cornersToFrame, type OverlaySnapshot } from '../analysis/overlay';
import { frameToScreen, roiFromCorners, shuttleRoiFromCorners } from '../analysis/preprocess';
import { DistanceMeter, SimulatedTracker, type Track } from '../analysis/players';
import { SimulatedShuttle, type ShuttleStats } from '../analysis/shuttle';
import { ShuttleEstimator } from '../analysis/shuttleStats';
import { DetectorPlayerTracker } from '../analysis/tracker';
import { CourtAligner } from '../components/CourtAligner';
import { MatchOverlay } from '../components/MatchOverlay';
import type { TagInfo } from '../components/PlayerOverlay';
import { RecorderView, isExpoGo, usesNativeCapture } from '../camera/RecorderView';
import { Capture } from '../../modules/rallycam-export/src/capture';
import type { RecorderHandle } from '../camera/types';
import { Button } from '../components/ui';
import { createMatch, finishMatch, saveOverlay, saveRallies, setOverlayVideo, setProvisionalVideo } from '../db/matches';
import { EXPERIMENTS, HIDE_EMPTY_SHUTTLE } from '../config';
import { buildLiveScene } from '../export/ass';
import { canExportOnDevice } from '../export/nativeExport';
import { extensionOf, formatBytes, freeSpaceBytes, keepFile, newShuttleLogFile, shuttleLogUriFor } from '../export/storage';
import { FOOTAGE_PRESET, LENS_LABEL, QUALITY, mbPerMinute, updateSettings, useSettings } from '../settings';
import { getVenue, saveVenueCorners, type Venue } from '../db/venues';
import { isRallyOver, judgeRally, serveProblem, type Verdict } from '../analysis/rallyEnd';
import { addRally, editRally, newMatch, sideLabel, undoLast } from '../engine/scoring';
import { formatClock, resultLine } from '../engine/format';
import type { MatchConfig, MatchState, Side } from '../engine/types';
import { colors } from '../theme';

// Remembered between matches in this session so the user does not re-align every time.
const savedCorners: Record<string, Corners> = {};

export default function Record() {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { config: raw, venueId, capture } = useLocalSearchParams<{ config: string; venueId?: string; capture?: string }>();
  // Footage capture: 120 frames per second and nothing drawn on the picture, for collecting shuttle-tracking footage.
  const footage = capture === '1';
  const settings = useSettings();
  const profile = footage ? FOOTAGE_PRESET : QUALITY[settings.quality];
  const config = useRef<MatchConfig>(JSON.parse(raw)).current;

  // Matches are filmed in landscape: the court is wide and the phone sits on a tripod. Everything else stays portrait.
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    return () => { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {}); };
  }, []);

  const [camPerm, askCam] = useCameraPermissions();
  const [micPerm, askMic] = useMicrophonePermissions();
  const recorder = useRef<RecorderHandle>(null);
  const recordingStarted = useRef(false);
  // useRef(createMatch(...)) would run createMatch on every render, adding a row each time. Create it once, lazily.
  const matchIdRef = useRef<Promise<string> | null>(null);
  const getMatchId = () => (matchIdRef.current ??= createMatch(config, venueId));
  const startedAt = useRef(0);
  const lastEnd = useRef(0);

  const [state, setState] = useState<MatchState>(() => newMatch(config));
  const [elapsed, setElapsed] = useState(0);
  const [recError, setRecError] = useState<string | null>(null);
  const [fps, setFps] = useState<number | undefined>(undefined);
  // iPhone camera: which lens is in use and which the phone has. Changing it moves the court in the picture, so only while lining up.
  const [lensInfo, setLensInfo] = useState<{ lens: string; available: string[] } | null>(null);
  const [lensBusy, setLensBusy] = useState(false);
  const [lensChanged, setLensChanged] = useState(false);
  const lensRestored = useRef(false);
  const [ending, setEnding] = useState(false);
  const [pausedBecause, setPausedBecause] = useState<string | null>(null);
  const [pressure, setPressure] = useState('nominal');

  // Court alignment and player tags
  const sizeKey = `${Math.round(width)}x${Math.round(height)}`;
  const [dragged, setDragged] = useState<Corners | null>(null);
  const [venue, setVenue] = useState<Venue | null>(null);
  const [venueLoaded, setVenueLoaded] = useState(!venueId);
  const [aligning, setAligning] = useState(true);
  const [staleCourt, setStaleCourt] = useState(false);
  const venueCorners = venue?.corners ? denormalizeCorners(venue.corners, width, height) : null;
  const corners = dragged ?? venueCorners ?? savedCorners[sizeKey] ?? defaultCorners(width, height);

  // A venue with a saved court starts locked, unless this screen is a different shape from when it was saved.
  useEffect(() => {
    if (!venueId) return;
    getVenue(venueId).then((v) => {
      setVenue(v);
      if (v?.corners) {
        const aspect = width / height;
        const differs = v.aspect != null && Math.abs(v.aspect - aspect) / v.aspect > 0.03;
        setStaleCourt(differs);
        setAligning(differs);
      }
      setVenueLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId]);
  const map = useMemo(() => courtMap(corners), [corners]);
  const nNear = config.players.A.length;
  const names = useMemo(() => [...config.players.A, ...config.players.B], [config]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [assign, setAssign] = useState<number[]>(() => names.map((_, i) => i)); // track id -> player index
  const assignRef = useRef(assign);
  assignRef.current = assign;
  const [selected, setSelected] = useState<number | null>(null);
  const meter = useRef(new DistanceMeter()).current;
  const simulator = useRef<SimulatedTracker | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [shuttle, setShuttle] = useState<ShuttleStats | null>(null);
  const shuttleSim = useRef<SimulatedShuttle | null>(null);

  const colorOf = (player: number) => (player < nNear ? colors.near[player] : colors.far[player - nNear]);
  const tagFor = useCallback((id: number): TagInfo => {
    const p = assignRef.current[id] ?? id;
    return { name: names[p], color: p < nNear ? colors.near[p] : colors.far[p - nNear] };
  }, [names, nNear]);

  const onTracks = useCallback((t: Track[]) => {
    meter.update(t, (id) => assignRef.current[id] ?? id);
    setTracks(t);
  }, [meter]);

  const toggleSimulation = () => {
    if (simulator.current) {
      simulator.current.stop();
      simulator.current = null;
      shuttleSim.current?.stop();
      shuttleSim.current = null;
      setSimulating(false);
      setTracks([]);
      setShuttle(null);
    } else {
      simulator.current = new SimulatedTracker(nNear, names.length - nNear);
      simulator.current.start(onTracks);
      shuttleSim.current = new SimulatedShuttle(names);
      shuttleSim.current.start(setShuttle);
      setSimulating(true);
    }
  };
  useEffect(() => () => { simulator.current?.stop(); shuttleSim.current?.stop(); }, []);
  useEffect(() => { shuttleSim.current?.newRally(); }, [state.rallies.length]);

  // Real tracking: the camera finds people in the court region and hands them to the tracker.
  const bridge = useRef(new DetectionBridge()).current;
  const mapRef = useRef(map);
  mapRef.current = map;
  const sizeRef = useRef({ width, height });
  sizeRef.current = { width, height };
  const roi = useMemo(
    () => (aligning ? null : roiFromCorners(corners, { frameAspect: FRAME_ASPECT, screenW: width, screenH: height })),
    [aligning, corners, width, height],
  );
  useEffect(() => {
    if (aligning || isExpoGo) return;
    const tracker = new DetectorPlayerTracker(
      bridge,
      () => mapRef.current,
      () => ({ frameAspect: FRAME_ASPECT, screenW: sizeRef.current.width, screenH: sizeRef.current.height }),
      { nNear, nFar: names.length - nNear },
    );
    tracker.start(onTracks);
    return () => tracker.stop();
  }, [aligning, bridge, nNear, names.length, onTracks]);

  const chooseLens = useCallback(async (name: string) => {
    if (lensBusy || !recorder.current?.setLens || lensInfo?.lens === name) return;
    setLensBusy(true);
    try {
      await recorder.current.setLens(name);
      updateSettings({ lens: name as 'ultra-wide' | 'wide' | 'tele' });
      setLensChanged(true);
    } catch (e) {
      setRecError(`The lens could not be changed: ${(e as Error).message}`);
    } finally {
      setLensBusy(false);
    }
  }, [lensBusy, lensInfo]);

  // The camera starts before the saved settings are read, so switch to the lens used last time once both are ready
  useEffect(() => {
    if (!lensInfo || !settings.ready || lensRestored.current) return;
    lensRestored.current = true;
    if (settings.lens !== 'auto' && settings.lens !== lensInfo.lens && lensInfo.available.includes(settings.lens)) {
      recorder.current?.setLens?.(settings.lens).catch(() => {});
    }
  }, [lensInfo, settings.ready, settings.lens]);

  const lockCourt = () => {
    savedCorners[sizeKey] = corners;
    if (venue) {
      const norm = normalizeCorners(corners, width, height);
      saveVenueCorners(venue.id, norm, width / height);
      setVenue({ ...venue, corners: norm, aspect: width / height });
      setDragged(null);
    }
    setStaleCourt(false);
    setAligning(false);
  };
  const onTagPress = (id: number) => {
    if (selected == null) return setSelected(id);
    if (selected !== id) {
      setAssign((a) => {
        const next = [...a];
        [next[selected], next[id]] = [next[id], next[selected]];
        return next;
      });
    }
    setSelected(null);
  };

  useEffect(() => {
    if (!camPerm?.granted && camPerm?.canAskAgain) askCam();
    if (!micPerm?.granted && micPerm?.canAskAgain) askMic();
  }, [camPerm, micPerm, askCam, askMic]);

  useEffect(() => {
    const id = setInterval(() => startedAt.current && setElapsed(Date.now() - startedAt.current), 500);
    return () => clearInterval(id);
  }, []);

  // Recording starts only once the camera is ready and the court is locked (a saved venue court counts as locked).
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const onReady = useCallback(() => setCameraReady(true), []);
  useEffect(() => {
    if (!cameraReady || aligning || !venueLoaded || !settings.ready || recordingStarted.current) return;
    recordingStarted.current = true;
    startedAt.current = Date.now();
    setRecording(true);
    recorder.current?.start()
      .then(async (uri) => {
        // Note where the video is being written, so it can be found again if the app is killed mid-game
        if (typeof uri === 'string') await setProvisionalVideo(await getMatchId(), uri, recorder.current?.bakesOverlay === true && !footage);
      })
      .catch((e: Error) => setRecError(e.message));
  }, [cameraReady, aligning, venueLoaded, settings.ready]);

  // Save what the overlay shows, about four times a second, so the review can draw it over the video again.
  const snapshots = useRef<OverlaySnapshot[]>([]);
  const latest = useRef({ tracks, shuttle, tracking: false });
  latest.current = { tracks, shuttle, tracking: !isExpoGo || simulating };
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      const { tracks: tr, shuttle: sh, tracking } = latest.current;
      if (!tr.length && !sh) return;
      const r1 = (n: number) => Math.round(n * 10) / 10;
      const r3 = (n: number) => Math.round(n * 1000) / 1000;
      snapshots.current.push({
        t: Date.now() - startedAt.current,
        tracks: tr.map((x) => ({ id: x.id, u: r3(x.u), v: r3(x.v), ...(x.lost ? { lost: x.lost } : {}) })),
        assign: [...assignRef.current],
        dist: names.map((_, i) => (tracking ? r1(meter.metres(i)) : null)),
        ...(sh ? { shuttle: sh } : {}),
      });
    }, 250);
    return () => clearInterval(id);
  }, [recording, names, meter]);

  // Dev builds: show which camera is in use and whether the overlay is reaching the video.
  const [diag, setDiag] = useState('');
  useEffect(() => {
    if (!EXPERIMENTS || aligning) return;
    const id = setInterval(() => {
      if (usesNativeCapture && Capture) {
        const st = Capture.getStatus();
        setDiag([
          `native camera (${st.lens || 'not started'}, ${st.device}, ${st.running ? 'running' : 'NOT running'}), ${st.framesIn} frames in`,
          `picture brightness ${st.luma}/255 (0 = black), exposure ${st.exposureMs.toFixed(1)} ms, ISO ${Math.round(st.iso)}`,
          `sound: ${st.audioBuffers} buffers, loudness ${Math.round(st.audioLevel * 100)}%, in file ${st.audioInFile ? 'yes' : 'NO'}`,
          `overlay pushed ${st.overlayPushes}, drawn ${st.overlayDecoded}, failed ${st.overlayFailed} · video frames ${st.framesWritten}, with overlay ${st.framesWithOverlay}${st.lastProblem ? ` · ${st.lastProblem}` : ''}`,
        ].join('\n'));
      } else {
        setDiag(isExpoGo ? 'Expo Go camera (overlay is not drawn into the video)' : 'vision-camera (overlay is drawn after the game)');
      }
    }, 1000);
    return () => clearInterval(id);
  }, [aligning]);

  // --- Experimental shuttle tracking (Settings): the camera looks for small fast things, the estimator turns that into numbers ---
  const shuttleOn = settings.experimentalShuttle && usesNativeCapture && !footage;
  const geometry = () => ({ frameAspect: FRAME_ASPECT, screenW: sizeRef.current.width, screenH: sizeRef.current.height });
  const estimator = useMemo(
    () => new ShuttleEstimator((x, y) => {
      // The shuttle is in the air, so this is only a rough floor position (see ShuttleEstimator)
      const c = mapRef.current.toCourt(frameToScreen({ x, y }, { frameAspect: FRAME_ASPECT, screenW: sizeRef.current.width, screenH: sizeRef.current.height }));
      return { u: c.u, v: c.v };
    }),
    [],
  );
  const lastShuttleT = useRef(0);
  const trailFrame = useRef<{ x: number; y: number }[]>([]);
  const [trail, setTrail] = useState<{ x: number; y: number }[]>([]);
  const [shuttleDiag, setShuttleDiag] = useState('');
  // A guess at who won the rally, from where the shuttle was last hit and last seen. The player confirms it.
  const [suggestion, setSuggestion] = useState<Verdict | null>(null);
  const judged = useRef(false);
  const tally = useRef({ shown: 0, agreed: 0, flipped: 0, dismissed: 0, notServe: 0 });
  const serveRef = useRef(state.serve);
  serveRef.current = state.serve;
  const judgeCtx = useRef({ recording: false, over: false, singles: config.type === 'singles' });
  judgeCtx.current = { recording, over: !!state.matchWinner, singles: config.type === 'singles' };

  // Cameras that draw the overlay into the video while recording get a fresh copy of it a few times a second.
  const liveState = useRef(state);
  liveState.current = state;
  const cornersRef = useRef(corners);
  cornersRef.current = corners;
  useEffect(() => {
    if (!recording) return;
    const push = () => {
      const handle = recorder.current;
      if (footage || !handle?.setOverlay) return;
      const { tracks: tr, shuttle: sh, tracking } = latest.current;
      const snapshot = tr.length || sh
        ? {
            t: 0,
            tracks: tr.map((x) => ({ id: x.id, u: x.u, v: x.v, ...(x.lost ? { lost: x.lost } : {}) })),
            assign: [...assignRef.current],
            dist: names.map((_, i) => (tracking ? meter.metres(i) : null)),
            ...(sh ? { shuttle: sh } : {}),
          }
        : undefined;
      handle.setOverlay(buildLiveScene({
        config,
        state: liveState.current,
        snapshot,
        corners: cornersToFrame(cornersRef.current, { frameAspect: FRAME_ASPECT, screenW: sizeRef.current.width, screenH: sizeRef.current.height }),
        frameAspect: FRAME_ASPECT,
        hideEmptyShuttle: HIDE_EMPTY_SHUTTLE,
        trail: shuttleOn ? trailFrame.current : undefined,
      }));
    };
    push();
    const id = setInterval(push, 250);
    return () => clearInterval(id);
  }, [recording, names, meter, config, footage, shuttleOn]);

  useEffect(() => {
    const native = Capture;
    if (!native || !shuttleOn || aligning) return;
    const r = shuttleRoiFromCorners(corners, geometry());
    native.setShuttle(true, r.x, r.y, r.w, r.h);
    return () => native.setShuttle(false, 0, 0, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shuttleOn, aligning, corners, width, height]);

  useEffect(() => {
    const native = Capture;
    if (!native || !shuttleOn) return;
    const sub = native.addListener('onShuttle', (e) => {
      lastShuttleT.current = e.t;
      if (e.x != null && e.y != null && (e.misses ?? 0) === 0) estimator.push({ t: e.tTrack ?? e.t, x: e.x, y: e.y });
    });
    const id = setInterval(() => {
      const now = lastShuttleT.current;
      setShuttle(estimator.stats(now));
      const ctx = judgeCtx.current;
      if (ctx.recording && !ctx.over && !judged.current) {
        const trace = estimator.trace();
        let verdict: Verdict | null = null;
        if (isRallyOver(trace, now)) {
          const sv = serveRef.current;
          const sideNames = sv.side === 'A' ? config.players.A : config.players.B;
          const playerIdx = (sv.side === 'A' ? 0 : config.players.A.length) + sv.playerIndex;
          const serverTrack = latest.current.tracks.find((x) => !x.lost && (assignRef.current[x.id] ?? x.id) === playerIdx);
          const problem = sideNames.length ? serveProblem(trace, { side: sv.side, court: sv.court, server: serverTrack ? { u: serverTrack.u, v: serverTrack.v } : undefined }) : null;
          if (problem) {
            // Movement that did not start like a serve: a shuttle being picked up, a practice hit. Not a point.
            tally.current.notServe += 1;
            estimator.newRally();
          } else {
            verdict = judgeRally(trace, now, ctx.singles);
          }
        }
        if (verdict) {
          judged.current = true;
          tally.current.shown += 1;
          setSuggestion(verdict);
        }
      }
      const frames = estimator.trail(now);
      trailFrame.current = frames;
      setTrail(frames.map((p) => frameToScreen(p, geometry())));
      const st = native.getShuttleStatus();
      const t = tally.current;
      setShuttleDiag(`score guesses: ${t.shown} given, ${t.flipped} swapped by you, ${t.notServe} ignored (no serve)\nshuttle: ${st.shuttleFrames} frames, candidates ${st.shuttleLastCandidates}, with candidates ${st.shuttleWithCandidates}, tracked ${st.shuttleConfirmed}, shaky ${st.shuttleShaky}`);
    }, 120);
    return () => { sub.remove(); clearInterval(id); setShuttle(null); setTrail([]); trailFrame.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shuttleOn, estimator]);

  useEffect(() => {
    estimator.newRally();
    judged.current = false;
    setSuggestion(null);
  }, [state.rallies.length, estimator]);
  // The point just given automatically, shown briefly so it can be swapped. It is also flagged for review afterwards when unsure.
  const [autoPoint, setAutoPoint] = useState<{ winner: Side; index: number } | null>(null);
  useEffect(() => {
    if (!autoPoint) return;
    const id = setTimeout(() => setAutoPoint(null), 6000);
    return () => clearTimeout(id);
  }, [autoPoint]);

  // Keep a log of what the tracker saw, for studying it on a computer afterwards
  const shuttleLogUri = useRef<string | null>(null);
  useEffect(() => {
    if (!Capture || !shuttleOn || !recording || shuttleLogUri.current) return;
    shuttleLogUri.current = newShuttleLogFile().uri;
    Capture.startShuttleLog(shuttleLogUri.current);
  }, [shuttleOn, recording]);

  const persist = useCallback(async (next: MatchState) => {
    setState(next);
    await saveRallies(await getMatchId(), next.rallies);
  }, []);

  /** Called by the analysis source in Phase 2. Until then only the dev buttons call it. */
  // The camera's guess is applied straight away; a swap or Fix last point corrects it, and unsure ones are flagged in Review.
  useEffect(() => {
    if (!suggestion || !recordingStarted.current) return;
    const now = Date.now() - startedAt.current;
    const next = addRally(state, { winner: suggestion.winner, startMs: lastEnd.current, endMs: now, source: 'auto', confidence: suggestion.confidence });
    lastEnd.current = now;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    tally.current.agreed += 1;
    setSuggestion(null);
    setAutoPoint({ winner: suggestion.winner, index: next.rallies.length - 1 });
    persist(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestion]);

  const swapAutoPoint = useCallback(() => {
    if (!autoPoint || state.rallies.length !== autoPoint.index + 1) return;
    tally.current.agreed -= 1;
    tally.current.flipped += 1;
    setAutoPoint(null);
    persist(editRally(state, autoPoint.index, { winner: autoPoint.winner === 'A' ? 'B' : 'A', source: 'manual' }));
  }, [state, persist, autoPoint]);

  const onPoint = useCallback((winner: Side) => {
    if (!recordingStarted.current) return;
    const now = Date.now() - startedAt.current;
    const next = addRally(state, { winner, startMs: lastEnd.current, endMs: now, source: 'manual' });
    lastEnd.current = now;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    persist(next);
  }, [state, persist]);

  const onUndo = () => persist(undoLast(state));

  const endingRef = useRef(false);
  const endMatch = async () => {
    if (endingRef.current) return;
    if (!recordingStarted.current && state.rallies.length === 0) { router.back(); return; } // nothing was recorded
    endingRef.current = true;
    setEnding(true);
    const uri = await recorder.current?.stop().catch((e) => { setRecError(`The video could not be finished: ${e?.message ?? e}`); return undefined; });
    const id = await getMatchId();
    if (recordingStarted.current) {
      await saveOverlay(id, {
        version: 1,
        frameAspect: FRAME_ASPECT,
        corners: cornersToFrame(corners, { frameAspect: FRAME_ASPECT, screenW: width, screenH: height }),
        snapshots: snapshots.current,
      });
    }
    if (shuttleLogUri.current) {
      Capture?.stopShuttleLog();
      keepFile(shuttleLogUri.current, `${id}.shuttle.csv`);
      shuttleLogUri.current = null;
    }
    const kept = uri ? keepFile(uri, `${id}.${extensionOf(uri)}`) : null;
    await finishMatch(id, kept, startedAt.current ? Date.now() - startedAt.current : 0);
    // The iPhone camera draws the overlay while recording, so that file is already the finished video.
    const baked = kept != null && recorder.current?.bakesOverlay === true && !footage;
    if (baked) await setOverlayVideo(id, kept);
    // Otherwise, on an iPhone dev build, Review makes the video with the overlay drawn in right away
    router.replace({ pathname: '/match/[id]', params: { id, ...(kept && !baked && !footage && canExportOnDevice ? { export: '1' } : {}) } });
  };

  // A game is over at 21 (win by 2, capped at 30). Stop recording a moment later so the final score is seen.
  // Fix last point cancels this, because the game is no longer won.
  useEffect(() => {
    if (!state.matchWinner) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const t = setTimeout(() => { endMatch(); }, 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.matchWinner]);

  if (!camPerm || !micPerm) return <View style={s.fill} />;
  if (!camPerm.granted || !micPerm.granted) {
    return (
      <View style={[s.fill, s.center, { padding: 24, gap: 12 }]}>
        <Text style={s.h}>Camera and microphone needed</Text>
        <Text style={s.muted}>RallyCam films the match and listens for racket hits. Allow both in your phone settings to continue.</Text>
        <Button label="Allow access" onPress={() => { askCam(); askMic(); }} />
        <Button label="Back" kind="ghost" onPress={() => router.back()} />
      </View>
    );
  }

  const L = insets.left + 12;
  const R = insets.right + 12;
  const T = insets.top + 8;
  const B = insets.bottom + 12;
  const lowFps = fps != null && fps < 60;
  // Warn if a 30 minute game at this quality might not fit
  const needBytes = mbPerMinute(profile) * 30 * 1e6;
  const freeBytes = freeSpaceBytes();
  const lowSpace = freeBytes < needBytes * 1.2;

  return (
    <View style={s.fill}>
      <RecorderView
        ref={recorder}
        style={StyleSheet.absoluteFill}
        onReady={onReady}
        onError={setRecError}
        onFps={setFps}
        lens={settings.lens}
        onLens={setLensInfo}
        detection={isExpoGo ? undefined : { enabled: !aligning, roi, onDetections: bridge.emit }}
        videoProfile={usesNativeCapture ? profile : undefined}
        onInterruption={(info) => setPausedBecause(info.interrupted ? info.reason : null)}
        onPressure={setPressure}
      />
      {venueLoaded && (
        <MatchOverlay
          width={width}
          height={height}
          inset={{ l: L, r: R, t: T, b: B }}
          map={map}
          tracks={tracks}
          tagFor={tagFor}
          selected={selected}
          onTagPress={onTagPress}
          state={state}
          distanceRows={names.map((name, i) => ({ name, color: colorOf(i), metres: isExpoGo && !simulating ? null : meter.metres(i) }))}
          shuttle={shuttle}
          scoreOnly={aligning}
          hideEmptyShuttle={HIDE_EMPTY_SHUTTLE}
          trail={shuttleOn ? trail : undefined}
          mapTop={T + 40}
        />
      )}

      <View style={[s.chipRow, { left: L, top: T }]} pointerEvents="box-none">
        {aligning && !recording && (
          // only until recording starts: after that, leaving means ending the game with End game
          <Pressable style={s.chip} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
            <Text style={s.chipText}>‹ Back</Text>
          </Pressable>
        )}
        {aligning && !recording && lensInfo && lensInfo.available.length > 1 && (
          <View style={s.chip} accessibilityLabel="Camera lens">
            {lensInfo.available.map((name) => (
              <Pressable key={name} onPress={() => chooseLens(name)} disabled={lensBusy} accessibilityRole="button" accessibilityState={{ selected: lensInfo.lens === name }} accessibilityLabel={`${LENS_LABEL[name] ?? name} lens`}>
                <Text style={[s.chipText, lensInfo.lens === name ? s.lensOn : s.lensOff]}>{LENS_LABEL[name] ?? name}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <View style={s.chip}>
          <View style={[s.dot, !recording && { backgroundColor: colors.muted }]} />
          <Text style={s.chipText}>{recError ? 'Not recording' : recording ? formatClock(elapsed) : 'Not recording yet'}</Text>
        </View>
        <View style={s.chip}>
          <Text style={[s.chipText, lowFps && { color: colors.amber }]}>
            {isExpoGo ? 'Standard fps (Expo Go)' : fps != null ? `${fps} fps` : '… fps'}
          </Text>
        </View>
        {!aligning && !isExpoGo && (
          <View style={s.chip}>
            <Text style={s.chipText}>Players {tracks.filter((t) => !t.lost).length}/{names.length}</Text>
          </View>
        )}
        {footage && <View style={s.chip}><Text style={[s.chipText, { color: colors.accent }]}>Footage capture · no overlay</Text></View>}
        {!aligning && <Text style={s.chip2} onPress={() => setAligning(true)} accessibilityRole="button">Re-align court</Text>}
      </View>

      {pausedBecause && (
        <Text style={[s.err, { top: T + 96, left: (width - 360) / 2, width: 360, backgroundColor: 'rgba(160,110,20,0.95)' }]}>
          The camera is paused because {pausedBecause}. It carries on by itself when that is over. Points you tap are still saved.
        </Text>
      )}
      {!pausedBecause && (pressure === 'serious' || pressure === 'critical' || pressure === 'shutdown') && (
        <Text style={[s.err, { top: T + 96, left: (width - 360) / 2, width: 360, backgroundColor: 'rgba(200,90,20,0.95)' }]}>
          The phone is {pressure === 'serious' ? 'getting hot' : 'too hot'}. Move it out of the sun and keep it cool, or the camera will slow down{pressure === 'serious' ? '' : ' or stop'}.
        </Text>
      )}
      {!pausedBecause && pressure !== 'serious' && pressure !== 'critical' && pressure !== 'shutdown' && (recError || lowFps || lowSpace) && (
        <Text style={[s.err, { top: T + 96, left: (width - 360) / 2, width: 360 }, !recError && { backgroundColor: 'rgba(160,110,20,0.9)' }]}>
          {recError
            ? `Recording failed: ${recError}`
            : lowSpace
              ? `Only ${formatBytes(freeBytes)} free. A 30 minute game needs about ${formatBytes(needBytes)} at this quality. Delete old videos or pick a smaller quality in Settings.`
              : `Only ${fps} fps on this phone. Fast shots will blur, so tracking will be less accurate.`}
        </Text>
      )}

      {!aligning && !footage && (
        <View style={[s.scoreBtns, { bottom: B, left: (width - 320) / 2 }]}>
          <Button label={`+ ${config.players.A.join(' & ')}`} onPress={() => onPoint('A')} disabled={!recording || !!state.matchWinner} style={s.scoreBtn} />
          <Button label={`+ ${config.players.B.join(' & ')}`} onPress={() => onPoint('B')} disabled={!recording || !!state.matchWinner} style={s.scoreBtn} />
        </View>
      )}

      {EXPERIMENTS && !aligning && (
        <View style={[s.dev, { bottom: B + 64, left: (width - 260) / 2 }]}>
          <Text style={s.devText}>Dev only: test tools</Text>
          {diag !== '' && <Text style={s.devDiag}>{diag}</Text>}
          {shuttleOn && shuttleDiag !== '' && <Text style={s.devDiag}>{shuttleDiag}</Text>}
          <Button kind="ghost" label={simulating ? 'Stop simulation' : 'Simulate players'} onPress={toggleSimulation} style={s.devBtn} />
        </View>
      )}

      {venueLoaded && aligning && (
        <View style={[s.banner, { bottom: B, left: (width - 440) / 2, width: 440 }]}>
          <Text style={s.bannerText}>
            {lensChanged ? 'The lens changed, so the court looks different. Drag the four dots onto the corners again. ' : staleCourt ? 'This phone\'s screen is a different shape from when the court was saved. Check the four dots. ' : 'Drag the four dots onto the outer corners of the court. Recording starts when you lock it. '}
            {venue ? `It is saved for ${venue.name}.` : ''}
          </Text>
          <Button label={recording ? 'Lock court' : 'Lock court and start recording'} onPress={lockCourt} />
        </View>
      )}

      {autoPoint && state.rallies.length === autoPoint.index + 1 && !aligning && (
        <View style={[s.banner, { top: T + 8, left: (width - 360) / 2, width: 360 }]}>
          <Text style={s.bannerText}>Point to {sideLabel(state.config, autoPoint.winner)} (automatic)</Text>
          <View style={s.suggestRow}>
            <Button kind="ghost" label="Wrong, swap" onPress={swapAutoPoint} style={s.suggestBtn} />
          </View>
        </View>
      )}

      {state.matchWinner && (
        <View style={s.gameOver} pointerEvents="none">
          <Text style={s.gameOverTitle}>Game over</Text>
          <Text style={s.gameOverText}>
            {sideLabel(state.config, state.matchWinner)} wins {resultLine(state)}. Saving the video…
          </Text>
        </View>
      )}

      {!aligning && (
      <View style={[s.actions, { right: R, bottom: B }]}>
        <Button kind="ghost" label="Fix last point" onPress={onUndo} disabled={state.rallies.length === 0} />
        <Button label={state.matchWinner ? 'Finish now' : 'End game'} onPress={endMatch} disabled={ending} />
      </View>
      )}
      {venueLoaded && aligning && (
        // drawn last so a corner is never hidden behind another control
        <CourtAligner corners={corners} onChange={setDragged} width={width} height={height} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  center: { justifyContent: 'center' },
  h: { color: colors.text, fontSize: 22, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 14 },
  chipRow: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(5,9,10,0.62)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  chip2: { color: '#fff', fontSize: 12, fontWeight: '600', backgroundColor: 'rgba(5,9,10,0.62)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  lensOn: { color: '#C8F04A' },
  lensOff: { opacity: 0.6 },
  chipText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  banner: { position: 'absolute', gap: 10, backgroundColor: 'rgba(5,9,10,0.85)', borderRadius: 16, padding: 14 },
  suggestRow: { flexDirection: 'row', gap: 8 },
  suggestBtn: { flex: 1 },
  bannerText: { color: '#fff', fontSize: 14 },
  err: { position: 'absolute', color: '#fff', backgroundColor: 'rgba(200,40,30,0.85)', padding: 8, borderRadius: 8, fontSize: 12, overflow: 'hidden' },
  dev: { position: 'absolute', width: 260, backgroundColor: 'rgba(5,9,10,0.7)', borderRadius: 12, padding: 8, gap: 6 },
  devDiag: { color: '#fff', fontSize: 10 },
  devText: { color: '#C8F04A', fontSize: 11 },
  scoreBtns: { position: 'absolute', width: 320, flexDirection: 'row', gap: 8 },
  scoreBtn: { flex: 1, minHeight: 52, paddingHorizontal: 8 },
  devBtn: { flex: 1, minHeight: 36 },
  gameOver: { position: 'absolute', alignSelf: 'center', top: '38%', backgroundColor: 'rgba(5,9,10,0.9)', borderRadius: 16, paddingHorizontal: 24, paddingVertical: 14, alignItems: 'center' },
  gameOverTitle: { color: '#fff', fontSize: 26, fontWeight: '700' },
  gameOverText: { color: '#C6D3CC', fontSize: 14, marginTop: 4 },
  actions: { position: 'absolute', width: 160, gap: 8 },
});
