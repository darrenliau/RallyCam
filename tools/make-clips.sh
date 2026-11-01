#!/usr/bin/env bash
# Cuts short, small clips out of a long recording, so they can be sent to be analysed (a chat upload or a shared Drive folder
# takes about 10 MB per file).
#   tools/make-clips.sh recording.mp4 [start_seconds] [clip_count] [clip_seconds]
# Example: tools/make-clips.sh ~/Desktop/new.mp4 120 4 15
#   cuts 4 clips of 15 seconds, one after another, starting 2 minutes in, into a "clips" folder next to the recording.
# Each clip is 960 pixels wide with no sound, which is plenty for checking shuttle tracking.
set -euo pipefail
in="${1:?usage: $0 recording.mp4 [start_seconds] [clip_count] [clip_seconds]}"
start="${2:-0}"
count="${3:-3}"
len="${4:-15}"
command -v ffmpeg >/dev/null || { echo "ffmpeg is needed (brew install ffmpeg)."; exit 1; }
[ -f "$in" ] || { echo "No such file: $in"; exit 1; }
out="$(cd "$(dirname "$in")" && pwd)/clips"
mkdir -p "$out"
stem="$(basename "${in%.*}")"
for i in $(seq 1 "$count"); do
  from=$(( start + (i - 1) * len ))
  file="$out/${stem}-$i.mp4"
  # -ss before -i is fast; -crf 26 keeps 15 seconds well under 10 MB; the clip keeps the original 60 frames a second
  ffmpeg -v error -y -ss "$from" -t "$len" -i "$in" -vf scale=960:-2 -c:v libx264 -crf 26 -preset fast -pix_fmt yuv420p -an "$file"
  size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file")
  echo "$file  from ${from}s, $(( size / 1000000 )) MB"
done
echo "Done. Drag the files in $out into the chat."
