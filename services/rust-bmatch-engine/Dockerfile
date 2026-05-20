FROM rust:1.77-slim-bookworm AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev cmake libsasl2-dev && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release 2>/dev/null; rm -rf src
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl libssl3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/bmatch-engine .
ENV PORT=8097 RUST_LOG=info REDIS_URL=redis://redis:6379 KAFKA_BROKERS=kafka:9092
EXPOSE 8097
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD curl -f http://localhost:8097/health || exit 1
CMD ["./bmatch-engine"]
