// RemitFlow Corridor Pricing Engine — Go microservice
// Calculates fees, spreads, and pricing for remittance corridors
// REST API: GET /corridors, POST /quote, GET /health
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ─── Config ──────────────────────────────────────────────────────────────────

func getEnvOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ─── Corridor Models ─────────────────────────────────────────────────────────

type Corridor struct {
	ID              string  `json:"id"`
	SourceCountry   string  `json:"source_country"`
	DestCountry     string  `json:"dest_country"`
	SourceCurrency  string  `json:"source_currency"`
	DestCurrency    string  `json:"dest_currency"`
	MinAmountUSD    float64 `json:"min_amount_usd"`
	MaxAmountUSD    float64 `json:"max_amount_usd"`
	BaseFeeUSD      float64 `json:"base_fee_usd"`
	FeePercent      float64 `json:"fee_percent"`
	SpreadPercent   float64 `json:"spread_percent"`
	DeliveryMinutes int     `json:"delivery_minutes"`
	Active          bool    `json:"active"`
}

type QuoteRequest struct {
	SourceCurrency string  `json:"source_currency"`
	DestCurrency   string  `json:"dest_currency"`
	AmountUSD      float64 `json:"amount_usd"`
	AmountSource   float64 `json:"amount_source"`
}

type QuoteResponse struct {
	CorridorID        string  `json:"corridor_id"`
	SourceCurrency    string  `json:"source_currency"`
	DestCurrency      string  `json:"dest_currency"`
	SendAmountUSD     float64 `json:"send_amount_usd"`
	ReceiveAmount     float64 `json:"receive_amount"`
	ReceiveCurrency   string  `json:"receive_currency"`
	FeeUSD            float64 `json:"fee_usd"`
	FeePercent        float64 `json:"fee_percent"`
	ExchangeRate      float64 `json:"exchange_rate"`
	SpreadPercent     float64 `json:"spread_percent"`
	DeliveryMinutes   int     `json:"delivery_minutes"`
	ExpiresAt         int64   `json:"expires_at"`
	QuoteID           string  `json:"quote_id"`
}

// ─── Corridor Registry ────────────────────────────────────────────────────────

// FX rates (mid-market, updated periodically in production)
var fxRates = map[string]float64{
	"USD": 1.0,
	"NGN": 1580.0,
	"GHS": 15.2,
	"KES": 129.5,
	"ZAR": 18.7,
	"GBP": 0.79,
	"EUR": 0.92,
	"CAD": 1.36,
	"AUD": 1.53,
	"XOF": 603.5,
	"XAF": 603.5,
	"TZS": 2580.0,
	"UGX": 3750.0,
	"RWF": 1310.0,
	"ETB": 56.5,
	"SEN": 603.5,
	"MAD": 9.95,
	"EGP": 30.9,
	"INR": 83.2,
	"PHP": 56.1,
	"MXN": 17.1,
}

var corridors = []Corridor{
	{ID: "US-NG", SourceCountry: "US", DestCountry: "NG", SourceCurrency: "USD", DestCurrency: "NGN", MinAmountUSD: 10, MaxAmountUSD: 10000, BaseFeeUSD: 2.99, FeePercent: 0.5, SpreadPercent: 1.2, DeliveryMinutes: 15, Active: true},
	{ID: "GB-NG", SourceCountry: "GB", DestCountry: "NG", SourceCurrency: "GBP", DestCurrency: "NGN", MinAmountUSD: 10, MaxAmountUSD: 10000, BaseFeeUSD: 2.49, FeePercent: 0.4, SpreadPercent: 1.0, DeliveryMinutes: 15, Active: true},
	{ID: "CA-NG", SourceCountry: "CA", DestCountry: "NG", SourceCurrency: "CAD", DestCurrency: "NGN", MinAmountUSD: 10, MaxAmountUSD: 10000, BaseFeeUSD: 3.49, FeePercent: 0.6, SpreadPercent: 1.3, DeliveryMinutes: 30, Active: true},
	{ID: "US-GH", SourceCountry: "US", DestCountry: "GH", SourceCurrency: "USD", DestCurrency: "GHS", MinAmountUSD: 10, MaxAmountUSD: 5000, BaseFeeUSD: 2.99, FeePercent: 0.5, SpreadPercent: 1.2, DeliveryMinutes: 15, Active: true},
	{ID: "GB-GH", SourceCountry: "GB", DestCountry: "GH", SourceCurrency: "GBP", DestCurrency: "GHS", MinAmountUSD: 10, MaxAmountUSD: 5000, BaseFeeUSD: 2.49, FeePercent: 0.4, SpreadPercent: 1.0, DeliveryMinutes: 15, Active: true},
	{ID: "US-KE", SourceCountry: "US", DestCountry: "KE", SourceCurrency: "USD", DestCurrency: "KES", MinAmountUSD: 10, MaxAmountUSD: 5000, BaseFeeUSD: 2.99, FeePercent: 0.5, SpreadPercent: 1.1, DeliveryMinutes: 10, Active: true},
	{ID: "US-ZA", SourceCountry: "US", DestCountry: "ZA", SourceCurrency: "USD", DestCurrency: "ZAR", MinAmountUSD: 10, MaxAmountUSD: 10000, BaseFeeUSD: 3.49, FeePercent: 0.6, SpreadPercent: 1.4, DeliveryMinutes: 30, Active: true},
	{ID: "EU-NG", SourceCountry: "EU", DestCountry: "NG", SourceCurrency: "EUR", DestCurrency: "NGN", MinAmountUSD: 10, MaxAmountUSD: 10000, BaseFeeUSD: 2.49, FeePercent: 0.4, SpreadPercent: 1.1, DeliveryMinutes: 20, Active: true},
	{ID: "US-SN", SourceCountry: "US", DestCountry: "SN", SourceCurrency: "USD", DestCurrency: "XOF", MinAmountUSD: 10, MaxAmountUSD: 5000, BaseFeeUSD: 3.99, FeePercent: 0.7, SpreadPercent: 1.5, DeliveryMinutes: 30, Active: true},
	{ID: "US-ET", SourceCountry: "US", DestCountry: "ET", SourceCurrency: "USD", DestCurrency: "ETB", MinAmountUSD: 10, MaxAmountUSD: 5000, BaseFeeUSD: 3.99, FeePercent: 0.7, SpreadPercent: 1.5, DeliveryMinutes: 45, Active: true},
}

