"""Turns the raw CWRU .mat recordings into a feature matrix ready for training.

The important part of this module is what it returns alongside X and y: the recording id and
the motor load for every window. Those let the trainer split by recording or by operating
condition. Splitting windows randomly would put overlapping slices of the *same* recording in
both train and test, which inflates accuracy to near 100% and means nothing.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from scipy.io import loadmat

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from preprocessing import FEATURE_NAMES, features_for_signal  # noqa: E402

from download import MANIFEST, RAW_DIR  # noqa: E402

# The 12k drive-end recordings are sampled at 12 kHz.
SAMPLING_RATE = 12_000.0
CACHE = Path(__file__).resolve().parent.parent / "data" / "processed" / "cwru_features.npz"


def load_drive_end(number: int) -> np.ndarray | None:
    """Reads the drive-end accelerometer channel, or None when the file is absent."""
    path = RAW_DIR / f"{number}.mat"
    if not path.exists():
        return None
    mat = loadmat(path)
    # Variable names embed the file number, e.g. X105_DE_time. Match by suffix so a stray
    # zero-padding difference in the name does not break the load.
    keys = [k for k in mat if k.endswith("_DE_time")]
    if not keys:
        return None
    return np.asarray(mat[keys[0]]).ravel()


def build_dataset(window_size: int = 2048, overlap: float = 0.5, use_cache: bool = True):
    """Returns (X, y, severity, recordings, loads, feature_names)."""
    if use_cache and CACHE.exists():
        data = np.load(CACHE, allow_pickle=True)
        print(f"Loaded cached features from {CACHE.name}")
        return (data["X"], data["y"], data["severity"], data["recordings"],
                data["loads"], list(data["feature_names"]))

    X_parts, y, severity, recordings, loads = [], [], [], [], []
    missing = []

    for number, label, size_in, load in MANIFEST:
        signal = load_drive_end(number)
        if signal is None:
            missing.append(number)
            continue
        features = features_for_signal(signal, SAMPLING_RATE, window_size, overlap)
        X_parts.append(features)
        n = features.shape[0]
        y.extend([label] * n)
        severity.extend([size_in] * n)
        recordings.extend([number] * n)       # group key: one recording
        loads.extend([load] * n)              # operating condition
        print(f"  {number:4} {label:11} {size_in:.3f}in {load}hp -> {n:5} windows")

    if not X_parts:
        raise RuntimeError(f"No recordings found in {RAW_DIR}. Run training/download.py first.")
    if missing:
        print(f"  (skipped {len(missing)} missing files: {missing})")

    X = np.vstack(X_parts)
    y = np.array(y)
    severity = np.array(severity)
    recordings = np.array(recordings)
    loads = np.array(loads)

    CACHE.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(CACHE, X=X, y=y, severity=severity, recordings=recordings,
                        loads=loads, feature_names=np.array(FEATURE_NAMES))
    print(f"Cached features to {CACHE}")
    return X, y, severity, recordings, loads, FEATURE_NAMES


if __name__ == "__main__":
    X, y, severity, recordings, loads, names = build_dataset(use_cache=False)
    print(f"\nX={X.shape}  features={len(names)}")
    print(f"recordings={len(np.unique(recordings))}  loads={sorted(np.unique(loads).tolist())}")
    print("\nclass balance:")
    for label in sorted(np.unique(y)):
        count = int((y == label).sum())
        print(f"  {label:11} {count:6} windows  ({count/len(y)*100:5.1f}%)")
