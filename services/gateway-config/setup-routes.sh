#!/usr/bin/env bash
# ============================================================
# RemitFlow — APISIX Route Setup Script
# Configures all API routes, upstreams, plugins, and consumers
# Usage: ./services/gateway-config/setup-routes.sh [APISIX_ADMIN_URL]
# ============================================================
set -euo pipefail

APISIX_ADMIN="${1:-http://localhost:9180}"
# Fail closed: no default admin key — provision APISIX_ADMIN_KEY explicitly.
ADMIN_KEY="${APISIX_ADMIN_KEY:?APISIX_ADMIN_KEY must be set — refusing to configure APISIX without credentials}"
APP_UPSTREAM="${APP_UPSTREAM:-http://host.docker.internal:3000}"
FX_UPSTREAM="${FX_UPSTREAM:-http://fx-engine:8080}"
RISK_UPSTREAM="${RISK_UPSTREAM:-http://risk-engine:8083}"
MOJALOOP_UPSTREAM="${MOJALOOP_UPSTREAM:-http://mojaloop-connector:8113}"
LEDGER_UPSTREAM="${LEDGER_UPSTREAM:-http://ledger-service:8082}"
FRAUD_UPSTREAM="${FRAUD_UPSTREAM:-http://fraud-ml:8087}"

H="X-API-KEY: $ADMIN_KEY"
CT="Content-Type: application/json"

echo "🚀 Configuring APISIX gateway for RemitFlow..."
echo "   Admin URL: $APISIX_ADMIN"
echo ""

# ── Upstreams ──────────────────────────────────────────────────────────────────
echo "📡 Creating upstreams..."

curl -sf -X PUT "$APISIX_ADMIN/apisix/admin/upstreams/1" \
  -H "$H" -H "$CT" -d "{
    \"id\": 1,
    \"name\": \"remitflow-app\",
    \"type\": \"roundrobin\",
    \"nodes\": {\"${APP_UPSTREAM#http://}\": 1},
    \"scheme\": \"http\",
    \"pass_host\": \"pass\",
    \"keepalive_pool\": {\"size\": 320, \"idle_timeout\": 60, \"requests\": 1000}
  }" && echo "  ✓ remitflow-app upstream"

curl -sf -X PUT "$APISIX_ADMIN/apisix/admin/upstreams/2" \
  -H "$H" -H "$CT" -d "{
    \"id\": 2,
    \"name\": \"fx-engine\",
    \"type\": \"roundrobin\",
    \"nodes\": {\"${FX_UPSTREAM#http://}\": 1},
    \"scheme\": \"http\",
    \"healthcheck\": {
      \"active\": {\"http_path\": \"/health\", \"healthy\": {\"interval\": 5, \"successes\": 2}, \"unhealthy\": {\"interval\": 1, \"http_failures\": 2}}
    }
  }" && echo "  ✓ fx-engine upstream"

curl -sf -X PUT "$APISIX_ADMIN/apisix/admin/upstreams/3" \
  -H "$H" -H "$CT" -d "{
    \"id\": 3,
    \"name\": \"risk-engine\",
    \"type\": \"roundrobin\",
    \"nodes\": {\"${RISK_UPSTREAM#http://}\": 1},
    \"scheme\": \"http\"
  }" && echo "  ✓ risk-engine upstream"

curl -sf -X PUT "$APISIX_ADMIN/apisix/admin/upstreams/4" \
  -H "$H" -H "$CT" -d "{
    \"id\": 4,
    \"name\": \"mojaloop-connector\",
    \"type\": \"roundrobin\",
    \"nodes\": {\"${MOJALOOP_UPSTREAM#http://}\": 1},
    \"scheme\": \"http\"
  }" && echo "  ✓ mojaloop-connector upstream"

curl -sf -X PUT "$APISIX_ADMIN/apisix/admin/upstreams/5" \
  -H "$H" -H "$CT" -d "{
    \"id\": 5,
    \"name\": \"ledger-service\",
    \"type\": \"roundrobin\",
    \"nodes\": {\"${LEDGER_UPSTREAM#http://}\": 1},
    \"scheme\": \"http\"
  }" && echo "  ✓ ledger-service upstream"

# ── Routes ─────────────────────────────────────────────────────────────────────
echo ""
echo "🛣️  Creating routes..."

# Main app — all tRPC and OAuth routes
curl -sf -X PUT "$APISIX_ADMIN/apisix/admin/routes/1" \
  -H "$H" -H "$CT" -d '{
    "id": 1,
    "name": "remitflow-app",
    "uri": "/*",
    "upstream_id": 1,
    "plugins": {
      "limit-req": {"rate": 100, "burst": 50, "key": "remote_addr", "rejected_code": 429},
      "response-rewrite": {"headers": {"X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin"}},
      "cors": {"allow_origins": "https://remitflow.manus.space,http://localhost:3000", "allow_methods": "GET,POST,PUT,DELETE,OPTIONS", "allow_headers": "Content-Type,Authorization,X-Requested-With", "allow_credential": true}
    },
    "priority": 0
  }' && echo "  ✓ remitflow-app route (/*)"

