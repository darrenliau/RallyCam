# RallyCam

Badminton match recorder and tracker. React Native (Expo SDK 58, TypeScript, Expo Router).

## What works now
- **Match setup:** singles or doubles and player names. One game per recording: it stops by itself when someone wins (21, win by 2, cap 30). The engine still supports best of 3.
- **Recording:** starts when you lock the court (a venue with a saved court starts straight away), landscape, asks the camera for 120 fps with stabilisation off (react-native-vision-camera), screen kept awake, video saved with the match. The chip on the Record screen shows the frame rate the phone actually gave. Below 60 fps it warns you.
- **Scoring engine** (`src/engine`): pure TypeScript, unit tested. 21 points, win by 2, cap at 30, serve court and doubles court swapping, undo, fix any earlier point and re-score.
- **Storage:** local SQLite (`src/db`). Matches and rallies. Nothing leaves the phone.
- **Venues:** name a venue on the New match screen. The court alignment you lock during a match is saved to it, so the next match there starts already aligned. Saved as fractions of the screen, so it survives restarts. If you open it on a phone with a different screen shape, the app asks you to check the dots again.
- **Shuttle speed and shot count cards:** show dashes ("needs shuttle tracking") until a shuttle tracker exists. In debug builds, "Simulate players" also feeds made-up values so you can see the layout.
- **Court alignment and player tags:** drag four corners onto the court, then each tracked player gets a ring, a name tag (tap two tags to swap), a distance total and a court-map dot. Needs a tracker to feed it (see below).
- **Overlay replay:** while recording, the overlay data (player positions, tags, distances, shuttle speed and shot labels) is saved about four times a second. The score comes from the saved points. The Review screen draws the same overlay over the video, in step with playback, with an on/off switch. The video file itself is not changed, so the overlay is not inside the .mp4 if you share it outside the app (see below).
- **Review:** video, score chart per game, every point, change who won a point.

## Not built yet
- **Automatic scoring.** `src/analysis/types.ts` is the seam. Until the tracker exists, the Record screen shows two dev-only buttons (debug builds) to add points. Production builds show none.
- **The native person detector.** The tracking logic is done and tested (`src/analysis/tracker.ts`). What is missing is the code that finds people in camera frames, see "Person detector" below.
- **Real shuttle tracking.** The overlay is finished but nothing feeds it yet. In debug builds, "Simulate players" on the Record screen sends fake players so you can see it. `src/analysis/players.ts` has the `PlayerTracker` interface to implement.
- Shot stats (see the Phase 0 plan).
- App icon and splash, store listings.

## Camera backends
- **Development or store build:** vision-camera, up to 120 fps. Needs a native build (`eas build --profile development`).
- **Expo Go:** falls back to expo-camera at the standard frame rate, because Expo Go cannot load vision-camera. Good for trying the screens, not for judging tracking quality.
- The 120 fps request is best effort. I have not been able to run it on a device from the build environment, so check the fps chip on a real phone first. If it settles on 60 or 30, look at `onSessionConfigSelected` in `src/camera/VisionRecorder.tsx`.

## Test on an iPhone (Expo Go)
1. Install **Expo Go** from the App Store.
2. On your computer: clone the repo, `npm install`, `npx expo start`. Phone and computer must be on the same Wi-Fi (or use `npx expo start --tunnel`).
3. Scan the QR code with the iPhone Camera app. It opens in Expo Go and asks for camera and microphone access.
4. Start a match, lock the court, then tap "Simulate players" (debug builds only) to see the tags.

## Run it
```
npm install
npm test            # scoring engine
npm run typecheck
npx expo start      # scan the QR code with a development build
```
Camera recording works on a real phone, not in a simulator or on the web. Expo Go is fine for now. Once native modules such as vision-camera are added you need a development build (`eas build --profile development`).

## Before the first store build
- Bundle ID and Android package are `com.darrenliau.rallycam` (`app.json`). Apple ties the ID to your account once registered.
- Add the app icon and splash.
- Apple Developer ($99/yr) and Google Play ($25 once) accounts, then `npx eas-cli@latest build` and `submit`.
- Write the privacy policy (video stays on the device).

## Layout
```
src/app/        screens (Expo Router): (tabs)/index|new|stats, record, match/[id]
src/engine/     scoring rules, stats, formatting (pure, tested)
src/db/         SQLite schema and queries
src/analysis/   interface for the future tracker
src/components/ shared UI
```

