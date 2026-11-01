#!/usr/bin/env bash
# Builds the Core ML speed-test models and times them on this Mac.
#   phase0/tools/run-coreml-speed-test.sh [--only name,name] [--repo ~/TrackNetV3 --ckpt ~/TrackNetV3/ckpts/TrackNet_best.pt]
# Writes coreml_models/*.mlpackage and coreml_speed.csv into the folder you run it from. See phase0/docs/coreml-speed-test.md.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# coremltools does not support the newest Python yet, so use 3.11 to 3.13
PY="$(command -v python3.12 || command -v python3.11 || command -v python3.13 || true)"
[ -n "$PY" ] || { echo "Needs Python 3.11, 3.12 or 3.13. Install one with: brew install python@3.12"; exit 1; }
VENV="${COREML_VENV:-$HOME/.coreml-venv}"
[ -d "$VENV" ] || "$PY" -m venv "$VENV"
"$VENV/bin/pip" install --quiet torch numpy coremltools
"$VENV/bin/python" "$HERE/coreml_speed_test.py" "$@"
