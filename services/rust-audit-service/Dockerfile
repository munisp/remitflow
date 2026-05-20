# ── Build stage ───────────────────────────────────────────────────────────────
FROM rust:1.77-slim-bookworm AS builder
WORKDIR /app
# Cache dependencies
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release && rm -rf src

# Build actual source
COPY src ./src
RUN touch src/main.rs && cargo build --release

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/audit-service /usr/local/bin/audit-service
ENV PORT=8082 \
    RUST_LOG=info \
    KAFKA_BROKERS=kafka:9092
EXPOSE 8082
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:8082/health || exit 1
ENTRYPOINT ["audit-service"]
