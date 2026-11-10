"""Reads the shuttle marker RallyCam drew into a video it recorded (a ring around where its tracker saw the shuttle), as that moment's shuttle position.

  python3 tools/read_shuttle.py clip.mp4 --out shuttle.csv [--every 1]

Writes frame,t,x,y (pixels of the video). The marker is a ring of the shuttle colour #FFD166 (src/export/ass.ts); the shuttle speed tag, its colour bar
and the trail of small dots are told apart by shape (a ring about as wide as it is tall, with an empty middle), and the cards the app draws are skipped.
Needs opencv and numpy.
"""
import argparse
import csv

import cv2
import numpy as np

COLOUR = np.array([255, 209, 102])  # RGB #FFD166
# parts of the picture RallyCam's own cards use (court map, distance card, shuttle cards, score card), as fractions: x0, y0, x1, y1
CARDS = [(0.0, 0.0, 0.17, 0.40), (0.0, 0.78, 0.27, 1.0), (0.76, 0.0, 1.0, 0.46), (0.26, 0.0, 0.74, 0.30)]


def marker(frame_rgb, tolerance):
    h, w, _ = frame_rgb.shape
    mask = (np.abs(frame_rgb.astype(int) - COLOUR).sum(axis=2) <= tolerance).astype(np.uint8)
    for x0, y0, x1, y1 in CARDS:
        mask[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)] = 0
    n, _, stats, cent = cv2.connectedComponentsWithStats(mask, connectivity=8)
    best = None
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if not (7 <= bw <= 30 and 7 <= bh <= 30) or not (0.7 <= bw / bh <= 1.4):
            continue
        fill = area / float(bw * bh)
        if fill > 0.65 or area < 14:   # a filled blob is not a ring
            continue
        if best is None or area > best[2]:
            best = (x + bw / 2.0, y + bh / 2.0, area)
    return best


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--out", required=True)
    ap.add_argument("--every", type=int, default=1)
    ap.add_argument("--tolerance", type=int, default=90)
    a = ap.parse_args()
    cap = cv2.VideoCapture(a.video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 60.0
    rows, i = [], 0
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        if i % a.every == 0:
            m = marker(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), a.tolerance)
            if m:
                rows.append((i, round(i / fps, 4), round(m[0], 1), round(m[1], 1)))
        i += 1
    with open(a.out, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["frame", "t", "x", "y"])
        w.writerows(rows)
    print(f"{i} frames read, the marker found in {len(rows)}")
