FROM golang:1.22-alpine AS builder
RUN apk add --no-cache git ca-certificates tzdata
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o service .
FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata curl
WORKDIR /app
COPY --from=builder /app/service .
EXPOSE 8097
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD curl -f http://localhost:8097/health || exit 1
CMD ["./service"]
