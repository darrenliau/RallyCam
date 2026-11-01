#!/usr/bin/env bash
# Tracks the shuttle through a whole video with the Core ML model on the Neural Engine.
#   phase0/tools/run-coreml-video.sh ~/Desktop/new.mp4 [path/to/model.mlpackage] [--max-seconds 60]
# The model defaults to the one in the app (modules/rallycam-export/ios/Models/TrackNetV3.mlpackage).
# Writes <video name>_coreml_ball.csv and .json in the current folder. Needs the environment from run-coreml-speed-test.sh and ffmpeg.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
VENV="${COREML_VENV:-$HOME/.coreml-venv}"
[ -x "$VENV/bin/python" ] || { echo "Run phase0/tools/run-coreml-speed-test.sh once first, to make the Python environment."; exit 1; }
video="${1:?usage: $0 video.mp4 [model.mlpackage] [--max-seconds N]}"; shift
model="$ROOT/modules/rallycam-export/ios/Models/TrackNetV3.mlpackage"
if [ $# -gt 0 ] && [[ "$1" != --* ]]; then model="$1"; shift; fi
[ -e "$model" ] || { echo "No model at $model"; exit 1; }
"$VENV/bin/python" "$HERE/coreml_video.py" --model "$model" --video "$video" --out . "$@"
