#!/bin/bash
# Automated etcd backup script
# Runs daily to create snapshots and manage retention

set -e

ETCD_ENDPOINTS="https://etcd:2379"
CERT_DIR="/certs"
BACKUP_DIR="/backup"
RETENTION_DAYS=30

# Timestamp for backup file
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/etcd-$TIMESTAMP.db"

echo "=== etcd Backup Started at $(date) ==="

# Create snapshot
echo "Creating snapshot..."
etcdctl --endpoints=$ETCD_ENDPOINTS \
  --cacert=$CERT_DIR/ca.pem \
  --cert=$CERT_DIR/etcd-client.pem \
  --key=$CERT_DIR/etcd-client-key.pem \
  --user=backup:$BACKUP_PASSWORD \
  snapshot save $BACKUP_FILE

# Verify snapshot
echo "Verifying snapshot..."
etcdctl --write-out=table snapshot status $BACKUP_FILE

# Get snapshot size
BACKUP_SIZE=$(du -h $BACKUP_FILE | cut -f1)
echo "Backup size: $BACKUP_SIZE"

# Compress backup
echo "Compressing backup..."
gzip $BACKUP_FILE
COMPRESSED_FILE="$BACKUP_FILE.gz"

# Upload to S3 (optional - uncomment if using S3)
# echo "Uploading to S3..."
# aws s3 cp $COMPRESSED_FILE s3://your-bucket/etcd-backups/

# Clean up old backups
echo "Cleaning up old backups (keeping last $RETENTION_DAYS days)..."
find $BACKUP_DIR -name "etcd-*.db.gz" -mtime +$RETENTION_DAYS -delete

# Count remaining backups
BACKUP_COUNT=$(find $BACKUP_DIR -name "etcd-*.db.gz" | wc -l)
echo "Total backups: $BACKUP_COUNT"

echo "=== etcd Backup Completed at $(date) ==="
echo "Backup file: $COMPRESSED_FILE"

