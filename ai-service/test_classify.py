"""End-to-end checks for /classify using real CWRU windows.

These run in-process via TestClient, so no server or port is involved. They are skipped when
the dataset or trained model is absent, which is the normal state of a fresh clone.
"""
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy.io import loadmat

from main import app

client = TestClient(app)
RAW = Path(__file__).parent / "data" / "raw" / "cwru"

# One recording per class, all at 3 hp.
CASES = [("100.mat", "normal"), ("108.mat", "inner_race"), ("121.mat", "ball"), ("133.mat", "outer_race")]

pytestmark = pytest.mark.skipif(
    not (Path(__file__).parent / "models" / "bearing_rf_v1.joblib").exists() or not RAW.exists(),
    reason="Trained model or raw dataset not present",
)


def window_from(name: str, start: int = 5000, size: int = 2048) -> list[float]:
    mat = loadmat(RAW / name)
    key = next(k for k in mat if k.endswith("_DE_time"))
    return np.asarray(mat[key]).ravel()[start:start + size].tolist()


def test_model_info_reports_limitations():
    body = client.get("/model").json()
    assert body["available"] is True
    assert body["knownLimitations"], "the artifact must document its weaknesses"
    assert body["evaluation"]["headline_metric"] == "leave_one_load_out"


@pytest.mark.parametrize("filename,expected", CASES)
def test_classifies_real_recordings(filename, expected):
    res = client.post("/classify", json={"machineId": "TEST-1", "samples": window_from(filename)})
    assert res.status_code == 200
    body = res.json()
    assert body["predictedFault"] == expected
    assert 0.0 <= body["confidence"] <= 1.0
    assert body["isFault"] == (expected != "normal")
    assert abs(sum(body["probabilities"].values()) - 1.0) < 1e-6


def test_rejects_too_short_a_window():
    res = client.post("/classify", json={"machineId": "TEST-1", "samples": [0.1, 0.2, 0.3]})
    assert res.status_code == 422
