FROM rust:1.75-slim AS builder
WORKDIR /app
COPY Cargo.toml ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/rate-limiter .
EXPOSE 8093
HEALTHCHECK --interval=10s --timeout=3s CMD curl -f http://localhost:8093/health || exit 1
CMD ["./rate-limiter"]
