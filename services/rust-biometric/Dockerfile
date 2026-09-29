# rust:slim-trixie (Debian 13): the prebuilt ONNX Runtime static library
# fetched by ort-sys at build time requires libstdc++ GLIBCXX_3.4.31+ and
# glibc 2.38+ symbols (Debian 12 bookworm is too old and fails at link time).
FROM rust:slim-trixie AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev gcc binutils && rm -rf /var/lib/apt/lists/*
# Dependency layer: manifests + vendored C decoder (compiled by build.rs)
COPY Cargo.toml Cargo.lock* build.rs ./
COPY csrc ./csrc
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
RUN touch src/main.rs build.rs && cargo build --release

# distroless/cc-debian13 ships libstdc++ 6.0.33 / glibc 2.41 (required by the
# statically-linked ONNX Runtime build). Model weights are NOT baked in —
# mount them and set YUNET_MODEL_PATH / ADAFACE_MODEL_PATH (or
# SFACE_MODEL_PATH with FACE_MODEL=sface). The service refuses to boot
# without them (fail closed).
FROM gcr.io/distroless/cc-debian13:nonroot
COPY --from=builder /app/target/release/rust-biometric /usr/local/bin/rust-biometric
EXPOSE 8149
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/usr/local/bin/rust-biometric", "--health-check"] || exit 1
USER nonroot
ENTRYPOINT ["/usr/local/bin/rust-biometric"]
