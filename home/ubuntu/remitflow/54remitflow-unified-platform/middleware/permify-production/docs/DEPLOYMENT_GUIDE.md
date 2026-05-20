# Permify Authorization System - Deployment Guide

Complete guide for deploying Permify authorization system in production environments.

## 📋 Table of Contents

- [Prerequisites](#prerequisites)
- [Docker Compose Deployment](#docker-compose-deployment)
- [Kubernetes Deployment](#kubernetes-deployment)
- [Database Setup](#database-setup)
- [Schema Migration](#schema-migration)
- [High Availability](#high-availability)
- [Monitoring Setup](#monitoring-setup)
- [Security Configuration](#security-configuration)
- [Backup and Recovery](#backup-and-recovery)
- [Performance Tuning](#performance-tuning)

## 🔧 Prerequisites

### System Requirements

**Minimum (Development)**:
- 2 CPU cores
- 4 GB RAM
- 20 GB storage
- Docker 20.10+
- Docker Compose 2.0+

**Recommended (Production)**:
- 8 CPU cores (16 for HA)
- 16 GB RAM (32 GB for HA)
- 100 GB SSD storage
- Kubernetes 1.25+
- PostgreSQL 15+

### Software Dependencies

- Python 3.11+
- PostgreSQL 15+
- Redis 7+ (optional, for caching)
- Prometheus 2.45+ (monitoring)
- Grafana 10+ (visualization)

## 🐳 Docker Compose Deployment

### Development Environment

```bash
# 1. Clone repository
git clone https://github.com/your-repo/permify-production.git
cd permify-production

# 2. Configure environment
cp .env.example .env
# Edit .env with your configuration

# 3. Start services
cd docker
docker-compose up -d

# 4. Verify deployment
docker-compose ps
docker-compose logs -f permify

# 5. Initialize schemas
python ../scripts/init_schemas.py
```

### Production Environment

```bash
# 1. Use production compose file
docker-compose -f docker-compose.prod.yml up -d

# 2. Verify all services
docker-compose -f docker-compose.prod.yml ps

# Expected output:
# permify-server-1    running    0.0.0.0:3476->3476/tcp
# permify-server-2    running    0.0.0.0:3477->3476/tcp
# permify-server-3    running    0.0.0.0:3478->3476/tcp
# postgres            running    0.0.0.0:5432->5432/tcp
# prometheus          running    0.0.0.0:9090->9090/tcp
# grafana             running    0.0.0.0:3000->3000/tcp
```

## ☸️ Kubernetes Deployment

### Prerequisites

```bash
# 1. Create namespace
kubectl create namespace permify-system

# 2. Create secrets
kubectl create secret generic permify-secrets \
  --from-literal=postgres-password=YOUR_PASSWORD \
  --from-literal=api-key=YOUR_API_KEY \
  -n permify-system

# 3. Create ConfigMap
kubectl create configmap permify-config \
  --from-file=permify.yaml=config/permify.yaml \
  -n permify-system
```

### Deploy Permify

```bash
# 1. Apply deployment manifests
kubectl apply -f kubernetes/permify-deployment.yaml

# 2. Verify deployment
kubectl get pods -n permify-system
kubectl get svc -n permify-system

# 3. Check logs
kubectl logs -n permify-system -l app=permify-server --tail=100

# 4. Port forward for testing
kubectl port-forward -n permify-system svc/permify-service 3476:3476
```

### Scaling

```bash
# Scale Permify servers
kubectl scale deployment permify-server -n permify-system --replicas=5

# Verify scaling
kubectl get pods -n permify-system -l app=permify-server
```

## 🗄️ Database Setup

### PostgreSQL Configuration

```sql
-- 1. Create database and user
CREATE DATABASE permify;
CREATE USER permify WITH ENCRYPTED PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE permify TO permify;

-- 2. Enable required extensions
\c permify
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- 3. Configure connection pooling
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET shared_buffers = '4GB';
ALTER SYSTEM SET effective_cache_size = '12GB';
ALTER SYSTEM SET work_mem = '64MB';

-- Reload configuration
SELECT pg_reload_conf();
```

### Database Replication (HA)

```bash
# Primary server (postgresql.conf)
wal_level = replica
max_wal_senders = 3
wal_keep_size = 1GB
hot_standby = on

# Standby server (recovery.conf)
standby_mode = 'on'
primary_conninfo = 'host=primary-db port=5432 user=replicator password=password'
trigger_file = '/tmp/postgresql.trigger.5432'
```

## 📦 Schema Migration

### Initialize Schemas

```bash
# 1. Upload schema files
python scripts/upload_schemas.py \
  --schema-dir schemas/ \
  --permify-url http://localhost:3476 \
  --tenant-id remittance-platform

# 2. Verify schemas
curl http://localhost:3476/v1/tenants/remittance-platform/schemas
```

### Update Schemas

```bash
# 1. Validate new schema
python scripts/validate_schema.py schemas/remittance-platform-v2.perm

# 2. Upload new version
python scripts/upload_schemas.py \
  --schema-file schemas/remittance-platform-v2.perm \
  --version v2

# 3. Verify migration
python scripts/test_schema.py --version v2
```

## 🔄 High Availability

### Architecture

```
                    ┌─────────────┐
                    │   Load      │
                    │  Balancer   │
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    ┌────▼────┐       ┌────▼────┐      ┌────▼────┐
    │ Permify │       │ Permify │      │ Permify │
    │ Server 1│       │ Server 2│      │ Server 3│
    └────┬────┘       └────┬────┘      └────┬────┘
         │                 │                 │
         └─────────────────┼─────────────────┘
                           │
                    ┌──────▼──────┐
                    │  PostgreSQL │
                    │   Primary   │
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    ┌────▼────┐       ┌────▼────┐      ┌────▼────┐
    │  Standby│       │  Standby│      │  Standby│
    │    1    │       │    2    │      │    3    │
    └─────────┘       └─────────┘      └─────────┘
```

### Load Balancer Configuration (Nginx)

```nginx
upstream permify_backend {
    least_conn;
    server permify-server-1:3476 max_fails=3 fail_timeout=30s;
    server permify-server-2:3476 max_fails=3 fail_timeout=30s;
    server permify-server-3:3476 max_fails=3 fail_timeout=30s;
}

server {
    listen 80;
    server_name permify.example.com;

    location / {
        proxy_pass http://permify_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_connect_timeout 30s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }

    location /healthz {
        proxy_pass http://permify_backend/healthz;
        access_log off;
    }
}
```

## 📊 Monitoring Setup

### Prometheus Configuration

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'permify'
    static_configs:
      - targets: ['permify-server-1:9090', 'permify-server-2:9090', 'permify-server-3:9090']
    metrics_path: '/metrics'

  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres-exporter:9187']
```

### Grafana Dashboards

```bash
# Import dashboards
curl -X POST http://admin:password@localhost:3000/api/dashboards/import \
  -H "Content-Type: application/json" \
  -d @monitoring/grafana-dashboards.json
```

### Alerts

```yaml
# alerts.yml
groups:
  - name: permify_alerts
    rules:
      - alert: PermifyServerDown
        expr: up{job="permify"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Permify server {{ $labels.instance }} is down"

      - alert: HighErrorRate
        expr: rate(permify_errors_total[5m]) > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High error rate on {{ $labels.instance }}"

      - alert: SlowPermissionChecks
        expr: histogram_quantile(0.95, rate(permify_permission_check_duration_seconds_bucket[5m])) > 0.5
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Slow permission checks on {{ $labels.instance }}"
```

## 🔒 Security Configuration

### TLS/mTLS Setup

```bash
# 1. Generate certificates
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# 2. Configure Permify for TLS
# permify.yaml
server:
  http:
    tls:
      enabled: true
      cert: /certs/cert.pem
      key: /certs/key.pem
  grpc:
    tls:
      enabled: true
      cert: /certs/cert.pem
      key: /certs/key.pem

# 3. Mount certificates in Docker
docker run -v /path/to/certs:/certs permify/permify
```

### API Key Rotation

```bash
# 1. Generate new API key
NEW_API_KEY=$(openssl rand -hex 32)

# 2. Update Kubernetes secret
kubectl create secret generic permify-secrets-new \
  --from-literal=api-key=$NEW_API_KEY \
  -n permify-system

# 3. Rolling update
kubectl set env deployment/permify-server \
  PERMIFY_API_KEY=$NEW_API_KEY \
  -n permify-system

# 4. Update clients
# Update .env files and restart services
```

## 💾 Backup and Recovery

### Database Backup

```bash
# Daily backup script
#!/bin/bash
BACKUP_DIR=/backups
DATE=$(date +%Y%m%d_%H%M%S)

# Full backup
pg_dump -h localhost -U permify -d permify \
  -F c -f $BACKUP_DIR/permify_$DATE.dump

# Compress
gzip $BACKUP_DIR/permify_$DATE.dump

# Retention (keep 30 days)
find $BACKUP_DIR -name "*.dump.gz" -mtime +30 -delete
```

### Restore from Backup

```bash
# 1. Stop Permify servers
kubectl scale deployment permify-server --replicas=0 -n permify-system

# 2. Restore database
gunzip -c /backups/permify_20240101_120000.dump.gz | \
  pg_restore -h localhost -U permify -d permify --clean

# 3. Restart Permify servers
kubectl scale deployment permify-server --replicas=3 -n permify-system

# 4. Verify
kubectl logs -n permify-system -l app=permify-server
```

## ⚡ Performance Tuning

### Client Configuration

```python
# Optimized client configuration
client = PermifyClient(
    base_url="http://permify.example.com",
    api_key=os.getenv("PERMIFY_API_KEY"),
    tenant_id="remittance-platform",
    enable_cache=True,
    cache_ttl=300,  # 5 minutes
    enable_circuit_breaker=True,
    circuit_breaker_threshold=5,
    circuit_breaker_timeout=60,
    max_connections=100,
    timeout=30
)
```

### Database Optimization

```sql
-- Create indexes for common queries
CREATE INDEX idx_relationships_entity ON relationships(entity_type, entity_id);
CREATE INDEX idx_relationships_subject ON relationships(subject_type, subject_id);
CREATE INDEX idx_relationships_relation ON relationships(relation);

-- Analyze tables
ANALYZE relationships;
ANALYZE schemas;

-- Vacuum
VACUUM ANALYZE;
```

### Caching Strategy

```python
# Multi-layer caching
# 1. Application cache (in-memory)
# 2. Redis cache (shared)
# 3. Permify cache (server-side)

from redis import Redis

redis_client = Redis(host='redis', port=6379, db=0)

async def check_permission_with_cache(user_id, entity_type, entity_id, permission):
    # Check Redis cache first
    cache_key = f"perm:{user_id}:{entity_type}:{entity_id}:{permission}"
    cached = redis_client.get(cache_key)
    
    if cached:
        return cached == b'1'
    
    # Check Permify
    result = await client.check_permission(...)
    
    # Cache result
    redis_client.setex(cache_key, 300, '1' if result.can == PermissionResult.ALLOWED else '0')
    
    return result.can == PermissionResult.ALLOWED
```

## 🧪 Testing Deployment

### Health Checks

```bash
# Permify server
curl http://localhost:3476/healthz

# Database
curl http://localhost:3476/healthz/db

# Metrics
curl http://localhost:9090/metrics
```

### Load Testing

```bash
# Using Apache Bench
ab -n 10000 -c 100 -p permission_check.json \
  -T application/json \
  http://localhost:3476/v1/tenants/remittance-platform/permissions/check

# Using k6
k6 run scripts/load_test.js
```

## 📝 Post-Deployment Checklist

- [ ] All services running and healthy
- [ ] Database replication working
- [ ] Schemas uploaded and validated
- [ ] Monitoring dashboards accessible
- [ ] Alerts configured and tested
- [ ] Backups configured and tested
- [ ] TLS certificates valid
- [ ] API keys rotated
- [ ] Load balancer configured
- [ ] Performance benchmarks met
- [ ] Documentation updated
- [ ] Team trained on operations

## 🆘 Troubleshooting

### Common Issues

**Issue**: Permify server not starting

```bash
# Check logs
docker-compose logs permify

# Common causes:
# - Database connection failed
# - Invalid configuration
# - Port already in use
```

**Issue**: Slow permission checks

```bash
# Check database performance
SELECT * FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10;

# Check Permify metrics
curl http://localhost:9090/metrics | grep permission_check_duration
```

**Issue**: High memory usage

```bash
# Check container stats
docker stats

# Adjust memory limits in docker-compose.yml
services:
  permify:
    mem_limit: 2g
```

## 📞 Support

For deployment issues:
- Email: ops@remittance-platform.com
- Slack: #permify-ops
- On-call: +234-XXX-XXXX-XXX

