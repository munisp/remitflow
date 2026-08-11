# ─── Build Stage ──────────────────────────────────────────────────────────────
FROM rust:1.82-slim-bookworm AS builder

LABEL org.opencontainers.image.vendor="RemitFlow" \
      org.opencontainers.image.licenses="Proprietary" \
      security.non-root="true"

WORKDIR /app

# libclang-dev: required by bindgen (tigerbeetle-unofficial-sys build).
# curl + xz-utils: required by the vendored zig download.sh which fetches and
# extracts the zig toolchain used to build the tb_client C library.
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    libclang-dev \
    curl \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Generate a lockfile inside the build so the dependency graph is pinned and
# reproducible even though no Cargo.lock is checked into the repo.
COPY Cargo.toml ./
RUN cargo generate-lockfile && cargo fetch

# The tigerbeetle-unofficial-sys crate vendors TigerBeetle 0.16.63's zig
# download.sh, which hardcodes the old pkg.machengine.org mirror. That mirror
# now answers 307 redirects to pkg.hexops.org and the script's curl invocation
# does not follow redirects — teach it to, or the tb_client C build fails.
RUN find /usr/local/cargo/registry/src -path '*tigerbeetle-unofficial-sys*/tigerbeetle/zig/download.sh' \
      -exec sed -i 's/curl --silent --output/curl --silent --location --output/' {} +

# Cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -rf src

# Build actual source
COPY src ./src
RUN touch src/main.rs && cargo build --release

# ─── Runtime Stage ────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

# wget is required by the Docker HEALTHCHECK (compose uses wget --spider).
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN useradd -r -s /bin/false -u 1001 appuser
USER appuser

WORKDIR /app
# Binary name matches [[bin]] name in Cargo.toml.
COPY --from=builder /app/target/release/tigerbeetle-bridge .

EXPOSE 8200

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --spider -q http://localhost:8200/health || exit 1

ENTRYPOINT ["./tigerbeetle-bridge"]
