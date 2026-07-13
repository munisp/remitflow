FROM rust:1.80-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release && rm src/main.rs
COPY src/ ./src/
RUN touch src/main.rs && cargo build --release

FROM gcr.io/distroless/cc-debian12:nonroot
LABEL org.opencontainers.image.title="remitflow-price-oracle"
LABEL org.opencontainers.image.description="RemitFlow Real-Time Price Oracle with Depeg Circuit Breaker"
COPY --from=builder /app/target/release/rust-price-oracle /rust-price-oracle
ENV PORT=8130
EXPOSE 8130
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["/rust-price-oracle", "--health"]
ENTRYPOINT ["/rust-price-oracle"]
