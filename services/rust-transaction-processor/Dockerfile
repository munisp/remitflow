# Build stage
FROM rust:1.75-slim AS builder

WORKDIR /app

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends     libpq-dev     pkg-config     && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml .
COPY src/ ./src/

RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends     libpq5     ca-certificates     curl     && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/rust-transaction-processor /app/

EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3     CMD wget -qO- http://localhost:8081/health || exit 1

CMD ["./rust-transaction-processor"]
