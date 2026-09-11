# ─── Build Stage ──────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder

LABEL org.opencontainers.image.vendor="RemitFlow" \
      org.opencontainers.image.licenses="Proprietary" \
      security.non-root="true"

WORKDIR /app

# Zero third-party dependencies — no go.sum / go mod download needed.
COPY go.mod ./
COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-s -w" -o investment-feed .

# ─── Runtime Stage ────────────────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12:nonroot AS runtime

COPY --from=builder /app/investment-feed /investment-feed

EXPOSE 8080

USER nonroot:nonroot

# No HEALTHCHECK: distroless has no shell/wget. The orchestrator
# (Kubernetes livenessProbe / Docker healthcheck via sidecar) must probe
# GET /health on port 8080.

ENTRYPOINT ["/investment-feed"]
