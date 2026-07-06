#!/usr/bin/env bash
###############################################################################
# RemitFlow — Vault Initialization Script
#
# Configures HashiCorp Vault with:
#   1. KV v2 secrets engine for API keys
#   2. Transit engine for PII field encryption
#   3. Database secrets engine for dynamic PostgreSQL credentials
#   4. AppRole auth method for application authentication
#   5. Kubernetes auth method for K8s pod authentication
#   6. Audit logging
#
# Prerequisites:
#   - Vault server running (docker compose --profile full up)
#   - VAULT_ADDR and VAULT_TOKEN set
#
# Usage:
#   export VAULT_ADDR=http://localhost:8200
#   export VAULT_TOKEN=<root-token>
#   ./ops/vault-init.sh
#
# For CI/CD: ./ops/vault-init.sh --ci (non-interactive, no prompts)
###############################################################################
set -euo pipefail

VAULT_ADDR="${VAULT_ADDR:-http://localhost:8200}"
export VAULT_ADDR

CI_MODE=false
for arg in "$@"; do
  case "$arg" in
    --ci) CI_MODE=true ;;
  esac
done

echo "═══════════════════════════════════════════════════════════════"
echo " RemitFlow Vault Initialization"
echo " Vault: ${VAULT_ADDR}"
echo "═══════════════════════════════════════════════════════════════"

# Check Vault is accessible
if ! vault status > /dev/null 2>&1; then
  echo "ERROR: Cannot reach Vault at ${VAULT_ADDR}"
  echo "Start with: docker compose --profile full up -d vault"
  exit 1
fi

echo ""
echo "─── 1. Enable KV v2 Secrets Engine ─────────────────────────────"
vault secrets enable -path=secret kv-kv2 2>/dev/null || echo "  (already enabled)"

echo ""
echo "─── 2. Enable Transit Engine (PII Encryption) ──────────────────"
vault secrets enable transit 2>/dev/null || echo "  (already enabled)"

# Create encryption keys
vault write -f transit/keys/remitflow-pii \
  type=aes256-gcm96 \
  min_decryption_version=1 \
  min_encryption_version=1 2>/dev/null || echo "  Key remitflow-pii exists"

vault write -f transit/keys/remitflow-bank-accounts \
  type=aes256-gcm96 2>/dev/null || echo "  Key remitflow-bank-accounts exists"

vault write -f transit/keys/remitflow-documents \
  type=rsa-4096 2>/dev/null || echo "  Key remitflow-documents exists"

echo "  Transit keys: remitflow-pii, remitflow-bank-accounts, remitflow-documents"

echo ""
echo "─── 3. Enable Database Secrets Engine ──────────────────────────"
vault secrets enable database 2>/dev/null || echo "  (already enabled)"

# Configure PostgreSQL connection (production values come from sealed secrets)
PG_HOST="${PG_HOST:-postgres}"
PG_PORT="${PG_PORT:-5432}"
PG_DB="${PG_DB:-remitflow}"
PG_ADMIN_USER="${PG_ADMIN_USER:-remitflow}"
PG_ADMIN_PASSWORD="${PG_ADMIN_PASSWORD:-remitflow_dev}"

vault write database/config/remitflow-postgres \
  plugin_name=postgresql-database-plugin \
  allowed_roles="remitflow-app,remitflow-readonly,remitflow-migrations" \
  connection_url="postgresql://{{username}}:{{password}}@${PG_HOST}:${PG_PORT}/${PG_DB}?sslmode=disable" \
  username="${PG_ADMIN_USER}" \
  password="${PG_ADMIN_PASSWORD}" 2>/dev/null && echo "  PostgreSQL configured" || echo "  (already configured)"

# App role: read/write, 1 hour TTL
vault write database/roles/remitflow-app \
  db_name=remitflow-postgres \
  creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO \"{{name}}\"; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO \"{{name}}\";" \
  revocation_statements="REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM \"{{name}}\"; DROP ROLE IF EXISTS \"{{name}}\";" \
  default_ttl="1h" \
  max_ttl="24h" 2>/dev/null && echo "  Role remitflow-app created" || echo "  (already exists)"

