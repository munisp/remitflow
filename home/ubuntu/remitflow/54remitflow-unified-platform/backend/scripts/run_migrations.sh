#!/bin/bash
# RemitFlow Database Migration Runner
# Runs all SQL migrations in order. Safe to run on every deploy (idempotent).
set -euo pipefail

MIGRATIONS_DIR="${MIGRATIONS_DIR:-$(dirname "$0")/../migrations}"
DB_URL="${DATABASE_URL}"

if [ -z "$DB_URL" ]; then
    echo "ERROR: DATABASE_URL is not set"
    exit 1
fi

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

log "Starting database migrations from: $MIGRATIONS_DIR"

# Create migrations tracking table if it doesn't exist
psql "$DB_URL" << 'SQLEOF'
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checksum VARCHAR(64) NOT NULL
);
SQLEOF

APPLIED=0
SKIPPED=0
for migration_file in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
    version=$(basename "$migration_file" .sql)
    checksum=$(sha256sum "$migration_file" | cut -d' ' -f1)

    existing=$(psql "$DB_URL" -t -c "SELECT checksum FROM schema_migrations WHERE version='$version'" 2>/dev/null | tr -d ' ')

    if [ -n "$existing" ]; then
        if [ "$existing" != "$checksum" ]; then
            log "ERROR: Migration $version checksum mismatch — file was modified after application!"
            exit 1
        fi
        log "SKIP: $version (already applied)"
        SKIPPED=$((SKIPPED + 1))
        continue
    fi

    log "APPLY: $version"
    psql "$DB_URL" -f "$migration_file"
    psql "$DB_URL" -c "INSERT INTO schema_migrations (version, checksum) VALUES ('$version', '$checksum')"
    log "OK: $version applied"
    APPLIED=$((APPLIED + 1))
done

log "Migrations complete: $APPLIED applied, $SKIPPED skipped"
