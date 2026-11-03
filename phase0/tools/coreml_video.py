"""Finds the shuttle in a whole video with TrackNetV3 running as a Core ML model on the Mac's Neural Engine.

It does for a long recording what the app's ShuttleModel.swift does live: it shrinks the frames to 512 x 288, builds a background
picture (the median of the frames, which removes the players), and feeds the model 8 frames at a time. Unlike TrackNetV3's own
predict.py it reads the video as a stream, 20 seconds at a time, so a long video needs very little memory, and the Neural Engine
makes it fast (about 4 minutes for 12 minutes of 60 fps video on an M1).

  python3 coreml_video.py --model coreml_parity/tracknet-real.mlpackage --video ~/Desktop/new.mp4

Writes <video name>_coreml_ball.csv (Frame,Visibility,X,Y in the pixels of the original video) and <video name>_coreml_ball.json
(fps, width, height, how many frames). Needs ffmpeg and macOS. Without --keep-overlay, sightings that fall on the cards RallyCam draws
into its own videos (score, court map, distances, shuttle speed) are ignored, as the model is drawn to them.
"""
import argparse, csv, json, subprocess, sys, time
from pathlib import Path

import numpy as np

W, H, SEQ = 512, 288, 8
SEGMENT = 1200           # frames read at a time (20 seconds at 60 frames a second)
BG_EVERY = 10            # every 10th frame of a segment goes into its background


def probe(video):
    out = subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                   "stream=width,height,r_frame_rate", "-of", "csv=p=0", str(video)]).decode().strip().split(",")
    num, den = out[2].split("/")
    return int(out[0]), int(out[1]), float(num) / float(den)


# Cards RallyCam draws into its own videos, as fractions of the frame (x0, y0, x1, y1): court map, score board, shuttle cards, distances
OVERLAY = [(0.0, 0.0, 0.25, 0.43), (0.32, 0.0, 0.72, 0.29), (0.77, 0.0, 1.0, 0.36), (0.0, 0.74, 0.27, 1.0)]


def on_overlay(x, y):
    return any(a <= x <= c and b <= y <= d for a, b, c, d in OVERLAY)


def decode(heat, threshold):
    """(L, H, W) heatmaps -> per frame (x, y) in 512x288 pixels of the brightest point above the threshold, or None."""
    flat = heat.reshape(heat.shape[0], -1)
    idx, top = flat.argmax(-1), flat.max(-1)
    return [(int(idx[i] % W), int(idx[i] // W)) if top[i] > threshold else None for i in range(heat.shape[0])]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="the Core ML model (TrackNetV3.mlpackage / tracknet-real.mlpackage)")
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", default=".", help="folder for the CSV and JSON")
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--keep-overlay", action="store_true")
    ap.add_argument("--compute", default="ne", choices=["ne", "all", "cpu"], help="ne = Neural Engine (default)")
    ap.add_argument("--crop", help="x,y,w,h as fractions of the frame (top left origin): show the model only this part, as the app now does with the court. Positions in the CSV stay in the whole frame.")
    ap.add_argument("--max-seconds", type=float, help="only the first part of the video, to try it out")
    args = ap.parse_args()

    import coremltools as ct
    units = {"ne": ct.ComputeUnit.CPU_AND_NE, "all": ct.ComputeUnit.ALL, "cpu": ct.ComputeUnit.CPU_ONLY}[args.compute]
    model = ct.models.MLModel(str(Path(args.model).expanduser()), compute_units=units)
    video = Path(args.video).expanduser()
    ow, oh, fps = probe(video)
    cx, cy, cw, ch = (float(v) for v in args.crop.split(",")) if args.crop else (0.0, 0.0, 1.0, 1.0)
    sx, sy = ow * cw / W, oh * ch / H           # a model pixel in video pixels
    ox, oy = ow * cx, oh * cy                   # where the cropped part starts in the video
    print(f"{video.name}: {ow}x{oh}, {fps:g} frames a second")

    cmd = ["ffmpeg", "-v", "error", "-i", str(video)]
    if args.max_seconds:
        cmd += ["-t", str(args.max_seconds)]
    crop = f"crop=iw*{cw}:ih*{ch}:iw*{cx}:ih*{cy}," if args.crop else ""
    cmd += ["-vf", f"{crop}scale={W}:{H}:flags=bicubic", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    frame_bytes = W * H * 3

    rows, total, started, window_ms = [], 0, time.perf_counter(), []
    carry = np.zeros((0, H, W, 3), np.uint8)
    done = False
    while not done:
        raw = proc.stdout.read(SEGMENT * frame_bytes)
        n = len(raw) // frame_bytes
        done = n < SEGMENT
        frames = np.frombuffer(raw[: n * frame_bytes], np.uint8).reshape(n, H, W, 3) if n else np.zeros((0, H, W, 3), np.uint8)
        frames = np.concatenate([carry, frames]) if len(carry) else frames
        if len(frames) == 0:
            break
        first_index = total - len(carry)
        bg = np.moveaxis(np.median(frames[::BG_EVERY], axis=0).astype(np.float32), -1, 0) / 255.0   # (3, H, W)
        usable = (len(frames) // SEQ) * SEQ
        if done and usable < len(frames):          # the last few frames: repeat the final frame to fill a window
            pad = SEQ - (len(frames) - usable)
            frames = np.concatenate([frames, np.repeat(frames[-1:], pad, axis=0)])
            usable = len(frames)
        for w in range(0, usable, SEQ):
            chunk = np.moveaxis(frames[w:w + SEQ].astype(np.float32), -1, 1).reshape(SEQ * 3, H, W) / 255.0
            x = np.concatenate([bg, chunk], axis=0)[None]
            t = time.perf_counter()
            heat = list(model.predict({"frames": x}).values())[0][0]
            window_ms.append((time.perf_counter() - t) * 1000)
            for k, pk in enumerate(decode(heat, args.threshold)):
                rows.append((first_index + w + k, pk))
        carry = frames[usable:] if usable < len(frames) else np.zeros((0, H, W, 3), np.uint8)
        total += n
        elapsed = time.perf_counter() - started
        print(f"  {total / fps:6.0f} s of video done, {elapsed:5.0f} s elapsed, model {np.median(window_ms):.0f} ms a window", flush=True)
    proc.wait()

    frame_count = total
    out = Path(args.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    seen = ignored = 0
    with open(out / f"{video.stem}_coreml_ball.csv", "w", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(["Frame", "Visibility", "X", "Y"])
        for i, pk in rows:
            if i >= frame_count:
                break
            if pk is None:
                wr.writerow([i, 0, 0, 0])
                continue
            x, y = ox + (pk[0] + 0.5) * sx, oy + (pk[1] + 0.5) * sy
            if not args.keep_overlay and on_overlay(x / ow, y / oh):
                ignored += 1
                wr.writerow([i, 0, 0, 0])
                continue
            seen += 1
            wr.writerow([i, 1, round(x, 1), round(y, 1)])
    (out / f"{video.stem}_coreml_ball.json").write_text(json.dumps({"fps": fps, "width": ow, "height": oh, "frames": frame_count}))
    print(f"\n{frame_count} frames; the shuttle was seen in {seen} ({100 * seen / max(1, frame_count):.0f}%), "
          f"{ignored} sightings on RallyCam's own cards were ignored.")
    print("Wrote", out / f"{video.stem}_coreml_ball.csv", "and the matching .json")


if __name__ == "__main__":
    main()
