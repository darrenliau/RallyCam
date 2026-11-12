# Shot types the app names

The app names **eleven families** (plus the serve's variant note). They are the ones one phone camera can tell apart: by where the shot was hit from, how high the racket hand was (body pose: above the head, at the side, low), where the shuttle came down, how long it took to reach the next hit, and how fast it was. Code: `src/analysis/shots.ts` (`classifyShot`). None of the limits has been tuned on real play yet.

| Family | What tells it apart (first guesses) | Variants folded into it |
|---|---|---|
| SERVE | first shot of the rally. Note: *low serve* (came down short), *high serve* (deep, over 0.9 s), *flick serve* (deep, 0.9 s or less), *drive serve* (middle) | forehand/backhand serve |
| CLEAR | hit above the head, from the back court, came down deep | attacking clear, defensive clear, round-the-head clear, backhand clear |
| DROP | hit above the head from the back or mid court, came down in the front court | slice drop, reverse slice drop, round-the-head drop, backhand drop, stick drop |
| SMASH | hit above the head, fast (100 km/h or more from the front half, very fast from the back), not close to the net | jump smash, stick smash, half smash, round-the-head smash, backhand smash |
| KILL | hit from 3 m or less from the net, above the head, fast | net kill, rush finish |
| NET SHOT | hit low (or at the side) close to the net, came down in the front court | tumble/spinning net shot, cross-court net shot, hairpin, brush |
| LIFT | hit low, came down deep, not a quick flat one | lob, defensive lift, backhand lift, lift from the net |
| FLICK | hit low or at the side close to the net, deep, 0.9 s or less and 80 km/h or more | forehand/backhand flick, deceptive flick |
| PUSH | hit low or at the side close to the net, flat, came down in the middle or back | rush, push to the back, cross-court push |
| DRIVE | hit at the side height in the middle of the court, fast and flat | forehand/backhand drive, cross-court drive, drive serve return |
| BLOCK | hit low or at the side, answering a SMASH or KILL, soft or short | block to the net, drive-block, defensive return |

## Cannot be told apart from one camera
Grip and racket-face variants (slice, cut, reverse slice, tumble, brush), spin on net shots, deception (a drop or smash that looks like a clear), and whether a stroke was forehand or backhand **are not named**. Forehand/backhand and straight/cross-court are the next level: they need good body pose on both players and the landing side, which depends on the tracking work.

## About "All 60 shots in badminton" (Badminton Insight)
The video could not be opened from the session, so this table is built from general badminton knowledge, not from the video's list. The right-hand column shows where the usual variants fall. When the video's transcript or chapter list is available, check each of its 60 names against this table and move any that are in the wrong family.
