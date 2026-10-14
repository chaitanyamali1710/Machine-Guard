import json
import os
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from dotenv import load_dotenv

from preprocessing import FEATURE_NAMES, MODEL_INPUT_VERSION, extract_features, to_vector

load_dotenv(Path(__file__).parent / ".env")

app = FastAPI(title="MachineGuard Intelligence Service", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"] , allow_headers=["*"])

knowledge = json.loads((Path(__file__).parent / "knowledge.json").read_text(encoding="utf-8"))

MODELS_DIR = Path(__file__).parent / "models"

def load_bearing_model():
    """Loads the trained classifier if one has been built, otherwise runs without it.

    A missing model is normal on a fresh clone (training/download.py and train.py have not run
    yet), so the rest of the service must still start. A model built against a different
    feature set is NOT normal and is refused: silently serving a stale model would produce
    confident, wrong predictions.
    """
    path, meta_path = MODELS_DIR / "bearing_rf_v1.joblib", MODELS_DIR / "metadata.json"
    if not path.exists() or not meta_path.exists():
        print("[model] No trained bearing model found; /classify will report unavailable.")
        return None, None
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if meta.get("input_version") != MODEL_INPUT_VERSION:
        print(f"[model] REFUSING to load: model expects input_version "
              f"{meta.get('input_version')}, preprocessing is at {MODEL_INPUT_VERSION}. "
              f"Retrain with training/train.py.")
        return None, meta
    import joblib
    print(f"[model] Loaded {meta['model']} ({len(meta['classes'])} classes)")
    return joblib.load(path), meta

bearing_model, bearing_meta = load_bearing_model()

REPLAY_DIR = Path(__file__).parent / "data" / "replay"

def load_replay():
    """Loads the committed replay bundle, or returns empties when it has not been exported."""
    archive, catalogue = REPLAY_DIR / "replay.npz", REPLAY_DIR / "catalogue.json"
    if not archive.exists() or not catalogue.exists():
        print("[replay] No replay bundle; run training/export_replay.py to enable replay.")
        return None, {}
    meta = json.loads(catalogue.read_text(encoding="utf-8"))
    print(f"[replay] Loaded {len(meta.get('scenarios', []))} scenarios")
    return np.load(archive, allow_pickle=False), meta

replay_data, replay_meta = load_replay()
vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2))
matrix = vectorizer.fit_transform([item["content"] for item in knowledge])

class Telemetry(BaseModel):
    machineId: str
    temperature: float
    vibration: float
    pressure: float
    power: float
    rpm: float
    riskScore: Optional[float] = 0
    timestamp: str

class AskRequest(BaseModel):
    question: str = Field(min_length=4, max_length=1000)
    machineId: Optional[str] = None
    telemetry: Optional[Telemetry] = None

def score_reading(t: Telemetry) -> tuple[int, list[str]]:
    signals = []
    score = 8.0
    if t.temperature > 70:
        score += min(38, (t.temperature - 70) * 2.4)
        signals.append(f"Temperature is elevated at {t.temperature:.1f}°C")
    if t.vibration > 4.5:
        score += min(46, (t.vibration - 4.5) * 13)
        signals.append(f"Vibration exceeds the demo baseline at {t.vibration:.1f} mm/s")
    if not 4.0 <= t.pressure <= 6.5:
        score += 15
        signals.append(f"Pressure is outside the preferred range at {t.pressure:.1f} bar")
    if not signals:
        signals.append("Current values remain within the configured operating envelope")
    return min(98, round(score)), signals

def retrieve(question: str, count: int = 3):
    query = vectorizer.transform([question])
    scores = cosine_similarity(query, matrix)[0]
    indices = scores.argsort()[::-1][:count]
    return [{**knowledge[i], "score": round(float(scores[i]), 3)} for i in indices]

@app.get("/health")
def health():
    return {"status": "ok", "service": "machineguard-ai", "documents": len(knowledge), "llmEnabled": bool(os.getenv("LLM_API_KEY")), "llmModel": os.getenv("LLM_MODEL", "gemini-3.8-flash") if os.getenv("LLM_API_KEY") else None}

