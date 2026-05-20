#!/bin/bash
# Setup etcd authentication and RBAC
# This script configures users, roles, and permissions for secure etcd access

set -e

ETCD_ENDPOINTS="https://localhost:2379"
CERT_DIR="../certs"
CA_CERT="$CERT_DIR/ca.pem"
CLIENT_CERT="$CERT_DIR/etcd-client.pem"
CLIENT_KEY="$CERT_DIR/etcd-client-key.pem"

# etcdctl command with TLS
ETCDCTL="etcdctl --endpoints=$ETCD_ENDPOINTS --cacert=$CA_CERT --cert=$CLIENT_CERT --key=$CLIENT_KEY"

echo "=== Setting up etcd Authentication and RBAC ==="

# 1. Create root user
echo "1. Creating root user..."
echo "$ETCD_ROOT_PASSWORD" | $ETCDCTL user add root --interactive=false || echo "Root user already exists"

# 2. Create service users
echo "2. Creating service users..."

# APISIX user (full access to /apisix prefix)
echo "$APISIX_PASSWORD" | $ETCDCTL user add apisix --interactive=false || echo "APISIX user already exists"

# Backup user (read-only access)
echo "$BACKUP_PASSWORD" | $ETCDCTL user add backup --interactive=false || echo "Backup user already exists"

# Monitoring user (read-only access)
echo "$MONITORING_PASSWORD" | $ETCDCTL user add monitoring --interactive=false || echo "Monitoring user already exists"

# 3. Create roles
echo "3. Creating roles..."

# Admin role (full access)
$ETCDCTL role add admin || echo "Admin role already exists"
$ETCDCTL role grant-permission admin readwrite --prefix=true ''

# APISIX role (read/write to /apisix prefix)
$ETCDCTL role add apisix-role || echo "APISIX role already exists"
$ETCDCTL role grant-permission apisix-role readwrite --prefix=true '/apisix/'

# Backup role (read-only access)
$ETCDCTL role add backup-role || echo "Backup role already exists"
$ETCDCTL role grant-permission backup-role read --prefix=true ''

# Monitoring role (read-only access)
$ETCDCTL role add monitoring-role || echo "Monitoring role already exists"
$ETCDCTL role grant-permission monitoring-role read --prefix=true ''

# 4. Assign roles to users
echo "4. Assigning roles to users..."
$ETCDCTL user grant-role root admin
$ETCDCTL user grant-role apisix apisix-role
$ETCDCTL user grant-role backup backup-role
$ETCDCTL user grant-role monitoring monitoring-role

# 5. Enable authentication
echo "5. Enabling authentication..."
$ETCDCTL auth enable || echo "Authentication already enabled"

echo "=== Authentication and RBAC setup complete ==="
echo ""
echo "Created users:"
echo "  - root (admin role)"
echo "  - apisix (apisix-role)"
echo "  - backup (backup-role)"
echo "  - monitoring (monitoring-role)"
echo ""
echo "IMPORTANT: Save these credentials securely!"
echo "  Root password: $ETCD_ROOT_PASSWORD"
echo "  APISIX password: $APISIX_PASSWORD"
echo "  Backup password: $BACKUP_PASSWORD"
echo "  Monitoring password: $MONITORING_PASSWORD"

