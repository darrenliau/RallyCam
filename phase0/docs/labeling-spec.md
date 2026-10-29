# Labelling spec

Label a sample, not every frame. Per session: 400 frames from rallies, chosen to include smashes and drops, plus every landing.
Use an open-source labeller such as CVAT or Label Studio, and export to the CSV formats below.

## 1. Shuttle positions: `<session>_shuttle.csv`
`frame,visible,x,y`
- `visible` is 1 if a person can see the shuttle in that frame, otherwise 0. If it is hidden or too blurred, label 0.
- `x,y` are the pixel centre of the shuttle in the original frame. Leave empty when `visible` is 0.

## 2. Points: `<session>_points.csv`
`point,start_frame,end_frame,winner,landing_frame,landing_x_m,landing_y_m,in_out`
- `winner` is `near` or `far` (the side closest to the camera).
- `landing_*` is where the shuttle first touches the floor. Coordinates are in metres on the court (origin: near-left doubles corner, x across 0-6.1, y along 0-13.4). Take them from the court corners in step 3.
- `in_out` is `in` or `out`. Leave the landing blank if the point ended another way (net, hit out of play) and write the reason in `winner`'s neighbouring `note` column if needed.

## 3. Court corners: `<session>_court.json`
Pixel position of the four outer doubles-court corners: `{"near_left":[x,y],"near_right":[x,y],"far_right":[x,y],"far_left":[x,y]}`.
These give the homography used to convert pixels to metres.

## Quality rule
Every labelled session is checked by a second person for 10% of frames. Disagreement above 3 px means the instructions need fixing.
