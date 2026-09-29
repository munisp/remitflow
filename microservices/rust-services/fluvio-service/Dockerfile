FROM rust:1.82-slim-bookworm as builder

LABEL org.opencontainers.image.vendor="RemitFlow" \
      org.opencontainers.image.licenses="Proprietary" \
      security.non-root="true" \
      security.cve-2025-49844="mitigated" \
      security.cve-2024-32650="mitigated"

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Cache dependency build layer (no Cargo.lock yet — generate + commit on the
# first toolchain-enabled build, then add it to the COPY).
COPY Cargo.toml .
RUN mkdir src && echo "fn main() {}" > src/main.rs && (cargo build --release 2>/dev/null || true) && rm -rf src
COPY src ./src
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/fluvio-service .
# Bridge listens on FLUVIO_BRIDGE_PORT/PORT, default 8300 (matches
# server/lib/env.ts FLUVIO_HTTP_BRIDGE_URL default http://fluvio-bridge:8300).
EXPOSE 8300
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup --no-create-home appuser
USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT:-8300}/health || exit 1

CMD ["./fluvio-service"]
