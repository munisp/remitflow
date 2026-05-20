FROM golang:1.22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache git
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o ledger-service .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates wget curl
WORKDIR /app
COPY --from=builder /app/ledger-service .
EXPOSE 8086
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:8086/health || exit 1
USER nobody
CMD ["./ledger-service"]
