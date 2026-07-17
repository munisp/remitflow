// ═══════════════════════════════════════════════════════════════════════════════
// RemitFlow — Caddy ↔ Keycloak Forward Auth Bridge
// ═══════════════════════════════════════════════════════════════════════════════
//
// This service acts as the forward_auth target for Caddy, validating JWT tokens
// issued by Keycloak and returning the appropriate headers for downstream services.
//
// Caddy's forward_auth directive sends a GET request to this service.
// This service:
//   1. Extracts the Bearer token from Authorization header or session cookie
//   2. Validates the JWT against Keycloak's JWKS endpoint (RS256)
//   3. Checks required roles (if specified via ?required_role= query param)
//   4. Returns 200 with X-Auth-* headers on success
//   5. Returns 401/403 on failure (Caddy propagates the response to the client)
//
// Port: 8090
// ═══════════════════════════════════════════════════════════════════════════════

package main

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/big"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// ── Configuration ─────────────────────────────────────────────────────────────

var (
	keycloakURL      = getEnv("KEYCLOAK_URL", "http://keycloak:8080")
	keycloakRealm    = getEnv("KEYCLOAK_REALM", "remitflow")
	listenAddr       = getEnv("LISTEN_ADDR", ":8090")
	logLevel         = getEnv("LOG_LEVEL", "info")
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ── JWKS Cache ────────────────────────────────────────────────────────────────

type JWKSCache struct {
	mu      sync.RWMutex
	keys    map[string]*rsa.PublicKey
	fetchAt time.Time
	ttl     time.Duration
}

type jwksResponse struct {
	Keys []struct {
		Kid string `json:"kid"`
		Kty string `json:"kty"`
		Use string `json:"use"`
		N   string `json:"n"`
		E   string `json:"e"`
	} `json:"keys"`
}

var jwksCache = &JWKSCache{
	keys: make(map[string]*rsa.PublicKey),
	ttl:  5 * time.Minute,
}

func (c *JWKSCache) getKey(kid string) (*rsa.PublicKey, error) {
	c.mu.RLock()
	if time.Since(c.fetchAt) < c.ttl {
		if key, ok := c.keys[kid]; ok {
			c.mu.RUnlock()
			return key, nil
		}
	}
	c.mu.RUnlock()

	if err := c.refresh(); err != nil {
		return nil, fmt.Errorf("JWKS refresh failed: %w", err)
	}

	c.mu.RLock()
	defer c.mu.RUnlock()
	key, ok := c.keys[kid]
	if !ok {
		return nil, fmt.Errorf("key ID %q not found in JWKS", kid)
	}
	return key, nil
}

func (c *JWKSCache) refresh() error {
	jwksURL := fmt.Sprintf("%s/realms/%s/protocol/openid-connect/certs", keycloakURL, keycloakRealm)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, jwksURL, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("JWKS fetch error: %w", err)
	}
	defer resp.Body.Close()

	var jwks jwksResponse
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return fmt.Errorf("JWKS decode error: %w", err)
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	c.keys = make(map[string]*rsa.PublicKey)
	for _, k := range jwks.Keys {
		if k.Kty != "RSA" || k.Use != "sig" {
			continue
		}
		pub, err := parseRSAPublicKey(k.N, k.E)
		if err != nil {
			slog.Warn("failed to parse JWKS key", "kid", k.Kid, "error", err)
			continue
		}
		c.keys[k.Kid] = pub
	}
	c.fetchAt = time.Now()
	jwksRefreshTotal.Inc()
	slog.Info("JWKS refreshed", "key_count", len(c.keys))
	return nil
}

func parseRSAPublicKey(nB64, eB64 string) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(nB64)
	if err != nil {
		return nil, err
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(eB64)
	if err != nil {
		return nil, err
	}
	n := new(big.Int).SetBytes(nBytes)
	e := new(big.Int).SetBytes(eBytes)
	return &rsa.PublicKey{N: n, E: int(e.Int64())}, nil
}

// ── JWT Parsing ───────────────────────────────────────────────────────────────

type jwtClaims struct {
	Sub               string `json:"sub"`
	Email             string `json:"email"`
	PreferredUsername string `json:"preferred_username"`
	RealmAccess       struct {
		Roles []string `json:"roles"`
	} `json:"realm_access"`
	ResourceAccess map[string]struct {
		Roles []string `json:"roles"`
	} `json:"resource_access"`
	Exp      int64  `json:"exp"`
	Iss      string `json:"iss"`
	TenantID string `json:"tenant_id"`
}

type jwtHeader struct {
	Kid string `json:"kid"`
	Alg string `json:"alg"`
}

