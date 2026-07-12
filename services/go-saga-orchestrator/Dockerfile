FROM golang:1.22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache git ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o saga-orchestrator .

FROM scratch
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /app/saga-orchestrator /saga-orchestrator
EXPOSE 8091
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD ["/saga-orchestrator", "-health"]
ENTRYPOINT ["/saga-orchestrator"]