@app.post("/analyze")
def analyze(telemetry: Telemetry):
    score, signals = score_reading(telemetry)
    severity = "critical" if score >= 70 else "warning" if score >= 45 else "healthy"
    action = "Isolate the asset and request technician inspection" if severity == "critical" else "Plan inspection during the next maintenance window" if severity == "warning" else "Continue monitoring"
    return {"machineId": telemetry.machineId, "riskScore": score, "severity": severity, "signals": signals, "recommendedAction": action, "model": "transparent-rule-and-anomaly-v1"}

class ClassifyRequest(BaseModel):
    machineId: str
    # One window of raw vibration samples. The model was trained on 2048-sample windows at
    # 12 kHz; other lengths work but drift further from the training distribution.
    samples: list[float] = Field(min_length=256, max_length=65536)
    samplingRate: float = 12000.0


@app.post("/classify")
def classify(request: ClassifyRequest):
    """Classifies a raw vibration window as normal / inner race / ball / outer race."""
    if bearing_model is None:
        raise HTTPException(status_code=503, detail={
            "message": "Bearing model unavailable",
            "hint": "Run ai-service/training/download.py then training/train.py",
            "versionMismatch": bool(bearing_meta and bearing_meta.get("input_version") != MODEL_INPUT_VERSION),
        })
    vector = to_vector(extract_features(np.asarray(request.samples), request.samplingRate))
    proba = bearing_model.predict_proba(vector.reshape(1, -1))[0]
    classes = list(bearing_model.named_steps["clf"].classes_)
    order = np.argsort(proba)[::-1]
    predicted = classes[int(order[0])]
    confidence = float(proba[int(order[0])])
    evaluation = (bearing_meta or {}).get("evaluation", {})
    return {
        "machineId": request.machineId,
        "predictedFault": predicted,
        # Confidence is the model's probability for this window. It is not machine health and
        # not a failure probability -- see known_limitations in the model metadata.
        "confidence": round(confidence, 4),
        "probabilities": {classes[int(i)]: round(float(proba[int(i)]), 4) for i in order},
        "isFault": predicted != "normal",
        "modelVersion": (bearing_meta or {}).get("model"),
        "trainedAccuracy": evaluation.get("leave_one_load_out"),
        "evaluationProtocol": evaluation.get("headline_metric"),
    }


@app.get("/replay/scenarios")
def replay_scenarios():
    """Lists the recorded runs the dashboard can play back."""
    return {
        "available": replay_data is not None and bearing_model is not None,
        **replay_meta,
    }


class ReplayStep(BaseModel):
    scenario: str
    index: int = Field(ge=0)


@app.post("/replay/step")
def replay_step(request: ReplayStep):
    """Classifies one window of a recorded run and reports it against the known true label.

    The true label is returned so the dashboard can show agreement honestly, including the
    windows the model gets wrong, rather than only the ones it gets right.
    """
    if replay_data is None or bearing_model is None:
        raise HTTPException(status_code=503, detail={"message": "Replay or model unavailable"})
    if request.scenario not in replay_data:
        raise HTTPException(status_code=404, detail={"message": f"Unknown scenario '{request.scenario}'"})

    windows = replay_data[request.scenario]
    labels = replay_data[f"{request.scenario}__labels"]
    total = int(len(windows))
    index = request.index % total  # Wrap so the dashboard can loop indefinitely.

    samples = np.asarray(windows[index], dtype=np.float64)
    vector = to_vector(extract_features(samples, replay_meta.get("samplingRate", 12000.0)))
    proba = bearing_model.predict_proba(vector.reshape(1, -1))[0]
    classes = list(bearing_model.named_steps["clf"].classes_)
    best = int(np.argmax(proba))
    predicted, truth = classes[best], str(labels[index])

    # The features actually fed to the model, so the dashboard can show what drove the call
    # rather than presenting the prediction as unexplained.
    feats = extract_features(samples, replay_meta.get("samplingRate", 12000.0))
    importances = getattr(bearing_model.named_steps["clf"], "feature_importances_", None)
    drivers = []
    if importances is not None:
        ranked = sorted(zip(FEATURE_NAMES, importances), key=lambda kv: kv[1], reverse=True)[:5]
        drivers = [{"name": n, "value": round(float(feats[n]), 4), "importance": round(float(w), 4)}
                   for n, w in ranked]

    return {
        "scenario": request.scenario,
        "index": index,
        "total": total,
        "predictedFault": predicted,
        "trueLabel": truth,
        "correct": predicted == truth,
        "confidence": round(float(proba[best]), 4),
        "probabilities": {c: round(float(p), 4) for c, p in zip(classes, proba)},
        "isFault": predicted != "normal",
        # A decimated trace for plotting; the full 2048 samples would bloat every poll.
        "waveform": [round(float(v), 4) for v in samples[::8]],
        "rmsAmplitude": round(float(np.sqrt(np.mean(samples**2))), 4),
        "kurtosis": round(float(feats["kurtosis"]), 3),
        "crestFactor": round(float(feats["crest_factor"]), 3),
        "topFeatures": drivers,
    }


