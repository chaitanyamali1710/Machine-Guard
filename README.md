# MachineGuard Ops

MachineGuard is a hardware-free industrial maintenance intelligence platform. It combines a MERN-style web application with a FastAPI AI service, simulated equipment telemetry, transparent anomaly scoring and evidence-grounded maintenance assistance.

## What works

- Responsive React and TypeScript operations dashboard
- Virtual sensor stream for six industrial assets
- JWT login and role-based write protection
- Health scoring, live status and risk alerts
- Alert acknowledgement and work-order creation
- Equipment telemetry charts and drill-down drawer
- FastAPI anomaly assessment
- RAG-style retrieval from maintenance knowledge
- Optional hosted LLM enhancement
- MongoDB schemas with zero-key in-memory demo fallback
- REST API tests, AI tests and Playwright test
- Docker Compose, GitHub Actions, Jenkins, Firebase, Vercel and Render configuration

## Quick start — demo mode

Requirements: Node.js 22+ and Python 3.11+.

```bash
npm install
npm run install:all
python -m venv .venv
```

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
pip install -r ai-service/requirements.txt
npm run dev
```

macOS/Linux:

```bash
source .venv/bin/activate
pip install -r ai-service/requirements.txt
npm run dev
```

Open `http://localhost:5173` and sign in with:

```text
Email: admin@maintai.dev
Password: Admin@123
```

No MongoDB or LLM key is required for demo mode.

## Docker start

```bash
docker compose up --build
```

Then open `http://localhost:5173`.

## Configuration

Each service has its own empty environment template:

```powershell
Copy-Item server/.env.example server/.env
Copy-Item client/.env.example client/.env
Copy-Item ai-service/.env.example ai-service/.env
```

The repository contains no database, API key, cloud account, project ID or deployment URL. Never commit `.env` files. Read [SETUP_KEYS.md](SETUP_KEYS.md) for the fully manual account, credential and deployment procedure.

## Interview explanation

The project uses generated sensor events instead of physical hardware. React communicates with Express through REST APIs. Express manages authentication and operational workflows and calls the FastAPI service for anomaly analysis and grounded maintenance answers. MongoDB Atlas can persist data in connected mode, while local demo mode is immediately runnable without external accounts.

## Important limitation

This is a portfolio and educational decision-support system. The simulator and thresholds are not validated for controlling real industrial equipment. A qualified engineer must verify all maintenance decisions.
