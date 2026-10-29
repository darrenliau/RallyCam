# Release checklist

Work down the list. Each block says who does it. "You" means someone with the Apple or Google account.

## 1. Before building (code, done in this repo)
- [x] App icon, adaptive icon and splash screen (`assets/`). Replace with a designer's version if you get one.
- [x] Bundle ID `com.darrenliau.rallycam`, iPhone only, privacy manifest entries, honest camera and microphone purpose strings.
- [x] Shuttle cards are hidden in store builds until shuttle tracking exists (`src/config.ts`). Points are scored by tapping the winner.
- [ ] You: pick the final app name and check it is free in the App Store.
- [ ] You: decide the support email and a public home for the privacy policy (a GitHub Pages page works).

## 2. Accounts (you)
- [ ] Apple Developer Program, $99 a year. Sign in to App Store Connect and accept the agreements.
- [ ] Create the app record in App Store Connect with the bundle ID above.
- [ ] Google Play Console, $25 once, only if you launch on Android.

## 3. Build and test (you, I help with errors)
- [ ] `npx eas-cli@latest login` then `eas init` (adds the project ID to `app.json`, commit it).
- [ ] `eas build --profile production --platform ios`. The first time EAS creates the distribution certificate for you.
- [ ] `eas submit --platform ios` to send it to App Store Connect, then use TestFlight on your own phone.
- [ ] Play a real game from a tripod with a release build (not the debug build): scoring buttons work, the court alignment holds, the video has the overlay and sound, nothing debug-looking shows.
- [ ] Test the first-launch flow with a fresh install (permissions prompts, empty list), and with permission denied.
- [ ] Check heat and battery over a full game.

## 4. Store page (you, with `store/` drafts)
- [ ] Privacy policy published, URL pasted in.
- [ ] Description, keywords, subtitle, category, age rating, screenshots (real, from a release build).
- [ ] App Privacy answers: data not collected, no tracking.
- [ ] Review notes (in `app-store-listing.md`). Say plainly that a court is not needed to test.
- [ ] Export compliance: the app uses no custom encryption (`ITSAppUsesNonExemptEncryption` is false).

## 5. Review risks to expect
- **Camera and microphone prompts:** the purpose strings must match what the app does. They do.
- **"Minimum functionality":** reviewers want a working app without special equipment. The Record flow works on a table top with any four corners, and the notes say so.
- **People in videos:** the policy tells users to ask before sharing.
- **Performance claims:** the description only promises what exists. Do not mention shuttle speed, shot types or automatic scoring until they are real.

## 6. After release
- Keep the debug panel and simulation as development-only.
- Next versions: automatic scoring from shuttle tracking (see `phase0/`), Android parity, an on-device history of exports.
