# syntax=docker/dockerfile:1
FROM rust:1.77-alpine AS builder
RUN apk add --no-cache musl-dev pkgconfig openssl-dev
WORKDIR /app
COPY Cargo.toml ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release 2>/dev/null || true && rm -f target/release/rust-sme-bulk-processor
COPY src ./src
RUN cargo build --release --target x86_64-unknown-linux-musl 2>/dev/null || cargo build --release

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /app/target/release/rust-sme-bulk-processor /bin/rust-sme-bulk-processor
EXPOSE 8101
ENV PORT=8101
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["/bin/rust-sme-bulk-processor", "--health"] || exit 1
ENTRYPOINT ["/bin/rust-sme-bulk-processor"]
