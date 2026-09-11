package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// ─── memoryNonceStore: TTL + single-use semantics ────────────────────────────

func TestMemoryNonceStoreConsumeValid(t *testing.T) {
	s := newMemoryNonceStore()
	if err := s.Save("nonce-a", time.Minute); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if !s.Consume("nonce-a") {
		t.Fatal("expected fresh nonce to be accepted")
	}
}

func TestMemoryNonceStoreSingleUse(t *testing.T) {
	s := newMemoryNonceStore()
	_ = s.Save("nonce-b", time.Minute)
	if !s.Consume("nonce-b") {
		t.Fatal("first consume should succeed")
	}
	if s.Consume("nonce-b") {
		t.Fatal("replayed nonce must be rejected (single-use)")
	}
}

func TestMemoryNonceStoreUnknownNonce(t *testing.T) {
	s := newMemoryNonceStore()
	if s.Consume("never-saved") {
		t.Fatal("unknown nonce must be rejected")
	}
}

func TestMemoryNonceStoreTTLExpiry(t *testing.T) {
	s := newMemoryNonceStore()
	base := time.Now()
	s.now = func() time.Time { return base }
	_ = s.Save("nonce-c", time.Minute)

	// Advance the clock past the TTL: the nonce must now be rejected.
	s.now = func() time.Time { return base.Add(2 * time.Minute) }
	if s.Consume("nonce-c") {
		t.Fatal("expired nonce must be rejected")
	}
}

func TestMemoryNonceStoreExpiredSweepKeepsValid(t *testing.T) {
	s := newMemoryNonceStore()
	base := time.Now()
	s.now = func() time.Time { return base }
	_ = s.Save("short", time.Minute)
	// Move forward so "short" expires, then save a fresh nonce — the sweep
	// must evict the expired entry without touching the fresh one.
	s.now = func() time.Time { return base.Add(2 * time.Minute) }
	_ = s.Save("fresh", time.Minute)
	if s.Consume("short") {
		t.Fatal("expired nonce must be rejected after sweep")
	}
	if !s.Consume("fresh") {
		t.Fatal("fresh nonce must survive the sweep")
	}
}

// ─── CSV mapping (parseCOAMap / renderCSV) ────────────────────────────────────

func TestParseCOAMap(t *testing.T) {
	m, err := parseCOAMap(`{"1000":"QB-1000","2000":"QB-2000"}`)
	if err != nil {
		t.Fatalf("parseCOAMap: %v", err)
	}
	if m["1000"] != "QB-1000" || m["2000"] != "QB-2000" {
		t.Fatalf("unexpected map: %v", m)
	}
}

func TestParseCOAMapFailClosed(t *testing.T) {
	for _, raw := range []string{"", "   ", "{}", "not-json"} {
		if _, err := parseCOAMap(raw); err == nil {
			t.Fatalf("parseCOAMap(%q) must fail closed", raw)
		}
	}
}

func TestRenderCSVMapping(t *testing.T) {
	coa := map[string]string{"1000": "QB-1000", "2000": "QB-2000"}
	rows := []ledgerRow{
		{Date: "2026-01-01", AccountCode: "1000", AccountName: "Operating", Debit: "100.00", Credit: "0", Currency: "USD", Description: "fee, income", Reference: "tx_1"},
		{Date: "2026-01-01", AccountCode: "2000", AccountName: "Revenue", Debit: "0", Credit: "100.00", Currency: "USD", Description: "fee income", Reference: "tx_1"},
	}
	out, err := renderCSV(rows, coa)
	if err != nil {
		t.Fatalf("renderCSV: %v", err)
	}
	lines := strings.Split(strings.TrimRight(out, "\n"), "\n")
	if len(lines) != 3 {
		t.Fatalf("expected header + 2 rows, got %d lines", len(lines))
	}
	if !strings.Contains(lines[0], "COA Code") {
		t.Fatalf("header missing COA Code: %q", lines[0])
	}
	if !strings.Contains(lines[1], "QB-1000") {
		t.Fatalf("row 1 not mapped through COA: %q", lines[1])
	}
	// The comma in the description must be quoted by encoding/csv.
	if !strings.Contains(lines[1], `"fee, income"`) {
		t.Fatalf("csv escaping broken: %q", lines[1])
	}
}

