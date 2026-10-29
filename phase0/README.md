# Phase 0: can we track the shuttle well enough?

Everything automatic in RallyCam (scoring, shot types, speed) depends on finding the shuttle in phone video. This folder is the plan and the tools for measuring that on real footage, before building anything on top of it.

1. `docs/phase0-checklist.md` is the to-do list, start to finish.
2. `docs/capture-guide.md` says what to film (RallyCam's Footage capture mode makes the clips).
3. `docs/labeling-spec.md` says how to label them.
4. `tools/run_tracknet.py` runs TrackNetV3 on each clip and scores it with `tools/evaluate.py`.
5. `docs/go-no-go.md` turns the scores into a decision.
6. `docs/model-options.md` compares the models we could use, and how a winner gets onto the phone.

`data/` holds `sessions.csv` and the labels. Videos and model output are git-ignored.
