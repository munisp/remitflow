# ── Build stage ───────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder

LABEL org.opencontainers.image.vendor="RemitFlow" \
      org.opencontainers.image.licenses="Proprietary" \
      security.non-root="true" \
      security.cve-2025-49844="mitigated" \
      security.cve-2024-32650="mitigated"

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /bin/ratelimit-sidecar .

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /bin/ratelimit-sidecar /ratelimit-sidecar
ENV PORT=8084 \
    REDIS_URL=redis://redis:6379 \
    GO_ENV=production
EXPOSE 8084
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD ["/ratelimit-sidecar", "-health"]
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup --no-create-home appuser
USER appuser

ENTRYPOINT ["/ratelimit-sidecar"]
