FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /health-aggregator .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /health-aggregator /health-aggregator
EXPOSE 8200
CMD ["/health-aggregator"]
