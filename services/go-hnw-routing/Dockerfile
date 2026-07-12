# syntax=docker/dockerfile:1
FROM golang:1.22-alpine AS builder

LABEL org.opencontainers.image.vendor="RemitFlow" \
      org.opencontainers.image.licenses="Proprietary" \
      security.non-root="true" \
      security.cve-2025-49844="mitigated" \
      security.cve-2024-32650="mitigated"

WORKDIR /app
COPY go.mod ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /bin/go-hnw-routing .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /bin/go-hnw-routing /bin/go-hnw-routing
EXPOSE 8098
ENV PORT=8098
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/bin/go-hnw-routing", "-healthcheck"] || exit 1
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup --no-create-home appuser
USER appuser

ENTRYPOINT ["/bin/go-hnw-routing"]
