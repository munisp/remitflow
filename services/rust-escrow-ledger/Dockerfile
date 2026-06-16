FROM rust:1.77-slim AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release 2>/dev/null || true
COPY src/ src/
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/rust-escrow-ledger /usr/local/bin/escrow-ledger
EXPOSE 8096
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:8096/health || exit 1
CMD ["escrow-ledger"]
