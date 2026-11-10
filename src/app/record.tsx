import * as Haptics from 'expo-haptics';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import * as ScreenOrientation from 'expo-screen-orientation';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COURT_L, COURT_W, courtMap, defaultCorners, denormalizeCorners, normalizeCorners, type Corners } from '../analysis/court';
import { DetectionBridge, FRAME_ASPECT } from '../analysis/detector';
import { cornersToFrame, type OverlaySnapshot } from '../analysis/overlay';
import { frameToScreen, modelCrop, roiFromCorners, shuttleRoiFromCorners } from '../analysis/preprocess';
import { DistanceMeter, SimulatedTracker, type Track } from '../analysis/players';
import { SimulatedShuttle, type ShuttleOnMap, type ShuttleStats } from '../analysis/shuttle';
import { ShuttleEstimator } from '../analysis/shuttleStats';
import { DetectorPlayerTracker } from '../analysis/tracker';
import { CourtAligner } from '../components/CourtAligner';
import { MatchOverlay } from '../components/MatchOverlay';
import type { TagInfo } from '../components/PlayerOverlay';
import { RecorderView, isExpoGo, usesNativeCapture } from '../camera/RecorderView';
import { Capture, type ShuttleModelStatus } from '../../modules/rallycam-export/src/capture';
import type { RecorderHandle } from '../camera/types';
import { Button } from '../components/ui';
import { createMatch, finishMatch, saveOverlay, saveRallies, setOverlayVideo, setProvisionalVideo } from '../db/matches';
import { EXPERIMENTS, HIDE_EMPTY_SHUTTLE } from '../config';
import { buildLiveScene } from '../export/ass';
import { canExportOnDevice } from '../export/nativeExport';
import { reference, shiftFrom, type Reference } from '../analysis/cameraShift';
import { followCorners, judgeShift } from '../analysis/courtFollow';
import { buildWatchState, parseWatchCommand, watchCommandAllowed } from '../watchBridge';
import { extensionOf, formatBytes, freeSpaceBytes, keepFile, newShuttleLogFile, shuttleLogUriFor } from '../export/storage';
import { FOOTAGE_PRESET, LENS_LABEL, QUALITY, mbPerMinute, nextLensName, updateSettings, useSettings } from '../settings';
import { getVenue, saveVenueCorners, type Venue } from '../db/venues';
import { decodeBase64 } from '../analysis/base64';
import { consensusCourt, courtDistance, findCourts, type CourtFit } from '../analysis/courtLines';
import { floorPosition } from '../analysis/court';
import { hitterSide } from '../analysis/hitter';
import { effectiveFraming, framingAvailability } from '../framingSupport';
import { Framer, fullWindow, pointToReference, pointToView, startWindow, WIDE_RATIO, viewTransform, type ViewTransform } from '../analysis/framing';
import { playerSubjects, shuttleSubject } from '../analysis/framingSubjects';
import { ViewWindow, type ViewWindowHandle } from '../components/ViewWindow';
import { decodePose, hitPose, PoseHistory, poseEventToReference } from '../analysis/pose';
import { toShotRecord } from '../analysis/shotRecord';
import type { ShotRecord } from '../analysis/overlay';
import { courtOfServer, inferWinnerFromServe } from '../analysis/nextServe';
import { CropGuard } from '../analysis/cropGuard';
import { courtRegion } from '../analysis/courtRegion';
import { ModelTrackFilter } from '../analysis/modelTrack';
import { PlayerMotion } from '../analysis/playerMotion';
import { CONTINUE_S, isContinuation, isRallyOver, judgeRally, judgeServe, serveProblem, type Verdict } from '../analysis/rallyEnd';
import { addRally, editRally, newMatch, sideLabel, undoLast } from '../engine/scoring';
import { formatClock, resultLine } from '../engine/format';
import type { Court, MatchConfig, MatchState, Side } from '../engine/types';
import { colors } from '../theme';

// Remembered between matches in this session so the user does not re-align every time.
const savedCorners: Record<string, Corners> = {};

/** The stats as saved in a snapshot: the stick figure is saved once with the shot, not four times a second. */
function withoutPose(sh: ShuttleStats): ShuttleStats {
  if (!sh.lastShot?.pose) return sh;
  const { pose: _pose, ...rest } = sh.lastShot;
  return { ...sh, lastShot: rest };
}

