# ── Build stage ──────────────────────────────────────────────────────────────
FROM rust:1.75-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock* ./
# Pre-fetch dependencies for layer caching
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
RUN touch src/main.rs && cargo build --release

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/liveness-proxy .
EXPOSE 8096
ENV PORT=8096 \
    UPSTREAM_LIVENESS_URL=http://python-kyc-liveness:8090 \
    CIRCUIT_OPEN_THRESHOLD=5 \
    CIRCUIT_RESET_SECS=30 \
    RATE_LIMIT_RPM=10 \
    UPSTREAM_TIMEOUT_SECS=30 \
    RUST_LOG=info
CMD ["./liveness-proxy"]
