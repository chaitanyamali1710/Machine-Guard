"""Stress tests the classifier under conditions the raw CWRU benchmark does not cover.

Plain CWRU accuracy is ~99.8%, and a single-feature threshold reaches ~98%, so the headline
number says almost nothing about whether the model is good. Two harder questions:

  A. Noise robustness   - CWRU was recorded in a lab. Real plant sensors are noisy. Accuracy
                          is re-measured with white noise added to the raw signal across a
                          range of SNRs, before feature extraction.
  B. Cross-severity     - train on 0.007in and 0.021in defects, test on the unseen 0.014in.
                          This asks whether the model learned "inner race fault" or merely
                          "this specific defect size".

The model has to stay ahead of the threshold baseline here to justify its complexity.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from sklearn.metrics import accuracy_score

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from preprocessing import features_for_signal  # noqa: E402

from dataset import SAMPLING_RATE, load_drive_end  # noqa: E402
from download import MANIFEST  # noqa: E402
from train import RANDOM_STATE, fault_metrics, make_model, threshold_baseline  # noqa: E402

SNR_LEVELS = [None, 20, 10, 5, 0]  # None = clean


def add_noise(signal: np.ndarray, snr_db: float, rng: np.random.Generator) -> np.ndarray:
    """Adds white Gaussian noise at a target signal-to-noise ratio."""
    power = float(np.mean(signal**2))
    noise_power = power / (10 ** (snr_db / 10))
    return signal + rng.normal(0.0, np.sqrt(noise_power), size=signal.shape)


def build_at_snr(raw: dict[int, np.ndarray], snr_db: float | None):
    """Re-extracts features with noise applied to the raw signal, not to the features."""
    rng = np.random.default_rng(RANDOM_STATE)
    X_parts, y, severity, loads = [], [], [], []
    for number, label, size_in, load in MANIFEST:
        signal = raw.get(number)
        if signal is None:
            continue
        work = signal if snr_db is None else add_noise(signal, snr_db, rng)
        feats = features_for_signal(work, SAMPLING_RATE)
        X_parts.append(feats)
        n = feats.shape[0]
        y.extend([label] * n); severity.extend([size_in] * n); loads.extend([load] * n)
    return np.vstack(X_parts), np.array(y), np.array(severity), np.array(loads)


def leave_one_load_out(X, y, loads):
    """Returns (4-class accuracy, binary fault-vs-normal accuracy, missed rate, alarm rate).

    The binary figure is reported separately so it can be compared against the threshold
    baseline, which is itself binary. Comparing a 4-class score to a 2-class score would
    flatter whichever happens to be easier, not measure anything.
    """
    accs, bin_accs, missed, alarms = [], [], [], []
    for held in sorted(np.unique(loads)):
        tr, te = loads != held, loads == held
        pred = make_model().fit(X[tr], y[tr]).predict(X[te])
        accs.append(accuracy_score(y[te], pred))
        bin_accs.append(accuracy_score((y[te] != "normal").astype(int),
                                       (pred != "normal").astype(int)))
        m, f = fault_metrics(y[te], pred)
        missed.append(m); alarms.append(f)
    return (float(np.mean(accs)), float(np.mean(bin_accs)),
            float(np.mean(missed)), float(np.mean(alarms)))


def main() -> None:
    print("Loading raw recordings...")
    raw = {n: s for n, _, _, _ in MANIFEST if (s := load_drive_end(n)) is not None}
    print(f"  {len(raw)} recordings in memory\n")

    print("A. Noise robustness (leave-one-load-out at each SNR)")
    print("   'detect' and 'baseline' are both fault-vs-normal; 'classify' is the 4-class task.")
    print(f"  {'SNR':>8}  {'classify':>9}  {'detect':>8}  {'baseline':>9}  {'gain':>7}  {'missed':>7}")
    for snr in SNR_LEVELS:
        X, y, severity, loads = build_at_snr(raw, snr)
        acc, bin_acc, missed, alarms = leave_one_load_out(X, y, loads)
        held = sorted(np.unique(loads))[-1]
        tr, te = loads != held, loads == held
        import contextlib, io
        with contextlib.redirect_stdout(io.StringIO()):  # baseline prints its chosen feature
            base = threshold_baseline(X[tr], y[tr], X[te], y[te], [f"f{i}" for i in range(X.shape[1])])
        tag = "clean" if snr is None else f"{snr} dB"
        print(f"  {tag:>8}  {acc:9.4f}  {bin_acc:8.4f}  {base:9.4f}  {bin_acc-base:+7.4f}  {missed:7.4f}")

    print("\nB. Cross-severity generalisation (unseen defect size)")
    X, y, severity, loads = build_at_snr(raw, None)
    # Normal windows carry severity 0.0 and belong in both sides, since "no fault" is not a size.
    for held_size in (0.007, 0.014, 0.021):
        is_held = severity == held_size
        is_normal = severity == 0.0
        tr = (~is_held & ~is_normal) | is_normal
        te = is_held | is_normal
        # Keep normal windows out of both at once: split them by load instead.
        normal_test_load = 3
        tr = tr & ~(is_normal & (loads == normal_test_load))
        te = te & ~(is_normal & (loads != normal_test_load))
        pred = make_model().fit(X[tr], y[tr]).predict(X[te])
        acc = accuracy_score(y[te], pred)
        m, f = fault_metrics(y[te], pred)
        print(f"  held-out {held_size:.3f}in: accuracy={acc:.4f}  missed_faults={m:.4f}  false_alarms={f:.4f}")


if __name__ == "__main__":
    main()
