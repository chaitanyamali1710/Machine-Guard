"""Exports a small, committable bundle of vibration windows for the dashboard replay.

The raw CWRU archive is ~134 MB and gitignored, so a deployed instance has no access to it.
This writes a compact float32 .npz holding a handful of windows per scenario, small enough to
commit and ship to Render.

Every window comes from the motor load withheld from the served model (see
REPLAY_HOLDOUT_LOAD), so the replay shows the model predicting on data it has never seen.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dataset import SAMPLING_RATE, load_drive_end  # noqa: E402
from download import MANIFEST  # noqa: E402
from train import REPLAY_HOLDOUT_LOAD  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent.parent / "data" / "replay"
WINDOW = 2048
PER_SCENARIO = 40

# Scenario -> the fault label and defect size to draw windows from.
SIMPLE_SCENARIOS = {
    "healthy": ("normal", 0.0),
    "inner_race_fault": ("inner_race", 0.021),
    "ball_fault": ("ball", 0.021),
    "outer_race_fault": ("outer_race", 0.021),
}


def pick_recording(label: str, size_in: float) -> int | None:
    for number, lbl, size, load in MANIFEST:
        if lbl == label and size == size_in and load == REPLAY_HOLDOUT_LOAD:
            return number
    return None


def windows_from(number: int, count: int, offset: int = 2000) -> np.ndarray:
    """Takes non-overlapping consecutive windows so the replay reads as continuous time."""
    signal = load_drive_end(number)
    if signal is None:
        raise FileNotFoundError(f"{number}.mat is missing; run training/download.py")
    needed = offset + count * WINDOW
    if len(signal) < needed:
        count = (len(signal) - offset) // WINDOW
    return np.stack([signal[offset + i * WINDOW: offset + (i + 1) * WINDOW] for i in range(count)])


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    bundle: dict[str, np.ndarray] = {}
    catalogue = []

    for name, (label, size_in) in SIMPLE_SCENARIOS.items():
        number = pick_recording(label, size_in)
        if number is None:
            print(f"  skip {name}: no {REPLAY_HOLDOUT_LOAD}hp recording for {label} {size_in}in")
            continue
        data = windows_from(number, PER_SCENARIO).astype(np.float32)
        bundle[name] = data
        bundle[f"{name}__labels"] = np.array([label] * len(data))
        catalogue.append({"id": name, "windows": int(len(data)), "trueLabel": label,
                          "recording": f"{number}.mat", "defectSizeIn": size_in})
        print(f"  {name:18} {len(data):3} windows from {number}.mat ({label})")

    # A run that starts healthy and degrades partway through. This is the scenario worth
    # watching: the model has no notion of time, so the transition must be detected purely
    # from each window, which is exactly how it would behave on a real machine.
    healthy_n = pick_recording("normal", 0.0)
    fault_n = pick_recording("inner_race", 0.021)
    if healthy_n and fault_n:
        half = PER_SCENARIO // 2
        healthy = windows_from(healthy_n, half).astype(np.float32)
        faulty = windows_from(fault_n, PER_SCENARIO - half).astype(np.float32)
        bundle["degradation"] = np.concatenate([healthy, faulty])
        bundle["degradation__labels"] = np.array(["normal"] * len(healthy) + ["inner_race"] * len(faulty))
        catalogue.append({"id": "degradation", "windows": int(PER_SCENARIO),
                          "trueLabel": "mixed", "faultStartsAt": int(half),
                          "recording": f"{healthy_n}.mat -> {fault_n}.mat", "defectSizeIn": 0.021})
        print(f"  {'degradation':18} {PER_SCENARIO:3} windows, fault begins at index {half}")

    np.savez_compressed(OUT_DIR / "replay.npz", **bundle)
    (OUT_DIR / "catalogue.json").write_text(json.dumps({
        "samplingRate": SAMPLING_RATE, "windowSize": WINDOW,
        "heldOutLoadHp": REPLAY_HOLDOUT_LOAD,
        "note": "All windows come from a motor load excluded from the served model's training set.",
        "scenarios": catalogue,
    }, indent=2), encoding="utf-8")

    size_kb = (OUT_DIR / "replay.npz").stat().st_size / 1024
    print(f"\nWrote replay.npz ({size_kb:.0f} KB) and catalogue.json to {OUT_DIR}")


if __name__ == "__main__":
    main()