func TestRenderCSVUnmappedFailsWholeExport(t *testing.T) {
	coa := map[string]string{"1000": "QB-1000"}
	rows := []ledgerRow{
		{Date: "2026-01-01", AccountCode: "1000", AccountName: "Operating"},
		{Date: "2026-01-01", AccountCode: "9999", AccountName: "Mystery"},
	}
	if _, err := renderCSV(rows, coa); err == nil {
		t.Fatal("unmapped account code must fail the whole export (no silent drops)")
	} else if !strings.Contains(err.Error(), "9999") {
		t.Fatalf("error must name the unmapped code: %v", err)
	}
}

func TestRenderCSVEmptyRows(t *testing.T) {
	out, err := renderCSV(nil, map[string]string{"1000": "QB-1000"})
	if err != nil {
		t.Fatalf("renderCSV: %v", err)
	}
	if !strings.Contains(out, "COA Code") {
		t.Fatal("empty export must still emit the header row")
	}
}

// ─── Cursor idempotency (filterPending + cursor store round-trip) ────────────

func TestFilterPendingEmptyCursor(t *testing.T) {
	entities := []exportEntity{{ID: "e1"}, {ID: "e2"}, {ID: "e3"}}
	got := filterPending(entities, "")
	if len(got) != 3 {
		t.Fatalf("empty cursor must process all entities, got %d", len(got))
	}
}

func TestFilterPendingSkipsProcessed(t *testing.T) {
	entities := []exportEntity{{ID: "e1"}, {ID: "e2"}, {ID: "e3"}}
	got := filterPending(entities, "e2")
	if len(got) != 1 || got[0].ID != "e3" {
		t.Fatalf("cursor e2 must leave only e3, got %+v", got)
	}
}

func TestFilterPendingAtEnd(t *testing.T) {
	entities := []exportEntity{{ID: "e1"}, {ID: "e2"}}
	if got := filterPending(entities, "e2"); len(got) != 0 {
		t.Fatalf("cursor at last entity must leave nothing, got %+v", got)
	}
}

func TestFilterPendingSortsBeforeFiltering(t *testing.T) {
	// Unsorted input must still be processed in ascending ID order so the
	// cursor comparison is well-defined.
	entities := []exportEntity{{ID: "e3"}, {ID: "e1"}, {ID: "e2"}}
	got := filterPending(entities, "e1")
	if len(got) != 2 || got[0].ID != "e2" || got[1].ID != "e3" {
		t.Fatalf("expected [e2 e3], got %+v", got)
	}
}

func TestFileCursorStoreRoundTrip(t *testing.T) {
	path := t.TempDir() + "/cursors.json"
	s := &fileCursorStore{path: path}
	if _, ok, err := s.Get("conn1:push"); err != nil || ok {
		t.Fatalf("missing cursor must be (\"\", false, nil), got ok=%v err=%v", ok, err)
	}
	if err := s.Set("conn1:push", "e5"); err != nil {
		t.Fatalf("Set: %v", err)
	}
	// A fresh store instance over the same file must see the cursor —
	// this is what makes a retried push idempotent across restarts.
	s2 := &fileCursorStore{path: path}
	v, ok, err := s2.Get("conn1:push")
	if err != nil || !ok || v != "e5" {
		t.Fatalf("expected (e5, true, nil), got (%q, %v, %v)", v, ok, err)
	}
	if err := s2.Set("conn1:push", "e7"); err != nil {
		t.Fatalf("Set: %v", err)
	}
	v, _, _ = s.Get("conn1:push")
	if v != "e7" {
		t.Fatalf("cursor advance not visible across instances: %q", v)
	}
	// Other keys must be unaffected.
	if _, ok, _ := s.Get("conn2:push"); ok {
		t.Fatal("unrelated cursor key must not exist")
	}
}

