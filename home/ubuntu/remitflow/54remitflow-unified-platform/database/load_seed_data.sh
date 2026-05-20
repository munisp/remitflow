#!/bin/bash
# Database Seed Data Loader
# Usage: ./load_seed_data.sh [database_url]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
DB_URL="${1:-postgresql://postgres:password@localhost:5432/remittance}"
SEED_FILE="$(dirname "$0")/seed_data.sql"

echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Remittance Platform - Load Seed Data             ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if PostgreSQL is accessible
echo -e "${YELLOW}Checking database connection...${NC}"
if psql "$DB_URL" -c "SELECT 1" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Database connection successful${NC}"
else
    echo -e "${RED}✗ Failed to connect to database${NC}"
    echo -e "${RED}  Database URL: $DB_URL${NC}"
    exit 1
fi

echo ""

# Check if seed file exists
if [ ! -f "$SEED_FILE" ]; then
    echo -e "${RED}✗ Seed file not found: $SEED_FILE${NC}"
    exit 1
fi

# Load seed data
echo -e "${YELLOW}Loading seed data...${NC}"
if psql "$DB_URL" -f "$SEED_FILE"; then
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║          Seed data loaded successfully!                 ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
else
    echo -e "${RED}✗ Failed to load seed data${NC}"
    exit 1
fi

