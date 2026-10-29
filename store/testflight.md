# TestFlight (internal testers)

Internal testers are people on your App Store Connect team (up to 100). No Apple review, a build is available a few minutes after processing.

## One-time
1. Apple Developer Program ($99 a year), then accept the agreements in App Store Connect.
2. Create the app in App Store Connect with bundle ID `com.darrenliau.rallycam`.
3. App Store Connect > Users and Access: invite each tester (role "App Manager" or "Developer" is enough, "Customer Support" cannot test). They accept the email and install Apple's free TestFlight app.
4. `npx eas-cli@latest login`, then `eas init` and commit the project ID in `app.json`.

## Each build
```bash
git pull
eas build --profile testflight --platform ios
eas submit --profile testflight --platform ios
```
The `testflight` profile (see `eas.json`) is the production build plus `EXPO_PUBLIC_EXPERIMENTS=1`, which turns on:
- the debug panel and "Simulate players" on the Record screen,
- shuttle speed and shot cards even when empty,
- the experimental shuttle tracker switch (Settings, off until a tester turns it on) with automatic scoring,
- the shuttle log on the Review screen (footage capture is on the New game screen in every build).

A store build uses `--profile production` and leaves all of that out.

Then in App Store Connect > TestFlight, wait for "Processing" to finish, answer the export compliance question (the app uses no custom encryption), and add your internal group. Testers get a notification in TestFlight. Each build expires after 90 days.

## What to tell testers
- Use Balanced quality for real games. Turn on Shuttle tracking in Settings only to help test it.
- Automatic scoring will make mistakes. Check flagged points on the Review screen, and tap "Wrong, swap" or "Fix last point".
- After a game, share the shuttle log (Review screen) and the video if the shuttle tracking was on.
- If the red text appears on Record, send a screenshot.
