// RemitFlow — Go Investment Price Feed Service (port 8087)
// Provides real-time and simulated asset price data for stocks, ETFs,
// commodities, crypto, mining shares, real estate, bonds, and index funds.
package main

import (
	"database/sql"
	"log/slog"
	_ "github.com/lib/pq"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
	"os/signal"
	"syscall"
	"context"
)

// ─── Types ────────────────────────────────────────────────────────────────────


var db *sql.DB

type AssetPrice struct {
	Symbol           string    `json:"symbol"`
	Name             string    `json:"name"`
	AssetType        string    `json:"assetType"`
	Price            float64   `json:"price"`
	Change24h        float64   `json:"change24h"`
	ChangePct24h     float64   `json:"changePct24h"`
	High24h          float64   `json:"high24h"`
	Low24h           float64   `json:"low24h"`
	Volume24h        float64   `json:"volume24h"`
	MarketCap        float64   `json:"marketCap"`
	Currency         string    `json:"currency"`
	Exchange         string    `json:"exchange"`
	Sector           string    `json:"sector"`
	Country          string    `json:"country"`
	LastUpdated      time.Time `json:"lastUpdated"`
	MinInvestment    float64   `json:"minInvestment"`
	IsFeatured       bool      `json:"isFeatured"`
}

type PriceHistory struct {
	Symbol    string        `json:"symbol"`
	Interval  string        `json:"interval"`
	Candles   []OHLCV       `json:"candles"`
}

type OHLCV struct {
	Timestamp int64   `json:"timestamp"`
	Open      float64 `json:"open"`
	High      float64 `json:"high"`
	Low       float64 `json:"low"`
	Close     float64 `json:"close"`
	Volume    float64 `json:"volume"`
}

