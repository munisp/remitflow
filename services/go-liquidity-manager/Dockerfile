FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /go-liquidity-manager .

FROM gcr.io/distroless/static-debian12:nonroot
LABEL org.opencontainers.image.title="remitflow-liquidity-manager"
LABEL org.opencontainers.image.description="RemitFlow AMM Liquidity Pool Manager"
COPY --from=builder /go-liquidity-manager /go-liquidity-manager
ENV PORT=8133
EXPOSE 8133
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/go-liquidity-manager", "-health"]
ENTRYPOINT ["/go-liquidity-manager"]
