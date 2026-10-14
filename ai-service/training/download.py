"""Downloads the CWRU Bearing Data Center recordings used for training.

Source: Case Western Reserve University Bearing Data Center, 12k drive-end accelerometer data.
Files are cached on disk, so re-running is cheap and skips what is already present.

Each recording is one bearing condition at one motor load. The load matters: it is what lets
training hold out whole operating conditions and test whether the model generalises, rather
than only memorising the conditions it saw.
"""
from __future__ import annotations

import sys
from pathlib import Path

import httpx

BASE_URL = "https://engineering.case.edu/sites/default/files/"
RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw" / "cwru"

# (file number, fault label, defect size in inches, motor load in hp)
# Normal baseline carries defect size 0.0.
MANIFEST: list[tuple[int, str, float, int]] = [
    # Normal baseline
    (97, "normal", 0.0, 0), (98, "normal", 0.0, 1), (99, "normal", 0.0, 2), (100, "normal", 0.0, 3),
    # Inner race
    (105, "inner_race", 0.007, 0), (106, "inner_race", 0.007, 1), (107, "inner_race", 0.007, 2), (108, "inner_race", 0.007, 3),
    (169, "inner_race", 0.014, 0), (170, "inner_race", 0.014, 1), (171, "inner_race", 0.014, 2), (172, "inner_race", 0.014, 3),
    (209, "inner_race", 0.021, 0), (210, "inner_race", 0.021, 1), (211, "inner_race", 0.021, 2), (212, "inner_race", 0.021, 3),
    # Ball
    (118, "ball", 0.007, 0), (119, "ball", 0.007, 1), (120, "ball", 0.007, 2), (121, "ball", 0.007, 3),
    (185, "ball", 0.014, 0), (186, "ball", 0.014, 1), (187, "ball", 0.014, 2), (188, "ball", 0.014, 3),
    (222, "ball", 0.021, 0), (223, "ball", 0.021, 1), (224, "ball", 0.021, 2), (225, "ball", 0.021, 3),
    # Outer race, fault centred at 6 o'clock
    (130, "outer_race", 0.007, 0), (131, "outer_race", 0.007, 1), (132, "outer_race", 0.007, 2), (133, "outer_race", 0.007, 3),
    (197, "outer_race", 0.014, 0), (198, "outer_race", 0.014, 1), (199, "outer_race", 0.014, 2), (200, "outer_race", 0.014, 3),
    (234, "outer_race", 0.021, 0), (235, "outer_race", 0.021, 1), (236, "outer_race", 0.021, 2), (237, "outer_race", 0.021, 3),
]


def download_all(force: bool = False) -> tuple[int, int, list[str]]:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    ok = skipped = 0
    failed: list[str] = []

    with httpx.Client(timeout=120, follow_redirects=True) as client:
        for number, label, size_in, load in MANIFEST:
            name = f"{number}.mat"
            dest = RAW_DIR / name
            if dest.exists() and dest.stat().st_size > 0 and not force:
                skipped += 1
                continue
            try:
                response = client.get(BASE_URL + name)
                response.raise_for_status()
                dest.write_bytes(response.content)
                kb = len(response.content) / 1024
                print(f"  {name:9} {label:12} {size_in:.3f}in {load}hp  {kb:8.1f} KB")
                ok += 1
            except Exception as exc:
                failed.append(f"{name} ({label} {size_in}in {load}hp): {type(exc).__name__}")
                print(f"  {name:9} FAILED  {type(exc).__name__}", file=sys.stderr)

    return ok, skipped, failed


if __name__ == "__main__":
    print(f"Downloading CWRU recordings into {RAW_DIR}")
    ok, skipped, failed = download_all(force="--force" in sys.argv)
    total_mb = sum(f.stat().st_size for f in RAW_DIR.glob("*.mat")) / 1024 / 1024
    print(f"\ndownloaded={ok} cached={skipped} failed={len(failed)}  on disk={total_mb:.1f} MB")
    for item in failed:
        print(f"  missing: {item}")
    if failed:
        print("\nMissing files are skipped during training; the remaining recordings still train a model.")
