// RemitFlow — Accounting Sync Service (Go)
// ═══════════════════════════════════════════════
// OAuth + bidirectional sync bridge for QuickBooks Online and Xero, plus
// Odoo (open source, self-hostable) via JSON-RPC API-key authentication.
//
// Trust boundaries (hard rules):
//   - This service NEVER persists OAuth tokens. The callback handler exchanges
//     the authorization code and immediately forwards the token bundle to the
//     TS core (TS_CALLBACK_URL) over X-Service-Key auth; the TS core encrypts
//     tokens with secretBox and owns the accounting_connections rows.
//   - Tokens are never logged. Log lines carry connection IDs and provider
//     names only.
//   - Fail closed everywhere: missing INTERNAL_SERVICE_KEY aborts boot; an
//     unconfigured provider answers 503; an unset COA_MAP_JSON answers 503;
//     sync errors are returned per-entity and never reported as success.
//
// Dapr integration (optional, DAPR_HTTP_PORT set):
//   - State store "redis-state" holds OAuth state nonces and sync cursors.
//   - Pub/sub component "kafka-pubsub" publishes remitflow.accounting-sync.
//   Without Dapr the service warns and falls back to an in-memory nonce map
//   (TTL-bounded), a local cursor file, and a direct TS event emit.
//
// Endpoints:
//   GET  /health                      — liveness + provider/dapr status
//   GET  /auth/{provider}/start       — 302 to provider OAuth authorize URL
//   GET|POST /auth/{provider}/callback — code→token exchange, forward to TS
//   POST /sync/push                   — TS pending bundle → provider entities
//   POST /sync/pull                   — provider updates → TS core
//   GET  /export/csv                  — TS ledger rows → COA-mapped CSV

package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

const (
	serviceName = "go-accounting-sync"
	version     = "v1"

	defaultPort = "8113"

	// providerQuickBooks / providerXero / providerOdoo are the supported
	// provider slugs. Odoo (Community, LGPL — open source, self-hostable)
	// authenticates with username + API key over JSON-RPC, NOT OAuth2, so
	// the /auth/odoo/* endpoints always fail closed with an honest message.
	providerQuickBooks = "quickbooks_online"
	providerXero       = "xero"
	providerOdoo       = "odoo"

	qboAuthorizeURL  = "https://appcenter.intuit.com/connect/oauth2"
	qboTokenURL      = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
	xeroAuthorizeURL = "https://login.xero.com/identity/connect/authorize"
	xeroTokenURL     = "https://identity.xero.com/connect/token"
	// xeroAPIBase is the single fixed Xero API base (not environment-specific).
	xeroAPIBase = "https://api.xero.com/api.xro/2.0"

	qboScope  = "com.intuit.quickbooks.accounting"
	xeroScope = "accounting.transactions accounting.contacts offline_access"

	// nonceTTL bounds how long an OAuth state nonce remains valid.
	nonceTTL = 10 * time.Minute
	// nonceBytes is the entropy of the OAuth state nonce.
	nonceBytes = 32

	// maxBundleBytes bounds TS bundle / provider responses.
	maxBundleBytes = 10 << 20 // 10 MiB
	// maxBatchEntities bounds entities accepted per sync push.
	maxBatchEntities = 2000

	daprStateStore = "redis-state"
	daprPubSub     = "kafka-pubsub"
	daprTopic      = "remitflow.accounting-sync"

	httpTimeout = 20 * time.Second
)

var processStart = time.Now()

// ─── Config ───────────────────────────────────────────────────────────────────

type providerConfig struct {
	Name         string
	ClientID     string
	ClientSecret string
	RedirectURI  string
	AuthorizeURL string
	TokenURL     string
	Scope        string
	// APIBase is the provider REST base. Empty means "not configured" and
	// sync endpoints must fail closed (503) for this provider.
	APIBase string
}

func (p *providerConfig) oauthConfigured() bool {
	return p.ClientID != "" && p.ClientSecret != "" && p.RedirectURI != ""
}

func (p *providerConfig) syncConfigured() bool {
	return p.APIBase != ""
}

type Config struct {
	Port        string
	InternalKey string

	Providers map[string]*providerConfig

	// TSCallbackURL receives the OAuth token bundle after code exchange.
	TSCallbackURL string
	// TSDataURL is the TS core data endpoint for pending export bundles
	// (GET), pulled provider updates (POST), and export ledger rows (GET).
	TSDataURL string
	// TSEventURL is the direct event-emit fallback when Dapr is absent.
	TSEventURL string

	// DaprHTTPPort is the Dapr sidecar HTTP port (empty = no sidecar).
	DaprHTTPPort string

	// COAMapJSON is a JSON object mapping internal account codes to
	// chart-of-accounts codes for CSV export. Empty → /export/csv is 503.
	COAMapJSON string

	// CursorFile is the on-disk cursor fallback when Dapr is absent.
	CursorFile string
}

// loadConfig resolves configuration from the environment. Only
// INTERNAL_SERVICE_KEY is required at boot (fail closed); every other
// integration fails closed at request time so one misconfigured provider
// cannot take the whole service down.
func loadConfig() (Config, error) {
	cfg := Config{
		Port:          os.Getenv("PORT"),
		InternalKey:   os.Getenv("INTERNAL_SERVICE_KEY"),
		TSCallbackURL: os.Getenv("TS_CALLBACK_URL"),
		TSDataURL:     os.Getenv("TS_DATA_URL"),
		TSEventURL:    os.Getenv("TS_EVENT_URL"),
		DaprHTTPPort:  os.Getenv("DAPR_HTTP_PORT"),
		COAMapJSON:    os.Getenv("COA_MAP_JSON"),
		CursorFile:    os.Getenv("CURSOR_FILE"),
		Providers: map[string]*providerConfig{
			providerQuickBooks: {
				Name:         providerQuickBooks,
				ClientID:     os.Getenv("QBO_CLIENT_ID"),
				ClientSecret: os.Getenv("QBO_CLIENT_SECRET"),
				RedirectURI:  os.Getenv("QBO_REDIRECT_URI"),
				AuthorizeURL: qboAuthorizeURL,
				TokenURL:     qboTokenURL,
				Scope:        qboScope,
				// QBO has distinct sandbox/production bases — no implicit
				// default: an unset QBO_API_BASE fails sync closed.
				APIBase: os.Getenv("QBO_API_BASE"),
			},
			providerXero: {
				Name:         providerXero,
				ClientID:     os.Getenv("XERO_CLIENT_ID"),
				ClientSecret: os.Getenv("XERO_CLIENT_SECRET"),
				RedirectURI:  os.Getenv("XERO_REDIRECT_URI"),
				AuthorizeURL: xeroAuthorizeURL,
				TokenURL:     xeroTokenURL,
				Scope:        xeroScope,
				APIBase:      xeroAPIBase,
			},
			providerOdoo: {
				Name: providerOdoo,
				// ODOO_API_BASE is the deployment-wide default Odoo base URL.
				// Self-hosted tenants normally supply their own per-connection
				// base (syncRequest.APIBase, stored TS-side in
				// accounting_connections.metadata.apiUrl). Empty here only
				// means "no default" — sync still works per-connection.
				APIBase: os.Getenv("ODOO_API_BASE"),
			},
		},
	}
	if cfg.Port == "" {
		cfg.Port = defaultPort
	}
	if cfg.InternalKey == "" {
		return cfg, fmt.Errorf("INTERNAL_SERVICE_KEY is not set: refusing to fall back to a well-known default credential; configure the internal service key explicitly")
	}
	if cfg.CursorFile == "" {
		cfg.CursorFile = os.TempDir() + "/go-accounting-sync-cursors.json"
	}
	return cfg, nil
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

// serviceAuth guards a handler with the internal service key delivered in the
// X-Service-Key header. Comparison is constant-time; the key is resolved at
// boot (fail-closed), never per-request and never defaulted.
func serviceAuth(expectedKey string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("X-Service-Key")
		if subtle.ConstantTimeCompare([]byte(key), []byte(expectedKey)) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		next(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("[%s] response encode error: %v", serviceName, err)
	}
}

// ─── OAuth state nonce store ──────────────────────────────────────────────────

// nonceStore stores OAuth state nonces. Consume is single-use: a nonce is
// invalidated the first time it is presented so a replayed callback fails.
type nonceStore interface {
	Save(nonce string, ttl time.Duration) error
	Consume(nonce string) bool
}

// memoryNonceStore is the no-Dapr fallback: TTL-bounded in-memory map.
type memoryNonceStore struct {
	mu    sync.Mutex
	items map[string]time.Time // nonce → expiry
	now   func() time.Time     // injectable for tests
}

func newMemoryNonceStore() *memoryNonceStore {
	return &memoryNonceStore{items: make(map[string]time.Time), now: time.Now}
}

func (s *memoryNonceStore) Save(nonce string, ttl time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Opportunistic sweep of expired entries so the map stays bounded.
	now := s.now()
	for k, exp := range s.items {
		if now.After(exp) {
			delete(s.items, k)
		}
	}
	s.items[nonce] = now.Add(ttl)
	return nil
}

func (s *memoryNonceStore) Consume(nonce string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	exp, ok := s.items[nonce]
	if !ok {
		return false
	}
	delete(s.items, nonce) // single-use
	return s.now().Before(exp)
}

// daprNonceStore stores nonces in the Dapr state store so callbacks work
// across replicas. The value carries an absolute expiry; Consume enforces it
// and deletes the key (single-use).
type daprNonceStore struct {
	client  *http.Client
	baseURL string // e.g. http://localhost:3500/v1.0/state/redis-state
}

type daprStateEntry struct {
	Key   string          `json:"key"`
	Value json.RawMessage `json:"value"`
}

func (s *daprNonceStore) Save(nonce string, ttl time.Duration) error {
	expiry := time.Now().Add(ttl).UTC().Format(time.RFC3339Nano)
	payload, err := json.Marshal([]daprStateEntry{{
		Key:   "nonce:" + nonce,
		Value: json.RawMessage(quoteJSON(expiry)),
	}})
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, s.baseURL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("dapr state save returned HTTP %d", resp.StatusCode)
	}
	return nil
}

