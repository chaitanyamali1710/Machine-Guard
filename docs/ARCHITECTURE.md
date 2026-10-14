# MachineGuard architecture

```mermaid
flowchart LR
    UI[React dashboard] --> API[Express REST API]
    API --> DB[(MongoDB Atlas)]
    API --> AI[FastAPI intelligence]
    SIM[Sensor simulator] --> API
    AI --> RET[TF-IDF retrieval]
    RET --> DOCS[(Manual knowledge)]
    AI -. optional .-> LLM[Hosted LLM]
```

## Responsibilities

- React renders live telemetry, analytics, alerts, work orders and AI answers.
- Express owns authentication, authorization, validation and operational workflows.
- FastAPI owns anomaly scoring and evidence retrieval.
- MongoDB persists operational data when configured. The in-memory store keeps the portfolio demo runnable with no cloud account.
- The simulator replaces physical sensors and produces realistic temperature, vibration, pressure, power and RPM values.

## Security controls

- JWT sessions with expiry.
- Role checks for write operations.
- Zod request validation.
- Helmet response headers and disabled `x-powered-by`.
- CORS allowlist and JSON body limits.
- Authentication rate limiting.
- No secrets committed to the repository.
- AI recommendations explicitly require human verification.
