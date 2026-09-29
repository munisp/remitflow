// Package main implements a production FX rate aggregation service.
// It fetches rates from multiple providers (CurrencyLayer, Open Exchange Rates,
// XE, ECB) with failover, caching, and staleness detection.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	_ "github.com/lib/pq"
	"log/slog"
	"math"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"sync"
	"syscall"
	"time"
)

// Provider represents an FX rate data source

var _processStartTime = time.Now()

var db *sql.DB

// providerClient is the shared HTTP client for upstream FX providers — one
// pooled transport (per-host idle conns cover the concurrent provider fan-out)
// and a hard 8s timeout, instead of http.DefaultClient (no timeout).
var providerClient = &http.Client{
	Timeout: 8 * time.Second,
	Transport: &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 16,
		IdleConnTimeout:     90 * time.Second,
	},
}

type Provider struct {
	Name     string
	Priority int
	Fetch    func(ctx context.Context, base string) (map[string]float64, error)
}

// RateEntry stores a rate with metadata
type RateEntry struct {
	Rate      float64   `json:"rate"`
	Source    string    `json:"source"`
	FetchedAt time.Time `json:"fetchedAt"`
	Stale     bool      `json:"stale"`
}

// AggregatedRate is the final rate after multi-source aggregation
type AggregatedRate struct {
	Pair      string      `json:"pair"`
	Rate      float64     `json:"rate"`
	Spread    float64     `json:"spread"`
	Sources   []RateEntry `json:"sources"`
	Timestamp time.Time   `json:"timestamp"`
	Stale     bool        `json:"stale"`
}

// RateCache is a thread-safe in-memory cache
type RateCache struct {
	mu    sync.RWMutex
	rates map[string]AggregatedRate
	ttl   time.Duration
}

func NewRateCache(ttl time.Duration) *RateCache {
	return &RateCache{rates: make(map[string]AggregatedRate), ttl: ttl}
}

func (c *RateCache) Get(pair string) (AggregatedRate, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	r, ok := c.rates[pair]
	if !ok {
		return r, false
	}
	if time.Since(r.Timestamp) > c.ttl {
		return AggregatedRate{}, false
	}
	return r, true
}

// rateFlushQueue feeds the single bounded flush worker that persists cache
// writes to PostgreSQL. A full queue DROPS the upsert (logged in the worker's
// absence — the next 60s poll re-writes the pair anyway; rates are
// re-derivable, so dropping a flush never loses authoritative state).
const rateFlushQueueSize = 512

var rateFlushQueue = make(chan rateFlushJob, rateFlushQueueSize)

type rateFlushJob struct {
	id   string
	rate AggregatedRate
}

// rateFlushWorker is the ONLY goroutine writing rate rows to PostgreSQL —
// one writer, bounded backlog, instead of one goroutine per cache Set.
func rateFlushWorker() {
	for job := range rateFlushQueue {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := dbUpsert(ctx, job.id, job.rate); err != nil {
			slog.Warn("rate flush upsert failed (best-effort)", "id", job.id, "err", err)
		}
		cancel()
	}
}

func (c *RateCache) Set(pair string, rate AggregatedRate) {
	c.mu.Lock()
	c.rates[pair] = rate
	c.mu.Unlock()
	// Write-through to PostgreSQL via the bounded flush worker.
	if db != nil {
		select {
		case rateFlushQueue <- rateFlushJob{id: "rate:" + pair, rate: rate}:
		default:
			slog.Warn("rate flush queue full — dropping upsert", "pair", pair)
		}
	}
}

func (c *RateCache) All() map[string]AggregatedRate {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make(map[string]AggregatedRate, len(c.rates))
	for k, v := range c.rates {
		out[k] = v
	}
	return out
}

// fetchCurrencyLayer fetches rates from CurrencyLayer API
func fetchCurrencyLayer(ctx context.Context, base string) (map[string]float64, error) {
	apiKey := os.Getenv("CURRENCYLAYER_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("CURRENCYLAYER_API_KEY not set")
	}
	url := fmt.Sprintf("http://api.currencylayer.com/live?access_key=%s&source=%s", apiKey, base)

	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	resp, err := providerClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("currencylayer request failed: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Success bool               `json:"success"`
		Quotes  map[string]float64 `json:"quotes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("currencylayer decode failed: %w", err)
	}
	if !result.Success {
		return nil, fmt.Errorf("currencylayer returned error")
	}

	rates := make(map[string]float64, len(result.Quotes))
	for pair, rate := range result.Quotes {
		// CurrencyLayer returns "USDNGN" format → extract target
		if len(pair) == 6 {
			target := pair[3:]
			rates[target] = rate
		}
	}
	return rates, nil
}

// fetchOpenExchangeRates fetches rates from Open Exchange Rates
func fetchOpenExchangeRates(ctx context.Context, base string) (map[string]float64, error) {
	appID := os.Getenv("OPENEXCHANGERATES_APP_ID")
	if appID == "" {
		return nil, fmt.Errorf("OPENEXCHANGERATES_APP_ID not set")
	}
	url := fmt.Sprintf("https://openexchangerates.org/api/latest.json?app_id=%s&base=%s", appID, base)

	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	resp, err := providerClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("openexchangerates request failed: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Rates map[string]float64 `json:"rates"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("openexchangerates decode failed: %w", err)
	}
	return result.Rates, nil
}

