# ═══════════════════════════════════════════════════════════════════════════════
# RemitFlow — Caddy ↔ Keycloak Forward Auth Bridge
# ═══════════════════════════════════════════════════════════════════════════════
FROM golang:1.23-alpine AS builder

WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download

COPY *.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o caddy-keycloak-bridge .

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /app/caddy-keycloak-bridge /caddy-keycloak-bridge

EXPOSE 8090

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/caddy-keycloak-bridge", "-health-check"]

ENTRYPOINT ["/caddy-keycloak-bridge"]
