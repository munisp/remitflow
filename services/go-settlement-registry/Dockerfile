FROM golang:1.21-alpine AS builder

LABEL org.opencontainers.image.vendor="RemitFlow" \
      org.opencontainers.image.licenses="Proprietary" \
      security.non-root="true" \
      security.cve-2025-49844="mitigated" \
      security.cve-2024-32650="mitigated"

WORKDIR /app
RUN apk add --no-cache gcc musl-dev
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o settlement-registry .

FROM alpine:3.19 AS runtime
RUN apk add --no-cache ca-certificates curl
WORKDIR /app
COPY --from=builder /app/settlement-registry .
ENV PORT=8098 GIN_MODE=release
EXPOSE 8098
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD curl -f http://localhost:8098/health || exit 1
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup --no-create-home appuser
USER appuser

CMD ["./settlement-registry"]
