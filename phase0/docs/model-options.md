# Shuttle tracking: model options

What we need: find a shuttle that is a few pixels wide and moving fast, in 1080p 120 fps video from a fixed phone, on the phone itself, while recording. This is a short list of the candidates and what is still unknown. I could not run any of them from the build environment, so nothing here is measured.

## The candidates

| Option | What it is | Why it is on the list | What is unknown |
|---|---|---|---|
| **TrackNetV3** ([code](https://github.com/qaz812345/TrackNetV3), [paper](https://people.cs.nycu.edu.tw/~yushuen/data/TrackNetV3.pdf)) | A network that looks at 3 frames in a row and outputs a heatmap of where the shuttle is, plus a second network that fills gaps. | Best-known for badminton. Its repo reports 98.56% F1 on its own test set (broadcast video) and about 25 fps on a desktop GPU. | Licence (one mirror says MIT, not confirmed against the file; check the weights too). Accuracy on phone footage. Too slow for a phone as it is. |
| **TrackNetV5-Lite** ([paper](https://people.cs.nycu.edu.tw/~yushuen/data/TracknetV5_26.pdf)) | A much smaller TrackNet variant. The paper says 2.58 million parameters and F1 98.06. | Small enough to be a real on-device candidate. | Whether code or weights have been released, and its licence. Reported on a research dataset, not phone footage. |
| **WASB-SBDT** ([code](https://github.com/nttcom/WASB-SBDT), [paper](https://arxiv.org/pdf/2311.05237)) | A strong baseline for detecting and tracking balls across several sports, badminton included. | Strong published results, runs above 30 fps on most of its benchmarks. | The repo shows an MIT badge. Whether downloadable weights exist and which are badminton. Not described as lightweight. |
| **YOLO-style detector plus a Kalman filter** ([phone smash-speed paper](https://arxiv.org/pdf/2509.05334)) | A small object detector trained on shuttle images, with a filter that follows the track. | A published badminton system packaged as a mobile app. Conversion to Core ML is routine for YOLO models. | Their accuracy on a distant shuttle. YOLO licences (some are AGPL) matter for a store app. |

## How I would decide
1. Collect the Phase 0 footage with RallyCam's footage mode, label it, and score TrackNetV3 on it. That is the best-case reference for what a good model can do on our footage.
2. If TrackNetV3 clears the go / no-go bar, the open question becomes speed. Train a smaller network of the same design on our own labelled footage, then convert it to Core ML and measure frames per second on a real iPhone.
3. If TrackNetV3 fails on our footage, more data or a different camera position is likely the fix, before a different model is.

## Getting a model onto the phone
- **iPhone:** Core ML through `coremltools`. The native camera (`modules/rallycam-export/ios/CaptureController.swift`) already sees every frame at 120 fps, so the shuttle model would run there, next to person detection, and report the shuttle position to the tracker.
- **Android:** TFLite through the vision-camera frame path, like the person detector.
- Run the shuttle model on the court area only, as the person detector does, to put more pixels on a small shuttle.

## Licence checklist before relying on any model
The model code, the trained weights, and the training data can each have their own licence. Read all three. Several of these come from research groups whose weights are for research use.
