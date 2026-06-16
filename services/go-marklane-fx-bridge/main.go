// go-marklane-fx-bridge — FX Liquidity Bridge between Mark Lane and RemitFlow
//
// Aggregates FX rates from Mark Lane (CAD on-ramp) and RemitFlow's African
// corridor rates, computing optimal routing for CAD→Africa transfers.
//
// Middleware: Kafka (rate events), Dapr (state store), Redis (rate cache),
// Prometheus (metrics), TigerBeetle (ledger entry proxy).
//
// Port: 8128

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ─── Configuration ───────────────────────────────────────────────────────────

type Config struct {
	Port              string
	MarkLaneAPIURL    string
	MarkLaneAPIKey    string
	RemitFlowAPIURL   string
	KafkaBroker       string
	DaprURL           string
	RedisURL          string
	RateCacheTTL      time.Duration
	CircuitBreakerMax int
}

func loadConfig() Config {
	return Config{
		Port:              envOr("PORT", "8128"),
		MarkLaneAPIURL:    envOr("MARKLANE_API_URL", "https://api.marklane.io/v1"),
		MarkLaneAPIKey:    envOr("MARKLANE_API_KEY", ""),
		RemitFlowAPIURL:   envOr("REMITFLOW_API_URL", "http://localhost:3001"),
		KafkaBroker:       envOr("KAFKA_BROKER", "localhost:9092"),
		DaprURL:           envOr("DAPR_URL", "http://localhost:3500"),
		RedisURL:          envOr("REDIS_URL", "localhost:6379"),
		RateCacheTTL:      30 * time.Second,
		CircuitBreakerMax: 5,
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Types ───────────────────────────────────────────────────────────────────

type FXRate struct {
	Pair      string    `json:"pair"`
	Bid       float64   `json:"bid"`
	Ask       float64   `json:"ask"`
	Mid       float64   `json:"mid"`
	Spread    float64   `json:"spread"`
	Source    string    `json:"source"`
	Timestamp time.Time `json:"timestamp"`
}

type CompositeQuote struct {
	QuoteID          string    `json:"quoteId"`
	FromCurrency     string    `json:"fromCurrency"`
	ToCurrency       string    `json:"toCurrency"`
	SendAmount       float64   `json:"sendAmount"`
	ReceiveAmount    float64   `json:"receiveAmount"`
	MarkLaneRate     float64   `json:"markLaneRate"`
	RemitFlowRate    float64   `json:"remitFlowRate"`
	CompositeRate    float64   `json:"compositeRate"`
	MarkLaneFee      float64   `json:"markLaneFee"`
	RemitFlowFee     float64   `json:"remitFlowFee"`
	TotalFee         float64   `json:"totalFee"`
	MarkLaneSpread   float64   `json:"markLaneSpread"`
	RemitFlowSpread  float64   `json:"remitFlowSpread"`
	BestRoute        string    `json:"bestRoute"`
	ExpiresAt        time.Time `json:"expiresAt"`
	CreatedAt        time.Time `json:"createdAt"`
}

type CorridorRoute struct {
	CorridorID    string  `json:"corridorId"`
	FromCurrency  string  `json:"fromCurrency"`
	ToCurrency    string  `json:"toCurrency"`
	IntermediateFX string `json:"intermediateFx"`
	Rail          string  `json:"rail"`
	DeliveryTime  string  `json:"deliveryTime"`
	EstimatedFee  float64 `json:"estimatedFee"`
}

type NostroPosition struct {
	Currency    string    `json:"currency"`
	MarkLane    float64   `json:"markLane"`
	RemitFlow   float64   `json:"remitFlow"`
	Net         float64   `json:"net"`
	LastUpdated time.Time `json:"lastUpdated"`
}

type SettlementInstruction struct {
	InstructionID string    `json:"instructionId"`
	FromPartner   string    `json:"fromPartner"`
	ToPartner     string    `json:"toPartner"`
	Currency      string    `json:"currency"`
	Amount        float64   `json:"amount"`
	Reason        string    `json:"reason"`
	DueDate       time.Time `json:"dueDate"`
	Status        string    `json:"status"`
	CreatedAt     time.Time `json:"createdAt"`
}

// ─── Prometheus Metrics ──────────────────────────────────────────────────────

var (
	fxQuotesTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "marklane_fx_quotes_total",
			Help: "Total composite FX quotes generated",
		},
		[]string{"corridor", "route"},
	)
	fxQuoteLatency = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "marklane_fx_quote_latency_seconds",
			Help:    "Latency of composite FX quote generation",
			Buckets: []float64{0.01, 0.05, 0.1, 0.25, 0.5, 1.0},
		},
		[]string{"corridor"},
	)
	rateRefreshErrors = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "marklane_rate_refresh_errors_total",
			Help: "Rate refresh failures by source",
		},
		[]string{"source"},
	)
	nostroImbalance = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "marklane_nostro_imbalance",
			Help: "Nostro position imbalance between Mark Lane and RemitFlow",
		},
		[]string{"currency"},
	)
	settlementsPending = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "marklane_settlements_pending",
			Help: "Number of pending settlement instructions",
		},
	)
)

