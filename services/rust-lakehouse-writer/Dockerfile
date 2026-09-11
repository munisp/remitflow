# ─── Build Stage ──────────────────────────────────────────────────────────────
FROM rust:1.82-slim-bookworm AS builder

LABEL org.opencontainers.image.vendor="RemitFlow" \
      org.opencontainers.image.licenses="Proprietary" \
      security.non-root="true" \
      security.cve-2025-49844="mitigated"

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Cache dependency build layer (no Cargo.lock yet — R1: generate + commit
# Cargo.lock on first toolchain-enabled build, then re-add it to the COPY).
COPY Cargo.toml ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release 2>/dev/null || true
RUN rm -rf src

COPY src ./src
RUN touch src/main.rs && cargo build --release

# ─── Runtime Stage ────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -r -s /bin/false -u 1001 appuser
USER appuser

WORKDIR /app
COPY --from=builder /app/target/release/rust-lakehouse-writer .

# Metrics/health listener (writer also needs a writable LAKE_DIR volume).
EXPOSE 9115
VOLUME ["/data/lakehouse"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://localhost:9115/health || exit 1

ENTRYPOINT ["./rust-lakehouse-writer"]
