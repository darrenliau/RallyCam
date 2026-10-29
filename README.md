# RallyCam

Badminton match recorder and tracker. React Native (Expo SDK 58, TypeScript, Expo Router).

## What works now
- **Match setup:** singles or doubles, best of 3 or one game, player names.
- **Recording:** landscape, asks the camera for 120 fps with stabilisation off (react-native-vision-camera), screen kept awake, video saved with the match. The chip on the Record screen shows the frame rate the phone actually gave. Below 60 fps it warns you.
- **Scoring engine** (`src/engine`): pure TypeScript, unit tested. 21 points, win by 2, cap at 30, serve court and doubles court swapping, undo, fix any earlier point and re-score.
- **Storage:** local SQLite (`src/db`). Matches and rallies. Nothing leaves the phone.
- **Venues:** name a venue on the New match screen. The court alignment you lock during a match is saved to it, so the next match there starts already aligned. Saved as fractions of the screen, so it survives restarts. If you open it on a phone with a different screen shape, the app asks you to check the dots again.
- **Court alignment and player tags:** drag four corners onto the court, then each tracked player gets a ring, a name tag (tap two tags to swap), a distance total and a court-map dot. Needs a tracker to feed it (see below).
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
