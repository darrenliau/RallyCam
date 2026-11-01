"""How fast could a TrackNet-style shuttle model run on an iPhone?

Builds the TrackNetV3 network at several sizes (full width, and narrower and shorter versions that a phone model could use),
converts each to Core ML, and times it on this Mac (same kind of Neural Engine as an iPhone). It needs no trained weights,
because speed does not depend on them. Open the .mlpackage files in Xcode to time them on a real iPhone (see README.md here).

  python3 coreml_speed_test.py                  # build, convert and time every variant
  python3 coreml_speed_test.py --only half-3f   # just one
  python3 coreml_speed_test.py --repo ~/TrackNetV3 --ckpt ~/TrackNetV3/ckpts/TrackNet_best.pt
                                                # also load the real TrackNetV3 weights into the full-size model

Output: coreml_models/<name>.mlpackage and coreml_speed.csv in the current folder.
"""
import argparse, csv, statistics, sys, time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn


class Block(nn.Module):
    """Conv + BatchNorm + ReLU, like TrackNetV3's Conv2DBlock."""
    def __init__(self, i, o):
        super().__init__()
        self.conv = nn.Conv2d(i, o, 3, padding=1, bias=False)
        self.bn = nn.BatchNorm2d(o)
        self.relu = nn.ReLU()

    def forward(self, x):
        return self.relu(self.bn(self.conv(x)))


class Stack(nn.Module):
    """Two or three Blocks in a row, named conv_1, conv_2, conv_3 like TrackNetV3's Double2DConv and Triple2DConv."""
    def __init__(self, i, o, n):
        super().__init__()
        self.conv_1 = Block(i, o)
        self.conv_2 = Block(o, o)
        if n == 3:
            self.conv_3 = Block(o, o)

    def forward(self, x):
        x = self.conv_2(self.conv_1(x))
        return self.conv_3(x) if hasattr(self, "conv_3") else x


def stack(i, o, n):
    return Stack(i, o, n)


class TrackNet(nn.Module):
    """The TrackNetV3 layout (TrackNet class in its model.py), with every channel count scaled by `width`.
    width=1 is the real thing. Layer names match, so the real weights load into a width=1 model."""
    def __init__(self, in_dim, out_dim, width=1.0):
        super().__init__()
        c = lambda n: max(4, int(round(n * width)))
        self.down_block_1 = stack(in_dim, c(64), 2)
        self.down_block_2 = stack(c(64), c(128), 2)
        self.down_block_3 = stack(c(128), c(256), 3)
        self.bottleneck = stack(c(256), c(512), 3)
        self.up_block_1 = stack(c(512) + c(256), c(256), 3)
        self.up_block_2 = stack(c(256) + c(128), c(128), 2)
        self.up_block_3 = stack(c(128) + c(64), c(64), 2)
        self.predictor = nn.Conv2d(c(64), out_dim, 1)
        self.pool = nn.MaxPool2d(2, 2)
        self.up = nn.Upsample(scale_factor=2)

    def forward(self, x):
        x1 = self.down_block_1(x)
        x2 = self.down_block_2(self.pool(x1))
        x3 = self.down_block_3(self.pool(x2))
        x = self.bottleneck(self.pool(x3))
        x = self.up_block_1(torch.cat([self.up(x), x3], 1))
        x = self.up_block_2(torch.cat([self.up(x), x2], 1))
        x = self.up_block_3(torch.cat([self.up(x), x1], 1))
        return torch.sigmoid(self.predictor(x))


# name: (width, frames, height, width in pixels). Input channels = (frames + 1) * 3: the frames plus a background picture,
# as TrackNetV3 does. Output = one heatmap per frame. Most of the work is in the full-size layers and does not grow with the
# number of frames, so 8 frames in one prediction cost far less per frame than 3.
VARIANTS = {
    "v3-full":          (1.00, 8, 288, 512),   # the real TrackNetV3 shape
    "v3-3f":            (1.00, 3, 288, 512),
    "half-8f":          (0.50, 8, 288, 512),
    "half-3f":          (0.50, 3, 288, 512),
    "quarter-8f":       (0.25, 8, 288, 512),
    "quarter-3f":       (0.25, 3, 288, 512),
    "eighth-8f":        (0.125, 8, 288, 512),
    "eighth-3f":        (0.125, 3, 288, 512),
    "half-8f-hires":    (0.50, 8, 432, 768),
    "quarter-8f-hires": (0.25, 8, 432, 768),
    "quarter-3f-hires": (0.25, 3, 432, 768),
}


