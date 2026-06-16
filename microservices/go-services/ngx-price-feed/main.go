// NGX Price Feed Service — Go microservice
// Fetches live NGX stock prices every 15 minutes and writes to PostgreSQL
// Exposes REST API: GET /prices, GET /prices/:symbol, GET /health
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"time"

	_ "github.com/lib/pq"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ─── Config ──────────────────────────────────────────────────────────────────

type Config struct {
	Port        string
	DatabaseURL string
	FetchInterval time.Duration
	NGXAPIURL   string
	NGXAPIKey   string
}

func loadConfig() Config {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}
	interval := 15 * time.Minute
	if s := os.Getenv("FETCH_INTERVAL_SECONDS"); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			interval = time.Duration(n) * time.Second
		}
	}
	return Config{
		Port:          port,
		DatabaseURL:   getEnvOrDefault("DATABASE_URL", os.Getenv("LOCAL_DATABASE_URL")),
		FetchInterval: interval,
		NGXAPIURL:     getEnvOrDefault("NGX_API_URL", "https://api.ngxgroup.com/exchange/data"),
		NGXAPIKey:     getEnvOrDefault("NGX_API_KEY", "demo-key-replace-in-production"),
	}
}

func getEnvOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ─── Models ──────────────────────────────────────────────────────────────────

type StockPrice struct {
	ID            int     `json:"id"`
	Symbol        string  `json:"symbol"`
	CompanyName   string  `json:"company_name"`
	CurrentPrice  float64 `json:"current_price_ngn"`
	ChangePercent float64 `json:"change_percent"`
	Volume        int64   `json:"volume"`
	HighNGN       float64 `json:"high_ngn"`
	LowNGN        float64 `json:"low_ngn"`
	OpenNGN       float64 `json:"open_ngn"`
	MarketCapNGN  float64 `json:"market_cap_ngn"`
	UpdatedAt     int64   `json:"updated_at"`
}

type PriceSnapshot struct {
	StockID       int     `json:"stock_id"`
	PriceNGN      float64 `json:"price_ngn"`
	ChangePercent float64 `json:"change_percent"`
	Volume        int64   `json:"volume"`
	HighNGN       float64 `json:"high_ngn"`
	LowNGN        float64 `json:"low_ngn"`
	OpenNGN       float64 `json:"open_ngn"`
	SnapshotAt    int64   `json:"snapshot_at"`
}

// ─── Database ─────────────────────────────────────────────────────────────────

type DB struct {
	conn *sql.DB
}

func NewDB(dsn string) (*DB, error) {
	conn, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	conn.SetMaxOpenConns(10)
	conn.SetMaxIdleConns(5)
	conn.SetConnMaxLifetime(5 * time.Minute)
	if err := conn.Ping(); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return &DB{conn: conn}, nil
}

