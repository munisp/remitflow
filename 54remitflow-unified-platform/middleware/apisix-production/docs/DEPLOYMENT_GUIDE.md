# APISIX Deployment Guide

**Platform**: Nigerian Remittance Platform  
**Version**: 1.0.0  
**Date**: October 24, 2024

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Development Deployment](#local-development-deployment)
3. [Production Deployment](#production-deployment)
4. [Kubernetes Deployment](#kubernetes-deployment)
5. [Configuration](#configuration)
6. [Post-Deployment Verification](#post-deployment-verification)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### System Requirements

**Minimum**:
- CPU: 2 cores
- RAM: 4 GB
- Storage: 20 GB
- OS: Ubuntu 20.04+ / CentOS 7+ / macOS 10.15+

**Production**:
- CPU: 8 cores
- RAM: 16 GB
- Storage: 100 GB
- OS: Ubuntu 22.04 LTS

### Software Requirements

- Docker 20.10+
- Docker Compose 2.0+
- kubectl 1.24+ (for Kubernetes)
- Python 3.9+
- curl, jq

### Network Requirements

**Ports**:
- 9080: APISIX HTTP
- 9443: APISIX HTTPS
- 9180: Admin API
- 9091: Prometheus metrics
- 9092: Control API
- 9000: Dashboard
- 2379: etcd client
- 2380: etcd peer

---

## Local Development Deployment

### Step 1: Clone Repository

```bash
git clone https://github.com/your-org/remittance-platform.git
cd remittance-platform/services/apisix-production
```

### Step 2: Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit environment variables
nano .env
```

Required environment variables:
```bash
APISIX_ADMIN_KEY=your-admin-key-here
APISIX_VIEWER_KEY=your-viewer-key-here
KEYCLOAK_CLIENT_SECRET=your-keycloak-secret
JWT_SECRET=your-jwt-secret
GRAFANA_PASSWORD=your-grafana-password
```

### Step 3: Start Services

```bash
cd docker
docker-compose up -d
```

### Step 4: Verify Services

```bash
# Check all services are running
docker-compose ps

# Check APISIX health
curl http://localhost:9080/apisix/status

# Check etcd health
curl http://localhost:2379/health
```

### Step 5: Configure Routes

```bash
cd ..
pip install -r requirements.txt
python routes/configure_routes.py
python plugins/security_plugins.py
python plugins/advanced_features.py
```

### Step 6: Access Dashboards

- **APISIX Dashboard**: http://localhost:9000 (admin/admin)
- **Grafana**: http://localhost:3000 (admin/admin)
- **Prometheus**: http://localhost:9090
- **Jaeger**: http://localhost:16686

---

## Production Deployment

### Step 1: Prepare Infrastructure

```bash
# Create dedicated server/VM
# Recommended: 8 CPU, 16 GB RAM, 100 GB storage

# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

### Step 2: Configure Firewall

```bash
# Allow APISIX ports
sudo ufw allow 9080/tcp
sudo ufw allow 9443/tcp
sudo ufw allow 9180/tcp  # Restrict to admin IPs only
sudo ufw enable
```

### Step 3: Set Up SSL Certificates

```bash
# Install certbot
sudo apt-get install certbot

# Generate certificates
sudo certbot certonly --standalone \
  -d api.remittance-platform.ng \
  -d apisix.remittance-platform.ng

# Copy certificates to APISIX
sudo cp /etc/letsencrypt/live/api.remittance-platform.ng/fullchain.pem \
  /path/to/apisix/certs/
sudo cp /etc/letsencrypt/live/api.remittance-platform.ng/privkey.pem \
  /path/to/apisix/certs/
```

### Step 4: Configure Production Settings

```bash
# Edit config.yaml
nano docker/config/config.yaml
```

Production settings:
```yaml
apisix:
  enable_admin: true
  admin_key:
    - name: "admin"
      key: "${STRONG_ADMIN_KEY}"  # Use strong key
      role: admin
  
  # Enable HTTPS
  ssl:
    enable: true
    listen_port: 9443
    ssl_protocols: "TLSv1.2 TLSv1.3"
    
nginx_config:
  error_log_level: "warn"  # Reduce log verbosity
  
  http:
    # Production performance tuning
    keepalive_timeout: 60s
    client_max_body_size: 10m
    
    upstream:
      keepalive: 320
      keepalive_requests: 1000
```

### Step 5: Deploy with Docker Compose

```bash
# Set production environment
export ENVIRONMENT=production

# Start services
docker-compose -f docker/docker-compose.yml up -d

# Verify deployment
docker-compose ps
```

### Step 6: Configure Monitoring

```bash
# Set up Prometheus alerts
cp monitoring/alerts.yml /etc/prometheus/

# Configure Grafana
# Import dashboards from monitoring/grafana-dashboards/
```

### Step 7: Set Up Backups

```bash
# Create backup script
cat > /usr/local/bin/backup-etcd.sh << 'EOF'
#!/bin/bash
BACKUP_DIR=/backup/etcd
mkdir -p $BACKUP_DIR
docker exec apisix-etcd etcdctl snapshot save \
  $BACKUP_DIR/etcd-$(date +%Y%m%d-%H%M%S).db
# Keep last 7 days
find $BACKUP_DIR -name "etcd-*.db" -mtime +7 -delete
EOF

chmod +x /usr/local/bin/backup-etcd.sh

# Add to crontab (daily at 2 AM)
echo "0 2 * * * /usr/local/bin/backup-etcd.sh" | crontab -
```

---

## Kubernetes Deployment

### Step 1: Prepare Kubernetes Cluster

```bash
# Verify cluster access
kubectl cluster-info

# Create namespace
kubectl create namespace apisix
```

### Step 2: Create Secrets

```bash
# Create admin key secret
kubectl create secret generic apisix-admin-key \
  --from-literal=key=your-admin-key \
  -n apisix

# Create Keycloak secret
kubectl create secret generic keycloak-client-secret \
  --from-literal=secret=your-keycloak-secret \
  -n apisix

# Create JWT secret
kubectl create secret generic jwt-secret \
  --from-literal=secret=your-jwt-secret \
  -n apisix
```

### Step 3: Deploy etcd Cluster

```bash
kubectl apply -f kubernetes/apisix-deployment.yaml
```

Wait for etcd to be ready:
```bash
kubectl wait --for=condition=ready pod \
  -l app=etcd -n apisix --timeout=300s
```

### Step 4: Deploy APISIX

```bash
# APISIX deployment is in the same file
# Wait for APISIX to be ready
kubectl wait --for=condition=ready pod \
  -l app=apisix -n apisix --timeout=300s
```

### Step 5: Deploy Dashboard

```bash
# Dashboard deployment is in the same file
# Verify deployment
kubectl get pods -n apisix
```

### Step 6: Configure Ingress

```bash
# Edit ingress in kubernetes/apisix-deployment.yaml
# Update host to your domain
# Apply changes
kubectl apply -f kubernetes/apisix-deployment.yaml
```

### Step 7: Verify Deployment

```bash
# Check all pods are running
kubectl get pods -n apisix

# Check services
kubectl get svc -n apisix

# Check ingress
kubectl get ingress -n apisix

# Test APISIX
kubectl port-forward -n apisix svc/apisix 9080:80
curl http://localhost:9080/apisix/status
```

---

## Configuration

### Environment Variables

Create `.env` file:

```bash
# APISIX
APISIX_ADMIN_KEY=edd1c9f034335f136f87ad84b625c8f1
APISIX_VIEWER_KEY=4054f7cf07e344346cd3f287985e76a2

# Keycloak
KEYCLOAK_URL=http://keycloak:8080
KEYCLOAK_REALM=remittance
KEYCLOAK_CLIENT_ID=remittance-backend-api
KEYCLOAK_CLIENT_SECRET=your-secret-here

# JWT
JWT_SECRET=your-jwt-secret-here

# Monitoring
GRAFANA_PASSWORD=admin

# Database
POSTGRES_PASSWORD=your-postgres-password
```

### Route Configuration

Routes are defined in `routes/configure_routes.py`. To add a new route:

```python
"new_service": {
    "name": "New Service API",
    "uri": "/api/v1/new/*",
    "methods": ["GET", "POST"],
    "upstream_id": "new_service",
    "plugins": {
        "openid-connect": {...},
        "cors": {...},
        "limit-req": {...}
    }
}
```

Apply configuration:
```bash
python routes/configure_routes.py
```

### Upstream Configuration

Upstreams are defined in `routes/configure_routes.py`. To add a new upstream:

```python
"new_service": {
    "name": "new-service-upstream",
    "type": "roundrobin",
    "nodes": {
        "new-service:8080": 1
    },
    "timeout": {
        "connect": 10,
        "send": 10,
        "read": 10
    },
    "retries": 2,
    "checks": {
        "active": {
            "type": "http",
            "http_path": "/health",
            "healthy": {
                "interval": 10,
                "successes": 2
            },
            "unhealthy": {
                "interval": 5,
                "http_failures": 3
            }
        }
    }
}
```

---

## Post-Deployment Verification

### 1. Health Checks

```bash
# APISIX health
curl http://localhost:9080/apisix/status

# etcd health
curl http://localhost:2379/health

# Prometheus metrics
curl http://localhost:9080/apisix/prometheus/metrics
```

### 2. Route Testing

```bash
# Test payment route
curl http://localhost:9080/api/v1/payments/health

# Test KYC route
curl http://localhost:9080/api/v1/kyc/health

# Test Mojaloop route
curl http://localhost:9080/mojaloop/health
```

### 3. Security Testing

```bash
# Test CORS
curl -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST" \
  -X OPTIONS http://localhost:9080/api/v1/payments

# Test authentication (should fail without token)
curl http://localhost:9080/api/v1/payments/create
```

### 4. Performance Testing

```bash
# Install Apache Bench
apt-get install apache2-utils

# Run load test
ab -n 1000 -c 10 http://localhost:9080/apisix/status

# Check results
# Requests per second should be > 1000
# Time per request should be < 10ms
```

### 5. Monitoring Verification

```bash
# Check Prometheus targets
curl http://localhost:9090/api/v1/targets

# Check Grafana datasources
curl -u admin:admin http://localhost:3000/api/datasources

# Check Jaeger services
curl http://localhost:16686/api/services
```

---

## Troubleshooting

### Issue 1: APISIX Won't Start

**Symptoms**: Container exits immediately

**Solution**:
```bash
# Check logs
docker logs apisix-gateway

# Common causes:
# 1. etcd not accessible
docker exec apisix-gateway curl http://etcd:2379/health

# 2. Invalid configuration
docker exec apisix-gateway apisix test

# 3. Port conflict
netstat -tulpn | grep 9080
```

### Issue 2: Routes Not Working

**Symptoms**: 404 errors for configured routes

**Solution**:
```bash
# List all routes
curl http://localhost:9180/apisix/admin/routes \
  -H "X-API-KEY: $APISIX_ADMIN_KEY"

# Check specific route
curl http://localhost:9180/apisix/admin/routes/payment \
  -H "X-API-KEY: $APISIX_ADMIN_KEY"

# Reconfigure routes
python routes/configure_routes.py
```

### Issue 3: Authentication Failing

**Symptoms**: 401/403 errors

**Solution**:
```bash
# Check Keycloak connectivity
curl http://keycloak:8080/realms/remittance/.well-known/openid-configuration

# Check plugin configuration
curl http://localhost:9180/apisix/admin/routes/payment \
  -H "X-API-KEY: $APISIX_ADMIN_KEY" | jq '.plugins'

# Verify token
curl -X POST http://keycloak:8080/realms/remittance/protocol/openid-connect/token \
  -d "client_id=remittance-backend-api" \
  -d "client_secret=$KEYCLOAK_CLIENT_SECRET" \
  -d "grant_type=client_credentials"
```

### Issue 4: High Latency

**Symptoms**: Slow response times

**Solution**:
```bash
# Check upstream health
curl http://localhost:9180/apisix/admin/upstreams \
  -H "X-API-KEY: $APISIX_ADMIN_KEY"

# Check metrics
curl http://localhost:9080/apisix/prometheus/metrics | grep latency

# Increase worker connections
# Edit docker/config/config.yaml
nginx_config:
  worker_connections: 10240
```

### Issue 5: etcd Connection Issues

**Symptoms**: APISIX can't connect to etcd

**Solution**:
```bash
# Check etcd status
docker exec apisix-etcd etcdctl endpoint health

# Check etcd logs
docker logs apisix-etcd

# Restart etcd
docker restart apisix-etcd

# Wait for etcd to be ready
sleep 10

# Restart APISIX
docker restart apisix-gateway
```

---

## Rollback Procedure

If deployment fails:

```bash
# Stop new deployment
docker-compose down

# Restore from backup
docker exec apisix-etcd etcdctl snapshot restore /backup/etcd-latest.db

# Start previous version
docker-compose -f docker-compose.backup.yml up -d

# Verify rollback
curl http://localhost:9080/apisix/status
```

---

## Support

For deployment issues:
1. Check logs: `docker logs apisix-gateway`
2. Review documentation: `README.md`
3. Contact platform team: platform@remittance.ng

---

**Document Version**: 1.0.0  
**Last Updated**: October 24, 2024

