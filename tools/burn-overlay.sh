#!/usr/bin/env bash
# Burns the RallyCam overlay into a copy of the video.
#
#   tools/burn-overlay.sh game.mov game.ass game-with-overlay.mp4 [fps]
#
# game.ass is the file from "Share overlay" in the app. fps defaults to 30 (the camera records 120, which makes a
# very large file and takes much longer to encode). Pass 0 to keep the original frame rate.
# Needs ffmpeg with libass (brew install ffmpeg on a Mac).
set -euo pipefail

if [ "$#" -lt 3 ]; then
  sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi
VIDEO="$1"; ASS="$2"; OUT="$3"; FPS="${4:-30}"

command -v ffmpeg >/dev/null || { echo "ffmpeg not found. On a Mac: brew install ffmpeg" >&2; exit 1; }
ffmpeg -hide_banner -filters 2>/dev/null | grep -q " subtitles " || { echo "This ffmpeg has no subtitles filter (libass). Install a full build." >&2; exit 1; }

# The subtitles filter is picky about special characters in paths, so use a plain temporary copy.
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cp "$ASS" "$TMP/overlay.ass"

VF="subtitles=$TMP/overlay.ass"
[ "$FPS" != "0" ] && VF="fps=$FPS,$VF"

# Use the phone/Mac hardware encoder when there is one, because software encoding a long game is slow.
if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q h264_videotoolbox; then
  ENC=(-c:v h264_videotoolbox -b:v 12M)
else
  ENC=(-c:v libx264 -preset veryfast -crf 20)
fi

ffmpeg -y -hide_banner -i "$VIDEO" -vf "$VF" "${ENC[@]}" -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "$OUT"
echo "Wrote $OUT"
