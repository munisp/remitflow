#!/bin/bash
set -e

# Performance Fixes Deployment Script
# Deploys all performance optimizations to the Nigerian Remittance Platform

echo "🚀 Starting Performance Fixes Deployment"
echo "========================================"

# Configuration
NAMESPACE="remittance-platform"
DEPLOYMENT_ENV="${DEPLOYMENT_ENV:-production}"
BACKUP_DIR="/tmp/performance-fixes-backup-$(date +%Y%m%d-%H%M%S)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed"
        exit 1
    fi
    
    # Check helm
    if ! command -v helm &> /dev/null; then
        log_error "helm is not installed"
        exit 1
    fi
    
    # Check docker
    if ! command -v docker &> /dev/null; then
        log_error "docker is not installed"
        exit 1
    fi
    
    # Check cluster connectivity
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Create backup
create_backup() {
    log_info "Creating backup..."
    
    mkdir -p "$BACKUP_DIR"
    
    # Backup current deployments
    kubectl get deployments -n "$NAMESPACE" -o yaml > "$BACKUP_DIR/deployments.yaml"
    kubectl get services -n "$NAMESPACE" -o yaml > "$BACKUP_DIR/services.yaml"
    kubectl get configmaps -n "$NAMESPACE" -o yaml > "$BACKUP_DIR/configmaps.yaml"
    
    log_success "Backup created at $BACKUP_DIR"
}

# Deploy circuit breaker
deploy_circuit_breaker() {
    log_info "Deploying circuit breaker service..."
    
    cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: circuit-breaker-service
  namespace: $NAMESPACE
spec:
  replicas: 3
  selector:
    matchLabels:
      app: circuit-breaker-service
  template:
    metadata:
      labels:
        app: circuit-breaker-service
    spec:
      containers:
      - name: circuit-breaker
        image: nigerian-remittance/circuit-breaker:latest
        ports:
        - containerPort: 8080
        env:
        - name: MAX_REQUESTS
          value: "100"
        - name: TIMEOUT
          value: "60s"
        - name: FAILURE_THRESHOLD
          value: "5"
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "256Mi"
            cpu: "200m"
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: circuit-breaker-service
  namespace: $NAMESPACE
spec:
  selector:
    app: circuit-breaker-service
  ports:
  - port: 80
    targetPort: 8080
  type: ClusterIP
EOF
    
    log_success "Circuit breaker service deployed"
}

# Deploy connection pool optimizer
deploy_connection_pool() {
    log_info "Deploying connection pool optimizer..."
    
    # Update database connection configurations
    kubectl patch configmap database-config -n "$NAMESPACE" --patch='
{
  "data": {
    "MAX_OPEN_CONNS": "200",
    "MAX_IDLE_CONNS": "50",
    "CONN_MAX_LIFETIME": "3m",
    "CONN_MAX_IDLE_TIME": "2m",
    "HEALTH_CHECK_PERIOD": "30s"
  }
}'
    
    # Restart services to pick up new configuration
    kubectl rollout restart deployment/api-gateway -n "$NAMESPACE"
    kubectl rollout restart deployment/pix-gateway -n "$NAMESPACE"
    kubectl rollout restart deployment/user-management -n "$NAMESPACE"
    
    log_success "Connection pool optimizer deployed"
}

# Deploy worker pool
deploy_worker_pool() {
    log_info "Deploying worker pool service..."
    
    cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker-pool-service
  namespace: $NAMESPACE
spec:
  replicas: 5
  selector:
    matchLabels:
      app: worker-pool-service
  template:
    metadata:
      labels:
        app: worker-pool-service
    spec:
      containers:
      - name: worker-pool
        image: nigerian-remittance/worker-pool:latest
        ports:
        - containerPort: 8080
        env:
        - name: WORKER_COUNT
          value: "20"
        - name: QUEUE_SIZE
          value: "10000"
        - name: MAX_QUEUE_SIZE
          value: "50000"
        - name: WORKER_TIMEOUT
          value: "30s"
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: worker-pool-service
  namespace: $NAMESPACE
spec:
  selector:
    app: worker-pool-service
  ports:
  - port: 80
    targetPort: 8080
  type: ClusterIP
EOF
    
    log_success "Worker pool service deployed"
}