export default function Record() {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  // While the game is being ended the phone turns back to portrait. The screen is covered then and its size is kept, so the landscape layout is never squeezed into a portrait window.
  const [ending, setEnding] = useState(false);
  const lastLandscape = useRef(win);
  if (win.width > win.height) lastLandscape.current = win;
  const { width, height } = ending ? lastLandscape.current : win;
  const { config: raw, venueId, capture } = useLocalSearchParams<{ config: string; venueId?: string; capture?: string }>();
  // Footage capture: 120 frames per second and nothing drawn on the picture, for collecting shuttle-tracking footage.
  const footage = capture === '1';
  const settings = useSettings();
  const profile = footage ? FOOTAGE_PRESET : QUALITY[settings.quality];
  const config = useRef<MatchConfig>(JSON.parse(raw)).current;
  // Training: players and shuttle are tracked as in a game, but nothing is scored
  const training = !!config.training;

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
  const findCourtRef = useRef<() => void>(() => {});
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

  // How much the players move, to tell a finished rally (they stop) from a shuttle the camera lost (they keep running)
  const motion = useRef(new PlayerMotion()).current;
  const onTracks = useCallback((t: Track[]) => {
    motion.push(Date.now() / 1000, t);
    meter.update(t, (id) => assignRef.current[id] ?? id);
    setTracks(t);
  }, [meter, motion]);

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
      setTimeout(() => findCourtRef.current(), 1200);
    } catch (e) {
      setRecError(`The lens could not be changed: ${(e as Error).message}`);
    } finally {
      setLensBusy(false);
    }
  }, [lensBusy, lensInfo]);

  // One button for all the lenses: each tap goes to the next one the phone has, and back to the first after the last
  const nextLens = () => {
    if (!lensInfo || lensInfo.available.length < 2) return;
    const next = nextLensName(lensInfo.available, lensInfo.lens);
    if (next) chooseLens(next);
  };

  // The camera starts before the saved settings are read, so switch to the lens used last time once both are ready
  useEffect(() => {
    if (!lensInfo || !settings.ready || lensRestored.current) return;
    lensRestored.current = true;
    if (settings.lens !== 'auto' && settings.lens !== lensInfo.lens && lensInfo.available.includes(settings.lens)) {
      recorder.current?.setLens?.(settings.lens).catch(() => {});
    }
  }, [lensInfo, settings.ready, settings.lens]);

  const offScreenCorner = [corners.farLeft, corners.farRight, corners.nearRight, corners.nearLeft].some((p) => p.x < 0 || p.y < 0 || p.x > width || p.y > height);
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
  const recordingRef = useRef(false);
  recordingRef.current = recording;

  // Drawing the court from the camera: a few pictures a moment apart, the lines found in each, the best agreeing one kept as the starting corners.
  const [courtFinder, setCourtFinder] = useState<'idle' | 'finding' | 'found' | 'failed'>('idle');
  const finderBusy = useRef(false);
  // Every court the finder came up with (best first), so a wrong first guess can be swapped for the next one
  const courtOptions = useRef<CourtFit[]>([]);
  const [optionNo, setOptionNo] = useState(0);
  const [optionCount, setOptionCount] = useState(0);
  // "Tap the corners": the four corners tapped so far (null when not tapping). For halls the finder cannot read, such as a camera at the side.
  const [tapPoints, setTapPoints] = useState<{ x: number; y: number }[] | null>(null);
  const tapCorner = (x: number, y: number) => {
    const next = [...(tapPoints ?? []), { x, y }];
    if (next.length < 4) { setTapPoints(next); return; }
    setDragged({ farLeft: next[0], farRight: next[1], nearRight: next[2], nearLeft: next[3] });
    setCourtFinder('idle');
    setOptionCount(0);
    setTapPoints(null);
  };
  const [courtSure, setCourtSure] = useState(true);   // false: the finder was not sure, so say it is only a guess
  const showOption = useCallback((fit: CourtFit) => {
    const g = { frameAspect: FRAME_ASPECT, screenW: sizeRef.current.width, screenH: sizeRef.current.height };
    const to = (p: { x: number; y: number }) => frameToScreen(p, g);
    setDragged({ farLeft: to(fit.corners.farLeft), farRight: to(fit.corners.farRight), nearRight: to(fit.corners.nearRight), nearLeft: to(fit.corners.nearLeft) });
  }, []);
  const nextOption = () => {
    const list = courtOptions.current;
    if (list.length < 2) return;
    const n = (optionNo + 1) % list.length;
    setOptionNo(n);
    showOption(list[n]);
  };
  const findCourtNow = useCallback(async () => {
    const native = Capture;
    if (!native || finderBusy.current) return;
    finderBusy.current = true;
    setCourtFinder('finding');
    try {
      const tops: CourtFit[] = [];
      const others: CourtFit[] = [];
      for (let i = 0; i < 3; i++) {
        if (i) await new Promise((r) => setTimeout(r, 400));
        const still = await native.grabStill(640);
        await new Promise((r) => setTimeout(r, 0)); // let the screen update between pictures
        const list = findCourts({ data: decodeBase64(still.data), width: still.width, height: still.height }, {}, 3);
        if (list[0]) tops.push(list[0]);
        others.push(...list.slice(1));
      }
      const best = consensusCourt(tops);
      if (best && best.confidence >= 0.5) {
        // the best guess first, then the other courts that were found, each listed once
        const options = [best];
        for (const f of others.sort((a, b) => b.confidence - a.confidence)) {
          if (options.every((o) => courtDistance(o.corners, f.corners) > 0.05)) options.push(f);
          if (options.length >= 4) break;
        }
        courtOptions.current = options;
        setOptionNo(0);
        setOptionCount(options.length);
        setCourtSure(best.confidence >= 0.8);
        showOption(best);
        setCourtFinder('found');
      } else {
        setCourtFinder('failed');
      }
    } catch {
      setCourtFinder('failed');
    } finally {
      finderBusy.current = false;
    }
  }, []);
  // A court that is not saved yet gets drawn automatically once the camera has settled. A saved court starts locked and is left alone.
  const finderTried = useRef(false);
  useEffect(() => {
    if (finderTried.current || !usesNativeCapture || !cameraReady || !venueLoaded || !aligning || recording || dragged || venueCorners || savedCorners[sizeKey]) return;
    finderTried.current = true;
    setTimeout(() => { findCourtNow(); }, 1500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraReady, venueLoaded, aligning, recording]);
  findCourtRef.current = findCourtNow;

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
        ...(sh ? { shuttle: withoutPose(sh) } : {}),
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
  // Body poses of the players (for naming shots) and the shots named so far, saved with the game
  const poseHistory = useRef(new PoseHistory(5)).current;
  const shotRecords = useRef<ShotRecord[]>([]);
  const lastShot = useRef<{ at: number; shot: NonNullable<ShuttleStats['lastShot']> } | null>(null);
  const shotTypesOn = shuttleOn && settings.shotTypes;
  // Auto-framing: a view window that starts tight and widens when play nears the edge (see framing.ts). Only in builds whose camera can do it.
  const framingMode = effectiveFraming(settings.framing, framingAvailability(Capture));   // a mode this phone cannot do counts as off
  // The camera says what it really settled on (it falls back to off when the 4K picture is not possible); until then the wish counts.
  const [cameraFraming, setCameraFraming] = useState<'off' | 'crop' | 'lens' | null>(null);
  // Lens zoom: how tight the real lens can go (the window width at the 1x lens), from the camera; the controller's tightest window follows it
  const [wideRatio, setWideRatio] = useState(WIDE_RATIO);
  const framingOn = framingMode !== 'off' && shuttleOn && cameraFraming !== 'off';
  const framer = useRef(new Framer(fullWindow())).current;
  const previewView = useRef<ViewWindowHandle>(null);
  const worldView = useRef<ViewWindowHandle>(null);
  const [viewT, setViewT] = useState<ViewTransform | null>(null);
  const geometry = () => ({ frameAspect: FRAME_ASPECT, screenW: sizeRef.current.width, screenH: sizeRef.current.height });
  const estimator = useMemo(
    () => new ShuttleEstimator((x, y) => {
      // Only a shuttle on the floor has a floor position. Above the court's horizon, or off its ends, `air` is set and the position is not used.
      return floorPosition(mapRef.current, frameToScreen({ x, y }, { frameAspect: FRAME_ASPECT, screenW: sizeRef.current.width, screenH: sizeRef.current.height }));
    }, (hit) => {
      // Who hit the shuttle: the player nearest to it in the picture. Their spot on the floor, and the time, give the speed of the shot.
      // undefined: no player is being tracked, so nothing is known. null: players are tracked but none is near the shuttle, so it was not hit.
      if (!latest.current.tracks.some((t) => !t.lost)) return undefined;
      const h = hitterSide(frameToScreen({ x: hit.x, y: hit.y }, { frameAspect: FRAME_ASPECT, screenW: sizeRef.current.width, screenH: sizeRef.current.height }), latest.current.tracks, mapRef.current);
      return h ? { u: h.track.u, v: h.track.v, track: h.track.id } : null;
    }, (track, t) => hitPose(poseHistory.of(track), t)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // The trained shuttle model (TrackNetV3), when switched on in Settings and present in the build. While it is loading or if it
  // cannot be used, the simple tracker keeps running.
  const modelWanted = shuttleOn && settings.shuttleModel;
  const [modelStatus, setModelStatus] = useState<ShuttleModelStatus | null>(null);
  const modelActive = modelWanted && modelStatus?.state === 'ready';
  const modelFilter = useRef(new ModelTrackFilter()).current;
  // Looking only at the court: the guard says when to look at the whole frame instead
  const cropGuard = useRef(new CropGuard()).current;
  const viewFull = useRef(false);
  // Only sightings over the aligned court count
  const regionRef = useRef<((x: number, y: number) => boolean) | null>(null);
  const modelMs = useRef(0);
  const lastShuttleT = useRef(0);
  const trailFrame = useRef<{ x: number; y: number }[]>([]);
  const [trail, setTrail] = useState<{ x: number; y: number }[]>([]);
  const [shuttleDiag, setShuttleDiag] = useState('');
  // The shuttle on the court map, and where it last came down (kept on the map for a few seconds after the rally resets)
  const [shuttleMap, setShuttleMap] = useState<ShuttleOnMap | null>(null);
  const shuttleMapRef = useRef<ShuttleOnMap | null>(null);
  const landing = useRef<{ at: number; mark: ShuttleOnMap } | null>(null);
  // A guess at who won the rally, from where the shuttle was last hit and last seen. The player confirms it.
  const [suggestion, setSuggestion] = useState<Verdict | null>(null);
  const judged = useRef(false);
  const tally = useRef({ shown: 0, agreed: 0, flipped: 0, dismissed: 0, notServe: 0, cutShort: 0 });
  // The point just called: where the shuttle was last seen and when. If the shuttle comes back soon, the rally was cut short.
  const pendingCall = useRef<{ camT: number; u: number; v: number } | null>(null);
  // The rally carried on after a point was undone, so it will not start with a serve
  const continuing = useRef(false);
  const cutShortRef = useRef<() => void>(() => {});
  const [cutNote, setCutNote] = useState(false);
  // Who hit the shuttle last, from the nearest player in the picture at the moment of each hit; and how often that agrees with serve order
  const hitState = useRef<{ shots: number; side?: Side }>({ shots: 0 });
  const hitCheck = useRef({ agree: 0, differ: 0, undecided: 0, fromServe: 0, serveDisagrees: 0 });
  // After a rally ends, who serves next shows who won it. `open`: no point has been given yet (the shuttle was lost); otherwise `winner` is the point already given.
  const nextServe = useRef<{ open: boolean; winner?: Side; at: number } | null>(null);
  const keepEstimatorOnce = useRef(false);
  const inferPointRef = useRef<(side: Side, court?: Court) => void>(() => {});
  const flagPointRef = useRef<() => void>(() => {});
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
        shuttleMap: shuttleOn ? shuttleMapRef.current : undefined,
      }));
    };
    push();
    const id = setInterval(push, 250);
    return () => clearInterval(id);
  }, [recording, names, meter, config, footage, shuttleOn]);

  useEffect(() => {
    const native = Capture;
    if (!native || !shuttleOn || aligning || modelActive) return;
    const r = shuttleRoiFromCorners(corners, geometry());
    native.setShuttle(true, r.x, r.y, r.w, r.h);
    return () => native.setShuttle(false, 0, 0, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shuttleOn, aligning, corners, width, height, modelActive]);

  // The shuttle model: switch it on, watch whether it loaded, and pass its sightings through the filter to the estimator
  useEffect(() => {
    const native = Capture;
    if (!native || !modelWanted) { setModelStatus(null); return; }
    native.setShuttleModel(true);
    const poll = () => setModelStatus(native.getShuttleModelStatus());
    poll();
    const id = setInterval(poll, 500);
    const sub = native.addListener('onShuttleModel', (raw) => {
      if (!raw.frames.length) return;
      const e = { ...raw, frames: raw.frames.map((f) => (f.x !== undefined && f.y !== undefined && f.z ? { t: f.t, ...pointToReference({ x: f.x, y: f.y }, f.z) } : f)) };
      lastShuttleT.current = e.frames[e.frames.length - 1].t;
      modelMs.current = e.predictMs;
      for (const sample of modelFilter.push(e.frames)) estimator.push(sample);
      const full = cropGuard.push(regionRef.current ? e.frames.map((f) => (f.x !== undefined && f.y !== undefined && !regionRef.current!(f.x, f.y) ? { t: f.t } : f)) : e.frames);
      if (full !== viewFull.current) { viewFull.current = full; native.setShuttleModelFull(full); }
    });
    return () => { sub.remove(); clearInterval(id); native.setShuttleModel(false); modelFilter.reset(); setModelStatus(null); };
  }, [modelWanted, modelFilter, estimator]);

  // Auto-framing: a few times a second, decide the window from the players and the shuttle, move the picture and its rings to it, and tell the camera
  useEffect(() => {
    const identity = { scale: 1, tx: 0, ty: 0 };
    if (!framingOn) {
      previewView.current?.set(identity, 0);
      worldView.current?.set(identity, 0);
      setViewT(null);
      return;
    }
    const native = Capture!;
    const apply = (win: ReturnType<Framer['update']>, ms: number) => {
      const t = viewTransform(win, geometry());
      if (framingMode === 'crop') previewView.current?.set(t, ms);   // a real lens zoom already shows the zoomed picture
      worldView.current?.set(t, ms);
      native.setFramingTarget?.(framingMode === 'lens' ? 'lens' : 'crop', win.cx, win.cy, win.w);
      return t;
    };
    framer.setOptions({ panLocked: framingMode === 'lens', minW: framingMode === 'lens' ? wideRatio : WIDE_RATIO });
    if (aligning) { framer.reset(fullWindow(), Date.now() / 1000); setViewT(apply(framer.window, 0)); return; }
    const c = cornersToFrame(cornersRef.current, geometry());
    framer.reset(startWindow([c.farLeft, c.farRight, c.nearRight, c.nearLeft], framingMode === 'lens' ? wideRatio : WIDE_RATIO), Date.now() / 1000);
    setViewT(apply(framer.window, 600));
    const id = setInterval(() => {
      const subjects = playerSubjects(latest.current.tracks, mapRef.current, geometry());
      const tip = shuttleSubject(estimator.trail(lastShuttleT.current, 0.3), 0.3);
      if (tip) subjects.push(tip);
      setViewT(apply(framer.update(Date.now() / 1000, subjects), 140));
    }, 125);
    return () => { clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framingOn, framingMode, aligning, wideRatio]);

  // A hot phone: stop tightening; a very hot one: go back to the full picture (the camera and the recording come first)
  useEffect(() => {
    const hot = pressure === 'serious' || pressure === 'critical' || pressure === 'shutdown';
    framer.setOptions({ tightenRate: hot ? 0 : 0.1, minW: pressure === 'critical' || pressure === 'shutdown' ? 1 : framingMode === 'lens' ? wideRatio : WIDE_RATIO });
  }, [pressure, framer, framingMode, wideRatio]);

  // Body poses: the native side looks at the players nearest the shuttle; each pose goes to the track standing where its feet are
  useEffect(() => {
    const native = Capture;
    if (!native || !shotTypesOn) return;
    native.setPose(true);
    const sub = native.addListener('onPose', (e) => {
      for (const raw of e.poses) {
        const sample = decodePose(poseEventToReference(raw), FRAME_ASPECT);
        if (!sample) continue;
        const feet = floorPosition(mapRef.current, frameToScreen({ x: sample.box.x + sample.box.w / 2, y: sample.box.y + sample.box.h }, geometry()));
        let best: { id: number; d: number } | null = null;
        for (const t of latest.current.tracks) {
          if (t.lost) continue;
          const d = Math.hypot((t.u - feet.u) * COURT_W, (t.v - feet.v) * COURT_L);
          if (d <= 2 && (!best || d < best.d)) best = { id: t.id, d };
        }
        if (best) poseHistory.add(best.id, sample.pose);
      }
    });
    return () => { sub.remove(); native.setPose(false); poseHistory.clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shotTypesOn]);

  useEffect(() => {
    const native = Capture;
    if (!native || !shuttleOn) return;
    const sub = native.addListener('onShuttle', (e) => {
      lastShuttleT.current = e.t;
      if (e.x != null && e.y != null && (e.misses ?? 0) === 0) {
        const p = pointToReference({ x: e.x, y: e.y }, e.z);   // lens zoom: the camera reports in the zoomed picture
        estimator.push({ t: e.tTrack ?? e.t, x: p.x, y: p.y });
      }
    });
    const id = setInterval(() => {
      const now = lastShuttleT.current;
      const stats = estimator.stats(now);
      if (shotTypesOn) {
        const trail = estimator.trail(now, 0.4);
        const tip = trail[trail.length - 1];
        const zoom = framingMode === 'lens' ? 1 / framer.window.w : 1;
        const focus = tip ? pointToView(tip, zoom) : null;   // the camera looks for people in the picture it delivers
        native.setPoseFocus(focus ? focus.x : NaN, focus ? focus.y : NaN);
        for (const e of estimator.takeShots()) {
          const owner = e.track != null ? assignRef.current[e.track] ?? e.track : null;
          const player = owner != null && owner < names.length ? owner : null;
          const tMs = Date.now() - startedAt.current - (now - e.t) * 1000;
          if (recordingRef.current) shotRecords.current.push(toShotRecord(e, tMs, player));
          lastShot.current = { at: now, shot: { type: e.type, player: player != null ? names[player] : '', number: e.number, confidence: e.confidence, ...(e.pose ? { pose: e.pose } : {}) } };
        }
      }
      const shown = shotTypesOn && lastShot.current && now - lastShot.current.at < 5 ? lastShot.current.shot : null;
      setShuttle(stats && shown ? { ...stats, lastShot: shown } : stats);
      let onMap = estimator.onMap(now, judgeCtx.current.singles);
      if (onMap?.phase === 'landed') landing.current = { at: Date.now(), mark: onMap };
      else if (onMap) landing.current = null;
      else if (landing.current && Date.now() - landing.current.at < 3000) onMap = landing.current.mark;
      shuttleMapRef.current = onMap;
      setShuttleMap(onMap);
      const ctx = judgeCtx.current;
      // The next serve: who serves shows who won the rally before
      const ns = nextServe.current;
      if (ns && !ctx.over) {
        if (now - ns.at > 90) nextServe.current = null;
        else {
          const tr0 = estimator.trace();
          if (tr0.firstImage && tr0.firstSeen && tr0.firstSeen.t > ns.at && tr0.shots >= 2) {
            nextServe.current = null;
            const obs = hitterSide(frameToScreen({ x: tr0.firstImage.x, y: tr0.firstImage.y }, geometry()), latest.current.tracks, mapRef.current);
            if (obs) {
              if (ns.open) inferPointRef.current(obs.side, courtOfServer(obs.side, obs.track.u));
              else if (ns.winner !== obs.side) flagPointRef.current();
            }
          }
        }
      }
      // A new hit: who was nearest, in the picture
      {
        const tr = estimator.trace();
        if (tr.shots > hitState.current.shots) {
          hitState.current.shots = tr.shots;
          const at = tr.hitImage;
          hitState.current.side = at ? hitterSide(frameToScreen({ x: at.x, y: at.y }, geometry()), latest.current.tracks, mapRef.current)?.side : undefined;
        }
      }
      if (training && ctx.recording) {
        // nothing is scored, but the shuttle's speed and shot count start afresh between rallies
        const trace = estimator.trace();
        const calm = trace.lastSeen ? motion.calm(Date.now() / 1000, now - trace.lastSeen.t) : undefined;
        if (isRallyOver(trace, now, ctx.singles, calm)) estimator.newRally();
      }
      if (!training && ctx.recording && !ctx.over && !judged.current) {
        const trace = estimator.trace();
        let verdict: Verdict | null = null;
        const wall = Date.now() / 1000;
        const calm = trace.lastSeen ? motion.calm(wall, now - trace.lastSeen.t) : undefined;
        if (isRallyOver(trace, now, ctx.singles, calm)) {
          const sv = serveRef.current;
          const sideNames = sv.side === 'A' ? config.players.A : config.players.B;
          const playerIdx = (sv.side === 'A' ? 0 : config.players.A.length) + sv.playerIndex;
          const serverTrack = latest.current.tracks.find((x) => !x.lost && (assignRef.current[x.id] ?? x.id) === playerIdx);
          const problem = continuing.current || !sideNames.length ? null : serveProblem(trace, { side: sv.side, court: sv.court, server: serverTrack ? { u: serverTrack.u, v: serverTrack.v } : undefined });
          if (problem) {
            // Movement that did not start like a serve: a shuttle being picked up, a practice hit. Not a point.
            tally.current.notServe += 1;
            estimator.newRally();
          } else {
            // Serve order is the other way to know who hit last: sides take turns, starting with the server
            const sv2 = serveRef.current;
            const byParity: Side = trace.shots % 2 === 1 ? sv2.side : sv2.side === 'A' ? 'B' : 'A';
            const named = hitState.current.side;
            if (named) { if (named === byParity) hitCheck.current.agree += 1; else hitCheck.current.differ += 1; }
            // only the serve was seen: an ace or a service fault, decided by where the serve came down; otherwise by where the last shot did
            verdict = trace.shots === 1 ? judgeServe(trace, now, ctx.singles, { side: sv2.side, court: sv2.court }, calm) : judgeRally(trace, now, ctx.singles, calm, named ?? byParity);
            if (!verdict) {
              // over, but nobody can say who won (the shuttle vanished in the air, or too few shots): not a point, start looking again
              hitCheck.current.undecided += 1;
              if (trace.shots >= 2) nextServe.current = { open: true, at: now };
              estimator.newRally();
            }
          }
        }
        if (verdict) {
          judged.current = true;
          continuing.current = false;
          nextServe.current = { open: false, winner: verdict.winner, at: now };
          if (trace.lastSeen) pendingCall.current = { camT: now, u: trace.lastSeen.u, v: trace.lastSeen.v };
          tally.current.shown += 1;
          setSuggestion(verdict);
        }
      }
      // A point was just called: did the shuttle come back soon, near where it was lost, with the players still moving?
      const pc = pendingCall.current;
      if (pc) {
        if (now - pc.camT > CONTINUE_S) pendingCall.current = null;
        else {
          const first = estimator.trace().firstSeen;
          if (first && first.t > pc.camT) {
            pendingCall.current = null;
            if (isContinuation(pc, first, first.t - pc.camT, motion.calm(Date.now() / 1000, 1))) cutShortRef.current();
          }
        }
      }
      const frames = estimator.trail(now);
      trailFrame.current = frames;
      setTrail(frames.map((p) => frameToScreen(p, geometry())));
      const st = native.getShuttleStatus();
      const modelLine = () => {
        if (!modelWanted) return 'shuttle model: off';
        const m = native.getShuttleModelStatus();
        return `shuttle model: ${m.state}${m.problem ? ` (${m.problem})` : ''}, ${m.predictMs.toFixed(0)} ms a window, ${m.detections} sightings, ${m.windows} windows, ${m.windowsDropped} dropped, ${m.framesDropped} frames dropped${modelActive ? ', simple tracker off' : ', simple tracker running'}, court gate ${regionRef.current ? 'on' : 'off'}, looking at ${!settings.cropModel ? 'the whole frame (crop off)' : viewFull.current ? 'the whole frame (shuttle left the crop)' : 'the court crop'}`;
      };
      const t = tally.current;
      const act = motion.activity(Date.now() / 1000, 1.5);
      setShuttleDiag(`players moving: ${act === undefined ? 'unknown' : `${act.toFixed(1)} m/s`}\nscore guesses: ${t.shown} given, ${t.flipped} swapped by you, ${t.notServe} ignored (no serve), ${t.cutShort} cut short, ${hitCheck.current.undecided} undecided; last hitter by player vs serve order: ${hitCheck.current.agree} agree, ${hitCheck.current.differ} differ; points from the next serve: ${hitCheck.current.fromServe}, next serve disagreed: ${hitCheck.current.serveDisagrees}\n${modelLine()}\nshuttle: ${st.shuttleFrames} frames, candidates ${st.shuttleLastCandidates}, with candidates ${st.shuttleWithCandidates}, tracked ${st.shuttleConfirmed}, shaky ${st.shuttleShaky}`);
    }, 120);
    return () => { sub.remove(); clearInterval(id); setShuttle(null); setTrail([]); trailFrame.current = []; shuttleMapRef.current = null; setShuttleMap(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shuttleOn, estimator, modelWanted, modelActive, shotTypesOn, names, framingMode]);

  // Once the court is locked, the model is shown only the court and the air above it, so the shuttle is bigger to it
  useEffect(() => {
    const native = Capture;
    if (!native || !modelWanted) return;
    const crop = aligning || !settings.cropModel || framingMode === 'lens' ? null : modelCrop(shuttleRoiFromCorners(corners, geometry()), FRAME_ASPECT);
    cropGuard.setCrop(crop);
    viewFull.current = false;
    native.setShuttleModelFull(false);
    native.setShuttleModelCrop(crop?.x ?? 0, crop?.y ?? 0, crop?.w ?? 0, crop?.h ?? 0);
    return () => { native.setShuttleModelCrop(0, 0, 0, 0); native.setShuttleModelFull(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelWanted, aligning, corners, width, height, settings.cropModel, framingMode]);

  useEffect(() => {
    const region = aligning || !settings.courtOnly ? null : courtRegion(cornersToFrame(corners, { frameAspect: FRAME_ASPECT, screenW: width, screenH: height }));
    regionRef.current = region;
    modelFilter.setRegion(region);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aligning, corners, width, height, settings.courtOnly]);

  useEffect(() => {
    if (keepEstimatorOnce.current) {
      // a point was given from the next serve, which is already being tracked: do not wipe it
      keepEstimatorOnce.current = false;
      judged.current = false;
      setSuggestion(null);
      return;
    }
    estimator.newRally();
    modelFilter.reset();
    hitState.current = { shots: 0 };
    judged.current = false;
    setSuggestion(null);
  }, [state.rallies.length, estimator, modelFilter]);
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

  // A rally ended with the shuttle lost, and now someone has served: they won it. The serve is already being tracked, so the point is
  // added without resetting the estimator.
  inferPointRef.current = (side, court) => {
    if (!recordingStarted.current || state.matchWinner) return;
    const expected = { A: addRally(state, { winner: 'A', source: 'auto' }).serve, B: addRally(state, { winner: 'B', source: 'auto' }).serve };
    const r = inferWinnerFromServe(expected, { side, court });
    const at = Date.now() - startedAt.current;
    const next = addRally(state, { winner: r.winner, startMs: lastEnd.current, endMs: at, source: 'auto', confidence: r.confidence });
    lastEnd.current = at;
    keepEstimatorOnce.current = true;
    hitCheck.current.fromServe += 1;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAutoPoint({ winner: r.winner, index: next.rallies.length - 1 });
    persist(next);
  };
  // The next serve is by the other side to the one that was given the last point: one of the two is wrong, so mark it for checking.
  flagPointRef.current = () => {
    const i = state.rallies.length - 1;
    const last = state.rallies[i];
    if (!last || last.source !== 'auto') return;
    hitCheck.current.serveDisagrees += 1;
    persist(editRally(state, i, { confidence: Math.min(0.3, last.confidence ?? 1) }));
  };

  // The shuttle came back soon after a point was called: the rally was cut short. Take the point back and let it carry on.
  cutShortRef.current = () => {
    if (!autoPoint || state.rallies.length !== autoPoint.index + 1 || state.rallies[autoPoint.index].source !== 'auto') return;
    tally.current.agreed -= 1;
    tally.current.cutShort += 1;
    nextServe.current = null;
    continuing.current = true;
    setAutoPoint(null);
    setCutNote(true);
    persist(undoLast(state));
  };
  useEffect(() => {
    if (!cutNote) return;
    const id = setTimeout(() => setCutNote(false), 5000);
    return () => clearTimeout(id);
  }, [cutNote]);

  const onPoint = useCallback((winner: Side) => {
    if (!recordingStarted.current) return;
    pendingCall.current = null;
    nextServe.current = null;
    continuing.current = false;
    const now = Date.now() - startedAt.current;
    const next = addRally(state, { winner, startMs: lastEnd.current, endMs: now, source: 'manual' });
    lastEnd.current = now;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    persist(next);
  }, [state, persist]);

  const onUndo = () => { nextServe.current = null; persist(undoLast(state)); };

  const endingRef = useRef(false);
  // Cover the screen, turn the phone to portrait and wait for it to finish turning, then leave. Leaving first would show the landscape
  // screen squeezed while it turned.
  const leaveTo = async (go: () => void) => {
    setEnding(true);
    await new Promise((r) => setTimeout(r, 60));          // let the cover be drawn
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    await new Promise((r) => setTimeout(r, 350));         // the turn itself
    go();
  };
  const goBack = () => { if (endingRef.current) return; endingRef.current = true; leaveTo(() => router.back()); };
  const endMatch = async () => {
    if (endingRef.current) return;
    if (!recordingStarted.current && state.rallies.length === 0) { goBack(); return; } // nothing was recorded
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
        ...(shotRecords.current.length ? { shots: shotRecords.current } : {}),
        ...(framingOn && (cameraFraming === 'crop' || cameraFraming === 'lens') ? { framing: cameraFraming } : {}),
      });
    }
    if (shuttleLogUri.current) {
      Capture?.stopShuttleLog();
      keepFile(shuttleLogUri.current, `${id}.shuttle.csv`);
      shuttleLogUri.current = null;
    }
    const analysis = recorder.current?.analysisUri;
    if (analysis) keepFile(analysis, `${id}.analysis.mp4`);
    const kept = uri ? keepFile(uri, `${id}.${extensionOf(uri)}`) : null;
    await finishMatch(id, kept, startedAt.current ? Date.now() - startedAt.current : 0);
    // The iPhone camera draws the overlay while recording, so that file is already the finished video.
    const baked = kept != null && recorder.current?.bakesOverlay === true && !footage;
    if (baked) await setOverlayVideo(id, kept);
    // Otherwise, on an iPhone dev build, Review makes the video with the overlay drawn in right away
    await leaveTo(() => router.replace({ pathname: '/match/[id]', params: { id, ...(kept && !baked && !footage && canExportOnDevice ? { export: '1' } : {}) } }));
  };

  // The last point was given by the camera: turn it round (what "Wrong, swap" does, but without needing its short-lived banner)
  const swapLastPoint = () => {
    const i = state.rallies.length - 1;
    const last = state.rallies[i];
    if (!last || last.source !== 'auto') return;
    tally.current.agreed -= 1;
    tally.current.flipped += 1;
    setAutoPoint(null);
    persist(editRally(state, i, { winner: last.winner === 'A' ? 'B' : 'A', source: 'manual' }));
  };

  // --- The camera moved? Once recording, the picture is compared with the one at the moment the court was locked. A small steady move
  // moves the court with it; a big one is a warning to set the court again. ---
  const [courtNote, setCourtNote] = useState<{ text: string; warn: boolean } | null>(null);
  useEffect(() => {
    const native = Capture;
    if (!native || !usesNativeCapture || footage || aligning || !recording) return;
    let alive = true;
    let ref: Reference | null = null;
    let before: { dx: number; dy: number } | null = null;
    let following = false;
    const locked = cornersRef.current;           // where the court was locked: every shift is measured from here
    let timer: ReturnType<typeof setTimeout> | null = null;
    const look = async () => {
      try {
        const still = await native.grabStill(640);
        if (!alive) return;
        const img = { data: decodeBase64(still.data), width: still.width, height: still.height };
        if (!ref) { ref = reference(img); return; }
        const s = shiftFrom(ref, img);
        const call = judgeShift(s, before);
        before = { dx: s.dx, dy: s.dy };
        if (call.kind === 'in-place') {
          if (following) { following = false; setDragged(locked); }
          setCourtNote(null);
        } else if (call.kind === 'follow' && settings.courtFollow) {
          following = true;
          setDragged(followCorners(locked, { dx: call.dx, dy: call.dy }, { frameAspect: FRAME_ASPECT, screenW: sizeRef.current.width, screenH: sizeRef.current.height }));
          setCourtNote({ text: `The camera moved a little (${(Math.hypot(call.dx, call.dy) * 100).toFixed(1)}%), so the court moved with it.`, warn: false });
        } else if (call.kind === 'lost' || (call.kind === 'follow' && !settings.courtFollow)) {
          setCourtNote({ text: 'The phone or tripod has moved. Tap Re-align court to set the court again.', warn: true });
        }
      } catch {
        // a picture that could not be had is not a reason to say anything
      } finally {
        if (alive) timer = setTimeout(look, 8000);
      }
    };
    timer = setTimeout(look, 1500);
    return () => { alive = false; if (timer) clearTimeout(timer); setCourtNote(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, aligning, footage, settings.courtFollow]);
  // a note that the court followed a small move goes away by itself
  useEffect(() => {
    if (!courtNote || courtNote.warn) return;
    const id = setTimeout(() => setCourtNote(null), 6000);
    return () => clearTimeout(id);
  }, [courtNote]);

  // --- The Apple Watch: it shows what the camera sees and the score, and its buttons come back here ---
  // The latest versions of the actions, for the listener below, which is set up once
  const watchActions = useRef({ point: (_side: Side) => {}, undo: () => {}, swap: () => {}, end: () => {}, lock: () => {} });
  watchActions.current = { point: onPoint, undo: onUndo, swap: swapLastPoint, end: () => { endMatch(); }, lock: lockCourt };
  // whether the court is still being set up (not locked, not being tapped, no lens switching), for the lock command
  const watchCtx = useRef({ aligning: true, busy: false });
  watchCtx.current = { aligning, busy: !!tapPoints || lensBusy || courtFinder === 'finding' };
  useEffect(() => {
    if (!Capture || !usesNativeCapture) return;
    const sub = Capture.addListener('onWatchCommand', (e) => {
      const cmd = parseWatchCommand(e);
      if (!cmd) return;
      const st = liveState.current;
      const last = st.rallies[st.rallies.length - 1];
      const allowed = watchCommandAllowed(cmd, {
        recording: recordingStarted.current,
        over: !!st.matchWinner,
        training: !!st.config.training,
        ending: endingRef.current,
        rallies: st.rallies.length,
        lastSource: last?.source,
        aligning: watchCtx.current.aligning,
        busy: watchCtx.current.busy,
      });
      if (!allowed) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      switch (cmd.kind) {
        case 'point': watchActions.current.point(cmd.side); break;
        case 'undo': watchActions.current.undo(); break;
        case 'swap': watchActions.current.swap(); break;
        case 'end': watchActions.current.end(); break;
        case 'lock': watchActions.current.lock(); break;
        default: break; // starting a game is for the rest of the app (src/components/WatchLink.tsx)
      }
    });
    return () => sub.remove();
  }, []);
  // Tell the watch how the game stands: when anything it shows changes, and as the clock ticks
  useEffect(() => {
    if (!Capture || !usesNativeCapture) return;
    Capture.sendWatchState(buildWatchState({ state, recording, elapsedMs: elapsed, fps, freeBytes: freeSpaceBytes(), locked: !aligning, training }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, recording, Math.floor(elapsed / 1000), fps, aligning, training]);
  // The picture for the watch, while this screen is open (so the framing can be checked before the court is locked too)
  useEffect(() => {
    const native = Capture;
    if (!native || !usesNativeCapture) return;
    native.setWatchPreview(settings.watchPreview);
    return () => native.setWatchPreview(false);
  }, [settings.watchPreview]);

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
      <ViewWindow ref={previewView}>
      <RecorderView
        ref={recorder}
        style={StyleSheet.absoluteFill}
        onReady={onReady}
        onError={setRecError}
        onFps={setFps}
        lens={settings.lens}
        analysisCopy={settings.keepAnalysisCopy && !footage}
        framing={framingOn ? framingMode : 'off'}
        onFraming={(mode, ratio) => { setCameraFraming(mode); if (mode === 'lens' && ratio) setWideRatio(ratio); }}
        onLens={setLensInfo}
        detection={isExpoGo ? undefined : { enabled: !aligning, roi, onDetections: bridge.emit }}
        videoProfile={usesNativeCapture ? profile : undefined}
        onInterruption={(info) => setPausedBecause(info.interrupted ? info.reason : null)}
        onPressure={setPressure}
      />
      </ViewWindow>
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
          shuttleMap={shuttleOn ? shuttleMap : undefined}
          mapTop={T + 40}
          worldRef={worldView}
          worldView={viewT}
        />
      )}

      <View style={[s.chipRow, { left: L, top: T }]} pointerEvents="box-none">
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
        {training && <View style={s.chip}><Text style={[s.chipText, { color: colors.accent }]}>Training · no score</Text></View>}
        {footage && <View style={s.chip}><Text style={[s.chipText, { color: colors.accent }]}>Footage capture · no overlay</Text></View>}
        {!aligning && <Text style={s.chip2} onPress={() => setAligning(true)} accessibilityRole="button">Re-align court</Text>}
      </View>

      {courtNote && !aligning && (
        <Text style={[s.err, { top: T + 60, left: (width - 380) / 2, width: 380, backgroundColor: courtNote.warn ? 'rgba(160,110,20,0.95)' : 'rgba(20,90,60,0.92)' }]}>{courtNote.text}</Text>
      )}

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

      {!aligning && !footage && !training && (
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

      {venueLoaded && aligning && !tapPoints && (
        <View style={[s.banner, { bottom: B, left: (width - 440) / 2, width: 440 }]}>
          <Text style={s.bannerText}>
            {courtFinder === 'finding' ? 'Looking for the court lines… ' : courtFinder === 'found' ? (courtSure ? 'We drew the court from the camera. Drag any dot that is off onto its corner, then lock it. ' : 'This is only a guess at the court. Check every dot and drag it onto its corner, or tap Try another. ') : courtFinder === 'failed' ? 'We could not find the court lines. Drag the four dots onto the corners of the court. ' : lensChanged ? 'The lens changed, so the court looks different. Drag the four dots onto the corners again. ' : staleCourt ? 'This phone\'s screen is a different shape from when the court was saved. Check the four dots. ' : 'Drag the four dots onto the outer corners of the court. Recording starts when you lock it. '}
            {offScreenCorner ? 'A corner is off the screen, so its dashed dot sits on the edge. Drag it and the corner moves three times as far. ' : ''}
            {venue ? `It is saved for ${venue.name}.` : ''}
          </Text>
          <Button label={recording ? 'Lock court' : 'Lock court and start recording'} onPress={lockCourt} />
        </View>
      )}

      {cutNote && !aligning && (
        <View style={[s.banner, { top: T + 8, left: (width - 360) / 2, width: 360 }]} pointerEvents="none">
          <Text style={s.bannerText}>The rally carried on, so the last point was taken back</Text>
        </View>
      )}

      {autoPoint && state.rallies.length === autoPoint.index + 1 && !aligning && !cutNote && (
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
        {!training && <Button kind="ghost" label="Fix last point" onPress={onUndo} disabled={state.rallies.length === 0} />}
        <Button label={training ? 'End session' : state.matchWinner ? 'Finish now' : 'End game'} onPress={endMatch} disabled={ending} />
      </View>
      )}
      {aligning && !recording && !tapPoints && (
        // The buttons for setting the court up, before it is locked: large enough to hit with a thumb. Stacked on the left so they never
        // sit under the score card; the court's dots are drawn after this, so they are always on top.
        <View style={[s.actionCol, { left: L, top: T + 40 }]} pointerEvents="box-none">
          <Pressable style={s.big} onPress={goBack} accessibilityRole="button" accessibilityLabel="Back">
            <Text style={s.bigText}>‹ Back</Text>
          </Pressable>
          {usesNativeCapture && (
            <Pressable style={s.big} onPress={() => { findCourtNow(); }} disabled={courtFinder === 'finding'} accessibilityRole="button" accessibilityLabel="Find the court lines">
              <Text style={s.bigText}>{courtFinder === 'finding' ? 'Looking…' : 'Find court'}</Text>
            </Pressable>
          )}
          {usesNativeCapture && courtFinder === 'found' && optionCount > 1 && (
            <Pressable style={s.big} onPress={nextOption} accessibilityRole="button" accessibilityLabel="Try another court">
              <Text style={s.bigText}>Try another ({optionNo + 1}/{optionCount})</Text>
            </Pressable>
          )}
          <Pressable style={s.big} onPress={() => setTapPoints([])} accessibilityRole="button" accessibilityLabel="Tap the four court corners">
            <Text style={s.bigText}>Tap corners</Text>
          </Pressable>
          {lensInfo && lensInfo.available.length > 1 && (
            // one button that goes to the next lens each time it is tapped, and round to the first after the last
            <Pressable style={s.big} onPress={nextLens} disabled={lensBusy} accessibilityRole="button" accessibilityLabel={`Camera lens ${LENS_LABEL[lensInfo.lens] ?? lensInfo.lens}. Tap for the next lens.`}>
              <Text style={s.bigText}>{lensBusy ? 'Switching…' : `⟳ Lens ${LENS_LABEL[lensInfo.lens] ?? lensInfo.lens}`}</Text>
            </Pressable>
          )}
        </View>
      )}

      {venueLoaded && aligning && !tapPoints && (
        // drawn last so a corner is never hidden behind another control
        <CourtAligner corners={corners} onChange={setDragged} width={width} height={height} />
      )}
      {aligning && tapPoints && (
        // taps anywhere below the buttons place the next corner
        <>
          <Pressable
            style={{ position: 'absolute', left: 0, right: 0, top: T + 48, bottom: 0 }}
            onPress={(e) => tapCorner(e.nativeEvent.pageX, e.nativeEvent.pageY)}
            accessibilityLabel="Tap the next court corner"
          />
          {tapPoints.map((p, i) => (
            <View key={i} pointerEvents="none" style={[s.tapDot, { left: p.x - 13, top: p.y - 13 }]}>
              <Text style={s.tapDotText}>{i + 1}</Text>
            </View>
          ))}
          <View style={[s.banner, { top: T + 52, left: (width - 400) / 2, width: 400 }]} pointerEvents="box-none">
            <Text style={s.bannerText}>
              Tap corner {tapPoints.length + 1} of 4: the {['far left', 'far right', 'near right', 'near left'][tapPoints.length]} corner of the court. Far is the end away from you. You can drag the dots afterwards.
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {tapPoints.length > 0 && <Button kind="ghost" label="Undo last tap" onPress={() => setTapPoints(tapPoints.slice(0, -1))} style={{ flex: 1 }} />}
              <Button kind="ghost" label="Cancel" onPress={() => setTapPoints(null)} style={{ flex: 1 }} />
            </View>
          </View>
        </>
      )}
      {ending && (
        // covers everything while the phone turns back to portrait
        <View style={[StyleSheet.absoluteFill, s.cover]} pointerEvents="auto">
          <Text style={s.h}>Saving…</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  cover: { backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  center: { justifyContent: 'center' },
  h: { color: colors.text, fontSize: 22, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 14 },
  chipRow: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(5,9,10,0.62)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  chip2: { color: '#fff', fontSize: 12, fontWeight: '600', backgroundColor: 'rgba(5,9,10,0.62)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  actionCol: { position: 'absolute', gap: 8, alignItems: 'flex-start' },
  big: { minHeight: 44, justifyContent: 'center', backgroundColor: 'rgba(5,9,10,0.72)', borderRadius: 22, paddingHorizontal: 18, paddingVertical: 10 },
  bigText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  chipText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  tapDot: { position: 'absolute', width: 26, height: 26, borderRadius: 13, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  tapDotText: { color: '#05090A', fontWeight: '800', fontSize: 13 },
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
