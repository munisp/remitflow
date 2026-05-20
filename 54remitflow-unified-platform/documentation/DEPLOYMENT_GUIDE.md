# Remittance Platform - Deployment Guide

**Version:** 1.0.0  
**Last Updated:** January 2025  
**Platform Size:** 2.1 GB  
**Status:** ✅ Production Ready

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Docker Deployment](#docker-deployment)
4. [Manual Deployment](#manual-deployment)
5. [Configuration](#configuration)
6. [Service Ports](#service-ports)
7. [Health Checks](#health-checks)
8. [Troubleshooting](#troubleshooting)
9. [Production Checklist](#production-checklist)

---

## Prerequisites

### System Requirements

**Minimum:**
- CPU: 4 cores
- RAM: 8 GB
- Disk: 20 GB
- OS: Ubuntu 20.04+ / CentOS 8+ / macOS 12+

**Recommended:**
- CPU: 8+ cores
- RAM: 16+ GB
- Disk: 50+ GB SSD
- OS: Ubuntu 22.04 LTS

### Software Dependencies

```bash
# Docker & Docker Compose
docker --version  # >= 24.0
docker-compose --version  # >= 2.20

# Python
python3 --version  # >= 3.11

# Node.js
node --version  # >= 22.0

# PostgreSQL Client
psql --version  # >= 15.0

# Redis Client
redis-cli --version  # >= 7.0
```

---

## Quick Start

### 1. Clone/Extract Platform

```bash
# If from archive
cd /path/to/remittance-platform

# Verify structure
ls -la
# Should see: backend/, frontend/, database/, docker-compose.yml
```

### 2. Set Environment Variables

```bash
# Copy environment template
cp .env.example .env

# Edit configuration
nano .env
```

**Required Environment Variables:**

```bash
# Database
POSTGRES_PASSWORD=your_secure_password_here

# Payment Gateways
STRIPE_SECRET_KEY=sk_live_...
PAYPAL_CLIENT_ID=your_paypal_client_id

# Communication
WHATSAPP_API_KEY=your_whatsapp_key
SMS_API_KEY=your_sms_key

# Security
JWT_SECRET=your_jwt_secret_key_change_in_production
WEBHOOK_SECRET=your_webhook_secret

# Cloud Storage (Optional)
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
AZURE_STORAGE_CONNECTION_STRING=your_azure_connection
```

### 3. Start Platform

```bash
# Start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

### 4. Verify Deployment

```bash
# Check health endpoints
curl http://localhost:8070/health  # Lakehouse
curl http://localhost:8050/health  # E-commerce
curl http://localhost:8001/health  # Supply Chain
curl http://localhost:8030/health  # POS
```

### 5. Access Dashboards

- **Lakehouse Dashboard:** http://localhost:3000
- **Monitoring Dashboard:** http://localhost:8030
- **API Gateway:** http://localhost:9080

---

## Docker Deployment

### Full Stack Deployment

```bash
cd /home/ubuntu/remittance-platform

# Build all images
docker-compose build

# Start all services
docker-compose up -d

# Scale specific services
docker-compose up -d --scale ecommerce-service=3
```

### Individual Service Deployment

```bash
# Start only database services
docker-compose up -d postgresql redis

# Start core services
docker-compose up -d lakehouse-service ecommerce-service pos-service

# Start communication services
docker-compose up -d whatsapp-service sms-service
```

### Service Management

```bash
# Stop all services
docker-compose stop

# Restart specific service
docker-compose restart lakehouse-service

# View logs
docker-compose logs -f lakehouse-service

# Remove all containers
docker-compose down

# Remove containers and volumes
docker-compose down -v
```

---

## Manual Deployment

### 1. Database Setup

```bash
# Install PostgreSQL
sudo apt-get install postgresql-15

# Create database
sudo -u postgres psql
CREATE DATABASE remittance;
CREATE USER remittance_user WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE remittance TO remittance_user;
\q

# Load schemas
psql -U remittance_user -d remittance -f database/schemas/supply_chain_schema.sql
psql -U remittance_user -d remittance -f database/security/row_level_security.sql
psql -U remittance_user -d remittance -f database/performance/materialized_views.sql
```

### 2. Redis Setup

```bash
# Install Redis
sudo apt-get install redis-server

# Start Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Verify
redis-cli ping
```

### 3. Python Services

```bash
# Install Python dependencies
cd backend/python-services
pip3 install -r requirements.txt

# Start Lakehouse Service
cd lakehouse-service
python3 lakehouse_production.py &

# Start E-commerce Service
cd ../agent-ecommerce-platform
python3 comprehensive_ecommerce_service.py &

# Start Supply Chain Services
cd ../supply-chain
python3 inventory_service.py &
python3 warehouse_operations.py &
python3 procurement_service.py &

# Start POS Service
cd ../pos-integration
python3 pos_service_secure.py &

# Start QR Code Service
cd ../qr-code-service
python3 qr_code_service_enhanced.py &
```

### 4. Frontend Deployment

```bash
# Install Node.js dependencies
cd frontend/lakehouse-dashboard
npm install

# Build for production
npm run build

# Serve with nginx or node
npm start &
```

---

## Configuration

### Database Configuration

**File:** `backend/python-services/*/config.py`

```python
DATABASE_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "database": "remittance",
    "user": "remittance_user",
    "password": os.getenv("POSTGRES_PASSWORD"),
    "min_pool_size": 5,
    "max_pool_size": 20
}
```

### Redis Configuration

```python
REDIS_CONFIG = {
    "host": "localhost",
    "port": 6379,
    "db": 0,
    "decode_responses": True
}
```

### Fluvio Configuration

```python
FLUVIO_CONFIG = {
    "endpoint": "localhost:9003",
    "topics": [
        "agent-onboarding",
        "ecommerce-orders",
        "pos-transactions",
        "supply-chain-inventory"
    ]
}
```

---

## Service Ports

| Service | Port | Protocol | Access |
|---------|------|----------|--------|
| PostgreSQL | 5432 | TCP | Internal |
| Redis | 6379 | TCP | Internal |
| Fluvio | 9003 | TCP | Internal |
| Kafka | 9092 | TCP | Internal |
| APISIX Gateway | 9080 | HTTP | Public |
| APISIX Gateway (SSL) | 9443 | HTTPS | Public |
| Lakehouse Service | 8070 | HTTP | Internal |
| E-commerce Service | 8050 | HTTP | Internal |
| Supply Chain (Inventory) | 8001 | HTTP | Internal |
| Supply Chain (Warehouse) | 8002 | HTTP | Internal |
| Supply Chain (Procurement) | 8003 | HTTP | Internal |
| Supply Chain (Logistics) | 8004 | HTTP | Internal |
| Supply Chain (Forecasting) | 8005 | HTTP | Internal |
| POS Service | 8030 | HTTP | Internal |
| QR Code Service | 8032 | HTTP | Internal |
| WhatsApp Service | 8040 | HTTP | Internal |
| SMS Service | 8041 | HTTP | Internal |
| Platform Middleware | 8090 | HTTP | Internal |
| Monitoring Dashboard | 8030 | HTTP | Public |
| Lakehouse Dashboard | 3000 | HTTP | Public |

---

## Health Checks

### Automated Health Check Script

```bash
#!/bin/bash
# health_check.sh

services=(
    "http://localhost:8070/health:Lakehouse"
    "http://localhost:8050/health:E-commerce"
    "http://localhost:8001/health:Inventory"
    "http://localhost:8030/health:POS"
    "http://localhost:8032/health:QR-Code"
    "http://localhost:8090/health:Middleware"
)

echo "Checking service health..."
for service in "${services[@]}"; do
    IFS=':' read -r url name <<< "$service"
    response=$(curl -s -o /dev/null -w "%{http_code}" "$url")
    if [ "$response" = "200" ]; then
        echo "✅ $name: Healthy"
    else
        echo "❌ $name: Unhealthy (HTTP $response)"
    fi
done
```

### Manual Health Checks

```bash
# Database
psql -U remittance_user -d remittance -c "SELECT 1;"

# Redis
redis-cli ping

# Services
curl http://localhost:8070/health
curl http://localhost:8050/health
curl http://localhost:8001/health
```

---

## Troubleshooting

### Common Issues

#### 1. Database Connection Failed

```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Check connection
psql -U remittance_user -d remittance

# Check logs
sudo tail -f /var/log/postgresql/postgresql-15-main.log
```

#### 2. Redis Connection Failed

```bash
# Check Redis is running
sudo systemctl status redis-server

# Check connection
redis-cli ping

# Check logs
sudo tail -f /var/log/redis/redis-server.log
```

#### 3. Service Won't Start

```bash
# Check logs
docker-compose logs -f service-name

# Check port availability
sudo netstat -tulpn | grep :8070

# Check environment variables
docker-compose config
```

#### 4. Out of Memory

```bash
# Check memory usage
free -h

# Increase Docker memory limit
# Edit: /etc/docker/daemon.json
{
  "default-runtime": "runc",
  "default-ulimits": {
    "memlock": {
      "Hard": -1,
      "Name": "memlock",
      "Soft": -1
    }
  }
}

# Restart Docker
sudo systemctl restart docker
```

#### 5. Permission Denied

```bash
# Fix file permissions
sudo chown -R $USER:$USER /home/ubuntu/remittance-platform

# Fix Docker socket permissions
sudo chmod 666 /var/run/docker.sock
```

---

## Production Checklist

### Security

- [ ] Change all default passwords
- [ ] Generate strong JWT secret keys
- [ ] Enable HTTPS/TLS for all public endpoints
- [ ] Configure firewall rules
- [ ] Enable rate limiting
- [ ] Set up intrusion detection
- [ ] Configure audit logging
- [ ] Enable database encryption at rest
- [ ] Set up VPN for internal services
- [ ] Implement API key rotation

### Performance

- [ ] Configure database connection pooling
- [ ] Enable Redis caching
- [ ] Set up CDN for static assets
- [ ] Configure load balancing
- [ ] Enable gzip compression
- [ ] Optimize database indexes
- [ ] Set up query caching
- [ ] Configure auto-scaling

### Monitoring

- [ ] Set up Prometheus metrics
- [ ] Configure Grafana dashboards
- [ ] Enable application logging
- [ ] Set up log aggregation (ELK/Loki)
- [ ] Configure alerting (PagerDuty/Slack)
- [ ] Set up uptime monitoring
- [ ] Enable APM (Application Performance Monitoring)
- [ ] Configure error tracking (Sentry)

### Backup & Recovery

- [ ] Configure automated database backups
- [ ] Set up point-in-time recovery
- [ ] Test backup restoration
- [ ] Configure Redis persistence
- [ ] Set up disaster recovery plan
- [ ] Document recovery procedures
- [ ] Test failover scenarios

### Compliance

- [ ] PCI DSS compliance verification
- [ ] GDPR compliance check
- [ ] SOC 2 audit preparation
- [ ] Data retention policy implementation
- [ ] Privacy policy documentation
- [ ] Terms of service documentation

---

## Deployment Scenarios

### Development Environment

```bash
# Start with minimal services
docker-compose up -d postgresql redis lakehouse-service

# Enable hot reload
export FLASK_ENV=development
export DEBUG=True
```

### Staging Environment

```bash
# Full stack with test data
docker-compose up -d

# Load test data
python scripts/load_test_data.py
```

### Production Environment

```bash
# Use production compose file
docker-compose -f docker-compose.prod.yml up -d

# Enable monitoring
docker-compose -f docker-compose.monitoring.yml up -d
```

---

## Scaling

### Horizontal Scaling

```bash
# Scale specific services
docker-compose up -d --scale ecommerce-service=5
docker-compose up -d --scale pos-service=3

# Use Kubernetes for production
kubectl apply -f kubernetes/
kubectl scale deployment ecommerce-service --replicas=10
```

### Vertical Scaling

```yaml
# docker-compose.yml
services:
  ecommerce-service:
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 4G
        reservations:
          cpus: '1.0'
          memory: 2G
```

---

## Maintenance

### Updates

```bash
# Pull latest images
docker-compose pull

# Restart services with zero downtime
docker-compose up -d --no-deps --build service-name
```

### Database Migrations

```bash
# Run migrations
python manage.py migrate

# Rollback if needed
python manage.py migrate app_name migration_name
```

### Log Rotation

```bash
# Configure log rotation
sudo nano /etc/logrotate.d/remittance

/var/log/remittance/*.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
    sharedscripts
}
```

---

## Support

**Documentation:** https://docs.remittance-platform.com  
**Issues:** https://github.com/remittance-platform/issues  
**Email:** support@remittance-platform.com  
**Slack:** https://remittance-platform.slack.com

---

## License

Copyright © 2025 Remittance Platform. All rights reserved.

---

**Deployment Guide Version:** 1.0.0  
**Last Updated:** January 2025  
**Status:** ✅ Production Ready

