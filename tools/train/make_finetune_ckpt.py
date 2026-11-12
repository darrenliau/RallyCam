"""Turns the official TrackNetV3 checkpoint into a starting point for fine-tuning with TrackNetV3's own train.py.

  python3 tools/train/make_finetune_ckpt.py ckpts/TrackNet_best.pt exp/finetune/TrackNet_cur.pt [--lr 1e-4]

train.py can only start from scratch or resume its own `<save_dir>/TrackNet_cur.pt`. This copies the official weights there as if one epoch -1 had
been done, with the learning rate lowered, so `python train.py --resume_training --save_dir exp/finetune --epochs 30` fine-tunes them.
"""
import argparse
import os

import torch

ap = argparse.ArgumentParser()
ap.add_argument("official")
ap.add_argument("out")
ap.add_argument("--lr", type=float, default=1e-4)
a = ap.parse_args()
ck = torch.load(a.official, map_location="cpu")
ck["epoch"] = -1
ck["max_val_acc"] = 0.0
ck["param_dict"]["learning_rate"] = a.lr
if ck.get("optimizer"):
    for g in ck["optimizer"]["param_groups"]:
        g["lr"] = a.lr
        g["initial_lr"] = a.lr
os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
torch.save(ck, a.out)
print("written", a.out, "(learning rate", a.lr, "); it was trained with", {k: ck["param_dict"].get(k) for k in ("seq_len", "bg_mode", "batch_size")})
