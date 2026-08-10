#!/usr/bin/env bash
set -Eeuo pipefail

api_base="${PERMIFY_HTTP_URL:-http://127.0.0.1:3476}"
tenant_id="rf-validation-$(date +%s)"

require() {
  local condition="$1"
  local message="$2"
  if ! eval "$condition"; then
    printf 'PERMIFY_SMOKE_FAILED: %s\n' "$message" >&2
    exit 1
  fi
}

for _ in $(seq 1 30); do
  if curl --silent --fail --max-time 2 "${api_base}/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl --silent --fail --max-time 5 "${api_base}/healthz" >/dev/null

schema=$(cat <<'PERMIFY_SCHEMA'
entity user {}

entity organization {
  relation admin @user
  relation member @user
}

entity transfer {
  relation organization @organization
  relation owner @user

  action view = owner or organization.admin
  action initiate = organization.member
}
PERMIFY_SCHEMA
)

schema_payload=$(jq -n --arg schema "$schema" '{schema: $schema}')
schema_response=$(curl --silent --show-error --fail \
  --header 'Content-Type: application/json' \
  --data "$schema_payload" \
  "${api_base}/v1/tenants/${tenant_id}/schemas/write")
schema_version=$(jq -er '.schema_version' <<<"$schema_response")

relationship_payload=$(jq -n --arg schema_version "$schema_version" '{
  metadata: {schema_version: $schema_version},
  tuples: [
    {entity:{type:"organization",id:"tenant-a"}, relation:"admin", subject:{type:"user",id:"alice",relation:""}},
    {entity:{type:"organization",id:"tenant-a"}, relation:"member", subject:{type:"user",id:"alice",relation:""}},
    {entity:{type:"transfer",id:"transfer-a"}, relation:"organization", subject:{type:"organization",id:"tenant-a",relation:""}},
    {entity:{type:"transfer",id:"transfer-a"}, relation:"owner", subject:{type:"user",id:"alice",relation:""}}
  ]
}')
curl --silent --show-error --fail \
  --header 'Content-Type: application/json' \
  --data "$relationship_payload" \
  "${api_base}/v1/tenants/${tenant_id}/data/write" >/dev/null

check_permission() {
  local user_id="$1"
  curl --silent --show-error --fail \
    --header 'Content-Type: application/json' \
    --data "$(jq -n --arg schema_version "$schema_version" --arg user_id "$user_id" '{
      metadata:{snap_token:"",schema_version:$schema_version,depth:20},
      entity:{type:"transfer",id:"transfer-a"},
      permission:"view",
      subject:{type:"user",id:$user_id,relation:""}
    }')" \
    "${api_base}/v1/tenants/${tenant_id}/permissions/check" | jq -er '.can'
}

allowed=$(check_permission alice)
denied=$(check_permission bob)
require "[ \"$allowed\" = \"CHECK_RESULT_ALLOWED\" ]" "same-tenant owner/admin must be allowed"
require "[ \"$denied\" = \"CHECK_RESULT_DENIED\" ]" "unrelated cross-tenant subject must be denied"

printf 'PERMIFY_SMOKE_PASSED tenant=%s schema_version=%s allowed=%s denied=%s\n' \
  "$tenant_id" "$schema_version" "$allowed" "$denied"
