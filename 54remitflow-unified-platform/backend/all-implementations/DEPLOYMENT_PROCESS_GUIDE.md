# 🚀 One-Click Docker + Kubernetes Deployment Guide

## 📋 **Prerequisites**

### Required Software
```bash
# Check Docker
docker --version  # Should be 20.10+
docker-compose --version  # Should be 2.0+

# Check Go
go version  # Should be 1.21+

# Check Python
python3 --version  # Should be 3.11+

# Check Node.js
node --version  # Should be 20+
```

### System Requirements
- **CPU**: 4+ cores (8+ recommended for production)
- **Memory**: 8GB+ RAM (16GB+ recommended)
- **Storage**: 50GB+ available space
- **Network**: Stable internet connection for BCB API

---

## 🎯 **One-Click Deployment Process**

### **Step 1: Extract Package (10 seconds)**
```bash
# Extract the PIX integration package
tar -xzf nigerian-remittance-platform-PIX-INTEGRATION-v1.0.0.tar.gz
cd nigerian-remittance-platform-PIX-INTEGRATION-v1.0.0
```

### **Step 2: Configure Environment (30 seconds)**
```bash
# Copy production environment template
cp deployment/.env.production .env

# Edit environment variables (REQUIRED)
nano .env  # or vim .env
```

**Required Environment Variables:**
```env
# BCB (Central Bank of Brazil) Credentials
BCB_API_URL=https://api.bcb.gov.br/pix/v1
BCB_CLIENT_ID=your_bcb_client_id
BCB_CLIENT_SECRET=your_bcb_client_secret
BCB_CERTIFICATE_PATH=/path/to/bcb/certificate.pem

# Database Configuration
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=pix_integration
POSTGRES_USER=pix_user
POSTGRES_PASSWORD=secure_password_here

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=redis_password_here

# JWT Security
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRY=24h

# Exchange Rate APIs
EXCHANGE_API_KEY=your_exchange_api_key
EXCHANGE_API_URL=https://api.exchangerate-api.com/v4

# Monitoring
GRAFANA_ADMIN_PASSWORD=admin_password_here
PROMETHEUS_RETENTION=30d
```

### **Step 3: Execute One-Click Deployment (5-8 minutes)**
```bash
# Make deployment script executable
chmod +x scripts/deploy.sh

# Execute one-click deployment
./scripts/deploy.sh
```

---

## 🔄 **Deployment Process Breakdown**

### **Phase 1: Prerequisites Check (10 seconds)**
```bash
📋 Checking prerequisites...
✅ Docker found: 24.0.7
✅ Docker Compose found: 2.21.0
✅ Go found: 1.21.5
✅ Python found: 3.11.0
✅ All prerequisites satisfied
```

### **Phase 2: Environment Loading (20 seconds)**
```bash
⚙️ Loading environment variables...
✅ BCB credentials loaded
✅ Database configuration loaded
✅ Security keys loaded
✅ API keys loaded
```

### **Phase 3: Service Building (120-180 seconds)**
```bash
🏗️ Building all services...

Building Go services...
  📦 PIX Gateway: go build -o pix-gateway main.go
  📦 Brazilian Compliance: go build -o brazilian-compliance main.go
  📦 Integration Orchestrator: go build -o integration-orchestrator main.go
  📦 Enhanced API Gateway: go build -o enhanced-api-gateway main.go
  📦 Enhanced User Management: go build -o enhanced-user-management main.go
✅ Go services built successfully

Installing Python dependencies...
  📦 Flask + extensions
  📦 Prometheus client
  📦 Database connectors
✅ Python dependencies installed
```

### **Phase 4: Infrastructure Deployment (120-180 seconds)**
```bash
🚀 Deploying infrastructure...

Creating Docker network: pix-network
Creating Docker network: monitoring-network

Starting databases...
  🗄️ PostgreSQL primary database
  🗄️ PostgreSQL read replica
  💾 Redis cache cluster
✅ Databases started

Starting load balancer...
  🌐 Nginx with SSL termination
✅ Load balancer started

Starting monitoring...
  📊 Prometheus metrics collector
  📈 Grafana dashboard server
✅ Monitoring started
```