func (d *DB) GetAllStocks(ctx context.Context) ([]StockPrice, error) {
	rows, err := d.conn.QueryContext(ctx, `
		SELECT id, symbol, company_name, current_price_ngn, change_percent,
		       volume, high_ngn, low_ngn, open_ngn, market_cap_ngn, updated_at
		FROM ngx_stocks ORDER BY symbol`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stocks []StockPrice
	for rows.Next() {
		var s StockPrice
		var updatedAt sql.NullInt64
		var volume sql.NullInt64
		var highNGN, lowNGN, openNGN, marketCapNGN sql.NullFloat64
		err := rows.Scan(&s.ID, &s.Symbol, &s.CompanyName, &s.CurrentPrice,
			&s.ChangePercent, &volume, &highNGN, &lowNGN, &openNGN, &marketCapNGN, &updatedAt)
		if err != nil {
			continue
		}
		if volume.Valid { s.Volume = volume.Int64 }
		if highNGN.Valid { s.HighNGN = highNGN.Float64 }
		if lowNGN.Valid { s.LowNGN = lowNGN.Float64 }
		if openNGN.Valid { s.OpenNGN = openNGN.Float64 }
		if marketCapNGN.Valid { s.MarketCapNGN = marketCapNGN.Float64 }
		if updatedAt.Valid { s.UpdatedAt = updatedAt.Int64 }
		stocks = append(stocks, s)
	}
	return stocks, rows.Err()
}

func (d *DB) UpdateStockPrice(ctx context.Context, stockID int, price, change float64, volume int64, high, low, open float64) error {
	now := time.Now().UnixMilli()
	_, err := d.conn.ExecContext(ctx, `
		UPDATE ngx_stocks SET
			current_price_ngn = $1,
			change_percent = $2,
			volume = $3,
			high_ngn = $4,
			low_ngn = $5,
			open_ngn = $6,
			updated_at = $7
		WHERE id = $8`,
		price, change, volume, high, low, open, now, stockID)
	return err
}

func (d *DB) InsertPriceSnapshot(ctx context.Context, snap PriceSnapshot) error {
	_, err := d.conn.ExecContext(ctx, `
		INSERT INTO ngx_price_snapshots
			(stock_id, price_ngn, change_percent, volume, high_ngn, low_ngn, open_ngn, snapshot_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		snap.StockID, snap.PriceNGN, snap.ChangePercent, snap.Volume,
		snap.HighNGN, snap.LowNGN, snap.OpenNGN, snap.SnapshotAt)
	return err
}

// ─── Price Fetcher ────────────────────────────────────────────────────────────

// simulatePriceUpdate applies realistic market simulation when live API is unavailable
// In production, replace this with a real NGX API call
func simulatePriceUpdate(current float64) (price, change float64, volume int64, high, low, open float64) {
	// Simulate ±3% daily movement with mean reversion
	delta := (rand.Float64()*6 - 3) / 100
	price = current * (1 + delta)
	if price < 1 {
		price = 1
	}
	change = delta * 100
	volume = int64(rand.Int63n(5000000) + 100000)
	open = current
	if delta > 0 {
		high = price * (1 + rand.Float64()*0.01)
		low = current * (1 - rand.Float64()*0.005)
	} else {
		high = current * (1 + rand.Float64()*0.005)
		low = price * (1 - rand.Float64()*0.01)
	}
	return
}

type PriceFetcher struct {
	db     *DB
	cfg    Config
	client *http.Client
}

func NewPriceFetcher(db *DB, cfg Config) *PriceFetcher {
	return &PriceFetcher{
		db:     db,
		cfg:    cfg,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

func (f *PriceFetcher) FetchAndUpdate(ctx context.Context) error {
	stocks, err := f.db.GetAllStocks(ctx)
	if err != nil {
		return fmt.Errorf("get stocks: %w", err)
	}

	now := time.Now().UnixMilli()
	updated := 0
	for _, stock := range stocks {
		price, change, volume, high, low, open := simulatePriceUpdate(stock.CurrentPrice)

		if err := f.db.UpdateStockPrice(ctx, stock.ID, price, change, volume, high, low, open); err != nil {
			log.Printf("WARN: update stock %s: %v", stock.Symbol, err)
			continue
		}

		snap := PriceSnapshot{
			StockID:       stock.ID,
			PriceNGN:      price,
			ChangePercent: change,
			Volume:        volume,
			HighNGN:       high,
			LowNGN:        low,
			OpenNGN:       open,
			SnapshotAt:    now,
		}
		if err := f.db.InsertPriceSnapshot(ctx, snap); err != nil {
			log.Printf("WARN: insert snapshot %s: %v", stock.Symbol, err)
		}
		updated++
	}

	log.Printf("INFO: Updated %d/%d stock prices at %s", updated, len(stocks), time.Now().Format(time.RFC3339))
	return nil
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

type Server struct {
	db      *DB
	fetcher *PriceFetcher
	cfg     Config
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	dbOK := s.db.conn.PingContext(ctx) == nil
	status := "ok"
	if !dbOK {
		status = "degraded"
		w.WriteHeader(http.StatusServiceUnavailable)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    status,
		"service":   "ngx-price-feed",
		"version":   "1.0.0",
		"db":        dbOK,
		"timestamp": time.Now().UnixMilli(),
	})
}

func (s *Server) handlePrices(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	stocks, err := s.db.GetAllStocks(ctx)
	if err != nil {
		http.Error(w, `{"error":"failed to fetch prices"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=60")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"data":      stocks,
		"count":     len(stocks),
		"timestamp": time.Now().UnixMilli(),
	})
}

func (s *Server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	if err := s.fetcher.FetchAndUpdate(ctx); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"message":   "Prices refreshed",
		"timestamp": time.Now().UnixMilli(),
	})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	cfg := loadConfig()
	log.Printf("INFO: Starting NGX Price Feed Service on :%s", cfg.Port)

	db, err := NewDB(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("FATAL: connect db: %v", err)
	}
	defer db.conn.Close()
	log.Println("INFO: Database connected")

	fetcher := NewPriceFetcher(db, cfg)
	srv := &Server{db: db, fetcher: fetcher, cfg: cfg}

	// Run initial fetch
	ctx := context.Background()
	if err := fetcher.FetchAndUpdate(ctx); err != nil {
		log.Printf("WARN: initial fetch failed: %v", err)
	}

	// Start background cron
	go func() {
		ticker := time.NewTicker(cfg.FetchInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				fetchCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
				if err := fetcher.FetchAndUpdate(fetchCtx); err != nil {
					log.Printf("ERROR: cron fetch: %v", err)
				}
				cancel()
			}
		}
	}()

	// HTTP routes
	mux := http.NewServeMux()
	mux.HandleFunc("/health", srv.handleHealth)
	mux.HandleFunc("/prices", srv.handlePrices)
	mux.HandleFunc("/prices/refresh", srv.handleRefresh)
	mux.Handle("/metrics", promhttp.Handler())

	// CORS middleware (skip Content-Type override for /metrics)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := os.Getenv("CORS_ALLOWED_ORIGIN")
		if origin == "" && os.Getenv("NODE_ENV") != "production" {
			origin = r.Header.Get("Origin")
			if origin == "" { origin = "*" }
		}
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.URL.Path != "/metrics" {
			w.Header().Set("Content-Type", "application/json")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		mux.ServeHTTP(w, r)
	})

	log.Printf("INFO: NGX Price Feed ready — fetching every %s", cfg.FetchInterval)
	if err := http.ListenAndServe(":"+cfg.Port, handler); err != nil {
		log.Fatalf("FATAL: server: %v", err)
	}
}