func TestFilterPendingWithPersistedCursor(t *testing.T) {
	// End-to-end of the idempotency contract: simulate a push that succeeded
	// through e2, then a retry with the same bundle.
	path := t.TempDir() + "/cursors.json"
	s := &fileCursorStore{path: path}
	bundle := []exportEntity{{ID: "e1"}, {ID: "e2"}, {ID: "e3"}}
	cursor, _, _ := s.Get("c:push")
	first := filterPending(bundle, cursor)
	if len(first) != 3 {
		t.Fatalf("first run must see 3 pending, got %d", len(first))
	}
	// Simulate success through e2.
	for _, e := range first[:2] {
		if err := s.Set("c:push", e.ID); err != nil {
			t.Fatalf("Set: %v", err)
		}
	}
	cursor, _, _ = s.Get("c:push")
	retry := filterPending(bundle, cursor)
	if len(retry) != 1 || retry[0].ID != "e3" {
		t.Fatalf("retry must only resend e3, got %+v", retry)
	}
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

func TestServiceAuthConstantTime(t *testing.T) {
	ok := false
	h := serviceAuth("secret-key", func(w http.ResponseWriter, _ *http.Request) {
		ok = true
		w.WriteHeader(http.StatusOK)
	})
	// Wrong key → 401, handler not invoked.
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodPost, "/sync/push", nil))
	if rec.Code != http.StatusUnauthorized || ok {
		t.Fatalf("missing key must be 401, got %d (handler invoked=%v)", rec.Code, ok)
	}
	// Right key → passes through.
	req := httptest.NewRequest(http.MethodPost, "/sync/push", nil)
	req.Header.Set("X-Service-Key", "secret-key")
	rec2 := httptest.NewRecorder()
	h(rec2, req)
	if rec2.Code != http.StatusOK || !ok {
		t.Fatalf("valid key must pass, got %d", rec2.Code)
	}
}

// ─── Fail-closed config ───────────────────────────────────────────────────────

func TestLoadConfigFailsClosed(t *testing.T) {
	t.Setenv("INTERNAL_SERVICE_KEY", "")
	if _, err := loadConfig(); err == nil {
		t.Fatal("loadConfig must fail closed without INTERNAL_SERVICE_KEY")
	}
}

func TestHealthReportsProviderConfig(t *testing.T) {
	t.Setenv("INTERNAL_SERVICE_KEY", "k")
	t.Setenv("DAPR_HTTP_PORT", "")
	t.Setenv("QBO_CLIENT_ID", "")
	t.Setenv("QBO_API_BASE", "")
	t.Setenv("XERO_CLIENT_ID", "")
	t.Setenv("COA_MAP_JSON", "")
	cfg, err := loadConfig()
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}
	rec := httptest.NewRecorder()
	healthHandler(cfg)(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("health: %d", rec.Code)
	}
	var body struct {
		Status    string `json:"status"`
		Dapr      bool   `json:"dapr"`
		Providers map[string]struct {
			OAuth bool `json:"oauth"`
			Sync  bool `json:"sync"`
		} `json:"providers"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("health JSON: %v", err)
	}
	if body.Status != "ok" || body.Dapr {
		t.Fatalf("unexpected health body: %+v", body)
	}
	// No provider env set in test → oauth must report false (fail-closed).
	if body.Providers[providerQuickBooks].OAuth || body.Providers[providerXero].OAuth {
		t.Fatalf("unconfigured providers must report oauth=false: %+v", body.Providers)
	}
	// Xero has a fixed API base → sync=true; QBO requires QBO_API_BASE.
	if !body.Providers[providerXero].Sync {
		t.Fatal("xero sync must be configured (fixed API base)")
	}
	if body.Providers[providerQuickBooks].Sync {
		t.Fatal("qbo sync must be unconfigured without QBO_API_BASE")
	}
}

func TestAuthStartFailsClosedUnconfigured(t *testing.T) {
	t.Setenv("INTERNAL_SERVICE_KEY", "k")
	t.Setenv("QBO_CLIENT_ID", "")
	cfg, err := loadConfig()
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}
	mux := newMux(cfg, newMemoryNonceStore(), &fileCursorStore{path: t.TempDir() + "/c.json"}, &http.Client{})
	req := httptest.NewRequest(http.MethodGet, "/auth/quickbooks_online/start", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured provider must be 503, got %d", rec.Code)
	}
}

// ─── Odoo provider (JSON-RPC, API-key auth) ──────────────────────────────────

func TestOdooModelMapping(t *testing.T) {
	for typ, want := range map[string]string{
		"vendor":  "res.partner",
		"bill":    "account.move",
		"payment": "account.payment",
	} {
		got, err := odooModel(typ)
		if err != nil || got != want {
			t.Fatalf("odooModel(%q) = %q, %v; want %q", typ, got, err, want)
		}
	}
	if _, err := odooModel("nonsense"); err == nil {
		t.Fatal("unknown entity type must fail closed")
	}
}

func TestResolveOdooBasePrefersPerConnection(t *testing.T) {
	p := &providerConfig{Name: providerOdoo, APIBase: "https://odoo.internal"}
	base, err := resolveOdooBase(p, syncRequest{APIBase: "https://books.tenant.example"})
	if err != nil || base != "https://books.tenant.example" {
		t.Fatalf("per-connection base must win: %q, %v", base, err)
	}
}

func TestResolveOdooBaseFallsBackToDefault(t *testing.T) {
	p := &providerConfig{Name: providerOdoo, APIBase: "https://odoo.internal/"}
	base, err := resolveOdooBase(p, syncRequest{})
	if err != nil || base != "https://odoo.internal" {
		t.Fatalf("default base (trailing slash trimmed): %q, %v", base, err)
	}
}

func TestResolveOdooBaseFailsClosed(t *testing.T) {
	p := &providerConfig{Name: providerOdoo}
	if _, err := resolveOdooBase(p, syncRequest{}); err == nil {
		t.Fatal("empty base must fail closed")
	}
	for _, bad := range []string{"odoo.example", "ftp://odoo.example", "://", "https://"} {
		if _, err := resolveOdooBase(p, syncRequest{APIBase: bad}); err == nil {
			t.Fatalf("invalid base %q must fail closed", bad)
		}
	}
}

func TestOdooAuthRejectsFalse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// Odoo answers `false` for bad credentials.
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":false}`))
	}))
	defer srv.Close()
	if _, err := odooAuthenticate(srv.Client(), srv.URL, "db", "u", "bad-key"); err == nil {
		t.Fatal("false uid must be an authentication error (fail closed)")
	}
}

