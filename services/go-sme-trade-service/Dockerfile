# syntax=docker/dockerfile:1
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /bin/go-sme-trade-service .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /bin/go-sme-trade-service /bin/go-sme-trade-service
EXPOSE 8097
ENV PORT=8097
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/bin/go-sme-trade-service", "-healthcheck"] || exit 1
ENTRYPOINT ["/bin/go-sme-trade-service"]
