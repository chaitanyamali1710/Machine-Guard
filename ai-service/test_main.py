from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def sample():
    return {"machineId":"CMP-012","temperature":82,"vibration":7.2,"pressure":4.1,"power":28,"rpm":1670,"timestamp":"2026-10-01T00:00:00Z"}

def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["documents"] >= 4

def test_high_risk_analysis():
    response = client.post("/analyze", json=sample())
    assert response.status_code == 200
    assert response.json()["riskScore"] >= 70

def test_retrieval_answer_has_sources():
    response = client.post("/ask", json={"question":"Why does a vacuum pump vibrate?", "telemetry":sample()})
    assert response.status_code == 200
    assert len(response.json()["sources"]) > 0