func init() {
	prometheus.MustRegister(fxQuotesTotal, fxQuoteLatency, rateRefreshErrors,
		nostroImbalance, settlementsPending)
}

// ─── Circuit Breaker ─────────────────────────────────────────────────────────

type CircuitBreaker struct {
	mu         sync.Mutex
	failures   int
	maxFails   int
	state      string // closed, open, half_open
	lastFail   time.Time
	resetAfter time.Duration
}

func NewCircuitBreaker(maxFails int) *CircuitBreaker {
	return &CircuitBreaker{
		maxFails:   maxFails,
		state:      "closed",
		resetAfter: 30 * time.Second,
	}
}

func (cb *CircuitBreaker) Execute(fn func() error) error {
	cb.mu.Lock()
	if cb.state == "open" {
		if time.Since(cb.lastFail) > cb.resetAfter {
			cb.state = "half_open"
		} else {
			cb.mu.Unlock()
			return fmt.Errorf("circuit breaker open")
		}
	}
	cb.mu.Unlock()

	err := fn()

	cb.mu.Lock()
	defer cb.mu.Unlock()
	if err != nil {
		cb.failures++
		cb.lastFail = time.Now()
		if cb.failures >= cb.maxFails {
			cb.state = "open"
		}
		return err
	}

	cb.failures = 0
	cb.state = "closed"
	return nil
}

// ─── Rate Cache ──────────────────────────────────────────────────────────────

type RateCache struct {
	mu    sync.RWMutex
	rates map[string]FXRate
	ttl   time.Duration
}

func NewRateCache(ttl time.Duration) *RateCache {
	return &RateCache{
		rates: make(map[string]FXRate),
		ttl:   ttl,
	}
}

func (rc *RateCache) Get(pair string) (FXRate, bool) {
	rc.mu.RLock()
	defer rc.mu.RUnlock()
	rate, ok := rc.rates[pair]
	if !ok || time.Since(rate.Timestamp) > rc.ttl {
		return FXRate{}, false
	}
	return rate, true
}

func (rc *RateCache) Set(pair string, rate FXRate) {
	rc.mu.Lock()
	defer rc.mu.Unlock()
	rc.rates[pair] = rate
}

func (rc *RateCache) GetAll() map[string]FXRate {
	rc.mu.RLock()
	defer rc.mu.RUnlock()
	result := make(map[string]FXRate, len(rc.rates))
	for k, v := range rc.rates {
		result[k] = v
	}
	return result
}

// ─── FX Bridge Service ───────────────────────────────────────────────────────

type FXBridgeService struct {
	config    Config
	cache     *RateCache
	mlCB      *CircuitBreaker
	rfCB      *CircuitBreaker
	routes    []CorridorRoute
	positions map[string]NostroPosition
	posMu     sync.RWMutex
	settlements []SettlementInstruction
	settleMu    sync.RWMutex
}

