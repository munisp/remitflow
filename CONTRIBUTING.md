# Contributing

## Repository layout

- `services/` — independent Go, Rust, and Python microservices. Each is self-contained: its own `go.mod`/`Cargo.toml`/`requirements.txt`, its own `Dockerfile` (where containerized), no shared code across services today.
- `services/payment-gateways/` — one directory per payment rail/provider, each with its own `client.py`/`service.py` pair.
- `uis/pwa` — the customer/agent-facing Progressive Web App (Vite + React + TypeScript + Tailwind).
- `infrastructure/` — Helm charts (`charts/`), a chart generator (`templates/template-chart`, driven by `00_provision_chart.sh`), APISIX gateway config (`../infra/apisix/`, `../services/gateway-config/`), Dapr manifests (`manifests/dapr/`), and Permify authorization policies (`integration/permify_policies/`).
- `.github/workflows/` — CI (lint/build/test), security scanning, and deploy pipelines.

## Local setup

1. Pick the service you're working on and follow its Quick Start entry in the root [README.md](README.md).
2. If you're touching `infrastructure/` scripts, copy `infrastructure/.env.example` to `infrastructure/.env`, fill in real values (ask a teammate with cluster access — do not invent or reuse values from git history), and `source infrastructure/.env` before running any numbered script.
3. Never commit real secrets. `infrastructure/.env` and `infrastructure/config/docker.json` are gitignored for this reason — if a script needs a new secret, add it as an env var and document it in `infrastructure/.env.example`, don't inline it.

## Code style by language

- **Go**: `go vet ./...` and `go build ./...` must pass. Match the existing services' dependency versions (gin 1.9.1, sqlx, lib/pq 1.10.9, kafka-go, zap, prometheus client) unless there's a specific reason to diverge.
- **Rust**: `cargo build` and `cargo clippy` must pass without new warnings.
- **Python**: services use FastAPI + Pydantic v2. Keep `requirements.txt` in sync with actual imports.
- **Frontend**: `npm run lint` (ESLint) and `npm run build` (`tsc && vite build`) must pass.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`type(scope): summary`), enforced by `.commitlintrc.json`. Valid scopes match the service/domain being touched (see that file for the full list) — use `infra` for `infrastructure/` changes and `security` for anything touching secrets, auth, or dependency vulnerabilities.

## Before opening a PR

- New/changed services: add or update tests so `.github/workflows/ci.yml`'s matrix job for that service has something to run.
- Infrastructure script changes: do not run `helm upgrade`/`kubectl apply` against the live cluster from a local machine as part of a PR — that's what `.github/workflows/deploy.yml` is for. Validate script logic locally (e.g. `bash -n script.sh`, dry-run flags) instead.
- If you're adding a new backend service, provision its Helm chart with `infrastructure/00_provision_chart.sh` and add it to the relevant matrix in `.github/workflows/ci.yml` / `deploy.yml`.
