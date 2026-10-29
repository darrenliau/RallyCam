# Models

`ssd_mobilenet_v2_coco_quant_postprocess.tflite` is a COCO-trained SSD MobileNet v2, 8-bit quantised, from
https://github.com/google-coral/test_data (Apache 2.0, originally from the TensorFlow Object Detection API).

- Input: 1 x 300 x 300 x 3, `uint8` RGB.
- Outputs (in this order): boxes `[1, 20, 4]` as `ymin, xmin, ymax, xmax` fractions; classes `[1, 20]`; scores `[1, 20]`; count `[1]`. All `float32`.
- Class `0` is "person". The built-in `TFLite_Detection_PostProcess` step already applied non-maximum suppression and sorted by score.

It is a stand-in. Compare it with other detectors on Phase 0 footage before shipping. Keep the input/output contract above, or update `src/analysis/preprocess.ts`.
