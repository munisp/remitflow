# Caddy Integration Design for RemitFlow

## 1. Executive Summary

Caddy is an enterprise-ready, open-source web server with automatic HTTPS written in Go. For the RemitFlow platform, integrating Caddy as the edge proxy provides immediate value in TLS termination, certificate lifecycle management, and edge routing.

### Value Proposition for RemitFlow
- **Automatic HTTPS/TLS Management**: Caddy procures and renews Let's Encrypt/ZeroSSL certificates automatically, removing the need for `cert-manager` or manual certificate rotation.
- **Memory Safety**: Written in Go, Caddy provides memory safety guarantees that Nginx/APISix (C/Lua) do not, reducing the attack surface at the edge.
- **Dynamic Configuration**: Caddy's REST API allows for dynamic configuration changes without reloading, aligning with RemitFlow's dynamic routing needs.
- **mTLS Capabilities**: Built-in support for mutual TLS (mTLS) for securing B2B API endpoints and inter-service communication.

## 2. Architecture Design

The recommended architecture places Caddy at the absolute edge of the network (L4/L7 ingress), handling TLS termination, basic rate limiting, and initial OIDC validation via Keycloak before passing traffic to APISix and OpenAppSec for deeper API management and WAF inspection.

### Request Flow
1. **Client** → HTTPS Request
2. **Caddy (Edge Proxy)**: 
   - Terminates TLS
   - Enforces basic Rate Limiting (L4/L7)
   - Performs OIDC Forward Auth via Keycloak (for UI/Dashboard routes)
   - Enforces mTLS (for B2B API routes)
3. **OpenAppSec (WAF)**:
   - Deep packet inspection
   - ML-based anomaly detection
4. **APISix (API Gateway)**:
   - Route resolution
   - Fine-grained API rate limiting
   - Request transformation
   - JWT validation (via Permify/Keycloak)
5. **Microservices**:
   - Business logic execution

## 3. Component Integrations

### 3.1 Caddy + Keycloak (OIDC Forward Auth)
For administrative interfaces and dashboards, Caddy will use the `forward_auth` directive to intercept requests and validate sessions against Keycloak before allowing traffic to proceed.

### 3.2 Caddy + OpenAppSec
OpenAppSec provides an Nginx/APISix attachment, but can also run as an independent reverse proxy or in tandem with Caddy. In this architecture, Caddy acts as the TLS terminator and routes traffic to the APISix gateway which has the OpenAppSec agent attached.

### 3.3 Caddy + APISix
Caddy serves as the ingress controller, terminating TLS and forwarding plain HTTP to APISix. APISix remains responsible for API-specific routing, versioning, and complex transformations.

## 4. Implementation Plan

1. Add Caddy to `docker-compose.yml`
2. Create a `Caddyfile` for configuration
3. Configure Caddy to route to APISix
4. Update APISix to trust X-Forwarded headers from Caddy
5. Configure Keycloak forward authentication for administrative routes
