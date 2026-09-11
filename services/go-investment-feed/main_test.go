package main

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// ─── validateEntry ────────────────────────────────────────────────────────────

func TestValidateEntry(t *testing.T) {
	valid := FeedEntry{
		Ticker:           "DANGCEM",
		PriceNGN:         550.5,
		PreviousCloseNGN: 545.0,
		ChangePercent:    1.01,
		MarketCapNGN:     9.2e12,
	}

	tests := []struct {
		name    string
		mutate  func(e *FeedEntry)
		wantErr bool
	}{
		{"valid entry", func(e *FeedEntry) {}, false},
		{"valid dotted ticker", func(e *FeedEntry) { e.Ticker = "WAPCO.LG" }, false},
		{"valid ticker with digits", func(e *FeedEntry) { e.Ticker = "ETI2" }, false},
		{"empty ticker", func(e *FeedEntry) { e.Ticker = "" }, true},
		{"lowercase ticker", func(e *FeedEntry) { e.Ticker = "dangcem" }, true},
		{"ticker too long", func(e *FeedEntry) { e.Ticker = strings.Repeat("A", 21) }, true},
		{"ticker with space", func(e *FeedEntry) { e.Ticker = "DANG CEM" }, true},
		{"ticker with slash", func(e *FeedEntry) { e.Ticker = "BAD/TICK" }, true},
		{"zero price", func(e *FeedEntry) { e.PriceNGN = 0 }, true},
		{"negative price", func(e *FeedEntry) { e.PriceNGN = -1 }, true},
		{"NaN price", func(e *FeedEntry) { e.PriceNGN = math.NaN() }, true},
		{"+Inf price", func(e *FeedEntry) { e.PriceNGN = math.Inf(1) }, true},
		{"negative previous close", func(e *FeedEntry) { e.PreviousCloseNGN = -0.01 }, true},
		{"NaN previous close", func(e *FeedEntry) { e.PreviousCloseNGN = math.NaN() }, true},
		{"zero previous close ok", func(e *FeedEntry) { e.PreviousCloseNGN = 0 }, false},
		{"change below -100", func(e *FeedEntry) { e.ChangePercent = -100.01 }, true},
		{"change above ceiling", func(e *FeedEntry) { e.ChangePercent = 10000.01 }, true},
		{"change at bounds ok", func(e *FeedEntry) { e.ChangePercent = -100 }, false},
		{"NaN change", func(e *FeedEntry) { e.ChangePercent = math.NaN() }, true},
		{"negative market cap", func(e *FeedEntry) { e.MarketCapNGN = -5 }, true},
		{"zero market cap ok", func(e *FeedEntry) { e.MarketCapNGN = 0 }, false},
		{"Inf market cap", func(e *FeedEntry) { e.MarketCapNGN = math.Inf(1) }, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			e := valid
			tc.mutate(&e)
			err := validateEntry(e)
			if tc.wantErr && err == nil {
				t.Fatalf("expected error, got nil for %+v", e)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("expected no error, got %v", err)
			}
		})
	}
}

// ─── validateBatch ────────────────────────────────────────────────────────────

func TestValidateBatch(t *testing.T) {
	good := FeedEntry{Ticker: "MTNN", PriceNGN: 200, PreviousCloseNGN: 199, ChangePercent: 0.5, MarketCapNGN: 4e12}
	bad := good
	bad.Ticker = "bad ticker"

	if errs := validateBatch([]FeedEntry{good, good}); len(errs) != 0 {
		t.Fatalf("expected no errors, got %v", errs)
	}
	errs := validateBatch([]FeedEntry{good, bad, bad})
	if len(errs) != 2 {
		t.Fatalf("expected 2 errors, got %d: %v", len(errs), errs)
	}
}

// ─── loadConfig (fail-closed boot) ────────────────────────────────────────────

func TestLoadConfig(t *testing.T) {
	// All required vars present (PORT pinned empty so a host PORT can't leak in).
	t.Setenv("PORT", "")
	t.Setenv("INTERNAL_SERVICE_KEY", "k")
	t.Setenv("NGX_FEED_URL", "http://feed")
	t.Setenv("INGEST_URL", "http://ingest")
	cfg, err := loadConfig()
	if err != nil {
		t.Fatalf("expected ok config, got %v", err)
	}
	if cfg.Port != defaultPort {
		t.Fatalf("expected default port %s, got %s", defaultPort, cfg.Port)
	}

	cases := []struct{ name, key, feed, ingest string }{
		{"missing key", "", "http://feed", "http://ingest"},
		{"missing feed", "k", "", "http://ingest"},
		{"missing ingest", "k", "http://feed", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("INTERNAL_SERVICE_KEY", tc.key)
			t.Setenv("NGX_FEED_URL", tc.feed)
			t.Setenv("INGEST_URL", tc.ingest)
			if _, err := loadConfig(); err == nil {
				t.Fatal("expected fail-closed error, got nil")
			}
		})
	}
}