### **Phase 5: Microservice Deployment (60-120 seconds)**
```bash
🚀 Deploying microservices...

Starting PIX services...
  🇧🇷 PIX Gateway (Port 5001)
  💱 BRL Liquidity Manager (Port 5002)
  📋 Brazilian Compliance (Port 5003)
  🎧 Customer Support PT (Port 5004)
  🔗 Integration Orchestrator (Port 5005)
  🔄 Data Sync Service (Port 5006)
✅ PIX services started

Starting enhanced services...
  🏦 Enhanced TigerBeetle (Port 3011)
  📱 Enhanced Notifications (Port 3002)
  👤 Enhanced User Management (Port 3001)
  💰 Enhanced Stablecoin (Port 3003)
  🤖 Enhanced GNN (Port 4004)
  🌐 Enhanced API Gateway (Port 8000)
✅ Enhanced services started
```

### **Phase 6: Service Startup Wait (45 seconds)**
```bash
⏳ Waiting for services to start...
🔄 Services initializing...
🔄 Database connections establishing...
🔄 Cache warming up...
✅ All services ready
```

### **Phase 7: Health Checks (30-60 seconds)**
```bash
🏥 Running health checks...

Checking enhanced-api-gateway on port 8000...
✅ enhanced-api-gateway is healthy

Checking pix-gateway on port 5001...
✅ pix-gateway is healthy

Checking brl-liquidity on port 5002...
✅ brl-liquidity is healthy

Checking brazilian-compliance on port 5003...
✅ brazilian-compliance is healthy

Checking customer-support-pt on port 5004...
✅ customer-support-pt is healthy

Checking integration-orchestrator on port 5005...
✅ integration-orchestrator is healthy

Checking data-sync on port 5006...
✅ data-sync is healthy

Checking enhanced-tigerbeetle on port 3011...
✅ enhanced-tigerbeetle is healthy

Checking enhanced-notifications on port 3002...
✅ enhanced-notifications is healthy

Checking enhanced-user-management on port 3001...
✅ enhanced-user-management is healthy

Checking enhanced-stablecoin on port 3003...
✅ enhanced-stablecoin is healthy

Checking enhanced-gnn on port 4004...
✅ enhanced-gnn is healthy

✅ All 12 services passed health checks
```

### **Phase 8: Integration Testing (30 seconds)**
```bash
🧪 Running integration tests...

Running test_service_health_checks... ✅ PASSED
Running test_exchange_rates... ✅ PASSED
Running test_pix_key_validation... ✅ PASSED
Running test_currency_conversion... ✅ PASSED
Running test_cross_border_transfer... ✅ PASSED
Running test_fraud_detection... ✅ PASSED
Running test_compliance_check... ✅ PASSED
Running test_notification_system... ✅ PASSED
Running test_performance_load... ✅ PASSED

✅ All integration tests passed (96.8% success rate)
```

### **Phase 9: Final Monitoring Setup (30 seconds)**
```bash
📊 Setting up monitoring...

Starting Prometheus metrics collection...
✅ Prometheus started on port 9090

Starting Grafana dashboards...
✅ Grafana started on port 3000

Configuring dashboards...
✅ PIX Integration dashboard imported
✅ Performance metrics dashboard imported
✅ Security monitoring dashboard imported

✅ Monitoring setup completed
```

---

## 🎉 **Deployment Success Output**

```bash
🎉 PIX Integration deployment completed successfully!

🌐 Service Endpoints:
  • API Gateway: http://localhost:8000
  • PIX Gateway: http://localhost:5001
  • BRL Liquidity: http://localhost:5002
  • Brazilian Compliance: http://localhost:5003
  • Customer Support (PT): http://localhost:5004
  • Integration Orchestrator: http://localhost:5005

📊 Monitoring:
  • Grafana Dashboard: http://localhost:3000
  • Prometheus Metrics: http://localhost:9090

🧪 Test Transfer:
  curl -X POST http://localhost:5005/api/v1/transfers \
    -H 'Content-Type: application/json' \
    -d '{"sender_country":"Nigeria","recipient_country":"Brazil","sender_currency":"NGN","recipient_currency":"BRL","amount":50000,"sender_id":"USER_12345","recipient_id":"11122233344","payment_method":"PIX"}'

✅ Nigerian Remittance Platform with PIX Integration is now operational!
```

---

## 🔧 **Advanced Deployment Options**

### **Production Kubernetes Deployment**
```bash
# For production Kubernetes deployment
kubectl apply -f deployment/kubernetes/

# Verify deployment
kubectl get pods -n pix-integration
kubectl get services -n pix-integration
kubectl get ingress -n pix-integration
```

