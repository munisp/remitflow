#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# RemitFlow — mTLS Certificate Generation Script
#
# Generates a self-signed CA and per-service TLS certificates for:
#   - transfer-engine (gRPC :50051)
#   - aml-engine      (gRPC :50052)
#   - ledger-service  (gRPC :50053)
#   - fraud-ml        (gRPC :50054)
#
# Usage:
#   ./scripts/generate-mtls-certs.sh [output_dir]
#
# Output:
#   certs/
#     ca/         CA key + cert
#     server/     Per-service server certs
#     client/     Client cert for the Node.js app to authenticate to gRPC services
#
# Requirements: openssl 1.1+
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CERTS_DIR="${1:-$(dirname "$0")/certs}"
CA_DIR="$CERTS_DIR/ca"
SERVER_DIR="$CERTS_DIR/server"
CLIENT_DIR="$CERTS_DIR/client"

DAYS=3650
KEY_BITS=4096
SERVICES=("transfer-engine" "aml-engine" "ledger-service" "fraud-ml")

echo "🔐 RemitFlow mTLS Certificate Generator"
echo "   Output directory: $CERTS_DIR"
echo ""

mkdir -p "$CA_DIR" "$SERVER_DIR" "$CLIENT_DIR"

# ─── 1. Certificate Authority ─────────────────────────────────────────────────
echo "→ Generating CA key and self-signed certificate..."
openssl genrsa -out "$CA_DIR/ca.key" $KEY_BITS 2>/dev/null
openssl req -new -x509 -days $DAYS \
  -key "$CA_DIR/ca.key" \
  -out "$CA_DIR/ca.crt" \
  -subj "/C=NG/ST=Lagos/L=Lagos/O=RemitFlow/OU=Platform/CN=RemitFlow-CA" \
  -extensions v3_ca 2>/dev/null
echo "   ✓ CA: $CA_DIR/ca.crt"

# ─── 2. Server Certificates (one per gRPC service) ────────────────────────────
for SERVICE in "${SERVICES[@]}"; do
  echo "→ Generating server cert for $SERVICE..."
  openssl genrsa -out "$SERVER_DIR/$SERVICE.key" $KEY_BITS 2>/dev/null

  # CSR with SAN for both Docker hostname and localhost
  openssl req -new \
    -key "$SERVER_DIR/$SERVICE.key" \
    -out "$SERVER_DIR/$SERVICE.csr" \
    -subj "/C=NG/ST=Lagos/L=Lagos/O=RemitFlow/OU=Services/CN=$SERVICE" 2>/dev/null

  # Sign with CA, add SAN
  openssl x509 -req -days $DAYS \
    -in "$SERVER_DIR/$SERVICE.csr" \
    -CA "$CA_DIR/ca.crt" \
    -CAkey "$CA_DIR/ca.key" \
    -CAcreateserial \
    -out "$SERVER_DIR/$SERVICE.crt" \
    -extfile <(printf "subjectAltName=DNS:%s,DNS:localhost,IP:127.0.0.1" "$SERVICE") 2>/dev/null

  rm "$SERVER_DIR/$SERVICE.csr"
  echo "   ✓ $SERVER_DIR/$SERVICE.crt"
done

# ─── 3. Client Certificate (for Node.js app) ──────────────────────────────────
echo "→ Generating client certificate for Node.js app..."
openssl genrsa -out "$CLIENT_DIR/client.key" $KEY_BITS 2>/dev/null
openssl req -new \
  -key "$CLIENT_DIR/client.key" \
  -out "$CLIENT_DIR/client.csr" \
  -subj "/C=NG/ST=Lagos/L=Lagos/O=RemitFlow/OU=API/CN=remitflow-api" 2>/dev/null
openssl x509 -req -days $DAYS \
  -in "$CLIENT_DIR/client.csr" \
  -CA "$CA_DIR/ca.crt" \
  -CAkey "$CA_DIR/ca.key" \
  -CAcreateserial \
  -out "$CLIENT_DIR/client.crt" \
  -extfile <(printf "extendedKeyUsage=clientAuth") 2>/dev/null
rm "$CLIENT_DIR/client.csr"
echo "   ✓ $CLIENT_DIR/client.crt"

# ─── 4. Verify certificates ───────────────────────────────────────────────────
echo ""
echo "→ Verifying certificates against CA..."
for SERVICE in "${SERVICES[@]}"; do
  openssl verify -CAfile "$CA_DIR/ca.crt" "$SERVER_DIR/$SERVICE.crt" 2>/dev/null
done
openssl verify -CAfile "$CA_DIR/ca.crt" "$CLIENT_DIR/client.crt" 2>/dev/null

# ─── 5. Summary ───────────────────────────────────────────────────────────────
echo ""
echo "✅ mTLS certificates generated successfully!"
echo ""
echo "   CA certificate:     $CA_DIR/ca.crt"
echo "   Client cert/key:    $CLIENT_DIR/client.{crt,key}"
echo ""
echo "   Service certificates:"
for SERVICE in "${SERVICES[@]}"; do
  echo "     $SERVICE: $SERVER_DIR/$SERVICE.{crt,key}"
done
echo ""
echo "   Next steps:"
echo "   1. Mount certs into Docker containers via volumes"
echo "   2. Create k8s TLS secrets: kubectl create secret tls remitflow-<service>-tls \\"
echo "        --cert=certs/server/<service>.crt --key=certs/server/<service>.key -n remitflow"
echo "   3. Update Go services to use tls.LoadX509KeyPair() with Tonic TLS feature"
echo "   4. Update Rust services to use rustls with the CA cert"
echo "   5. Update Node.js grpc client to use credentials.createSsl()"
echo ""
echo "   ⚠️  These are self-signed certs for internal service mesh use only."
echo "      For public-facing TLS, use cert-manager + Let's Encrypt."
