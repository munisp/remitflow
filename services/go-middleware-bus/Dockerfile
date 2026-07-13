FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /go-middleware-bus ./main.go

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /go-middleware-bus /go-middleware-bus
USER nonroot:nonroot
EXPOSE 8200
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/go-middleware-bus", "-healthcheck"]
ENTRYPOINT ["/go-middleware-bus"]