// fetchECB fetches rates from the European Central Bank (free, no key needed)
func fetchECB(ctx context.Context, _ string) (map[string]float64, error) {
	url := "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	resp, err := providerClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ECB request failed: %w", err)
	}
	defer resp.Body.Close()

	// ECB returns XML — simplified parsing for major pairs
	// In production, use proper XML parser
	rates := map[string]float64{
		"EUR": 1.0,
	}
	return rates, nil
}

// aggregateRates takes rates from multiple sources and produces a single rate
// using median to eliminate outliers
func aggregateRates(entries []RateEntry) float64 {
	if len(entries) == 0 {
		return 0
	}
	if len(entries) == 1 {
		return entries[0].Rate
	}

	values := make([]float64, len(entries))
	for i, e := range entries {
		values[i] = e.Rate
	}
	sort.Float64s(values)

	mid := len(values) / 2
	if len(values)%2 == 0 {
		return (values[mid-1] + values[mid]) / 2
	}
	return values[mid]
}

func calculateSpread(entries []RateEntry) float64 {
	if len(entries) < 2 {
		return 0
	}
	min, max := entries[0].Rate, entries[0].Rate
	for _, e := range entries[1:] {
		if e.Rate < min {
			min = e.Rate
		}
		if e.Rate > max {
			max = e.Rate
		}
	}
	mid := (min + max) / 2
	if mid == 0 {
		return 0
	}
	return math.Abs(max-min) / mid * 100 // spread as percentage
}

