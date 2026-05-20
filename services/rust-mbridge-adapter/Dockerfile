FROM rust:1.78-alpine AS builder
RUN apk add --no-cache musl-dev pkgconfig openssl-dev
WORKDIR /app
COPY Cargo.toml ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release 2>/dev/null || true
COPY src ./src
RUN cargo build --release
FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /app/target/release/mbridge-adapter /usr/local/bin/mbridge-adapter
EXPOSE 8080
ENTRYPOINT ["mbridge-adapter"]
