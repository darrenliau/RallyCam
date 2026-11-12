"""Puts a video and its shuttle labels where TrackNetV3's own tools (preprocess.py, train.py) expect them.

  python3 tools/train/prepare_dataset.py --video clean.mp4 --labels labels.csv --match 1 --split train --out data [--rally rally1]

labels.csv: Frame,Visibility,X,Y  (X, Y in pixels of the video; Visibility 1 or 0, X = Y = 0 when 0). One row per frame, starting at frame 0.
Writes  <out>/<split>/match<N>/video/<rally>.mp4  and  <out>/<split>/match<N>/csv/<rally>_ball.csv, then run TrackNetV3's
`python preprocess.py` to cut the frames and make the background median. Refuses a labels file that does not fit the video.
"""
import argparse
import csv
import os
import shutil
import subprocess
import sys


def probe(video):
    out = subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries",
                                   "stream=width,height,nb_read_frames", "-of", "csv=p=0", video]).decode().strip().split(",")
    return int(out[0]), int(out[1]), int(out[2])


def read_labels(path):
    rows = []
    with open(path, newline="") as fh:
        for r in csv.DictReader(fh):
            rows.append((int(r["Frame"]), int(r["Visibility"]), float(r["X"]), float(r["Y"])))
    return rows


def check(rows, frames, width, height):
    problems = []
    if [r[0] for r in rows] != list(range(len(rows))):
        problems.append("Frame must count 0, 1, 2, ... with no gaps")
    if len(rows) != frames:
        problems.append(f"{len(rows)} label rows for a video of {frames} frames")
    for f, v, x, y in rows:
        if v not in (0, 1):
            problems.append(f"frame {f}: Visibility must be 0 or 1"); break
        if v == 1 and not (0 <= x < width and 0 <= y < height):
            problems.append(f"frame {f}: the shuttle at ({x}, {y}) is outside the {width}x{height} picture"); break
        if v == 0 and (x or y):
            problems.append(f"frame {f}: Visibility 0 needs X = Y = 0"); break
    return problems


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--labels", required=True)
    ap.add_argument("--match", type=int, required=True)
    ap.add_argument("--split", choices=["train", "val", "test"], required=True)
    ap.add_argument("--out", default="data")
    ap.add_argument("--rally", default=None, help="name of this video in the dataset (default: the file's name)")
    a = ap.parse_args()
    width, height, frames = probe(a.video)
    rows = read_labels(a.labels)
    problems = check(rows, frames, width, height)
    if problems:
        print("The labels do not fit the video:\n  " + "\n  ".join(problems))
        sys.exit(1)
    rally = a.rally or os.path.splitext(os.path.basename(a.video))[0]
    base = os.path.join(a.out, a.split, f"match{a.match}")
    os.makedirs(os.path.join(base, "video"), exist_ok=True)
    os.makedirs(os.path.join(base, "csv"), exist_ok=True)
    shutil.copy(a.video, os.path.join(base, "video", f"{rally}.mp4"))
    with open(os.path.join(base, "csv", f"{rally}_ball.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["Frame", "Visibility", "X", "Y"])
        w.writerows(rows)
    seen = sum(r[1] for r in rows)
    print(f"{rally}: {frames} frames {width}x{height}, the shuttle labelled visible in {seen} ({100 * seen / frames:.0f}%) -> {base}")
