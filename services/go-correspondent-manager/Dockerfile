# syntax=docker/dockerfile:1
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /bin/go-correspondent-manager .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /bin/go-correspondent-manager /bin/go-correspondent-manager
EXPOSE 8096
ENV PORT=8096
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/bin/go-correspondent-manager", "-healthcheck"] || exit 1
ENTRYPOINT ["/bin/go-correspondent-manager"]