// quoteJSON returns s as a JSON string literal.
func quoteJSON(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func (s *daprNonceStore) Consume(nonce string) bool {
	key := "nonce:" + nonce
	req, err := http.NewRequest(http.MethodGet, s.baseURL+"/"+url.PathEscape(key), nil)
	if err != nil {
		return false
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return false
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	resp.Body.Close()
	if err != nil || resp.StatusCode != http.StatusOK || len(body) == 0 {
		return false
	}
	// Single-use: delete regardless of validity so a replayed nonce fails.
	delReq, err := http.NewRequest(http.MethodDelete, s.baseURL+"/"+url.PathEscape(key), nil)
	if err == nil {
		if delResp, derr := s.client.Do(delReq); derr == nil {
			_, _ = io.Copy(io.Discard, io.LimitReader(delResp.Body, 1<<20))
			delResp.Body.Close()
		}
	}
	var expiry string
	if err := json.Unmarshal(body, &expiry); err != nil {
		return false
	}
	exp, err := time.Parse(time.RFC3339Nano, expiry)
	if err != nil {
		return false
	}
	return time.Now().Before(exp)
}

// ─── Sync cursor store (idempotency) ─────────────────────────────────────────

// cursorStore persists the last-successfully-processed entity ID per
// (connection, direction) so a retried push resumes after the cursor and
// never re-creates a provider entity.
type cursorStore interface {
	Get(key string) (string, bool, error)
	Set(key, value string) error
}

// fileCursorStore is the no-Dapr fallback: a JSON map on local disk.
type fileCursorStore struct {
	mu   sync.Mutex
	path string
}

func (s *fileCursorStore) load() (map[string]string, error) {
	out := map[string]string{}
	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return out, nil
		}
		return nil, err
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("cursor file %s is corrupt: %w", s.path, err)
	}
	return out, nil
}

func (s *fileCursorStore) Get(key string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, err := s.load()
	if err != nil {
		return "", false, err
	}
	v, ok := m[key]
	return v, ok, nil
}

func (s *fileCursorStore) Set(key, value string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, err := s.load()
	if err != nil {
		return err
	}
	m[key] = value
	data, err := json.Marshal(m)
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// daprCursorStore persists cursors in the Dapr state store.
type daprCursorStore struct {
	client  *http.Client
	baseURL string
}

func (s *daprCursorStore) Get(key string) (string, bool, error) {
	req, err := http.NewRequest(http.MethodGet, s.baseURL+"/"+url.PathEscape("cursor:"+key), nil)
	if err != nil {
		return "", false, err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return "", false, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", false, err
	}
	if resp.StatusCode == http.StatusNoContent || len(body) == 0 {
		return "", false, nil
	}
	if resp.StatusCode != http.StatusOK {
		return "", false, fmt.Errorf("dapr state get returned HTTP %d", resp.StatusCode)
	}
	var v string
	if err := json.Unmarshal(body, &v); err != nil {
		return "", false, err
	}
	return v, true, nil
}

func (s *daprCursorStore) Set(key, value string) error {
	payload, err := json.Marshal([]daprStateEntry{{
		Key:   "cursor:" + key,
		Value: json.RawMessage(quoteJSON(value)),
	}})
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, s.baseURL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("dapr state save returned HTTP %d", resp.StatusCode)
	}
	return nil
}

// ─── Event publishing (Dapr pub/sub → Kafka, or TS direct fallback) ──────────

type syncEvent struct {
	Type         string `json:"type"` // connect|push_complete|pull_complete|error
	Provider     string `json:"provider"`
	ConnectionID string `json:"connectionId,omitempty"`
	Detail       string `json:"detail,omitempty"`
	At           string `json:"at"`
}

// publishEvent emits a sync event. With Dapr it publishes to the
// kafka-pubsub component; without Dapr it POSTs to TS_EVENT_URL (direct
// Kafka emit lives in the TS core). If neither is configured the event is
// dropped with a warning — never silently reported as published.
func publishEvent(cfg Config, client *http.Client, ev syncEvent) {
	ev.At = time.Now().UTC().Format(time.RFC3339Nano)
	payload, err := json.Marshal(ev)
	if err != nil {
		log.Printf("[%s] event marshal error: %v", serviceName, err)
		return
	}
	if cfg.DaprHTTPPort != "" {
		url := fmt.Sprintf("http://localhost:%s/v1.0/publish/%s/%s", cfg.DaprHTTPPort, daprPubSub, daprTopic)
		req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
		if err != nil {
			log.Printf("[%s] event request build error: %v", serviceName, err)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			log.Printf("[%s] WARN dapr publish failed (type=%s provider=%s): %v", serviceName, ev.Type, ev.Provider, err)
			return
		}
		defer resp.Body.Close()
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			log.Printf("[%s] WARN dapr publish returned HTTP %d (type=%s provider=%s)", serviceName, resp.StatusCode, ev.Type, ev.Provider)
		}
		return
	}
	if cfg.TSEventURL != "" {
		req, err := http.NewRequest(http.MethodPost, cfg.TSEventURL, bytes.NewReader(payload))
		if err != nil {
			log.Printf("[%s] event request build error: %v", serviceName, err)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Service-Key", cfg.InternalKey)
		resp, err := client.Do(req)
		if err != nil {
			log.Printf("[%s] WARN TS event emit failed (type=%s provider=%s): %v", serviceName, ev.Type, ev.Provider, err)
			return
		}
		defer resp.Body.Close()
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
		return
	}
	log.Printf("[%s] WARN event dropped: no Dapr sidecar and TS_EVENT_URL unset (type=%s provider=%s)", serviceName, ev.Type, ev.Provider)
}

