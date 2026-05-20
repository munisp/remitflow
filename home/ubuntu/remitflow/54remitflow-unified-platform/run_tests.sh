#!/bin/bash
# Test Runner Script for Remittance Platform

set -e

echo "=================================="
echo "Remittance Platform Test Runner"
echo "=================================="

# Colors
GREEN='\033[0.32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to run tests
run_tests() {
    local test_type=$1
    echo ""
    echo "Running $test_type tests..."
    
    if make test-$test_type; then
        echo -e "${GREEN}✅ $test_type tests PASSED${NC}"
        return 0
    else
        echo -e "${RED}❌ $test_type tests FAILED${NC}"
        return 1
    fi
}

# Parse arguments
TEST_TYPE=${1:-all}

case $TEST_TYPE in
    unit)
        run_tests unit
        ;;
    integration)
        run_tests integration
        ;;
    e2e)
        run_tests e2e
        ;;
    performance)
        run_tests performance
        ;;
    load)
        run_tests load
        ;;
    all)
        run_tests unit
        run_tests integration
        run_tests e2e
        run_tests performance
        echo ""
        echo "=================================="
        echo -e "${GREEN}✅ ALL TESTS PASSED${NC}"
        echo "=================================="
        ;;
    *)
        echo "Usage: $0 {unit|integration|e2e|performance|load|all}"
        exit 1
        ;;
esac
