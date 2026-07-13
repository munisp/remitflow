FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o go-realtime-hub .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /app/go-realtime-hub /go-realtime-hub
EXPOSE 8141
USER nonroot:nonroot
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/go-realtime-hub", "-healthcheck"] || exit 1
ENTRYPOINT ["/go-realtime-hub"]
