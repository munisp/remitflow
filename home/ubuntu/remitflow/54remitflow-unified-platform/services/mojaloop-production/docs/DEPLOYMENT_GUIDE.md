# Mojaloop Production Deployment Guide

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Infrastructure Setup](#infrastructure-setup)
3. [Docker Compose Deployment](#docker-compose-deployment)
4. [Kubernetes Deployment](#kubernetes-deployment)
5. [Configuration](#configuration)
6. [Monitoring Setup](#monitoring-setup)
7. [Security Hardening](#security-hardening)
8. [Backup and Recovery](#backup-and-recovery)
9. [Scaling](#scaling)
10. [Troubleshooting](#troubleshooting)

## Prerequisites

### System Requirements

**Minimum (Development)**:
- CPU: 4 cores
- RAM: 8 GB
- Storage: 50 GB SSD
- OS: Ubuntu 22.04 LTS

**Recommended (Production)**:
- CPU: 16 cores
- RAM: 32 GB
- Storage: 500 GB SSD (RAID 10)
- OS: Ubuntu 22.04 LTS

### Software Requirements

```bash
# Docker
Docker Engine 24.0+
Docker Compose 2.20+

# Kubernetes (for production)
Kubernetes 1.28+
kubectl 1.28+
Helm 3.12+

# Database
PostgreSQL 15+
Redis 7.0+

# Messaging
Apache Kafka 3.5+

# Python
Python 3.11+
pip 23.0+
```

## Infrastructure Setup

### 1. Install Docker

```bash
# Update system
sudo apt-get update
sudo apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Verify installation
docker --version
docker-compose --version
```

### 2. Install Kubernetes (Production)

```bash
# Install kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl

# Install Helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Verify installation
kubectl version --client
helm version
```

### 3. Network Configuration

```bash
# Configure firewall
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw allow 5432/tcp    # PostgreSQL
sudo ufw allow 6379/tcp    # Redis
sudo ufw allow 9092/tcp    # Kafka
sudo ufw allow 9090/tcp    # Prometheus
sudo ufw allow 3000/tcp    # Grafana
sudo ufw enable

# Configure DNS
# Add DNS records for your domain
# mojaloop.example.com -> <server-ip>
# api.mojaloop.example.com -> <server-ip>
```

## Docker Compose Deployment

### 1. Clone Repository

```bash
cd /opt
git clone https://github.com/your-org/mojaloop-production.git
cd mojaloop-production
```

### 2. Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit configuration
nano .env
```

**Environment Variables**:

```bash
# Application
APP_ENV=production
APP_DEBUG=false
LOG_LEVEL=info

# Database
DATABASE_HOST=postgres
DATABASE_PORT=5432
DATABASE_NAME=mojaloop
DATABASE_USER=mojaloop
DATABASE_PASSWORD=<strong-password>
DATABASE_POOL_MIN=10
DATABASE_POOL_MAX=50

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=<strong-password>
REDIS_DB=0

# Kafka
KAFKA_BOOTSTRAP_SERVERS=kafka:9092
KAFKA_TOPIC_PREFIX=mojaloop

# Temporal
TEMPORAL_HOST=temporal
TEMPORAL_PORT=7233

# Permify
PERMIFY_URL=http://permify:3476

# Monitoring
PROMETHEUS_PORT=9090
GRAFANA_PORT=3000
GRAFANA_ADMIN_PASSWORD=<strong-password>

# Security
JWT_SECRET=<random-secret>
ENCRYPTION_KEY=<random-key>
```

### 3. Start Services

```bash
cd docker

# Pull images
docker-compose pull

# Start services
docker-compose up -d

# Verify services
docker-compose ps

# Check logs
docker-compose logs -f
```

### 4. Initialize Database

```bash
# Run migrations
docker-compose exec mojaloop-switch python -m alembic upgrade head

# Seed initial data
docker-compose exec mojaloop-switch python -m scripts.seed_data
```

### 5. Verify Deployment

```bash
# Health check
curl http://localhost:8080/health

# Metrics
curl http://localhost:9090/metrics

# Grafana
open http://localhost:3000
```

## Kubernetes Deployment

### 1. Create Namespace

```bash
kubectl create namespace mojaloop
kubectl config set-context --current --namespace=mojaloop
```

### 2. Create Secrets

```bash
# Database credentials
kubectl create secret generic mojaloop-db-secret \
  --from-literal=username=mojaloop \
  --from-literal=password=<strong-password>

# Redis credentials
kubectl create secret generic mojaloop-redis-secret \
  --from-literal=password=<strong-password>

# JWT secret
kubectl create secret generic mojaloop-jwt-secret \
  --from-literal=secret=<random-secret>
```

### 3. Deploy PostgreSQL

```bash
# Apply StatefulSet
kubectl apply -f kubernetes/postgres-statefulset.yaml

# Verify deployment
kubectl get statefulsets
kubectl get pods -l app=postgres

# Initialize database
kubectl exec -it postgres-0 -- psql -U mojaloop -d mojaloop -f /docker-entrypoint-initdb.d/init.sql
```

### 4. Deploy Redis

```bash
# Apply Deployment
kubectl apply -f kubernetes/redis-deployment.yaml

# Verify deployment
kubectl get deployments
kubectl get pods -l app=redis
```

### 5. Deploy Kafka

```bash
# Apply StatefulSet
kubectl apply -f kubernetes/kafka-statefulset.yaml

# Verify deployment
kubectl get statefulsets
kubectl get pods -l app=kafka
```

### 6. Deploy Mojaloop Services

```bash
# Apply Deployment
kubectl apply -f kubernetes/mojaloop-deployment.yaml

# Verify deployment
kubectl get deployments
kubectl get pods -l app=mojaloop-switch

# Check logs
kubectl logs -f deployment/mojaloop-switch
```

### 7. Deploy Monitoring

```bash
# Deploy Prometheus
kubectl apply -f kubernetes/prometheus-deployment.yaml

# Deploy Grafana
kubectl apply -f kubernetes/grafana-deployment.yaml

# Verify deployment
kubectl get pods -l app=prometheus
kubectl get pods -l app=grafana
```

### 8. Configure Ingress

```bash
# Apply Ingress
kubectl apply -f kubernetes/ingress.yaml

# Verify ingress
kubectl get ingress

# Test access
curl https://api.mojaloop.example.com/health
```

## Configuration

### Database Tuning

**PostgreSQL Configuration** (`postgresql.conf`):

```ini
# Connection settings
max_connections = 200
shared_buffers = 8GB
effective_cache_size = 24GB
maintenance_work_mem = 2GB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1
effective_io_concurrency = 200
work_mem = 20MB
min_wal_size = 2GB
max_wal_size = 8GB
```

### Redis Tuning

**Redis Configuration** (`redis.conf`):

```ini
# Memory
maxmemory 4gb
maxmemory-policy allkeys-lru

# Persistence
save 900 1
save 300 10
save 60 10000

# Performance
tcp-backlog 511
timeout 0
tcp-keepalive 300
```

### Kafka Tuning

**Kafka Configuration** (`server.properties`):

```ini
# Broker settings
num.network.threads=8
num.io.threads=16
socket.send.buffer.bytes=102400
socket.receive.buffer.bytes=102400
socket.request.max.bytes=104857600

# Log settings
num.partitions=3
num.recovery.threads.per.data.dir=1
log.retention.hours=168
log.segment.bytes=1073741824
log.retention.check.interval.ms=300000
```

## Monitoring Setup

### Prometheus Configuration

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'mojaloop'
    static_configs:
      - targets: ['mojaloop-switch:9090']
```

### Grafana Dashboards

1. Access Grafana: `http://localhost:3000`
2. Login with admin credentials
3. Add Prometheus datasource
4. Import dashboards from `/monitoring/dashboards/`

### Alerting

**Alert Rules** (`alerts/mojaloop.yml`):

```yaml
groups:
  - name: mojaloop_alerts
    rules:
      - alert: HighErrorRate
        expr: rate(mojaloop_errors_total[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High error rate detected"
      
      - alert: SlowTransfers
        expr: histogram_quantile(0.99, mojaloop_transfer_processing_duration_seconds) > 5
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Slow transfer processing detected"
```

## Security Hardening

### 1. Enable TLS/SSL

```bash
# Generate certificates
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/mojaloop.key \
  -out /etc/ssl/certs/mojaloop.crt

# Update configuration
# Add TLS configuration to docker-compose.yml or Kubernetes manifests
```

### 2. Configure Authentication

```bash
# Enable JWT authentication
# Update .env with JWT_SECRET

# Configure Permify authorization
# Apply Permify schemas
```

### 3. Network Security

```bash
# Configure network policies (Kubernetes)
kubectl apply -f kubernetes/network-policies.yaml

# Enable pod security policies
kubectl apply -f kubernetes/pod-security-policies.yaml
```

## Backup and Recovery

### Database Backup

```bash
# Automated backup script
#!/bin/bash
BACKUP_DIR=/backups/mojaloop
DATE=$(date +%Y%m%d_%H%M%S)

# Backup PostgreSQL
docker-compose exec -T postgres pg_dump -U mojaloop mojaloop > $BACKUP_DIR/mojaloop_$DATE.sql

# Compress backup
gzip $BACKUP_DIR/mojaloop_$DATE.sql

# Upload to S3 (optional)
aws s3 cp $BACKUP_DIR/mojaloop_$DATE.sql.gz s3://backups/mojaloop/

# Cleanup old backups (keep 30 days)
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete
```

### Recovery

```bash
# Restore from backup
gunzip mojaloop_20241024_120000.sql.gz
docker-compose exec -T postgres psql -U mojaloop mojaloop < mojaloop_20241024_120000.sql
```

## Scaling

### Horizontal Scaling (Kubernetes)

```bash
# Scale deployment
kubectl scale deployment mojaloop-switch --replicas=5

# Auto-scaling
kubectl autoscale deployment mojaloop-switch --min=3 --max=10 --cpu-percent=70
```

### Database Scaling

```bash
# PostgreSQL replication
# Configure primary-replica setup
# Update connection strings to use read replicas
```

## Troubleshooting

### Common Issues

**1. Database Connection Timeout**
```bash
# Check database status
docker-compose ps postgres

# Check connection
docker-compose exec postgres psql -U mojaloop -c "SELECT 1"

# Increase connection pool
# Update DATABASE_POOL_MAX in .env
```

**2. High Memory Usage**
```bash
# Check memory usage
docker stats

# Adjust memory limits in docker-compose.yml
# Tune application configuration
```

**3. Slow Performance**
```bash
# Check metrics
curl http://localhost:9090/metrics | grep duration

# Analyze slow queries
docker-compose exec postgres psql -U mojaloop -c "SELECT * FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10"

# Optimize queries
# Add indexes
# Tune database parameters
```

## Support

For additional support:
- Documentation: `/docs`
- Issues: GitHub Issues
- Email: support@remittance-platform.ng

