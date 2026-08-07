#!/usr/bin/env bash
set -Eeuo pipefail

export DATABASE_URL="${DATABASE_URL:-postgresql://test:test@127.0.0.1:5432/remitflow_test}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export PERMIFY_HTTP_URL="${PERMIFY_HTTP_URL:-http://127.0.0.1:3476}"
export PERMIFY_GRPC_URL="${PERMIFY_GRPC_URL:-127.0.0.1:3478}"
export PERMIFY_ENDPOINT="${PERMIFY_ENDPOINT:-127.0.0.1:3478}"
export PERMIFY_TENANT_ID="${PERMIFY_TENANT_ID:-remitflow-validation}"
export OPENSEARCH_URL="${OPENSEARCH_URL:-http://127.0.0.1:9200}"
export OPENSEARCH_USER="${OPENSEARCH_USER:-validation}"
export OPENSEARCH_PASSWORD="${OPENSEARCH_PASSWORD:-validation}"
export KEYCLOAK_URL="${KEYCLOAK_URL:-http://127.0.0.1:8080}"
export KEYCLOAK_REALM="${KEYCLOAK_REALM:-remitflow}"
export KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-remitflow-api}"
export KEYCLOAK_CLIENT_SECRET="${KEYCLOAK_CLIENT_SECRET:-validation-client-secret}"
export KEYCLOAK_ADMIN="${KEYCLOAK_ADMIN:-validation-admin}"
export KEYCLOAK_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-validation-admin-password}"
export DAPR_HOST="${DAPR_HOST:-127.0.0.1}"
export DAPR_HTTP_PORT="${DAPR_HTTP_PORT:-3500}"
export DAPR_GRPC_PORT="${DAPR_GRPC_PORT:-50001}"
export DAPR_APP_ID="${DAPR_APP_ID:-remitflow-api}"
export DAPR_STATE_STORE="${DAPR_STATE_STORE:-statestore}"
export DAPR_PUBSUB="${DAPR_PUBSUB:-pubsub}"
export DAPR_SECRET_STORE="${DAPR_SECRET_STORE:-secretstore}"
export APISIX_ADMIN_URL="${APISIX_ADMIN_URL:-http://127.0.0.1:9180}"
export APISIX_ADMIN_KEY="${APISIX_ADMIN_KEY:-validation-apisix-admin-key}"
export APISIX_GATEWAY_URL="${APISIX_GATEWAY_URL:-http://127.0.0.1:9080}"
export APISIX_UPSTREAM_API="${APISIX_UPSTREAM_API:-http://127.0.0.1:3111}"
export APISIX_UPSTREAM_LAKEHOUSE="${APISIX_UPSTREAM_LAKEHOUSE:-http://127.0.0.1:8102}"
export TIGERBEETLE_ADDRESSES="${TIGERBEETLE_ADDRESSES:-127.0.0.1:3000}"
export TIGERBEETLE_CLUSTER_ID="${TIGERBEETLE_CLUSTER_ID:-0}"
export FLUVIO_ENDPOINT="${FLUVIO_ENDPOINT:-127.0.0.1:9003}"
export FLUVIO_PROFILE="${FLUVIO_PROFILE:-remitflow-validation}"
export LAKEHOUSE_URL="${LAKEHOUSE_URL:-http://127.0.0.1:8102}"
export LAKEHOUSE_CATALOG="${LAKEHOUSE_CATALOG:-remitflow}"
export LAKEHOUSE_WAREHOUSE="${LAKEHOUSE_WAREHOUSE:-s3://remitflow-validation}"
export OPENAPPSEC_MGMT_URL="${OPENAPPSEC_MGMT_URL:-http://127.0.0.1:8888}"
export OPENAPPSEC_TOKEN="${OPENAPPSEC_TOKEN:-validation-openappsec-token}"
export KAFKA_BROKERS="${KAFKA_BROKERS:-127.0.0.1:9092}"
export KAFKA_CLIENT_ID="${KAFKA_CLIENT_ID:-remitflow-validation}"
export TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-127.0.0.1:7233}"
export TEMPORAL_NAMESPACE="${TEMPORAL_NAMESPACE:-default}"
export OAUTH_SERVER_URL="${OAUTH_SERVER_URL:-http://127.0.0.1:8080}"
export SESSION_SECRET="${SESSION_SECRET:-container-validation-session-secret-32}"
export REGULATORY_FILING_MAX_ATTEMPTS="${REGULATORY_FILING_MAX_ATTEMPTS:-3}"
export REGULATORY_FILING_BACKOFF_MS="${REGULATORY_FILING_BACKOFF_MS:-100}"
export REGULATORY_FILING_HTTP_TIMEOUT_MS="${REGULATORY_FILING_HTTP_TIMEOUT_MS:-1000}"
export REGULATORY_FILING_LOCK_SECONDS="${REGULATORY_FILING_LOCK_SECONDS:-60}"
export REGULATORY_FILING_BATCH_SIZE="${REGULATORY_FILING_BATCH_SIZE:-10}"
export REGULATORY_FILING_RETRY_INTERVAL_MS="${REGULATORY_FILING_RETRY_INTERVAL_MS:-60000}"
export IDEMPOTENCY_TTL_HOURS="${IDEMPOTENCY_TTL_HOURS:-24}"
export IDEMPOTENCY_LOCK_SECONDS="${IDEMPOTENCY_LOCK_SECONDS:-30}"
export PORT="${PORT:-3111}"
export CORS_ALLOWED_ORIGIN="${CORS_ALLOWED_ORIGIN:-http://127.0.0.1:3111}"
export SCHEDULED_TASK_TOKEN="${SCHEDULED_TASK_TOKEN:-container-smoke-token}"
export ALERTMANAGER_WEBHOOK_TOKEN="${ALERTMANAGER_WEBHOOK_TOKEN:-container-smoke-alert-token}"
export DB_POOL_MAX="${DB_POOL_MAX:-5}"

mkdir -p .audit/container-validation
pnpm build > .audit/container-validation/e2e-build.log 2>&1
test -s dist/proto/remitflow.proto
node dist/index.js > .audit/container-validation/e2e-server.log 2>&1 &
pid=$!
cleanup() {
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" > .audit/container-validation/e2e-health.json 2>/dev/null; then
    break
  fi
  sleep 1
done

test -s .audit/container-validation/e2e-health.json
curl -fsS "http://127.0.0.1:${PORT}/openapi.json" > .audit/container-validation/e2e-openapi.json
node -e 'const fs = require("node:fs"); const spec = JSON.parse(fs.readFileSync("./.audit/container-validation/e2e-openapi.json", "utf8")); if (!spec.openapi || !spec.info) process.exit(1); console.log(JSON.stringify({openapi: spec.openapi, title: spec.info.title, version: spec.info.version, pathCount: Object.keys(spec.paths ?? {}).length}));' > .audit/container-validation/e2e-openapi-summary.json
curl -fsSI "http://127.0.0.1:${PORT}/" > .audit/container-validation/e2e-root.headers
grep -Eqi 'HTTP/[0-9.]+ 200|HTTP/[0-9.]+ 304' .audit/container-validation/e2e-root.headers
printf 'E2E_SMOKE_PASSED\n'
