FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /go-defi-yield .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /go-defi-yield /go-defi-yield
USER nonroot:nonroot
ENTRYPOINT ["/go-defi-yield"]
