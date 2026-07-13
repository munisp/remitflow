FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o go-slo-tracker .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /app/go-slo-tracker /go-slo-tracker
EXPOSE 8144
USER nonroot:nonroot
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 CMD ["/go-slo-tracker", "-healthcheck"] || exit 1
ENTRYPOINT ["/go-slo-tracker"]
