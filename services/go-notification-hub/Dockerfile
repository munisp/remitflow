FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /go-notification-hub ./main.go

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /go-notification-hub /go-notification-hub
USER nonroot:nonroot
EXPOSE 8180
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/go-notification-hub", "-healthcheck"]
ENTRYPOINT ["/go-notification-hub"]