# Deploy memory manager
deploy_memory_manager() {
    log_info "Deploying memory manager..."
    
    # Update memory management configurations
    kubectl patch configmap memory-config -n "$NAMESPACE" --patch='
{
  "data": {
    "MAX_HEAP_SIZE": "2147483648",
    "GC_TARGET_PERCENT": "100",
    "GC_INTERVAL": "2m",
    "MONITOR_INTERVAL": "10s",
    "ALERT_THRESHOLD": "0.8",
    "ENABLE_AUTO_GC": "true",
    "ENABLE_MEMORY_LIMIT": "true"
  }
}'
    
    # Deploy memory monitoring service
    cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: memory-monitor
  namespace: $NAMESPACE
spec:
  selector:
    matchLabels:
      app: memory-monitor
  template:
    metadata:
      labels:
        app: memory-monitor
    spec:
      containers:
      - name: memory-monitor
        image: nigerian-remittance/memory-monitor:latest
        ports:
        - containerPort: 8080
        env:
        - name: NODE_NAME
          valueFrom:
            fieldRef:
              fieldPath: spec.nodeName
        resources:
          requests:
            memory: "64Mi"
            cpu: "50m"
          limits:
            memory: "128Mi"
            cpu: "100m"
        volumeMounts:
        - name: proc
          mountPath: /host/proc
          readOnly: true
        - name: sys
          mountPath: /host/sys
          readOnly: true
      volumes:
      - name: proc
        hostPath:
          path: /proc
      - name: sys
        hostPath:
          path: /sys
      hostNetwork: true
      hostPID: true
EOF
    
    log_success "Memory manager deployed"
}

# Deploy object pools
deploy_object_pools() {
    log_info "Deploying object pools..."
    
    # Update object pool configurations
    kubectl patch configmap object-pool-config -n "$NAMESPACE" --patch='
{
  "data": {
    "FRAUD_DETECTION_POOL_SIZE": "1000",
    "ML_MODEL_POOL_SIZE": "500",
    "BYTE_BUFFER_POOL_SIZE": "1000",
    "BYTE_BUFFER_INITIAL_SIZE": "1024",
    "ENABLE_OBJECT_POOLING": "true"
  }
}'
    
    log_success "Object pools deployed"
}

# Update HPA configurations
update_hpa() {
    log_info "Updating Horizontal Pod Autoscaler configurations..."
    
    # Update HPA for API Gateway
    cat <<EOF | kubectl apply -f -
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-gateway-hpa
  namespace: $NAMESPACE
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-gateway
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 100
        periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 10
        periodSeconds: 60
EOF
    
    # Update HPA for PIX Gateway
    cat <<EOF | kubectl apply -f -
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: pix-gateway-hpa
  namespace: $NAMESPACE
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: pix-gateway
  minReplicas: 2
  maxReplicas: 15
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
EOF
    
    log_success "HPA configurations updated"
}