def conv_gmacs(model, shape):
    """Multiply-adds of all the convolutions for one forward pass, in billions."""
    total = [0]
    def hook(m, inp, out):
        total[0] += out.numel() // out.shape[0] * (m.in_channels // m.groups) * m.kernel_size[0] * m.kernel_size[1]
    hs = [m.register_forward_hook(hook) for m in model.modules() if isinstance(m, nn.Conv2d)]
    with torch.no_grad():
        model(torch.zeros(1, *shape))
    for h in hs:
        h.remove()
    return total[0] / 1e9


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="a variant name, or several separated by commas")
    ap.add_argument("--out", default="coreml_models")
    ap.add_argument("--runs", type=int, default=40)
    ap.add_argument("--no-time", action="store_true", help="convert only (timing needs macOS)")
    ap.add_argument("--repo", help="TrackNetV3 folder, to load the real weights into v3-full")
    ap.add_argument("--ckpt", help="TrackNet_best.pt")
    args = ap.parse_args()

    import coremltools as ct
    names = args.only.split(",") if args.only else list(VARIANTS)
    out = Path(args.out)
    out.mkdir(exist_ok=True)
    can_time = sys.platform == "darwin" and not args.no_time
    units = {"all": ct.ComputeUnit.ALL, "neural_engine": ct.ComputeUnit.CPU_AND_NE,
             "gpu": ct.ComputeUnit.CPU_AND_GPU, "cpu": ct.ComputeUnit.CPU_ONLY} if can_time else {}

    rows = []
    for name in names:
        width, frames, h, w = VARIANTS[name]
        in_dim = (frames + 1) * 3
        model = TrackNet(in_dim, frames, width).eval()
        if name == "v3-full" and args.ckpt:
            ck = torch.load(args.ckpt, map_location="cpu")
            model.load_state_dict(ck["model"] if "model" in ck else ck)
            print("loaded real weights into v3-full")
        shape = (in_dim, h, w)
        params = sum(p.numel() for p in model.parameters()) / 1e6
        gmacs = conv_gmacs(model, shape)
        print(f"\n== {name}: {params:.2f} M parameters, {gmacs:.1f} GMACs, input {in_dim}x{h}x{w}, output {frames} heatmaps")
        example = torch.zeros(1, *shape)
        traced = torch.jit.trace(model, example)
        mlmodel = ct.convert(
            traced,
            inputs=[ct.TensorType(name="frames", shape=example.shape)],
            outputs=[ct.TensorType(name="heatmaps")],
            convert_to="mlprogram",
            compute_precision=ct.precision.FLOAT16,
            minimum_deployment_target=ct.target.iOS16,
        )
        path = out / f"{name}.mlpackage"
        mlmodel.save(str(path))
        size_mb = sum(f.stat().st_size for f in path.rglob("*") if f.is_file()) / 1e6
        row = {"name": name, "params_M": round(params, 2), "GMACs": round(gmacs, 1), "frames": frames,
               "size": f"{in_dim}x{h}x{w}", "file_MB": round(size_mb, 1)}
        if can_time:
            x = {"frames": np.zeros((1, *shape), dtype=np.float32)}
            for label, cu in units.items():
                try:
                    m = ct.models.MLModel(str(path), compute_units=cu)
                    for _ in range(5):
                        m.predict(x)
                    ts = []
                    for _ in range(args.runs):
                        t = time.perf_counter()
                        m.predict(x)
                        ts.append((time.perf_counter() - t) * 1000)
                    med = statistics.median(ts)
                    row[f"{label}_ms"] = round(med, 1)
                    row[f"{label}_ms_per_frame"] = round(med / frames, 1)
                    print(f"   {label:14s} {med:7.1f} ms per prediction  =  {med / frames:6.1f} ms per frame  ({1000 * frames / med:5.1f} frames/s)")
                except Exception as e:  # a unit may not support the model
                    print(f"   {label:14s} failed: {str(e)[:80]}")
        rows.append(row)

    keys = sorted({k for r in rows for k in r}, key=lambda k: (k not in ("name", "params_M", "GMACs", "frames", "size", "file_MB"), k))
    with open("coreml_speed.csv", "w", newline="") as f:
        wr = csv.DictWriter(f, fieldnames=keys)
        wr.writeheader()
        wr.writerows(rows)
    print("\nWrote coreml_speed.csv and", out)


if __name__ == "__main__":
    main()
