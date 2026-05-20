FROM rust:1.77-alpine AS builder
RUN apk add --no-cache musl-dev pkgconfig openssl-dev
WORKDIR /app
COPY Cargo.toml ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs
RUN cargo build --release 2>/dev/null || true
RUN rm -f target/release/deps/service*
COPY src ./src
RUN cargo build --release

FROM alpine:3.19
RUN apk --no-cache add ca-certificates curl
WORKDIR /app
COPY --from=builder /app/target/release/service .
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD curl -f http://localhost:${PORT:-8080}/health || exit 1
CMD ["./service"]
