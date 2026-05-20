# Temporal Workflow Orchestration - Deployment Guide

## Overview

This guide provides comprehensive instructions for deploying the Temporal workflow orchestration system for the Nigerian Remittance Platform.

---

## Architecture

The Temporal implementation consists of the following components:

### Core Components
- **Temporal Server**: Frontend, History, Matching, and Worker services
- **PostgreSQL**: Persistence layer for workflow state
- **Elasticsearch**: Advanced visibility and search (optional)
- **Temporal UI**: Web-based workflow monitoring interface

### Application Components
- **Payment Worker**: Executes payment processing workflows
- **KYC Worker**: Executes identity verification workflows
- **Fraud Worker**: Executes fraud detection workflows

### Monitoring Components
- **Prometheus**: Metrics collection
- **Grafana**: Metrics visualization

---

## Prerequisites

### System Requirements
- **CPU**: Minimum 4 cores (8 cores recommended)
- **RAM**: Minimum 8 GB (16 GB recommended)
- **Storage**: Minimum 50 GB SSD
- **OS**: Linux (Ubuntu 22.04 LTS recommended)

### Software Requirements
- Docker 24.0+ and Docker Compose 2.20+
- OR Kubernetes 1.27+
- Python 3.11+
- PostgreSQL 15+ (if not using Docker)

---

## Deployment Options

### Option 1: Docker Compose (Development/Testing)

#### Step 1: Clone Repository
```bash
cd /home/ubuntu/services/temporal-production
```

#### Step 2: Configure Environment
```bash
# Copy and edit environment file
cp .env.example .env

# Edit configuration
nano .env
```

Required environment variables:
```env
# Temporal Server
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_UI_PORT=8080

# PostgreSQL
POSTGRES_USER=temporal
POSTGRES_PASSWORD=change_me_in_production
POSTGRES_DB=temporal

# Monitoring
PROMETHEUS_PORT=9090
GRAFANA_PORT=3001
```

#### Step 3: Start Services
```bash
cd docker
docker-compose up -d
```

#### Step 4: Verify Deployment
```bash
# Check service health
docker-compose ps

# View logs
docker-compose logs -f temporal

# Access Temporal UI
open http://localhost:8080
```

#### Step 5: Start Workers
```bash
# Install Python dependencies
pip install -r requirements.txt

# Start workers
python workers/main_worker.py
```

---

### Option 2: Kubernetes (Production)

#### Step 1: Create Namespace
```bash
kubectl create namespace temporal-system
```

#### Step 2: Deploy PostgreSQL
```bash
kubectl apply -f kubernetes/temporal-deployment.yaml
```

#### Step 3: Wait for PostgreSQL
```bash
kubectl wait --for=condition=ready pod -l app=temporal-postgresql -n temporal-system --timeout=300s
```

#### Step 4: Deploy Temporal Server
```bash
kubectl apply -f kubernetes/temporal-deployment.yaml
```

#### Step 5: Verify Deployment
```bash
# Check pods
kubectl get pods -n temporal-system

# Check services
kubectl get svc -n temporal-system

# View logs
kubectl logs -f deployment/temporal-frontend -n temporal-system
```

#### Step 6: Deploy Workers
```bash
# Build worker image
docker build -t temporal-workers:latest -f Dockerfile.workers .

# Deploy workers
kubectl apply -f kubernetes/workers-deployment.yaml
```

#### Step 7: Access Temporal UI
```bash
# Port forward
kubectl port-forward svc/temporal-ui 8080:8080 -n temporal-system

# Or configure ingress
kubectl apply -f kubernetes/ingress.yaml
```

---

## Configuration

### Temporal Server Configuration

#### Dynamic Configuration
Edit `config/development-sql.yaml`:

```yaml
# Workflow execution limits
history.maxAutoResetPoints:
  - value: 20
    constraints: {}

# Workflow retention
system.defaultWorkflowRetentionPeriod:
  - value: "7d"
    constraints: {}

# Enable metrics
system.enableMetrics:
  - value: true
    constraints: {}
```

#### Namespace Configuration
```bash
# Create namespace
tctl --namespace payment-namespace namespace register

# Describe namespace
tctl --namespace payment-namespace namespace describe
```

### Worker Configuration

#### Task Queues
- `payment-task-queue`: Payment workflows
- `kyc-task-queue`: KYC workflows
- `fraud-task-queue`: Fraud detection workflows

#### Worker Scaling
```yaml
# Kubernetes worker deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-worker
spec:
  replicas: 3  # Scale based on load
```

---

## Monitoring

### Prometheus Metrics

Access Prometheus: `http://localhost:9090`

Key metrics to monitor:
- `temporal_workflow_execution_count`: Workflow execution count
- `temporal_workflow_execution_latency`: Workflow execution latency
- `temporal_activity_execution_count`: Activity execution count
- `temporal_activity_execution_latency`: Activity execution latency
- `temporal_worker_task_slots_available`: Available worker task slots

### Grafana Dashboards

Access Grafana: `http://localhost:3001`
- Username: `admin`
- Password: `admin` (change on first login)

Pre-configured dashboards:
1. **Temporal Overview**: System-wide metrics
2. **Workflow Performance**: Workflow execution metrics
3. **Activity Performance**: Activity execution metrics
4. **Worker Health**: Worker status and capacity

---

## Operations

### Starting Workflows

