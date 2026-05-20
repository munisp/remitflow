# syntax=docker/dockerfile:1
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /bin/go-temporal-cbn .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /bin/go-temporal-cbn /bin/go-temporal-cbn
EXPOSE 8095
ENV PORT=8095
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/bin/go-temporal-cbn", "-healthcheck"] || exit 1
ENTRYPOINT ["/bin/go-temporal-cbn"]
