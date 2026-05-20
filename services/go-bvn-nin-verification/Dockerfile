FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /bvn-nin-verify ./cmd/server

FROM alpine:3.19
COPY --from=builder /bvn-nin-verify /bvn-nin-verify
EXPOSE 8121
CMD ["/bvn-nin-verify"]
