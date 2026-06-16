#!/bin/bash
# ─── RemitFlow Production Backup & Verification Script ──────────────────────────
# 
# Performs:
# 1. Full pg_dump with compression and checksumming
# 2. Verifies backup integrity (restore to temp DB)
# 3. Uploads to S3 with server-side encryption
# 4. Cleans up old backups (retention policy)
# 5. Reports RPO/RTO metrics
#
# Usage:
#   ./scripts/backup-and-verify.sh                  # Full backup + verify
#   ./scripts/backup-and-verify.sh --skip-verify    # Backup only (faster)
#   ./scripts/backup-and-verify.sh --restore        # Restore from latest backup
#
# Required env vars:
#   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
#   BACKUP_S3_BUCKET (optional, for S3 upload)
#   BACKUP_ENCRYPTION_KEY (optional, for AES encryption)
#
set -euo pipefail

# ─── Configuration ──────────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/backups/remitflow}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-remitflow}"
PGPASSWORD="${PGPASSWORD:-remitflow123}"
PGDATABASE="${PGDATABASE:-remitflow}"
S3_BUCKET="${BACKUP_S3_BUCKET:-}"
ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/remitflow_${TIMESTAMP}.sql.gz"
CHECKSUM_FILE="${BACKUP_FILE}.sha256"
LOG_FILE="${BACKUP_DIR}/backup.log"
SKIP_VERIFY="${1:-}"
export PGPASSWORD

# ─── Functions ──────────────────────────────────────────────────────────────────
log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"
}

ensure_dir() {
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
}

# 1. Create backup
create_backup() {
  log "Starting pg_dump of ${PGDATABASE}@${PGHOST}:${PGPORT}..."
  local start_time=$(date +%s)

  pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    --format=custom --compress=9 --no-owner --no-privileges \
    --file="${BACKUP_FILE%.gz}" 2>>"$LOG_FILE"

  # Compress with gzip
  gzip -9 "${BACKUP_FILE%.gz}"
  
  local end_time=$(date +%s)
  local duration=$((end_time - start_time))
  local size=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE" 2>/dev/null || echo "0")

  # Generate checksum
  sha256sum "$BACKUP_FILE" > "$CHECKSUM_FILE"

  # Optional: encrypt with AES-256
  if [ -n "$ENCRYPTION_KEY" ]; then
    log "Encrypting backup with AES-256-CBC..."
    openssl enc -aes-256-cbc -salt -pbkdf2 \
      -in "$BACKUP_FILE" -out "${BACKUP_FILE}.enc" \
      -pass "env:ENCRYPTION_KEY"
    rm -f "$BACKUP_FILE"
    BACKUP_FILE="${BACKUP_FILE}.enc"
    sha256sum "$BACKUP_FILE" > "$CHECKSUM_FILE"
  fi

  log "Backup created: ${BACKUP_FILE} (${size} bytes, ${duration}s)"
}

# 2. Verify backup integrity
verify_backup() {
  if [ "$SKIP_VERIFY" = "--skip-verify" ]; then
    log "Skipping verification (--skip-verify)"
    return 0
  fi

  log "Verifying backup integrity..."
  local verify_db="remitflow_verify_${TIMESTAMP}"
  local restore_file="$BACKUP_FILE"

  # Decrypt if encrypted
  if [[ "$BACKUP_FILE" == *.enc ]]; then
    log "Decrypting for verification..."
    openssl enc -aes-256-cbc -d -salt -pbkdf2 \
      -in "$BACKUP_FILE" -out "${BACKUP_FILE%.enc}" \
      -pass "env:ENCRYPTION_KEY"
    restore_file="${BACKUP_FILE%.enc}"
  fi

  # Decompress
  local uncompressed="${restore_file%.gz}"
  if [[ "$restore_file" == *.gz ]]; then
    gunzip -k "$restore_file"
  fi

  # Create temp DB and restore
  createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$verify_db" 2>>"$LOG_FILE" || true
  
  pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$verify_db" \
    --no-owner --no-privileges "$uncompressed" 2>>"$LOG_FILE"

  # Verify key tables have data
  local user_count=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$verify_db" \
    -t -c "SELECT COUNT(*) FROM users" 2>/dev/null | tr -d ' ')
  local tx_count=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$verify_db" \
    -t -c "SELECT COUNT(*) FROM transactions" 2>/dev/null | tr -d ' ')

  # Cleanup
  dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$verify_db" 2>>"$LOG_FILE" || true
  rm -f "$uncompressed" "${BACKUP_FILE%.enc}" 2>/dev/null || true

  if [ "${user_count:-0}" -gt 0 ] && [ "${tx_count:-0}" -gt 0 ]; then
    log "✓ Verification PASSED (users: ${user_count}, transactions: ${tx_count})"
    return 0
  else
    log "✗ Verification FAILED (users: ${user_count:-0}, transactions: ${tx_count:-0})"
    return 1
  fi
}