// ─── Pricing Engine ───────────────────────────────────────────────────────────

func findCorridor(src, dst string) *Corridor {
	src = strings.ToUpper(src)
	dst = strings.ToUpper(dst)
	for i := range corridors {
		c := &corridors[i]
		if c.SourceCurrency == src && c.DestCurrency == dst && c.Active {
			return c
		}
	}
	return nil
}

func calculateFee(corridor *Corridor, amountUSD float64) float64 {
	percentFee := amountUSD * corridor.FeePercent / 100
	total := corridor.BaseFeeUSD + percentFee
	// Cap fee at 5% of amount
	maxFee := amountUSD * 0.05
	if total > maxFee {
		total = maxFee
	}
	return math.Round(total*100) / 100
}

func getExchangeRate(src, dst string) (float64, bool) {
	srcRate, srcOK := fxRates[strings.ToUpper(src)]
	dstRate, dstOK := fxRates[strings.ToUpper(dst)]
	if !srcOK || !dstOK {
		return 0, false
	}
	// Apply spread
	return dstRate / srcRate, true
}

func generateQuoteID() string {
	return fmt.Sprintf("QT-%d", time.Now().UnixNano())
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "ok",
		"service":   "corridor-pricing",
		"version":   "1.0.0",
		"corridors": len(corridors),
		"timestamp": time.Now().UnixMilli(),
	})
}

func handleCorridors(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"data":  corridors,
		"count": len(corridors),
	})
}

func handleQuote(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req QuoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	corridor := findCorridor(req.SourceCurrency, req.DestCurrency)
	if corridor == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{
			"error":   "corridor_not_found",
			"message": fmt.Sprintf("No active corridor found for %s → %s", req.SourceCurrency, req.DestCurrency),
		})
		return
	}

	// Determine USD amount
	amountUSD := req.AmountUSD
	if amountUSD == 0 && req.AmountSource > 0 {
		srcRate, ok := fxRates[strings.ToUpper(req.SourceCurrency)]
		if ok && srcRate > 0 {
			amountUSD = req.AmountSource / srcRate
		}
	}

	if amountUSD < corridor.MinAmountUSD {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":   "amount_too_low",
			"message": fmt.Sprintf("Minimum amount is $%.2f USD", corridor.MinAmountUSD),
		})
		return
	}
	if amountUSD > corridor.MaxAmountUSD {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":   "amount_too_high",
			"message": fmt.Sprintf("Maximum amount is $%.2f USD", corridor.MaxAmountUSD),
		})
		return
	}

	feeUSD := calculateFee(corridor, amountUSD)
	netAmountUSD := amountUSD - feeUSD

	midRate, ok := getExchangeRate("USD", req.DestCurrency)
	if !ok {
		http.Error(w, `{"error":"exchange_rate_unavailable"}`, http.StatusInternalServerError)
		return
	}

	// Apply spread
	spreadFactor := 1 - corridor.SpreadPercent/100
	effectiveRate := midRate * spreadFactor

	receiveAmount := math.Round(netAmountUSD*effectiveRate*100) / 100

	quote := QuoteResponse{
		CorridorID:      corridor.ID,
		SourceCurrency:  req.SourceCurrency,
		DestCurrency:    req.DestCurrency,
		SendAmountUSD:   amountUSD,
		ReceiveAmount:   receiveAmount,
		ReceiveCurrency: req.DestCurrency,
		FeeUSD:          feeUSD,
		FeePercent:      corridor.FeePercent,
		ExchangeRate:    effectiveRate,
		SpreadPercent:   corridor.SpreadPercent,
		DeliveryMinutes: corridor.DeliveryMinutes,
		ExpiresAt:       time.Now().Add(5 * time.Minute).UnixMilli(),
		QuoteID:         generateQuoteID(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(quote)
}

func handleFXRates(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=60")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"rates":     fxRates,
		"base":      "USD",
		"timestamp": time.Now().UnixMilli(),
	})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	port := getEnvOrDefault("PORT", "8083")
	log.Printf("INFO: Starting Corridor Pricing Engine on :%s", port)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/corridors", handleCorridors)
	mux.HandleFunc("/quote", handleQuote)
	mux.HandleFunc("/fx-rates", handleFXRates)
	mux.Handle("/metrics", promhttp.Handler())

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		mux.ServeHTTP(w, r)
	})

	log.Printf("INFO: Corridor Pricing Engine ready — %d corridors loaded", len(corridors))
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatalf("FATAL: server: %v", err)
	}
}
