package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// GO-C3: no hardcoded master key — when INTERNAL_SERVICE_KEY is unset,
// the previously hardcoded "remitflow-internal-2026" key must NOT authenticate.
func TestAuthMiddleware_NoHardcodedKey(t *testing.T) {
	t.Setenv("INTERNAL_SERVICE_KEY", "")
	cfg := LoadConfig("test")
	h := AuthMiddleware(cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	for _, hdr := range []string{"X-API-Key", "Authorization"} {
		req := httptest.NewRequest("GET", "/api/v1/transfers", nil)
		if hdr == "X-API-Key" {
			req.Header.Set("X-API-Key", "remitflow-internal-2026")
		} else {
			req.Header.Set("Authorization", "Bearer remitflow-internal-2026")
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s with legacy hardcoded key: got %d, want 401", hdr, rec.Code)
		}
	}
}

// GO-C3: correct key from env must authenticate.
func TestAuthMiddleware_EnvKeyAccepted(t *testing.T) {
	t.Setenv("INTERNAL_SERVICE_KEY", "test-secret-key-123")
	cfg := LoadConfig("test")
	h := AuthMiddleware(cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest("GET", "/api/v1/transfers", nil)
	req.Header.Set("X-API-Key", "test-secret-key-123")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid env key rejected: got %d", rec.Code)
	}
	// Wrong key must be rejected even when env key is set.
	req2 := httptest.NewRequest("GET", "/api/v1/transfers", nil)
	req2.Header.Set("X-API-Key", "remitflow-internal-2026")
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusUnauthorized {
		t.Fatalf("wrong key accepted: got %d", rec2.Code)
	}
}

// GO-C3: Keycloak validator returning non-200 with a JSON body must NOT authenticate.
func TestValidateKeycloakToken_Non200Rejected(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]any{"error": "invalid_token", "sub": "attacker"})
	}))
	defer srv.Close()
	// Point the validator client at our test server by overriding httpClient transport.
	old := httpClient
	httpClient = srv.Client()
	defer func() { httpClient = old }()
	// ValidateKeycloakToken hardcodes localhost:8100; use a transport redirect.
	httpClient.Transport = rewriteTransport{target: srv.URL, base: http.DefaultTransport}
	claims, err := ValidateKeycloakToken(context.Background(), LoadConfig("test"), "forged-token")
	if err == nil || claims != nil {
		t.Fatalf("non-200 validator response accepted: claims=%v err=%v", claims, err)
	}
}

// GO-C3: 200 with valid claims (sub) authenticates.
func TestValidateKeycloakToken_ValidClaims(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{"sub": "user-1", "active": true})
	}))
	defer srv.Close()
	old := httpClient
	httpClient = srv.Client()
	defer func() { httpClient = old }()
	httpClient.Transport = rewriteTransport{target: srv.URL, base: http.DefaultTransport}
	claims, err := ValidateKeycloakToken(context.Background(), LoadConfig("test"), "good-token")
	if err != nil || claims["sub"] != "user-1" {
		t.Fatalf("valid token rejected: claims=%v err=%v", claims, err)
	}
}

// GO-C3: 200 with active:false must be rejected.
func TestValidateKeycloakToken_InactiveRejected(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{"active": false})
	}))
	defer srv.Close()
	old := httpClient
	httpClient = srv.Client()
	defer func() { httpClient = old }()
	httpClient.Transport = rewriteTransport{target: srv.URL, base: http.DefaultTransport}
	if _, err := ValidateKeycloakToken(context.Background(), LoadConfig("test"), "tok"); err == nil {
		t.Fatal("inactive token accepted")
	}
}

// rewriteTransport rewrites all requests to the test server URL.
type rewriteTransport struct {
	target string
	base   http.RoundTripper
}

func (rt rewriteTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req2 := req.Clone(req.Context())
	req2.URL.Scheme = "http"
	req2.URL.Host = rt.target[len("http://"):]
	return rt.base.RoundTrip(req2)
}
