#!/bin/bash
# etcd Performance Optimization Script
# Applies performance tuning and maintenance operations

set -e

ETCD_ENDPOINTS="https://localhost:2379"
CERT_DIR="../certs"
CA_CERT="$CERT_DIR/ca.pem"
CLIENT_CERT="$CERT_DIR/etcd-client.pem"
CLIENT_KEY="$CERT_DIR/etcd-client-key.pem"

# etcdctl command with TLS and auth
ETCDCTL="etcdctl --endpoints=$ETCD_ENDPOINTS --cacert=$CA_CERT --cert=$CLIENT_CERT --key=$CLIENT_KEY --user=root:$ETCD_ROOT_PASSWORD"

echo "=== etcd Performance Optimization Started at $(date) ==="

# 1. Check current status
echo "1. Checking current status..."
$ETCDCTL endpoint status --write-out=table

# 2. Defragment database
echo "2. Defragmenting database..."
for endpoint in $(echo $ETCD_ENDPOINTS | tr ',' ' '); do
    echo "Defragmenting $endpoint..."
    $ETCDCTL --endpoints=$endpoint defrag
done

# 3. Compact history
echo "3. Compacting history..."
REV=$($ETCDCTL endpoint status --write-out="json" | jq -r '.[0].Status.header.revision')
echo "Current revision: $REV"
$ETCDCTL compact $REV
echo "Compacted to revision: $REV"

# 4. Check database size
echo "4. Checking database size..."
$ETCDCTL endpoint status --write-out=table

# 5. Alarm list (check for space alarms)
echo "5. Checking for alarms..."
$ETCDCTL alarm list

# 6. Check member list
echo "6. Checking cluster members..."
$ETCDCTL member list --write-out=table

# 7. Performance metrics
echo "7. Collecting performance metrics..."
echo "Latency:"
$ETCDCTL check perf --load="s" --duration=10s

# 8. Database size optimization
echo "8. Database size information..."
DB_SIZE=$($ETCDCTL endpoint status --write-out="json" | jq -r '.[0].Status.dbSize')
DB_SIZE_MB=$((DB_SIZE / 1024 / 1024))
echo "Database size: ${DB_SIZE_MB}MB"

QUOTA=$($ETCDCTL endpoint status --write-out="json" | jq -r '.[0].Status.dbSizeInUse')
QUOTA_MB=$((QUOTA / 1024 / 1024))
echo "Quota in use: ${QUOTA_MB}MB"

# 9. Check for slow operations
echo "9. Checking for slow operations..."
# This requires access to etcd logs
# grep "slow" /var/log/etcd/etcd.log | tail -20

# 10. Recommendations
echo "10. Performance recommendations..."
if [ $DB_SIZE_MB -gt 4000 ]; then
    echo "WARNING: Database size is large (${DB_SIZE_MB}MB). Consider:"
    echo "  - Increasing compaction frequency"
    echo "  - Reducing snapshot count"
    echo "  - Checking for data growth issues"
fi

USAGE_PERCENT=$((QUOTA_MB * 100 / 8192))
if [ $USAGE_PERCENT -gt 80 ]; then
    echo "WARNING: Quota usage is high (${USAGE_PERCENT}%). Consider:"
    echo "  - Increasing quota-backend-bytes"
    echo "  - Running defragmentation more frequently"
fi

echo "=== etcd Performance Optimization Completed at $(date) ==="