## Development build for the iPhone (120 fps)
1. Apple Developer account ($99/yr). `npm i -g eas-cli`, `eas login`.
2. `eas device:create` to register the iPhone, then `eas build --profile development --platform ios`.
3. Install the build from the link EAS gives you, then `npx expo start --dev-client` and open it on the phone.

## Person detector
Runs inside the camera component (`src/camera/VisionRecorder.tsx`), in development and store builds only (Expo Go shows "Players" chip hidden and no tracking).

How it works, once the court is locked:
1. A second vision-camera output delivers RGB frames. About 15 per second are analysed (the video output still records at the full frame rate).
2. `roiFromCorners` takes the part of the frame around the court. `cropResizeRgb` scales it to 300 x 300 RGB. Looking only at the court gives the model far more pixels per player than the whole frame would.
3. `react-native-fast-tflite` runs `assets/models/ssd_mobilenet_v2_coco_quant_postprocess.tflite` (see `assets/models/README.md` for its input/output contract and licence).
4. `decodeDetections` keeps the "person" boxes and maps them back to whole-frame coordinates. They go through `DetectionBridge` to `DetectorPlayerTracker`, which drives the rings, tags, court map and distances.
5. The Record screen shows a "Players 3/4" chip: how many players were seen in the latest frame.

What has been checked: the preprocessing and decoding are unit tested, and I ran this exact code on a real doubles photo with the real model (through a Python TFLite runtime). It found all four players with boxes on them, plus one spectator with a low score, which the tracker ignores.

What has not been checked, because it needs a phone:
- That the worklet runtime can call the TFLite model directly (the vision-camera v5 docs say it can).
- The real pixel layout of RGB frames on iOS and Android (BGRA vs RGBA is handled, odd cases show an error on screen).
- Whether the camera still delivers 120 fps with the extra frame output. Watch the fps chip.
- Speed, battery and heat. The model runs on the CPU. Try `['core-ml']` or `['android-gpu']` in `useTensorflowModel` later.
- Accuracy on your footage. Judge that with the offline test below, and replace the model if it is weak. Anything that keeps the contract in `assets/models/README.md` drops in.

