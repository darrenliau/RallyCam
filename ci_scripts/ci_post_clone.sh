#!/bin/sh
# Xcode Cloud runs this after cloning the repository. The ios/ folder is not in git (Expo generates it), so make it here:
# install node and CocoaPods, install the JavaScript packages, run `expo prebuild`, then `pod install`.
# Every step is announced, and the ones that depend on the network are tried up to three times, so a failed run says where it stopped.
set -eu

step() { echo; echo "=== $1 ==="; }
retry() { # retry <command...>: up to three tries
  n=1
  until "$@"; do
    if [ "$n" -ge 3 ]; then echo "error: '$*' failed $n times"; return 1; fi
    echo "'$*' failed, trying again ($n of 3 done)"; n=$((n + 1)); sleep 10
  done
}

ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"

step "Where we are"
echo "repository: $ROOT"
echo "commit: ${CI_COMMIT:-unknown}"
xcodebuild -version || true
uname -m

step "The shuttle model is in the repository"
MODEL="modules/rallycam-export/ios/Models/TrackNetV3.mlpackage"
if [ ! -d "$MODEL" ]; then
  echo "error: $MODEL is not in the repository, so this build would have no shuttle model."
  echo "Copy it from your Mac (see modules/rallycam-export/ios/Models/README.md), commit and push it."
  exit 1
fi

step "Node and CocoaPods"
export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 HOMEBREW_NO_ENV_HINTS=1
# The runner has Homebrew but not necessarily node or CocoaPods
command -v node >/dev/null 2>&1 || retry brew install node
command -v pod  >/dev/null 2>&1 || retry brew install cocoapods
# The Apple Watch target (the @bacons/apple-targets plugin) needs CocoaPods 1.16.2 or newer to read the project it writes
NEED_POD="1.16.2"
HAVE_POD="$(pod --version)"
if [ "$(printf '%s\n%s\n' "$NEED_POD" "$HAVE_POD" | sort -V | head -n1)" != "$NEED_POD" ]; then
  echo "CocoaPods $HAVE_POD is older than $NEED_POD: upgrading"
  retry brew upgrade cocoapods || retry brew install cocoapods
  hash -r
  HAVE_POD="$(pod --version)"
  if [ "$(printf '%s\n%s\n' "$NEED_POD" "$HAVE_POD" | sort -V | head -n1)" != "$NEED_POD" ]; then
    echo "error: CocoaPods is still $HAVE_POD after upgrading; the watch target needs $NEED_POD or newer."
    exit 1
  fi
fi
echo "node $(node -v), npm $(npm -v), pod $HAVE_POD"

step "npm ci"
retry npm ci

step "expo prebuild"
# A TestFlight build shows the test features (debug panel, shuttle model and clean-copy switches); a store build would use 1
export EXPO_PUBLIC_STORE_BUILD=0
# prebuild starts ios/ afresh when it holds no project, which would remove ios/ci_scripts: put it back afterwards
KEEP="$(mktemp -d)"
if [ -d ios/ci_scripts ]; then cp -R ios/ci_scripts "$KEEP/"; fi
npx expo prebuild --platform ios --no-install
if [ -d "$KEEP/ci_scripts" ]; then cp -R "$KEEP/ci_scripts" ios/; fi
ls ios

step "pod install"
cd ios
retry pod install
cd ..

step "Build number"
# The phone app and the watch app inside it must have the same build number, or the App Store export rejects the build. Xcode Cloud
# numbers its own builds; this sets the number in every target of the project (the phone app and the watch app) so they agree.
if [ -n "${CI_BUILD_NUMBER:-}" ]; then
  PBX="ios/RallyCam.xcodeproj/project.pbxproj"
  if [ -f "$PBX" ]; then
    sed -i '' "s/CURRENT_PROJECT_VERSION = [0-9][0-9]*;/CURRENT_PROJECT_VERSION = $CI_BUILD_NUMBER;/g" "$PBX" 2>/dev/null \
      || sed -i "s/CURRENT_PROJECT_VERSION = [0-9][0-9]*;/CURRENT_PROJECT_VERSION = $CI_BUILD_NUMBER;/g" "$PBX"
  fi
  grep -n "CURRENT_PROJECT_VERSION" "$PBX" || true
  (cd ios && xcrun agvtool new-version -all "$CI_BUILD_NUMBER") || echo "warning: agvtool could not set the build number; the project settings above are what count"
fi

step "Done"
echo "ok: ios/RallyCam.xcworkspace is ready"
ls -d ios/RallyCam.xcworkspace
