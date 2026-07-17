package main

import (
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ── RSA-SHA256 Signature Verification ────────────────────────────────────────

// verifySignature verifies an RSA-SHA256 JWT signature.
// data is the base64url-encoded "header.payload" string (the signed content).
// sig is the raw signature bytes decoded from the JWT's third segment.
func verifySignature(data string, sig []byte, pub *rsa.PublicKey) error {
	h := sha256.New()
	h.Write([]byte(data))
	digest := h.Sum(nil)
	return rsa.VerifyPKCS1v15(pub, crypto.SHA256, digest, sig)
}

// ── Prometheus Metrics ────────────────────────────────────────────────────────

var (
	authRequests = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "caddy_keycloak_bridge_auth_requests_total",
			Help: "Total authentication requests processed by the bridge",
		},
		[]string{"result"}, // "success", "unauthorized", "forbidden", "error"
	)
	authLatency = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "caddy_keycloak_bridge_auth_duration_seconds",
			Help:    "Authentication request latency in seconds",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"result"},
	)
	jwksRefreshTotal = prometheus.NewCounter(
		prometheus.CounterOpts{
			Name: "caddy_keycloak_bridge_jwks_refreshes_total",
			Help: "Total JWKS cache refresh operations",
		},
	)
)

func init() {
	prometheus.MustRegister(authRequests, authLatency, jwksRefreshTotal)
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	promhttp.Handler().ServeHTTP(w, r)
}

// ── Token Introspection (for opaque/reference tokens) ─────────────────────────

// introspectToken calls Keycloak's token introspection endpoint for opaque tokens.
// This is a fallback when the token is not a standard JWT.
func introspectToken(token, clientID, clientSecret string) (*jwtClaims, error) {
	introspectURL := fmt.Sprintf("%s/realms/%s/protocol/openid-connect/token/introspect",
		keycloakURL, keycloakRealm)

	body := strings.NewReader(fmt.Sprintf(
		"token=%s&client_id=%s&client_secret=%s",
		token, clientID, clientSecret))

	resp, err := http.Post(introspectURL, "application/x-www-form-urlencoded", body)
	if err != nil {
		return nil, fmt.Errorf("introspection request failed: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Active            bool   `json:"active"`
		Sub               string `json:"sub"`
		Email             string `json:"email"`
		PreferredUsername string `json:"preferred_username"`
		Exp               int64  `json:"exp"`
		RealmAccess       struct {
			Roles []string `json:"roles"`
		} `json:"realm_access"`
	}
	rawBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("introspection read error: %w", err)
	}
	if err := json.Unmarshal(rawBody, &result); err != nil {
		return nil, fmt.Errorf("introspection decode error: %w", err)
	}
	if !result.Active {
		return nil, fmt.Errorf("token is not active")
	}
	claims := &jwtClaims{
		Sub:               result.Sub,
		Email:             result.Email,
		PreferredUsername: result.PreferredUsername,
		Exp:               result.Exp,
	}
	claims.RealmAccess.Roles = result.RealmAccess.Roles
	return claims, nil
}
