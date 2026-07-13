FROM rust:1.80-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release && rm src/main.rs
COPY src/ ./src/
RUN touch src/main.rs && cargo build --release

FROM gcr.io/distroless/cc-debian12:nonroot
LABEL org.opencontainers.image.title="remitflow-chain-bridge"
LABEL org.opencontainers.image.description="RemitFlow Multi-Chain Bridge (LayerZero/Wormhole/CCTP/Axelar)"
COPY --from=builder /app/target/release/rust-chain-bridge /rust-chain-bridge
ENV PORT=8131
EXPOSE 8131
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["/rust-chain-bridge", "--health"]
ENTRYPOINT ["/rust-chain-bridge"]
