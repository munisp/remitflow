FROM rust:1.77-slim AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release 2>/dev/null || true
COPY src/ src/
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/rust-agent-reconciliation /usr/local/bin/agent-reconciliation
EXPOSE 8098
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:8098/health || exit 1
CMD ["agent-reconciliation"]