@app.get("/model")
def model_info():
    """Exposes how the served model was evaluated, including its documented weaknesses."""
    if bearing_meta is None:
        return {"available": False, "reason": "No model has been trained yet"}
    return {
        "available": bearing_model is not None,
        "model": bearing_meta.get("model"),
        "classes": bearing_meta.get("classes"),
        "dataset": bearing_meta.get("dataset"),
        "evaluation": bearing_meta.get("evaluation"),
        "knownLimitations": bearing_meta.get("known_limitations", []),
    }


def local_answer(request: AskRequest, docs: list[dict]) -> str:
    context = docs[0]["content"]
    reading = request.telemetry
    observation = ""
    if reading:
        score, signals = score_reading(reading)
        observation = f" For {reading.machineId}, the current calculated risk is {score}%. " + " ".join(signals) + "."
    return (
        f"Start with a controlled inspection of lubrication, bearing condition, mounting and alignment.{observation} "
        f"The most relevant maintenance guidance says: {context} Create a work order and complete lockout-tagout before physical inspection. "
        "Treat this as decision support and have a qualified technician confirm the cause."
    )

SYSTEM_PROMPT = "You are an industrial maintenance decision-support assistant. Use only supplied evidence. Be concise, state uncertainty, cite evidence titles, and always require technician verification and lockout-tagout for physical work."

def hosted_answer(request: AskRequest, docs: list[dict]) -> str:
    """Enhance the local answer through any OpenAI-compatible provider (Gemini, Groq, OpenAI)."""
    from openai import OpenAI
    client = OpenAI(api_key=os.environ["LLM_API_KEY"], base_url=os.getenv("LLM_BASE_URL") or None)
    evidence = "\n".join(f"[{d['title']} — {d['section']}] {d['content']}" for d in docs)
    telemetry = request.telemetry.model_dump_json() if request.telemetry else "No live telemetry supplied"
    response = client.chat.completions.create(
        model=os.getenv("LLM_MODEL", "gemini-3.8-flash"),
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Question: {request.question}\nTelemetry: {telemetry}\nEvidence:\n{evidence}"}
        ]
    )
    return response.choices[0].message.content

@app.post("/ask")
def ask(request: AskRequest):
    docs = retrieve(request.question)
    answer = local_answer(request, docs)
    mode = "local-evidence"
    # Optional hosted LLM enhancement. Retrieval and local answers still work with no key.
    if os.getenv("LLM_API_KEY"):
        try:
            answer = hosted_answer(request, docs)
            mode = "hosted-llm"
        except Exception as exc:
            # Fall back to the local answer, but say why so a bad key is not silent.
            print(f"[ask] hosted LLM unavailable, using local evidence: {type(exc).__name__}: {exc}")
            mode = "local-evidence-fallback"
    return {"answer": answer, "sources": [f"{d['title']} · {d['section']}" for d in docs], "retrievalScores": [d["score"] for d in docs], "mode": mode}

@app.get("/documents")
def documents():
    return [{"id": d["id"], "title": d["title"], "section": d["section"]} for d in knowledge]
