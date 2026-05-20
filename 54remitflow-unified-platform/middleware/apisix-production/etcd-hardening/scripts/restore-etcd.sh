#!/bin/bash
# etcd disaster recovery script
# Restores etcd from a snapshot backup

set -e

if [ $# -lt 1 ]; then
    echo "Usage: $0 <backup-file>"
    echo "Example: $0 /backup/etcd-20241024-020000.db.gz"
    exit 1
fi

BACKUP_FILE=$1
CERT_DIR="/certs"
DATA_DIR="/bitnami/etcd"

echo "=== etcd Disaster Recovery Started at $(date) ==="

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo "Error: Backup file not found: $BACKUP_FILE"
    exit 1
fi

# Decompress if gzipped
if [[ $BACKUP_FILE == *.gz ]]; then
    echo "Decompressing backup..."
    gunzip -k $BACKUP_FILE
    BACKUP_FILE="${BACKUP_FILE%.gz}"
fi

# Verify snapshot
echo "Verifying snapshot..."
etcdctl snapshot status $BACKUP_FILE

# Stop etcd (if running)
echo "Stopping etcd..."
# In Docker: docker stop apisix-etcd-secure
# In Kubernetes: kubectl scale statefulset etcd --replicas=0 -n apisix

# Backup current data (just in case)
echo "Backing up current data..."
CURRENT_BACKUP="$DATA_DIR.backup-$(date +%Y%m%d-%H%M%S)"
if [ -d "$DATA_DIR" ]; then
    mv $DATA_DIR $CURRENT_BACKUP
    echo "Current data backed up to: $CURRENT_BACKUP"
fi

# Restore from snapshot
echo "Restoring from snapshot..."
etcdctl snapshot restore $BACKUP_FILE \
  --data-dir=$DATA_DIR \
  --name=etcd-0 \
  --initial-cluster=etcd-0=https://etcd-0.etcd:2380,etcd-1=https://etcd-1.etcd:2380,etcd-2=https://etcd-2.etcd:2380 \
  --initial-cluster-token=etcd-cluster-1 \
  --initial-advertise-peer-urls=https://etcd-0.etcd:2380

# Set proper permissions
echo "Setting permissions..."
chown -R 1001:1001 $DATA_DIR

# Start etcd
echo "Starting etcd..."
# In Docker: docker start apisix-etcd-secure
# In Kubernetes: kubectl scale statefulset etcd --replicas=3 -n apisix

# Wait for etcd to be ready
echo "Waiting for etcd to be ready..."
sleep 10

# Verify cluster health
echo "Verifying cluster health..."
etcdctl --endpoints=https://localhost:2379 \
  --cacert=$CERT_DIR/ca.pem \
  --cert=$CERT_DIR/etcd-client.pem \
  --key=$CERT_DIR/etcd-client-key.pem \
  --user=root:$ETCD_ROOT_PASSWORD \
  endpoint health

echo "=== etcd Disaster Recovery Completed at $(date) ==="
echo "Restored from: $BACKUP_FILE"
echo ""
echo "IMPORTANT: Verify APISIX configuration after restore!"
echo "  1. Check APISIX connectivity to etcd"
echo "  2. Verify routes and upstreams"
echo "  3. Test API gateway functionality"

