#!/usr/bin/env bash
# Runs TrackNetV3 on clips and writes one prediction CSV per clip, to compare with RallyCam's tracker.
#   tools/run-tracknet.sh clip1.mp4 [clip2.mp4 ...]
# Writes prediction/<clip name>_ball.csv in the current folder. Then:
#   npx tsx tools/compare-tracknet.ts clip1.mp4 phase0/labels/clipN.json prediction/clip1_ball.csv --render compare.mp4
#
# One manual step: the trained weights are on Google Drive and cannot be fetched by a script. Download
#   https://drive.google.com/file/d/1CfzE87a0f6LhBp0kniSl1-89zaLCZ8cA/view
# (the checkpoints link from the TrackNetV3 README), unzip it, and put TrackNet_best.pt and InpaintNet_best.pt in ~/TrackNetV3/ckpts/
# The weights are MIT licensed per the repository, but check the LICENSE file before using them in a product.
set -euo pipefail

REPO="${TRACKNET_REPO:-$HOME/TrackNetV3}"
VENV="${TRACKNET_VENV:-$HOME/.tracknet-venv}"
[ $# -ge 1 ] || { echo "usage: $0 clip.mp4 [more clips]"; exit 1; }

if [ ! -d "$REPO" ]; then
  git clone --depth 1 https://github.com/qaz812345/TrackNetV3 "$REPO"
fi
for f in TrackNet_best.pt InpaintNet_best.pt; do
  [ -f "$REPO/ckpts/$f" ] || { echo "Missing $REPO/ckpts/$f - see the note at the top of this script."; exit 1; }
done

[ -d "$VENV" ] || python3 -m venv "$VENV"
# The repository pins very old versions; recent ones work and also run on an Apple Silicon Mac (MPS) or plain CPU.
# This list is every package its predict.py imports (found by reading the code). Installing again is harmless.
"$VENV/bin/pip" install --quiet torch numpy opencv-python pandas pillow tqdm parse matplotlib pycocotools

command -v ffmpeg >/dev/null || { echo "ffmpeg is needed (brew install ffmpeg)."; exit 1; }
OUT="$PWD/prediction"
mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for clip in "$@"; do
  [ -f "$clip" ] || { echo "No such file: $clip"; exit 1; }
  name="$(basename "$clip")"
  echo "== $name"
  # OpenCV (inside the Python packages) often cannot decode the phone's video as saved, so make a plain H.264 copy first.
  # Same size and frame rate; the prediction CSV keeps the original file's name.
  ffmpeg -v error -y -i "$clip" -c:v libx264 -crf 16 -pix_fmt yuv420p -an "$TMP/$name"
  (cd "$REPO" && "$VENV/bin/python" predict.py --video_file "$TMP/$name" --tracknet_file ckpts/TrackNet_best.pt \
    --inpaintnet_file ckpts/InpaintNet_best.pt --save_dir "$OUT" --batch_size 8)
done
echo "Done. CSVs are in $OUT"
