# MachineGuard — full project context

**Purpose of this file.** A complete, self-contained handoff of the MachineGuard project: what
it is, every decision taken and why, every bug found and how it was fixed, and the honest
limitations. Written so another AI model or developer can pick the project up without the
original conversation.

**Status:** working application, all tests passing. Not deployed. Not validated against real
machinery.

**Owner / author:** Chaitanya Mali (`chaitanyamali1710` on GitHub).
**Repository:** `https://github.com/chaitanyamali1710/maintai-ops` (first commit only; later work
described here may still be uncommitted — check `git log` before assuming).

---

## 1. What the project is

An industrial predictive-maintenance platform for rotating plant equipment. Three services:

| Service | Stack | Responsibility |
|---|---|---|
| `client/` | React + TypeScript + Vite | Dashboard UI |
| `server/` | Node + Express + TypeScript | Auth, assets, work orders, analytics, proxying to AI |
| `ai-service/` | Python + FastAPI + scikit-learn | Bearing fault classifier, evidence retrieval, replay |

Data lives in MongoDB Atlas (free M0 tier). The ML model is trained offline on the CWRU
bearing benchmark and committed as an artifact.

Originally named **MaintAI**; renamed to **MachineGuard**. Some internal identifiers still say
`maintai` deliberately — see §7.

---

## 2. The central design decision: real data, not simulation

The project originally proposed building virtual machines in **MATLAB/Simulink**, exporting
CSVs, and training on that synthetic data.

**That approach was rejected, and this is the most important thing to understand about the
project.** The reasoning:

Simulate → train → predict is circular. You inject faults with a known signature, then the
model learns that signature. High accuracy proves the model learned *your assumptions*, not
machine behaviour. The first question any reviewer asks is "does it work on a real machine?",
and the answer would be "unknown".

**What was done instead:** trained on the **CWRU Bearing Data Center** benchmark — real
measured vibration from real bearings with real faults, with published baselines to compare
against. Simulation was kept, but only for *animating the live dashboard*, never for training.

Secondary reasons: MATLAB is not installed on the development machine, Simscape has a steep
learning curve across six machine types, and MATLAB cannot run on Render's free tier.

**If you are asked to revisit this:** the decision is sound, but the honest counter-argument is
that if the goal were specifically to learn Simulink/Simscape for employability, that changes
the calculus. The digital-twin skill has independent market value.

---

## 3. The machine learning, honestly

### Model
`ai-service/models/bearing_rf_v1.joblib` — a scikit-learn `Pipeline` of `StandardScaler` +
`RandomForestClassifier` (300 trees, balanced class weights).

**Four classes:** `normal`, `inner_race`, `ball`, `outer_race`.

**29 features** from `ai-service/preprocessing.py`: time-domain statistics (RMS, peak,
peak-to-peak, mean-abs, std, skewness, kurtosis), four shape ratios (crest, shape, impulse,
clearance), spectral centroid and spread, and 8 spectral band energies plus their 8 ratios.

**Training data:** 40 CWRU recordings, 12 kHz drive-end accelerometer, 5,886 windows of 2,048
samples at 50% overlap. Four fault classes × three defect sizes (0.007/0.014/0.021 in) × four
motor loads (0–3 hp).

### Evaluation results

| Protocol | Result | Meaning |
|---|---|---|
| Random window split | 100.0% | **Leaky — never quote.** Overlapping windows land in both train and test |
| Grouped by recording | 99.1% | Honest within known operating conditions |
| **Leave-one-load-out** | **99.4%** | **The headline figure.** Trained on three loads, tested on an unseen one |
| Noise at 0 dB SNR | 96.1% | Genuine robustness — equal signal and noise power |
| **Cross-severity** | **50–75%** | **The real limitation** |

### Three documented limitations

These are written into `ai-service/models/metadata.json` and served at `GET /model`, so the
caveats travel with the model rather than living only in someone's head.

1. **Fault detection on CWRU is trivial.** A single amplitude threshold on `peak` matches the
   forest exactly (gain +0.0000) at every noise level tested. The model's value is in
   classifying *which* fault, not *whether* there is one.
2. **Cross-severity transfer is weak.** On a defect size absent from training, accuracy falls
   to 0.50–0.75 — but **missed faults stay at 0%**. It still knows something is wrong; it
   cannot name it. Training data must span the severity range you expect.
3. **CWRU faults are EDM-machined**, so cleaner and more separable than natural spalling.
   These figures are an optimistic estimate of real-world performance.

### A refuted hypothesis (worth keeping)

The cross-severity collapse was hypothesised to be caused by scale-dependent features — the
top features were all *absolute* band energies, which grow with defect size.

**The hypothesis was tested and refuted.** `ai-service/training/experiment_severity.py`
restricted training to scale-invariant features only; cross-severity transfer got *worse*
(−0.22 on one split). Absolute magnitude carries genuine diagnostic information.

