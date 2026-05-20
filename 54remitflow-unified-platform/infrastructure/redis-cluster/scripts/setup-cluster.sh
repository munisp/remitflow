#!/bin/bash
# Redis Cluster Setup Script

set -e

REDIS_NODES=(
    "127.0.0.1:7000"
    "127.0.0.1:7001"
    "127.0.0.1:7002"
    "127.0.0.1:7003"
    "127.0.0.1:7004"
    "127.0.0.1:7005"
)

echo "Starting Redis Cluster Setup..."

# Create cluster
redis-cli --cluster create ${REDIS_NODES[@]} \
    --cluster-replicas 1 \
    --cluster-yes

echo "Redis cluster created successfully!"

# Verify cluster
echo "Verifying cluster status..."
redis-cli -c -p 7000 cluster nodes

echo "Cluster setup complete!"