### **Cloud Provider Deployment**

#### **AWS EKS Deployment**
```bash
# Create EKS cluster
eksctl create cluster --name pix-integration --region us-east-1

# Deploy to EKS
kubectl apply -f deployment/aws-eks/
```

#### **Azure AKS Deployment**
```bash
# Create AKS cluster
az aks create --resource-group pix-rg --name pix-integration

# Deploy to AKS
kubectl apply -f deployment/azure-aks/
```

#### **Google GKE Deployment**
```bash
# Create GKE cluster
gcloud container clusters create pix-integration --zone us-central1-a

# Deploy to GKE
kubectl apply -f deployment/google-gke/
```

---

## 📊 **Monitoring & Observability**

### **Grafana Dashboards (http://localhost:3000)**
- **PIX Integration Overview** - Key metrics and KPIs
- **Service Performance** - Latency, throughput, error rates
- **Business Metrics** - Transaction volume, revenue, user growth
- **Security Dashboard** - Fraud detection, compliance alerts
- **Infrastructure Health** - CPU, memory, disk, network

### **Prometheus Metrics (http://localhost:9090)**
- **Application Metrics** - Custom business metrics
- **Infrastructure Metrics** - System resource utilization
- **Service Metrics** - Health, latency, error rates
- **Business Metrics** - Transaction counts, revenue tracking

### **Alert Conditions**
- **Service Down** - Any service unavailable >1 minute
- **High Error Rate** - Error rate >5% for 5 minutes
- **Low Liquidity** - BRL liquidity <10% available
- **Security Alert** - Fraud score >0.8 or compliance violation
- **Performance Degradation** - Latency >10 seconds for transfers

---

## 🛠️ **Troubleshooting**

### **Common Issues & Solutions**

#### **Service Won't Start**
```bash
# Check service logs
docker-compose logs [service-name]

# Restart specific service
docker-compose restart [service-name]

# Rebuild and restart
docker-compose up -d --build [service-name]
```

#### **Database Connection Issues**
```bash
# Check database status
docker-compose exec postgres pg_isready

# Reset database
docker-compose down postgres
docker volume rm pix_postgres_data
docker-compose up -d postgres
```

#### **BCB API Connection Issues**
```bash
# Verify BCB credentials
curl -H "Authorization: Bearer $BCB_ACCESS_TOKEN" $BCB_API_URL/health

# Check certificate
openssl x509 -in $BCB_CERTIFICATE_PATH -text -noout
```

### **Performance Optimization**
```bash
# Scale specific services
docker-compose up -d --scale pix-gateway=3
docker-compose up -d --scale brl-liquidity=2

# Monitor resource usage
docker stats

# Optimize database
docker-compose exec postgres psql -c "VACUUM ANALYZE;"
```

---

## ✅ **Deployment Verification Checklist**

### **✅ Infrastructure Health**
- [ ] PostgreSQL primary database running
- [ ] PostgreSQL read replica running  
- [ ] Redis cache cluster running
- [ ] Nginx load balancer running
- [ ] Prometheus metrics collector running
- [ ] Grafana dashboard server running

### **✅ PIX Services Health**
- [ ] PIX Gateway responding (Port 5001)
- [ ] BRL Liquidity Manager responding (Port 5002)
- [ ] Brazilian Compliance responding (Port 5003)
- [ ] Customer Support PT responding (Port 5004)
- [ ] Integration Orchestrator responding (Port 5005)
- [ ] Data Sync Service responding (Port 5006)

### **✅ Enhanced Services Health**
- [ ] Enhanced TigerBeetle responding (Port 3011)
- [ ] Enhanced Notifications responding (Port 3002)
- [ ] Enhanced User Management responding (Port 3001)
- [ ] Enhanced Stablecoin responding (Port 3003)
- [ ] Enhanced GNN responding (Port 4004)
- [ ] Enhanced API Gateway responding (Port 8000)

### **✅ End-to-End Functionality**
- [ ] Exchange rates retrievable
- [ ] PIX key validation working
- [ ] Currency conversion functional
- [ ] Cross-border transfer working
- [ ] Fraud detection active
- [ ] Compliance checking operational
- [ ] Portuguese notifications sending
- [ ] Monitoring data collecting

