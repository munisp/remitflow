# RemitFlow Polyglot Microservices

This directory contains three purpose-built microservices that extend RemitFlow's Node.js core with high-performance, language-native capabilities.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    RemitFlow Polyglot Stack                      │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Node.js / Express / tRPC  :3000             │   │
│  │  (main app, auth, DB, user management, routing)          │   │
│  └──────┬──────────────────┬──────────────────┬─────────────┘   │
│         │ HTTP             │ HTTP             │ HTTP             │
│         ▼                  ▼                  ▼                  │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐      │
│  │  Go (Gin)    │  │ Python (Fast  │  │  Rust (Axum)     │      │
│  │  FX Engine   │  │  API + sklearn│  │  AML Engine      │      │
│  │  :8081       │  │  Fraud ML)    │  │  :8083           │      │
│  │              │  │  :8082        │  │                  │      │
│  │  /rates      │  │  /score       │  │  /screen         │      │
│  │  /quote      │  │  /explain     │  │  /sanctions-check│      │
│  │  /execute    │  │  /analytics/  │  │  /pep-check      │      │
│  │  /corridors  │  │    corridor-  │  │  /rules          │      │
│  │  /health     │  │    stats      │  │  /health         │      │
│  └──────┬───────┘  │  /health      │  └──────────────────┘      │
│         │          └───────────────┘                             │
│         ▼                                                        │
│  ┌──────────────┐                                                │
│  │  Redis :6379 │  (FX rate cache, 5-min TTL)                   │
│  └──────────────┘                                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Services

### fx-engine (Go 1.22 + Gin)
**Purpose:** High-throughput FX rate engine with Redis caching and transfer orchestration.

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Liveness probe |
| `/rates` | GET | Live rate lookup (`?from=USD&to=NGN`) |
| `/quote` | POST | Compute fee, FX rate, receive amount |
| `/execute` | POST | Orchestrate transfer (validate → lock → emit) |
| `/corridors` | GET | Supported corridors with min/max amounts |

**Why Go:** Goroutines make concurrent rate-fetching and Redis cache warming trivially fast. The compiled binary starts in <50ms.

---

### fraud-ml (Python 3.11 + FastAPI + scikit-learn)
**Purpose:** Real-time transaction fraud scoring with SHAP explanations and corridor analytics.

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Liveness probe |
| `/score` | POST | Returns `fraud_score` (0–1), `risk_level`, `top_features` |
| `/explain` | POST | SHAP feature-importance explanation for a transaction |
| `/analytics/corridor-stats` | GET | Avg amount, volume, fraud rate per corridor |
| `/analytics/user-risk-profile/{userId}` | GET | Rolling 30-day risk metrics |
| `/retrain` | POST | Re-train model on latest synthetic data |

**Why Python:** scikit-learn, SHAP, pandas, and numpy are the industry standard for ML pipelines. FastAPI gives async HTTP with zero boilerplate.

---

### aml-engine (Rust 1.75 + Axum + Tokio)
**Purpose:** Zero-latency AML rules engine with OFAC-style sanctions screening and structuring detection.

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Liveness probe |
| `/screen` | POST | Run transaction through AML rules → `PASS / REVIEW / BLOCK` |
| `/sanctions-check` | POST | Check name/entity against embedded sanctions list |
| `/pep-check` | POST | Politically exposed person screening |
| `/rules` | GET | List all active rules with thresholds |

**Rules implemented:** structuring detection (sub-$10k splits), velocity limits (>5 transfers/hour), high-risk country checks, round-number detection, and large single-transfer alerts (>$50k).

**Why Rust:** Zero-cost abstractions and no GC pauses make Rust ideal for a compliance hot-path that must respond in <5ms even under load.

---

## Quick Start

### Development (individual services)

```bash
# Go FX Engine
cd services/fx-engine
export PATH=$PATH:/usr/local/go/bin
go run main.go

# Python Fraud ML
cd services/fraud-ml
uvicorn main:app --reload --port 8082

# Rust AML Engine
cd services/aml-engine
source ~/.cargo/env
cargo run --release
```

### Full Stack (Docker Compose)

```bash
# From repo root
docker compose up --build          # first run (builds all images)
docker compose up -d               # subsequent runs (background)
docker compose logs -f app         # tail main app logs
docker compose logs -f fx-engine   # tail Go service
docker compose down                # stop all services
```

### Environment Variables

The Node.js app reads service URLs from environment variables with sensible defaults:

| Variable | Default | Description |
|---|---|---|
| `FX_ENGINE_URL` | `http://localhost:8081` | Go FX engine base URL |
| `FRAUD_ML_URL` | `http://localhost:8082` | Python fraud ML base URL |
| `AML_ENGINE_URL` | `http://localhost:8083` | Rust AML engine base URL |

All three clients implement graceful fallbacks — if a microservice is unavailable, the Node.js server falls back to its built-in logic and logs a warning rather than returning a 500.

---

## Integration Points in Node.js

The typed HTTP clients live in `server/services/`:

- `server/services/fx-client.ts` — wraps Go FX engine
- `server/services/fraud-client.ts` — wraps Python fraud ML
- `server/services/aml-client.ts` — wraps Rust AML engine

These are called from `server/routers.ts` in the `microservices` router and also wired into `transfer.send` for live AML + fraud screening on every outbound transfer.

The auto-start launcher (`server/_core/microservices.ts`) spawns all three as child processes when the Node.js dev server starts, so no manual service management is needed in development.
