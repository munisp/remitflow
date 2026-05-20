FROM golang:1.22-alpine AS builder
RUN apk add --no-cache git ca-certificates curl
WORKDIR /app
COPY go.mod ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s" -o apisix-config ./cmd/main.go
FROM alpine:3.19
RUN apk --no-cache add ca-certificates curl
WORKDIR /app
COPY --from=builder /app/apisix-config .
COPY rails_routes.yaml .
EXPOSE 8101
HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:8101/health || exit 1
ENTRYPOINT ["./apisix-config"]
