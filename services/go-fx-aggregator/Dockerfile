FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /fx-aggregator .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /fx-aggregator /fx-aggregator
EXPOSE 8100
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8100/health || exit 1
CMD ["/fx-aggregator"]