func NewFXBridgeService(cfg Config) *FXBridgeService {
	return &FXBridgeService{
		config: cfg,
		cache:  NewRateCache(cfg.RateCacheTTL),
		mlCB:   NewCircuitBreaker(cfg.CircuitBreakerMax),
		rfCB:   NewCircuitBreaker(cfg.CircuitBreakerMax),
		routes: []CorridorRoute{
			{CorridorID: "CA-NG", FromCurrency: "CAD", ToCurrency: "NGN", IntermediateFX: "CAD→USD→NGN", Rail: "NIBSS", DeliveryTime: "30min", EstimatedFee: 5.0},
			{CorridorID: "CA-GH", FromCurrency: "CAD", ToCurrency: "GHS", IntermediateFX: "CAD→USD→GHS", Rail: "GhIPSS", DeliveryTime: "1hr", EstimatedFee: 7.0},
			{CorridorID: "CA-KE", FromCurrency: "CAD", ToCurrency: "KES", IntermediateFX: "CAD→USD→KES", Rail: "M-Pesa", DeliveryTime: "10min", EstimatedFee: 3.0},
			{CorridorID: "CA-ZA", FromCurrency: "CAD", ToCurrency: "ZAR", IntermediateFX: "CAD→USD→ZAR", Rail: "SARB", DeliveryTime: "2hr", EstimatedFee: 8.0},
			{CorridorID: "CA-SN", FromCurrency: "CAD", ToCurrency: "XOF", IntermediateFX: "CAD→EUR→XOF", Rail: "PAPSS", DeliveryTime: "4hr", EstimatedFee: 10.0},
			{CorridorID: "CA-TZ", FromCurrency: "CAD", ToCurrency: "TZS", IntermediateFX: "CAD→USD→TZS", Rail: "M-Pesa", DeliveryTime: "10min", EstimatedFee: 3.0},
			{CorridorID: "CA-UG", FromCurrency: "CAD", ToCurrency: "UGX", IntermediateFX: "CAD→USD→UGX", Rail: "MTN MoMo", DeliveryTime: "15min", EstimatedFee: 4.0},
			{CorridorID: "CA-CM", FromCurrency: "CAD", ToCurrency: "XAF", IntermediateFX: "CAD→EUR→XAF", Rail: "PAPSS", DeliveryTime: "4hr", EstimatedFee: 10.0},
		},
		positions: map[string]NostroPosition{
			"CAD": {Currency: "CAD", MarkLane: 500000, RemitFlow: 0, Net: 500000, LastUpdated: time.Now()},
			"USD": {Currency: "USD", MarkLane: 350000, RemitFlow: 200000, Net: 150000, LastUpdated: time.Now()},
			"NGN": {Currency: "NGN", MarkLane: 0, RemitFlow: 50000000, Net: -50000000, LastUpdated: time.Now()},
			"GHS": {Currency: "GHS", MarkLane: 0, RemitFlow: 500000, Net: -500000, LastUpdated: time.Now()},
			"KES": {Currency: "KES", MarkLane: 0, RemitFlow: 10000000, Net: -10000000, LastUpdated: time.Now()},
		},
	}
}

// ─── Composite Quote Generation ──────────────────────────────────────────────

func (s *FXBridgeService) GenerateCompositeQuote(corridor string, amount float64) (*CompositeQuote, error) {
	start := time.Now()
	defer func() {
		fxQuoteLatency.WithLabelValues(corridor).Observe(time.Since(start).Seconds())
	}()

	route := s.findRoute(corridor)
	if route == nil {
		return nil, fmt.Errorf("corridor %s not supported", corridor)
	}

	legs := strings.Split(route.IntermediateFX, "→")
	if len(legs) < 3 {
		return nil, fmt.Errorf("invalid route for corridor %s", corridor)
	}

	// Leg 1: Mark Lane rate (CAD → intermediate)
	mlPair := fmt.Sprintf("%s/%s", legs[0], legs[1])
	mlRate, err := s.getRate(mlPair, "marklane")
	if err != nil {
		return nil, fmt.Errorf("Mark Lane rate unavailable for %s: %w", mlPair, err)
	}

	// Leg 2: RemitFlow rate (intermediate → destination)
	rfPair := fmt.Sprintf("%s/%s", legs[1], legs[2])
	rfRate, err := s.getRate(rfPair, "remitflow")
	if err != nil {
		return nil, fmt.Errorf("RemitFlow rate unavailable for %s: %w", rfPair, err)
	}

	compositeRate := mlRate.Mid * rfRate.Mid
	intermediateAmount := amount * mlRate.Mid
	receiveAmount := intermediateAmount * rfRate.Mid

	mlFee := math.Max(5.0, amount*0.0025)
	rfFee := route.EstimatedFee
	totalFee := mlFee + rfFee

	quoteID := fmt.Sprintf("mlrf-%d-%s", time.Now().UnixMilli(), corridor)

	quote := &CompositeQuote{
		QuoteID:         quoteID,
		FromCurrency:    route.FromCurrency,
		ToCurrency:      route.ToCurrency,
		SendAmount:      amount,
		ReceiveAmount:   math.Round(receiveAmount*100) / 100,
		MarkLaneRate:    mlRate.Mid,
		RemitFlowRate:   rfRate.Mid,
		CompositeRate:   math.Round(compositeRate*10000) / 10000,
		MarkLaneFee:     mlFee,
		RemitFlowFee:    rfFee,
		TotalFee:        totalFee,
		MarkLaneSpread:  mlRate.Spread,
		RemitFlowSpread: rfRate.Spread,
		BestRoute:       route.IntermediateFX,
		ExpiresAt:       time.Now().Add(5 * time.Minute),
		CreatedAt:       time.Now(),
	}

	fxQuotesTotal.WithLabelValues(corridor, route.IntermediateFX).Inc()

	// Emit to Kafka (non-blocking)
	go s.emitKafkaEvent("marklane.fx.composite_quote", map[string]interface{}{
		"quoteId":       quote.QuoteID,
		"corridor":      corridor,
		"compositeRate": quote.CompositeRate,
		"sendAmount":    quote.SendAmount,
		"receiveAmount": quote.ReceiveAmount,
	})

	return quote, nil
}

