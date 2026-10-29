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
- Change `ios.bundleIdentifier` and `android.package` in `app.json` (currently `com.example.rallycam`).
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

## Person detector (the missing native piece)
`src/analysis/tracker.ts` turns detections into stable per-player tracks on the court: it maps each person's feet through the locked court corners, ignores spectators, keeps a fixed id per player (near side first, left to right), survives short dropouts and keeps partners apart when they cross. It is unit tested with synthetic detections.

What it needs is a `PersonDetector` (`src/analysis/detector.ts`) that calls back with boxes (fractions of the camera frame) for every analysed frame. Set `personDetector` in that file to a factory and the Record screen starts tracking when the court is locked. Suggested route, none of it tried yet:
- A vision-camera frame output (`useFrameOutput`) alongside the video output. Frame processors need `react-native-worklets`.
- A small person or pose model run on each frame, for example through `react-native-fast-tflite`. Analyse at about 15 to 30 frames per second, not at 120.
- Keep it in a development build, and measure battery and heat on a mid-range Android phone.
- Check the detector on the Phase 0 footage first: how often are all four players found, and how far off are their feet.
