# syntax=docker/dockerfile:1
FROM golang:1.25-bookworm AS go_toolchain
FROM rust:1.94-bookworm AS rust_toolchain

FROM node:22-bookworm

COPY --from=go_toolchain /usr/local/go /usr/local/go
COPY --from=rust_toolchain /usr/local/cargo /usr/local/cargo
COPY --from=rust_toolchain /usr/local/rustup /usr/local/rustup

ENV PATH="/usr/local/go/bin:/usr/local/cargo/bin:${PATH}" \
    RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv python3-dev \
      build-essential pkg-config libssl-dev libffi-dev \
      git curl jq ca-certificates \
      postgresql-client redis-tools \
      lua5.4 \
    && npm install --global pnpm@10.4.1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
USER node

CMD ["bash"]