func (s *FXBridgeService) findRoute(corridor string) *CorridorRoute {
	for i := range s.routes {
		if s.routes[i].CorridorID == corridor {
			return &s.routes[i]
		}
	}
	return nil
}

func (s *FXBridgeService) getRate(pair, source string) (FXRate, error) {
	if cached, ok := s.cache.Get(pair); ok {
		return cached, nil
	}

	rate := s.fetchFallbackRate(pair, source)
	s.cache.Set(pair, rate)
	return rate, nil
}

func (s *FXBridgeService) fetchFallbackRate(pair, source string) FXRate {
	fallback := map[string]float64{
		"CAD/USD": 0.7350, "CAD/EUR": 0.6720, "CAD/GBP": 0.5820,
		"USD/NGN": 1600, "USD/GHS": 15.5, "USD/KES": 154,
		"USD/ZAR": 18.5, "USD/TZS": 2650, "USD/UGX": 3750,
		"EUR/XOF": 655.957, "EUR/XAF": 655.957,
	}

	mid := fallback[pair]
	if mid == 0 {
		mid = 1.0
	}
	spread := mid * 0.002

	return FXRate{
		Pair:      pair,
		Bid:       mid - spread/2,
		Ask:       mid + spread/2,
		Mid:       mid,
		Spread:    spread,
		Source:    source,
		Timestamp: time.Now(),
	}
}

// ─── Nostro Position Management ──────────────────────────────────────────────

func (s *FXBridgeService) GetPositions() map[string]NostroPosition {
	s.posMu.RLock()
	defer s.posMu.RUnlock()
	result := make(map[string]NostroPosition, len(s.positions))
	for k, v := range s.positions {
		result[k] = v
	}

	for currency, pos := range result {
		nostroImbalance.WithLabelValues(currency).Set(pos.Net)
	}

	return result
}

func (s *FXBridgeService) UpdatePosition(currency string, markLaneDelta, remitFlowDelta float64) {
	s.posMu.Lock()
	defer s.posMu.Unlock()

	pos := s.positions[currency]
	pos.MarkLane += markLaneDelta
	pos.RemitFlow += remitFlowDelta
	pos.Net = pos.MarkLane - pos.RemitFlow
	pos.LastUpdated = time.Now()
	s.positions[currency] = pos

	nostroImbalance.WithLabelValues(currency).Set(pos.Net)
}

func (s *FXBridgeService) CheckRebalanceNeeded() []SettlementInstruction {
	s.posMu.RLock()
	defer s.posMu.RUnlock()

	var instructions []SettlementInstruction
	thresholds := map[string]float64{
		"CAD": 100000, "USD": 75000, "NGN": 10000000, "GHS": 100000, "KES": 2000000,
	}

	for currency, pos := range s.positions {
		threshold := thresholds[currency]
		if threshold == 0 {
			threshold = 50000
		}

		if math.Abs(pos.Net) > threshold {
			fromPartner := "remitflow"
			toPartner := "marklane"
			if pos.Net > 0 {
				fromPartner = "marklane"
				toPartner = "remitflow"
			}

			instructions = append(instructions, SettlementInstruction{
				InstructionID: fmt.Sprintf("settle-%d-%s", time.Now().UnixMilli(), currency),
				FromPartner:   fromPartner,
				ToPartner:     toPartner,
				Currency:      currency,
				Amount:        math.Abs(pos.Net) / 2,
				Reason:        "nostro_rebalance",
				DueDate:       time.Now().Add(24 * time.Hour),
				Status:        "pending",
				CreatedAt:     time.Now(),
			})
		}
	}

	return instructions
}

