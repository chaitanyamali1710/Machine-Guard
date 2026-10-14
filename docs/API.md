# API quick reference

Base URL: `http://localhost:5000/api`

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/auth/login` | Obtain a JWT |
| GET | `/health` | API health check |
| GET | `/dashboard` | Aggregated operational view |
| GET | `/machines` | List equipment |
| GET | `/machines/:id` | Inspect one machine |
| PATCH | `/alerts/:id/acknowledge` | Acknowledge an alert |
| POST | `/work-orders` | Create a maintenance order |
| POST | `/ai/analyze/:machineId` | Analyze live telemetry |
| POST | `/ai/ask` | Ask an evidence-grounded question |

Use the header `Authorization: Bearer <token>` for all endpoints except login and health.
