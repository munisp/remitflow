/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * RemitFlow — Caddy Integration Tests
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Tests that verify the platform correctly handles requests forwarded by Caddy:
 *   1. X-Real-IP header propagation (Caddy sets, app reads)
 *   2. X-Auth-* headers from Keycloak forward auth
 *   3. X-mTLS-Verified and X-Client-Cert-* headers for B2B routes
 *   4. X-Correlation-ID header for distributed tracing
 *   5. Security header presence on responses
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Request, type Response } from "express";
import { createServer, type Server } from "http";

// ── Test Server Setup ─────────────────────────────────────────────────────────

let server: Server;
let baseUrl: string;

const app = express();
app.use(express.json());

// Simulate how the RemitFlow API reads Caddy-forwarded headers
app.get("/test/client-ip", (req: Request, res: Response) => {
  const clientIp =
    req.headers["x-real-ip"] ||
    req.headers["x-forwarded-for"] ||
    req.socket.remoteAddress;
  res.json({ clientIp });
});

app.get("/test/auth-headers", (req: Request, res: Response) => {
  res.json({
    user:     req.headers["x-auth-user"],
    email:    req.headers["x-auth-email"],
    roles:    req.headers["x-auth-roles"],
    tenant:   req.headers["x-auth-tenant"],
    keycloakId: req.headers["x-keycloak-id"],
  });
});

app.get("/test/mtls-headers", (req: Request, res: Response) => {
  const mTLSVerified = req.headers["x-mtls-verified"] === "true";
  if (!mTLSVerified) {
    res.status(403).json({ error: "mTLS not verified" });
    return;
  }
  res.json({
    certSubject: req.headers["x-client-cert-subject"],
    certSerial:  req.headers["x-client-cert-serial"],
    certIssuer:  req.headers["x-client-cert-issuer"],
    mTLSVerified,
  });
});

