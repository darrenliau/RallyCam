"""Phase 0 scorecard.

Usage:
  python3 evaluate.py shuttle LABELS.csv PRED.csv [--tol 8]
  python3 evaluate.py landing POINTS_TRUTH.csv POINTS_PRED.csv
  python3 evaluate.py points  POINTS_TRUTH.csv POINTS_PRED.csv

shuttle  PRED.csv: frame,x,y (empty x,y = not found); LABELS.csv: frame,visible,x,y
landing  both: point,landing_x_m,landing_y_m
points   both: point,winner
"""
import argparse, csv, math, statistics


def rows(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def num(v):
    return float(v) if v not in (None, "") else None


def shuttle(labels, preds, tol):
    pred = {int(r["frame"]): (num(r["x"]), num(r["y"])) for r in preds}
    tp = fp = fn = tn = 0
    errs = []
    for r in labels:
        f, vis = int(r["frame"]), int(r["visible"])
        px, py = pred.get(f, (None, None))
        found = px is not None
        if vis:
            e = math.hypot(px - float(r["x"]), py - float(r["y"])) if found else None
            if found and e <= tol:
                tp += 1
                errs.append(e)
            else:
                fn += 1
                if found:
                    fp += 1
        elif found:
            fp += 1
        else:
            tn += 1
    recall = tp / (tp + fn) if tp + fn else float("nan")
    precision = tp / (tp + fp) if tp + fp else float("nan")
    print(f"frames labelled visible : {tp + fn}")
    print(f"recall (within {tol}px)  : {recall:.1%}")
    print(f"precision               : {precision:.1%}")
    if errs:
        print(f"median pixel error      : {statistics.median(errs):.1f}px")


def landing(truth, preds):
    pred = {r["point"]: r for r in preds}
    errs, missing = [], 0
    for r in truth:
        if not r.get("landing_x_m"):
            continue
        p = pred.get(r["point"])
        if not p or not p.get("landing_x_m"):
            missing += 1
            continue
        errs.append(100 * math.hypot(float(p["landing_x_m"]) - float(r["landing_x_m"]),
                                     float(p["landing_y_m"]) - float(r["landing_y_m"])))
    print(f"landings scored         : {len(errs)}   missing: {missing}")
    if errs:
        errs.sort()
        print(f"median landing error    : {statistics.median(errs):.0f} cm")
        print(f"90th percentile error   : {errs[int(0.9 * (len(errs) - 1))]:.0f} cm")
        print(f"within 20 cm            : {sum(e <= 20 for e in errs) / len(errs):.1%}")


def points(truth, preds):
    pred = {r["point"]: r["winner"] for r in preds}
    ok = sum(pred.get(r["point"]) == r["winner"] for r in truth)
    print(f"points correct          : {ok}/{len(truth)} = {ok / len(truth):.1%}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["shuttle", "landing", "points"])
    ap.add_argument("truth")
    ap.add_argument("pred")
    ap.add_argument("--tol", type=float, default=8)
    a = ap.parse_args()
    t, p = rows(a.truth), rows(a.pred)
    {"shuttle": lambda: shuttle(t, p, a.tol), "landing": lambda: landing(t, p), "points": lambda: points(t, p)}[a.mode]()
