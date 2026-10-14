"""Tests one hypothesis: does the cross-severity collapse come from scale-dependent features?

Full-feature accuracy on an unseen defect size was 0.50-0.62, while the most important
features were absolute band energies -- quantities that grow with defect size. If that is the
cause, training on only scale-invariant features should transfer better across severities,
even if it costs accuracy on the easy same-severity task.

A negative result here is still worth having: it would mean the fault types genuinely look
different at different severities, and the fix is more training severities rather than
better features.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from sklearn.metrics import accuracy_score

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from preprocessing import FEATURE_NAMES, SCALE_INVARIANT_FEATURES, subset_indices  # noqa: E402

from dataset import build_dataset  # noqa: E402
from train import fault_metrics, make_model  # noqa: E402


def severity_split(X, y, severity, loads, held_size, columns):
    """Train on the other defect sizes, test on the held-out one.

    Normal windows carry no defect size, so they are split by load instead -- otherwise they
    would appear in both halves and inflate the score.
    """
    is_held = severity == held_size
    is_normal = severity == 0.0
    normal_test_load = 3
    tr = (~is_held | is_normal) & ~(is_normal & (loads == normal_test_load))
    te = (is_held | is_normal) & ~(is_normal & (loads != normal_test_load))
    model = make_model().fit(X[np.ix_(tr, columns)], y[tr])
    pred = model.predict(X[np.ix_(te, columns)])
    missed, _ = fault_metrics(y[te], pred)
    return accuracy_score(y[te], pred), missed


def load_held_out(X, y, loads, columns):
    accs = []
    for held in sorted(np.unique(loads)):
        tr, te = loads != held, loads == held
        model = make_model().fit(X[np.ix_(tr, columns)], y[tr])
        accs.append(accuracy_score(y[te], model.predict(X[np.ix_(te, columns)])))
    return float(np.mean(accs))


def main() -> None:
    X, y, severity, recordings, loads, names = build_dataset(use_cache=False)
    all_cols = list(range(len(FEATURE_NAMES)))
    inv_cols = subset_indices(SCALE_INVARIANT_FEATURES)
    print(f"\nfull feature set   : {len(all_cols)} features")
    print(f"scale-invariant set: {len(inv_cols)} features\n")

    print("Unseen defect size (the hard task):")
    print(f"  {'held out':>10}  {'full':>8}  {'invariant':>10}  {'change':>8}")
    for size in (0.007, 0.014, 0.021):
        full, _ = severity_split(X, y, severity, loads, size, all_cols)
        inv, _ = severity_split(X, y, severity, loads, size, inv_cols)
        print(f"  {size:>9.3f}in  {full:8.4f}  {inv:10.4f}  {inv-full:+8.4f}")

    print("\nUnseen motor load (the easy task), to show what the restriction costs:")
    full = load_held_out(X, y, loads, all_cols)
    inv = load_held_out(X, y, loads, inv_cols)
    print(f"  full={full:.4f}  invariant={inv:.4f}  change={inv-full:+.4f}")


if __name__ == "__main__":
    main()
