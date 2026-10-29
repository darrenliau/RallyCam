# RallyCam

Badminton match recorder and tracker. React Native (Expo SDK 58, TypeScript, Expo Router).

## What works now
- **Match setup:** singles or doubles, best of 3 or one game, player names.
- **Recording:** camera + microphone, screen kept awake, video saved with the match.
- **Scoring engine** (`src/engine`): pure TypeScript, unit tested. 21 points, win by 2, cap at 30, serve court and doubles court swapping, undo, fix any earlier point and re-score.
- **Storage:** local SQLite (`src/db`). Matches and rallies. Nothing leaves the phone.
- **Review:** video, score chart per game, every point, change who won a point.

## Not built yet
- **Automatic scoring.** `src/analysis/types.ts` is the seam. Until the tracker exists, the Record screen shows two dev-only buttons (debug builds) to add points. Production builds show none.
- Shuttle and player tracking, rings and overlays, shot stats (see the Phase 0 plan).
- 120 fps capture. `expo-camera` records at its default frame rate. High frame rate needs `react-native-vision-camera` and a development build.
- Landscape recording, app icon and splash, store listings.

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