// ─── OAuth handlers ───────────────────────────────────────────────────────────

func newNonce() (string, error) {
	buf := make([]byte, nonceBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("nonce generation failed: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func providerFromRequest(cfg Config, r *http.Request) (*providerConfig, error) {
	slug := r.PathValue("provider")
	p, ok := cfg.Providers[slug]
	if !ok {
		return nil, fmt.Errorf("unsupported provider %q", slug)
	}
	return p, nil
}

// authStartHandler issues a 302 to the provider's OAuth authorize URL with a
// single-use state nonce. Fails closed (503) when the provider OAuth client
// is not configured.
func authStartHandler(cfg Config, nonces nonceStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p, err := providerFromRequest(cfg, r)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
			return
		}
		if p.Name == providerOdoo {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": "odoo does not use OAuth2 redirects — connect with an Odoo API key via the TS core (accountingSync.connectOdoo); this endpoint will never start an odoo flow",
			})
			return
		}
		if !p.oauthConfigured() {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{
				"error": fmt.Sprintf("provider %s OAuth is not configured (client id/secret/redirect URI unset) — refusing to start connect", p.Name),
			})
			return
		}
		nonce, err := newNonce()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "nonce generation failed"})
			return
		}
		if err := nonces.Save(nonce, nonceTTL); err != nil {
			log.Printf("[%s] nonce save failed (provider=%s): %v", serviceName, p.Name, err)
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "state store unavailable — refusing to start connect"})
			return
		}
		q := url.Values{}
		q.Set("client_id", p.ClientID)
		q.Set("redirect_uri", p.RedirectURI)
		q.Set("response_type", "code")
		q.Set("scope", p.Scope)
		q.Set("state", nonce)
		http.Redirect(w, r, p.AuthorizeURL+"?"+q.Encode(), http.StatusFound)
	}
}

// tokenResponse is the subset of the provider token payload forwarded to the
// TS core. Raw values are NEVER logged or persisted by this service.
type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in"`
}

// exchangeCode trades the authorization code for tokens at the provider's
// real token endpoint using HTTP Basic client authentication.
func exchangeCode(client *http.Client, p *providerConfig, code string) (*tokenResponse, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", p.RedirectURI)
	req, err := http.NewRequest(http.MethodPost, p.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.SetBasicAuth(p.ClientID, p.ClientSecret)
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token endpoint request failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBundleBytes))
	if err != nil {
		return nil, fmt.Errorf("token endpoint read failed: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// The provider error body can echo request data; log status only.
		return nil, fmt.Errorf("token endpoint returned HTTP %d", resp.StatusCode)
	}
	var tok tokenResponse
	if err := json.Unmarshal(body, &tok); err != nil {
		return nil, fmt.Errorf("token endpoint returned invalid JSON: %w", err)
	}
	if tok.AccessToken == "" {
		return nil, fmt.Errorf("token endpoint returned no access_token")
	}
	return &tok, nil
}

// authCallbackHandler validates the state nonce, exchanges the code, and
// POSTs the token bundle to the TS core callback. The TS core is the ONLY
// component that persists tokens (secretBox-encrypted).
func authCallbackHandler(cfg Config, nonces nonceStore, client *http.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p, err := providerFromRequest(cfg, r)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
			return
		}
		if p.Name == providerOdoo {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": "odoo does not use OAuth2 callbacks — connections are activated with an API key via the TS core (accountingSync.connectOdoo)",
			})
			return
		}
		if !p.oauthConfigured() {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "provider OAuth is not configured"})
			return
		}
		if cfg.TSCallbackURL == "" {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "TS_CALLBACK_URL is not set — refusing to handle tokens without a persistence handoff"})
			return
		}
		code := r.URL.Query().Get("code")
		state := r.URL.Query().Get("state")
		realmID := r.URL.Query().Get("realmId") // QBO supplies the company realm ID on redirect
		if code == "" || state == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing code or state"})
			return
		}
		if !nonces.Consume(state) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid or expired state nonce"})
			return
		}
		tok, err := exchangeCode(client, p, code)
		if err != nil {
			log.Printf("[%s] token exchange failed (provider=%s): %v", serviceName, p.Name, err)
			publishEvent(cfg, client, syncEvent{Type: "error", Provider: p.Name, Detail: "token exchange failed"})
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "provider token exchange failed"})
			return
		}
		bundle := map[string]interface{}{
			"provider":     p.Name,
			"accessToken":  tok.AccessToken,
			"refreshToken": tok.RefreshToken,
			"tokenType":    tok.TokenType,
			"expiresIn":    tok.ExpiresIn,
			"realmId":      realmID,
		}
		payload, err := json.Marshal(bundle)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "bundle marshal failed"})
			return
		}
		cbReq, err := http.NewRequest(http.MethodPost, cfg.TSCallbackURL, bytes.NewReader(payload))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid TS_CALLBACK_URL"})
			return
		}
		cbReq.Header.Set("Content-Type", "application/json")
		cbReq.Header.Set("X-Service-Key", cfg.InternalKey)
		cbResp, err := client.Do(cbReq)
		if err != nil {
			log.Printf("[%s] TS callback delivery failed (provider=%s): %v", serviceName, p.Name, err)
			publishEvent(cfg, client, syncEvent{Type: "error", Provider: p.Name, Detail: "token handoff to TS failed"})
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "token handoff to TS core failed — connection NOT activated"})
			return
		}
		defer cbResp.Body.Close()
		_, _ = io.Copy(io.Discard, io.LimitReader(cbResp.Body, 1<<20))
		if cbResp.StatusCode < 200 || cbResp.StatusCode >= 300 {
			log.Printf("[%s] TS callback returned HTTP %d (provider=%s)", serviceName, cbResp.StatusCode, p.Name)
			publishEvent(cfg, client, syncEvent{Type: "error", Provider: p.Name, Detail: "TS core rejected token handoff"})
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "TS core rejected the token handoff — connection NOT activated"})
			return
		}
		publishEvent(cfg, client, syncEvent{Type: "connect", Provider: p.Name})
		writeJSON(w, http.StatusOK, map[string]string{"status": "connected", "provider": p.Name})
	}
}

// ─── Sync push (TS pending bundle → provider entities) ───────────────────────

// syncRequest is the body the TS core sends to /sync/push and /sync/pull.
// The access token is supplied per-request by the TS core (which owns the
// encrypted tokens); this service holds it in memory only for the request.
type syncRequest struct {
	ConnectionID string `json:"connectionId"`
	Provider     string `json:"provider"`
	AccessToken  string `json:"accessToken"`
	RealmID      string `json:"realmId,omitempty"`
	// Username / APIBase are Odoo-only: self-hosted Odoo authenticates with
	// username + API key (AccessToken) against a per-tenant base URL, and
	// RealmID carries the Odoo database name. The TS core supplies all of
	// them per connection from secretBox/metadata storage.
	Username string `json:"username,omitempty"`
	APIBase  string `json:"apiBase,omitempty"`
}

// exportEntity is one entity in the TS pending export bundle. Payload is the
// provider-shaped object (QBO Bill/Vendor/Payment or Xero Invoice/Contact)
// built by the TS core; for action=update it must carry the provider Id.
type exportEntity struct {
	ID         string          `json:"id"`
	Type       string          `json:"type"`   // vendor|bill|payment (QBO), invoice|contact (Xero)
	Action     string          `json:"action"` // create|update
	ExternalID string          `json:"externalId,omitempty"`
	Payload    json.RawMessage `json:"payload"`
}

