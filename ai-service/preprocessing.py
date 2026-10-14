"""Vibration feature extraction shared by training and inference.

This module is imported by both `training/train.py` and `main.py` on purpose. If training and
serving ever compute features differently the model degrades silently in production -- the
predictions stay plausible, so nothing alerts you. Keeping one implementation makes that
class of bug impossible rather than merely unlikely.

Any change here invalidates previously trained models. Bump MODEL_INPUT_VERSION when the
feature set changes, and retrain; `main.py` refuses to serve a model whose version differs.
"""
from __future__ import annotations

import numpy as np

MODEL_INPUT_VERSION = 2

# Number of equal-width spectral bands between 0 Hz and Nyquist.
N_BANDS = 8

# Fixed ordering. scikit-learn consumes positional arrays, so a reordering here silently
# feeds every value into the wrong feature. Never reorder without retraining.
FEATURE_NAMES: list[str] = [
    "rms", "peak", "peak_to_peak", "mean_abs", "std",
    "skewness", "kurtosis",
    "crest_factor", "shape_factor", "impulse_factor", "clearance_factor",
    "spectral_centroid", "spectral_spread",
] + [f"band_{i}_energy" for i in range(N_BANDS)] \
  + [f"band_{i}_ratio" for i in range(N_BANDS)]

# Features whose value does not change when the whole signal is scaled up or down.
# A larger bearing defect mostly raises amplitude, so a model leaning on absolute magnitudes
# learns the severities it was trained on rather than the fault type. Restricting to these
# tests whether a scale-free signature exists.
SCALE_INVARIANT_FEATURES: list[str] = [
    "skewness", "kurtosis",
    "crest_factor", "shape_factor", "impulse_factor", "clearance_factor",
    "spectral_centroid", "spectral_spread",
] + [f"band_{i}_ratio" for i in range(N_BANDS)]


def _safe_div(a: float, b: float) -> float:
    """Guards the ratio features: a flat-zero window would otherwise produce inf/NaN."""
    return float(a / b) if b > 1e-12 else 0.0


def extract_features(signal: np.ndarray, fs: float) -> dict[str, float]:
    """Computes one feature dictionary for a single window of raw vibration samples.

    Args:
        signal: 1-D array of acceleration samples.
        fs: Sampling rate in Hz, used to locate the spectral bands.
    """
    x = np.asarray(signal, dtype=np.float64).ravel()
    if x.size == 0:
        raise ValueError("Cannot extract features from an empty window")

    x = x - x.mean()  # Remove DC offset so sensor bias does not leak into the amplitude terms.

    rms = float(np.sqrt(np.mean(x**2)))
    peak = float(np.max(np.abs(x)))
    mean_abs = float(np.mean(np.abs(x)))
    std = float(np.std(x))

    # Third and fourth standardised moments. Kurtosis is the classic bearing-fault indicator:
    # spalling produces periodic impacts, which are impulsive rather than Gaussian.
    if std > 1e-12:
        skewness = float(np.mean(((x - x.mean()) / std) ** 3))
        kurtosis = float(np.mean(((x - x.mean()) / std) ** 4))
    else:
        skewness = kurtosis = 0.0

    feats: dict[str, float] = {
        "rms": rms,
        "peak": peak,
        "peak_to_peak": float(np.max(x) - np.min(x)),
        "mean_abs": mean_abs,
        "std": std,
        "skewness": skewness,
        "kurtosis": kurtosis,
        "crest_factor": _safe_div(peak, rms),
        "shape_factor": _safe_div(rms, mean_abs),
        "impulse_factor": _safe_div(peak, mean_abs),
        "clearance_factor": _safe_div(peak, float(np.mean(np.sqrt(np.abs(x))) ** 2)),
    }

    # Single-sided magnitude spectrum.
    spectrum = np.abs(np.fft.rfft(x))
    freqs = np.fft.rfftfreq(x.size, d=1.0 / fs)
    total = float(spectrum.sum())

    if total > 1e-12:
        centroid = float((freqs * spectrum).sum() / total)
        spread = float(np.sqrt((((freqs - centroid) ** 2) * spectrum).sum() / total))
    else:
        centroid = spread = 0.0
    feats["spectral_centroid"] = centroid
    feats["spectral_spread"] = spread

    # Band energies. Different bearing defects excite different resonance regions, so coarse
    # bands capture most of that without hard-coding defect frequencies for one specific bearing.
    edges = np.linspace(0.0, fs / 2.0, N_BANDS + 1)
    power = spectrum**2
    total_power = float(power.sum())
    for i in range(N_BANDS):
        mask = (freqs >= edges[i]) & (freqs < edges[i + 1])
        energy = float(power[mask].sum())
        feats[f"band_{i}_energy"] = energy
        # Same band as a share of total power: describes spectral shape independently of how
        # hard the machine happens to be vibrating.
        feats[f"band_{i}_ratio"] = _safe_div(energy, total_power)

    return feats


def subset_indices(selected: list[str]) -> list[int]:
    """Column indices for a subset of FEATURE_NAMES, for slicing a full feature matrix."""
    lookup = {name: i for i, name in enumerate(FEATURE_NAMES)}
    return [lookup[name] for name in selected]


def to_vector(feats: dict[str, float]) -> np.ndarray:
    """Flattens a feature dict into FEATURE_NAMES order for scikit-learn."""
    return np.array([feats[name] for name in FEATURE_NAMES], dtype=np.float64)


def window_signal(signal: np.ndarray, window_size: int = 2048, overlap: float = 0.5):
    """Yields fixed-length windows.

    Windows overlap to increase sample count, which means neighbouring windows share samples
    and are *not* statistically independent. Splitting them randomly across train/test leaks
    information and inflates accuracy, so callers must split by recording before windowing.
    """
    x = np.asarray(signal).ravel()
    if not 0.0 <= overlap < 1.0:
        raise ValueError("overlap must be in [0, 1)")
    step = max(1, int(window_size * (1.0 - overlap)))
    for start in range(0, len(x) - window_size + 1, step):
        yield x[start:start + window_size]


def features_for_signal(signal: np.ndarray, fs: float, window_size: int = 2048,
                        overlap: float = 0.5) -> np.ndarray:
    """Returns an (n_windows, n_features) matrix for a whole recording."""
    rows = [to_vector(extract_features(w, fs)) for w in window_signal(signal, window_size, overlap)]
    if not rows:
        raise ValueError(f"Signal of length {len(signal)} is shorter than one {window_size}-sample window")
    return np.vstack(rows)
