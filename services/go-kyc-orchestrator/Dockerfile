FROM golang:1.23-alpine AS builder
WORKDIR /app
RUN apk add --no-cache git ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o go-kyc-orchestrator .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /app/go-kyc-orchestrator /usr/local/bin/go-kyc-orchestrator
EXPOSE 8150
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/usr/local/bin/go-kyc-orchestrator"] || exit 1
USER nonroot
ENTRYPOINT ["/usr/local/bin/go-kyc-orchestrator"]
