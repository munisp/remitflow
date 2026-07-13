FROM rust:1.79-slim AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main(){}" > src/main.rs && cargo build --release 2>/dev/null || true
COPY src ./src
RUN touch src/main.rs && cargo build --release

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=builder /app/target/release/rust-payment-retry /rust-payment-retry
EXPOSE 8142
USER nonroot:nonroot
ENTRYPOINT ["/rust-payment-retry"]