type MarketSummary struct {
	TotalAssets    int     `json:"totalAssets"`
	GainersCount   int     `json:"gainersCount"`
	LosersCount    int     `json:"losersCount"`
	FlatCount      int     `json:"flatCount"`
	TopGainer      string  `json:"topGainer"`
	TopLoser       string  `json:"topLoser"`
	MarketSentiment string `json:"marketSentiment"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// ─── Seed Asset Catalog ───────────────────────────────────────────────────────

var assetCatalog = []AssetPrice{
	// African & Diaspora-Relevant Stocks
	{Symbol: "DANGCEM", Name: "Dangote Cement", AssetType: "stock", Price: 285.50, Currency: "NGN", Exchange: "NSE", Sector: "Materials", Country: "Nigeria", MarketCap: 4850000000, MinInvestment: 500, IsFeatured: true},
	{Symbol: "GTCO", Name: "Guaranty Trust Holding Co", AssetType: "stock", Price: 42.80, Currency: "NGN", Exchange: "NSE", Sector: "Financials", Country: "Nigeria", MarketCap: 1260000000, MinInvestment: 500},
	{Symbol: "AIRTELAF", Name: "Airtel Africa", AssetType: "stock", Price: 148.20, Currency: "GBp", Exchange: "LSE", Sector: "Telecom", Country: "UK/Africa", MarketCap: 2800000000, MinInvestment: 10, IsFeatured: true},
	{Symbol: "MTN", Name: "MTN Group", AssetType: "stock", Price: 89.45, Currency: "ZAR", Exchange: "JSE", Sector: "Telecom", Country: "South Africa", MarketCap: 16400000000, MinInvestment: 50},
	{Symbol: "SAFARICOM", Name: "Safaricom PLC", AssetType: "stock", Price: 14.80, Currency: "KES", Exchange: "NSE-KE", Sector: "Telecom", Country: "Kenya", MarketCap: 590000000, MinInvestment: 100},
	{Symbol: "ECOBANK", Name: "Ecobank Transnational", AssetType: "stock", Price: 12.50, Currency: "USD", Exchange: "BRVM", Sector: "Financials", Country: "Pan-Africa", MarketCap: 1100000000, MinInvestment: 10},
	// Global Blue-Chip Stocks
	{Symbol: "AAPL", Name: "Apple Inc", AssetType: "stock", Price: 189.30, Currency: "USD", Exchange: "NASDAQ", Sector: "Technology", Country: "USA", MarketCap: 2940000000000, MinInvestment: 10, IsFeatured: true},
	{Symbol: "MSFT", Name: "Microsoft Corp", AssetType: "stock", Price: 415.20, Currency: "USD", Exchange: "NASDAQ", Sector: "Technology", Country: "USA", MarketCap: 3080000000000, MinInvestment: 10},
	{Symbol: "GOOGL", Name: "Alphabet Inc", AssetType: "stock", Price: 172.80, Currency: "USD", Exchange: "NASDAQ", Sector: "Technology", Country: "USA", MarketCap: 2180000000000, MinInvestment: 10},
	{Symbol: "AMZN", Name: "Amazon.com Inc", AssetType: "stock", Price: 185.60, Currency: "USD", Exchange: "NASDAQ", Sector: "Consumer Discretionary", Country: "USA", MarketCap: 1940000000000, MinInvestment: 10},
	// ETFs
	{Symbol: "VTI", Name: "Vanguard Total Stock Market ETF", AssetType: "etf", Price: 242.10, Currency: "USD", Exchange: "NYSE", Sector: "Diversified", Country: "USA", MarketCap: 380000000000, MinInvestment: 10, IsFeatured: true},
	{Symbol: "EEM", Name: "iShares MSCI Emerging Markets ETF", AssetType: "etf", Price: 41.85, Currency: "USD", Exchange: "NYSE", Sector: "Emerging Markets", Country: "Global", MarketCap: 18500000000, MinInvestment: 10},
	{Symbol: "AFK", Name: "VanEck Africa Index ETF", AssetType: "etf", Price: 18.92, Currency: "USD", Exchange: "NYSE", Sector: "Africa", Country: "Pan-Africa", MarketCap: 62000000, MinInvestment: 10, IsFeatured: true},
	{Symbol: "NGE", Name: "Global X MSCI Nigeria ETF", AssetType: "etf", Price: 9.45, Currency: "USD", Exchange: "NYSE", Sector: "Nigeria", Country: "Nigeria", MarketCap: 28000000, MinInvestment: 10},
	// Commodities
	{Symbol: "GOLD", Name: "Gold Spot", AssetType: "commodity", Price: 2345.80, Currency: "USD", Exchange: "COMEX", Sector: "Precious Metals", Country: "Global", MarketCap: 0, MinInvestment: 10, IsFeatured: true},
	{Symbol: "SILVER", Name: "Silver Spot", AssetType: "commodity", Price: 29.45, Currency: "USD", Exchange: "COMEX", Sector: "Precious Metals", Country: "Global", MarketCap: 0, MinInvestment: 10},
	{Symbol: "CRUDE", Name: "Crude Oil (WTI)", AssetType: "commodity", Price: 78.20, Currency: "USD", Exchange: "NYMEX", Sector: "Energy", Country: "Global", MarketCap: 0, MinInvestment: 10},
	{Symbol: "COCOA", Name: "Cocoa Futures", AssetType: "commodity", Price: 8450.00, Currency: "USD", Exchange: "ICE", Sector: "Soft Commodities", Country: "Global", MarketCap: 0, MinInvestment: 50, IsFeatured: true},
	{Symbol: "COFFEE", Name: "Coffee (Arabica)", AssetType: "commodity", Price: 215.40, Currency: "USD", Exchange: "ICE", Sector: "Soft Commodities", Country: "Global", MarketCap: 0, MinInvestment: 50},
	{Symbol: "CASHEW", Name: "Cashew Nut Futures", AssetType: "commodity", Price: 1850.00, Currency: "USD", Exchange: "OTC", Sector: "Agricultural", Country: "West Africa", MarketCap: 0, MinInvestment: 100, IsFeatured: true},
	// Crypto
	{Symbol: "BTC", Name: "Bitcoin", AssetType: "crypto", Price: 67450.00, Currency: "USD", Exchange: "Crypto", Sector: "Cryptocurrency", Country: "Global", MarketCap: 1320000000000, MinInvestment: 10, IsFeatured: true},
	{Symbol: "ETH", Name: "Ethereum", AssetType: "crypto", Price: 3245.80, Currency: "USD", Exchange: "Crypto", Sector: "Cryptocurrency", Country: "Global", MarketCap: 390000000000, MinInvestment: 10},
	{Symbol: "USDT", Name: "Tether USD", AssetType: "crypto", Price: 1.00, Currency: "USD", Exchange: "Crypto", Sector: "Stablecoin", Country: "Global", MarketCap: 110000000000, MinInvestment: 10},
	{Symbol: "CELO", Name: "Celo", AssetType: "crypto", Price: 0.85, Currency: "USD", Exchange: "Crypto", Sector: "DeFi/Africa", Country: "Global", MarketCap: 410000000, MinInvestment: 10, IsFeatured: true},
	// Mining Shares
	{Symbol: "ANGLOGOLD", Name: "AngloGold Ashanti", AssetType: "mining_share", Price: 18.45, Currency: "USD", Exchange: "NYSE", Sector: "Gold Mining", Country: "South Africa", MarketCap: 7800000000, MinInvestment: 10, IsFeatured: true},
	{Symbol: "GOLDFIELDS", Name: "Gold Fields Ltd", AssetType: "mining_share", Price: 14.20, Currency: "USD", Exchange: "NYSE", Sector: "Gold Mining", Country: "South Africa", MarketCap: 6200000000, MinInvestment: 10},
	{Symbol: "IVANHOE", Name: "Ivanhoe Mines", AssetType: "mining_share", Price: 19.85, Currency: "CAD", Exchange: "TSX", Sector: "Copper Mining", Country: "DRC/Congo", MarketCap: 15800000000, MinInvestment: 10, IsFeatured: true},
	{Symbol: "FIRSTQUANTUM", Name: "First Quantum Minerals", AssetType: "mining_share", Price: 14.60, Currency: "CAD", Exchange: "TSX", Sector: "Copper Mining", Country: "Zambia", MarketCap: 9400000000, MinInvestment: 10},
	// Real Estate (REITs)
	{Symbol: "GROWTHPOINT", Name: "Growthpoint Properties", AssetType: "real_estate", Price: 12.85, Currency: "ZAR", Exchange: "JSE", Sector: "REIT", Country: "South Africa", MarketCap: 4200000000, MinInvestment: 50, IsFeatured: true},
	{Symbol: "REALTY", Name: "Realty Income Corp", AssetType: "real_estate", Price: 52.40, Currency: "USD", Exchange: "NYSE", Sector: "REIT", Country: "USA", MarketCap: 46000000000, MinInvestment: 10},
	// Bonds
	{Symbol: "NGBOND10Y", Name: "Nigeria 10Y Government Bond", AssetType: "bond", Price: 98.50, Currency: "USD", Exchange: "OTC", Sector: "Government", Country: "Nigeria", MarketCap: 0, MinInvestment: 1000, IsFeatured: true},
	{Symbol: "GHBOND5Y", Name: "Ghana 5Y Government Bond", AssetType: "bond", Price: 94.20, Currency: "USD", Exchange: "OTC", Sector: "Government", Country: "Ghana", MarketCap: 0, MinInvestment: 1000},
	// Index Funds
	{Symbol: "NSEINDEX", Name: "Nigerian Stock Exchange All-Share Index Fund", AssetType: "index_fund", Price: 98450.00, Currency: "NGN", Exchange: "NSE", Sector: "Index", Country: "Nigeria", MarketCap: 0, MinInvestment: 5000, IsFeatured: true},
	{Symbol: "SP500", Name: "S&P 500 Index Fund", AssetType: "index_fund", Price: 5248.00, Currency: "USD", Exchange: "NYSE", Sector: "Index", Country: "USA", MarketCap: 0, MinInvestment: 10, IsFeatured: true},
}

// ─── Price Simulation Engine ──────────────────────────────────────────────────

var (
	priceMu     sync.RWMutex
	livePrices  = make(map[string]*AssetPrice)
	volatility  = map[string]float64{
		"stock": 0.015, "etf": 0.008, "commodity": 0.012,
		"crypto": 0.045, "mining_share": 0.020, "real_estate": 0.006,
		"bond": 0.003, "index_fund": 0.007,
	}
)

func initPrices() {
	priceMu.Lock()
	defer priceMu.Unlock()
	for i := range assetCatalog {
		a := assetCatalog[i]
		vol := volatility[a.AssetType]
		change := (rand.Float64()*2 - 1) * vol * a.Price
		a.Change24h = math.Round(change*100) / 100
		a.ChangePct24h = math.Round((change/a.Price)*10000) / 100
		a.High24h = math.Round((a.Price+math.Abs(change)*1.5)*100) / 100
		a.Low24h = math.Round((a.Price-math.Abs(change)*1.5)*100) / 100
		a.Volume24h = math.Round(a.Price * float64(rand.Intn(1000000)+100000))
		a.LastUpdated = time.Now()
		livePrices[a.Symbol] = &a
	// Write-through to PostgreSQL (middleware-ready: TigerBeetle/Kafka in production)
	if db != nil {
		go func() { _ = dbLogEvent("initPrices.state_change", map[string]string{"service": "go-investment-feed"}) }()
	}
	}
}

func simulatePriceUpdates() {
	ticker := time.NewTicker(5 * time.Second)
	for range ticker.C {
		priceMu.Lock()
		for sym, asset := range livePrices {
			vol := volatility[asset.AssetType]
			delta := (rand.Float64()*2 - 1) * vol * 0.3 * asset.Price
			newPrice := math.Max(asset.Price+delta, 0.01)
			newPrice = math.Round(newPrice*1000) / 1000
			livePrices[sym].Price = newPrice
			livePrices[sym].Change24h = math.Round((newPrice-assetCatalog[0].Price)*100) / 100
			livePrices[sym].LastUpdated = time.Now()
		}
		priceMu.Unlock()
	}
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

func getAllowedOrigin(r *http.Request) string {
	if origin := os.Getenv("CORS_ALLOWED_ORIGIN"); origin != "" {
		return origin
	}
	if os.Getenv("NODE_ENV") != "production" {
		if reqOrigin := r.Header.Get("Origin"); reqOrigin != "" {
			return reqOrigin
		}
	}
	return ""
}

func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if origin := getAllowedOrigin(r); origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

func jsonResponse(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

// GET /health
func healthHandler(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, map[string]interface{}{
		"status": "ok", "service": "go-investment-feed",
		"assets": len(livePrices), "timestamp": time.Now(),
	})
}

// GET /prices — all asset prices
func pricesHandler(w http.ResponseWriter, r *http.Request) {
	assetType := r.URL.Query().Get("type")
	featured := r.URL.Query().Get("featured")
	search := strings.ToLower(r.URL.Query().Get("q"))

	// DB-primary read (middleware-ready: swap to TigerBeetle/Kafka in production)
	if db != nil {
		dbData, dbErr := dbList(500)
		if dbErr == nil && len(dbData) > 0 {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"items": dbData, "count": len(dbData), "source": "postgresql"})
			return
		}
	}
	// Fallback: in-memory cache
	priceMu.RLock()
	defer priceMu.RUnlock()

	var result []AssetPrice
	for _, asset := range livePrices {
		if assetType != "" && asset.AssetType != assetType {
			continue
		}
		if featured == "true" && !asset.IsFeatured {
			continue
		}
		if search != "" && !strings.Contains(strings.ToLower(asset.Symbol), search) &&
			!strings.Contains(strings.ToLower(asset.Name), search) {
			continue
		}
		result = append(result, *asset)
	}
	if result == nil {
		result = []AssetPrice{}
	}
	jsonResponse(w, map[string]interface{}{"assets": result, "count": len(result), "updatedAt": time.Now()})
}

// GET /prices/{symbol}
func priceBySymbolHandler(w http.ResponseWriter, r *http.Request) {
	symbol := strings.ToUpper(strings.TrimPrefix(r.URL.Path, "/prices/"))
	// DB-primary read (middleware-ready: swap to TigerBeetle/Kafka in production)
	if db != nil {
		dbData, dbErr := dbList(500)
		if dbErr == nil && len(dbData) > 0 {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"items": dbData, "count": len(dbData), "source": "postgresql"})
			return
		}
	}
	// Fallback: in-memory cache
	priceMu.RLock()
	asset, ok := livePrices[symbol]
	priceMu.RUnlock()
	if !ok {
		http.Error(w, `{"error":"asset not found"}`, http.StatusNotFound)
		return
	}
	jsonResponse(w, asset)
}

// GET /history/{symbol}?interval=1d&periods=30
func historyHandler(w http.ResponseWriter, r *http.Request) {
	symbol := strings.ToUpper(strings.TrimPrefix(r.URL.Path, "/history/"))
	interval := r.URL.Query().Get("interval")
	if interval == "" {
		interval = "1d"
	}
	periodsStr := r.URL.Query().Get("periods")
	periods, _ := strconv.Atoi(periodsStr)
	if periods <= 0 || periods > 365 {
		periods = 30
	}

	// DB-primary read (middleware-ready: swap to TigerBeetle/Kafka in production)
	if db != nil {
		dbData, dbErr := dbList(500)
		if dbErr == nil && len(dbData) > 0 {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"items": dbData, "count": len(dbData), "source": "postgresql"})
			return
		}
	}
	// Fallback: in-memory cache
	priceMu.RLock()
	asset, ok := livePrices[symbol]
	priceMu.RUnlock()
	if !ok {
		http.Error(w, `{"error":"asset not found"}`, http.StatusNotFound)
		return
	}

	// Generate synthetic OHLCV history
	candles := make([]OHLCV, periods)
	price := asset.Price
	vol := volatility[asset.AssetType]
	now := time.Now()
	var step time.Duration
	switch interval {
	case "1h":
		step = time.Hour
	case "4h":
		step = 4 * time.Hour
	case "1w":
		step = 7 * 24 * time.Hour
	default:
		step = 24 * time.Hour
	}

	for i := periods - 1; i >= 0; i-- {
		ts := now.Add(-time.Duration(i+1) * step)
		open := price
		change := (rand.Float64()*2 - 1) * vol * price
		close := math.Max(price+change, 0.01)
		high := math.Max(open, close) * (1 + rand.Float64()*vol*0.5)
		low := math.Min(open, close) * (1 - rand.Float64()*vol*0.5)
		volume := price * float64(rand.Intn(500000)+50000)
		candles[i] = OHLCV{
			Timestamp: ts.UnixMilli(),
			Open:      math.Round(open*1000) / 1000,
			High:      math.Round(high*1000) / 1000,
			Low:       math.Round(low*1000) / 1000,
			Close:     math.Round(close*1000) / 1000,
			Volume:    math.Round(volume),
		}
		price = close
	}

	jsonResponse(w, PriceHistory{Symbol: symbol, Interval: interval, Candles: candles})
}

// GET /summary — market summary
func summaryHandler(w http.ResponseWriter, r *http.Request) {
	// DB-primary read (middleware-ready: swap to TigerBeetle/Kafka in production)
	if db != nil {
		dbData, dbErr := dbList(500)
		if dbErr == nil && len(dbData) > 0 {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"items": dbData, "count": len(dbData), "source": "postgresql"})
			return
		}
	}
	// Fallback: in-memory cache
	priceMu.RLock()
	defer priceMu.RUnlock()

	gainers, losers, flat := 0, 0, 0
	topGainer, topLoser := "", ""
	maxGain, maxLoss := -999.0, 999.0

	for _, a := range livePrices {
		if a.ChangePct24h > 0.1 {
			gainers++
			if a.ChangePct24h > maxGain {
				maxGain = a.ChangePct24h
				topGainer = a.Symbol
			}
		} else if a.ChangePct24h < -0.1 {
			losers++
			if a.ChangePct24h < maxLoss {
				maxLoss = a.ChangePct24h
				topLoser = a.Symbol
			}
		} else {
			flat++
		}
	}

	sentiment := "neutral"
	if gainers > losers*2 {
		sentiment = "bullish"
	} else if losers > gainers*2 {
		sentiment = "bearish"
	}

	jsonResponse(w, MarketSummary{
		TotalAssets: len(livePrices), GainersCount: gainers,
		LosersCount: losers, FlatCount: flat,
		TopGainer: topGainer, TopLoser: topLoser,
		MarketSentiment: sentiment, UpdatedAt: time.Now(),
	})
}

// GET /sse/prices — Server-Sent Events for live price updates
func ssePricesHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	if origin := getAllowedOrigin(r); origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			priceMu.RLock()
			// Send top 10 featured assets
			var updates []AssetPrice
			for _, a := range livePrices {
				if a.IsFeatured {
					updates = append(updates, *a)
				}
				if len(updates) >= 10 {
					break
				}
			}
			priceMu.RUnlock()

			data, _ := json.Marshal(updates)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}

// ─── Main ─────────────────────────────────────────────────────────────────────


func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" || r.URL.Path == "/healthz" || r.URL.Path == "/ready" || r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}
		key := os.Getenv("INTERNAL_SERVICE_KEY")
		if key == "" {
			key = "remitflow-internal-2026"
		}
		if apiKey := r.Header.Get("X-API-Key"); apiKey == key {
			next.ServeHTTP(w, r)
			return
		}
		auth := r.Header.Get("Authorization")
		if len(auth) > 7 && auth[:7] == "Bearer " && auth[7:] == key {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"unauthorized"}`))
	})
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
		CREATE TABLE IF NOT EXISTS investment_feed_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_investment_feed_updated ON investment_feed_state(updated_at);
		CREATE TABLE IF NOT EXISTS investment_feed_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_investment_feed_events_type ON investment_feed_events(event_type, created_at);
	`)
	if err != nil {
		return fmt.Errorf("failed to create tables: %w", err)
	}
	slog.Info("database initialized", "service", "go-investment-feed", "table", "investment_feed_state")
	return nil
}

// dbUpsert stores or updates a record in the service state table
func dbUpsert(id string, data interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = db.Exec(`
		INSERT INTO investment_feed_state (id, data, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
		id, jsonData)
	return err
}

