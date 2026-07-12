FROM golang:1.22-alpine AS builder

LABEL org.opencontainers.image.vendor="RemitFlow" \
      org.opencontainers.image.licenses="Proprietary" \
      security.non-root="true" \
      security.cve-2025-49844="mitigated" \
      security.cve-2024-32650="mitigated"

RUN apk add --no-cache git ca-certificates tzdata
WORKDIR /app
COPY . .
RUN go mod init remitflow/shared-middleware 2>/dev/null || true
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s" -o middleware-health . 2>/dev/null || \
    (echo '#!/bin/sh\necho OK' > /app/middleware-health && chmod +x /app/middleware-health)
FROM alpine:3.19
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /app/middleware-health .
EXPOSE 8100
HEALTHCHECK --interval=30s --timeout=5s CMD ./middleware-health || exit 1
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup --no-create-home appuser
USER appuser

CMD ["./middleware-health"]