Adding band *ratios* alongside the absolute energies did help (0.007 in: 0.5279 → 0.7469), so
the expanded 29-feature set was kept.

This negative result is deliberately preserved. It demonstrates method, not failure.

---

## 4. Fault replay — how it works

The most demonstrable feature. Streams real recordings through the model one window at a time.

### Data path
```
CWRU Bearing Data Center        40 × .mat, 134 MB
  ↓ training/download.py        gitignored, never deployed
ai-service/data/raw/cwru/
  ↓ training/export_replay.py   40 windows × 5 scenarios
ai-service/data/replay/replay.npz   883 KB, float32, COMMITTED
```

The raw archive is too large for Render's free tier, so a small committed bundle ships instead.

### The integrity rule — do not break this

The served model is trained on motor loads **0, 1, 2 hp**. Every replay window comes from
**3 hp**, a load the model has never seen.

```python
REPLAY_HOLDOUT_LOAD = 3           # training/train.py
serve = loads != REPLAY_HOLDOUT_LOAD
final = make_model().fit(X[serve], y[serve])
```

Without this the demo would be recall dressed as prediction. It costs ~25% of training data
(4,352 of 5,886 windows) and is worth it.

### Per-step flow
1. React → `POST /api/replay/step {scenario, index}`
2. Express proxies to FastAPI (browser never talks to the ML service directly)
3. FastAPI loads window `index` — 2,048 raw samples at 12 kHz ≈ 0.17 s of vibration
4. `preprocessing.extract_features()` computes the 29 features
5. Random Forest predicts; probabilities returned for all four classes
6. Response carries prediction, **ground truth**, confidence, decimated waveform, kurtosis,
   crest factor, and the top-5 feature drivers

**The model has no memory between windows.** When the `degradation` scenario flips at index 20,
it is caught from that window's physics alone. That is how it would behave on a live machine.

### Scenarios
`healthy`, `inner_race_fault`, `ball_fault`, `outer_race_fault`, and `degradation` (20 healthy
windows then 20 inner-race, fault onset at index 20).

---

## 5. Bugs found and fixed (chronological)

These are recorded because several are subtle and could recur.

| # | Bug | Impact | Fix |
|---|---|---|---|
| 1 | `knowledge.json` read with OS default encoding | cp1252 on Windows mangled every em-dash in AI citations; worked on Linux, broke locally | `read_text(encoding="utf-8")` |
| 2 | MongoDB was decorative | Five schemas defined, **zero routes used them**. All data in memory; work orders vanished on restart | Added `db.ts` + `repository.ts`, real persistence with memory fallback |
| 3 | **TTL index silently disabled** | `index: true` on the field *and* a separate TTL index made Mongoose drop `expireAfterSeconds`. Nothing expired. 11,070 readings had accumulated; the 512 MB cluster would fill in ~2 weeks | Removed field-level index; dropped and recreated the index in the live DB |
| 4 | OEE formula inconsistency | Plant OEE averaged per-machine values while the UI displayed `A × P × Q` beside it. 83.3% × 78.3% × 99.4% = 64.8%, but 77.8% was shown | Roll up from raw totals so the figure equals its own factors |
| 5 | Dead "Register asset" button | Looked functional, did nothing. Fixing it required store refactoring — `tick()` did `base.find(...)!` and would crash on any machine missing a baseline | Runtime asset registration with per-type baselines + `POST /api/machines` |
| 6 | Dead "Create maintenance order" button | Same class of problem, in the asset drawer | Wired to a real form + `POST /api/work-orders` |
| 7 | Misleading global search | Sat in the header on every page, only filtered the machine table | Rebuilt as genuine multi-entity search with `Ctrl+K` |
| 8 | Footer on every page | Mounted unconditionally inside `<main>` | Gated to `page === 'overview'` |
| 9 | Overload flag crying wolf | Flagged someone "overloaded" with 1 open order against a 0.3 mean — statistically true, operationally useless | Added a floor of 4 open orders |
| 10 | Python version drift | Venv rebuilt on 3.11 while docs said 3.12 | Docs and `render.yaml` corrected to 3.11 |

### A mistake made during development, worth not repeating

A bulk find-and-replace used PowerShell `Get-Content`/`Set-Content`. PowerShell 5.1 reads
BOM-less UTF-8 as cp1252, so `°C` → `Â°C`, `—` → `â€”`, `·` → `Â·`, and BOMs were added to six
files. **This is the same bug class as #1**, introduced by the tooling used to fix other things.

**Rule going forward: use Python for text edits on this project, never PowerShell
read-modify-write.**

---

## 6. Feature inventory