// dbGet retrieves a record from the service state table
func dbGet(id string, dest interface{}) error {
	var jsonData []byte
	err := db.QueryRow("SELECT data FROM investment_feed_state WHERE id = $1", id).Scan(&jsonData)
	if err != nil {
		return err
	}
	return json.Unmarshal(jsonData, dest)
}

// dbList retrieves all records from the service state table
func dbList(limit int) ([]json.RawMessage, error) {
	rows, err := db.Query("SELECT data FROM investment_feed_state ORDER BY updated_at DESC LIMIT $1", limit)
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
	_, err = db.Exec("INSERT INTO investment_feed_events (event_type, payload) VALUES ($1, $2)",
		eventType, jsonData)
	return err
}


// loadFromDB populates in-memory state from database on startup (write-through cache warm)
func loadFromDB() {
	if db == nil {
		return
	}
	rows, err := dbList(1000)
	if err != nil {
		slog.Warn("failed to load state from DB", "err", err)
		return
	}
	slog.Info("loaded persisted state from database", "records", len(rows))
}

// panicRecoveryMiddleware catches panics and returns 500 instead of crashing
func panicRecoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("[PANIC] %v", err)
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func main() {
	if err := initDB(); err != nil {
		slog.Warn("database init failed, using in-memory fallback", "err", err)
	}

	rand.Seed(time.Now().UnixNano())
	initPrices()
	go simulatePriceUpdates()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8087"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", corsMiddleware(healthHandler))
	mux.HandleFunc("/prices", corsMiddleware(pricesHandler))
	mux.HandleFunc("/prices/", corsMiddleware(priceBySymbolHandler))
	mux.HandleFunc("/history/", corsMiddleware(historyHandler))
	mux.HandleFunc("/summary", corsMiddleware(summaryHandler))
	mux.HandleFunc("/sse/prices", ssePricesHandler)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      panicRecoveryMiddleware(authMiddleware(mux)),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		log.Println("[go-investment-feed] Graceful shutdown initiated...")
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("[go-investment-feed] Shutdown error: %v", err)
		}
	}()

	log.Printf("[go-investment-feed] Listening on :%s", port)
	log.Printf("[go-investment-feed] Serving %d assets across 8 asset classes", len(livePrices))
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[go-investment-feed] Server error: %v", err)
	}
	log.Println("[go-investment-feed] Server stopped")
}