// ─── internalAuth middleware ──────────────────────────────────────────────────

func TestInternalAuth(t *testing.T) {
	const secret = "test-internal-key-0123456789"
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	handler := internalAuth(secret, ok)

	tests := []struct {
		name       string
		header     string
		wantStatus int
	}{
		{"missing header", "", http.StatusUnauthorized},
		{"wrong key", "wrong-key", http.StatusUnauthorized},
		{"prefix of key", secret[:8], http.StatusUnauthorized},
		{"key with suffix", secret + "x", http.StatusUnauthorized},
		{"correct key", secret, http.StatusOK},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/refresh", nil)
			if tc.header != "" {
				req.Header.Set("X-Internal-Key", tc.header)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			if tc.wantStatus == http.StatusUnauthorized {
				var body map[string]string
				if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
					t.Fatalf("unauthorized response not JSON: %v", err)
				}
				if body["error"] != "unauthorized" {
					t.Fatalf("unexpected body: %v", body)
				}
			}
		})
	}
}

// ─── /refresh end-to-end (httptest feed + ingest servers) ─────────────────────

const validFeedJSON = `[
  {"ticker":"DANGCEM","price_ngn":550.5,"previous_close_ngn":545.0,"change_percent":1.01,"market_cap_ngn":9200000000000},
  {"ticker":"MTNN","price_ngn":200.0,"previous_close_ngn":199.0,"change_percent":0.5,"market_cap_ngn":4000000000000}
]`

// refreshFixture wires a fake feed and a fake ingest server behind newMux.
type refreshFixture struct {
	cfg          Config
	mux          http.Handler
	feedServer   *httptest.Server
	ingestServer *httptest.Server
	ingestKey    *atomic.Value // last X-Internal-Key seen by ingest
	ingestBody   *atomic.Value // last body seen by ingest
}

func newFixture(t *testing.T, feedHandler, ingestHandler http.HandlerFunc) *refreshFixture {
	t.Helper()
	f := &refreshFixture{ingestKey: &atomic.Value{}, ingestBody: &atomic.Value{}}

	f.feedServer = httptest.NewServer(feedHandler)
	t.Cleanup(f.feedServer.Close)

	wrapped := func(w http.ResponseWriter, r *http.Request) {
		f.ingestKey.Store(r.Header.Get("X-Internal-Key"))
		b, _ := io.ReadAll(r.Body)
		f.ingestBody.Store(string(b))
		ingestHandler(w, r)
	}
	f.ingestServer = httptest.NewServer(http.HandlerFunc(wrapped))
	t.Cleanup(f.ingestServer.Close)

	f.cfg = Config{
		Port:        defaultPort,
		InternalKey: "fixture-secret",
		FeedURL:     f.feedServer.URL,
		IngestURL:   f.ingestServer.URL,
	}
	f.mux = newMux(f.cfg, f.feedServer.Client(), &http.Client{Timeout: ingestTimeout})
	return f
}

func (f *refreshFixture) postRefresh(t *testing.T, key string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/refresh", nil)
	if key != "" {
		req.Header.Set("X-Internal-Key", key)
	}
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	return rec
}

func decodeResult(t *testing.T, rec *httptest.ResponseRecorder) refreshResult {
	t.Helper()
	var res refreshResult
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("response not JSON: %v (%q)", err, rec.Body.String())
	}
	return res
}

func TestRefreshSuccess(t *testing.T) {
	f := newFixture(t,
		func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(validFeedJSON))
		},
		func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		},
	)

	rec := f.postRefresh(t, "fixture-secret")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	res := decodeResult(t, rec)
	if res.Updated != 2 || res.Rejected != 0 || len(res.Errors) != 0 {
		t.Fatalf("unexpected result: %+v", res)
	}
	if got := f.ingestKey.Load(); got != "fixture-secret" {
		t.Fatalf("ingest saw X-Internal-Key %q, want fixture-secret", got)
	}
	body, _ := f.ingestBody.Load().(string)
	var forwarded []FeedEntry
	if err := json.Unmarshal([]byte(body), &forwarded); err != nil {
		t.Fatalf("ingest body not a FeedEntry array: %v", err)
	}
	if len(forwarded) != 2 || forwarded[0].Ticker != "DANGCEM" {
		t.Fatalf("unexpected forwarded batch: %+v", forwarded)
	}
}

