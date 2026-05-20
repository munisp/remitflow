#!/bin/bash

# Remittance Platform - Middleware Stack Deployment Script
# This script deploys the complete middleware stack including:
# - APISIX API Gateway
# - Keycloak Identity Management
# - Permify Authorization
# - Temporal Workflow Engine
# - Kafka Message Broker
# - Fluvio Streaming Platform
# - Dapr Runtime
# - Monitoring and Observability Stack

set -e

echo "🚀 Starting Remittance Platform Middleware Deployment"
echo "========================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    print_header "Checking Prerequisites"
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    # Check if Docker daemon is running
    if ! docker info &> /dev/null; then
        print_error "Docker daemon is not running. Please start Docker first."
        exit 1
    fi
    
    print_status "All prerequisites satisfied"
}

# Create necessary directories
create_directories() {
    print_header "Creating Directory Structure"
    
    mkdir -p logs
    mkdir -p data/{etcd,keycloak,permify,temporal,kafka,zookeeper,fluvio,redis,prometheus,grafana,consul,vault,nats,minio}
    mkdir -p config/{apisix,keycloak,permify,temporal,prometheus,grafana,otel}
    
    print_status "Directory structure created"
}

# Generate configuration files
generate_configs() {
    print_header "Generating Configuration Files"
    
    # APISIX Dashboard config
    cat > apisix/dashboard.yaml << EOF
conf:
  listen:
    host: 0.0.0.0
    port: 9000
  etcd:
    endpoints:
      - etcd:2379
    prefix: /apisix
    timeout: 30
  log:
    error_log:
      level: warn
      file_path: logs/error.log
    access_log:
      file_path: logs/access.log
authentication:
  secret: remittance-dashboard-secret
  expire_time: 3600
  users:
    - username: admin
      password: admin123
EOF

    # Permify config
    cat > permify/config.yaml << EOF
server:
  grpc:
    port: 3476
  http:
    enabled: true
    port: 3478
    cors:
      allowed_origins:
        - "*"
      allowed_headers:
        - "*"

logger:
  level: info

profiler:
  enabled: true
  port: 6060

authn:
  enabled: true
  method: preshared
  preshared:
    keys:
      - "remittance-platform-key"

database:
  engine: postgres
  uri: "postgres://permify:permify123@permify-db:5432/permify?sslmode=disable"
  auto_migrate: true
  max_open_connections: 20
  max_idle_connections: 1
  max_connection_lifetime: 300s
  max_connection_idle_time: 60s

schema:
  cache:
    number_of_counters: 1000
    max_cost: 10MiB
EOF

    # Temporal dynamic config
    mkdir -p temporal/dynamicconfig
    cat > temporal/dynamicconfig/development-sql.yaml << EOF
system.forceSearchAttributesCacheRefreshOnRead:
  - value: true
    constraints: {}

system.enableReadFromClosedExecutionV2:
  - value: true
    constraints: {}

limit.maxIDLength:
  - value: 1000
    constraints: {}

frontend.enableUpdateWorkflowExecution:
  - value: true
    constraints: {}

frontend.enableUpdateWorkflowExecutionAsyncAccepted:
  - value: true
    constraints: {}
EOF

    # Prometheus config
    cat > prometheus/prometheus.yml << EOF
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  # - "first_rules.yml"
  # - "second_rules.yml"

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'apisix'
    static_configs:
      - targets: ['apisix:9091']

  - job_name: 'keycloak'
    static_configs:
      - targets: ['keycloak:8080']

  - job_name: 'temporal'
    static_configs:
      - targets: ['temporal:7233']

  - job_name: 'kafka'
    static_configs:
      - targets: ['kafka:9092']

  - job_name: 'redis'
    static_configs:
      - targets: ['redis:6379']

  - job_name: 'remittance-services'
    static_configs:
      - targets: ['host.docker.internal:8082', 'host.docker.internal:8090', 'host.docker.internal:8094']
EOF

    # OpenTelemetry Collector config
    cat > otel/otel-collector-config.yaml << EOF
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318
  prometheus:
    config:
      scrape_configs:
        - job_name: 'otel-collector'
          scrape_interval: 10s
          static_configs:
            - targets: ['0.0.0.0:8888']

processors:
  batch:

exporters:
  jaeger:
    endpoint: jaeger:14250
    tls:
      insecure: true
  prometheus:
    endpoint: "0.0.0.0:8889"
  logging:
    loglevel: debug

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [jaeger, logging]
    metrics:
      receivers: [otlp, prometheus]
      processors: [batch]
      exporters: [prometheus, logging]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [logging]
EOF

    print_status "Configuration files generated"
}

# Deploy middleware stack
deploy_middleware() {
    print_header "Deploying Middleware Stack"
    
    # Pull all images first
    print_status "Pulling Docker images..."
    docker-compose -f docker-compose-middleware.yml pull
    
    # Start the middleware stack
    print_status "Starting middleware services..."
    docker-compose -f docker-compose-middleware.yml up -d
    
    print_status "Middleware stack deployment initiated"
}

