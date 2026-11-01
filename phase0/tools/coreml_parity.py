"""Does the real TrackNetV3 give the same answers once it is converted to Core ML?

Converts the real TrackNetV3 weights to Core ML (half precision, the form that runs on the iPhone's Neural Engine), runs both the
PyTorch model and the Core ML model over a clip, and compares them. Writes the Core ML model's shuttle positions in the same
CSV form as TrackNetV3's own (Frame,Visibility,X,Y), so tools/compare-tracknet.ts can score them against the same labels.

  python3 coreml_parity.py --repo ~/TrackNetV3 --ckpt ~/TrackNetV3/ckpts/TrackNet_best.pt --video ~/Desktop/clip5.mp4

Needs ffmpeg, and macOS for the Core ML half (use --no-coreml to run only the PyTorch half anywhere).
Positions are in the pixels of the original video, found as the brightest point of each heatmap, without InpaintNet.
"""
import argparse, csv, subprocess, sys, time
from pathlib import Path

import numpy as np
import torch

W, H = 512, 288  # the size TrackNetV3 looks at


def probe(video):
    out = subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                                   "-of", "csv=p=0", str(video)]).decode().strip().split(",")
    return int(out[0]), int(out[1])


def read_frames(video):
    """All frames of the clip at 512x288, RGB, as uint8 (N, H, W, 3). ffmpeg decodes, so the phone's video format is no problem."""
    cmd = ["ffmpeg", "-v", "error", "-i", str(video), "-vf", f"scale={W}:{H}:flags=bicubic", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    raw = subprocess.check_output(cmd)
    n = len(raw) // (W * H * 3)
    return np.frombuffer(raw[: n * W * H * 3], dtype=np.uint8).reshape(n, H, W, 3)


def build_model(args):
    sys.path.insert(0, str(Path(args.repo).expanduser())) if args.repo else None
    if args.random:
        # for checking this script without the weights: the same network, random numbers
        sys.path.insert(0, str(Path(__file__).parent))
        from coreml_speed_test import TrackNet
        return TrackNet(27, 8, 1.0).eval(), 8
    import model as repo_model  # TrackNetV3's own model.py
    ck = torch.load(Path(args.ckpt).expanduser(), map_location="cpu")
    seq_len, bg_mode = ck["param_dict"]["seq_len"], ck["param_dict"]["bg_mode"]
    if bg_mode != "concat":
        sys.exit(f"This script handles TrackNetV3's usual bg_mode 'concat', and this checkpoint uses '{bg_mode}'.")
    m = repo_model.TrackNet(in_dim=(seq_len + 1) * 3, out_dim=seq_len)
    m.load_state_dict(ck["model"])
    return m.eval(), seq_len


def windows(frames, seq_len):
    """Input for each non-overlapping window of seq_len frames: the background picture, then the frames, all / 255,
    as TrackNetV3 does (bg_mode 'concat'). The background is the median of every 5th frame, which removes moving players."""
    median = np.median(frames[::5], axis=0).astype(np.float32)
    bg = np.moveaxis(median, -1, 0)  # (3, H, W)
    n = len(frames) // seq_len
    xs = []
    for i in range(n):
        f = np.moveaxis(frames[i * seq_len:(i + 1) * seq_len].astype(np.float32), -1, 1).reshape(seq_len * 3, H, W)
        xs.append(np.concatenate([bg, f], axis=0) / 255.0)
    return np.stack(xs) if xs else np.zeros((0, (seq_len + 1) * 3, H, W), np.float32), n


def peaks(heat, threshold=0.5):
    """(N, L, H, W) heatmaps -> per frame (x, y) of the brightest point in 512x288 pixels, or None if nothing passes the threshold."""
    flat = heat.reshape(*heat.shape[:2], -1)
    idx, top = flat.argmax(-1), flat.max(-1)
    out = []
    for n in range(heat.shape[0]):
        for l in range(heat.shape[1]):
            out.append((idx[n, l] % W, idx[n, l] // W) if top[n, l] > threshold else None)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo"), ap.add_argument("--ckpt"), ap.add_argument("--video", required=True)
    ap.add_argument("--out", default="coreml_parity")
    ap.add_argument("--random", action="store_true", help="random weights, just to test this script")
    ap.add_argument("--no-coreml", action="store_true")
    args = ap.parse_args()
    if not args.random and not (args.repo and args.ckpt):
        sys.exit("Give --repo and --ckpt (or --random to test the script).")

    out = Path(args.out)
    out.mkdir(exist_ok=True)
    video = Path(args.video).expanduser()
    ow, oh = probe(video)
    sx, sy = ow / W, oh / H
    model, seq_len = build_model(args)
    frames = read_frames(video)
    x, n_win = windows(frames, seq_len)
    print(f"{len(frames)} frames, {n_win} windows of {seq_len}; original {ow}x{oh}")

    with torch.no_grad():
        t = time.perf_counter()
        torch_heat = np.concatenate([model(torch.from_numpy(x[i:i + 1])).numpy() for i in range(n_win)])
        print(f"PyTorch on CPU: {(time.perf_counter() - t) / max(1, n_win) * 1000:.0f} ms per window")
    torch_peaks = peaks(torch_heat)

    coreml_peaks = None
    if not args.no_coreml:
        import coremltools as ct
        ex = torch.zeros(1, (seq_len + 1) * 3, H, W)
        ml = ct.convert(torch.jit.trace(model, ex), inputs=[ct.TensorType(name="frames", shape=ex.shape)],
                        outputs=[ct.TensorType(name="heatmaps")], convert_to="mlprogram",
                        compute_precision=ct.precision.FLOAT16, minimum_deployment_target=ct.target.iOS16)
        path = out / "tracknet-real.mlpackage"
        ml.save(str(path))
        print("Saved", path)
        if sys.platform != "darwin":
            print("Not macOS: skipping the Core ML run.")
        else:
            m2 = ct.models.MLModel(str(path), compute_units=ct.ComputeUnit.CPU_AND_NE)
            heats, times = [], []
            for i in range(n_win):
                t = time.perf_counter()
                heats.append(list(m2.predict({"frames": x[i:i + 1]}).values())[0])
                times.append((time.perf_counter() - t) * 1000)
            ml_heat = np.concatenate(heats).astype(np.float32)
            coreml_peaks = peaks(ml_heat)
            print(f"Core ML on the Neural Engine: median {np.median(times):.1f} ms per window of {seq_len} frames")
            diff = np.abs(ml_heat - torch_heat)
            print(f"Heatmap difference, Core ML vs PyTorch: max {diff.max():.3f}, mean {diff.mean():.6f}")
            both = [(a, b) for a, b in zip(torch_peaks, coreml_peaks)]
            seen_t = sum(a is not None for a, _ in both)
            seen_c = sum(b is not None for _, b in both)
            agree = [a is not None and b is not None and abs(a[0] - b[0]) <= 4 and abs(a[1] - b[1]) <= 4 for a, b in both]
            print(f"Shuttle found in {seen_t} frames by PyTorch, {seen_c} by Core ML; same spot (within 4 px) in {sum(agree)}")

    for name, pk in (("pytorch", torch_peaks), ("coreml", coreml_peaks)):
        if pk is None:
            continue
        with open(out / f"{video.stem}_{name}_ball.csv", "w", newline="") as f:
            wr = csv.writer(f)
            wr.writerow(["Frame", "Visibility", "X", "Y"])
            for i, p in enumerate(pk):
                wr.writerow([i, 1, round(p[0] * sx, 1), round(p[1] * sy, 1)] if p else [i, 0, 0, 0])
        print("Wrote", out / f"{video.stem}_{name}_ball.csv")


if __name__ == "__main__":
    main()
