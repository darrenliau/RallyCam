#!/bin/sh
# Xcode Cloud runs this after cloning the repository. The ios/ folder is not in git (Expo generates it), so make it here:
# install node and CocoaPods, install the JavaScript packages, run `expo prebuild`, then `pod install`.
set -eu

ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"

MODEL="modules/rallycam-export/ios/Models/TrackNetV3.mlpackage"
if [ ! -d "$MODEL" ]; then
  echo "error: $MODEL is not in the repository, so this build would have no shuttle model."
  echo "Copy it from your Mac (see modules/rallycam-export/ios/Models/README.md), commit and push it."
  exit 1
fi

# The runner has Homebrew but not node or CocoaPods
command -v node >/dev/null 2>&1 || brew install node
command -v pod  >/dev/null 2>&1 || brew install cocoapods

npm ci

# A TestFlight build shows the test features (debug panel, shuttle model and clean-copy switches); a store build would use 1
export EXPO_PUBLIC_STORE_BUILD=0
npx expo prebuild --platform ios --no-install
(cd ios && pod install)

# Each Xcode Cloud run gets its own build number
if [ -n "${CI_BUILD_NUMBER:-}" ]; then
  (cd ios && xcrun agvtool new-version -all "$CI_BUILD_NUMBER")
fi

echo "ok: ios/RallyCam.xcworkspace is ready"
