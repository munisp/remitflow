#!/usr/bin/env bash
set -euo pipefail

# Installs Helm into a caller-controlled temporary directory after validating the
# official release checksum. This is for local/CI manifest rendering only.
HELM_VERSION="${HELM_VERSION:-v3.17.3}"
DESTINATION="${HELM_VALIDATION_BIN_DIR:-/tmp/remitflow-cilium-tools/bin}"
ARCHIVE_DIR="$(mktemp -d)"
trap 'rm -rf "$ARCHIVE_DIR"' EXIT

mkdir -p "$DESTINATION"
ARCHIVE="helm-${HELM_VERSION}-linux-amd64.tar.gz"
BASE_URL="https://get.helm.sh/${ARCHIVE}"

curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 \
  -o "$ARCHIVE_DIR/$ARCHIVE" "$BASE_URL"
curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 \
  -o "$ARCHIVE_DIR/${ARCHIVE}.sha256sum" "${BASE_URL}.sha256sum"

(
  cd "$ARCHIVE_DIR"
  sha256sum --check "${ARCHIVE}.sha256sum"
)

tar --extract --gzip --file "$ARCHIVE_DIR/$ARCHIVE" --directory "$ARCHIVE_DIR" linux-amd64/helm
install -m 0755 "$ARCHIVE_DIR/linux-amd64/helm" "$DESTINATION/helm"
"$DESTINATION/helm" version --short