# FX Engine routes
curl -sf -X PUT "$APISIX_ADMIN/apisix/admin/routes/2" \
  -H "$H" -H "$CT" -d '{
    "id": 2,
    "name": "fx-engine-routes",
    "uris": ["/api/fx/*", "/api/rates/*", "/api/quote"],
    "upstream_id": 2,
    "plugins": {
      "limit-req": {"rate": 50, "burst": 20, "key": "remote_addr", "rejected_code": 429},
      "proxy-cache": {"cache_strategy": "memory", "cache_ttl": 30, "cache_http_status": [200]},
      "jwt-auth": {}
    },
    "priority": 10
  }' && echo "  ✓ fx-engine routes (/api/fx/*, /api/rates/*)"

# Risk Engine routes
curl -sf -X PUT "$APISIX_ADMIN/apisix/admin/routes/3" \
  -H "$H" -H "$CT" -d '{
    "id": 3,
    "name": "risk-engine-routes",
    "uris": ["/api/risk/*", "/api/aml/*"],
    "upstream_id": 3,
    "plugins": {
      "limit-req": {"rate": 20, "burst": 10, "key": "remote_addr", "rejected_code": 429},
      "jwt-auth": {}
    },
    "priority": 10
  }' && echo "  ✓ risk-engine routes (/api/risk/*, /api/aml/*)"

# Mojaloop routes
curl -sf -X PUT "$APISIX_ADMIN/apisix/admin/routes/4" \
  -H "$H" -H "$CT" -d '{
    "id": 4,
    "name": "mojaloop-routes",
    "uris": ["/api/mojaloop/*", "/api/transfers/*"],
    "upstream_id": 4,
    "plugins": {
      "limit-req": {"rate": 10, "burst": 5, "key": "remote_addr", "rejected_code": 429},
      "jwt-auth": {}
    },
    "priority": 10
  }' && echo "  ✓ mojaloop routes (/api/mojaloop/*, /api/transfers/*)"

# Ledger routes
curl -sf -X PUT "$APISIX_ADMIN/apisix/admin/routes/5" \
  -H "$H" -H "$CT" -d '{
    "id": 5,
    "name": "ledger-routes",
    "uris": ["/api/ledger/*", "/api/accounts/*"],
    "upstream_id": 5,
    "plugins": {
      "limit-req": {"rate": 30, "burst": 15, "key": "remote_addr", "rejected_code": 429},
      "jwt-auth": {}
    },
    "priority": 10
  }' && echo "  ✓ ledger routes (/api/ledger/*, /api/accounts/*)"

# Stripe webhook — no rate limiting, signature verification handled by app
curl -sf -X PUT "$APISIX_ADMIN/apisix/admin/routes/6" \
  -H "$H" -H "$CT" -d '{
    "id": 6,
    "name": "stripe-webhook",
    "uri": "/api/stripe/webhook",
    "upstream_id": 1,
    "plugins": {
      "limit-req": {"rate": 100, "burst": 50, "key": "remote_addr", "rejected_code": 429}
    },
    "priority": 20
  }' && echo "  ✓ stripe-webhook route"

# Health check route — public, no auth
curl -sf -X PUT "$APISIX_ADMIN/apisix/admin/routes/7" \
  -H "$H" -H "$CT" -d '{
    "id": 7,
    "name": "health-check",
    "uri": "/api/health",
    "upstream_id": 1,
    "plugins": {
      "limit-req": {"rate": 10, "burst": 5, "key": "remote_addr", "rejected_code": 429}
    },
    "priority": 20
  }' && echo "  ✓ health-check route"

# ── Stablecoin routes (infra/apisix/stablecoin-routes.yaml) ──────────────────
echo ""
echo "🪙 Applying stablecoin routes (infra/apisix/stablecoin-routes.yaml)..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STABLECOIN_YAML="${STABLECOIN_ROUTES_FILE:-$SCRIPT_DIR/../../infra/apisix/stablecoin-routes.yaml}"

if [ -f "$STABLECOIN_YAML" ]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "  ✗ python3 is required to apply $STABLECOIN_YAML" >&2
    exit 1
  fi
  if ! python3 -c 'import yaml' >/dev/null 2>&1; then
    echo "  ✗ python3-yaml (PyYAML) is required to apply $STABLECOIN_YAML" >&2
    exit 1
  fi
  # The loader fails closed when APISIX_ADMIN_KEY is unset and strips any
  # plugin not present in the stock apache/apisix:3.9 image.
  python3 "$SCRIPT_DIR/apply-stablecoin-routes.py" "$APISIX_ADMIN" "$STABLECOIN_YAML"
else
  echo "  ✗ stablecoin route file not found at $STABLECOIN_YAML" >&2
  exit 1
fi

# ── Global Plugins ─────────────────────────────────────────────────────────────
echo ""
echo "🔌 Configuring global plugins..."

curl -sf -X PUT "$APISIX_ADMIN/apisix/admin/global_rules/1" \
  -H "$H" -H "$CT" -d '{
    "id": 1,
    "plugins": {
      "prometheus": {"prefer_name": true},
      "zipkin": {"endpoint": "http://jaeger:9411/api/v2/spans", "sample_ratio": 0.1, "service_name": "remitflow-gateway"}
    }
  }' && echo "  ✓ Global prometheus + zipkin tracing"

echo ""
echo "✅ APISIX configuration complete!"
echo ""
echo "Routes configured:"
echo "  /* → remitflow-app (Node.js)"
echo "  /api/fx/* → fx-engine (Go)"
echo "  /api/risk/* → risk-engine (Go)"
echo "  /api/mojaloop/* → mojaloop-connector (Go)"
echo "  /api/ledger/* → ledger-service (Go)"
echo "  /api/stripe/webhook → remitflow-app (no auth)"
echo "  /api/health → remitflow-app (public)"
