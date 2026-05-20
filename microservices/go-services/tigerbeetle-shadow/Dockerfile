FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o tigerbeetle-shadow .

FROM gcr.io/distroless/static:nonroot
WORKDIR /app
COPY --from=builder /app/tigerbeetle-shadow .
EXPOSE 8086
USER nonroot:nonroot
ENTRYPOINT ["/app/tigerbeetle-shadow"]
