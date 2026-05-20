FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server ./cmd/main.go

FROM alpine:3.19
RUN apk --no-cache add ca-certificates wget curl
WORKDIR /app
COPY --from=builder /app/server .
EXPOSE ${PORT:-8080}
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD wget -qO- http://localhost:${PORT:-8080}/health || exit 1
CMD ["./server"]