### **✅ Production Readiness**
- [ ] All health checks passing
- [ ] Integration tests passing (>95%)
- [ ] Performance targets met
- [ ] Security audit passed
- [ ] Compliance requirements satisfied
- [ ] Monitoring and alerting configured
- [ ] Documentation complete
- [ ] Support processes established

---

## 🎊 **Success Confirmation**

When deployment is successful, you should see:

### **✅ All Services Running**
```bash
$ docker-compose ps
NAME                    STATUS
postgres               Up (healthy)
redis                  Up (healthy)
nginx                  Up (healthy)
pix-gateway           Up (healthy)
brl-liquidity         Up (healthy)
brazilian-compliance  Up (healthy)
customer-support-pt   Up (healthy)
integration-orchestrator Up (healthy)
data-sync             Up (healthy)
enhanced-tigerbeetle  Up (healthy)
enhanced-notifications Up (healthy)
enhanced-user-management Up (healthy)
enhanced-stablecoin   Up (healthy)
enhanced-gnn          Up (healthy)
enhanced-api-gateway  Up (healthy)
prometheus            Up (healthy)
grafana               Up (healthy)
```

### **✅ API Gateway Responding**
```bash
$ curl http://localhost:8000/health
{
  "success": true,
  "data": {
    "service": "Enhanced API Gateway",
    "status": "healthy",
    "version": "1.0.0",
    "uptime": "5m30s",
    "connected_services": 11
  }
}
```

### **✅ PIX Transfer Test**
```bash
$ curl -X POST http://localhost:5005/api/v1/transfers \
  -H 'Content-Type: application/json' \
  -d '{
    "sender_country": "Nigeria",
    "recipient_country": "Brazil", 
    "sender_currency": "NGN",
    "recipient_currency": "BRL",
    "amount": 50000,
    "sender_id": "USER_12345",
    "recipient_id": "11122233344",
    "payment_method": "PIX"
  }'

{
  "success": true,
  "data": {
    "id": "TXN_PIX_123456",
    "status": "processing",
    "estimated_completion": "8 seconds",
    "exchange_rate": 0.0067,
    "fees": {
      "platform_fee": 400,
      "pix_fee": 0,
      "total_ngn": 400
    },
    "recipient_amount": 335.00,
    "recipient_currency": "BRL"
  }
}
```

---

## 🎯 **What Happens During One-Click Deployment**

### **🔧 Automated Service Building**
1. **Go Services Compilation** - All Go microservices built with optimizations
2. **Python Dependencies** - Flask, database drivers, monitoring clients installed
3. **Docker Images** - All services containerized with production configurations
4. **Configuration Validation** - Environment variables and secrets verified

### **🏗️ Infrastructure Orchestration**
1. **Network Creation** - Isolated Docker networks for security
2. **Volume Management** - Persistent storage for databases and logs
3. **Service Dependencies** - Proper startup order with health checks
4. **Load Balancer Setup** - Nginx configured with SSL and routing rules

### **📊 Monitoring Integration**
1. **Metrics Collection** - Prometheus scraping all service endpoints
2. **Dashboard Import** - Grafana dashboards automatically configured
3. **Alert Rules** - Production alerting rules activated
4. **Log Aggregation** - Centralized logging for all services

### **🔒 Security Configuration**
1. **Network Isolation** - Services communicate through private networks
2. **Secret Management** - Sensitive data encrypted and secured
3. **SSL Certificates** - HTTPS enabled for all external endpoints
4. **Access Control** - Authentication and authorization configured

---

## 🚀 **Production Deployment Considerations**

### **🌍 Multi-Region Deployment**
```bash
# Deploy to multiple regions for high availability
./scripts/deploy.sh --region us-east-1
./scripts/deploy.sh --region sa-east-1  # São Paulo for Brazil
./scripts/deploy.sh --region eu-west-1  # London for backup
```

### **📈 Auto-Scaling Configuration**
```yaml
# Kubernetes HPA configuration
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: pix-gateway-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: pix-gateway
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

### **🔄 Blue-Green Deployment**
```bash
# Deploy to green environment
./scripts/deploy.sh --environment green

# Test green environment
./scripts/test.sh --environment green

# Switch traffic to green
./scripts/switch-traffic.sh --to green

# Cleanup blue environment
./scripts/cleanup.sh --environment blue
```

This one-click deployment process ensures that the complete Brazilian PIX integration is deployed, tested, and ready for production use in under 10 minutes.
