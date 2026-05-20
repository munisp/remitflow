# Keycloak Deployment Guide

Complete guide for deploying Keycloak Identity and Access Management in production.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Docker Compose Deployment](#docker-compose-deployment)
- [Kubernetes Deployment](#kubernetes-deployment)
- [Post-Deployment Configuration](#post-deployment-configuration)
- [SSL/TLS Configuration](#ssltls-configuration)
- [High Availability Setup](#high-availability-setup)
- [Backup and Recovery](#backup-and-recovery)
- [Monitoring Setup](#monitoring-setup)
- [Security Hardening](#security-hardening)

---

## Prerequisites

### System Requirements

**Minimum**:
- 4 GB RAM
- 2 CPU cores
- 20 GB disk space
- Ubuntu 22.04 LTS or equivalent

**Recommended (Production)**:
- 16 GB RAM
- 8 CPU cores
- 100 GB SSD storage
- Ubuntu 22.04 LTS

### Software Requirements

- Docker 24.0+
- Docker Compose 2.20+
- Kubernetes 1.28+ (for K8s deployment)
- PostgreSQL 15+
- Redis 7+

### Network Requirements

- Port 8080 (HTTP)
- Port 8443 (HTTPS)
- Port 5432 (PostgreSQL)
- Port 6379 (Redis)
- Port 9090 (Prometheus)
- Port 3000 (Grafana)

---

## Environment Setup

### 1. Create Environment File

```bash
cd services/keycloak-production
cp .env.example .env
```

### 2. Configure Environment Variables

Edit `.env`:

```bash
# Keycloak Configuration
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=<strong-admin-password>
KEYCLOAK_DB_PASSWORD=<strong-db-password>

# Database Configuration
POSTGRES_DB=keycloak
POSTGRES_USER=keycloak
POSTGRES_PASSWORD=<strong-db-password>

# Redis Configuration
REDIS_PASSWORD=<strong-redis-password>

# Monitoring
GRAFANA_PASSWORD=<strong-grafana-password>

# URLs
KEYCLOAK_URL=https://keycloak.remittance-platform.ng
FRONTEND_URL=https://app.remittance-platform.ng
BACKEND_URL=https://api.remittance-platform.ng
```

### 3. Generate Strong Passwords

```bash
# Generate secure passwords
openssl rand -base64 32

# Or use password generator
pwgen -s 32 1
```

---

## Docker Compose Deployment

### 1. Prepare Configuration

```bash
cd services/keycloak-production/docker
```

### 2. Initialize Database

```bash
# Start PostgreSQL first
docker-compose up -d keycloak-db

# Wait for database to be ready
docker-compose exec keycloak-db pg_isready -U keycloak

# Verify initialization
docker-compose exec keycloak-db psql -U keycloak -d keycloak -c "\dt"
```

### 3. Start Keycloak

```bash
# Start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f keycloak
```

### 4. Verify Deployment

```bash
# Check Keycloak health
curl http://localhost:8080/health/ready

# Access admin console
open http://localhost:8080/admin
```

### 5. Import Realm Configuration

```bash
# Realm is automatically imported on startup from realm-export.json
# Verify realm exists
curl http://localhost:8080/realms/remittance
```

---

## Kubernetes Deployment

### 1. Prepare Cluster

```bash
# Create namespace
kubectl create namespace keycloak

# Verify namespace
kubectl get namespaces
```

### 2. Create Secrets

```bash
# Database secret
kubectl create secret generic keycloak-db-secret \
  --from-literal=username=keycloak \
  --from-literal=password=$(openssl rand -base64 32) \
  -n keycloak

# Admin secret
kubectl create secret generic keycloak-admin-secret \
  --from-literal=username=admin \
  --from-literal=password=$(openssl rand -base64 32) \
  -n keycloak

# Verify secrets
kubectl get secrets -n keycloak
```

### 3. Create ConfigMaps

```bash
# Realm configuration
kubectl create configmap keycloak-realm-config \
  --from-file=realm-export.json=../docker/realm-export.json \
  -n keycloak

# Database initialization
kubectl create configmap keycloak-db-init \
  --from-file=init.sql=../docker/init-db.sql \
  -n keycloak
```

### 4. Deploy PostgreSQL

```bash
kubectl apply -f kubernetes/keycloak-deployment.yaml

# Wait for PostgreSQL to be ready
kubectl wait --for=condition=ready pod \
  -l app=keycloak-postgres \
  -n keycloak \
  --timeout=300s
```

### 5. Deploy Keycloak

```bash
# Keycloak deployment is in the same file
# Wait for Keycloak to be ready
kubectl wait --for=condition=ready pod \
  -l app=keycloak \
  -n keycloak \
  --timeout=600s

# Check status
kubectl get pods -n keycloak
kubectl get svc -n keycloak
```

### 6. Configure Ingress

```bash
# Update ingress hostname in keycloak-deployment.yaml
# Then apply
kubectl apply -f kubernetes/keycloak-deployment.yaml

# Verify ingress
kubectl get ingress -n keycloak
```

### 7. Verify Deployment

```bash
# Check pods
kubectl get pods -n keycloak

# Check logs
kubectl logs -f deployment/keycloak -n keycloak

# Test health endpoint
kubectl port-forward svc/keycloak 8080:80 -n keycloak
curl http://localhost:8080/health/ready
```

---

## Post-Deployment Configuration

### 1. Configure Authentication Flows

```bash
python config/authentication_flows.py \
  --server-url https://keycloak.remittance-platform.ng \
  --admin-username admin \
  --admin-password <admin-password> \
  --realm remittance
```

### 2. Configure Clients

```bash
python config/clients_config.py \
  --server-url https://keycloak.remittance-platform.ng \
  --admin-username admin \
  --admin-password <admin-password> \
  --realm remittance
```

### 3. Create Initial Users

```bash
python scripts/user_management.py \
  --server-url https://keycloak.remittance-platform.ng \
  --admin-username admin \
  --admin-password <admin-password> \
  create \
  --username admin.user \
  --email admin@remittance-platform.ng \
  --first-name Admin \
  --last-name User \
  --password <strong-password> \
  --roles admin
```

### 4. Configure Email Server

Access Admin Console → Realm Settings → Email

- **Host**: smtp.example.com
- **Port**: 587
- **From**: noreply@remittance-platform.ng
- **Enable StartTLS**: Yes
- **Username**: smtp-user
- **Password**: smtp-password

Test email configuration:
- Users → [User] → Send Verify Email

---

## SSL/TLS Configuration

### 1. Obtain SSL Certificate

```bash
# Using Let's Encrypt
certbot certonly --standalone \
  -d keycloak.remittance-platform.ng \
  --email admin@remittance-platform.ng \
  --agree-tos
```

### 2. Configure Keycloak for HTTPS

**Docker Compose**:

```yaml
# Add to docker-compose.yml
keycloak:
  environment:
    - KC_HTTPS_CERTIFICATE_FILE=/opt/keycloak/conf/server.crt
    - KC_HTTPS_CERTIFICATE_KEY_FILE=/opt/keycloak/conf/server.key
  volumes:
    - /etc/letsencrypt/live/keycloak.remittance-platform.ng/fullchain.pem:/opt/keycloak/conf/server.crt
    - /etc/letsencrypt/live/keycloak.remittance-platform.ng/privkey.pem:/opt/keycloak/conf/server.key
```

**Kubernetes**:

```bash
# Create TLS secret
kubectl create secret tls keycloak-tls \
  --cert=/etc/letsencrypt/live/keycloak.remittance-platform.ng/fullchain.pem \
  --key=/etc/letsencrypt/live/keycloak.remittance-platform.ng/privkey.pem \
  -n keycloak
```

### 3. Update Realm Settings

Admin Console → Realm Settings → General

- **Frontend URL**: https://keycloak.remittance-platform.ng
- **Require SSL**: All requests

---

## High Availability Setup

### 1. Scale Keycloak Replicas

**Docker Compose**:

```bash
docker-compose up -d --scale keycloak=3
```

**Kubernetes**:

```bash
kubectl scale deployment keycloak --replicas=3 -n keycloak
```

### 2. Configure Load Balancer

**Nginx Configuration**:

```nginx
upstream keycloak {
    least_conn;
    server keycloak-1:8080;
    server keycloak-2:8080;
    server keycloak-3:8080;
}

server {
    listen 443 ssl http2;
    server_name keycloak.remittance-platform.ng;

    ssl_certificate /etc/ssl/certs/keycloak.crt;
    ssl_certificate_key /etc/ssl/private/keycloak.key;

    location / {
        proxy_pass http://keycloak;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 3. Configure PostgreSQL Replication

See PostgreSQL documentation for setting up primary-replica replication.

### 4. Configure Redis Sentinel

```bash
# Configure Redis Sentinel for automatic failover
# See Redis Sentinel documentation
```

---

## Backup and Recovery

### 1. Database Backup

```bash
# Backup PostgreSQL
docker-compose exec keycloak-db pg_dump -U keycloak keycloak > keycloak_backup_$(date +%Y%m%d).sql

# Or using Kubernetes
kubectl exec -n keycloak keycloak-postgres-0 -- \
  pg_dump -U keycloak keycloak > keycloak_backup_$(date +%Y%m%d).sql
```

### 2. Realm Export

```bash
# Export realm configuration
docker-compose exec keycloak /opt/keycloak/bin/kc.sh export \
  --dir /tmp/export \
  --realm remittance

# Copy export
docker cp keycloak-server:/tmp/export ./realm-backup/
```

### 3. Automated Backups

```bash
# Add to crontab
0 2 * * * /path/to/backup-script.sh
```

**backup-script.sh**:

```bash
#!/bin/bash
BACKUP_DIR=/backups/keycloak
DATE=$(date +%Y%m%d_%H%M%S)

# Backup database
docker-compose exec -T keycloak-db pg_dump -U keycloak keycloak \
  > $BACKUP_DIR/db_$DATE.sql

# Backup realm
docker-compose exec -T keycloak /opt/keycloak/bin/kc.sh export \
  --dir /tmp/export --realm remittance

docker cp keycloak-server:/tmp/export $BACKUP_DIR/realm_$DATE/

# Compress
tar -czf $BACKUP_DIR/keycloak_backup_$DATE.tar.gz \
  $BACKUP_DIR/db_$DATE.sql \
  $BACKUP_DIR/realm_$DATE/

# Cleanup old backups (keep 30 days)
find $BACKUP_DIR -name "keycloak_backup_*.tar.gz" -mtime +30 -delete
```

### 4. Recovery

```bash
# Restore database
docker-compose exec -T keycloak-db psql -U keycloak keycloak \
  < keycloak_backup_20241024.sql

# Restart Keycloak
docker-compose restart keycloak
```

---

## Monitoring Setup

### 1. Configure Prometheus

Prometheus is automatically configured via docker-compose.

**Verify**:

```bash
curl http://localhost:9090/api/v1/targets
```

### 2. Configure Grafana

Access Grafana at `http://localhost:3000`

**Default Credentials**:
- Username: admin
- Password: (from .env)

**Import Dashboards**:
1. Go to Dashboards → Import
2. Upload dashboard JSON from `monitoring/grafana-dashboards.yml`

### 3. Configure Alerts

**Prometheus Alert Rules**:

```yaml
groups:
  - name: keycloak
    rules:
      - alert: HighLoginFailureRate
        expr: rate(keycloak_login_errors_total[5m]) > 10
        for: 5m
        annotations:
          summary: "High login failure rate"
      
      - alert: KeycloakDown
        expr: up{job="keycloak"} == 0
        for: 1m
        annotations:
          summary: "Keycloak is down"
```

---

## Security Hardening

### 1. Firewall Configuration

```bash
# Allow only necessary ports
ufw allow 443/tcp  # HTTPS
ufw allow 22/tcp   # SSH
ufw deny 8080/tcp  # Block direct HTTP access
ufw enable
```

### 2. Database Security

```bash
# Restrict PostgreSQL access
# Edit postgresql.conf
listen_addresses = 'localhost'

# Edit pg_hba.conf
host    keycloak    keycloak    127.0.0.1/32    md5
```

### 3. Enable Audit Logging

Admin Console → Realm Settings → Events

- **Save Events**: ON
- **Event Types**: Select all
- **Admin Events**: ON

### 4. Configure Rate Limiting

```nginx
# Add to Nginx config
limit_req_zone $binary_remote_addr zone=keycloak:10m rate=10r/s;

location / {
    limit_req zone=keycloak burst=20;
    proxy_pass http://keycloak;
}
```

### 5. Regular Security Updates

```bash
# Update Keycloak
docker-compose pull keycloak
docker-compose up -d keycloak

# Update PostgreSQL
docker-compose pull keycloak-db
docker-compose up -d keycloak-db
```

---

## Verification Checklist

- [ ] Keycloak is accessible via HTTPS
- [ ] Admin console login works
- [ ] Realm configuration is imported
- [ ] Clients are configured
- [ ] Test user can login
- [ ] Email verification works
- [ ] Password reset works
- [ ] MFA enrollment works
- [ ] Token validation works
- [ ] Monitoring dashboards show data
- [ ] Backups are running
- [ ] SSL certificate is valid
- [ ] High availability is configured
- [ ] Security hardening is complete

---

## Troubleshooting

See [README.md#troubleshooting](../README.md#troubleshooting) for common issues and solutions.

---

**Deployment Guide Version**: 1.0.0  
**Last Updated**: October 24, 2024