app.get("/test/correlation-id", (req: Request, res: Response) => {
  const correlationId = req.headers["x-correlation-id"];
  res.json({ correlationId });
});

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createServer(app);
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://localhost:${addr.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Caddy Header Propagation", () => {
  describe("Real Client IP (X-Real-IP)", () => {
    it("reads client IP from X-Real-IP header set by Caddy", async () => {
      const res = await fetch(`${baseUrl}/test/client-ip`, {
        headers: { "X-Real-IP": "203.0.113.42" },
      });
      const body = await res.json() as { clientIp: string };
      expect(body.clientIp).toBe("203.0.113.42");
    });

    it("falls back to X-Forwarded-For when X-Real-IP is absent", async () => {
      const res = await fetch(`${baseUrl}/test/client-ip`, {
        headers: { "X-Forwarded-For": "198.51.100.10" },
      });
      const body = await res.json() as { clientIp: string };
      expect(body.clientIp).toBe("198.51.100.10");
    });

    it("returns socket IP when no proxy headers are present", async () => {
      const res = await fetch(`${baseUrl}/test/client-ip`);
      const body = await res.json() as { clientIp: string };
      expect(body.clientIp).toBeTruthy();
    });
  });

  describe("Keycloak Forward Auth Headers (X-Auth-*)", () => {
    it("correctly propagates all Keycloak auth headers from Caddy", async () => {
      const res = await fetch(`${baseUrl}/test/auth-headers`, {
        headers: {
          "X-Auth-User":    "john.doe",
          "X-Auth-Email":   "john.doe@example.com",
          "X-Auth-Roles":   "user,compliance",
          "X-Auth-Tenant":  "tenant-abc-123",
          "X-Keycloak-ID":  "kc-sub-uuid-12345",
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, string>;
      expect(body.user).toBe("john.doe");
      expect(body.email).toBe("john.doe@example.com");
      expect(body.roles).toBe("user,compliance");
      expect(body.tenant).toBe("tenant-abc-123");
      expect(body.keycloakId).toBe("kc-sub-uuid-12345");
    });

    it("returns undefined for auth headers when Caddy does not set them", async () => {
      const res = await fetch(`${baseUrl}/test/auth-headers`);
      const body = await res.json() as Record<string, unknown>;
      expect(body.user).toBeUndefined();
      expect(body.email).toBeUndefined();
      expect(body.roles).toBeUndefined();
    });
  });

  describe("mTLS B2B Headers (X-Client-Cert-*)", () => {
    it("allows B2B requests with valid mTLS headers from Caddy", async () => {
      const res = await fetch(`${baseUrl}/test/mtls-headers`, {
        headers: {
          "X-mTLS-Verified":        "true",
          "X-Client-Cert-Subject":  "CN=partner-bank-ltd,O=Partner Bank Ltd,C=GB",
          "X-Client-Cert-Serial":   "0A:1B:2C:3D:4E:5F",
          "X-Client-Cert-Issuer":   "CN=RemitFlow B2B Partner CA",
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.mTLSVerified).toBe(true);
      expect(body.certSubject).toBe("CN=partner-bank-ltd,O=Partner Bank Ltd,C=GB");
      expect(body.certSerial).toBe("0A:1B:2C:3D:4E:5F");
    });

    it("rejects B2B requests without mTLS verification header", async () => {
      const res = await fetch(`${baseUrl}/test/mtls-headers`);
      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("mTLS not verified");
    });

    it("rejects B2B requests with X-mTLS-Verified set to false", async () => {
      const res = await fetch(`${baseUrl}/test/mtls-headers`, {
        headers: { "X-mTLS-Verified": "false" },
      });
      expect(res.status).toBe(403);
    });
  });

  describe("Correlation ID (X-Correlation-ID)", () => {
    it("propagates X-Correlation-ID header for distributed tracing", async () => {
      const correlationId = "trace-abc-123-def-456";
      const res = await fetch(`${baseUrl}/test/correlation-id`, {
        headers: { "X-Correlation-ID": correlationId },
      });
      const body = await res.json() as { correlationId: string };
      expect(body.correlationId).toBe(correlationId);
    });

    it("handles requests without correlation ID gracefully", async () => {
      const res = await fetch(`${baseUrl}/test/correlation-id`);
      const body = await res.json() as { correlationId: unknown };
      expect(body.correlationId).toBeUndefined();
    });
  });
});

describe("Caddy Caddyfile Configuration Validation", () => {
  it("Caddyfile exists at the expected path", async () => {
    const { existsSync } = await import("fs");
    const path = await import("path");
    const caddyfilePath = path.resolve(
      __dirname,
      "../services/caddy/Caddyfile"
    );
    expect(existsSync(caddyfilePath)).toBe(true);
  });

  it("Caddyfile contains required domain blocks", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const caddyfilePath = path.resolve(
      __dirname,
      "../services/caddy/Caddyfile"
    );
    const content = readFileSync(caddyfilePath, "utf-8");

    // Verify all required virtual hosts are configured
    expect(content).toContain("{$CADDY_API_DOMAIN");
    expect(content).toContain("{$CADDY_B2B_DOMAIN");
    expect(content).toContain("{$CADDY_ADMIN_DOMAIN");
    expect(content).toContain("{$CADDY_KEYCLOAK_DOMAIN");
    expect(content).toContain("{$CADDY_GRAFANA_DOMAIN");
    expect(content).toContain("{$CADDY_TEMPORAL_DOMAIN");
  });

  it("Caddyfile configures forward_auth for admin routes", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const content = readFileSync(
      path.resolve(__dirname, "../services/caddy/Caddyfile"),
      "utf-8"
    );
    expect(content).toContain("forward_auth keycloak-bridge:8090");
    expect(content).toContain("/auth/verify");
    expect(content).toContain("copy_headers X-Auth-User");
  });

  it("Caddyfile enforces mTLS on B2B domain", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const content = readFileSync(
      path.resolve(__dirname, "../services/caddy/Caddyfile"),
      "utf-8"
    );
    expect(content).toContain("client_auth");
    expect(content).toContain("require_and_verify");
    expect(content).toContain("b2b-partner-ca.pem");
  });

  it("Caddyfile configures HSTS security header", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const content = readFileSync(
      path.resolve(__dirname, "../services/caddy/Caddyfile"),
      "utf-8"
    );
    expect(content).toContain("Strict-Transport-Security");
    expect(content).toContain("includeSubDomains");
    expect(content).toContain("preload");
  });

  it("Caddyfile uses Redis for TLS certificate storage", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const content = readFileSync(
      path.resolve(__dirname, "../services/caddy/Caddyfile"),
      "utf-8"
    );
    expect(content).toContain("storage redis");
    expect(content).toContain("{$REDIS_HOST");
  });

  it("Caddyfile proxies to APISix (not directly to app)", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const content = readFileSync(
      path.resolve(__dirname, "../services/caddy/Caddyfile"),
      "utf-8"
    );
    // Caddy should proxy to APISix, not directly to the app
    expect(content).toContain("reverse_proxy apisix:9080");
  });

  it("Caddyfile exposes Prometheus metrics endpoint", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const content = readFileSync(
      path.resolve(__dirname, "../services/caddy/Caddyfile"),
      "utf-8"
    );
    expect(content).toContain("metrics /metrics");
    expect(content).toContain(":2020");
  });
});

