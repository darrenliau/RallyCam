"""Turns a model's shuttle track into a label csv to be CORRECTED BY HAND (never to be trained on as it is).

  python3 tools/train/pseudo_labels.py ball.csv --court corners.json --width 1920 --height 1080 --out prelabels.csv [--region-margin 0.06]

ball.csv: Frame,Visibility,X,Y from TrackNetV3 (for example `*_coreml_ball.csv`, pixels). Keeps a sighting only if it is inside the court's region
(the court, 6% beyond its side lines and the air above it, as in src/analysis/courtRegion.ts) and part of a run of at least 6 sightings in a row,
each within 400 px of the one before: single sightings and still specks are dropped. The result says how many frames it keeps.
"""
import argparse
import csv
import json
import math


def region(corners, w, h, margin):
    c = [corners[k] for k in ("farLeft", "farRight", "nearRight", "nearLeft")]
    xs = [p["x"] * w for p in c]; ys = [p["y"] * h for p in c]
    x0, x1 = min(xs), max(xs)
    width = x1 - x0
    top = min(ys) - 0.9 * (max(ys) - min(ys))        # the air above the court, up to 0.9 of its height in the picture
    return x0 - margin * width, x1 + margin * width, top, max(ys) + 0.1 * (max(ys) - min(ys))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("ball")
    ap.add_argument("--court", required=True)
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--region-margin", type=float, default=0.06)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    corners = json.load(open(a.court))
    x0, x1, y0, y1 = region(corners, a.width, a.height, a.region_margin)
    rows = [(int(r["Frame"]), int(r["Visibility"]), float(r["X"]), float(r["Y"])) for r in csv.DictReader(open(a.ball))]
    keep = [False] * len(rows)
    run = []
    def flush():
        if len(run) >= 6:
            for i in run: keep[i] = True
        run.clear()
    for i, (f, v, x, y) in enumerate(rows):
        inside = v == 1 and x0 <= x <= x1 and y0 <= y <= y1
        if inside and (not run or math.hypot(x - rows[run[-1]][2], y - rows[run[-1]][3]) <= 400):
            run.append(i)
        else:
            flush()
            if inside: run.append(i)
    flush()
    with open(a.out, "w", newline="") as fh:
        w = csv.writer(fh); w.writerow(["Frame", "Visibility", "X", "Y"])
        for i, (f, v, x, y) in enumerate(rows):
            w.writerow([f, 1, round(x, 1), round(y, 1)] if keep[i] else [f, 0, 0, 0])
    print(f"{sum(keep)} of {len(rows)} frames kept as shuttle sightings ({100 * sum(keep) / max(1, len(rows)):.0f}%) -> {a.out}. Check every one by eye before training.")
