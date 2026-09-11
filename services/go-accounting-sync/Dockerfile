# ─── Build Stage ──────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder

LABEL org.opencontainers.image.vendor="RemitFlow" \
      org.opencontainers.image.licenses="Proprietary" \
      security.non-root="true"

WORKDIR /app

# go.sum committed; if drifted, CI runs go mod tidy (see OTEL.md — the OTel
# dependencies added in W11 require it). Bootstrap fallback: if go.sum is
# absent, resolve and pin modules at image build time instead of failing.
COPY go.mod ./
COPY . .

RUN if [ -f go.sum ]; then go mod download; else go mod tidy; fi && \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-s -w" -o accounting-sync .

# ─── Runtime Stage ────────────────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12:nonroot AS runtime

COPY --from=builder /app/accounting-sync /accounting-sync

EXPOSE 8113

USER nonroot:nonroot

# No HEALTHCHECK: distroless has no shell/wget. The orchestrator
# (Kubernetes livenessProbe / Docker healthcheck via sidecar) must probe
# GET /health on port 8113. The Dapr sidecar (see deploy/dapr/README.md)
# is injected via pod annotations, not baked into this image.

ENTRYPOINT ["/accounting-sync"]
