# Shuttle model

Put the converted TrackNetV3 model here, named exactly `TrackNetV3.mlpackage` (a folder), then run `npx expo prebuild --platform ios`
again and build.

Make it with `phase0/tools/run-coreml-parity.sh clip.mp4` on a Mac (it writes `coreml_parity/tracknet-real.mlpackage`), then:

```bash
cp -R coreml_parity/tracknet-real.mlpackage modules/rallycam-export/ios/Models/TrackNetV3.mlpackage
```

The app finds it at run time (`ShuttleModel.swift`), compiles it on the phone the first time it is switched on and keeps the compiled copy.
Without the file, Settings → "Shuttle model" shows "model file not found" and the older tracker is used.

The model is about 23 MB. TrackNetV3 and its trained weights are MIT licensed (see the TrackNetV3 repository's LICENSE).
