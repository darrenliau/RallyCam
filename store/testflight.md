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
The `testflight` profile (see `eas.json`) is the production build with `EXPO_PUBLIC_STORE_BUILD=0`, which turns on:
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


## Xcode Cloud (no EAS)
Xcode Cloud builds straight from GitHub. The `ios/` folder is made by Expo and is not in git, so `ci_scripts/ci_post_clone.sh` makes it on the runner (installs node and CocoaPods, runs `npm ci`, `expo prebuild`, `pod install`, and sets the build number from `CI_BUILD_NUMBER`). It sets `EXPO_PUBLIC_STORE_BUILD=0`, so the test features show.

Before the first run:
1. Put the shuttle model in the repository, because the cloud runner cannot see your Mac: `cp -R <your TrackNetV3.mlpackage> modules/rallycam-export/ios/Models/TrackNetV3.mlpackage`, then `git add`, commit and push (about 23 MB). The script stops with a clear message if it is missing.
2. In Xcode: Product > Xcode Cloud > Create Workflow. Workspace `ios/RallyCam.xcworkspace` (it exists once the script has run), scheme `RallyCam`, action Archive iOS, post-action TestFlight (Internal Testing), start on changes to `main`.
3. App Store Connect: the app record for `com.darrenliau.rallycam`, and your testers in an internal group.

If the log says the script did not run, or the workspace is still missing, send me the first red lines of the log.

## What is new to test in this build
- **Training** on the New screen: tracks players and shuttle, keeps no score; End session.
- **Settings > Shuttle model**: *Crop to the court* and *Only this court*. Compare with them off if the shuttle is missed.
- Send back from Review: the clean copy (or a trimmed clip), the shuttle log, a screenshot of the debug panel and a few rally times with who won.