#### Payment Processing Workflow
```python
from temporalio.client import Client

client = await Client.connect("localhost:7233")

result = await client.execute_workflow(
    "PaymentProcessingWorkflow",
    {
        "payment_id": "PAY-001",
        "sender_id": "USER-001",
        "recipient_id": "USER-002",
        "amount": 10000.0,
        "currency": "NGN",
        "corridor": "PAPSS"
    },
    id="payment-001",
    task_queue="payment-task-queue",
)
```

#### KYC Verification Workflow
```python
result = await client.execute_workflow(
    "KYCVerificationWorkflow",
    {
        "user_id": "USER-001",
        "kyc_type": "individual",
        "documents": [...],
        "personal_info": {...},
        "country": "NG"
    },
    id="kyc-001",
    task_queue="kyc-task-queue",
)
```

#### Fraud Detection Workflow
```python
result = await client.execute_workflow(
    "FraudDetectionWorkflow",
    {
        "transaction_id": "TXN-001",
        "sender_id": "USER-001",
        "recipient_id": "USER-002",
        "amount": 50000.0,
        "currency": "NGN"
    },
    id="fraud-001",
    task_queue="fraud-task-queue",
)
```

### Querying Workflows

```bash
# List workflows
tctl workflow list

# Describe workflow
tctl workflow describe -w payment-001

# Show workflow history
tctl workflow show -w payment-001

# Query workflow
tctl workflow query -w payment-001 --qt getStatus
```

### Canceling Workflows

```bash
# Cancel workflow
tctl workflow cancel -w payment-001

# Terminate workflow
tctl workflow terminate -w payment-001 --reason "User requested"
```

---

## Backup and Recovery

### Database Backup

#### PostgreSQL Backup
```bash
# Create backup
docker exec temporal-postgresql pg_dump -U temporal temporal > backup_$(date +%Y%m%d).sql

# Restore backup
docker exec -i temporal-postgresql psql -U temporal temporal < backup_20241024.sql
```

#### Automated Backups
```bash
# Add to crontab
0 2 * * * /path/to/backup-script.sh
```

### Disaster Recovery

1. **Stop all workers**
2. **Restore database from backup**
3. **Restart Temporal server**
4. **Restart workers**
5. **Verify workflow state**

---

## Scaling

### Horizontal Scaling

#### Scale Temporal Server
```bash
# Kubernetes
kubectl scale deployment temporal-frontend --replicas=3 -n temporal-system
kubectl scale deployment temporal-history --replicas=3 -n temporal-system
```

#### Scale Workers
```bash
# Kubernetes
kubectl scale deployment payment-worker --replicas=5 -n temporal-system
```

### Vertical Scaling

Update resource limits in Kubernetes:
```yaml
resources:
  requests:
    memory: "2Gi"
    cpu: "2000m"
  limits:
    memory: "4Gi"
    cpu: "4000m"
```

---

## Security

### mTLS Configuration

1. **Generate certificates**
2. **Configure Temporal server**
3. **Configure workers**
4. **Verify connection**

### Authentication

Configure namespace-level authentication:
```yaml
auth:
  enabled: true
  providers:
    - type: jwt
      issuer: "https://auth.example.com"
```

### Network Security

- Use private networks for Temporal server
- Restrict access to Temporal UI
- Enable TLS for all connections
- Use secrets management for credentials

---

## Troubleshooting

### Common Issues

#### Workers Not Connecting
```bash
# Check Temporal server health
curl http://localhost:7233/health

# Check worker logs
docker logs temporal-payment-worker

# Verify network connectivity
telnet localhost 7233
```

#### Workflows Stuck
```bash
# Check workflow status
tctl workflow describe -w <workflow-id>

# Check worker capacity
# Prometheus query: temporal_worker_task_slots_available
```

#### High Latency
```bash
# Check database performance
# Check worker capacity
# Review workflow complexity
# Consider scaling
```

### Logs

```bash
# Temporal server logs
kubectl logs -f deployment/temporal-frontend -n temporal-system

# Worker logs
kubectl logs -f deployment/payment-worker -n temporal-system

# PostgreSQL logs
kubectl logs -f statefulset/temporal-postgresql -n temporal-system
```

---

## Performance Tuning

### Database Optimization
- Increase connection pool size
- Tune PostgreSQL parameters
- Add database indexes
- Enable query caching

### Worker Optimization
- Adjust concurrent activity execution
- Tune task queue polling
- Optimize activity code
- Use activity batching

### Workflow Optimization
- Minimize workflow state size
- Use continue-as-new for long workflows
- Optimize activity retry policies
- Use parallel activity execution

---

## Maintenance

### Regular Tasks
- Monitor disk usage
- Review workflow metrics
- Update dependencies
- Rotate logs
- Backup database

### Upgrades
1. **Review release notes**
2. **Test in staging**
3. **Backup production**
4. **Perform rolling upgrade**
5. **Verify functionality**

---

## Support

### Resources
- **Temporal Documentation**: https://docs.temporal.io
- **Temporal Community**: https://community.temporal.io
- **GitHub Issues**: https://github.com/temporalio/temporal

### Monitoring Alerts
Configure alerts for:
- Workflow failure rate > 5%
- Activity failure rate > 10%
- Worker task slots < 10%
- Database connection errors
- High workflow latency

---

**Last Updated**: October 24, 2024  
**Version**: 1.0.0