type exportBundle struct {
	Entities []exportEntity `json:"entities"`
}

type entityResult struct {
	EntityID   string `json:"entityId"`
	EntityType string `json:"entityType"`
	Action     string `json:"action"`
	Status     string `json:"status"` // success|failed
	ExternalID string `json:"externalId,omitempty"`
	Error      string `json:"error,omitempty"`
}

// filterPending returns the entities that still need processing given the
// last-successfully-processed entity ID (cursor). Entities are compared by
// ID after an ascending sort so a retried push never re-sends an entity at
// or below the cursor. An empty cursor processes everything.
func filterPending(entities []exportEntity, cursor string) []exportEntity {
	sorted := make([]exportEntity, len(entities))
	copy(sorted, entities)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].ID < sorted[j].ID })
	var out []exportEntity
	for _, e := range sorted {
		if cursor == "" || e.ID > cursor {
			out = append(out, e)
		}
	}
	return out
}

// providerEntityEndpoint maps an entity type to the provider REST endpoint.
func providerEntityEndpoint(p *providerConfig, realmID, entityType string) (string, error) {
	switch p.Name {
	case providerQuickBooks:
		if realmID == "" {
			return "", fmt.Errorf("realmId is required for QuickBooks Online")
		}
		var resource string
		switch entityType {
		case "vendor":
			resource = "vendor"
		case "bill":
			resource = "bill"
		case "payment":
			resource = "payment"
		default:
			return "", fmt.Errorf("unsupported QBO entity type %q", entityType)
		}
		return fmt.Sprintf("%s/v3/company/%s/%s?minorversion=73", strings.TrimRight(p.APIBase, "/"), url.PathEscape(realmID), resource), nil
	case providerXero:
		switch entityType {
		case "invoice":
			return strings.TrimRight(p.APIBase, "/") + "/Invoices", nil
		case "contact":
			return strings.TrimRight(p.APIBase, "/") + "/Contacts", nil
		default:
			return "", fmt.Errorf("unsupported Xero entity type %q", entityType)
		}
	}
	return "", fmt.Errorf("unsupported provider %q", p.Name)
}

