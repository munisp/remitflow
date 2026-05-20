#!/bin/bash
# RemitFlow PostgreSQL Backup Script
# Runs daily via CronJob. Backs up to S3 with 30-day retention.
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/tmp/remitflow_backups"
BACKUP_FILE="${BACKUP_DIR}/remitflow_${TIMESTAMP}.dump"
S3_BUCKET="${BACKUP_S3_BUCKET:-remitflow-backups}"
S3_REGION="${BACKUP_S3_REGION:-us-east-1}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
DB_HOST="${DB_HOST:-postgresql}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-remittance_prod}"
DB_USER="${DB_USER:-remittance_admin}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

log "Starting backup: ${BACKUP_FILE}"
mkdir -p "${BACKUP_DIR}"

# Create compressed custom-format dump
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  --format=custom \
  --compress=9 \
  --no-password \
  --verbose \
  -f "${BACKUP_FILE}"

BACKUP_SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
log "Backup created: ${BACKUP_FILE} (${BACKUP_SIZE})"

# Upload to S3
S3_KEY="postgres/${TIMESTAMP}.dump"
aws s3 cp "${BACKUP_FILE}" "s3://${S3_BUCKET}/${S3_KEY}" \
  --region "${S3_REGION}" \
  --sse AES256 \
  --metadata "timestamp=${TIMESTAMP},db=${DB_NAME}"
log "Uploaded to s3://${S3_BUCKET}/${S3_KEY}"

# Verify upload
aws s3 ls "s3://${S3_BUCKET}/${S3_KEY}" --region "${S3_REGION}" > /dev/null
log "Upload verified"

# Cleanup old backups beyond retention period
CUTOFF_DATE=$(date -d "-${RETENTION_DAYS} days" +%Y%m%d 2>/dev/null || date -v-${RETENTION_DAYS}d +%Y%m%d)
log "Cleaning up backups older than ${RETENTION_DAYS} days (before ${CUTOFF_DATE})"
aws s3 ls "s3://${S3_BUCKET}/postgres/" --region "${S3_REGION}" | \
  awk '{print $4}' | \
  grep -E '^[0-9]{8}_' | \
  while read -r key; do
    file_date=$(echo "${key}" | cut -c1-8)
    if [ "${file_date}" -lt "${CUTOFF_DATE}" ]; then
      aws s3 rm "s3://${S3_BUCKET}/postgres/${key}" --region "${S3_REGION}"
      log "Deleted old backup: ${key}"
    fi
  done

# Cleanup local temp file
rm -f "${BACKUP_FILE}"
log "Backup completed successfully"