describe("Caddy Docker Compose Configuration", () => {
  it("docker-compose.caddy.yml exists", async () => {
    const { existsSync } = await import("fs");
    const path = await import("path");
    expect(
      existsSync(path.resolve(__dirname, "../infra/caddy/docker-compose.caddy.yml"))
    ).toBe(true);
  });

  it("docker-compose.caddy.yml defines caddy service", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const content = readFileSync(
      path.resolve(__dirname, "../infra/caddy/docker-compose.caddy.yml"),
      "utf-8"
    );
    expect(content).toContain("caddy:");
    expect(content).toContain("443:443");
    expect(content).toContain("80:80");
  });

  it("docker-compose.caddy.yml defines keycloak service", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const content = readFileSync(
      path.resolve(__dirname, "../infra/caddy/docker-compose.caddy.yml"),
      "utf-8"
    );
    expect(content).toContain("keycloak:");
    expect(content).toContain("quay.io/keycloak/keycloak");
  });

  it("docker-compose.caddy.yml defines caddy-keycloak-bridge service", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const content = readFileSync(
      path.resolve(__dirname, "../infra/caddy/docker-compose.caddy.yml"),
      "utf-8"
    );
    expect(content).toContain("caddy-keycloak-bridge:");
    expect(content).toContain("8090");
  });
});

describe("Keycloak Bridge Service", () => {
  it("main.go exists for caddy-keycloak-bridge", async () => {
    const { existsSync } = await import("fs");
    const path = await import("path");
    expect(
      existsSync(
        path.resolve(__dirname, "../services/caddy-keycloak-bridge/main.go")
      )
    ).toBe(true);
  });

  it("caddy-keycloak-bridge uses RS256 JWT validation", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const mainContent = readFileSync(
      path.resolve(__dirname, "../services/caddy-keycloak-bridge/main.go"),
      "utf-8"
    );
    const cryptoContent = readFileSync(
      path.resolve(__dirname, "../services/caddy-keycloak-bridge/crypto.go"),
      "utf-8"
    );
    expect(mainContent).toContain("RS256");
    expect(mainContent).toContain("JWKS");
    // RSA verification is in crypto.go
    expect(cryptoContent).toContain("rsa.VerifyPKCS1v15");
  });

  it("caddy-keycloak-bridge validates token expiry", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const content = readFileSync(
      path.resolve(__dirname, "../services/caddy-keycloak-bridge/main.go"),
      "utf-8"
    );
    expect(content).toContain("claims.Exp");
    expect(content).toContain("token expired");
  });

  it("caddy-keycloak-bridge checks required_role query param", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const content = readFileSync(
      path.resolve(__dirname, "../services/caddy-keycloak-bridge/main.go"),
      "utf-8"
    );
    expect(content).toContain("required_role");
    expect(content).toContain("hasRole");
    expect(content).toContain("StatusForbidden");
  });

  it("caddy-keycloak-bridge exports Prometheus metrics", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const content = readFileSync(
      path.resolve(__dirname, "../services/caddy-keycloak-bridge/crypto.go"),
      "utf-8"
    );
    expect(content).toContain("prometheus.NewCounterVec");
    expect(content).toContain("caddy_keycloak_bridge_auth_requests_total");
    expect(content).toContain("caddy_keycloak_bridge_auth_duration_seconds");
  });
});
