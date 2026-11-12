# Training the shuttle model on our own footage

What is here, what it needs, and the steps. **Nothing in here has been run to completion**: the session that wrote it had no GPU (`train.py` of TrackNetV3 is CUDA-only), no clean footage, and no hand-marked shuttle labels.

## Why it is worth it
The on-phone model (TrackNetV3, trained on broadcast footage) sees the shuttle in about 24-40% of frames in our hall recordings. Our footage is a different view (a phone low behind or beside the court, several courts, ceiling lights), so fine-tuning on it is the biggest likely gain (research notes in the plan; the figures are unverified).

## What is needed (and is missing today)
1. **Clean footage.** Every recording we have has the app's overlay burned in (score cards, player rings, **a ring on the shuttle where the app thought it was**). Training on it would teach the model to look for our own marker (label leakage) and the cards. Record new games with **Settings > Keep a clean copy (experimental)** on: that file has no overlay. (The scoreboard cards can be masked, the shuttle ring and rings under players cannot.)
2. **Labels.** The shuttle's position in each frame, as a csv per video in TrackNet's format: `Frame,Visibility,X,Y` (X, Y in pixels of the video, `Visibility` 1 when the shuttle can be seen, 0 when not; at 0, X and Y are 0). A few thousand labelled frames from several halls, lighting and camera spots; keep at least one whole game or hall **out** of training for testing.
3. **A GPU** (a rented one is fine, 16 GB or more). On this session's 4-CPU machine one epoch would take hours to days.
4. **The official TrackNetV3 checkpoint** (from the TrackNetV3 README's Google Drive link) to start from, so that few labels are enough.

## Steps
1. **Pre-labels to correct** (saves most of the labelling time): `python3 tools/train/pseudo_labels.py ball.csv --court corners.json --out prelabels.csv` turns an existing model track (`*_coreml_ball.csv`) into a label csv, dropping sightings outside the court's region and short or still tracks. These are **guesses**: they must be checked and corrected by eye (move, delete or add the shuttle) before use; training on them unchecked only teaches the model its own mistakes.
2. **Check / correct** the csv in a labelling tool (CVAT, Label Studio, or the labelling page to be built) until every frame is right.
3. **Build the dataset:** `python3 tools/train/prepare_dataset.py --video clean.mp4 --labels labels.csv --match 1 --split train --out data` (repeat for each video; use `--split val` and `--split test` for held-out videos). It checks the csv against the video and writes the layout TrackNetV3 expects (`data/<split>/match<N>/{video,csv}`).
4. **On the GPU machine:** `bash tools/train/finetune.sh` (clones TrackNetV3, installs it, runs its `preprocess.py` to cut frames and make the background median, turns the official checkpoint into a starting point with `make_finetune_ckpt.py`, trains with a low learning rate, then tests).
5. **Compare before shipping:** run the old and the new model on the held-out videos (`tools/evaluate-shuttle.ts`, `tools/compare-tracknet.ts`): share of frames where the shuttle is found within 5 px of the label, false sightings, and the number of hits found.
6. **Convert to Core ML** with `phase0/tools/run-coreml-parity.sh` on a Mac (see `modules/rallycam-export/ios/Models/README.md`), then check its speed and heat on the phone with the camera running.

## Licences
TrackNetV3 code and weights are listed as MIT (check the repo's LICENSE). Check the licence of any dataset added. Our own footage: keep players' consent in mind (the privacy policy).