func TestRefreshRejectsInvalidBatch(t *testing.T) {
	f := newFixture(t,
		func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`[
			  {"ticker":"DANGCEM","price_ngn":550.5,"previous_close_ngn":545.0,"change_percent":1.01,"market_cap_ngn":1e12},
			  {"ticker":"bad ticker","price_ngn":-3,"previous_close_ngn":1,"change_percent":0,"market_cap_ngn":1}
			]`))
		},
		func(w http.ResponseWriter, _ *http.Request) {
			t.Error("ingest must NOT be called when validation fails")
			w.WriteHeader(http.StatusOK)
		},
	)

	rec := f.postRefresh(t, "fixture-secret")
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422; body = %s", rec.Code, rec.Body.String())
	}
	res := decodeResult(t, rec)
	if res.Updated != 0 || res.Rejected != 2 || len(res.Errors) == 0 {
		t.Fatalf("unexpected result: %+v", res)
	}
	if f.ingestKey.Load() != nil {
		t.Fatal("ingest was called despite invalid batch")
	}
}

func TestRefreshFeedFailures(t *testing.T) {
	cases := []struct {
		name        string
		feedHandler http.HandlerFunc
	}{
		{"feed 500", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusInternalServerError) }},
		{"feed invalid JSON", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{not json`)) }},
		{"feed JSON object not array", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"ticker":"X"}`)) }},
		{"feed empty batch", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`[]`)) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newFixture(t, tc.feedHandler,
				func(w http.ResponseWriter, _ *http.Request) {
					t.Error("ingest must NOT be called on feed failure")
					w.WriteHeader(http.StatusOK)
				})
			rec := f.postRefresh(t, "fixture-secret")
			if rec.Code != http.StatusBadGateway {
				t.Fatalf("status = %d, want 502; body = %s", rec.Code, rec.Body.String())
			}
			res := decodeResult(t, rec)
			if res.Updated != 0 || len(res.Errors) != 1 {
				t.Fatalf("unexpected result: %+v", res)
			}
		})
	}
}

func TestRefreshIngestNon2xxIs502NeverFakeSuccess(t *testing.T) {
	f := newFixture(t,
		func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(validFeedJSON)) },
		func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusInternalServerError) },
	)
	rec := f.postRefresh(t, "fixture-secret")
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502; body = %s", rec.Code, rec.Body.String())
	}
	res := decodeResult(t, rec)
	if res.Updated != 0 || res.Rejected != 2 || len(res.Errors) != 1 {
		t.Fatalf("unexpected result: %+v", res)
	}
}

func TestRefreshRequiresAuth(t *testing.T) {
	f := newFixture(t,
		func(w http.ResponseWriter, _ *http.Request) {
			t.Error("feed must NOT be fetched without auth")
		},
		func(w http.ResponseWriter, _ *http.Request) {
			t.Error("ingest must NOT be called without auth")
		},
	)
	rec := f.postRefresh(t, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

// ─── /health and /metrics ─────────────────────────────────────────────────────

func TestHealthAndMetrics(t *testing.T) {
	f := newFixture(t,
		func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(validFeedJSON)) },
		func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) },
	)

	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("/health status = %d", rec.Code)
	}
	var health map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &health); err != nil {
		t.Fatalf("/health not JSON: %v", err)
	}
	if health["status"] != "ok" || health["service"] != serviceName {
		t.Fatalf("unexpected /health body: %v", health)
	}

	// Counters are process-global and shared across tests in this package, so
	// assert on increments relative to a captured baseline.
	baseRefresh := metricRefreshTotal.Load()
	baseSuccess := metricRefreshSuccess.Load()
	baseIngested := metricEntriesIngested.Load()

	// Trigger one successful refresh so counters move.
	if rec := f.postRefresh(t, "fixture-secret"); rec.Code != http.StatusOK {
		t.Fatalf("refresh failed: %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	f.mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("/metrics status = %d", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{
		fmt.Sprintf("go_investment_feed_refresh_total %d", baseRefresh+1),
		fmt.Sprintf("go_investment_feed_refresh_success_total %d", baseSuccess+1),
		fmt.Sprintf("go_investment_feed_entries_ingested_total %d", baseIngested+2),
		"go_investment_feed_last_success_unixtime",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("/metrics missing %q; body:\n%s", want, body)
		}
	}
	if !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/plain") {
		t.Fatalf("/metrics content type = %q", rec.Header().Get("Content-Type"))
	}
}
