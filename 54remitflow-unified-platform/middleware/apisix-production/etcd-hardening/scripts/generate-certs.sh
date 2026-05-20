#!/bin/bash
# Generate TLS certificates for etcd cluster
# This script creates CA, server, and client certificates for secure etcd communication

set -e

CERT_DIR="../certs"
mkdir -p $CERT_DIR

echo "=== Generating etcd TLS Certificates ==="

# 1. Generate CA (Certificate Authority)
echo "1. Generating CA certificate..."
openssl genrsa -out $CERT_DIR/ca-key.pem 4096
openssl req -new -x509 -days 3650 -key $CERT_DIR/ca-key.pem \
  -out $CERT_DIR/ca.pem \
  -subj "/C=NG/ST=Lagos/L=Lagos/O=Remittance Platform/OU=Infrastructure/CN=etcd-ca"

# 2. Generate Server Certificate
echo "2. Generating server certificate..."
openssl genrsa -out $CERT_DIR/etcd-server-key.pem 4096
openssl req -new -key $CERT_DIR/etcd-server-key.pem \
  -out $CERT_DIR/etcd-server.csr \
  -subj "/C=NG/ST=Lagos/L=Lagos/O=Remittance Platform/OU=Infrastructure/CN=etcd-server"

# Create server certificate extensions
cat > $CERT_DIR/server-ext.cnf << EOF
subjectAltName = @alt_names
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = localhost
DNS.2 = etcd
DNS.3 = etcd-0.etcd
DNS.4 = etcd-1.etcd
DNS.5 = etcd-2.etcd
DNS.6 = *.etcd.apisix.svc.cluster.local
IP.1 = 127.0.0.1
IP.2 = ::1
EOF

openssl x509 -req -in $CERT_DIR/etcd-server.csr \
  -CA $CERT_DIR/ca.pem -CAkey $CERT_DIR/ca-key.pem -CAcreateserial \
  -out $CERT_DIR/etcd-server.pem -days 3650 \
  -extfile $CERT_DIR/server-ext.cnf

# 3. Generate Peer Certificate (for etcd cluster communication)
echo "3. Generating peer certificate..."
openssl genrsa -out $CERT_DIR/etcd-peer-key.pem 4096
openssl req -new -key $CERT_DIR/etcd-peer-key.pem \
  -out $CERT_DIR/etcd-peer.csr \
  -subj "/C=NG/ST=Lagos/L=Lagos/O=Remittance Platform/OU=Infrastructure/CN=etcd-peer"

# Create peer certificate extensions
cat > $CERT_DIR/peer-ext.cnf << EOF
subjectAltName = @alt_names
extendedKeyUsage = serverAuth, clientAuth

[alt_names]
DNS.1 = localhost
DNS.2 = etcd
DNS.3 = etcd-0.etcd
DNS.4 = etcd-1.etcd
DNS.5 = etcd-2.etcd
DNS.6 = *.etcd.apisix.svc.cluster.local
IP.1 = 127.0.0.1
IP.2 = ::1
EOF

openssl x509 -req -in $CERT_DIR/etcd-peer.csr \
  -CA $CERT_DIR/ca.pem -CAkey $CERT_DIR/ca-key.pem -CAcreateserial \
  -out $CERT_DIR/etcd-peer.pem -days 3650 \
  -extfile $CERT_DIR/peer-ext.cnf

# 4. Generate Client Certificate (for APISIX to connect to etcd)
echo "4. Generating client certificate..."
openssl genrsa -out $CERT_DIR/etcd-client-key.pem 4096
openssl req -new -key $CERT_DIR/etcd-client-key.pem \
  -out $CERT_DIR/etcd-client.csr \
  -subj "/C=NG/ST=Lagos/L=Lagos/O=Remittance Platform/OU=Infrastructure/CN=etcd-client"

openssl x509 -req -in $CERT_DIR/etcd-client.csr \
  -CA $CERT_DIR/ca.pem -CAkey $CERT_DIR/ca-key.pem -CAcreateserial \
  -out $CERT_DIR/etcd-client.pem -days 3650 \
  -extensions v3_req \
  -extfile <(cat <<EOF
[v3_req]
extendedKeyUsage = clientAuth
EOF
)

# 5. Set proper permissions
echo "5. Setting permissions..."
chmod 600 $CERT_DIR/*-key.pem
chmod 644 $CERT_DIR/*.pem

# 6. Verify certificates
echo "6. Verifying certificates..."
openssl verify -CAfile $CERT_DIR/ca.pem $CERT_DIR/etcd-server.pem
openssl verify -CAfile $CERT_DIR/ca.pem $CERT_DIR/etcd-peer.pem
openssl verify -CAfile $CERT_DIR/ca.pem $CERT_DIR/etcd-client.pem

echo "=== Certificate generation complete ==="
echo ""
echo "Generated certificates:"
echo "  CA: $CERT_DIR/ca.pem"
echo "  Server: $CERT_DIR/etcd-server.pem"
echo "  Peer: $CERT_DIR/etcd-peer.pem"
echo "  Client: $CERT_DIR/etcd-client.pem"
echo ""
echo "Copy these certificates to your etcd deployment:"
echo "  - For Docker: Mount as volumes"
echo "  - For Kubernetes: Create secrets"