### Core
- JWT auth with bcrypt, roles (`admin`/`manager`/`technician`/`viewer`), rate-limited login
- Six seeded assets with simulated live telemetry (temperature, vibration, pressure, power, rpm)
- Alerts with acknowledgement, work orders, machine drawer

### Added during development
| Feature | Notes |
|---|---|
| **Real accounts** | Credentials in MongoDB, changeable email + password, survives restart. Login page stops advertising demo credentials once changed |
| **Two settings panels** | System (plant-wide, admin-only: facility name, risk thresholds, intervals, retention, energy tariff) and Account (personal) |
| **Reliability** | OEE (A × P × Q), MTBF, MTTR, per-asset breakdown |
| **Performance** | Energy (kWh, cost, per-asset baseline deviation, kWh/unit), multi-signal trends, period comparison |
| **Operations** | Shift handover, alert SLA, technician workload, maintenance cost |
| **Work order detail** | Lifecycle, ISO-style checklists, labour + parts cost, 12 failure codes, 5-whys |
| **Fault replay** | Scrubber, speed control, step, confusion matrix, feature drivers, raise work order, CSV export |
| **Plant floor map** | SVG, zones derived from `location` data, status by colour *and* text |
| **Accessibility** | Skip link, focus rings, 17 aria attributes, live region, reduced-motion support |
| **AI copilot** | TF-IDF retrieval over maintenance manuals + optional LLM |

### The honesty pattern (applied throughout — preserve it)

Several features report **"unknown" or null rather than zero** when data is genuinely absent:

- SLA shows "unknown" response time for alerts acknowledged before timestamps existed.
  Counting them as instant would have shown 100% compliance from missing data.
- Period comparison shows "no data" rather than 0% for empty windows.
- MTBF/MTTR return `null`, not infinity, when nothing has failed.
- Energy baseline shows "learning…" until enough samples exist.
- Cost reports how many orders have no labour logged, so totals read as a floor.
- OEE page states that Performance and Quality use simulated production counts because no
  sensor supplies them.

---

## 7. Deliberately NOT renamed

The rename from MaintAI → MachineGuard protected three identifiers. **Do not "fix" these:**

| Identifier | Why |
|---|---|
| `maintai` MongoDB database name | Renaming orphans all existing data |
| `admin@maintai.dev` | A real row in that database; editable from the Account panel |
| `maintai_token` / `maintai_user` localStorage keys | Renaming silently signs every user out |

---

## 8. Environment facts

- **Python 3.11** (venv at `maintai-ops/.venv`). Pinned scipy 1.15.3, scikit-learn 1.6.1,
  numpy 2.2.5. Newer Python lacks wheels for these.
- **Node 24**, npm 11.
- **MongoDB Atlas** M0 free tier (512 MB), database `maintai`, user `maintai_app`.
- **LLM**: Google Gemini via the OpenAI-compatible endpoint, model `gemini-3.8-flash`.
  Optional — the copilot degrades to local evidence retrieval without a key.
- **Git Bash is broken on the dev machine** (fork errors). Use PowerShell for shell commands,
  Python for text manipulation.

### Free-tier storage protection

The simulator ticks every 4 s. Persisting every tick would write ~130,000 documents/day
(~36 MB/day) and fill the 512 MB cluster in about two weeks. Mitigations:

- Readings persist every **30 s**, not every tick (`PERSIST_INTERVAL_MS`)
- A **TTL index** expires readings after 7 days (`READING_TTL_DAYS`)
- Settings validation enforces a 10-second floor on the write interval

Steady state is roughly 35 MB.

---

## 9. What is NOT done

- **Not deployed.** Render/Vercel configuration exists and is corrected, but never executed.
- **Not validated against real machinery.** Every claim is benchmark-based.
- **No RUL (remaining useful life).** Originally planned via NASA C-MAPSS; never built.
- **No anomaly detection** for unlabelled faults (Isolation Forest was proposed).
- **No theme picker.** Industrial blue is applied; the light/dark/custom setting was agreed but
  not implemented — a proper dark mode needs every surface and chart colour re-tuned.
- **Accessibility not screen-reader tested.** Correct attributes are present; that is not the
  same as testing with NVDA or VoiceOver.
- **Model drift monitoring, SHAP explanations, audit log** — all proposed, none built.

---

## 10. How to talk about this project

**Lead with:** real benchmark data, held-out evaluation, documented limitations.

**The strongest single sentence:** *"I hypothesised the cross-severity collapse came from
scale-dependent features, tested it, and I was wrong — restricting to scale-invariant features
made transfer worse."* Most people present only results that worked.

**Volunteer limitations before being asked.** Every number in this project has a stated basis
and you can point at the code that produces it. That habit is worth more than a higher number.

**Do not claim** the model is good at *detecting* faults (a threshold matches it), that it works
on real machines (unproven), or that 99.4% means anything without saying which protocol
produced it.