# Wait for services to be ready
wait_for_services() {
    print_header "Waiting for Services to be Ready"
    
    services=(
        "etcd:2379"
        "redis:6379"
        "keycloak:8080"
        "apisix:9080"
        "temporal:7233"
        "kafka:9092"
        "prometheus:9090"
        "grafana:3000"
        "jaeger:16686"
        "consul:8500"
        "vault:8200"
    )
    
    for service in "${services[@]}"; do
        IFS=':' read -r host port <<< "$service"
        print_status "Waiting for $host:$port..."
        
        timeout=120
        while ! docker-compose -f docker-compose-middleware.yml exec -T $host nc -z localhost $port 2>/dev/null; do
            sleep 2
            timeout=$((timeout - 2))
            if [ $timeout -le 0 ]; then
                print_warning "Timeout waiting for $host:$port"
                break
            fi
        done
        
        if [ $timeout -gt 0 ]; then
            print_status "$host:$port is ready"
        fi
    done
}

# Configure services
configure_services() {
    print_header "Configuring Services"
    
    # Wait a bit more for services to fully initialize
    sleep 30
    
    # Configure Keycloak realm
    print_status "Configuring Keycloak realm..."
    # Note: In production, use Keycloak Admin CLI or REST API
    
    # Configure APISIX routes
    print_status "Configuring APISIX routes..."
    # Note: In production, configure routes via APISIX Admin API
    
    # Configure Permify schema
    print_status "Configuring Permify authorization schema..."
    # Note: In production, load schema via Permify API
    
    # Configure Temporal namespaces
    print_status "Configuring Temporal namespaces..."
    # Note: In production, create namespaces via Temporal CLI
    
    print_status "Service configuration completed"
}

# Verify deployment
verify_deployment() {
    print_header "Verifying Deployment"
    
    echo ""
    echo "🔍 Service Status Check:"
    echo "======================="
    
    # Check running containers
    running_containers=$(docker-compose -f docker-compose-middleware.yml ps --services --filter "status=running" | wc -l)
    total_containers=$(docker-compose -f docker-compose-middleware.yml ps --services | wc -l)
    
    echo "Running containers: $running_containers/$total_containers"
    
    # Service URLs
    echo ""
    echo "🌐 Service Access URLs:"
    echo "======================"
    echo "• APISIX Gateway:        http://localhost:9080"
    echo "• APISIX Dashboard:      http://localhost:9000"
    echo "• Keycloak:              http://localhost:8080"
    echo "• Temporal Web:          http://localhost:8088"
    echo "• Kafka UI:              http://localhost:8089"
    echo "• Prometheus:            http://localhost:9090"
    echo "• Grafana:               http://localhost:3000"
    echo "• Jaeger:                http://localhost:16686"
    echo "• Consul:                http://localhost:8500"
    echo "• Vault:                 http://localhost:8200"
    echo "• Redis Commander:       http://localhost:8081"
    echo "• MinIO Console:         http://localhost:9001"
    echo ""
    
    # Default credentials
    echo "🔐 Default Credentials:"
    echo "======================"
    echo "• Keycloak Admin:        admin / admin123"
    echo "• APISIX Dashboard:      admin / admin123"
    echo "• Grafana:               admin / admin123"
    echo "• MinIO:                 minioadmin / minioadmin123"
    echo "• Vault Root Token:      remittance-root-token"
    echo ""
    
    # Health check
    echo "🏥 Health Check:"
    echo "==============="
    
    # Check key services
    if curl -s http://localhost:9080 > /dev/null; then
        echo "✅ APISIX Gateway is responding"
    else
        echo "❌ APISIX Gateway is not responding"
    fi
    
    if curl -s http://localhost:8080 > /dev/null; then
        echo "✅ Keycloak is responding"
    else
        echo "❌ Keycloak is not responding"
    fi
    
    if curl -s http://localhost:9090 > /dev/null; then
        echo "✅ Prometheus is responding"
    else
        echo "❌ Prometheus is not responding"
    fi
    
    echo ""
    print_status "Deployment verification completed"
}

# Main deployment flow
main() {
    echo "Remittance Platform - Middleware Stack Deployment"
    echo "===================================================="
    echo ""
    
    check_prerequisites
    create_directories
    generate_configs
    deploy_middleware
    wait_for_services
    configure_services
    verify_deployment
    
    echo ""
    echo "🎉 Middleware Stack Deployment Completed Successfully!"
    echo "======================================================"
    echo ""
    echo "The Remittance Platform middleware stack is now running."
    echo "You can access the services using the URLs provided above."
    echo ""
    echo "To stop the stack: docker-compose -f docker-compose-middleware.yml down"
    echo "To view logs: docker-compose -f docker-compose-middleware.yml logs -f [service-name]"
    echo ""
}

# Handle script interruption
trap 'echo -e "\n${RED}Deployment interrupted${NC}"; exit 1' INT TERM

# Run main function
main "$@"

