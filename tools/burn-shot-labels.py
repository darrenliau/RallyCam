"""Draws the shot labels from tools/label-shots.ts onto the clip, so each can be checked against the video.

  python3 tools/burn-shot-labels.py clip.mp4 shots.json out.mp4

Each label is "#number player TYPE ?" (a ? when the call is unsure) from the hit until 1.5 s later (or the next label), at the bottom of the picture,
with the clip's time at the bottom right. Needs ffmpeg with the drawtext filter.
"""
import json
import subprocess
import sys

src, shots_file, out = sys.argv[1:4]
shots = json.load(open(shots_file))
font = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def esc(s):
    return s.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'").replace("%", "\\%")


parts = []
for i, s in enumerate(shots):
    label = f"#{s['number']}  {s['player']}  {s['type']}{' ?' if s['confidence'] < 0.5 else ''}"
    # from the hit until 1.5 s later or the next label, whichever is first, so two labels are never on top of each other
    a = s["t"]
    b = min(s["t"] + 1.5, shots[i + 1]["t"] - 0.02) if i + 1 < len(shots) else s["t"] + 1.5
    parts.append(
        f"drawtext=fontfile={font}:text='{esc(label)}':fontcolor=white:fontsize=30:box=1:boxcolor=black@0.65:boxborderw=8:x=(w-text_w)/2:y=h-80:enable='between(t,{a:.2f},{b:.2f})'"
    )
parts.append(f"drawtext=fontfile={font}:text='%{{pts\\:hms}}':fontcolor=yellow:fontsize=24:box=1:boxcolor=black@0.6:boxborderw=5:x=w-text_w-12:y=h-48")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", ",".join(parts), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-c:a", "copy", out], check=True)
print("written", out)
