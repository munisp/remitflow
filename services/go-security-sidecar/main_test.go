// RemitFlow — Go Security Sidecar Tests
package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newTestSidecar(t *testing.T) *SecuritySidecar {
	t.Helper()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(upstream.Close)
	cfg := configFromEnv()
	cfg.UpstreamURL = upstream.URL
	cfg.BlockAfterRPS = 1000 // high limit so tests don't hit rate limit
	cfg.BurstSize = 1000
	s, err := newSidecar(cfg)
	if err != nil {
		t.Fatalf("newSidecar: %v", err)
	}
	return s
}

func TestAllowNormalRequest(t *testing.T) {
	s := newTestSidecar(t)
	req := httptest.NewRequest("GET", "/api/health", nil)
	req.RemoteAddr = "1.2.3.4:5678"
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestBlockSuspiciousUA(t *testing.T) {
	s := newTestSidecar(t)
	req := httptest.NewRequest("GET", "/api/health", nil)
	req.Header.Set("User-Agent", "sqlmap/1.7.8#stable")
	req.RemoteAddr = "1.2.3.5:5678"
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404 for scanner UA, got %d", rr.Code)
	}
}

func TestBlockDisallowedMethod(t *testing.T) {
	s := newTestSidecar(t)
	req := httptest.NewRequest("TRACE", "/api/health", nil)
	req.RemoteAddr = "1.2.3.6:5678"
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 for TRACE, got %d", rr.Code)
	}
}

func TestBlockOversizedPayload(t *testing.T) {
	s := newTestSidecar(t)
	body := strings.NewReader(strings.Repeat("x", 20*1024)) // 20 KB > 10 KB limit
	req := httptest.NewRequest("POST", "/api/trpc/transfer.send", body)
	req.ContentLength = 20 * 1024
	req.RemoteAddr = "1.2.3.7:5678"
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, req)
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("expected 413 for oversized payload, got %d", rr.Code)
	}
}

func TestBlockIPBlocklist(t *testing.T) {
	s := newTestSidecar(t)
	// 192.0.2.1 is in the TEST-NET CIDR pre-loaded in the blocklist
	req := httptest.NewRequest("GET", "/api/health", nil)
	req.RemoteAddr = "192.0.2.1:5678"
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403 for blocked IP, got %d", rr.Code)
	}
}

func TestRateLimitExceeded(t *testing.T) {
	s := newTestSidecar(t)
	// Override to very low limit
	s.cfg.BlockAfterRPS = 1
	s.cfg.BurstSize = 1
	s.store = newRateLimiterStore(s.cfg)

	ip := "1.2.3.100"
	blocked := 0
	for i := 0; i < 20; i++ {
		req := httptest.NewRequest("GET", "/api/health", nil)
		req.RemoteAddr = ip + ":5678"
		rr := httptest.NewRecorder()
		s.ServeHTTP(rr, req)
		if rr.Code == http.StatusTooManyRequests {
			blocked++
		}
	}
	if blocked == 0 {
		t.Error("expected at least one request to be rate-limited")
	}
}

func TestAmplificationPrevention(t *testing.T) {
	s := newTestSidecar(t)
	req := httptest.NewRequest("GET", "/api/trpc/transactions.list", nil)
	req.RemoteAddr = "1.2.3.8:5678"
	// No Cookie or Authorization header
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for unauthenticated heavy endpoint, got %d", rr.Code)
	}
}

func TestHealthEndpoint(t *testing.T) {
	cfg := configFromEnv()
	cfg.UpstreamURL = "http://localhost:19999" // nothing listening
	s, _ := newSidecar(cfg)
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})
	mux.Handle("/", s)
	req := httptest.NewRequest("GET", "/healthz", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 for /healthz, got %d", rr.Code)
	}
}

func TestExtractIPFromXFF(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-Forwarded-For", "203.0.113.5, 10.0.0.1")
	req.RemoteAddr = "10.0.0.1:1234"
	ip := extractIP(req)
	if ip != "203.0.113.5" {
		t.Errorf("expected 203.0.113.5, got %s", ip)
	}
}

func TestSuspiciousUAPatterns(t *testing.T) {
	cases := []struct {
		ua      string
		blocked bool
	}{
		{"Mozilla/5.0 (compatible; Googlebot/2.1)", false},
		{"sqlmap/1.7.8#stable (https://sqlmap.org)", true},
		{"Nikto/2.1.6", true},
		{"gobuster/3.1.0", true},
		{"curl/7.88.1", false},
		{"python-requests/2.28.0", false},
	}
	for _, tc := range cases {
		got := isSuspiciousUA(tc.ua)
		if got != tc.blocked {
			t.Errorf("UA %q: expected blocked=%v, got %v", tc.ua, tc.blocked, got)
		}
	}
}

// ─── WAF Pattern Detection Tests ─────────────────────────────────────────────

func TestWAFPatternDetection(t *testing.T) {
	cases := []struct {
		name    string
		method  string
		url     string
		body    string
		blocked bool
	}{
		{"clean GET", "GET", "/api/trpc/user.me", "", false},
		{"clean POST", "POST", "/api/trpc/transactions.create", `{"amount":100,"currency":"NGN"}`, false},
		{"SQL injection UNION SELECT", "GET", "/api/search?q=1+UNION+SELECT+*+FROM+users", "", true},
		{"SQL injection OR 1=1", "GET", "/api/data?id=1'+OR+'1'='1", "", true},
		{"XSS script tag in query", "GET", "/api/search?q=%3Cscript%3Ealert(1)%3C/script%3E", "", true},
		{"XSS javascript: scheme", "GET", "/api/redirect?url=javascript:alert(1)", "", true},
		{"path traversal", "GET", "/api/files?path=../../etc/passwd", "", true},
		{"ransomware body", "POST", "/api/upload", "your_files_are_encrypted pay bitcoin", true},
		{"command injection body", "POST", "/api/exec", "cmd=; cat /etc/passwd", true},
		{"SSRF metadata endpoint", "GET", "/api/proxy?url=http://169.254.169.254/latest/meta-data", "", true},
		{"DROP TABLE injection", "POST", "/api/query", "DROP TABLE users", true},
		{"eval XSS in body", "POST", "/api/render", `{"template":"<img onerror=eval(atob('...'))>"}`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var req *http.Request
			if tc.body != "" {
				req = httptest.NewRequest(tc.method, tc.url, strings.NewReader(tc.body))
			} else {
				req = httptest.NewRequest(tc.method, tc.url, nil)
			}
			blocked, _ := wafInspect(req)
			if blocked != tc.blocked {
				t.Errorf("WAF %q: expected blocked=%v, got %v", tc.name, tc.blocked, blocked)
			}
		})
	}
}

func TestWAFIntegration(t *testing.T) {
	s := newTestSidecar(t)

	// SQL injection should be blocked end-to-end
	req := httptest.NewRequest("GET", "/api/search?q=1+UNION+SELECT+password+FROM+users", nil)
	req.RemoteAddr = "5.6.7.8:1234"
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403 for SQL injection, got %d", rr.Code)
	}

	// Clean request should pass through
	req2 := httptest.NewRequest("GET", "/api/trpc/user.me", nil)
	req2.RemoteAddr = "5.6.7.9:1234"
	rr2 := httptest.NewRecorder()
	s.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusOK {
		t.Errorf("expected 200 for clean request, got %d", rr2.Code)
	}
}
