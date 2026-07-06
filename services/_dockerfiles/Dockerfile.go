# Multi-stage Dockerfile for RemitFlow Go microservices
#
# Usage:
#   docker build -f services/_dockerfiles/Dockerfile.go \
#     --build-arg SERVICE_NAME=go-marklane-fx-bridge \
#     -t remitflow/go-marklane-fx-bridge:latest \
#     ./services/go-marklane-fx-bridge
#
# Works for all Go services in /services/go-*

ARG GO_VERSION=1.22
ARG SERVICE_NAME=go-service

# ── Build Stage ────────────────────────────────────────────────────────────────

FROM golang:${GO_VERSION}-alpine AS builder

ARG SERVICE_NAME

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /app

# Cache dependencies
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true

# Copy source
COPY . .

# Build static binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s -X main.Version=$(git describe --tags --always 2>/dev/null || echo dev)" \
    -o /app/service ./...

# ── Runtime Stage ──────────────────────────────────────────────────────────────

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /app/service /service

USER nonroot:nonroot

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/service", "-health"]

ENTRYPOINT ["/service"]
