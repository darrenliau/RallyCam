"""Run TrackNetV3 on Phase 0 videos and score the results.

For every data/raw/<session>.mp4 this will:
  1. call TrackNetV3's own predict.py (so we use the authors' pipeline unchanged)
  2. convert its CSV (Frame,Visibility,X,Y) to our format (frame,x,y)
  3. if data/labels/<session>_shuttle.csv exists, print the shuttle scorecard

Setup (once, on a machine with an NVIDIA GPU or Apple/CPU fallback):
  git clone https://github.com/qaz812345/TrackNetV3 ~/TrackNetV3
  pip install -r ~/TrackNetV3/requirements.txt
  download TrackNet_best.pt and InpaintNet_best.pt (links in the TrackNetV3 README)
  into ~/TrackNetV3/exps/

Usage:
  python3 tools/run_tracknet.py --repo ~/TrackNetV3 --data data
  python3 tools/run_tracknet.py --repo ~/TrackNetV3 --data data --session s01 --tol 8
"""
import argparse, csv, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import evaluate  # noqa: E402  (our scorer, same folder)


def run_predict(repo, video, out_dir, tracknet, inpaint, batch_size):
    cmd = [sys.executable, "predict.py", "--video_file", str(video), "--tracknet_file", str(tracknet),
           "--save_dir", str(out_dir), "--batch_size", str(batch_size)]
    if inpaint:
        cmd += ["--inpaintnet_file", str(inpaint)]
    # predict.py imports modules from its own folder, so it must run from the repo
    subprocess.run(cmd, cwd=repo, check=True)


def convert(raw_csv, out_csv):
    """TrackNetV3 writes Frame,Visibility,X,Y in original-video pixels; keep only detected frames."""
    n = found = 0
    with open(raw_csv, newline="") as f, open(out_csv, "w", newline="") as g:
        w = csv.writer(g)
        w.writerow(["frame", "x", "y"])
        for r in csv.DictReader(f):
            n += 1
            if int(float(r["Visibility"])) == 1:
                found += 1
                w.writerow([int(float(r["Frame"])), r["X"], r["Y"]])
            else:
                w.writerow([int(float(r["Frame"])), "", ""])
    return n, found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="path to the cloned TrackNetV3 repo")
    ap.add_argument("--data", default="data")
    ap.add_argument("--session", help="only this session id (file stem of data/raw/*.mp4)")
    ap.add_argument("--tracknet", help="default: <repo>/exps/TrackNet_best.pt")
    ap.add_argument("--inpaintnet", help="default: <repo>/exps/InpaintNet_best.pt if it exists")
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--tol", type=float, default=8, help="pixel tolerance for a correct detection")
    a = ap.parse_args()

    repo, data = Path(a.repo).expanduser().resolve(), Path(a.data).resolve()
    tracknet = Path(a.tracknet) if a.tracknet else repo / "exps" / "TrackNet_best.pt"
    inpaint = Path(a.inpaintnet) if a.inpaintnet else repo / "exps" / "InpaintNet_best.pt"
    inpaint = inpaint if inpaint.exists() else None
    if not tracknet.exists():
        sys.exit(f"Missing weights: {tracknet}")

    pred_dir, raw_dir = data / "predictions", data / "predictions" / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    videos = sorted((data / "raw").glob("*.mp4"))
    if a.session:
        videos = [v for v in videos if v.stem == a.session]
    if not videos:
        sys.exit(f"No videos found in {data / 'raw'}")

    for v in videos:
        print(f"\n=== {v.stem} ===")
        run_predict(repo, v, raw_dir, tracknet, inpaint, a.batch_size)
        raw_csv = raw_dir / f"{v.stem}_ball.csv"
        if not raw_csv.exists():
            sys.exit(f"Expected {raw_csv} but TrackNetV3 did not write it. Check its output folder.")
        out_csv = pred_dir / f"{v.stem}_shuttle_pred.csv"
        n, found = convert(raw_csv, out_csv)
        print(f"frames: {n}   shuttle found in: {found} ({found / max(n, 1):.0%})")
        labels = data / "labels" / f"{v.stem}_shuttle.csv"
        if labels.exists():
            evaluate.shuttle(evaluate.rows(labels), evaluate.rows(out_csv), a.tol)
        else:
            print(f"(no labels yet at {labels}, so no score)")


if __name__ == "__main__":
    main()
