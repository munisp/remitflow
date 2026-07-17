FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o caddy-ondemand-validator .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /app/caddy-ondemand-validator /caddy-ondemand-validator
EXPOSE 8070
ENTRYPOINT ["/caddy-ondemand-validator"]