// providerPost sends one entity to the provider API with the bearer token.
// It returns the provider-assigned Id extracted from the response, or an
// error. Both QBO and Xero create/update via POST (QBO sparse updates and
// Xero upserts are POST semantics).
func providerPost(client *http.Client, endpoint, accessToken string, payload json.RawMessage) (string, error) {
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("provider request failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBundleBytes))
	if err != nil {
		return "", fmt.Errorf("provider response read failed: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("provider returned HTTP %d", resp.StatusCode)
	}
	// Best-effort Id extraction: QBO wraps entities ({"Bill":{"Id":"1"}}),
	// Xero returns arrays ({"Invoices":[{"InvoiceID":"..."}]}). Missing Id
	// is NOT an error — the create still succeeded; TS keeps its cursor.
	var generic map[string]json.RawMessage
	if err := json.Unmarshal(body, &generic); err != nil {
		return "", nil
	}
	for _, raw := range generic {
		id := extractID(raw)
		if id != "" {
			return id, nil
		}
	}
	return "", nil
}

var idKeys = []string{"Id", "ID", "InvoiceID", "ContactID", "PaymentID", "BillID", "VendorID"}

func extractID(raw json.RawMessage) string {
	// Try object form first.
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err == nil {
		for _, k := range idKeys {
			if v, ok := obj[k]; ok {
				var s string
				if json.Unmarshal(v, &s) == nil && s != "" {
					return s
				}
			}
		}
		return ""
	}
	// Try single-element array form (Xero).
	var arr []map[string]json.RawMessage
	if err := json.Unmarshal(raw, &arr); err == nil && len(arr) > 0 {
		for _, k := range idKeys {
			if v, ok := arr[0][k]; ok {
				var s string
				if json.Unmarshal(v, &s) == nil && s != "" {
					return s
				}
			}
		}
	}
	return ""
}

// ─── Odoo JSON-RPC provider ──────────────────────────────────────────────────
//
// Odoo (Community, LGPL — open source, self-hostable) has no REST/OAuth2 API
// on par with QBO/Xero; the stable external interface is JSON-RPC 2.0 at
// {base}/jsonrpc: common.authenticate(db, login, api_key) → uid, then
// object.execute_kw(db, uid, api_key, model, method, args, kwargs). Every
// call below fails closed: auth failure, HTTP errors and Odoo fault responses
// are surfaced as per-entity errors — never swallowed, never fake-succeeded.

// odooModel maps an export entity type to its Odoo model. Payload field
// dicts are built by the TS core (provider-shaped, like QBO/Xero payloads).
func odooModel(entityType string) (string, error) {
	switch entityType {
	case "vendor":
		return "res.partner", nil
	case "bill":
		return "account.move", nil // type in_invoice (vendor bill) set by TS payload
	case "payment":
		return "account.payment", nil
	}
	return "", fmt.Errorf("unsupported Odoo entity type %q", entityType)
}

// resolveOdooBase picks the per-connection base URL (self-hosted tenants)
// over the deployment default, and requires an explicit http(s) scheme —
// a missing/schemeless base fails closed so the service can never POST
// credentials to an unintended target.
func resolveOdooBase(p *providerConfig, req syncRequest) (string, error) {
	base := strings.TrimSpace(req.APIBase)
	if base == "" {
		base = strings.TrimSpace(p.APIBase)
	}
	if base == "" {
		return "", fmt.Errorf("no Odoo base URL for this connection (metadata.apiUrl unset and ODOO_API_BASE unset) — sync refused")
	}
	u, err := url.Parse(base)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return "", fmt.Errorf("Odoo base URL must be an absolute http(s) URL — sync refused")
	}
	return strings.TrimRight(base, "/"), nil
}

type odooRPCEnvelope struct {
	JSONRPC string        `json:"jsonrpc"`
	Method  string        `json:"method"`
	ID      int64         `json:"id"`
	Params  odooRPCParams `json:"params"`
}

type odooRPCParams struct {
	Service string        `json:"service"`
	Method  string        `json:"method"`
	Args    []interface{} `json:"args"`
}

type odooRPCResponse struct {
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

var odooRPCSeq atomic.Int64

// odooCall issues one JSON-RPC 2.0 call and returns the raw result. Odoo
// fault data is deliberately NOT propagated (it can echo request args,
// including credentials) — code and message only.
func odooCall(client *http.Client, base, service, method string, args []interface{}) (json.RawMessage, error) {
	return odooCallCtx(context.Background(), client, base, service, method, args)
}

// odooCallCtx is odooCall with an explicit context for tracing. It emits an
// `odoo.rpc` span carrying ONLY rpc.system/rpc.service/rpc.method — the args
// are NEVER recorded as span attributes or events because they contain
// credentials (db, login, API key). The in-flight UpDownCounter is likewise
// credential-free.
func odooCallCtx(ctx context.Context, client *http.Client, base, service, method string, args []interface{}) (json.RawMessage, error) {
	inst := otelInstruments()
	inst.odooRPCInflight.Add(ctx, 1)
	defer inst.odooRPCInflight.Add(ctx, -1)

	ctx, span := svcTracer.Start(ctx, "odoo.rpc",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attribute.String("rpc.system", "jsonrpc"),
			semconv.RPCService(service),
			semconv.RPCMethod(method),
		),
	)
	defer span.End()

	result, err := odooCallRaw(ctx, client, base, service, method, args)
	if err != nil {
		// Error strings are the fail-closed messages built below — code and
		// message only, never fault data, never args.
		span.RecordError(err)
		span.SetStatus(codes.Error, "odoo rpc failed")
	} else {
		span.SetStatus(codes.Ok, "")
	}
	return result, err
}

// odooCallRaw performs the HTTP exchange. Kept separate so the tracing
// wrapper above stays minimal and the fail-closed semantics are unchanged.
func odooCallRaw(ctx context.Context, client *http.Client, base, service, method string, args []interface{}) (json.RawMessage, error) {
	env := odooRPCEnvelope{
		JSONRPC: "2.0",
		Method:  "call",
		ID:      odooRPCSeq.Add(1),
		Params:  odooRPCParams{Service: service, Method: method, Args: args},
	}
	payload, err := json.Marshal(env)
	if err != nil {
		return nil, fmt.Errorf("odoo rpc marshal failed: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/jsonrpc", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("odoo rpc request failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBundleBytes))
	if err != nil {
		return nil, fmt.Errorf("odoo rpc read failed: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("odoo returned HTTP %d", resp.StatusCode)
	}
	var rpcResp odooRPCResponse
	if err := json.Unmarshal(body, &rpcResp); err != nil {
		return nil, fmt.Errorf("odoo rpc returned invalid JSON: %w", err)
	}
	if rpcResp.Error != nil {
		return nil, fmt.Errorf("odoo fault (code %d): %s", rpcResp.Error.Code, rpcResp.Error.Message)
	}
	return rpcResp.Result, nil
}

// odooAuthenticate trades db+login+api_key for a uid. Odoo returns false on
// bad credentials — that is an error here (fail closed), never a silent retry.
func odooAuthenticate(client *http.Client, base, db, login, apiKey string) (int64, error) {
	return odooAuthenticateCtx(context.Background(), client, base, db, login, apiKey)
}

// odooAuthenticateCtx is odooAuthenticate with an explicit context so the
// odoo.rpc span parents to the in-flight sync request.
func odooAuthenticateCtx(ctx context.Context, client *http.Client, base, db, login, apiKey string) (int64, error) {
	result, err := odooCallCtx(ctx, client, base, "common", "authenticate", []interface{}{db, login, apiKey, map[string]interface{}{}})
	if err != nil {
		return 0, err
	}
	var uid int64
	if err := json.Unmarshal(result, &uid); err != nil || uid <= 0 {
		return 0, fmt.Errorf("odoo authentication rejected the supplied credentials")
	}
	return uid, nil
}

// odooExecuteKW wraps object.execute_kw for one model method call.
func odooExecuteKW(client *http.Client, base, db string, uid int64, apiKey, model, method string, args []interface{}, kwargs map[string]interface{}) (json.RawMessage, error) {
	return odooExecuteKWCtx(context.Background(), client, base, db, uid, apiKey, model, method, args, kwargs)
}

// odooExecuteKWCtx is odooExecuteKW with an explicit context for tracing.
func odooExecuteKWCtx(ctx context.Context, client *http.Client, base, db string, uid int64, apiKey, model, method string, args []interface{}, kwargs map[string]interface{}) (json.RawMessage, error) {
	callArgs := []interface{}{db, uid, apiKey, model, method, args}
	if kwargs != nil {
		callArgs = append(callArgs, kwargs)
	}
	return odooCallCtx(ctx, client, base, "object", "execute_kw", callArgs)
}

// odooPushEntity creates (or writes, when action=update) one entity and
// returns the Odoo record id. The TS-built payload is the Odoo field dict.
func odooPushEntity(client *http.Client, base, db string, uid int64, apiKey string, e exportEntity) (string, error) {
	return odooPushEntityCtx(context.Background(), client, base, db, uid, apiKey, e)
}

// odooPushEntityCtx is odooPushEntity with an explicit context for tracing.
func odooPushEntityCtx(ctx context.Context, client *http.Client, base, db string, uid int64, apiKey string, e exportEntity) (string, error) {
	model, err := odooModel(e.Type)
	if err != nil {
		return "", err
	}
	var fields map[string]interface{}
	if err := json.Unmarshal(e.Payload, &fields); err != nil {
		return "", fmt.Errorf("odoo payload is not a field dict: %w", err)
	}
	if e.Action == "update" {
		recID, err := strconv.ParseInt(strings.TrimSpace(e.ExternalID), 10, 64)
		if err != nil || recID <= 0 {
			return "", fmt.Errorf("odoo update requires a numeric externalId (got %q)", e.ExternalID)
		}
		if _, err := odooExecuteKWCtx(ctx, client, base, db, uid, apiKey, model, "write", []interface{}{[]int64{recID}, fields}, nil); err != nil {
			return "", err
		}
		return e.ExternalID, nil
	}
	result, err := odooExecuteKWCtx(ctx, client, base, db, uid, apiKey, model, "create", []interface{}{fields}, nil)
	if err != nil {
		return "", err
	}
	var newID int64
	if err := json.Unmarshal(result, &newID); err != nil || newID <= 0 {
		// create returned but no id — honest partial: record exists, id unknown.
		return "", nil
	}
	return fmt.Sprintf("%d", newID), nil
}

// odooPullUpdates runs search_read per mapped model with a write_date domain
// (incremental) and returns one raw collection per model, mirroring the
// QBO/Xero multi-collection pull shape.
func odooPullUpdates(client *http.Client, base, db string, uid int64, apiKey, since string) ([]json.RawMessage, error) {
	return odooPullUpdatesCtx(context.Background(), client, base, db, uid, apiKey, since)
}

// odooPullUpdatesCtx is odooPullUpdates with an explicit context for tracing.
func odooPullUpdatesCtx(ctx context.Context, client *http.Client, base, db string, uid int64, apiKey, since string) ([]json.RawMessage, error) {
	domain := []interface{}{}
	if since != "" {
		if ts, err := time.Parse(time.RFC3339Nano, since); err == nil {
			// Odoo datetime domains are naive UTC "YYYY-MM-DD HH:MM:SS".
			domain = append(domain, []interface{}{"write_date", ">", ts.UTC().Format("2006-01-02 15:04:05")})
		}
	}
	var out []json.RawMessage
	for _, entityType := range []string{"bill", "vendor", "payment"} {
		model, err := odooModel(entityType)
		if err != nil {
			return nil, err
		}
		// Per-entity-type pull span + metrics (mirrors the push-side
		// per-entity instrumentation; direction=pull).
		mCtx, mSpan := svcTracer.Start(ctx, "sync.entity",
			trace.WithSpanKind(trace.SpanKindInternal),
			trace.WithAttributes(
				attribute.String("provider", providerOdoo),
				attribute.String("entity_type", entityType),
				attribute.String("action", "pull"),
			),
		)
		mStart := time.Now()
		result, err := odooExecuteKWCtx(mCtx, client, base, db, uid, apiKey, model, "search_read", []interface{}{domain}, map[string]interface{}{"limit": 200})
		status := "success"
		if err != nil {
			status = "failed"
			mSpan.RecordError(err)
			mSpan.SetStatus(codes.Error, "odoo pull failed")
		} else {
			mSpan.SetStatus(codes.Ok, "")
		}
		mSpan.End()
		recordSyncEntity(ctx, providerOdoo, "pull", status, mStart)
		if err != nil {
			return nil, fmt.Errorf("odoo pull %s failed: %w", model, err)
		}
		if len(result) > 0 {
			out = append(out, result)
		}
	}
	return out, nil
}

// syncPushHandler pulls the pending export bundle from the TS core and
// creates/updates provider entities, advancing the cursor after each success
// so retries are idempotent. Per-entity failures are surfaced in the
// response (TS writes accounting_sync_logs) — no fake success.
func syncPushHandler(cfg Config, cursors cursorStore, client *http.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req syncRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, maxBundleBytes)).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		if req.ConnectionID == "" || req.Provider == "" || req.AccessToken == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "connectionId, provider and accessToken are required"})
			return
		}
		p, ok := cfg.Providers[req.Provider]
		if !ok {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unsupported provider " + req.Provider})
			return
		}
		if p.Name != providerOdoo && !p.syncConfigured() {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "provider API base is not configured (QBO_API_BASE unset) — sync refused"})
			return
		}
		if cfg.TSDataURL == "" {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "TS_DATA_URL is not set — cannot pull the pending export bundle"})
			return
		}

		// Odoo: resolve the per-connection base and authenticate ONCE per push
		// (db = realmId, login = username, key = accessToken). Any failure here
		// aborts the whole push — no entity is attempted with bad credentials.
		var odooBase string
		var odooUID int64
		if p.Name == providerOdoo {
			var err error
			odooBase, err = resolveOdooBase(p, req)
			if err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
				return
			}
			if req.RealmID == "" || req.Username == "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "odoo sync requires realmId (database) and username — refusing to guess"})
				return
			}
			odooUID, err = odooAuthenticateCtx(r.Context(), client, odooBase, req.RealmID, req.Username, req.AccessToken)
			if err != nil {
				log.Printf("[%s] odoo auth failed (conn=%s): %v", serviceName, req.ConnectionID, err)
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": "odoo authentication failed — verify db/username/api key"})
				return
			}
		}

		cursorKey := req.ConnectionID + ":push"
		cursor, _, err := cursors.Get(cursorKey)
		if err != nil {
			log.Printf("[%s] cursor read failed (conn=%s): %v", serviceName, req.ConnectionID, err)
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "cursor store unavailable — refusing non-idempotent push"})
			return
		}

		// Pull the pending bundle from the TS core.
		bundleURL := cfg.TSDataURL + "?connectionId=" + url.QueryEscape(req.ConnectionID) + "&direction=push"
		bReq, err := http.NewRequest(http.MethodGet, bundleURL, nil)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid TS_DATA_URL"})
			return
		}
		bReq.Header.Set("Accept", "application/json")
		bReq.Header.Set("X-Service-Key", cfg.InternalKey)
		bResp, err := client.Do(bReq)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "TS bundle fetch failed: " + err.Error()})
			return
		}
		bBody, err := io.ReadAll(io.LimitReader(bResp.Body, maxBundleBytes+1))
		bResp.Body.Close()
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "TS bundle read failed"})
			return
		}
		if bResp.StatusCode < 200 || bResp.StatusCode >= 300 {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("TS bundle endpoint returned HTTP %d", bResp.StatusCode)})
			return
		}
		var bundle exportBundle
		if err := json.Unmarshal(bBody, &bundle); err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "TS bundle is not valid JSON"})
			return
		}
		if len(bundle.Entities) > maxBatchEntities {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": fmt.Sprintf("bundle too large: %d entities (max %d)", len(bundle.Entities), maxBatchEntities)})
			return
		}

		pending := filterPending(bundle.Entities, cursor)
		results := make([]entityResult, 0, len(pending))
		succeeded := 0
		for _, e := range pending {
			res := pushOneEntity(r.Context(), client, p, req, odooBase, odooUID, e)
			results = append(results, res)
			if res.Status != "success" {
				// Do NOT advance the cursor past a failed entity: it (and
				// everything after it) must be retried on the next push.
				continue
			}
			succeeded++
			if err := cursors.Set(cursorKey, e.ID); err != nil {
				// Cursor persistence failure means the next run may retry this
				// entity — surface it so ops can investigate.
				log.Printf("[%s] WARN cursor persist failed (conn=%s entity=%s): %v", serviceName, req.ConnectionID, e.ID, err)
			}
		}

		status := http.StatusOK
		if succeeded < len(pending) {
			status = http.StatusMultiStatus
		}
		publishEvent(cfg, client, syncEvent{
			Type:         "push_complete",
			Provider:     p.Name,
			ConnectionID: req.ConnectionID,
			Detail:       fmt.Sprintf("%d/%d entities pushed", succeeded, len(pending)),
		})
		writeJSON(w, status, map[string]interface{}{
			"connectionId": req.ConnectionID,
			"provider":     p.Name,
			"direction":    "push",
			"total":        len(pending),
			"succeeded":    succeeded,
			"failed":       len(pending) - succeeded,
			"results":      results,
		})
	}
}

