# Core ML speed test

Question: how fast can a TrackNet-style shuttle model run on an iPhone, and so how big can the phone model be?

The test builds the TrackNetV3 network at several sizes, converts each to Core ML in half precision, and times it. No trained
weights are needed: speed does not depend on what the weights are. (To check the real weights convert and give the same speed, add
`--repo ~/TrackNetV3 --ckpt ~/TrackNetV3/ckpts/TrackNet_best.pt`.)

## Quickest path: skip step 1

The converted models are also available as a zip (`coreml_models.zip`, 67 MB, sent in the chat). Unzip it and go straight to
step 2: Xcode times the models on your iPhone with no Python at all. Step 1 is for the Mac timing and for rebuilding the models.

## 1. Run it on your Mac

```bash
cd RallyCam && git pull origin main
phase0/tools/run-coreml-speed-test.sh
```
It needs Python 3.11 to 3.13 (`brew install python@3.12` if the script says so). The first run installs PyTorch and coremltools,
which takes a few minutes. It prints a line per variant for each way of running (all units, Neural Engine, GPU, CPU) and writes
`coreml_speed.csv` and the `coreml_models/` folder. Send me the CSV.

## 2. Time it on the iPhone (the number that matters)

Xcode can time a Core ML model on a connected phone with no code:
1. Plug in the iPhone and trust the Mac. In Xcode, open `coreml_models/quarter-3f.mlpackage` (double click).
2. Click the **Performance** tab, choose your iPhone as the device, and press **Run** (or **+ Performance Report**).
3. Note the median time for each compute unit (CPU, GPU, Neural Engine). Repeat for each variant, or at least `half-3f`,
   `quarter-3f` and `v3-full`.
4. Send me a list like: `quarter-3f: Neural Engine 11 ms, GPU 19 ms`. Also tell me the iPhone model.

## Reading the numbers

Each prediction handles `frames` frames at once and returns one heatmap per frame. So the time that matters is
**milliseconds per frame** = time per prediction divided by frames (the CSV has this, as `*_ms_per_frame`).

| Target | Per-frame time needed |
|---|---|
| Every frame at 60 fps | 16 ms or less, and the Neural Engine must have room left for person detection and recording |
| Every second frame (30 fps analysis) | 33 ms or less |
| After the game, faster than playing it back | under 16 ms per frame of 60 fps video; slower is fine if the user waits |

Things to watch for:
- **Neural Engine versus GPU:** the Neural Engine uses less power and heat. A variant that only runs well on the GPU competes
  with the camera's own drawing.
- **Frames per prediction:** most of the work is in the full-size layers and does not grow with the number of frames. A model
  that takes 8 frames in one go (`*-8f`) therefore costs far less per frame than one that takes 3 (`*-3f`). The price is that
  the answer for a frame arrives up to 8 frames later, which does not matter for scoring after the game.
- **GMACs:** a rough size. Full TrackNetV3 at 8 frames is far beyond a phone in real time; the narrow variants are the candidates.
- **File size** matters for the app download, but only a little.