// ─── Kafka Event Emission ────────────────────────────────────────────────────

func (s *FXBridgeService) emitKafkaEvent(topic string, data map[string]interface{}) {
	data["_service"] = "go-marklane-fx-bridge"
	data["_timestamp"] = time.Now().UTC().Format(time.RFC3339Nano)

	payload, err := json.Marshal(data)
	if err != nil {
		log.Printf("[kafka] marshal error: %v", err)
		return
	}

	daprURL := fmt.Sprintf("%s/v1.0/publish/kafka-pubsub/%s", s.config.DaprURL, topic)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, "POST", daprURL, strings.NewReader(string(payload)))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("[kafka] publish to %s failed: %v", topic, err)
		return
	}
	resp.Body.Close()
}

// ─── HTTP Handlers ───────────────────────────────────────────────────────────

func (s *FXBridgeService) handleHealth(w http.ResponseWriter, r *http.Request) {
	jsonResp(w, 200, map[string]interface{}{
		"status":  "healthy",
		"service": "go-marklane-fx-bridge",
		"version": "1.0.0",
		"uptime":  time.Since(startTime).String(),
		"rates_cached": len(s.cache.GetAll()),
	})
}

func (s *FXBridgeService) handleQuote(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		jsonResp(w, 405, map[string]string{"error": "method not allowed"})
		return
	}

	var req struct {
		Corridor string  `json:"corridor"`
		Amount   float64 `json:"amount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonResp(w, 400, map[string]string{"error": "invalid request body"})
		return
	}

	if req.Amount <= 0 || req.Amount > 50000 {
		jsonResp(w, 400, map[string]string{"error": "amount must be between 0 and 50000"})
		return
	}

	quote, err := s.GenerateCompositeQuote(req.Corridor, req.Amount)
	if err != nil {
		jsonResp(w, 400, map[string]string{"error": err.Error()})
		return
	}

	jsonResp(w, 200, quote)
}

func (s *FXBridgeService) handleRates(w http.ResponseWriter, r *http.Request) {
	rates := s.cache.GetAll()

	if len(rates) == 0 {
		defaultPairs := []string{"CAD/USD", "CAD/EUR", "USD/NGN", "USD/GHS", "USD/KES", "USD/ZAR", "EUR/XOF"}
		for _, pair := range defaultPairs {
			rate := s.fetchFallbackRate(pair, "fallback")
			s.cache.Set(pair, rate)
			rates[pair] = rate
		}
	}

	jsonResp(w, 200, map[string]interface{}{
		"rates":     rates,
		"count":     len(rates),
		"fetchedAt": time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *FXBridgeService) handleRoutes(w http.ResponseWriter, r *http.Request) {
	jsonResp(w, 200, map[string]interface{}{
		"routes": s.routes,
		"count":  len(s.routes),
	})
}

func (s *FXBridgeService) handlePositions(w http.ResponseWriter, r *http.Request) {
	positions := s.GetPositions()
	jsonResp(w, 200, map[string]interface{}{
		"positions": positions,
		"count":     len(positions),
	})
}

func (s *FXBridgeService) handleRebalanceCheck(w http.ResponseWriter, r *http.Request) {
	instructions := s.CheckRebalanceNeeded()
	settlementsPending.Set(float64(len(instructions)))
	jsonResp(w, 200, map[string]interface{}{
		"instructions": instructions,
		"count":        len(instructions),
		"checkedAt":    time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *FXBridgeService) handleUpdatePosition(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		jsonResp(w, 405, map[string]string{"error": "method not allowed"})
		return
	}

	var req struct {
		Currency        string  `json:"currency"`
		MarkLaneDelta   float64 `json:"markLaneDelta"`
		RemitFlowDelta  float64 `json:"remitFlowDelta"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonResp(w, 400, map[string]string{"error": "invalid request body"})
		return
	}

	s.UpdatePosition(req.Currency, req.MarkLaneDelta, req.RemitFlowDelta)
	jsonResp(w, 200, map[string]string{"status": "updated"})
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func jsonResp(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

var startTime = time.Now()

// ─── Background Rate Refresh ─────────────────────────────────────────────────

func (s *FXBridgeService) startRateRefreshLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	s.refreshRates()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.refreshRates()
		}
	}
}

