"""Find people in every Nth frame of a match video and save the boxes for tools/evaluate-tracking.ts.

  pip install torch torchvision opencv-python
  python3 tools/detect_people.py data/raw/s01.mp4 --out data/predictions/s01_people.csv
  python3 tools/detect_people.py data/raw/s01.mp4 --out ... --model fasterrcnn   # slower, more accurate

Writes OUT (frame,time_s,x,y,w,h,score; box values are fractions of the frame) and OUT.meta.json.

--model ssdlite is a small mobile-class detector, a fair stand-in for what could run on a phone.
--model fasterrcnn is much bigger. Use it to see the best result a detector could give on your footage.
The models are trained on COCO (people are class 1). Their weights are downloaded by torchvision the first time.
Check each model's licence before using any of this in the app. This script is for measuring only.
"""
import argparse
import csv
import json
import time

import cv2
import torch
import torchvision

PERSON = 1  # COCO class id in torchvision's detection models


def load_model(name, size):
    if name == "fasterrcnn":
        model = torchvision.models.detection.fasterrcnn_resnet50_fpn(weights="DEFAULT")
    else:
        model = torchvision.models.detection.ssdlite320_mobilenet_v3_large(weights="DEFAULT")
    if size:
        # The default input size (320 for ssdlite) makes distant players tiny. Let the user raise it.
        model.transform.min_size = (size,)
        model.transform.max_size = int(size * 16 / 9) + 1
    return model.eval()


def pick_device():
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def people_in(model, device, frame_bgr, min_score):
    """Returns [(x, y, w, h, score)] as fractions of the frame."""
    h, w = frame_bgr.shape[:2]
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    tensor = torch.from_numpy(rgb).permute(2, 0, 1).float().div(255).to(device)
    with torch.no_grad():
        out = model([tensor])[0]
    boxes = []
    for box, label, score in zip(out["boxes"].cpu().tolist(), out["labels"].cpu().tolist(), out["scores"].cpu().tolist()):
        if label != PERSON or score < min_score:
            continue
        x1, y1, x2, y2 = box
        boxes.append((x1 / w, y1 / h, (x2 - x1) / w, (y2 - y1) / h, score))
    return boxes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--out", required=True)
    ap.add_argument("--fps", type=float, default=15, help="frames per second to analyse (a phone would not do 120)")
    ap.add_argument("--model", choices=["ssdlite", "fasterrcnn"], default="ssdlite")
    ap.add_argument("--size", type=int, default=640, help="model input size, shorter side (0 = model default)")
    ap.add_argument("--min-score", type=float, default=0.3)
    ap.add_argument("--max-seconds", type=float, default=0, help="stop after this many seconds (0 = whole video)")
    a = ap.parse_args()

    cap = cv2.VideoCapture(a.video)
    if not cap.isOpened():
        raise SystemExit(f"Cannot open {a.video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    step = max(1, round(fps / a.fps))
    if a.max_seconds:
        total = min(total, int(a.max_seconds * fps))

    device = pick_device()
    model = load_model(a.model, a.size).to(device)
    print(f"{a.video}: {width}x{height} at {fps:.1f} fps, {total} frames, analysing every {step}th on {device}")

    spent = 0.0
    analysed = 0
    with open(a.out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["frame", "time_s", "x", "y", "w", "h", "score"])
        frame_no = 0
        while frame_no < total:
            ok, frame = cap.read()
            if not ok:
                break
            if frame_no % step == 0:
                t0 = time.time()
                boxes = people_in(model, device, frame, a.min_score)
                spent += time.time() - t0
                analysed += 1
                for x, y, bw, bh, s in boxes:
                    w.writerow([frame_no, f"{frame_no / fps:.3f}", f"{x:.5f}", f"{y:.5f}", f"{bw:.5f}", f"{bh:.5f}", f"{s:.3f}"])
            frame_no += 1

    with open(a.out + ".meta.json", "w") as f:
        json.dump({"width": width, "height": height, "fps": fps, "totalFrames": frame_no, "frameStep": step}, f)
    if analysed:
        print(f"{analysed} frames analysed, {1000 * spent / analysed:.0f} ms per frame on {device}")


if __name__ == "__main__":
    main()