// pushOneEntity processes one pending entity (validation + provider write)
// and returns its result. It emits a `sync.entity` child span (attrs:
// provider/entity_type/action) and records remitflow_sync_entities_total +
// remitflow_sync_duration_ms exactly once with the terminal status. Telemetry
// is fail-soft: the entity outcome is decided solely by the sync logic.
func pushOneEntity(ctx context.Context, client *http.Client, p *providerConfig, req syncRequest, odooBase string, odooUID int64, e exportEntity) (res entityResult) {
	ctx, span := svcTracer.Start(ctx, "sync.entity",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(
			attribute.String("provider", p.Name),
			attribute.String("entity_type", e.Type),
			attribute.String("action", e.Action),
		),
	)
	defer span.End()
	start := time.Now()

	res = entityResult{EntityID: e.ID, EntityType: e.Type, Action: e.Action}
	// Record metrics exactly once, with the final status, on every path.
	defer func() {
		recordSyncEntity(ctx, p.Name, "push", res.Status, start)
		if res.Status == "success" {
			span.SetStatus(codes.Ok, "")
		} else {
			span.SetStatus(codes.Error, res.Error)
		}
	}()

	if e.Action == "update" && e.ExternalID == "" {
		res.Status = "failed"
		res.Error = "update action requires externalId"
		return res
	}
	if len(e.Payload) == 0 {
		res.Status = "failed"
		res.Error = "empty payload"
		return res
	}
	var extID string
	var perr error
	if p.Name == providerOdoo {
		extID, perr = odooPushEntityCtx(ctx, client, odooBase, req.RealmID, odooUID, req.AccessToken, e)
	} else {
		var endpoint string
		endpoint, perr = providerEntityEndpoint(p, req.RealmID, e.Type)
		if perr == nil {
			extID, perr = providerPost(client, endpoint, req.AccessToken, e.Payload)
		}
	}
	if perr != nil {
		res.Status = "failed"
		res.Error = perr.Error()
		span.RecordError(perr)
		return res
	}
	res.Status = "success"
	if extID != "" {
		res.ExternalID = extID
	} else {
		res.ExternalID = e.ExternalID
	}
	return res
}

// ─── Sync pull (provider updates → TS core) ──────────────────────────────────

// pullEndpoints lists the provider query endpoints used for incremental
// pulls. QBO uses its SQL-like query API; Xero uses If-Modified-Since.
func pullEndpoints(p *providerConfig, realmID, since string) ([]string, error) {
	switch p.Name {
	case providerQuickBooks:
		if realmID == "" {
			return nil, fmt.Errorf("realmId is required for QuickBooks Online")
		}
		base := fmt.Sprintf("%s/v3/company/%s/query?minorversion=73", strings.TrimRight(p.APIBase, "/"), url.PathEscape(realmID))
		var out []string
		for _, res := range []string{"Bill", "Vendor", "Payment"} {
			query := "select * from " + res
			if since != "" {
				query += " where MetaData.LastUpdatedTime > '" + since + "'"
			}
			out = append(out, base+"&query="+url.QueryEscape(query))
		}
		return out, nil
	case providerXero:
		base := strings.TrimRight(p.APIBase, "/")
		return []string{base + "/Invoices", base + "/Contacts"}, nil
	}
	return nil, fmt.Errorf("unsupported provider %q", p.Name)
}

