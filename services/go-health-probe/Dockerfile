# ─── Build Stage ──────────────────────────────────────────────────────────────
FROM golang:1.22-bookworm AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-s -w" -o health-probe .

# ─── Runtime Stage ────────────────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12 AS runtime

COPY --from=builder /app/health-probe /health-probe

EXPOSE 8099

USER nonroot:nonroot

ENTRYPOINT ["/health-probe"]
