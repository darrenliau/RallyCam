"""Reads the players' rings out of a video RallyCam recorded with its overlay, giving the tracker's own positions for those moments.

  python3 tools/read_rings.py clip-1.mp4 --out rings.csv [--every 3] [--offset-frames 0]

RallyCam draws a ring under each tracked player's feet in that player's colour (near side: lime, teal; far side: purple, pink: see
src/theme and ass.ts). This finds the four colours in each frame and writes the centre of each ring as a pixel position in the video:
  frame,t,player,x,y        (player 0 = lime, 1 = teal, 2 = purple, 3 = pink; frame counts from --offset-frames)
It is for measuring offline what the app's tracker saw; it needs opencv and numpy (pip install opencv-python-headless).
"""
import argparse
import csv

import cv2
import numpy as np

COLOURS = [(200, 240, 74), (63, 214, 198), (169, 139, 255), (255, 111, 154)]  # RGB: #C8F04A #3FD6C6 #A98BFF #FF6F9A
# parts of the picture RallyCam's own cards use (court map, distance card, shuttle cards, score card), as fractions: x0, y0, x1, y1
CARDS = [(0.0, 0.0, 0.17, 0.40), (0.0, 0.78, 0.27, 1.0), (0.76, 0.0, 1.0, 0.46), (0.26, 0.0, 0.74, 0.30)]


def rings(frame_rgb, tolerance):
    h, w, _ = frame_rgb.shape
    found = {}
    for k, colour in enumerate(COLOURS):
        diff = np.abs(frame_rgb.astype(int) - np.array(colour)).sum(axis=2)
        mask = (diff < tolerance).astype(np.uint8)
        for x0, y0, x1, y1 in CARDS:
            mask[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)] = 0
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        n, _, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
        best = None
        for i in range(1, n):
            x, y, bw, bh, area = stats[i]
            # a ring is a thin ellipse lying flat: wide, low, and mostly empty inside its box
            if bw < 16 or bh < 5 or not (1.6 <= bw / bh <= 7) or area > 0.65 * bw * bh:
                continue
            cx, cy = x + bw / 2, y + bh / 2
            if best is None or bw > best[2]:
                best = (cx, cy, bw)
        if best:
            found[k] = best[:2]
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--out", required=True)
    ap.add_argument("--every", type=int, default=3, help="look at every Nth frame")
    ap.add_argument("--offset-frames", type=int, default=0)
    ap.add_argument("--tolerance", type=int, default=110)
    args = ap.parse_args()
    cap = cv2.VideoCapture(args.video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 60.0
    rows, i = [], 0
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        if i % args.every == 0:
            for k, (x, y) in rings(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), args.tolerance).items():
                rows.append((i + args.offset_frames, round((i + args.offset_frames) / fps, 4), k, round(x, 1), round(y, 1)))
        i += 1
    with open(args.out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["frame", "t", "player", "x", "y"])
        w.writerows(rows)
    print(f"{i} frames read, {len(rows)} ring positions written to {args.out}")


if __name__ == "__main__":
    main()
