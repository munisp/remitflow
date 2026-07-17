#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# RemitFlow — Configure APISix to Trust Caddy as Upstream Proxy
# ═══════════════════════════════════════════════════════════════════════════════
#
# This script updates the APISix configuration to:
#   1. Trust X-Real-IP headers forwarded by Caddy
#   2. Forward Keycloak auth headers (X-Auth-*) to upstream services
#   3. Forward mTLS client certificate headers (X-Client-Cert-*) for B2B routes
#   4. Add Caddy as a trusted proxy for rate limiting key resolution
#
# Usage: ./infra/caddy/configure-apisix-for-caddy.sh [APISIX_ADMIN_URL]
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

APISIX_ADMIN="${1:-http://localhost:9180}"
ADMIN_KEY="${APISIX_ADMIN_KEY:-remitflow-apisix-admin-key}"
H="X-API-KEY: $ADMIN_KEY"
CT="Content-Type: application/json"

echo "🔧 Configuring APISix to trust Caddy as upstream proxy..."
echo "   APISix Admin: $APISIX_ADMIN"
echo ""

# ── 1. Update global plugin config to trust Caddy's real-ip headers ───────────
echo "📡 Updating global plugin config (real-ip trust)..."
curl -sf -X PUT "$APISIX_ADMIN/apisix/admin/global_rules/caddy-real-ip" \
  -H "$H" -H "$CT" -d '{
    "id": "caddy-real-ip",
    "plugins": {
      "real-ip": {
        "source": "http_x_real_ip",
        "trusted_addresses": [
          "172.20.0.0/16",
          "10.0.0.0/8",
          "127.0.0.1"
        ],
        "recursive": true
      }
    }
  }' && echo "  ✓ real-ip global rule configured"

# ── 2. Create a consumer for Caddy's internal requests ────────────────────────
echo ""
echo "👤 Creating Caddy internal consumer..."
curl -sf -X PUT "$APISIX_ADMIN/apisix/admin/consumers/caddy-internal" \
  -H "$H" -H "$CT" -d '{
    "username": "caddy-internal",
    "desc": "Internal requests forwarded by Caddy edge proxy",
    "plugins": {
      "key-auth": {
        "key": "'"${CADDY_INTERNAL_API_KEY:-caddy-internal-key-change-in-production}"'"
      }
    }
  }' && echo "  ✓ caddy-internal consumer created"

# ── 3. Update the main API route to forward Caddy auth headers ────────────────
echo ""
echo "🛣️  Updating main API route to forward auth headers from Caddy..."
curl -sf -X PATCH "$APISIX_ADMIN/apisix/admin/routes/1" \
  -H "$H" -H "$CT" -d '{
    "plugins": {
      "proxy-rewrite": {
        "headers": {
          "set": {
            "X-Auth-User":             "$http_x_auth_user",
            "X-Auth-Email":            "$http_x_auth_email",
            "X-Auth-Roles":            "$http_x_auth_roles",
            "X-Auth-Tenant":           "$http_x_auth_tenant",
            "X-Keycloak-ID":           "$http_x_keycloak_id",
            "X-Client-Cert-Subject":   "$http_x_client_cert_subject",
            "X-Client-Cert-Serial":    "$http_x_client_cert_serial",
            "X-mTLS-Verified":         "$http_x_mtls_verified",
            "X-Forwarded-Proto":       "$http_x_forwarded_proto"
          }
        }
      }
    }
  }' && echo "  ✓ main API route updated with auth header forwarding"

# ── 4. Create B2B route with mTLS verification requirement ────────────────────
echo ""
echo "🔐 Creating B2B API route with mTLS verification..."
curl -sf -X PUT "$APISIX_ADMIN/apisix/admin/routes/b2b-api" \
  -H "$H" -H "$CT" -d '{
    "id": "b2b-api",
    "name": "B2B Partner API",
    "uri": "/api/b2b/*",
    "methods": ["GET", "POST", "PUT", "DELETE"],
    "upstream_id": 1,
    "plugins": {
      "real-ip": {
        "source": "http_x_real_ip",
        "trusted_addresses": ["172.20.0.0/16", "10.0.0.0/8"]
      },
      "request-validation": {
        "header_schema": {
          "type": "object",
          "required": ["X-mTLS-Verified", "X-Client-Cert-Subject"],
          "properties": {
            "X-mTLS-Verified": {
              "type": "string",
              "enum": ["true"]
            },
            "X-Client-Cert-Subject": {
              "type": "string",
              "minLength": 1
            }
          }
        }
      },
      "limit-count": {
        "count": 1000,
        "time_window": 60,
        "key": "http_x_client_cert_subject",
        "rejected_code": 429
      },
      "proxy-rewrite": {
        "headers": {
          "set": {
            "X-Client-Cert-Subject": "$http_x_client_cert_subject",
            "X-Client-Cert-Serial":  "$http_x_client_cert_serial",
            "X-mTLS-Verified":       "$http_x_mtls_verified"
          }
        }
      }
    }
  }' && echo "  ✓ B2B API route created with mTLS verification"

# ── 5. Update Prometheus scrape config to include Caddy metrics ───────────────
echo ""
echo "📊 Caddy metrics endpoint: http://caddy:2020/metrics"
echo "   Add the following to infra/prometheus/prometheus.yml:"
echo ""
echo "  - job_name: \"caddy\""
echo "    static_configs:"
echo "      - targets: [\"caddy:2020\"]"
echo "    metrics_path: /metrics"
echo ""
echo "  - job_name: \"caddy-keycloak-bridge\""
echo "    static_configs:"
echo "      - targets: [\"caddy-keycloak-bridge:8090\"]"
echo "    metrics_path: /metrics"
echo ""

echo "✅ APISix configured to trust Caddy as upstream proxy"
echo ""
echo "Next steps:"
echo "  1. Start Caddy: docker compose -f docker-compose.yml -f infra/caddy/docker-compose.caddy.yml up caddy"
echo "  2. Verify TLS: curl -v https://api.remitflow.local/health"
echo "  3. Test auth:  curl -H 'Authorization: Bearer <token>' https://admin.remitflow.local/"
