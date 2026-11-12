#!/usr/bin/env bash
# Fine-tunes TrackNetV3 on our own labelled footage. Run on a machine with a CUDA GPU (16 GB or more), from the repo root, after
# tools/train/prepare_dataset.py has filled ./data with train, val and test videos and labels (see tools/train/README.md).
#   bash tools/train/finetune.sh /path/to/official/TrackNet_best.pt
set -euo pipefail
OFFICIAL="${1:?the official TrackNetV3 checkpoint (TrackNet_best.pt)}"
WORK="${WORK:-$PWD/trackNetV3-work}"
[ -d "$WORK" ] || git clone https://github.com/qaz812345/TrackNetV3.git "$WORK"
cd "$WORK"
pip install -r requirements.txt
rm -rf data && cp -R "$OLDPWD/data" data
python preprocess.py                                   # cuts the frames and makes each match's background median
python "$OLDPWD/tools/train/make_finetune_ckpt.py" "$OFFICIAL" exp/finetune/TrackNet_cur.pt --lr 1e-4
# the settings (sequence length, background mode, batch size) come from the checkpoint; only the number of epochs is set here
python train.py --model_name TrackNet --resume_training --save_dir exp/finetune --epochs 30
# how well did it do on the held-out videos?
python test.py --tracknet_file exp/finetune/TrackNet_best.pt --save_dir exp/finetune/test --verbose
echo "Fine-tuned weights: $WORK/exp/finetune/TrackNet_best.pt. Compare them with the official ones on the same held-out videos before converting to Core ML."
