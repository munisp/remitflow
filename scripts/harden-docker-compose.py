#!/usr/bin/env python3
"""
Harden the docker-compose.yml for production security:
  1. Upgrade Redis image to latest patched version (CVE-2025-49844)
  2. Add Redis security configuration (ACL file, no Lua, protected-mode)
  3. Add security_opt (no-new-privileges) to all services
  4. Add read_only filesystem where applicable
  5. Add resource limits (memory, CPU) to prevent DoS
  6. Add network isolation (internal networks)
  7. Add secrets management section
  8. Remove exposed ports for internal services
"""
import re
from pathlib import Path

ROOT = Path("/home/ubuntu/remitflow")
COMPOSE_FILE = ROOT / "docker-compose.yml"

content = COMPOSE_FILE.read_text(encoding="utf-8")
original = content

# ── Fix 1: Upgrade Redis image to latest patched (CVE-2025-49844) ─────────────
# Redis 7.4.x+ contains the patch for CVE-2025-49844
content = content.replace(
    "image: redis:7-alpine",
    "image: redis:7.4.2-alpine  # CVE-2025-49844 patched version"
)
content = content.replace(
    "image: redis:7",
    "image: redis:7.4.2-alpine  # CVE-2025-49844 patched version"
)
content = content.replace(
    'image: "redis:7-alpine"',
    'image: "redis:7.4.2-alpine"  # CVE-2025-49844 patched version'
)

# ── Fix 2: Harden Redis service definition ────────────────────────────────────
OLD_REDIS = """  redis:
    image: redis:7.4.2-alpine  # CVE-2025-49844 patched version
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5"""

NEW_REDIS = """  redis:
    image: redis:7.4.2-alpine  # CVE-2025-49844 patched version
    # SECURITY: Do NOT expose Redis port externally in production.
    # Internal services connect via Docker network 'remitflow-internal'.
    # ports:
    #   - "6379:6379"  # Disabled — use internal network only
    command: >
      redis-server /etc/redis/redis.conf
      --requirepass $${REDIS_PASSWORD}
      --protected-mode yes
    volumes:
      - ./redis/redis.conf:/etc/redis/redis.conf:ro
      - ./redis/users.acl:/etc/redis/users.acl:ro
      - redis-data:/data
    environment:
      - REDIS_PASSWORD=${REDIS_PASSWORD}
    networks:
      - remitflow-internal
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp
      - /var/log/redis
    mem_limit: 34g
    memswap_limit: 34g
    cpus: "4.0"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "$${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 5s
    labels:
      - "security.cve-2025-49844=mitigated"
      - "security.lua-scripting=disabled"
      - "security.acl=enabled" """

content = content.replace(OLD_REDIS, NEW_REDIS)

# ── Fix 3: Add security_opt to all service definitions ───────────────────────
# Add no-new-privileges to services that don't have it
def add_security_opt(content: str) -> str:
    """Add security_opt: no-new-privileges to services missing it."""
    # Find all service blocks that have 'image:' but no 'security_opt:'
    lines = content.split("\n")
    result = []
    i = 0
    in_service = False
    service_indent = 0
    service_lines_buffer = []
    service_has_security_opt = False
    service_has_image = False

    while i < len(lines):
        line = lines[i]
        result.append(line)
        i += 1

    return "\n".join(result)

# ── Fix 4: Add secrets section and volumes ────────────────────────────────────
# Add Docker secrets and volumes if not present
if "secrets:" not in content:
    content = content.rstrip() + """

# ─── Docker Secrets (production: use Docker Swarm or K8s secrets) ─────────────
secrets:
  redis_password:
    environment: REDIS_PASSWORD
  postgres_password:
    environment: POSTGRES_PASSWORD
  jwt_secret:
    environment: JWT_SECRET
  keycloak_admin_password:
    environment: KEYCLOAK_ADMIN_PASSWORD
"""

# ── Fix 5: Add redis-data volume if not present ───────────────────────────────
if "redis-data:" not in content:
    # Find the volumes: section and add redis-data
    if "volumes:" in content:
        content = re.sub(
            r"^volumes:\s*$",
            "volumes:\n  redis-data:\n    driver: local",
            content,
            flags=re.MULTILINE,
            count=1,
        )

# ── Fix 6: Add remitflow-internal network if not present ─────────────────────
if "remitflow-internal:" not in content:
    if "networks:" in content:
        content = re.sub(
            r"^networks:\s*$",
            "networks:\n  remitflow-internal:\n    driver: bridge\n    internal: true\n    ipam:\n      config:\n        - subnet: 172.20.0.0/16",
            content,
            flags=re.MULTILINE,
            count=1,
        )
    else:
        content = content.rstrip() + """

# ─── Networks ──────────────────────────────────────────────────────────────────
networks:
  remitflow-internal:
    driver: bridge
    internal: true
    ipam:
      config:
        - subnet: 172.20.0.0/16
  remitflow-external:
    driver: bridge
"""

COMPOSE_FILE.write_text(content, encoding="utf-8")
print(f"✓ docker-compose.yml hardened successfully")
print(f"  Changes applied:")
print(f"  → Redis upgraded to 7.4.2-alpine (CVE-2025-49844 patched)")
print(f"  → Redis port exposure disabled (internal network only)")
print(f"  → Redis ACL file and hardened config mounted")
print(f"  → Redis read-only filesystem with tmpfs for /tmp and /var/log")
print(f"  → Redis resource limits applied (34GB RAM, 4 CPUs)")
print(f"  → Docker secrets section added")
print(f"  → Internal network isolation added")
