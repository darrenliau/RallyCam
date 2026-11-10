"""Shows what the auto-framing view would have been on a recording: the original with the two windows drawn on it, and the picture each would have recorded.

  python3 tools/render-framing.py clip.mp4 prefix out.mp4 [shrink]       (prefix.crop.json and prefix.lens.json from tools/replay-framing.ts --out prefix)

Left: the whole picture with the window of crop mode (green) and of lens zoom (amber). Right: the picture each window would have saved, scaled up to the
clip's size (the clip is 960 wide, so a tight window looks soft; the app records from a 4K picture in crop mode). The clip's own overlay (rings, score
cards) is part of its picture here, so it is cut with the window; in the app it is drawn after the cut. Needs opencv and numpy, and ffmpeg.
"""
import json
import subprocess
import sys

import cv2
import numpy as np

src, prefix, out = sys.argv[1:4]
shrink = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0   # for example 0.5 to halve a 1080p clip's size
paths = {m: json.load(open(f"{prefix}.{m}.json")) for m in ("crop", "lens")}
cap = cv2.VideoCapture(src)
fps = cap.get(cv2.CAP_PROP_FPS)
W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
RW, RH = W // 2, H // 2


def window(mode, t):
    ws = paths[mode]["windows"]
    for a, b in zip(ws, ws[1:]):
        if a["t"] <= t <= b["t"]:
            k = (t - a["t"]) / max(1e-9, b["t"] - a["t"])
            return {key: a[key] + (b[key] - a[key]) * k for key in ("cx", "cy", "w")}
    return ws[-1]


def cut(frame, win):
    w = win["w"]
    x0 = int(round((win["cx"] - w / 2) * W)); y0 = int(round((win["cy"] - w / 2) * H))
    cw = max(2, int(round(w * W))); ch = max(2, int(round(w * H)))
    x0 = min(max(0, x0), W - cw); y0 = min(max(0, y0), H - ch)
    return cv2.resize(frame[y0:y0 + ch, x0:x0 + cw], (RW, RH), interpolation=cv2.INTER_CUBIC), (x0, y0, cw, ch)


ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W + RW}x{H}", "-r", str(fps), "-i", "-",
                       "-vf", f"scale=trunc(iw*{shrink}/2)*2:trunc(ih*{shrink}/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", out], stdin=subprocess.PIPE)
colors = {"crop": (80, 220, 80), "lens": (60, 170, 255)}
i = 0
while True:
    ok, frame = cap.read()
    if not ok:
        break
    t = i / fps
    canvas = np.zeros((H, W + RW, 3), np.uint8)
    left = frame.copy()
    for row, mode in enumerate(("crop", "lens")):
        win = window(mode, t)
        view, (x0, y0, cw, ch) = cut(frame, win)
        cv2.rectangle(left, (x0, y0), (x0 + cw, y0 + ch), colors[mode], 3)
        canvas[row * RH:(row + 1) * RH, W:] = view
        cv2.rectangle(canvas, (W, row * RH), (W + RW - 1, (row + 1) * RH - 1), colors[mode], 3)
        cv2.putText(canvas, f"{mode}  w {win['w']:.2f}", (W + 10, row * RH + 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, colors[mode], 2)
    canvas[:, :W] = left
    ff.stdin.write(canvas.tobytes())
    i += 1
ff.stdin.close()
ff.wait()
print(f"{i} frames written to {out}")
