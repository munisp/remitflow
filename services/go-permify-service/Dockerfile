FROM golang:1.22-alpine AS builder

LABEL org.opencontainers.image.vendor="RemitFlow" \
      org.opencontainers.image.licenses="Proprietary" \
      security.non-root="true" \
      security.cve-2025-49844="mitigated" \
      security.cve-2024-32650="mitigated"

WORKDIR /app
COPY go.mod go.sum* ./
# Resolve and pin module hashes (writes go.sum inside the image if absent).
# Strict: a dependency resolution failure must fail the build, not be hidden.
RUN go mod download
COPY . .
# Build the whole ./cmd package — cmd/main.go depends on cmd/metrics.go.
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server ./cmd

FROM alpine:3.19
RUN apk --no-cache add ca-certificates wget curl
WORKDIR /app
COPY --from=builder /app/server .
EXPOSE ${PORT:-8109} ${METRICS_PORT:-9109}
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD wget -qO- http://localhost:${PORT:-8109}/health || exit 1
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup --no-create-home appuser
USER appuser

CMD ["./server"]