func TestOdooCallEnvelopeAndFault(t *testing.T) {
	var saw struct {
		JSONRPC string `json:"jsonrpc"`
		Params  struct {
			Service string `json:"service"`
			Method  string `json:"method"`
		} `json:"params"`
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/jsonrpc" {
			t.Errorf("odoo calls must target /jsonrpc, got %s", r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&saw)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":42}`))
	}))
	defer srv.Close()
	result, err := odooCall(srv.Client(), srv.URL, "common", "version", []interface{}{})
	if err != nil {
		t.Fatalf("odooCall: %v", err)
	}
	if saw.JSONRPC != "2.0" || saw.Params.Service != "common" || saw.Params.Method != "version" {
		t.Fatalf("envelope shape wrong: %+v", saw)
	}
	var n int64
	if err := json.Unmarshal(result, &n); err != nil || n != 42 {
		t.Fatalf("result = %s, want 42", string(result))
	}

	faultSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"error":{"code":200,"message":"Odoo Server Error","data":{"debug":"SECRET-ARG-LEAK"}}}`))
	}))
	defer faultSrv.Close()
	_, err = odooCall(faultSrv.Client(), faultSrv.URL, "object", "execute_kw", []interface{}{})
	if err == nil || !strings.Contains(err.Error(), "Odoo Server Error") {
		t.Fatalf("fault must surface as error, got %v", err)
	}
	if strings.Contains(err.Error(), "SECRET-ARG-LEAK") {
		t.Fatal("fault data must NOT be propagated (can echo credentials)")
	}
}

func TestOdooPushEntityCreateReturnsID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":77}`))
	}))
	defer srv.Close()
	extID, err := odooPushEntity(srv.Client(), srv.URL, "db", 2, "k", exportEntity{
		ID: "e1", Type: "vendor", Action: "create", Payload: json.RawMessage(`{"name":"Acme","supplier_rank":1}`),
	})
	if err != nil || extID != "77" {
		t.Fatalf("create = %q, %v; want 77", extID, err)
	}
}

func TestOdooPushEntityUpdateRequiresNumericExternalID(t *testing.T) {
	_, err := odooPushEntity(&http.Client{}, "http://unused", "db", 2, "k", exportEntity{
		ID: "e1", Type: "bill", Action: "update", ExternalID: "not-a-number",
		Payload: json.RawMessage(`{"ref":"x"}`),
	})
	if err == nil {
		t.Fatal("non-numeric externalId on update must fail")
	}
}

