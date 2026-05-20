FROM golang:1.21-alpine AS builder

WORKDIR /app
COPY . .
RUN go build -ldflags="-s -w" -o tigerbeetle-edge .

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/tigerbeetle-edge .
EXPOSE 8095
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8095/health || exit 1
CMD ["./tigerbeetle-edge"]
