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

require DR_RESTORE_CONFIRMATION
require DR_RESTORE_TARGET_ENV
require RESTORE_DATABASE_URL
require BACKUP_MANIFEST_S3_URI
require AWS_REGION

if [[ "$DR_RESTORE_CONFIRMATION" != "RESTORE_TO_ISOLATED_ENVIRONMENT" || "$DR_RESTORE_TARGET_ENV" != "drill" ]]; then
  echo "Restore drills are permitted only with DR_RESTORE_CONFIRMATION=RESTORE_TO_ISOLATED_ENVIRONMENT and DR_RESTORE_TARGET_ENV=drill" >&2
  exit 64
fi
if [[ "$RESTORE_DATABASE_URL" == *"production"* || "$RESTORE_DATABASE_URL" == *"prod"* ]]; then
  echo "Refusing a restore target URL that appears to reference production" >&2
  exit 64
fi
if [[ ! "$BACKUP_MANIFEST_S3_URI" =~ ^s3://[^/]+/.+\.manifest\.json$ ]]; then
  echo "BACKUP_MANIFEST_S3_URI must identify a backup manifest object" >&2
  exit 64
fi

readonly workdir="$(mktemp -d)"
readonly manifest="${workdir}/manifest.json"
readonly artifact="${workdir}/backup.dump"
trap 'rm -rf "$workdir"' EXIT

aws s3 cp --region "$AWS_REGION" "$BACKUP_MANIFEST_S3_URI" "$manifest" >/dev/null
readonly artifact_uri="$(jq -er '.artifact' "$manifest")"
readonly expected_sha256="$(jq -er '.sha256' "$manifest")"
readonly format="$(jq -er '.format' "$manifest")"
if [[ "$format" != "pg_dump_custom" ]]; then
  echo "Unsupported backup format in manifest: ${format}" >&2
  exit 65
fi
aws s3 cp --region "$AWS_REGION" "$artifact_uri" "$artifact" >/dev/null
readonly actual_sha256="$(sha256sum "$artifact" | awk '{print $1}')"
if [[ "$actual_sha256" != "$expected_sha256" ]]; then
  echo "Backup checksum verification failed" >&2
  exit 65
fi

pg_restore --dbname "$RESTORE_DATABASE_URL" --clean --if-exists --no-owner --no-privileges --exit-on-error "$artifact"
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT current_database(), COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"
printf 'restore_drill=completed\nmanifest=%s\nsha256=%s\n' "$BACKUP_MANIFEST_S3_URI" "$actual_sha256"
