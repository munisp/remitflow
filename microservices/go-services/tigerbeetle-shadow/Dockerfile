# ─── Build Stage ──────────────────────────────────────────────────────────────
# tigerbeetle-go wraps the TB client's native library — it REQUIRES cgo and a
# glibc toolchain (no Alpine/musl, no CGO_ENABLED=0, no distroless/static).
FROM golang:1.22-bookworm AS builder

LABEL org.opencontainers.image.vendor="RemitFlow" \
      org.opencontainers.image.licenses="Proprietary" \
      security.non-root="true"

WORKDIR /app

# go.sum is generated during the build (dependencies are pinned by go.mod);
# requires network access to proxy.golang.org at image build time.
COPY go.mod ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -ldflags="-w -s" -o tigerbeetle-shadow .

# ─── Runtime Stage ────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

# wget is required by the HEALTHCHECK below and by compose healthchecks.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -r -s /bin/false -u 1001 appuser

WORKDIR /app
COPY --from=builder /app/tigerbeetle-shadow .

EXPOSE 8086
USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-8086}/health || exit 1

ENTRYPOINT ["/app/tigerbeetle-shadow"]