func parseJWT(tokenStr string) (*jwtClaims, error) {
	parts := strings.Split(tokenStr, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid JWT format")
	}

	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, fmt.Errorf("header decode error: %w", err)
	}
	var header jwtHeader
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, fmt.Errorf("header unmarshal error: %w", err)
	}
	if header.Alg != "RS256" {
		return nil, fmt.Errorf("unsupported algorithm %q (only RS256 accepted)", header.Alg)
	}

	pubKey, err := jwksCache.getKey(header.Kid)
	if err != nil {
		return nil, fmt.Errorf("key lookup error: %w", err)
	}

	sigBytes, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, fmt.Errorf("signature decode error: %w", err)
	}
	if err := verifySignature(parts[0]+"."+parts[1], sigBytes, pubKey); err != nil {
		return nil, fmt.Errorf("signature verification failed: %w", err)
	}

	claimsBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("claims decode error: %w", err)
	}
	var claims jwtClaims
	if err := json.Unmarshal(claimsBytes, &claims); err != nil {
		return nil, fmt.Errorf("claims unmarshal error: %w", err)
	}

	if time.Now().Unix() > claims.Exp {
		return nil, fmt.Errorf("token expired")
	}

	expectedIss := fmt.Sprintf("%s/realms/%s", keycloakURL, keycloakRealm)
	if claims.Iss != expectedIss {
		return nil, fmt.Errorf("invalid issuer: got %q, want %q", claims.Iss, expectedIss)
	}

	return &claims, nil
}

// ── HTTP Handlers ─────────────────────────────────────────────────────────────

func verifyHandler(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	token := extractToken(r)
	if token == "" {
		authRequests.WithLabelValues("unauthorized").Inc()
		authLatency.WithLabelValues("unauthorized").Observe(time.Since(start).Seconds())
		slog.Info("no token found",
			"path", r.Header.Get("X-Forwarded-Uri"),
			"ip", r.Header.Get("X-Forwarded-For"))
		http.Error(w, "Unauthorized: no token provided", http.StatusUnauthorized)
		return
	}

	claims, err := parseJWT(token)
	if err != nil {
		authRequests.WithLabelValues("unauthorized").Inc()
		authLatency.WithLabelValues("unauthorized").Observe(time.Since(start).Seconds())
		slog.Warn("JWT validation failed",
			"error", err,
			"path", r.Header.Get("X-Forwarded-Uri"),
			"ip", r.Header.Get("X-Forwarded-For"))
		http.Error(w, "Unauthorized: "+err.Error(), http.StatusUnauthorized)
		return
	}

	requiredRole := r.URL.Query().Get("required_role")
	if requiredRole != "" && !hasRole(claims, requiredRole) {
		authRequests.WithLabelValues("forbidden").Inc()
		authLatency.WithLabelValues("forbidden").Observe(time.Since(start).Seconds())
		slog.Warn("access denied: missing required role",
			"user", claims.PreferredUsername,
			"required_role", requiredRole,
			"user_roles", claims.RealmAccess.Roles)
		http.Error(w, "Forbidden: missing role "+requiredRole, http.StatusForbidden)
		return
	}

	// Success — set headers that Caddy will copy to the upstream request
	roles := strings.Join(claims.RealmAccess.Roles, ",")
	w.Header().Set("X-Auth-User", claims.PreferredUsername)
	w.Header().Set("X-Auth-Email", claims.Email)
	w.Header().Set("X-Auth-Roles", roles)
	w.Header().Set("X-Auth-Tenant", claims.TenantID)
	w.Header().Set("X-Keycloak-ID", claims.Sub)
	w.WriteHeader(http.StatusOK)

	authRequests.WithLabelValues("success").Inc()
	authLatency.WithLabelValues("success").Observe(time.Since(start).Seconds())
	slog.Info("auth verified",
		"user", claims.PreferredUsername,
		"roles", roles,
		"path", r.Header.Get("X-Forwarded-Uri"),
		"latency_ms", time.Since(start).Milliseconds())
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"status":"ok","service":"caddy-keycloak-bridge","realm":"%s"}`, keycloakRealm)
}

func extractToken(r *http.Request) string {
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	if cookie, err := r.Cookie("access_token"); err == nil {
		return cookie.Value
	}
	if t := r.URL.Query().Get("token"); t != "" {
		return t
	}
	return ""
}

func hasRole(claims *jwtClaims, role string) bool {
	for _, r := range claims.RealmAccess.Roles {
		if r == role {
			return true
		}
	}
	for _, access := range claims.ResourceAccess {
		for _, r := range access.Roles {
			if r == role {
				return true
			}
		}
	}
	return false
}

// ── Main ──────────────────────────────────────────────────────────────────────

func main() {
	level := slog.LevelInfo
	if logLevel == "debug" {
		level = slog.LevelDebug
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})))

	slog.Info("starting caddy-keycloak-bridge",
		"addr", listenAddr,
		"keycloak_url", keycloakURL,
		"realm", keycloakRealm)

	// Pre-warm JWKS cache
	if err := jwksCache.refresh(); err != nil {
		slog.Warn("initial JWKS fetch failed (will retry on first request)", "error", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /auth/verify", verifyHandler)
	mux.HandleFunc("GET /health", healthHandler)
	mux.HandleFunc("GET /metrics", metricsHandler)

	srv := &http.Server{
		Addr:         listenAddr,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	slog.Info("caddy-keycloak-bridge listening", "addr", listenAddr)
	if err := srv.ListenAndServe(); err != nil {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}
