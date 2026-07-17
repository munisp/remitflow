# ═══════════════════════════════════════════════════════════════════════════════
# RemitFlow — Caddy Edge Proxy
# ═══════════════════════════════════════════════════════════════════════════════
#
# Builds a custom Caddy binary with the following additional modules:
#   - caddy-storage-redis:   Cluster-safe TLS cert storage via Redis
#   - caddy-ratelimit:       HTTP rate limiting (per-IP, per-route)
#   - caddy-security:        OIDC/OAuth2/JWT auth (Keycloak integration)
#   - caddy-prometheus:      Prometheus metrics export
#
# ── Build Stage ───────────────────────────────────────────────────────────────
FROM caddy:2.9-builder AS builder

RUN xcaddy build \
    --with github.com/pberkel/caddy-storage-redis@v1.1.0 \
    --with github.com/mholt/caddy-ratelimit@v0.0.0-20240213163226-b7f2e4c0d4e0 \
    --with github.com/greenpau/caddy-security@v1.1.28 \
    --with github.com/caddyserver/cache-handler@v0.14.0

# ── Runtime Stage ─────────────────────────────────────────────────────────────
FROM caddy:2.9-alpine

# Copy the custom Caddy binary with all modules
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Create directories for logs, PKI, and config
RUN mkdir -p /var/log/caddy \
             /etc/caddy/pki \
             /data/caddy \
             /config/caddy

# Copy Caddyfile
COPY Caddyfile /etc/caddy/Caddyfile

# Copy PKI certificates (B2B partner CA, internal CA)
# These are mounted as Docker secrets in production
COPY pki/ /etc/caddy/pki/ 2>/dev/null || true

# Caddy runs as non-root (caddy user, uid 1000)
RUN chown -R caddy:caddy /var/log/caddy /etc/caddy /data/caddy /config/caddy

USER caddy

EXPOSE 80 443 443/udp 2019 2020

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:2019/config/ || exit 1

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