func TestOdooAuthStartExplicitlyRejected(t *testing.T) {
	t.Setenv("INTERNAL_SERVICE_KEY", "k")
	cfg, err := loadConfig()
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}
	mux := newMux(cfg, newMemoryNonceStore(), &fileCursorStore{path: t.TempDir() + "/c.json"}, &http.Client{})
	req := httptest.NewRequest(http.MethodGet, "/auth/odoo/start", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("odoo oauth start must be 400 (API-key connect), got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "does not use OAuth2") {
		t.Fatalf("rejection must be honest about API-key connect: %s", rec.Body.String())
	}
}

// ─── OpenTelemetry (fail-soft — telemetry never blocks requests) ─────────────

func TestOtelMiddlewareDoesNotBlockRequests(t *testing.T) {
	// SDK explicitly disabled: initTelemetry must return a no-op shutdown and
	// leave the no-op global tracer/meter in place.
	t.Setenv("OTEL_SDK_DISABLED", "true")
	t.Setenv("INTERNAL_SERVICE_KEY", "k")
	shutdown, _, _ := initTelemetry(context.Background())
	defer func() { _ = shutdown(context.Background()) }()
	if shutdown == nil {
		t.Fatal("initTelemetry must always return a shutdown func (no-op when disabled)")
	}
	if telemetryEnabled.Load() {
		t.Fatal("telemetryEnabled must be false when OTEL_SDK_DISABLED=true")
	}

	cfg, err := loadConfig()
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}
	mux := newMux(cfg, newMemoryNonceStore(), &fileCursorStore{path: t.TempDir() + "/c.json"}, &http.Client{})

	// 200 path: every wrapped route still serves through the no-op middleware.
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("health through otelMiddleware = %d, want 200", rec.Code)
	}

	// A tenant header must not change behavior (it becomes a span attribute
	// only when a real SDK is active).
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("X-Tenant-Id", "tenant-123")
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req)
	if rec2.Code != http.StatusOK {
		t.Fatalf("health with X-Tenant-Id = %d, want 200", rec2.Code)
	}

	// Guard paths are unchanged: the auth middleware still rejects first.
	rec3 := httptest.NewRecorder()
	mux.ServeHTTP(rec3, httptest.NewRequest(http.MethodPost, "/sync/push", nil))
	if rec3.Code != http.StatusUnauthorized {
		t.Fatalf("sync/push without key = %d, want 401 (telemetry must not bypass auth)", rec3.Code)
	}
}

func TestHealthReportsTelemetry(t *testing.T) {
	// With the SDK disabled, /health must honestly report telemetry=false.
	t.Setenv("OTEL_SDK_DISABLED", "true")
	t.Setenv("INTERNAL_SERVICE_KEY", "k")
	initTelemetry(context.Background()) // no-op shutdown discarded; disabled path
	if telemetryEnabled.Load() {
		t.Fatal("telemetryEnabled must be false when OTEL_SDK_DISABLED=true")
	}
	cfg, err := loadConfig()
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}
	rec := httptest.NewRecorder()
	healthHandler(cfg)(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("health: %d", rec.Code)
	}
	var body struct {
		Status    string `json:"status"`
		Telemetry bool   `json:"telemetry"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("health JSON: %v", err)
	}
	if body.Status != "ok" {
		t.Fatalf("status = %q, want ok", body.Status)
	}
	if body.Telemetry {
		t.Fatal("health must report telemetry=false when the SDK is disabled (honest, never fake)")
	}
}

func TestHealthReportsOdoo(t *testing.T) {
	t.Setenv("INTERNAL_SERVICE_KEY", "k")
	t.Setenv("ODOO_API_BASE", "https://odoo.internal")
	cfg, err := loadConfig()
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}
	mux := newMux(cfg, newMemoryNonceStore(), &fileCursorStore{path: t.TempDir() + "/c.json"}, &http.Client{})
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	var body struct {
		Providers map[string]struct {
			OAuth bool `json:"oauth"`
			Sync  bool `json:"sync"`
		} `json:"providers"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("health JSON: %v", err)
	}
	od, ok := body.Providers[providerOdoo]
	if !ok {
		t.Fatal("health must report the odoo provider")
	}
	if od.OAuth {
		t.Fatal("odoo must report oauth=false (no OAuth2 flow)")
	}
	if !od.Sync {
		t.Fatal("odoo sync must be true when ODOO_API_BASE is set")
	}
}
