FROM alpine:latest AS builder

# Install Zig
RUN apk add --no-cache wget xz
RUN wget https://ziglang.org/download/0.11.0/zig-linux-x86_64-0.11.0.tar.xz && \
    tar -xf zig-linux-x86_64-0.11.0.tar.xz && \
    mv zig-linux-x86_64-0.11.0 /usr/local/zig

ENV PATH="/usr/local/zig:${PATH}"

# Copy source
WORKDIR /app
COPY . .

# Build
RUN zig build -Doptimize=ReleaseFast

# Runtime image
FROM alpine:latest

# Copy binary
COPY --from=builder /app/zig-out/bin/tigerbeetle-native /usr/local/bin/

# Expose port
EXPOSE 8094

# Run
CMD ["tigerbeetle-native"]

