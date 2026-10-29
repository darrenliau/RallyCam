# Phase 0 checklist

Goal: find out, with real phone footage, whether shuttle tracking is good enough to score a match automatically. Output: a go / marginal / no-go decision (see go-no-go.md).

## A. Prepare (about 2 days)
- [ ] Buy or borrow a phone tripod with a 2 m reach or a tall clamp
- [ ] Line up 3 phones: one iPhone, one flagship Android, one mid-range Android
- [ ] Find 4 or more venues and 2-4 friends willing to play
- [ ] Read docs/capture-guide.md and print the play script
- [ ] Check the TrackNetV3 LICENSE file on GitHub (code and weights)
- [ ] Install CVAT or Label Studio for labelling
- [ ] Get everyone's OK to film (tell them the footage is for testing)

## B. Pilot (1 evening)
- [ ] Film one 10 minute session at the best settings
- [ ] Pause on a smash: the shuttle should look like a small sharp shape, not a smear
- [ ] Fix settings (shutter, light, position) if it is smeared or missing

## C. Capture (about 2 weekends)
- [ ] 8 sessions, 4+ venues, 3 phones, 10-15 min each
- [ ] Position A (behind the baseline) in every session, position B (side-on) in two
- [ ] 2 sessions include 5 min of doubles
- [ ] Half the sessions with feather shuttles, half plastic
- [ ] Each scored game is written on a sheet by someone off-camera
- [ ] Fill in data/sessions.csv for every clip and keep the original files

## D. Label (about 1 week, part time)
- [ ] Per session: court corners (4 clicks), about 400 shuttle frames, and every point (winner, landing spot, in/out)
- [ ] A second person double-checks 10% of frames
- [ ] Put the files in data/labels/ using the names in docs/labeling-spec.md

## E. Run the model (a few days, I can help)
- [ ] Run TrackNetV3 on each clip and save predictions as frame,x,y
- [ ] Score with tools/evaluate.py (shuttle, landing, points)
- [ ] Repeat on the side-on footage and the doubles footage separately

## F. Decide
- [ ] Compare results with docs/go-no-go.md
- [ ] Note which conditions fail (dim halls, plastic shuttles, a phone model)
- [ ] Decide: go to Phase 1, collect more data and fine-tune, or rethink

Total: about 4-6 weeks part time, mostly filming and labelling.