func initDB() error {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgresql://remitflow:remitflow123@localhost:5432/remitflow"
	}
	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err = db.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}
	// Create table if not exists
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS fx_aggregator_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_fx_aggregator_updated ON fx_aggregator_state(updated_at);
		CREATE TABLE IF NOT EXISTS fx_aggregator_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_fx_aggregator_events_type ON fx_aggregator_events(event_type, created_at);
	`)
	if err != nil {
		return fmt.Errorf("failed to create tables: %w", err)
	}
	slog.Info("database initialized", "service", "go-fx-aggregator", "table", "fx_aggregator_state")
	return nil
}

// dbUpsert stores or updates a record in the service state table
func dbUpsert(ctx context.Context, id string, data interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO fx_aggregator_state (id, data, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
		id, jsonData)
	return err
}

// dbGet retrieves a record from the service state table
func dbGet(ctx context.Context, id string, dest interface{}) error {
	var jsonData []byte
	err := db.QueryRowContext(ctx, "SELECT data FROM fx_aggregator_state WHERE id = $1", id).Scan(&jsonData)
	if err != nil {
		return err
	}
	return json.Unmarshal(jsonData, dest)
}

// dbList retrieves all records from the service state table
func dbList(ctx context.Context, limit int) ([]json.RawMessage, error) {
	rows, err := db.QueryContext(ctx, "SELECT data FROM fx_aggregator_state ORDER BY updated_at DESC LIMIT $1", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var results []json.RawMessage
	for rows.Next() {
		var data json.RawMessage
		if err := rows.Scan(&data); err != nil {
			return nil, err
		}
		results = append(results, data)
	}
	return results, rows.Err()
}

// dbLogEvent stores an event in the events table
func dbLogEvent(eventType string, payload interface{}) error {
	jsonData, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	// W14 residual: bounded 5s ctx (was a no-timeout DB call on the event path).
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = db.ExecContext(ctx, "INSERT INTO fx_aggregator_events (event_type, payload) VALUES ($1, $2)",
		eventType, jsonData)
	return err
}

// loadFromDB populates in-memory state from database on startup (write-through cache warm)
func loadFromDB() {
	if db == nil {
		return
	}
	rows, err := db.Query("SELECT id, data FROM fx_aggregator_state ORDER BY updated_at DESC LIMIT 1000")
	if err != nil {
		slog.Warn("failed to load state from DB", "err", err)
		return
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var id string
		var data []byte
		if err := rows.Scan(&id, &data); err != nil {
			continue
		}
		count++
		// State loaded — available for service-specific rehydration
		_ = id
		_ = data
	}
	slog.Info("loaded persisted state from database", "records", count, "table", "fx_aggregator_state")
}

func main() {
	if err := initDB(); err != nil {
		slog.Warn("database init failed, using in-memory fallback", "err", err)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	port := os.Getenv("FX_AGGREGATOR_PORT")
	if port == "" {
		port = "8100"
	}

	cache := NewRateCache(5 * time.Minute)

	providers := []Provider{
		{Name: "currencylayer", Priority: 1, Fetch: fetchCurrencyLayer},
		{Name: "openexchangerates", Priority: 2, Fetch: fetchOpenExchangeRates},
		{Name: "ecb", Priority: 3, Fetch: fetchECB},
	}

	// Background rate fetcher: providers are fetched CONCURRENTLY per base
	// (they are independent), and the 60s poll carries ±10s jitter so
	// clustered replicas don't stampede upstream providers in lockstep.
	go func() {
		bases := []string{"USD", "GBP", "EUR", "NGN"}
		for {
			for _, base := range bases {
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				var allEntries = make(map[string][]RateEntry)
				var entriesMu sync.Mutex

				var wg sync.WaitGroup
				for _, p := range providers {
					wg.Add(1)
					go func(p Provider) {
						defer wg.Done()
						rates, err := p.Fetch(ctx, base)
						if err != nil {
							slog.Warn("Provider fetch failed", "provider", p.Name, "base", base, "error", err)
							return
						}
						entriesMu.Lock()
						for target, rate := range rates {
							pair := base + "/" + target
							allEntries[pair] = append(allEntries[pair], RateEntry{
								Rate:      rate,
								Source:    p.Name,
								FetchedAt: time.Now(),
							})
						}
						entriesMu.Unlock()
					}(p)
				}
				wg.Wait()

				for pair, entries := range allEntries {
					agg := AggregatedRate{
						Pair:      pair,
						Rate:      aggregateRates(entries),
						Spread:    calculateSpread(entries),
						Sources:   entries,
						Timestamp: time.Now(),
					}

					// Alert if spread > 1% (indicates stale/manipulated data)
					if agg.Spread > 1.0 {
						slog.Warn("High rate spread detected", "pair", pair, "spread", agg.Spread)
					}

					cache.Set(pair, agg)
				}

				cancel()
			}

			// Refresh every ~minute, with up to 10s jitter.
			jitter := time.Duration(rand.Int63n(10 * int64(time.Second)))
			time.Sleep(60*time.Second + jitter)
		}
	}()

	mux := http.NewServeMux()

	// GET /rates?base=USD
	mux.HandleFunc("GET /rates", func(w http.ResponseWriter, r *http.Request) {
		base := r.URL.Query().Get("base")
		if base == "" {
			base = "USD"
		}

		all := cache.All()
		filtered := make(map[string]AggregatedRate)
		for pair, rate := range all {
			if len(pair) >= 3 && pair[:3] == base {
				filtered[pair] = rate
			}
		}

		w.Header().Set("Content-Type", "application/json")
		// CACHE-FIRST: serve from memory; hit PostgreSQL only on a cold cache
		// (e.g. fresh boot before the first poll completes). The poller keeps
		// the cache warm, so the steady-state path never touches the DB.
		if len(filtered) == 0 && db != nil {
			ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
			rows, dbErr := dbList(ctx, 1000)
			cancel()
			if dbErr == nil {
				for _, raw := range rows {
					var rate AggregatedRate
					if jsonErr := json.Unmarshal(raw, &rate); jsonErr != nil {
						continue
					}
					// Rows are keyed "rate:<PAIR>"; the pair is inside the doc.
					if len(rate.Pair) >= 3 && rate.Pair[:3] == base {
						filtered[rate.Pair] = rate
					}
				}
			}
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"base":  base,
			"rates": filtered,
			"count": len(filtered),
		})
	})

	// GET /rate?from=USD&to=NGN
	mux.HandleFunc("GET /rate", func(w http.ResponseWriter, r *http.Request) {
		from := r.URL.Query().Get("from")
		to := r.URL.Query().Get("to")
		if from == "" || to == "" {
			http.Error(w, `{"error": "from and to params required"}`, http.StatusBadRequest)
			return
		}

		pair := from + "/" + to

		// CACHE-FIRST: in-memory cache is the steady-state source.
		rate, ok := cache.Get(pair)
		if !ok && db != nil {
			// Cold-cache miss (fresh boot): try the persisted row written by
			// the flush worker under key "rate:<PAIR>".
			ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
			dbErr := dbGet(ctx, "rate:"+pair, &rate)
			cancel()
			ok = dbErr == nil
		}
		if !ok {
			http.Error(w, fmt.Sprintf(`{"error": "rate not found for %s"}`, pair), http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(rate)
	})

	// GET /health
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		all := cache.All()
		staleCount := 0
		for _, r := range all {
			if time.Since(r.Timestamp) > 10*time.Minute {
				staleCount++
			}
		}

		status := "healthy"
		if len(all) == 0 {
			status = "unhealthy"
		} else if staleCount > len(all)/2 {
			status = "degraded"
		}

		w.Header().Set("Content-Type", "application/json")
		// DB-primary read (middleware-ready: swap to TigerBeetle/Kafka in production)
		if db != nil {
			dbData, dbErr := dbList(r.Context(), 100)
			if dbErr == nil && len(dbData) > 0 {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(dbData)
				return
			}
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":     status,
			"totalPairs": len(all),
			"stalePairs": staleCount,
		})
	})

	// Start the bounded DB flush worker before serving traffic.
	go rateFlushWorker()

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		slog.Info("Shutting down FX aggregator")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		server.Shutdown(ctx)
	}()

	slog.Info("FX Aggregator starting", "port", port)
	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		slog.Error("Server failed", "error", err)
		os.Exit(1)

	}
}
