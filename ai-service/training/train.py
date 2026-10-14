"""Trains and honestly evaluates the bearing fault classifier.

Three evaluation protocols are reported deliberately, because the gap between them is the
whole point:

  1. Random window split   - the WRONG way. Overlapping windows from one recording land in
                             both train and test, so the model is tested on data it has
                             effectively memorised. Reported only to show the inflation.
  2. Leave-one-recording   - honest within known operating conditions.
  3. Leave-one-load-out    - hardest and most realistic: train on some motor loads, test on a
                             load never seen. This is the number worth quoting.

Only protocol 3 says anything about a machine running at a condition you did not train on.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.model_selection import GroupKFold, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
import joblib

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from preprocessing import FEATURE_NAMES, MODEL_INPUT_VERSION  # noqa: E402

from dataset import build_dataset  # noqa: E402

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
RANDOM_STATE = 42

# Recordings at this motor load are withheld from the served model and reserved for the
# dashboard replay. Replaying windows the model trained on would make the demo meaningless --
# it would be recalling, not predicting. Costs ~25% of training data; leave-one-load-out
# already shows the model holds up on an unseen load.
REPLAY_HOLDOUT_LOAD = 3


def make_model() -> Pipeline:
    """Scaling is pointless for a forest, but keeps the artifact swappable for linear models.

    Wrapping it in a Pipeline also means the scaler is fitted inside each CV fold, on training
    data only, instead of leaking test statistics into preprocessing.
    """
    return Pipeline([
        ("scaler", StandardScaler()),
        ("clf", RandomForestClassifier(
            n_estimators=300, max_depth=None, min_samples_leaf=1,
            class_weight="balanced", n_jobs=-1, random_state=RANDOM_STATE)),
    ])


def fault_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> tuple[float, float]:
    """Returns (missed fault rate, false alarm rate).

    For maintenance these matter more than accuracy: a missed fault means an unplanned
    breakdown, a false alarm means a technician sent out for nothing.
    """
    true_fault = y_true != "normal"
    pred_normal = y_pred == "normal"
    missed = float((true_fault & pred_normal).sum() / max(1, true_fault.sum()))
    true_normal = ~true_fault
    pred_fault = ~pred_normal
    false_alarm = float((true_normal & pred_fault).sum() / max(1, true_normal.sum()))
    return missed, false_alarm


def threshold_baseline(X_tr, y_tr, X_te, y_te, names) -> float:
    """Best single-feature threshold for fault-vs-normal, chosen on training data only.

    If a forest on 21 features cannot beat one threshold, the extra complexity is not earning
    its place -- so this is the number the model has to justify itself against.
    """
    best_acc, best = 0.0, None
    bin_tr = (y_tr != "normal").astype(int)
    bin_te = (y_te != "normal").astype(int)
    for i in range(X_tr.shape[1]):
        col = X_tr[:, i]
        for q in np.linspace(5, 95, 19):
            thr = np.percentile(col, q)
            for direction in (1, -1):
                pred = ((col * direction) > (thr * direction)).astype(int)
                acc = accuracy_score(bin_tr, pred)
                if acc > best_acc:
                    best_acc, best = acc, (i, thr, direction)
    i, thr, direction = best
    pred_te = ((X_te[:, i] * direction) > (thr * direction)).astype(int)
    acc = accuracy_score(bin_te, pred_te)
    print(f"  baseline feature: {names[i]} ({'>' if direction > 0 else '<'} {thr:.4g})")
    return acc


def cross_severity(X, y, severity, loads) -> dict[str, float]:
    """Accuracy on a defect size never seen in training.

    This is the model's known weak point and belongs in the artifact, so nobody reads the
    99% headline and assumes it holds for a severity outside the training range.
    """
    scores = {}
    for held in (0.007, 0.014, 0.021):
        is_held, is_normal = severity == held, severity == 0.0
        tr = (~is_held | is_normal) & ~(is_normal & (loads == 3))
        te = (is_held | is_normal) & ~(is_normal & (loads != 3))
        pred = make_model().fit(X[tr], y[tr]).predict(X[te])
        scores[f"held_out_{held}in"] = round(float(accuracy_score(y[te], pred)), 4)
    return scores


def main() -> None:
    X, y, severity, recordings, loads, names = build_dataset()
    names = list(names)
    print(f"\nDataset: X={X.shape}, {len(np.unique(recordings))} recordings, "
          f"loads {sorted(np.unique(loads).tolist())}")

    # ---- 1. Random window split: deliberately leaky, shown for contrast ----
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=RANDOM_STATE, stratify=y)
    leaky = make_model().fit(Xtr, ytr)
    leaky_acc = accuracy_score(yte, leaky.predict(Xte))
    print(f"\n1. Random window split (LEAKY, do not quote): {leaky_acc:.4f}")

    # ---- 2. Leave-one-recording-out ----
    gkf = GroupKFold(n_splits=min(5, len(np.unique(recordings))))
    rec_scores, rec_missed, rec_fa = [], [], []
    for tr, te in gkf.split(X, y, groups=recordings):
        model = make_model().fit(X[tr], y[tr])
        pred = model.predict(X[te])
        rec_scores.append(accuracy_score(y[te], pred))
        m, f = fault_metrics(y[te], pred)
        rec_missed.append(m); rec_fa.append(f)
    print(f"2. Grouped by recording ({gkf.n_splits}-fold): "
          f"{np.mean(rec_scores):.4f} +/- {np.std(rec_scores):.4f}")

    # ---- 3. Leave-one-load-out: the honest headline number ----
    load_scores, load_missed, load_fa = [], [], []
    print("\n3. Leave-one-load-out (train on 3 loads, test on the unseen one):")
    for held in sorted(np.unique(loads)):
        tr, te = loads != held, loads == held
        model = make_model().fit(X[tr], y[tr])
        pred = model.predict(X[te])
        acc = accuracy_score(y[te], pred)
        m, f = fault_metrics(y[te], pred)
        load_scores.append(acc); load_missed.append(m); load_fa.append(f)
        print(f"   held-out {held}hp: accuracy={acc:.4f}  missed_faults={m:.4f}  false_alarms={f:.4f}")
    headline = float(np.mean(load_scores))
    print(f"   mean: {headline:.4f} +/- {np.std(load_scores):.4f}")

    # ---- Baseline comparison on the hardest split ----
    held = sorted(np.unique(loads))[-1]
    tr, te = loads != held, loads == held
    print(f"\n4. Threshold baseline vs model (held-out {held}hp, fault-vs-normal):")
    base_acc = threshold_baseline(X[tr], y[tr], X[te], y[te], names)
    model = make_model().fit(X[tr], y[tr])
    pred = model.predict(X[te])
    model_bin = accuracy_score((y[te] != "normal").astype(int), (pred != "normal").astype(int))
    print(f"  threshold baseline: {base_acc:.4f}")
    print(f"  random forest:      {model_bin:.4f}")
    print(f"  improvement:        {model_bin - base_acc:+.4f}")

    print(f"\nPer-class report (held-out {held}hp):")
    print(classification_report(y[te], pred, digits=3))
    labels = sorted(np.unique(y).tolist())
    print(f"Confusion matrix (rows=true, cols=pred) {labels}:")
    print(confusion_matrix(y[te], pred, labels=labels))

    # ---- Final served model: everything except the replay hold-out ----
    serve = loads != REPLAY_HOLDOUT_LOAD
    final = make_model().fit(X[serve], y[serve])
    print(f"\nFinal model trained on {int(serve.sum())} windows "
          f"({int((~serve).sum())} held out at {REPLAY_HOLDOUT_LOAD}hp for replay).")
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    model_path = MODELS_DIR / "bearing_rf_v1.joblib"
    joblib.dump(final, model_path)

    importances = sorted(zip(names, final.named_steps["clf"].feature_importances_),
                         key=lambda kv: kv[1], reverse=True)
    metadata = {
        "model": "bearing_rf_v1",
        "created": datetime.now(timezone.utc).isoformat(),
        "input_version": MODEL_INPUT_VERSION,
        "feature_names": FEATURE_NAMES,
        "classes": final.named_steps["clf"].classes_.tolist(),
        "dataset": {
            "source": "CWRU Bearing Data Center, 12k drive-end",
            "windows": int(X.shape[0]),
            "recordings": int(len(np.unique(recordings))),
            "sampling_rate_hz": 12000,
            "window_size": 2048,
            "overlap": 0.5,
            "training_windows": int(serve.sum()),
            "replay_holdout_load_hp": REPLAY_HOLDOUT_LOAD,
        },
        "evaluation": {
            "random_split_leaky": round(leaky_acc, 4),
            "grouped_by_recording": round(float(np.mean(rec_scores)), 4),
            "leave_one_load_out": round(headline, 4),
            "leave_one_load_out_std": round(float(np.std(load_scores)), 4),
            "missed_fault_rate": round(float(np.mean(load_missed)), 4),
            "false_alarm_rate": round(float(np.mean(load_fa)), 4),
            "threshold_baseline": round(base_acc, 4),
            "headline_metric": "leave_one_load_out",
            "cross_severity": cross_severity(X, y, severity, loads),
        },
        "known_limitations": [
            "Fault detection (fault vs normal) is near-trivial on CWRU: a single amplitude "
            "threshold matches the model, so the value is in classification, not detection.",
            "Classification degrades to roughly 0.50-0.75 on a defect size absent from "
            "training. Training data must span the severity range you expect to see.",
            "CWRU faults are machined by EDM and are cleaner than natural spalling, so these "
            "figures are an optimistic estimate of real-world performance.",
        ],
        "top_features": [{"name": n, "importance": round(float(v), 4)} for n, v in importances[:8]],
    }
    (MODELS_DIR / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print(f"\nSaved {model_path.name} and metadata.json to {MODELS_DIR}")
    print("Top features: " + ", ".join(f"{n}={v:.3f}" for n, v in importances[:5]))


if __name__ == "__main__":
    main()