# 3. Upload to S3
upload_to_s3() {
  if [ -z "$S3_BUCKET" ]; then
    log "S3_BUCKET not configured — skipping upload"
    return 0
  fi

  log "Uploading to s3://${S3_BUCKET}/backups/..."
  aws s3 cp "$BACKUP_FILE" "s3://${S3_BUCKET}/backups/$(basename $BACKUP_FILE)" \
    --sse AES256 --storage-class STANDARD_IA 2>>"$LOG_FILE"
  aws s3 cp "$CHECKSUM_FILE" "s3://${S3_BUCKET}/backups/$(basename $CHECKSUM_FILE)" \
    --sse AES256 2>>"$LOG_FILE"
  log "✓ Uploaded to S3"
}

# 4. Retention cleanup
cleanup_old_backups() {
  log "Cleaning up backups older than ${RETENTION_DAYS} days..."
  local deleted=$(find "$BACKUP_DIR" -name "remitflow_*.sql*" -mtime "+${RETENTION_DAYS}" -delete -print | wc -l)
  log "  Deleted ${deleted} old backup files"

  if [ -n "$S3_BUCKET" ]; then
    # Delete from S3 too (lifecycle policy is preferred, this is a fallback)
    aws s3 ls "s3://${S3_BUCKET}/backups/" 2>/dev/null | \
      awk -v date="$(date -d "-${RETENTION_DAYS} days" +%Y-%m-%d 2>/dev/null || date -v-${RETENTION_DAYS}d +%Y-%m-%d)" '$1 < date {print $4}' | \
      while read -r file; do
        aws s3 rm "s3://${S3_BUCKET}/backups/${file}" 2>>"$LOG_FILE"
      done
  fi
}

# 5. RPO/RTO metrics
report_metrics() {
  local latest_backup=$(ls -t "$BACKUP_DIR"/remitflow_*.sql* 2>/dev/null | head -1)
  if [ -n "$latest_backup" ]; then
    local backup_age_hours=$(( ($(date +%s) - $(stat -c%Y "$latest_backup" 2>/dev/null || stat -f%m "$latest_backup" 2>/dev/null || echo 0)) / 3600 ))
    log "RPO Status: Latest backup is ${backup_age_hours}h old (target: 24h)"
    if [ "$backup_age_hours" -gt 24 ]; then
      log "⚠️  RPO VIOLATION: Backup is older than 24 hours!"
    fi
  fi
  log "RTO Target: 4 hours (pg_restore + app restart)"
}

# Restore from latest backup
restore_latest() {
  local latest=$(ls -t "$BACKUP_DIR"/remitflow_*.sql* 2>/dev/null | head -1)
  if [ -z "$latest" ]; then
    log "No backup found in ${BACKUP_DIR}"
    exit 1
  fi
  log "Restoring from: ${latest}"
  
  local restore_file="$latest"
  if [[ "$latest" == *.enc ]]; then
    openssl enc -aes-256-cbc -d -salt -pbkdf2 \
      -in "$latest" -out "${latest%.enc}" -pass "env:ENCRYPTION_KEY"
    restore_file="${latest%.enc}"
  fi
  if [[ "$restore_file" == *.gz ]]; then
    gunzip -k "$restore_file"
    restore_file="${restore_file%.gz}"
  fi

  pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    --clean --no-owner --no-privileges "$restore_file" 2>>"$LOG_FILE"
  
  log "✓ Restore complete"
}

# ─── Main ───────────────────────────────────────────────────────────────────────
main() {
  log "═══════════════════════════════════════════════════"
  log " RemitFlow Backup — $(date)"
  log "═══════════════════════════════════════════════════"
  ensure_dir

  if [ "${1:-}" = "--restore" ]; then
    restore_latest
    exit 0
  fi

  create_backup
  verify_backup
  upload_to_s3
  cleanup_old_backups
  report_metrics

  log "═══════════════════════════════════════════════════"
  log " Backup complete ✓"
  log "═══════════════════════════════════════════════════"
}

main "$@"
