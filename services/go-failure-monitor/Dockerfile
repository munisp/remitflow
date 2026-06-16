FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY main.go .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o failure-monitor .

FROM alpine:3.19
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /root/
COPY --from=builder /app/failure-monitor .
EXPOSE 8097
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q --spider http://localhost:8097/health || exit 1
CMD ["./failure-monitor"]
