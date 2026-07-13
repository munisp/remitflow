FROM golang:1.22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache git
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o odl-orchestrator .

FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/odl-orchestrator /odl-orchestrator
EXPOSE 8250
ENTRYPOINT ["/odl-orchestrator"]
