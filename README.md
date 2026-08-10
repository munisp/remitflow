# 54link_remittance_banking

Polyglot microservices backend for a cross-border remittance and banking platform, plus a PWA frontend. Deployed on DigitalOcean Kubernetes behind an APISIX gateway, with Dapr sidecars and Permify for authorization.

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a system overview.

## Tech stack

| Layer | Stack |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, Zustand, TanStack Query (`uis/pwa`) |
| Backend services | Go (gin), Rust (axum), Python (FastAPI) — see `services/` |
| API gateway | APISIX (`infra/apisix/`, `services/gateway-config/`, `services/go-apisix-manager/`) |
| Service mesh | Dapr sidecars (`infrastructure/manifests/dapr`) |
| Authorization | Permify ReBAC (`infrastructure/integration/permify_policies`) |
| Orchestration | Kubernetes (DigitalOcean), Helm — one chart per service (`infrastructure/charts`) |

## Services

| Service | Language | Purpose |
|---|---|---|
| `bnpl-service` | Go | Buy-now-pay-later eligibility and credit lines |
| `cbdc-service` | Go | Central bank digital currency rail integration |
| `direct-debit-service` | Go | Direct debit mandates and collections |
| `multi-bank-routing-service` | Go + Python | Smart routing, liquidity, reconciliation, ML-driven routing |
| `payment-gateways/*` | Python | Per-provider clients (M-Pesa, Paystack, SWIFT, SEPA, UPI, Western Union, and 19 more) |
| `policy-engine-service` | Python | MLflow-backed policy rollout (canary/A-B/shadow) |
| `rust-transaction-processor` | Rust | Low-latency transaction processing |
| `saga-orchestrator-service` | Python | Distributed transaction saga orchestration |
| `travel-rule-service` | Go | FATF Travel Rule compliance |

## Quick start

Each Go service is self-contained:

```bash
cd services/<service-name>
go mod tidy
go run main.go
```

Rust:

```bash
cd services/rust-transaction-processor
cargo run
```

Python services (FastAPI, where present):

```bash
cd services/<service-name>
pip install -r requirements.txt
uvicorn main:app --reload
```

Frontend:

```bash
cd uis/pwa
npm ci
npm run dev
```

## Infrastructure

Chart provisioning, cluster setup, and registry auth scripts live in `infrastructure/`. They read secrets from environment variables — copy `infrastructure/.env.example` to `infrastructure/.env`, fill in real values, and `source` it before running any of the numbered scripts. See that file for what's required and how to generate each value.
