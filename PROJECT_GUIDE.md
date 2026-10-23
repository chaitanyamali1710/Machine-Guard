# MachineGuard — complete guide from scratch

Everything needed to understand, run, modify and deploy this project, assuming no prior
knowledge of it.

**Contents**
1. [What the project does](#1-what-the-project-does)
2. [Architecture — how the pieces connect](#2-architecture--how-the-pieces-connect)
3. [Technology choices — why each one](#3-technology-choices--why-each-one)
4. [The frontend](#4-the-frontend)
5. [The backend](#5-the-backend)
6. [The database](#6-the-database)
7. [The AI service](#7-the-ai-service)
8. [How each feature works](#8-how-each-feature-works)
9. [Changing the dataset — step by step](#9-changing-the-dataset--step-by-step)
10. [Running locally](#10-running-locally)
11. [Deployment](#11-deployment)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. What the project does

MachineGuard monitors industrial rotating equipment — pumps, compressors, CNC machines,
conveyors, generators — and answers four questions:

1. **What condition is each machine in?** Live telemetry, health score, status.
2. **What kind of fault is developing?** A machine-learning classifier trained on real bearing
   vibration data.
3. **How is the plant performing?** OEE, MTBF, MTTR, energy cost.
4. **What should be done about it?** Alerts, work orders, checklists, root cause capture.

It is a **decision-support** tool. Every recommendation requires confirmation by a qualified
technician, and the UI says so.

---

## 2. Architecture — how the pieces connect

```
                      ┌─────────────────────────────┐
                      │  Browser (React + Vite)     │
                      │  client/  — port 5173       │
                      └──────────────┬──────────────┘
                                     │ HTTP, JWT in Authorization header
                                     │ (dev: Vite proxies /api so it is same-origin)
                      ┌──────────────▼──────────────┐
                      │  Express API (Node + TS)    │
                      │  server/  — port 5000       │
                      │  auth · assets · work orders│
                      │  analytics · settings       │
                      └───────┬──────────────┬──────┘
                              │              │
          ┌───────────────────▼───┐   ┌──────▼─────────────────────┐
          │ MongoDB Atlas         │   │ FastAPI (Python)           │
          │ users · machines      │   │ ai-service/ — port 8000    │
          │ readings (TTL 7d)     │   │ classifier · retrieval     │
          │ alerts · workorders   │   │ replay                     │
          │ settings · downtime   │   └──────┬─────────────────────┘
          └───────────────────────┘          │
                                      ┌──────▼──────────────────┐
                                      │ Gemini (optional)       │
                                      │ explains ML results     │
                                      └─────────────────────────┘
```

### The key rule: the browser never talks to the AI service

React calls Express; Express calls FastAPI. This matters because:

- **Authentication lives in one place.** FastAPI has no notion of users or JWTs.
- **One CORS surface.** Only Express needs an allowlist.
- **The AI service can be replaced** without touching the frontend.
- **Express can store the result** before returning it.

### Request example — the AI copilot

```
1. React          POST /api/ai/ask   {question, machineId}   + JWT
2. Express        verifies JWT, looks up the machine's latest reading
3. Express        POST http://ai:8000/ask  {question, telemetry}
4. FastAPI        TF-IDF retrieval over knowledge.json → top 3 documents
5. FastAPI        (if a key is set) sends evidence + telemetry to Gemini
6. FastAPI        returns {answer, sources, mode}
7. Express        returns it to React
```

If Gemini is unavailable the service falls back to a locally-composed answer and reports
`mode: "local-evidence-fallback"` — it degrades, it does not fail.

---

## 3. Technology choices — why each one

### Node.js

**What it is.** A JavaScript runtime that executes JS outside the browser.

**Why here.** The API is almost entirely I/O — database queries, HTTP calls to the AI service —
with very little computation. Node's event loop handles many concurrent I/O operations on a
single thread without a thread per request, which suits this shape of work and runs comfortably
in the 512 MB Render free tier.

**The secondary reason that actually matters:** the frontend is already TypeScript. Using Node
means one language, one type system, and types shared between client and server. A Java or Go
backend would mean maintaining the same model definitions twice.

**When it would be the wrong choice.** Heavy CPU work — which is exactly why the ML lives in
Python instead.

### Express

**What it is.** A minimal HTTP framework for Node.

**Why here.** The API is ~30 straightforward REST routes. Express provides routing and
middleware and nothing else, which is the right amount of structure at this size. The
middleware chain is used deliberately:

```ts
app.use('/api/auth', rateLimit(...));   // brute-force protection on login only
app.use('/api', requireAuth);            // everything after this line needs a valid JWT
app.post('/api/machines', allow('admin','manager'), handler);   // and a role
```

That `app.use('/api', requireAuth)` line is load-bearing: every route declared *after* it is
protected by default. A new route cannot accidentally be public.

**Alternatives and why not.** NestJS brings decorators, DI and modules — valuable on a large
team, overhead here. Fastify is faster, but the bottleneck is MongoDB and the ML service, not
the HTTP layer.

### TypeScript

**Why here.** Industrial data has units, and units are where mistakes hide. `temperature`
in °C, `vibration` in mm/s, `power` in kW — a typed `Reading` interface shared by client and
server means a field renamed on the server breaks the client *at compile time* rather than
rendering `undefined` on a dashboard someone is making decisions from.

It also caught real bugs during development, including Express 5 typing route params as
`string | string[]`.

### MongoDB

**What it is.** A document database storing JSON-like records instead of rows and tables.

**Why here.**

1. **Sensor readings are naturally documents.** A reading is a self-contained object. No joins
   are needed to make sense of one.
2. **TTL indexes.** MongoDB can expire documents automatically:
   ```js
   readingSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7*24*60*60 });
   ```
   Old readings delete themselves. On a 512 MB free tier this is the difference between a
   working demo and a full cluster in two weeks. In SQL this would be a cron job.
3. **The schema evolved constantly.** Work orders gained timestamps, costs, checklists and root
   cause during development. In Postgres each would be a migration.
4. **Atlas has a genuinely free tier** with no time limit.

**The honest counter-argument.** MongoDB is *not* a time-series database. For real plant
volumes, InfluxDB or TimescaleDB would be the correct choice — purpose-built compression and
downsampling for exactly this data. MongoDB is right for *this* project's scale, not for a real
deployment.

**Mongoose** is used on top: it provides schemas (MongoDB itself is schemaless), index
declarations, and query building.

### Python + FastAPI

**Why Python for ML.** scikit-learn, NumPy and SciPy have no real equivalent in the Node
ecosystem. `scipy.io.loadmat` reads the MATLAB-format CWRU files directly. This is not a
preference; it is where the tools are.

**Why FastAPI.** Pydantic models validate request bodies and generate OpenAPI docs
automatically (visit `/docs`). For a service whose entire job is "accept numbers, return a
prediction", automatic validation of those numbers is most of the work.

```python
class ClassifyRequest(BaseModel):
    machineId: str
    samples: list[float] = Field(min_length=256, max_length=65536)
    samplingRate: float = 12000.0
```
A request with 3 samples is rejected with a clear 422 before any code runs.

### React

**Why here.** The dashboard is a set of independent panels that update on their own schedules —
telemetry every 5 s, replay every 900 ms, settings on save. React's component model with local
state maps directly onto that.

Deliberately **no Redux or state library**: state is either local to a panel or fetched from the
API. Introducing a global store would add indirection without solving a problem that exists.

### Vite

**Why here.** Instant dev server start and sub-second hot reload. One feature is used
structurally — the **dev proxy**:

```ts
server: { proxy: { '/api': { target: 'http://localhost:5000' } } }
```

This makes the browser see one origin, so there is no CORS in development and no hardcoded IP
address. It is also what allows another machine on the LAN to use the dashboard without
reconfiguration.

### Recharts

**Why here.** React-native charting, declarative, no imperative canvas code. Sufficient for
line and area charts. The plant floor map is **hand-written SVG** instead, because its layout is
derived from data (zones from `location`) rather than being a chart.

### scikit-learn

**Why Random Forest.**

1. **It works on small tabular data.** 5,886 windows × 29 features is not deep-learning
   territory.
2. **Feature importances come free**, which powers the "what drove this call" panel.
3. **No GPU, fast inference**, and the artifact is 1.3 MB — it fits on a free tier.
4. **It is the published baseline** for this benchmark, so results are comparable.

A `Pipeline` wraps a `StandardScaler` so preprocessing is fitted **inside each cross-validation
fold**, on training data only. Fitting the scaler on all data first would leak test statistics
into training.

### JWT + bcrypt

**JWT** lets the server verify a request without a session store — it checks a signature. That
keeps Express stateless, which matters because Render's free tier restarts containers.

**bcrypt** hashes passwords with a deliberately slow algorithm. The work factor (10 rounds)
makes brute-forcing expensive. Passwords are never stored or logged in plain text.

A deliberate detail in `accounts.ts`: when an email is not found, the code still runs a bcrypt
comparison against a dummy hash, so a missing account does not answer faster than a wrong
password and reveal itself by timing.

### Gemini (optional)

**Why optional.** The AI copilot works without it using TF-IDF retrieval over maintenance
manuals. The LLM only improves the *wording*. If the key is missing, wrong, or out of quota,
the service logs why and falls back.

**Why an OpenAI-compatible endpoint.** Written against the OpenAI SDK with a configurable
`base_url`, so Gemini, Groq or OpenAI are a `.env` change rather than a code change.

**The LLM never invents numbers.** It receives the ML prediction and evidence and explains
them. It cannot override the classifier.

---

## 4. The frontend

**Location:** `client/`

```
client/
├── index.html
├── vite.config.ts        dev server + /api proxy
├── src/
│   ├── main.tsx          React entry point
│   ├── App.tsx           all components (single file by choice)
│   ├── api.ts            axios instance, injects the JWT
│   ├── types.ts          shared TypeScript interfaces
│   └── styles.css        all styling, CSS variables for theming
```

**Why one `App.tsx`.** The project is one developer's portfolio piece. A single file means no
hunting across directories, and the components are genuinely coupled to one layout. For a team
this would be split by route.

### How a page is rendered

```tsx
type Page = 'overview' | 'machines' | 'alerts' | 'work-orders'
          | 'reliability' | 'performance' | 'operations'
          | 'replay' | 'assistant' | 'settings' | 'account';

const [page, setPage] = useState<Page>('overview');
...
{page==='overview' && <>...</>}
{page==='reliability' && <ReliabilityView/>}
```

No router library. Navigation is state. Trade-off: no URL for a page, so no deep links or
browser back button. Acceptable for a single-screen dashboard; the first thing to change if
sharing links to specific assets ever matters.

### Authentication flow

```
1. Login form   → POST /api/auth/login
2. Server       → { token, user }
3. Client       → localStorage.setItem('maintai_token', token)
4. api.ts       → every request adds: Authorization: Bearer <token>
5. On 401       → localStorage.clear(), back to the login screen
```

### Styling

Plain CSS, no framework. Colour tokens are CSS variables:
```css
:root{ --ok:#17a06f; --warn:#e39a2b; --bad:#e05a42; --line:#e5eaf1; }
```

The brand palette is **industrial blue**. Status colours are deliberately *not* blue —
green/amber/red are conventional for condition, and a blue "healthy" badge beside a blue brand
would be ambiguous.

---

## 5. The backend

**Location:** `server/`

```
server/src/
├── index.ts         startup, timers, graceful degradation
├── app.ts           all Express routes
├── auth.ts          JWT signing and verification, role middleware
├── accounts.ts      user storage, password changes
├── db.ts            MongoDB connection, isDbReady()
├── models.ts        Mongoose schemas and indexes
├── repository.ts    data access with memory fallback
├── store.ts         in-memory simulator
├── settings.ts      plant-wide configuration
├── reliability.ts   OEE, MTBF, MTTR, downtime events
├── analytics.ts     energy, signals, period comparison
├── operations.ts    SLA, workload, cost, shift handover
├── workorders.ts    lifecycle, checklists, root cause
└── types.ts         shared interfaces
```

### Startup sequence (`index.ts`)

```ts
if (NODE_ENV === 'production' && !JWT_SECRET) process.exit(1);  // refuse to start
await connectDb();      // returns false rather than throwing if unavailable
await seed();           // assets, alerts, work orders — only if collections are empty
await seedAdmin();      // the administrator account, only on first run
await loadSettings();   // plant configuration from the database
schedule();             // start the simulator and persistence timers
```

**The production guard is deliberate.** `auth.ts` has a development fallback secret visible in
the public repository. Starting in production without `JWT_SECRET` would let anyone forge admin
tokens, so the server refuses to start instead.

### Graceful degradation

Every data function checks `isDbReady()`:

```ts
export async function getAlerts(){
  if(!isDbReady()) return alerts;     // in-memory array
  return (await AlertModel.find()...).map(toAlert);
}
```

The app runs fully with no database — useful for a demo on a plane. The UI warns that changes
will not survive a restart rather than silently losing them.

### Two timers, different rates

```ts
sensorTimer  = setInterval(() => { tick(); recordTick(); recordEnergy(); }, 4000);
persistTimer = setInterval(() => persistReadings(), 30000);
```

Fast simulation for a responsive UI, slow persistence to protect the free tier. Both are
rescheduled when an administrator changes the interval — no restart needed.

---

## 6. The database

**MongoDB Atlas**, database `maintai`.

### Collections

| Collection | Holds | Notes |
|---|---|---|
| `users` | Accounts | bcrypt hashes, `isDefaultPassword` flag |
| `machines` | Asset master | Latest reading embedded for speed |
| `readings` | Time series | **TTL index — expires after 7 days** |
| `alerts` | Alerts | `acknowledgedAt` drives SLA |
| `workorders` | Work orders | Checklist, cost, failure code, 5-whys |
| `settings` | Plant config | Single document, keyed `system` |
| `downtimes` | Outage events | What MTBF and MTTR are counted from |

### Indexes — and the trap

```js
readingSchema.index({ machineId: 1, timestamp: -1 });              // chart queries
readingSchema.index({ timestamp: 1 }, { expireAfterSeconds: ... }); // TTL
```

**Do not add `index: true` to the `timestamp` field.** Declaring a field-level index *and* a
TTL index on the same key makes Mongoose treat them as duplicates and **silently drop
`expireAfterSeconds`**. This happened during development: the index existed with no expiry,
nothing was being deleted, and 11,070 readings had accumulated before it was noticed.

**Changing the retention period** requires dropping and recreating the index — MongoDB cannot
alter `expireAfterSeconds` in place. `index.ts` does this automatically via `applyRetention()`.

### Storage budget

| Setting | Value | Effect |
|---|---|---|
| `PERSIST_INTERVAL_MS` | 30000 | 6 assets × 2/min ≈ 17,280 docs/day |
| `READING_TTL_DAYS` | 7 | ~120,000 docs steady state ≈ 35 MB |

Lowering the interval to 1 s would write ~500,000 docs/day and fill the 512 MB tier within
days. Settings validation enforces a 10-second floor for this reason.

---

## 7. The AI service

**Location:** `ai-service/`

```
ai-service/
├── main.py                FastAPI app, all endpoints
├── preprocessing.py       feature extraction — SHARED by training and serving
├── knowledge.json         maintenance manual extracts for retrieval
├── models/
│   ├── bearing_rf_v1.joblib   trained model, committed
│   └── metadata.json          metrics and documented limitations
├── data/
│   ├── raw/cwru/          134 MB of .mat files — GITIGNORED
│   ├── processed/         feature cache — GITIGNORED
│   └── replay/            883 KB bundle — COMMITTED
└── training/
    ├── download.py        fetch 40 CWRU recordings
    ├── dataset.py         windowing, labelling, grouping
    ├── train.py           train + three evaluation protocols
    ├── stress_test.py     noise robustness, cross-severity
    ├── experiment_severity.py   the refuted hypothesis
    └── export_replay.py   build the committed replay bundle
```

### The most important file: `preprocessing.py`

It is imported by **both** `training/train.py` and `main.py`. If training and serving ever
computed features differently, the model would degrade silently — predictions would stay
plausible and nothing would error.

`MODEL_INPUT_VERSION` guards this. The service **refuses to load** a model whose metadata
version differs from the current preprocessing version:

```python
if meta.get("input_version") != MODEL_INPUT_VERSION:
    print("[model] REFUSING to load ... Retrain with training/train.py")
    return None, meta
```

Failing loudly beats serving confident nonsense.

### Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | Status, document count, whether an LLM key is loaded |
| `GET /model` | Model metadata **including documented limitations** |
| `POST /analyze` | Rule-based scoring of a single scalar reading |
| `POST /classify` | ML classification of a raw vibration window |
| `POST /ask` | Evidence retrieval + optional LLM answer |
| `GET /replay/scenarios` | Available recorded runs |
| `POST /replay/step` | Classify one window, return prediction **and ground truth** |

---

## 8. How each feature works

### Live telemetry
`store.ts` generates readings every 4 s from per-machine baselines with sinusoidal drift and
random noise. Compressor CMP-012 has deliberate upward drift so something is always degrading
for demonstration. A risk score is computed from temperature, vibration and pressure, then
mapped to a status using the configurable thresholds.

### Reliability (OEE, MTBF, MTTR)
`reliability.ts` accumulates on every tick. Entering `critical` opens a downtime event; leaving
closes one. **Availability, MTBF and MTTR are measured from that log.** Performance and Quality
use simulated production counts, because no sensor reports them — the arithmetic is standard
OEE, the inputs are synthetic, and the UI states this.

Plant OEE rolls up from **raw totals**, not averaged percentages, so the figure equals its own
A × P × Q factors.

### Energy
`analytics.ts` integrates power into kWh (kW × elapsed hours) on each tick. Each asset learns
**its own baseline** from its first ~15 samples; deviation is measured against that, because a
42 kW generator and an 8 kW conveyor cannot share a threshold. Machines in a critical state are
excluded from energy totals so idle draw does not distort efficiency.

### Fault replay
See §4 of `PROJECT_CONTEXT.md` for the full data path and the hold-out rule.

### Work order lifecycle
`open → in-progress → completed`, with timestamps. Completion is **blocked** unless every
checklist task is ticked **and** a failure code is recorded. Free text cannot be counted;
counted causes are what eventually become ML training labels.

### Shift handover
`operations.ts` covers a fixed, stated window: what needs attention, outstanding alerts, work
completed, what is carried over, and a one-line headline. The window is stated because a
handover that silently changes period is worse than none.

---

## 9. Changing the dataset — step by step

The current model uses CWRU bearing data. Here is how to swap it.

### Option A — different CWRU recordings (easiest)

**Step 1.** Edit the manifest in `ai-service/training/download.py`:
```python
MANIFEST: list[tuple[int, str, float, int]] = [
    # (file number, label, defect size in inches, motor load in hp)
    (97, "normal", 0.0, 0),
    (105, "inner_race", 0.007, 0),
    ...
]
```
File numbers come from the CWRU Bearing Data Center catalogue.

**Step 2.** Download:
```powershell
.venv\Scripts\python.exe ai-service\training\download.py
```

**Step 3.** Delete the feature cache so it rebuilds:
```powershell
Remove-Item ai-service\data\processed\cwru_features.npz
```

**Step 4.** Retrain, then rebuild the replay bundle:
```powershell
.venv\Scripts\python.exe ai-service\training\train.py
.venv\Scripts\python.exe ai-service\training\export_replay.py
```

**Step 5.** Restart the AI service. It logs `[model] Loaded bearing_rf_v1`.

### Option B — a completely different dataset

**Step 1 — write a loader.** `dataset.py` must return six things:
```python
X           # (n_windows, n_features) feature matrix
y           # (n_windows,) class labels
severity    # fault severity per window, or zeros
recordings  # which recording each window came from  ← REQUIRED for honest splits
loads       # operating condition per window         ← REQUIRED for honest splits
feature_names
```

`recordings` and `loads` are not optional. Without them you cannot split by recording or by
condition, and a random split will produce a meaningless ~100% score.

**Step 2 — adapt feature extraction if the signal type differs.** `preprocessing.py` assumes a
1-D vibration waveform. For current, acoustic or pressure signals the features may need
changing. **If you change the feature set:**
```python
MODEL_INPUT_VERSION = 3   # bump this
```
and retrain. The service will refuse to load a model built against the old version, which is
the desired behaviour.

**Step 3 — update the class list.** The classes come from `y`, but the UI maps them to labels in
`client/src/App.tsx`:
```ts
const FAULT_LABELS: Record<string,string> = {
  normal: 'Healthy', inner_race: 'Inner race fault', ...
};
```

**Step 4 — adjust the sampling rate** in `dataset.py` if it is not 12 kHz:
```python
SAMPLING_RATE = 12_000.0
```
This matters: spectral band edges are computed from it, so a wrong value silently produces
wrong frequency features.

**Step 5 — check the hold-out rule still makes sense.** `REPLAY_HOLDOUT_LOAD = 3` holds out one
motor load. With a different dataset, hold out whatever dimension represents "a condition the
model has not seen".

**Step 6 — retrain and re-read the metrics.** `train.py` prints three protocols. Quote the
hardest one. If the leaky random split and the honest split are close, the dataset is probably
too easy — which is exactly what was discovered with CWRU.

### What to update afterwards
- `ai-service/models/metadata.json` regenerates automatically, including limitations
- `PROJECT_CONTEXT.md` §3 — the numbers quoted there will be stale
- The footer in `App.tsx` names the dataset: `DATASET  CWRU 12k drive-end`

---

## 10. Running locally

### Prerequisites
| Tool | Version | Why that version |
|---|---|---|
| Node.js | 20+ | Express 5 and modern TypeScript |
| Python | **3.11** | Pinned scipy/scikit-learn have no wheels for newer |
| MongoDB Atlas | free M0 | Optional — the app runs without it |

### Step 1 — environment files
```powershell
Copy-Item server/.env.example server/.env
Copy-Item client/.env.example client/.env
Copy-Item ai-service/.env.example ai-service/.env
```

### Step 2 — JWT secret
```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Paste into `server/.env` as `JWT_SECRET=...`

### Step 3 — MongoDB (optional)
In Atlas: create a cluster, add a database user, allow your IP, copy the connection string.
```env
MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/maintai?retryWrites=true&w=majority
```
URL-encode any `@ : / ? # [ ] %` in the password, or regenerate one without them.

Skip this and the app runs on its in-memory store.

### Step 4 — LLM key (optional)
Free key from `https://aistudio.google.com` → Get API key.
```env
LLM_API_KEY=your_key
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
LLM_MODEL=gemini-3.8-flash
```
Confirm the model name in the console — names change.

### Step 5 — install
```powershell
npm install
npm run install:all
py -3.11 -m venv .venv
.venv\Scripts\python.exe -m pip install -r ai-service\requirements.txt
```

### Step 6 — run everything
```powershell
npm run dev
```
Starts all three services. It finds the virtualenv automatically — no activation needed.

| Service | URL |
|---|---|
| Dashboard | http://localhost:5173 |
| Express | http://localhost:5000/api/health |
| FastAPI | http://localhost:8000/health |
| API docs | http://localhost:8000/docs |

**Public evaluator login:** `demo@maintai.dev` / `Demo@12345` (read-only).

### Step 7 — confirm it is working
- Express logs `MongoDB connected`
- FastAPI logs `[model] Loaded bearing_rf_v1` and `[replay] Loaded 5 scenarios`
- The **Fault replay** page plays and shows predictions against ground truth

### Running the tests
```powershell
npm run test --prefix server
.venv\Scripts\python.exe -m pytest ai-service -q
```

### Access from another machine on the same network
Vite binds `0.0.0.0` and proxies `/api`, so it works unchanged:
```
http://<this-machine-ip>:5173
```
Find the IP with `ipconfig`. Both machines must be on the same network, and this machine must
keep running.

---

## 11. Deployment

Three pieces deploy separately. **Order matters** — each needs the previous one's URL.

### 11.1 FastAPI → Render

| Setting | Value |
|---|---|
| Runtime | Python 3 |
| Root directory | `ai-service` |
| Build | `pip install -r requirements.txt` |
| Start | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| Health check | `/health` |

**Environment:**
```
PYTHON_VERSION=3.11      ← REQUIRED. Render's default has no wheels for the pinned scipy
LLM_API_KEY=...          ← optional
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
LLM_MODEL=gemini-3.8-flash
```

**Before deploying, confirm these are committed:**
- `ai-service/models/bearing_rf_v1.joblib` (1.3 MB)
- `ai-service/data/replay/replay.npz` (883 KB)

Render's free tier cannot train a model or hold the 134 MB dataset. Without these artifacts
`/classify` and `/replay` return 503 while everything else still works.

### 11.2 Express → Render

| Setting | Value |
|---|---|
| Runtime | Node |
| Root directory | `server` |
| Build | `npm install && npm run build` |
| Start | `npm start` |
| Health check | `/api/health` |

**Environment:**
```
NODE_ENV=production
JWT_SECRET=<your generated secret>    ← the server REFUSES to start without this
MONGODB_URI=<your Atlas URI>
AI_SERVICE_URL=https://your-ai-service.onrender.com
CLIENT_URL=https://your-frontend-url
PERSIST_INTERVAL_MS=30000
READING_TTL_DAYS=7
```

**Atlas network access:** Render does not publish fixed outbound IPs on the free tier, so you
may need `0.0.0.0/0` in Atlas Network Access. That allows connection *attempts* from anywhere,
which makes the database password the only thing protecting your data — use a strong generated
one.

### 11.3 React → Vercel

| Setting | Value |
|---|---|
| Framework | Vite |
| Root directory | `client` |
| Build | `npm run build` |
| Output | `dist` |

**Environment:**
```
VITE_API_URL=https://your-express-api.onrender.com/api
```

**Important:** locally `VITE_API_URL=/api` because Vite proxies. In production there is no
proxy, so this must be the **full absolute URL** including `/api`.

After deploying, set `CLIENT_URL` on the Express service to the exact Vercel URL and redeploy —
otherwise CORS blocks the browser.

### 11.4 Free-tier behaviour to expect

- **Render free services sleep after inactivity.** The first request takes 30–50 seconds to
  wake. Tell anyone you demo to.
- **Atlas M0 is 512 MB.** The TTL index keeps readings bounded; do not lower
  `PERSIST_INTERVAL_MS`.
- **Gemini free tier has rate limits.** The copilot falls back to local evidence when exhausted
  and reports `local-evidence-fallback`.

---

## 12. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `bad auth : authentication failed` | Wrong DB password, or the user was created in a different Atlas **project** | Database users are per-project. Confirm the user is listed in the same project that owns the cluster |
| Server exits immediately in production | `JWT_SECRET` not set | Deliberate. Set it |
| `/classify` returns 503 | No trained model, or a version mismatch | Run `train.py`; check the log for `REFUSING to load` |
| `[model] REFUSING to load` | `preprocessing.py` changed without retraining | Retrain. Working as designed |
| Readings never expire | Duplicate index declaration dropped the TTL | Do not put `index: true` on `timestamp`. Drop and recreate the index |
| Copilot always says `local-evidence` | No `LLM_API_KEY` | Optional feature; set the key if wanted |
| Copilot says `local-evidence-fallback` | Key wrong, out of quota, or provider busy | Check the AI service log — it prints the exact reason |
| Garbled `â€”` in output | A tool read UTF-8 as cp1252 | Use Python for text edits, not PowerShell read-modify-write |
| `pip install` fails on scipy | Python newer than 3.11 | Recreate the venv with `py -3.11` |
| Build fails on Render (Python) | `PYTHON_VERSION` not set | Set it to `3.11` |
| CORS error in production | `CLIENT_URL` does not match the frontend origin exactly | Must include scheme, no trailing path |
| Dev server port conflicts | Orphaned `tsx watch` / `vite` processes | Kill node processes matching the project, then restart |