// pullOneEndpoint fetches one provider collection endpoint (QBO query / Xero
// resource) with a `sync.entity` child span and per-endpoint pull metrics.
// On failure it returns the exact HTTP status + message the handler used to
// answer with — sync behavior is byte-for-byte unchanged.
func pullOneEndpoint(ctx context.Context, client *http.Client, p *providerConfig, req syncRequest, since, ep string) (json.RawMessage, int, string) {
	ctx, span := svcTracer.Start(ctx, "sync.entity",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(
			attribute.String("provider", p.Name),
			attribute.String("entity_type", "collection"),
			attribute.String("action", "pull"),
		),
	)
	defer span.End()
	start := time.Now()
	status := "success"
	fail := func(code int, msg string) (json.RawMessage, int, string) {
		status = "failed"
		span.SetStatus(codes.Error, msg)
		return nil, code, msg
	}
	defer func() {
		recordSyncEntity(ctx, p.Name, "pull", status, start)
		if status == "success" {
			span.SetStatus(codes.Ok, "")
		}
	}()

	pReq, err := http.NewRequestWithContext(ctx, http.MethodGet, ep, nil)
	if err != nil {
		return fail(http.StatusInternalServerError, "provider endpoint build failed")
	}
	pReq.Header.Set("Accept", "application/json")
	pReq.Header.Set("Authorization", "Bearer "+req.AccessToken)
	if p.Name == providerXero && since != "" {
		if ts, perr := time.Parse(time.RFC3339Nano, since); perr == nil {
			pReq.Header.Set("If-Modified-Since", ts.UTC().Format(http.TimeFormat))
		}
	}
	pResp, err := client.Do(pReq)
	if err != nil {
		return fail(http.StatusBadGateway, "provider pull failed: "+err.Error())
	}
	defer pResp.Body.Close()
	pBody, err := io.ReadAll(io.LimitReader(pResp.Body, maxBundleBytes))
	if err != nil {
		return fail(http.StatusBadGateway, "provider pull read failed")
	}
	if pResp.StatusCode < 200 || pResp.StatusCode >= 300 {
		return fail(http.StatusBadGateway, fmt.Sprintf("provider pull returned HTTP %d", pResp.StatusCode))
	}
	return json.RawMessage(pBody), 0, ""
}

// syncPullHandler fetches provider-side updates since the stored cursor and
// forwards them to the TS core. The TS core persists them and owns the pull
// cursor in accounting_connections.sync_cursor; this service only advances
// its local mirror cursor after the TS core accepts the batch.
func syncPullHandler(cfg Config, cursors cursorStore, client *http.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req syncRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, maxBundleBytes)).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		if req.ConnectionID == "" || req.Provider == "" || req.AccessToken == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "connectionId, provider and accessToken are required"})
			return
		}
		p, ok := cfg.Providers[req.Provider]
		if !ok {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unsupported provider " + req.Provider})
			return
		}
		if p.Name != providerOdoo && !p.syncConfigured() {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "provider API base is not configured — sync refused"})
			return
		}
		if cfg.TSDataURL == "" {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "TS_DATA_URL is not set — cannot forward pulled updates"})
			return
		}

		cursorKey := req.ConnectionID + ":pull"
		since, _, err := cursors.Get(cursorKey)
		if err != nil {
			log.Printf("[%s] cursor read failed (conn=%s): %v", serviceName, req.ConnectionID, err)
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "cursor store unavailable — refusing pull"})
			return
		}

		updates := make([]json.RawMessage, 0)
		if p.Name == providerOdoo {
			odooBase, berr := resolveOdooBase(p, req)
			if berr != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": berr.Error()})
				return
			}
			if req.RealmID == "" || req.Username == "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "odoo sync requires realmId (database) and username — refusing to guess"})
				return
			}
			odooUID, aerr := odooAuthenticateCtx(r.Context(), client, odooBase, req.RealmID, req.Username, req.AccessToken)
			if aerr != nil {
				log.Printf("[%s] odoo auth failed (conn=%s): %v", serviceName, req.ConnectionID, aerr)
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": "odoo authentication failed — verify db/username/api key"})
				return
			}
			collections, perr := odooPullUpdatesCtx(r.Context(), client, odooBase, req.RealmID, odooUID, req.AccessToken, since)
			if perr != nil {
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": perr.Error()})
				return
			}
			updates = append(updates, collections...)
		} else {
			endpoints, err := pullEndpoints(p, req.RealmID, since)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
				return
			}

			for _, ep := range endpoints {
				raw, code, msg := pullOneEndpoint(r.Context(), client, p, req, since, ep)
				if msg != "" {
					writeJSON(w, code, map[string]string{"error": msg})
					return
				}
				updates = append(updates, raw)
			}
		}

		newCursor := time.Now().UTC().Format(time.RFC3339Nano)
		forward := map[string]interface{}{
			"connectionId": req.ConnectionID,
			"provider":     p.Name,
			"direction":    "pull",
			"since":        since,
			"cursor":       newCursor,
			"updates":      updates,
		}
		payload, err := json.Marshal(forward)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "forward marshal failed"})
			return
		}
		fReq, err := http.NewRequest(http.MethodPost, cfg.TSDataURL, bytes.NewReader(payload))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid TS_DATA_URL"})
			return
		}
		fReq.Header.Set("Content-Type", "application/json")
		fReq.Header.Set("X-Service-Key", cfg.InternalKey)
		fResp, err := client.Do(fReq)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "TS forward failed: " + err.Error()})
			return
		}
		defer fResp.Body.Close()
		_, _ = io.Copy(io.Discard, io.LimitReader(fResp.Body, 1<<20))
		if fResp.StatusCode < 200 || fResp.StatusCode >= 300 {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("TS core returned HTTP %d — updates NOT accepted", fResp.StatusCode)})
			return
		}

		if err := cursors.Set(cursorKey, newCursor); err != nil {
			log.Printf("[%s] WARN pull cursor persist failed (conn=%s): %v", serviceName, req.ConnectionID, err)
		}
		publishEvent(cfg, client, syncEvent{
			Type:         "pull_complete",
			Provider:     p.Name,
			ConnectionID: req.ConnectionID,
			Detail:       fmt.Sprintf("%d provider collections forwarded", len(updates)),
		})
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"connectionId": req.ConnectionID,
			"provider":     p.Name,
			"direction":    "pull",
			"collections":  len(updates),
			"cursor":       newCursor,
		})
	}
}

// ─── CSV export (TS ledger rows → COA-mapped CSV) ────────────────────────────

// ledgerRow is one row of the TS double-entry ledger export payload.
type ledgerRow struct {
	Date        string `json:"date"`
	AccountCode string `json:"accountCode"`
	AccountName string `json:"accountName"`
	Debit       string `json:"debit"`
	Credit      string `json:"credit"`
	Currency    string `json:"currency"`
	Description string `json:"description"`
	Reference   string `json:"reference"`
}

// parseCOAMap parses COA_MAP_JSON (internal account code → external COA
// code). Empty input is an error: the caller must fail closed.
func parseCOAMap(raw string) (map[string]string, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, fmt.Errorf("COA_MAP_JSON is not set — chart-of-accounts mapping unavailable")
	}
	var m map[string]string
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return nil, fmt.Errorf("COA_MAP_JSON is not valid JSON: %w", err)
	}
	if len(m) == 0 {
		return nil, fmt.Errorf("COA_MAP_JSON is an empty mapping — refusing to export unmapped accounts")
	}
	return m, nil
}

