FROM rust:1.80-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main(){}" > src/main.rs && cargo build --release && rm -f target/release/deps/event_store*
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/event-store .
EXPOSE 8090
ENV RUST_LOG=info
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD curl -f http://localhost:8090/health || exit 1
CMD ["./event-store"]
