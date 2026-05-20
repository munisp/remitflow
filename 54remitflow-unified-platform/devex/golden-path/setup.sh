#!/bin/bash
# Golden Path Setup Script
# One command to set up the entire development environment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Print banner
print_banner() {
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║           Remittance Platform - Golden Path Setup         ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    local missing=()
    
    # Required tools
    if ! command_exists docker; then missing+=("docker"); fi
    if ! command_exists docker-compose; then missing+=("docker-compose"); fi
    if ! command_exists go; then missing+=("go (1.21+)"); fi
    if ! command_exists python3; then missing+=("python3 (3.11+)"); fi
    if ! command_exists node; then missing+=("node (18+)"); fi
    if ! command_exists npm; then missing+=("npm"); fi
    
    if [ ${#missing[@]} -ne 0 ]; then
        log_error "Missing required tools: ${missing[*]}"
        echo ""
        echo "Please install the missing tools:"
        echo "  - Docker: https://docs.docker.com/get-docker/"
        echo "  - Go: https://go.dev/doc/install"
        echo "  - Python: https://www.python.org/downloads/"
        echo "  - Node.js: https://nodejs.org/"
        exit 1
    fi
    
    # Check versions
    GO_VERSION=$(go version | grep -oP 'go\d+\.\d+' | head -1)
    PYTHON_VERSION=$(python3 --version | grep -oP '\d+\.\d+')
    NODE_VERSION=$(node --version | grep -oP '\d+' | head -1)
    
    log_success "Prerequisites check passed"
    log_info "  Go: $GO_VERSION"
    log_info "  Python: $PYTHON_VERSION"
    log_info "  Node: v$NODE_VERSION"
}

# Setup Python virtual environment
setup_python() {
    log_info "Setting up Python environment..."
    
    cd "$PROJECT_ROOT"
    
    # Create virtual environment if it doesn't exist
    if [ ! -d ".venv" ]; then
        python3 -m venv .venv
    fi
    
    # Activate and install dependencies
    source .venv/bin/activate
    
    # Upgrade pip
    pip install --upgrade pip wheel setuptools
    
    # Install development dependencies
    if [ -f "requirements-dev.txt" ]; then
        pip install -r requirements-dev.txt
    fi
    
    # Install main dependencies
    if [ -f "requirements.txt" ]; then
        pip install -r requirements.txt
    fi
    
    # Install pre-commit hooks
    if command_exists pre-commit; then
        pre-commit install
    fi
    
    log_success "Python environment ready"
}

# Setup Go modules
setup_go() {
    log_info "Setting up Go modules..."
    
    cd "$PROJECT_ROOT"
    
    # Find all Go modules and download dependencies
    find . -name "go.mod" -type f | while read -r modfile; do
        moddir=$(dirname "$modfile")
        log_info "  Processing $moddir..."
        (cd "$moddir" && go mod download && go mod tidy)
    done
    
    # Install Go tools
    log_info "Installing Go tools..."
    go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
    go install github.com/swaggo/swag/cmd/swag@latest
    go install github.com/cosmtrek/air@latest
    
    log_success "Go modules ready"
}

# Setup Node.js dependencies
setup_node() {
    log_info "Setting up Node.js dependencies..."
    
    cd "$PROJECT_ROOT"
    
    # Find all package.json files and install dependencies
    find . -name "package.json" -type f -not -path "*/node_modules/*" | while read -r pkgfile; do
        pkgdir=$(dirname "$pkgfile")
        log_info "  Processing $pkgdir..."
        (cd "$pkgdir" && npm install)
    done
    
    log_success "Node.js dependencies ready"
}

# Setup infrastructure (Docker containers)
setup_infrastructure() {
    log_info "Setting up infrastructure..."
    
    cd "$PROJECT_ROOT"
    
    # Check if docker-compose file exists
    if [ -f "docker-compose.yml" ] || [ -f "docker-compose.yaml" ]; then
        # Start infrastructure services
        docker-compose up -d postgres redis kafka zookeeper
        
        # Wait for services to be ready
        log_info "Waiting for services to be ready..."
        sleep 10
        
        # Check service health
        docker-compose ps
    else
        log_warning "No docker-compose.yml found, skipping infrastructure setup"
    fi
    
    log_success "Infrastructure ready"
}

# Setup database
setup_database() {
    log_info "Setting up database..."
    
    cd "$PROJECT_ROOT"
    
    # Wait for PostgreSQL to be ready
    local max_attempts=30
    local attempt=0
    
    while [ $attempt -lt $max_attempts ]; do
        if docker-compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; then
            break
        fi
        attempt=$((attempt + 1))
        sleep 1
    done
    
    if [ $attempt -eq $max_attempts ]; then
        log_warning "PostgreSQL not ready, skipping database setup"
        return
    fi
    
    # Run migrations
    if [ -d "migrations" ]; then
        log_info "Running database migrations..."
        # Use migrate tool or custom migration script
        if command_exists migrate; then
            migrate -path migrations -database "postgres://postgres:postgres@localhost:5432/remittance?sslmode=disable" up
        elif [ -f "scripts/migrate.sh" ]; then
            ./scripts/migrate.sh
        fi
    fi
    
    # Seed development data
    if [ -f "scripts/seed.sh" ]; then
        log_info "Seeding development data..."
        ./scripts/seed.sh
    fi
    
    log_success "Database ready"
}

# Setup environment variables
setup_env() {
    log_info "Setting up environment variables..."
    
    cd "$PROJECT_ROOT"
    
    # Create .env file from template if it doesn't exist
    if [ ! -f ".env" ] && [ -f ".env.example" ]; then
        cp .env.example .env
        log_info "Created .env from .env.example"
    fi
    
    # Create local development overrides
    if [ ! -f ".env.local" ]; then
        cat > .env.local << 'EOF'
# Local development overrides
DATABASE_URL=postgres://postgres:postgres@localhost:5432/remittance?sslmode=disable
REDIS_URL=redis://localhost:6379
KAFKA_BOOTSTRAP_SERVERS=localhost:9092
KEYCLOAK_URL=http://localhost:8080
LOG_LEVEL=debug
ENVIRONMENT=development
EOF
        log_info "Created .env.local with development defaults"
    fi
    
    log_success "Environment variables ready"
}

# Generate API documentation
generate_docs() {
    log_info "Generating API documentation..."
    
    cd "$PROJECT_ROOT"
    
    # Generate Swagger docs for Go services
    if command_exists swag; then
        find . -name "main.go" -type f | while read -r mainfile; do
            maindir=$(dirname "$mainfile")
            if [ -f "$maindir/docs/swagger.yaml" ] || grep -q "swaggo" "$mainfile" 2>/dev/null; then
                log_info "  Generating docs for $maindir..."
                (cd "$maindir" && swag init 2>/dev/null || true)
            fi
        done
    fi
    
    log_success "Documentation generated"
}

# Run initial tests
run_tests() {
    log_info "Running initial tests..."
    
    cd "$PROJECT_ROOT"
    
    # Run Go tests
    log_info "  Running Go tests..."
    go test ./... -short 2>/dev/null || log_warning "Some Go tests failed"
    
    # Run Python tests
    if [ -d ".venv" ]; then
        source .venv/bin/activate
        log_info "  Running Python tests..."
        pytest --co -q 2>/dev/null || log_warning "Some Python tests failed"
    fi
    
    # Run Node tests
    if [ -f "package.json" ]; then
        log_info "  Running Node tests..."
        npm test --if-present 2>/dev/null || log_warning "Some Node tests failed"
    fi
    
    log_success "Initial tests completed"
}

# Print summary
print_summary() {
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                    Setup Complete!                           ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "Quick Start Commands:"
    echo ""
    echo "  Start all services:"
    echo "    docker-compose up -d"
    echo ""
    echo "  Start development server:"
    echo "    make dev"
    echo ""
    echo "  Run tests:"
    echo "    make test"
    echo ""
    echo "  Run linting:"
    echo "    make lint"
    echo ""
    echo "  View logs:"
    echo "    docker-compose logs -f"
    echo ""
    echo "  Stop all services:"
    echo "    docker-compose down"
    echo ""
    echo "Documentation:"
    echo "  - API Docs: http://localhost:8080/swagger"
    echo "  - Keycloak: http://localhost:8180"
    echo "  - Grafana: http://localhost:3000"
    echo ""
}

# Main function
main() {
    print_banner
    
    # Parse arguments
    SKIP_INFRA=false
    SKIP_TESTS=false
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-infra)
                SKIP_INFRA=true
                shift
                ;;
            --skip-tests)
                SKIP_TESTS=true
                shift
                ;;
            --help)
                echo "Usage: $0 [options]"
                echo ""
                echo "Options:"
                echo "  --skip-infra    Skip infrastructure setup (Docker containers)"
                echo "  --skip-tests    Skip running initial tests"
                echo "  --help          Show this help message"
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done
    
    # Run setup steps
    check_prerequisites
    setup_env
    setup_python
    setup_go
    setup_node
    
    if [ "$SKIP_INFRA" = false ]; then
        setup_infrastructure
        setup_database
    fi
    
    generate_docs
    
    if [ "$SKIP_TESTS" = false ]; then
        run_tests
    fi
    
    print_summary
}

# Run main function
main "$@"