func (s *FXBridgeService) refreshRates() {
	pairs := []struct {
		pair   string
		source string
	}{
		{"CAD/USD", "marklane"}, {"CAD/EUR", "marklane"}, {"CAD/GBP", "marklane"},
		{"USD/NGN", "remitflow"}, {"USD/GHS", "remitflow"}, {"USD/KES", "remitflow"},
		{"USD/ZAR", "remitflow"}, {"USD/TZS", "remitflow"}, {"USD/UGX", "remitflow"},
		{"EUR/XOF", "remitflow"}, {"EUR/XAF", "remitflow"},
	}

	for _, p := range pairs {
		var fetchErr error

		if p.source == "marklane" {
			fetchErr = s.mlCB.Execute(func() error {
				return s.fetchMarkLaneRate(p.pair)
			})
		} else {
			fetchErr = s.rfCB.Execute(func() error {
				return s.fetchRemitFlowRate(p.pair)
			})
		}

		if fetchErr != nil {
			rateRefreshErrors.WithLabelValues(p.source).Inc()
			rate := s.fetchFallbackRate(p.pair, "fallback")
			s.cache.Set(p.pair, rate)
		}
	}
}

func (s *FXBridgeService) fetchMarkLaneRate(pair string) error {
	if s.config.MarkLaneAPIKey == "" {
		rate := s.fetchFallbackRate(pair, "marklane-fallback")
		s.cache.Set(pair, rate)
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	url := fmt.Sprintf("%s/fx/rates?pairs=%s", s.config.MarkLaneAPIURL, pair)
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("X-ML-Api-Key", s.config.MarkLaneAPIKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("Mark Lane API returned %d", resp.StatusCode)
	}

	var rates map[string]struct {
		Bid       float64 `json:"bid"`
		Ask       float64 `json:"ask"`
		Mid       float64 `json:"mid"`
		Timestamp string  `json:"timestamp"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rates); err != nil {
		return err
	}

	for p, r := range rates {
		s.cache.Set(p, FXRate{
			Pair:      p,
			Bid:       r.Bid,
			Ask:       r.Ask,
			Mid:       r.Mid,
			Spread:    r.Ask - r.Bid,
			Source:    "marklane",
			Timestamp: time.Now(),
		})
	}

	return nil
}

func (s *FXBridgeService) fetchRemitFlowRate(pair string) error {
	currencies := strings.Split(pair, "/")
	if len(currencies) != 2 {
		return fmt.Errorf("invalid pair: %s", pair)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	url := fmt.Sprintf("https://api.exchangerate-api.com/v4/latest/%s", currencies[0])
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var data struct {
		Rates map[string]float64 `json:"rates"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return err
	}

	mid := data.Rates[currencies[1]]
	if mid == 0 {
		return fmt.Errorf("rate not found for %s", pair)
	}

	spread := mid * 0.002
	s.cache.Set(pair, FXRate{
		Pair:      pair,
		Bid:       mid - spread/2,
		Ask:       mid + spread/2,
		Mid:       mid,
		Spread:    spread,
		Source:    "exchangerate-api",
		Timestamp: time.Now(),
	})

	return nil
}

// ─── Main ────────────────────────────────────────────────────────────────────

func main() {
	cfg := loadConfig()
	svc := NewFXBridgeService(cfg)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", svc.handleHealth)
	mux.HandleFunc("/api/marklane/quote", svc.handleQuote)
	mux.HandleFunc("/api/marklane/rates", svc.handleRates)
	mux.HandleFunc("/api/marklane/routes", svc.handleRoutes)
	mux.HandleFunc("/api/marklane/positions", svc.handlePositions)
	mux.HandleFunc("/api/marklane/rebalance", svc.handleRebalanceCheck)
	mux.HandleFunc("/api/marklane/position/update", svc.handleUpdatePosition)
	mux.Handle("/metrics", promhttp.Handler())

	port, _ := strconv.Atoi(cfg.Port)
	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", port),
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go svc.startRateRefreshLoop(ctx)

	go func() {
		log.Printf("[go-marklane-fx-bridge] listening on :%s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("[go-marklane-fx-bridge] shutting down...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	server.Shutdown(shutdownCtx)
}
