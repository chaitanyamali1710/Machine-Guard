"""Checks the replay endpoints against the committed bundle, in-process via TestClient."""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

pytestmark = pytest.mark.skipif(
    not (Path(__file__).parent / "data" / "replay" / "replay.npz").exists()
    or not (Path(__file__).parent / "models" / "bearing_rf_v1.joblib").exists(),
    reason="Replay bundle or trained model not present",
)


def test_lists_scenarios():
    body = client.get("/replay/scenarios").json()
    assert body["available"] is True
    ids = {s["id"] for s in body["scenarios"]}
    assert {"healthy", "inner_race_fault", "degradation"} <= ids


def test_step_reports_truth_alongside_prediction():
    body = client.post("/replay/step", json={"scenario": "healthy", "index": 0}).json()
    assert body["trueLabel"] == "normal"
    assert body["correct"] == (body["predictedFault"] == body["trueLabel"])
    assert len(body["waveform"]) == 256  # 2048 samples decimated by 8


def test_index_wraps_so_the_dashboard_can_loop():
    total = client.post("/replay/step", json={"scenario": "healthy", "index": 0}).json()["total"]
    wrapped = client.post("/replay/step", json={"scenario": "healthy", "index": total + 2}).json()
    assert wrapped["index"] == 2


def test_degradation_scenario_changes_label_partway():
    labels = [client.post("/replay/step", json={"scenario": "degradation", "index": i}).json()
              for i in range(40)]
    assert labels[0]["trueLabel"] == "normal"
    assert labels[-1]["trueLabel"] == "inner_race"
    # The model is judged on held-out data, so demand a solid majority rather than perfection.
    accuracy = sum(s["correct"] for s in labels) / len(labels)
    assert accuracy > 0.8, f"replay accuracy {accuracy:.2f} is too low to demo"


def test_unknown_scenario_is_404():
    assert client.post("/replay/step", json={"scenario": "nope", "index": 0}).status_code == 404
