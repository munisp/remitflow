FROM rust:1.75-alpine AS builder
RUN apk add --no-cache musl-dev
WORKDIR /build
COPY Cargo.toml ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release 2>/dev/null || true
COPY src ./src
RUN touch src/main.rs && cargo build --release
FROM scratch
COPY --from=builder /build/target/release/* /app/
USER 65534:65534
ENTRYPOINT ["/app/service"]
