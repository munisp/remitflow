FROM rust:1.77-alpine AS builder
RUN apk add --no-cache musl-dev
WORKDIR /app
COPY . .
RUN cargo build --release

FROM alpine:3.19
COPY --from=builder /app/target/release/sanctions-batch-rescreener /sanctions-batch-rescreener
EXPOSE 8122
CMD ["/sanctions-batch-rescreener"]
