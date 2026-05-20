#!/bin/bash
# Database Migration Runner
# Usage: ./run_migrations.sh [database_url]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
DB_URL="${1:-postgresql://postgres:password@localhost:5432/remittance}"
MIGRATIONS_DIR="$(dirname "$0")/migrations"

echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Remittance Platform - Database Migrations        ║${NC}"
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

# Run migrations in order
echo -e "${YELLOW}Running migrations...${NC}"
echo ""

for migration in "$MIGRATIONS_DIR"/*.sql; do
    if [ -f "$migration" ]; then
        filename=$(basename "$migration")
        echo -e "${YELLOW}Running migration: $filename${NC}"
        
        if psql "$DB_URL" -f "$migration" > /dev/null 2>&1; then
            echo -e "${GREEN}✓ Migration completed: $filename${NC}"
        else
            echo -e "${RED}✗ Migration failed: $filename${NC}"
            exit 1
        fi
        echo ""
    fi
done

echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║          All migrations completed successfully!          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"

