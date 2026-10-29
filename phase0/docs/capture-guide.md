# Phase 0 capture guide

**Easiest way to film: RallyCam's footage mode.** On the New game screen switch on "Footage capture". RallyCam then records on the ultra-wide camera at 1080p and 120 fps with no overlay on the picture, which is the clean footage the tracker needs. When the game ends, open it in Review and tap **Share video** to send the file to your computer (AirDrop). This needs the iPhone development build, not Expo Go. The sections below still apply: camera position, what to play, venues, labelling. Use the camera app's 1080p 120 fps setting if you film on a phone without the RallyCam build.

Goal: collect footage that looks like what real users will record, so the shuttle-tracking test is honest.

## Target
8 sessions, 10-15 minutes of real play each, in at least 4 different venues and 3 different phones (one mid-range Android, one flagship Android, one iPhone).

## Camera position (record every session from position A; add B in two sessions)
- **A. Behind the baseline:** tripod centred on the court, 1.5-2.5 m behind the back line, lens 1.5-2 m high. Whole court, both baselines and the net post tops visible.
- **B. Side-on from the net post:** tripod beside the net, 1 m outside the sideline, 1.5 m high. Tests the fallback for casual setups.
- Phone in landscape, locked. Do not move it during a session.
- Full-court test: all 4 corners of the doubles court must be inside the frame.

## Phone settings
| Setting | iPhone | Android |
|---|---|---|
| Resolution / fps | 1080p at 120 fps (use 240 fps in one session) | 1080p at 120 fps where offered, otherwise 60 |
| Stabilisation | Off (RallyCam turns it off) | Off |
| Focus / exposure | Lock AE/AF on the court centre (long-press) | Use a pro-video mode to lock them |
| Zoom | 1x (wide). No digital zoom | 1x |
| HDR / night mode | Off | Off |
| Storage | Keep the original file, no compression | Same |

Check each clip once: pause on a smash. The shuttle should be a small sharp shape, not a smear.

## What to play
Per session, in this order:
1. 2 min of **drives and clears** (long flat rallies).
2. 3 min of **singles rallies** with normal play.
3. 3 min with **smashes and drops** (fast and steep shots).
4. 5 min of a **scored game to 11** with the score called out loud, written on a sheet by someone off-camera.
5. 5 intentional **in/out landings** on each side near the lines (see labelling below).

**Doubles:** in at least 2 of the 8 sessions, play 5 extra minutes of doubles (four players) so the player tracker is tested on the same footage. Wear different coloured tops where you can.

Use white or yellow feather shuttles in half the sessions and plastic in the other half.

## Venue variety to cover
Bright hall, dim hall, hall with a window or sun on the floor, patterned floor, outdoor or garage. Note the venue in the metadata file.

## Metadata
Fill `data/sessions.csv` for every clip:
`session_id,date,venue,phone,fps,resolution,camera_position,shuttle_type,lighting,notes`

## Folder layout
```
data/
  sessions.csv
  raw/<session_id>.mp4
  labels/<session_id>_shuttle.csv
  labels/<session_id>_points.csv
  labels/<session_id>_court.json
```
Keep all originals. Do not trim or re-encode.