## Check the tracker on real footage (offline)
Before writing the native detector, see how well a person detector plus our tracker does on Phase 0 clips:
```
pip install torch torchvision opencv-python
python3 tools/detect_people.py data/raw/s01.mp4 --out data/predictions/s01_people.csv           # small mobile-class model
python3 tools/detect_people.py data/raw/s01.mp4 --out data/predictions/s01_people_big.csv --model fasterrcnn   # best case
npx tsx tools/evaluate-tracking.ts --session s01 --doubles --analysis-fps 15
```
It needs `data/labels/s01_court.json` (the four court corners in video pixels, same file as the Phase 0 labelling spec). The report shows how often all players are seen, gaps, distance moved and possible identity swaps ("jumps"). For positional accuracy, hand-label about 50 frames in `data/labels/s01_players.csv` (`frame,id,x,y`: the player's feet in pixels, id 0 and 1 for the near side left to right, 2 and 3 for the far side) and add `--gt data/labels/s01_players.csv`.
The Python script has not been run against real weights from the build environment, only syntax-checked.

## Live recording with the overlay in the video (iPhone)
On an iPhone development build the app uses its own camera (`modules/rallycam-export/ios/CaptureController.swift`, AVFoundation) instead of vision-camera. It shows the preview, records at 1080p and up to 120 fps where the phone allows it, and draws the overlay onto every frame while recording (Core Image, on the GPU), writing an H.264 + AAC .mp4 at 60 frames per second. When the game ends the file is already the finished video with the overlay in it, so there is no export step and no waiting. The raw 120 fps frames are only used for tracking.
- The overlay for the current moment is built in JavaScript (`buildLiveScene`) and sent to the camera about four times a second. Scores change at once, rings and tags follow the players with a small delay.
- Lens: the native camera (and vision-camera) prefer the ultra-wide camera (0.5x) when the phone has one, because it sees more of the court from close range. It is used unless the main camera can run at a higher frame rate. Distortion correction is turned on so court lines stay straight. The Record screen's debug line shows which lens is in use. A court alignment saved with another lens (or in Expo Go) will not fit: tap Re-align court once.
- Player detection on this path uses Apple's Vision framework (`VNDetectHumanRectanglesRequest`) on the court area, about 15 times a second, instead of the TFLite model. The tracker after it is the same. Compare the two on real footage: set `PREFER_NATIVE_CAPTURE` to `false` in `src/camera/RecorderView.tsx` to go back to vision-camera and the TFLite detector.
- Expo Go and Android are unchanged (expo-camera, and vision-camera).
- Not checked on a phone: I could not compile Swift. Things to look at first: whether the fps chip reads 120 (or 60), whether the preview matches the overlay, whether the saved video plays with sound and the overlay the right way up, and how warm the phone gets.

## Development build with Xcode (free Apple ID, needs a Mac)
1. Install Xcode from the Mac App Store, then open it once and accept the licence. Install CocoaPods: `brew install cocoapods` (or `sudo gem install cocoapods`).
2. `git clone https://github.com/darrenliau/RallyCam.git && cd RallyCam && npm install`
3. `npx expo prebuild --platform ios` creates the `ios` folder (it is generated, and is git-ignored).
4. `open ios/RallyCam.xcworkspace`
5. In Xcode: click the RallyCam project, then Signing & Capabilities. Tick "Automatically manage signing", choose your Apple ID as Team (add it under Xcode > Settings > Accounts if it is missing, it appears as "Personal Team").
6. Plug in the iPhone, trust the computer, turn on Developer Mode (Settings > Privacy & Security), pick the phone at the top of Xcode and press Run.
7. First launch: Settings > General > VPN & Device Management, trust your developer profile.
8. `npx expo start --dev-client` and open the app. A free account's install lasts 7 days, then run it again from Xcode.
If the free team says the bundle ID is unavailable, change `ios.bundleIdentifier` in `app.json` to something unique, then run `npx expo prebuild --platform ios --clean`.

## Overlay inside the video file
Recorded videos are moved from the camera's temp folder into the app's documents folder when a game ends, so iOS does not clear them.

On the Review screen, **Share video** and **Share overlay** send the video and an `.ass` subtitle file (named like the video) to a computer, for example by AirDrop. The overlay file is generated by `src/export/ass.ts` from the data saved while recording. It draws the scoreboard, shuttle speed and shot cards, court map, distance card, and the player rings and name tags.

- **To watch it:** put both files in one folder and open the video in VLC or IINA. The overlay shows over the video.
- **To burn it in:** `brew install ffmpeg`, then `tools/burn-overlay.sh game.mov game.ass game-with-overlay.mp4`. It re-encodes at 30 fps by default (the camera records 120, which makes a huge file), using the Mac hardware encoder when available. Pass `0` as the fourth argument to keep the original frame rate.

Checked: I rendered a test overlay onto a video with ffmpeg and libass and looked at the frames, and timed a 2 minute overlay (about 17 KB of overlay file per second of video at the default two updates a second; the overlay added about a quarter to the encoding time).
### On the phone (iPhone, experimental)
`modules/rallycam-export` is a small native iOS module (Swift, AVFoundation). It reads the recorded video frame by frame, draws the same overlay scene (`buildScene` in `src/export/ass.ts`) on every frame with Core Graphics, keeps about 30 frames per second, and writes a new H.264 .mp4 with AAC audio. When a game ends in an iPhone development build, Review opens and makes the video with the overlay automatically, with a progress bar and Cancel. The result is stored with the game, and the original (full frame rate) video is kept too. If you cancel or it fails, the original plays with the in-app overlay as before. **Save video with overlay** and **Share video with overlay** are on the Review screen. It only appears in a development build on an iPhone, not in Expo Go or on Android.
I wrote it without being able to compile Swift, so expect the first Xcode build to need fixes. After pulling: `npx expo prebuild --platform ios` (this installs the module's pod), then build in Xcode. ffmpeg-kit was not used because it was retired and its iOS binaries are no longer published.

## Development build with Xcode (free Apple ID, needs a Mac)
1. Install Xcode from the Mac App Store, then open it once and accept the licence. Install CocoaPods: `brew install cocoapods` (or `sudo gem install cocoapods`).
2. `git clone https://github.com/darrenliau/RallyCam.git && cd RallyCam && npm install`
3. `npx expo prebuild --platform ios` creates the `ios` folder (it is generated, and is git-ignored).
4. `open ios/RallyCam.xcworkspace`
5. In Xcode: click the RallyCam project, then Signing & Capabilities. Tick "Automatically manage signing", choose your Apple ID as Team (add it under Xcode > Settings > Accounts if it is missing, it appears as "Personal Team").
6. Plug in the iPhone, trust the computer, turn on Developer Mode (Settings > Privacy & Security), pick the phone at the top of Xcode and press Run.
7. First launch: Settings > General > VPN & Device Management, trust your developer profile.
8. `npx expo start --dev-client` and open the app. A free account's install lasts 7 days, then run it again from Xcode.
If the free team says the bundle ID is unavailable, change `ios.bundleIdentifier` in `app.json` to something unique, then run `npx expo prebuild --platform ios --clean`.

## Overlay inside the video file (not built yet)
Today the overlay is drawn over the video by the app. To bake it into an exported .mp4, the saved overlay data has to be rendered onto the video frames by a native encoder. Routes, none tried:
- Draw each overlay state to an image (react-native-view-shot) and composite with a video library. Overlay changes about four times a second, so about 4 images per second of video.
- Generate ASS subtitles from the overlay data (score, speed and shot text are plain text, the court map can be vector drawings) and burn them in with an ffmpeg build that includes libass. ffmpeg-kit was retired upstream, so this needs a maintained fork.
- AVFoundation (iOS) and MediaCodec/OpenGL (Android) native modules that draw the overlay while re-encoding.
Any of these needs a development build and a re-encode, which takes time and quality on a 120 fps clip. Decide what resolution and frame rate the exported file should have first.


## Settings, guide and recovery

- **Settings** (from the Games tab): video quality (Standard / High / Best, with MB per minute and free space shown), delete saved videos, replay the first-run guide, and the experimental shuttle switch.
- **First-run guide:** shown once, reopenable from Settings.
- **Recovery:** games cut off by a call, crash or full storage are finished at the next app start from the points and video already saved. Empty games are removed.

## Experimental shuttle tracker

Settings > Shuttle tracking (experimental). iPhone native camera only. The camera looks for small fast-moving blobs inside the court area (`ShuttleTracker.swift`), and `src/analysis/shuttleMotion.ts` / `shuttleStats.ts` turn them into a rough speed and shot count. Accuracy is unknown and needs tuning on a real court.

- The Record screen debug line shows frames seen, candidates, tracked and shaky counts.
- While recording, a CSV log of what the tracker saw is saved next to the game. On the Review screen, use the shuttle log card to share it for study on a computer.

## Automatic scoring (first version)

With the experimental shuttle tracker on, the app scores rallies by itself. `src/analysis/rallyEnd.ts` waits until the shuttle has been out of sight for 1.6 s after at least two shots, then applies one rule: the last hitter wins only if the shuttle crossed the net and came down inside the court (singles lines in singles). Into the net or out loses the point. The point is added straight away, saved as `auto` with a confidence (lower near lines or the net), and a small "Point to X (automatic) / Wrong, swap" notice shows for 6 s. "Fix last point" and the manual score buttons still work. After the game, the Review screen flags automatic points with confidence under 0.6 so you can check them against the footage and flip any that are wrong. The debug panel counts points given and points you swapped.

Known weak spots: the shuttle's floor position is only right when it is low, so high or far landings are guesses; rallies where the tracker loses the shuttle mid-flight end early.

Serve check: before a rally is judged, `serveProblem` (in `rallyEnd.ts`) checks that the shuttle first appeared on the serving side, in the right or left half for the serving court, and within about 3.5 m of the server when that player is tracked. Movement that does not start like a serve (a shuttle being picked up, a practice hit) is thrown away and counted as "ignored (no serve)" in the debug panel instead of becoming a point.

## Players crossing, and players versus the shuttle tracker

- **Crossing:** two players on the same side closer than about 1.3 m are "in contact". While in contact the tracker trusts each player's expected path over the detector, keeps their speed so they carry on past each other, and does not start a new player from a merged box. Shirt colour (average torso colour from the detector, `look`) is learned while a player is alone, and counts against a match when it differs, so players who touch and turn back are told apart. Without colour (Expo Go / Android path) a turn-back after overlapping can still swap ids. See `src/analysis/tracker.ts` and the "players crossing over" tests.
- **Players versus shuttle:** the shuttle tracker is given each player's box, widened for arms and racket (`playerMask`). Movement inside it does not count towards "the picture shook", and blobs inside it cannot start a new shuttle track (an existing track can still pass through). Boxes older than 0.6 s are ignored. The Swift side is `ShuttleTracker.swift` and `CaptureController.swift`.

## Camera lens

On iPhone, while lining up the court (before recording starts) the top-left row shows the lenses the phone has: 0.5× (ultra-wide), 1× (wide) and Tele where there is one. Tapping one switches the camera without leaving the screen, then asks you to drag the court corners again because the picture changes. The choice is remembered (Settings table, `lens`) and used next time; the default "auto" is the widest lens that can keep the frame rate. The lens cannot be changed once recording has started. Native side: `CaptureController.switchLens` and `availableLenses`.

## Shuttle on the court map

With shuttle tracking on, the court map card shows the shuttle: a yellow dot while it is being tracked ("in play"; the position is rough because the shuttle is above the floor), and a ring where it came down once it is lost while moving down the picture. The ring is green inside the lines and red outside (singles lines in singles) and stays about 3 s, even after the point has been given. A shuttle lost while going up or sideways shows nothing, since it was hidden or left the picture rather than landing. It is drawn in the recorded video too. Logic: `ShuttleEstimator.onMap` in `src/analysis/shuttleStats.ts`, in/out in `landingCall` in `rallyEnd.ts`. The same landing now ends rallies sooner (below).

## Ending a rally at the landing

A rally used to be called when the shuttle had been out of sight for 1.6 s. Now it is also called 0.6 s after a **clear landing**: the shuttle was last seen moving down the picture, there were at least two shots, and the spot is at least 0.6 m from every line and from the net. Then the winner is judged exactly as before (`isRallyOver` and `judgeRally` in `src/analysis/rallyEnd.ts`). A shuttle lost going up or sideways, or landing close to a line or the net, still gets the full 1.6 s, because it might be hidden behind a player and come back, or the in or out call is too close to trust. If the shuttle shows up again within the 0.6 s the rally carries on.

## Using the players' pauses

Players usually stop for a couple of seconds once the shuttle has landed, and keep running while a rally is on. `PlayerMotion` (`src/analysis/playerMotion.ts`) measures how fast the busiest tracked player is moving (steps under 6 cm are jitter) and answers "calm", "moving" or "unknown" (no tracking). It is used three ways:
- **Hold:** if the shuttle is out of sight but a player is still moving, the rally is not called over, up to 4 s. This stops a shuttle the camera merely lost from ending a rally.
- **Confidence:** a point called while the players have stopped is more sure; one called while they are still moving is less sure (and gets flagged in Review).
- **Cut short:** after a point is called, if the shuttle shows up again within 2.5 s, within 4 m of where it was lost, and the players are not calm, the point is taken back automatically, a notice says so, and the rally carries on without needing a new serve (`isContinuation` in `rallyEnd.ts`). The debug panel shows the players' speed and a "cut short" count.

## Shuttle tracker: crowded frames and learned background

From the second shuttle log (`phase0/data/second-session.shuttle.csv.gz`, 12.7 minutes): 36% of frames had the maximum 12 candidates, at a steady rate in every minute, all along one horizontal strip. That is a shimmering screen or pattern, not a shuttle. The tracker (`shuttleMotion.ts`, mirrored in `ShuttleTracker.swift`) now has two more rules: a frame with 10 or more candidates cannot start a new track (an existing track keeps going), and the picture is divided into 24 px squares that learn which places keep producing candidates, and candidates there are dropped while looking for a new track. Replaying the log through the old rules gave 167 track starts; with the crowded-frame rule, 3; with both, 0.

## Replaying a recorded video through the shuttle tracker

`npx tsx tools/replay-video.ts clip.mp4 [y0] [out.json] [--render annotated.mp4]` (needs ffmpeg, with libass for `--render`) runs the tracker over a video at full size, masking RallyCam's own cards, and lists every track it confirms with time, path and speed. With `--render` it also writes a copy of the clip with the tracker's view drawn on: a small white square on every candidate blob and a yellow ring with a SHUTTLE tag on the track. Use it with short clips from the phone to see what the tracker finds without a build. On the first real-court clips it followed a real shuttle against the wall, and also latched onto the next court's players and a player's leg (no player boxes are available offline, unlike in the app).

## Far player detection

The person detector now looks at the court twice (`CaptureController.detectIfDue`): the whole court area as before, and the far 55% again in two overlapping pieces, each scaled up to 1280 px wide (up to 1.6x). People whose middle is in the far part come from the zoomed pass, everyone else from the whole-court pass; the zoomed pass runs every other time and its result is reused for 0.35 s. This is meant to find the far-end player, who is small in the picture. If it costs too much frame rate, the debug panel's fps chip will show it.

## Measuring the shuttle tracker, and the path check

**Path check.** A real shuttle follows a smooth curve; noise hops between unrelated specks. After each hit the tracker fits a quadratic curve through the last 10 positions (`src/analysis/shuttlePath.ts`) and drops the track if the points sit too far from it (more than 3 px plus 20% of the typical step). Swift copy in `ShuttleTracker.swift`. `bridgeGaps` in the same file fills short gaps along the fitted curve for the after-game pass; it is not used by the live tracker yet.

**Measuring.** `npx tsx tools/evaluate-shuttle.ts clip.mp4 phase0/labels/clipN.json [--compare]` runs the tracker over a clip and scores it against labels (`src/analysis/shuttleEval.ts`): how many labelled shuttle positions had a candidate, how many the track was on, what share of track frames were on the shuttle's path, and how many separate false tracks there were. `--compare` also runs with the path check off. A label file lists when the shuttle is in the air and its position at some moments, in pixels of the 1920 x 1080 frame.

The labels in `phase0/labels/` are **seed labels** made from tracks I checked by eye on frames, so they are partial and recall is flattered (the labelled spots are ones the tracker found). On the three real-court clips, the path check changed precision from 15% to 93% (clip 2) and from 45% to 86% (clip 5), false tracks from 5 to 1 and from 12 to 4, with every labelled shuttle position still tracked. Proper labels from a longer clip are needed for real recall numbers.

## Comparing with TrackNetV3

`tools/run-tracknet.sh clip.mp4 ...` runs TrackNetV3 (clones the repo, makes a Python environment, runs `predict.py`) and writes `prediction/<clip>_ball.csv`. The trained weights must be downloaded by hand from the Google Drive link in the script's header into `~/TrackNetV3/ckpts/`. Then `npx tsx tools/compare-tracknet.ts clip.mp4 phase0/labels/clipN.json prediction/clip_ball.csv [--render compare.mp4]` scores TrackNet and RallyCam's tracker side by side on the same labels and can write a clip with RallyCam's track in yellow and TrackNet's in cyan. The comparison code (`src/analysis/tracknetCsv.ts`) is tested; no real TrackNet result exists yet, because the weights could not be fetched from the build environment.

First TrackNetV3 result (clip 5, `phase0/data/clip5.tracknet.csv`): on 28 frames sampled across the clip and checked by eye, the model's position was on a real shuttlecock in about 19; it follows the shuttle high against the wall, near a racket, and on the floor after landing, and it matched all 23 labelled positions within 8 px on average. It also found flights RallyCam's tracker never started on. Its misses are stretches where InpaintNet fills a gap with one repeated position (often on the app's own text overlay in this video), which `parseTracknetCsv` now drops. RallyCam's tracker had 82 track frames on the same clip. Use `TRACKNET_INPAINT=0 tools/run-tracknet.sh ...` to get detections without the gap-filling stage.

## Clean copy for analysis

The video the app records has the score, tags, court map and shuttle marker drawn into it, so a shuttle model run on it can lock onto the app's own drawing (it did, on the text, in the first TrackNet test). Settings → "Keep a clean copy" (iPhone, test builds) makes `CaptureController` write a second file at the same time: the camera picture with no overlay, 960 pixels wide, 60 frames a second, about 5 Mbps (about 37 MB a minute on top of the normal video), written in 5 second pieces like the main file. It is kept as `<game id>.analysis.mp4` next to the video, shown on the game's page with Share and Delete, and removed with the game. If it cannot be made, the game video is unaffected. The shuttle model sees a 512 x 288 picture, so 960 wide loses nothing for it.

## Second real-court set (`new-1` to `new-4`, from further back) and the report threshold

Four 15 second clips (960 wide, 60 fps, `phase0/labels/new1.json` to `new4.json`) from a wide hall with the phone further back. Offline, the phone's tracker followed real shuttles against the wall, blurred streaks, and one landing on the floor; of the 25 tracks that lasted 6 frames or more, about 21 were real shuttles on inspection and 4 were doubtful. Short tracks (1 to 4 frames) were mostly noise and flickered, so a track is now only reported after 6 hits (`reportHits`, about a tenth of a second; Swift copy in `ShuttleTracker.swift`). Effect on the seed labels (false tracks before → after): new-1 20 → 1, new-2 12 → 3, new-3 7 → 2, new-4 10 → 4, clip 5 4 → 1. The cost is that the first tenth of a second of each flight is not reported (labelled positions tracked: 78 to 92% instead of 100%, nearly all of the loss at flight starts). The labels are partial (see above), so precision is flattered and some "false" tracks are real shuttles that were not labelled.

TrackNetV3 on clips 2 and 4 (`phase0/data/clip2.tracknet.csv`, `clip4.tracknet.csv`; clip 5 is unchanged). Checked by eye on 23 frames: the model's position was on a real shuttlecock in about 17, including slow and hovering shuttles and shuttles in front of people, which RallyCam's frame-differencing tracker misses (clip 4: the phone tracker reports no track; TrackNet follows the shuttle on 7 stretches). On clip 5 RallyCam's tracker covers about 58 frames of flight against about 619 for TrackNet's real-looking stretches. Because these clips have the app's own overlay burned in, TrackNet also locks onto the cards: it sits on the "serves from the right court" text near (912, 267) and the distance card near (410, 963), and InpaintNet draws repeated sweeps of about 10 frames between those two spots. Stuck runs are dropped by `parseTracknetCsv`, but the sweeps are not; they should disappear on the clean analysis copy.

## On-phone shuttle model (TrackNetV3 on the Neural Engine)

Settings → "Shuttle model · experimental" (test builds, with Shuttle tracking on) runs TrackNetV3, converted to Core ML, on the camera frames instead of the simple tracker. The Swift is in `modules/rallycam-export/ios/ShuttleModel.swift`: it takes about 60 frames a second, shrinks each to 512 x 288, keeps a background picture (the median of earlier frames, so the players drop out), and every 8 frames runs the model and reads the brightest spot of each heatmap (as in TrackNetV3's own `predict.py`, `bg_mode` "concat"). Windows are dropped, not queued, if the model falls behind. Sightings reach JavaScript as `onShuttleModel` events and go through `ModelTrackFilter` (`src/analysis/modelTrack.ts`), which keeps only sightings that continue a smooth path and drops lone ones, jumps and anything that sits still (so a shuttle lying on the floor goes quiet, which lets the rally end). They then feed the same estimator, path check, court map and scoring as before.

The model file is not in the repository. Put it at `modules/rallycam-export/ios/Models/TrackNetV3.mlpackage` (see `Models/README.md`), run `npx expo prebuild --platform ios` and build. If it is missing, or fails to load, the debug panel says why and the simple tracker keeps running. The first switch-on compiles the model on the phone, which takes a few seconds. This is untested on a device: the Swift has never been compiled.

## Tracking a whole recording offline (no court needed)

1. `phase0/tools/run-coreml-video.sh ~/Desktop/new.mp4` runs the Core ML model over the whole video on the Mac's Neural Engine (`coreml_video.py`): it reads the video as a stream, 20 seconds at a time, builds a background for each stretch, feeds the model 8 frames at a time, and writes `new_coreml_ball.csv` and `.json` (fps, size). Sightings on the cards RallyCam draws into its own video are ignored (`--keep-overlay` to keep them).
2. Make `corners.json` (the court's outer corners as fractions of the frame) with the Court Corner Picker page.
3. `npx tsx tools/analyze-track.ts new_coreml_ball.csv --corners corners.json` replays the track through the app's own logic (sighting filter, estimator, court map, rally end and winner rules) and prints each rally: when, shots, where the shuttle came down, in or out, winner and confidence. The serve check is skipped, because the recording has no game state.

## First whole-recording run (`new.mp4`, 11.3 minutes, wide hall, doubles; data in `phase0/data/new.coreml.*`)

The Core ML model saw the shuttle in 24,542 of 40,525 frames (60%; 21,901 after the filter's stuck-run removal). Replayed through the app's rules with the court corners picked by hand (`phase0/labels/new-corners.json`), the logic found 86 "rallies" with a median length of 1.4 s, 68 of them with the shuttle last seen far outside the court. Cause: with a low camera the court plane's horizon is at y = 0.54 of the frame, and 68% of all sightings are above it (the shuttle is higher than the camera), where a floor projection has no meaning. Only 27% of sightings fall inside the court's band of the picture. So floor positions of a flying shuttle, and anything decided from them (which side hit it, which side it landed on, rally end by "last seen"), are unreliable for a tripod-height camera, however good the tracking is. Next step under discussion: decide the hitter from the nearest player in the picture and use floor positions only for the landing, when the shuttle is on the floor.

### Floor positions only for a shuttle that is low, and the hitter from the nearest player

Because of the finding above, `floorPosition` (`court.ts`) marks a picture point `air` when it is above the court's horizon or maps well off the ends of the court. The shuttle estimator keeps those sightings (for the path, hits and trail) but does not use their floor position: no speed, no map dot, no landing, no "which side". `rallyEnd.ts` now needs a floor sighting to call a landing (the last sighting, or the last floor sighting within 0.8 s before it), and a rally that ends with the shuttle lost in the air gives no point. Who hit last comes from `hitterSide` (`hitter.ts`): the side of the player nearest the shuttle in the picture at the moment of the hit, measured in body heights; if no player is tracked, from serve order (sides take turns, the server first). The debug panel shows how often the two agree. Replaying `new.mp4` (no players there, so serve order is used) now gives 21 rallies with a decision and 34 that end with the shuttle lost in the air (no point), instead of 86 rallies of which 68 ended outside the court. Landing spots now fall in the court's band of the picture. The shot counts there (up to 129 in one 66 second stretch) show the offline replay merges rallies, because it has no "players have stopped" cue, so its winners are not to be trusted; the live app does have that cue.

### The next serve shows who won

In rally scoring the winner of a point serves next. When a rally ends with the shuttle lost (no landing seen), the app now keeps that rally open and waits for the next one. When the next serve and one return have been seen (two shots), the side of the player nearest the shuttle at the serve (`hitterSide`) is the server, and so the winner. If that player also stands in the court the score says that side would serve from (`courtOfServer`, `inferWinnerFromServe` in `src/analysis/nextServe.ts`), confidence is high (0.8), if it is the other court it is low (0.35), and with no court it is 0.55. The point is added without wiping the serve being tracked. When a rally was decided from the landing, the next serve is a check: if the other side serves, that point's confidence is lowered to 0.3 so Review flags it for checking. A manual point, Fix last point or a rally cut short cancels the wait, which also ends after 90 s. The debug panel counts points from the next serve and disagreements. Not run on a phone yet.

## Drawing the court from the camera

On the Record screen, when the court is not saved yet (a new venue or no venue), the camera settles for a moment and then the app draws the court by itself; a **Find court** chip (top left, next to the lens chips) runs it again, and it runs again after a lens change. The existing dots stay draggable, and locking works as before (a saved venue still starts locked, and is left alone).

How it works (`src/analysis/courtLines.ts`, all plain TypeScript, with tests): the camera hands over three grey pictures 0.4 s apart (`grabStill` in `CaptureController.swift`, 640 wide) → white marks (brighter than their surroundings, in the lower 62% of the picture, to leave the ceiling lights out) → the strongest straight lines through them (Hough transform) → for every pair of lines along the court and pair across it, and every way they could be court lines of known position (outer or singles side lines; the near baseline or long service line, with any other line across), the whole court is placed from those four lines, so a far half squeezed into a thin strip by a low camera need not be seen → each placement is scored by how many pixels of the whole court's lines (outline, singles lines, service lines, centre line) fall on white marks, counted once each → the best few are nudged a pixel at a time → `consensusCourt` keeps the look that agrees best with the others. Anything that fills less than a third of the width, or fits poorly, gives "could not find the lines".

Tried on 12 frames of the wide-hall recording (low camera, players on the lines): the court lines drawn follow the white lines closely in 11, with one weaker. On a frame from a camera right beside the net it returns nothing, and on another it returns a small quad that is probably wrong, so the picture must be checked each time. `tools/find-court.ts frame.png [--at seconds] [--cards] [--expect corners.json]` runs it on a picture or a video frame. About a quarter of a second per picture on a computer; on a phone's JavaScript engine it will be slower, which is not measured.

### Test features in every build

The debug panel, the "Shuttle model" and "Keep a clean copy" switches, simulated players and the shuttle cards show in **every** build, development, release and TestFlight. Only a store build leaves them out: it is made with `EXPO_PUBLIC_STORE_BUILD=1`, which the `production` profile in `eas.json` sets (the `testflight` profile sets it to 0). See `src/config.ts`. Before submitting to the App Store, build with `eas build --profile production` and check Settings and the Record screen show none of them.

## Training mode
New → **Training** tracks players and shuttle exactly like a game (court, tags, court map, distance, shuttle marker, clean copy, shuttle log) but keeps no score: no scoreboard on screen or in the video, no point buttons, no automatic points, no auto-stop. End with **End session**. Stored as `matches.training` (migration v5); the list shows "Training" and Review hides the score and point list. Not yet tried on a phone.
