#!/usr/bin/env bash
# Converts the real TrackNetV3 to Core ML and checks it gives the same shuttle positions as PyTorch.
#   phase0/tools/run-coreml-parity.sh ~/Desktop/clip5.mp4
# Needs the TrackNetV3 folder and weights from tools/run-tracknet.sh (in ~/TrackNetV3) and the environment from run-coreml-speed-test.sh.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VENV="${COREML_VENV:-$HOME/.coreml-venv}"
REPO="${TRACKNET_REPO:-$HOME/TrackNetV3}"
[ -x "$VENV/bin/python" ] || { echo "Run phase0/tools/run-coreml-speed-test.sh once first, to make the Python environment."; exit 1; }
[ -f "$REPO/ckpts/TrackNet_best.pt" ] || { echo "Missing $REPO/ckpts/TrackNet_best.pt (see tools/run-tracknet.sh)."; exit 1; }
"$VENV/bin/python" "$HERE/coreml_parity.py" --repo "$REPO" --ckpt "$REPO/ckpts/TrackNet_best.pt" --video "${1:?usage: $0 clip.mp4}"
