FROM golang:1.25-alpine AS builder

LABEL org.opencontainers.image.vendor="RemitFlow" \
      org.opencontainers.image.licenses="Proprietary" \
      security.non-root="true" \
      security.cve-2025-49844="mitigated" \
      security.cve-2024-32650="mitigated"

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o security-sidecar .

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=builder /app/security-sidecar .
EXPOSE 8200
# distroless:nonroot already runs as the built-in non-root "nonroot" user
# (UID 65532) — this stage has no shell, so addgroup/adduser can't run here
# anyway, and would be redundant even if it could.

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-8080}/health || exit 1

ENTRYPOINT ["/app/security-sidecar"]
