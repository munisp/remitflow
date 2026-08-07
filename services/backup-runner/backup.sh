#!/usr/bin/env bash
set -euo pipefail
umask 077

require() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "${name} is required" >&2
    exit 64
  fi
}

require DATABASE_URL
require BACKUP_S3_URI
require BACKUP_KMS_KEY_ID
require BACKUP_OBJECT_LOCK_RETENTION_DAYS
require AWS_REGION

if ! [[ "$BACKUP_OBJECT_LOCK_RETENTION_DAYS" =~ ^[0-9]+$ ]] || (( BACKUP_OBJECT_LOCK_RETENTION_DAYS < 30 )); then
  echo "BACKUP_OBJECT_LOCK_RETENTION_DAYS must be an integer of at least 30" >&2
  exit 64
fi

if [[ ! "$BACKUP_S3_URI" =~ ^s3://[^/]+/.+ ]]; then
  echo "BACKUP_S3_URI must identify a bucket and prefix (s3://bucket/prefix)" >&2
  exit 64
fi

readonly run_id="$(date -u +%Y%m%dT%H%M%SZ)-${HOSTNAME:-backup}-$(openssl rand -hex 6)"
readonly workdir="$(mktemp -d)"
readonly artifact="${workdir}/remitflow-${run_id}.dump"
readonly manifest="${workdir}/remitflow-${run_id}.manifest.json"
trap 'rm -rf "$workdir"' EXIT

pg_dump "$DATABASE_URL" --format=custom --compress=9 --no-owner --no-privileges --file "$artifact"
readonly sha256="$(sha256sum "$artifact" | awk '{print $1}')"
readonly bytes="$(stat -c '%s' "$artifact")"
readonly retain_until="$(date -u -d "+${BACKUP_OBJECT_LOCK_RETENTION_DAYS} days" +%Y-%m-%dT%H:%M:%SZ)"
readonly prefix="${BACKUP_S3_URI%/}"
readonly dump_key="${prefix}/postgres/${run_id}.dump"
readonly manifest_key="${prefix}/postgres/${run_id}.manifest.json"

cat > "$manifest" <<EOF
{
  "schemaVersion": 1,
  "runId": "${run_id}",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "artifact": "${dump_key}",
  "sha256": "${sha256}",
  "bytes": ${bytes},
  "format": "pg_dump_custom",
  "retentionMode": "COMPLIANCE",
  "retainUntil": "${retain_until}",
  "deploymentRevision": "${DEPLOYMENT_REVISION:-unknown}"
}
EOF

# Shell-safe URI split after validation. Object Lock is set on each upload,
# including the manifest that records the backup integrity metadata.
readonly dump_bucket="${dump_key#s3://}"; readonly dump_bucket="${dump_bucket%%/*}"
readonly dump_object="${dump_key#s3://${dump_bucket}/}"
readonly manifest_bucket="${manifest_key#s3://}"; readonly manifest_bucket="${manifest_bucket%%/*}"
readonly manifest_object="${manifest_key#s3://${manifest_bucket}/}"

aws s3api put-object \
  --region "$AWS_REGION" \
  --bucket "$dump_bucket" --key "$dump_object" --body "$artifact" \
  --server-side-encryption aws:kms --ssekms-key-id "$BACKUP_KMS_KEY_ID" \
  --object-lock-mode COMPLIANCE --object-lock-retain-until-date "$retain_until" \
  --metadata "sha256=${sha256},run-id=${run_id},format=pg_dump_custom" >/dev/null
aws s3api put-object \
  --region "$AWS_REGION" \
  --bucket "$manifest_bucket" --key "$manifest_object" --body "$manifest" \
  --server-side-encryption aws:kms --ssekms-key-id "$BACKUP_KMS_KEY_ID" \
  --object-lock-mode COMPLIANCE --object-lock-retain-until-date "$retain_until" \
  --metadata "run-id=${run_id},kind=backup-manifest" >/dev/null

aws s3api head-object --region "$AWS_REGION" --bucket "$dump_bucket" --key "$dump_object" >/dev/null
aws s3api head-object --region "$AWS_REGION" --bucket "$manifest_bucket" --key "$manifest_object" >/dev/null
printf 'backup_run_id=%s\nbackup_object=%s\nsha256=%s\n' "$run_id" "$dump_key" "$sha256"