// renderCSV maps every row's account code through the COA map and renders
// CSV. Any unmapped account code fails the WHOLE export — a partially
// mapped export would silently corrupt the external books.
func renderCSV(rows []ledgerRow, coa map[string]string) (string, error) {
	var unmapped []string
	for _, r := range rows {
		if _, ok := coa[r.AccountCode]; !ok {
			unmapped = append(unmapped, r.AccountCode)
		}
	}
	if len(unmapped) > 0 {
		return "", fmt.Errorf("unmapped account codes: %s", strings.Join(unmapped, ", "))
	}
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	if err := w.Write([]string{"Date", "COA Code", "Account Code", "Account Name", "Debit", "Credit", "Currency", "Description", "Reference"}); err != nil {
		return "", err
	}
	for _, r := range rows {
		if err := w.Write([]string{r.Date, coa[r.AccountCode], r.AccountCode, r.AccountName, r.Debit, r.Credit, r.Currency, r.Description, r.Reference}); err != nil {
			return "", err
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// exportCSVHandler pulls ledger rows from the TS data endpoint and renders a
// COA-mapped CSV. COA_MAP_JSON unset → 503 (fail closed).
func exportCSVHandler(cfg Config, client *http.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		coa, err := parseCOAMap(cfg.COAMapJSON)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			return
		}
		if cfg.TSDataURL == "" {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "TS_DATA_URL is not set — cannot pull ledger rows"})
			return
		}
		dataURL := cfg.TSDataURL + "?report=ledger"
		if conn := r.URL.Query().Get("connectionId"); conn != "" {
			dataURL += "&connectionId=" + url.QueryEscape(conn)
		}
		dReq, err := http.NewRequest(http.MethodGet, dataURL, nil)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid TS_DATA_URL"})
			return
		}
		dReq.Header.Set("Accept", "application/json")
		dReq.Header.Set("X-Service-Key", cfg.InternalKey)
		dResp, err := client.Do(dReq)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "TS ledger fetch failed: " + err.Error()})
			return
		}
		dBody, err := io.ReadAll(io.LimitReader(dResp.Body, maxBundleBytes))
		dResp.Body.Close()
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "TS ledger read failed"})
			return
		}
		if dResp.StatusCode < 200 || dResp.StatusCode >= 300 {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("TS ledger endpoint returned HTTP %d", dResp.StatusCode)})
			return
		}
		var payload struct {
			Rows []ledgerRow `json:"rows"`
		}
		if err := json.Unmarshal(dBody, &payload); err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "TS ledger payload is not valid JSON"})
			return
		}
		csvText, err := renderCSV(payload.Rows, coa)
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
			return
		}
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="remitflow-ledger-export.csv"`)
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, csvText)
	}
}

// ─── Server ───────────────────────────────────────────────────────────────────

func healthHandler(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"status":  "ok",
			"service": serviceName,
			"version": version,
			"dapr":    cfg.DaprHTTPPort != "",
			// Honest: true only when the OTel SDK initialized with real
			// exporters. false means running no-op (see OTEL.md fail-soft rule).
			"telemetry": telemetryEnabled.Load(),
			"providers": map[string]interface{}{
				providerQuickBooks: map[string]bool{
					"oauth": cfg.Providers[providerQuickBooks].oauthConfigured(),
					"sync":  cfg.Providers[providerQuickBooks].syncConfigured(),
				},
				providerXero: map[string]bool{
					"oauth": cfg.Providers[providerXero].oauthConfigured(),
					"sync":  cfg.Providers[providerXero].syncConfigured(),
				},
				// Odoo: no OAuth (API-key connect TS-side); "sync" reports the
				// deployment default base — per-connection bases also work.
				providerOdoo: map[string]bool{
					"oauth": false,
					"sync":  cfg.Providers[providerOdoo].syncConfigured(),
				},
			},
			"coaConfigured":  strings.TrimSpace(cfg.COAMapJSON) != "",
			"uptime_seconds": int64(time.Since(processStart).Seconds()),
		})
	}
}

func newMux(cfg Config, nonces nonceStore, cursors cursorStore, client *http.Client) http.Handler {
	mux := http.NewServeMux()
	// Every route is wrapped in the telemetry middleware (outermost): one
	// server span per request, named "method + route pattern" (threaded
	// through explicitly — http.Request.Pattern is Go 1.23+). Fail-soft:
	// with the no-op provider this is a cheap pass-through.
	route := func(pattern string, h http.HandlerFunc) (string, http.HandlerFunc) {
		return pattern, otelMiddlewareRoute(pattern, h)
	}
	mux.HandleFunc(route("GET /health", healthHandler(cfg)))
	// Browser-facing OAuth flow (no service key — the browser cannot set one;
	// fail-closed provider config + single-use state nonce are the guards).
	mux.HandleFunc(route("GET /auth/{provider}/start", authStartHandler(cfg, nonces)))
	// Providers redirect with GET; some integrations POST. Same handler.
	mux.HandleFunc(route("GET /auth/{provider}/callback", authCallbackHandler(cfg, nonces, client)))
	mux.HandleFunc(route("POST /auth/{provider}/callback", authCallbackHandler(cfg, nonces, client)))
	// Service-to-service endpoints — constant-time X-Service-Key.
	mux.HandleFunc(route("POST /sync/push", serviceAuth(cfg.InternalKey, syncPushHandler(cfg, cursors, client))))
	mux.HandleFunc(route("POST /sync/pull", serviceAuth(cfg.InternalKey, syncPullHandler(cfg, cursors, client))))
	mux.HandleFunc(route("GET /export/csv", serviceAuth(cfg.InternalKey, exportCSVHandler(cfg, client))))
	return mux
}

func main() {
	log.Printf("[%s] starting %s %s...", serviceName, serviceName, version)

	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("[%s] FATAL: %v", serviceName, err)
	}

	// Telemetry is initialized BEFORE the server starts but is FAIL-SOFT:
	// a disabled SDK, a missing collector, or an exporter failure yields a
	// WARN log and no-op instrumentation — sync behavior is unaffected.
	shutdownTelemetry, _, _ := initTelemetry(context.Background())
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := shutdownTelemetry(ctx); err != nil {
			log.Printf("[%s] WARN telemetry shutdown failed: %v", serviceName, err)
		}
	}()

	client := &http.Client{Timeout: httpTimeout}

	var nonces nonceStore
	var cursors cursorStore
	if cfg.DaprHTTPPort != "" {
		stateBase := fmt.Sprintf("http://localhost:%s/v1.0/state/%s", cfg.DaprHTTPPort, daprStateStore)
		nonces = &daprNonceStore{client: client, baseURL: stateBase}
		cursors = &daprCursorStore{client: client, baseURL: stateBase}
		log.Printf("[%s] Dapr sidecar detected on :%s (state=%s pubsub=%s)", serviceName, cfg.DaprHTTPPort, daprStateStore, daprPubSub)
	} else {
		nonces = newMemoryNonceStore()
		cursors = &fileCursorStore{path: cfg.CursorFile}
		log.Printf("[%s] WARN DAPR_HTTP_PORT unset — in-memory OAuth nonces (single replica only) and cursor file fallback at %s", serviceName, cfg.CursorFile)
	}
	for name, p := range cfg.Providers {
		if !p.oauthConfigured() {
			log.Printf("[%s] WARN provider %s OAuth not configured — connect endpoints will answer 503", serviceName, name)
		}
		if !p.syncConfigured() {
			log.Printf("[%s] WARN provider %s API base not configured — sync endpoints will answer 503", serviceName, name)
		}
	}
	if strings.TrimSpace(cfg.COAMapJSON) == "" {
		log.Printf("[%s] WARN COA_MAP_JSON unset — /export/csv will answer 503", serviceName)
	}

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           newMux(cfg, nonces, cursors, client),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	log.Printf("[%s] listening on :%s", serviceName, cfg.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[%s] server error: %v", serviceName, err)
	}
}