# Deploy monitoring
deploy_monitoring() {
    log_info "Deploying performance monitoring..."
    
    # Deploy Prometheus rules for performance monitoring
    cat <<EOF | kubectl apply -f -
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: performance-alerts
  namespace: $NAMESPACE
spec:
  groups:
  - name: performance.rules
    rules:
    - alert: HighResponseTime
      expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 1
      for: 2m
      labels:
        severity: warning
      annotations:
        summary: "High response time detected"
        description: "95th percentile response time is above 1 second"
    
    - alert: HighErrorRate
      expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05
      for: 1m
      labels:
        severity: critical
      annotations:
        summary: "High error rate detected"
        description: "Error rate is above 5%"
    
    - alert: MemoryUsageHigh
      expr: (node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes > 0.9
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "High memory usage"
        description: "Memory usage is above 90%"
    
    - alert: CircuitBreakerOpen
      expr: circuit_breaker_state == 2
      for: 1m
      labels:
        severity: critical
      annotations:
        summary: "Circuit breaker is open"
        description: "Circuit breaker {{ $labels.name }} is in open state"
EOF
    
    log_success "Performance monitoring deployed"
}

# Verify deployment
verify_deployment() {
    log_info "Verifying deployment..."
    
    # Check all pods are running
    log_info "Checking pod status..."
    kubectl get pods -n "$NAMESPACE" | grep -E "(circuit-breaker|worker-pool|memory-monitor)"
    
    # Check services are accessible
    log_info "Checking service health..."
    
    # Wait for services to be ready
    kubectl wait --for=condition=available --timeout=300s deployment/circuit-breaker-service -n "$NAMESPACE" || true
    kubectl wait --for=condition=available --timeout=300s deployment/worker-pool-service -n "$NAMESPACE" || true
    
    # Test service endpoints
    if kubectl exec -n "$NAMESPACE" deployment/api-gateway -- curl -f http://circuit-breaker-service/health; then
        log_success "Circuit breaker service is healthy"
    else
        log_warning "Circuit breaker service health check failed"
    fi
    
    if kubectl exec -n "$NAMESPACE" deployment/api-gateway -- curl -f http://worker-pool-service/health; then
        log_success "Worker pool service is healthy"
    else
        log_warning "Worker pool service health check failed"
    fi
    
    log_success "Deployment verification completed"
}

# Run performance tests
run_performance_tests() {
    log_info "Running performance tests..."
    
    # Get API Gateway external IP
    API_GATEWAY_IP=$(kubectl get service api-gateway -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
    if [ -z "$API_GATEWAY_IP" ]; then
        API_GATEWAY_IP="localhost:8000"
        log_warning "Using localhost for testing. Make sure to port-forward the API Gateway service."
    fi
    
    # Run basic load test
    python3 ../performance-testing-suite/performance_test_runner.py \
        --base-url "http://$API_GATEWAY_IP" \
        --test-type load \
        --users 100 \
        --duration 60 \
        --output "post_deployment_performance_report.json"
    
    log_success "Performance tests completed"
}

# Rollback function
rollback() {
    log_warning "Rolling back deployment..."
    
    if [ -d "$BACKUP_DIR" ]; then
        kubectl apply -f "$BACKUP_DIR/deployments.yaml"
        kubectl apply -f "$BACKUP_DIR/services.yaml"
        kubectl apply -f "$BACKUP_DIR/configmaps.yaml"
        log_success "Rollback completed"
    else
        log_error "Backup directory not found. Manual rollback required."
    fi
}

# Main deployment function
main() {
    log_info "Starting performance fixes deployment for environment: $DEPLOYMENT_ENV"
    
    # Set trap for cleanup on exit
    trap 'log_error "Deployment failed. Check logs above."; exit 1' ERR
    
    check_prerequisites
    create_backup
    
    # Deploy performance fixes
    deploy_circuit_breaker
    deploy_connection_pool
    deploy_worker_pool
    deploy_memory_manager
    deploy_object_pools
    update_hpa
    deploy_monitoring
    
    # Verify deployment
    verify_deployment
    
    # Run performance tests
    if [ "$DEPLOYMENT_ENV" != "production" ]; then
        run_performance_tests
    fi
    
    log_success "🎉 Performance fixes deployment completed successfully!"
    log_info "Backup location: $BACKUP_DIR"
    log_info "Monitor the system for the next 24 hours to ensure stability."
    
    # Print summary
    echo ""
    echo "📊 Deployment Summary:"
    echo "  ✅ Circuit Breaker Service: Deployed"
    echo "  ✅ Connection Pool Optimization: Applied"
    echo "  ✅ Worker Pool Service: Deployed"
    echo "  ✅ Memory Manager: Deployed"
    echo "  ✅ Object Pools: Configured"
    echo "  ✅ HPA Configurations: Updated"
    echo "  ✅ Performance Monitoring: Deployed"
    echo ""
    echo "🔍 Next Steps:"
    echo "  1. Monitor system performance for 24 hours"
    echo "  2. Run comprehensive performance tests"
    echo "  3. Adjust configurations based on observed metrics"
    echo "  4. Update documentation with new configurations"
}

# Handle command line arguments
case "${1:-deploy}" in
    deploy)
        main
        ;;
    rollback)
        rollback
        ;;
    verify)
        verify_deployment
        ;;
    test)
        run_performance_tests
        ;;
    *)
        echo "Usage: $0 {deploy|rollback|verify|test}"
        echo "  deploy   - Deploy performance fixes (default)"
        echo "  rollback - Rollback to previous version"
        echo "  verify   - Verify current deployment"
        echo "  test     - Run performance tests"
        exit 1
        ;;
esac