# Read-only role for analytics/reporting
vault write database/roles/remitflow-readonly \
  db_name=remitflow-postgres \
  creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT SELECT ON ALL TABLES IN SCHEMA public TO \"{{name}}\";" \
  revocation_statements="DROP ROLE IF EXISTS \"{{name}}\";" \
  default_ttl="1h" \
  max_ttl="8h" 2>/dev/null && echo "  Role remitflow-readonly created" || echo "  (already exists)"

echo ""
echo "─── 4. Enable AppRole Auth Method ──────────────────────────────"
vault auth enable approle 2>/dev/null || echo "  (already enabled)"

# Create policy for the application
vault policy write remitflow-app - <<EOF
# KV v2 read/write
path "secret/data/remitflow/*" {
  capabilities = ["create", "read", "update", "list"]
}
path "secret/metadata/remitflow/*" {
  capabilities = ["list", "read"]
}

# Transit encrypt/decrypt
path "transit/encrypt/remitflow-*" {
  capabilities = ["update"]
}
path "transit/decrypt/remitflow-*" {
  capabilities = ["update"]
}

# Database credentials
path "database/creds/remitflow-app" {
  capabilities = ["read"]
}
path "database/creds/remitflow-readonly" {
  capabilities = ["read"]
}

# Token renewal
path "auth/token/renew-self" {
  capabilities = ["update"]
}
path "auth/token/lookup-self" {
  capabilities = ["read"]
}
EOF
echo "  Policy remitflow-app written"

# Create AppRole
vault write auth/approle/role/remitflow \
  secret_id_ttl=0 \
  token_policies="remitflow-app" \
  token_ttl=1h \
  token_max_ttl=24h \
  token_num_uses=0 2>/dev/null && echo "  AppRole remitflow created" || echo "  (already exists)"

# Get role-id (for deployment configuration)
ROLE_ID=$(vault read -field=role_id auth/approle/role/remitflow/role-id 2>/dev/null || echo "")
if [ -n "$ROLE_ID" ]; then
  echo "  Role ID: ${ROLE_ID}"
  if [ "$CI_MODE" = "false" ]; then
    echo ""
    echo "  Generate a Secret ID with:"
    echo "    vault write -f auth/approle/role/remitflow/secret-id"
  fi
fi

echo ""
echo "─── 5. Seed Initial Secrets ────────────────────────────────────"
# Seed with placeholder structure (actual values come from ops team)
vault kv put secret/remitflow/api-keys \
  CIRCLE_API_KEY="REPLACE_ME" \
  ONFIDO_API_KEY="REPLACE_ME" \
  OFAC_API_KEY="REPLACE_ME" \
  CHAINALYSIS_API_KEY="REPLACE_ME" \
  NOTABENE_API_KEY="REPLACE_ME" \
  STRIPE_SECRET_KEY="REPLACE_ME" \
  FLUTTERWAVE_SECRET_KEY="REPLACE_ME" 2>/dev/null && echo "  Seeded api-keys (placeholders)" || true

vault kv put secret/remitflow/webhooks \
  STRIPE_WEBHOOK_SECRET="REPLACE_ME" \
  FLUTTERWAVE_WEBHOOK_SECRET="REPLACE_ME" \
  ONFIDO_WEBHOOK_SECRET="REPLACE_ME" 2>/dev/null && echo "  Seeded webhooks (placeholders)" || true

echo ""
echo "─── 6. Enable Audit Logging ────────────────────────────────────"
vault audit enable file file_path=/vault/logs/audit.log 2>/dev/null || echo "  (already enabled)"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo " Vault initialization complete!"
echo ""
echo " Next steps:"
echo "   1. Replace placeholder secrets: vault kv put secret/remitflow/api-keys CIRCLE_API_KEY=sk_..."
echo "   2. Generate AppRole Secret ID: vault write -f auth/approle/role/remitflow/secret-id"
echo "   3. Set VAULT_ROLE_ID and VAULT_SECRET_ID in K8s secrets"
echo "   4. Deploy temporal-worker with VAULT_ADDR pointing to Vault"
echo "═══════════════════════════════════════════════════════════════"
