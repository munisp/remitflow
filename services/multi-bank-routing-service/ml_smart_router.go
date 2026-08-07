package multibank

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

// MLRoutingConfig holds ML-specific configuration
type MLRoutingConfig struct {
	// ML service endpoint
	MLServiceURL string `json:"ml_service_url"`

	// Weights for ML-enhanced scoring
	MLSuccessWeight  float64 `json:"ml_success_weight"`
	MLLatencyWeight  float64 `json:"ml_latency_weight"`
	MLCostWeight     float64 `json:"ml_cost_weight"`
	MLBanditWeight   float64 `json:"ml_bandit_weight"`

	// Fallback to rule-based if ML unavailable
	EnableMLFallback bool `json:"enable_ml_fallback"`

	// Exploration rate for bandit
	ExplorationRate float64 `json:"exploration_rate"`

	// Model versions
	SuccessModelVersion string `json:"success_model_version"`
	LatencyModelVersion string `json:"latency_model_version"`
}

// DefaultMLRoutingConfig returns default ML routing configuration
func DefaultMLRoutingConfig() *MLRoutingConfig {
	return &MLRoutingConfig{
		MLServiceURL:        "http://localhost:8080",
		MLSuccessWeight:     0.40,
		MLLatencyWeight:     0.25,
		MLCostWeight:        0.20,
		MLBanditWeight:      0.15,
		EnableMLFallback:    true,
		ExplorationRate:     0.1,
		SuccessModelVersion: "latest",
		LatencyModelVersion: "latest",
	}
}

// MLPredictionRequest represents a request to the ML service
type MLPredictionRequest struct {
	BankCode           string  `json:"bank_code"`
	BankCategory       string  `json:"bank_category"`
	HasDirectAPI       bool    `json:"has_direct_api"`
	HasOnUs            bool    `json:"has_on_us"`
	Rail               string  `json:"rail"`
	Amount             float64 `json:"amount"`
	AmountBucket       string  `json:"amount_bucket"`
	HourOfDay          int     `json:"hour_of_day"`
	DayOfWeek          int     `json:"day_of_week"`
	IsWeekend          bool    `json:"is_weekend"`
	IsBusinessHours    bool    `json:"is_business_hours"`
	IsMonthEnd         bool    `json:"is_month_end"`
	BankSuccessRate1h  float64 `json:"bank_success_rate_1h"`
	BankSuccessRate24h float64 `json:"bank_success_rate_24h"`
	BankSuccessRate7d  float64 `json:"bank_success_rate_7d"`
	BankAvgLatency1h   float64 `json:"bank_avg_latency_1h"`
	BankAvgLatency24h  float64 `json:"bank_avg_latency_24h"`
	RailSuccessRate1h  float64 `json:"rail_success_rate_1h"`
	RailSuccessRate24h float64 `json:"rail_success_rate_24h"`
	AccountBalanceRatio float64 `json:"account_balance_ratio"`
	DailyUtilization   float64 `json:"daily_utilization"`
}

// MLPredictionResponse represents a response from the ML service
type MLPredictionResponse struct {
	SuccessProbability float64 `json:"success_probability"`
	PredictedLatencyMs int     `json:"predicted_latency_ms"`
	SuccessScore       float64 `json:"success_score"`
	LatencyScore       float64 `json:"latency_score"`
	CostScore          float64 `json:"cost_score"`
	BanditScore        float64 `json:"bandit_score"`
	FinalScore         float64 `json:"final_score"`
	ModelVersion       string  `json:"model_version"`
}

// MLBatchPredictionRequest represents a batch prediction request
type MLBatchPredictionRequest struct {
	Candidates []MLPredictionRequest `json:"candidates"`
}

// MLBatchPredictionResponse represents a batch prediction response
type MLBatchPredictionResponse struct {
	Predictions []MLPredictionResponse `json:"predictions"`
}

// BankFeatures represents real-time bank features from feature store
type BankFeatures struct {
	SuccessRate1h  float64 `json:"success_rate_1h"`
	SuccessRate24h float64 `json:"success_rate_24h"`
	SuccessRate7d  float64 `json:"success_rate_7d"`
	AvgLatency1h   float64 `json:"avg_latency_1h"`
	AvgLatency24h  float64 `json:"avg_latency_24h"`
}

// RailFeatures represents real-time rail features from feature store
type RailFeatures struct {
	SuccessRate1h  float64 `json:"success_rate_1h"`
	SuccessRate24h float64 `json:"success_rate_24h"`
}

// MLSmartRouter implements ML-enhanced intelligent payment routing
type MLSmartRouter struct {
	db            *gorm.DB
	redis         *redis.Client
	bankDirectory *BankDirectory
	baseConfig    *RoutingConfig
	mlConfig      *MLRoutingConfig
	accounts      map[string]*BankAccount
	httpClient    *http.Client
	mu            sync.RWMutex

	// ML service availability
	mlServiceAvailable bool
	lastMLCheck        time.Time
}

// NewMLSmartRouter creates a new ML-enhanced smart router
func NewMLSmartRouter(
	db *gorm.DB,
	redisClient *redis.Client,
	bankDirectory *BankDirectory,
	baseConfig *RoutingConfig,
	mlConfig *MLRoutingConfig,
) *MLSmartRouter {
	if baseConfig == nil {
		baseConfig = DefaultRoutingConfig()
	}
	if mlConfig == nil {
		mlConfig = DefaultMLRoutingConfig()
	}

	router := &MLSmartRouter{
		db:            db,
		redis:         redisClient,
		bankDirectory: bankDirectory,
		baseConfig:    baseConfig,
		mlConfig:      mlConfig,
		accounts:      make(map[string]*BankAccount),
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
		mlServiceAvailable: true,
	}

	// Load bank accounts from database
	router.loadBankAccounts()

	return router
}

// loadBankAccounts loads all bank accounts from the database
func (r *MLSmartRouter) loadBankAccounts() error {
	var accounts []BankAccount
	if err := r.db.Where("is_active = ?", true).Find(&accounts).Error; err != nil {
		return err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	for i := range accounts {
		r.accounts[accounts[i].BankCode] = &accounts[i]
	}

	return nil
}

// Route determines the optimal route using ML models
func (r *MLSmartRouter) Route(ctx context.Context, req *TransferRequest) (*RoutingDecision, error) {
	if req.TransferID == "" {
		req.TransferID = uuid.New().String()
	}

	// Get destination bank info
	destBank, err := r.bankDirectory.GetBank(req.DestBankCode)
	if err != nil {
		return nil, fmt.Errorf("invalid destination bank: %w", err)
	}

	// Check if bank is within operating hours
	withinHours, err := r.bankDirectory.IsWithinOperatingHours(req.DestBankCode)
	if err != nil {
		return nil, err
	}

	// Generate routing candidates
	candidates := r.generateCandidates(ctx, req, destBank, withinHours)

	if len(candidates) == 0 {
		return nil, errors.New("no viable routing options available")
	}

	// Score candidates using ML
	err = r.scoreWithML(ctx, candidates, req, destBank)
	if err != nil {
		// Fallback to rule-based scoring if ML fails
		if r.mlConfig.EnableMLFallback {
			r.scoreWithRules(candidates, req)
		} else {
			return nil, fmt.Errorf("ML scoring failed: %w", err)
		}
	}

	// Sort by score (descending)
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].Score > candidates[j].Score
	})

	// Apply exploration (epsilon-greedy)
	best := r.applyExploration(candidates)

	// Set fallback rails
	if len(candidates) > 1 {
		for i := 1; i < len(candidates) && i <= 3; i++ {
			if candidates[i].TransferID == best.TransferID {
				continue
			}
			best.FallbackRails = append(best.FallbackRails, candidates[i].SelectedRail)
		}
	}

	// Cache the decision
	r.cacheDecision(ctx, best)

	// Record decision for online learning
	r.recordDecision(ctx, best, req)

	return best, nil
}

// generateCandidates generates all possible routing candidates
func (r *MLSmartRouter) generateCandidates(
	ctx context.Context,
	req *TransferRequest,
	destBank *NigerianBank,
	withinHours bool,
) []*RoutingDecision {
	var candidates []*RoutingDecision

	r.mu.RLock()
	defer r.mu.RUnlock()

	// Check for on-us opportunity (we have account at destination bank)
	if account, exists := r.accounts[req.DestBankCode]; exists && account.IsActive && account.HasOnUsCapability {
		if r.hasAvailableLiquidity(account, req.Amount) {
			candidates = append(candidates, &RoutingDecision{
				TransferID:         req.TransferID,
				SelectedRail:       RailOnUs,
				SourceAccount:      account,
				DestinationBank:    destBank,
				EstimatedLatency:   destBank.AvgLatencyMs / 2,
				EstimatedCost:      r.baseConfig.OnUsCost,
				SuccessProbability: min(destBank.AvgSuccessRate*1.05, 1.0),
				RequiredReserve:    req.Amount,
				TimeoutPolicy:      r.baseConfig.OnUsTimeout,
				Reason:             "On-us transfer via matching bank account",
				CreatedAt:          time.Now(),
			})
		}
	}

	// Check for direct API opportunity
	if destBank.HasDirectAPI {
		for _, account := range r.accounts {
			if account.IsActive && r.hasAvailableLiquidity(account, req.Amount) {
				candidates = append(candidates, &RoutingDecision{
					TransferID:         req.TransferID,
					SelectedRail:       RailDirect,
					SourceAccount:      account,
					DestinationBank:    destBank,
					EstimatedLatency:   destBank.AvgLatencyMs,
					EstimatedCost:      r.baseConfig.DirectCost,
					SuccessProbability: destBank.AvgSuccessRate,
					RequiredReserve:    req.Amount,
					TimeoutPolicy:      r.baseConfig.DirectTimeout,
					Reason:             fmt.Sprintf("Direct API via %s", account.BankName),
					CreatedAt:          time.Now(),
				})
				break
			}
		}
	}

	// NIP is always available (universal coverage)
	if withinHours {
		for _, account := range r.accounts {
			if account.IsActive && r.hasAvailableLiquidity(account, req.Amount) {
				candidates = append(candidates, &RoutingDecision{
					TransferID:         req.TransferID,
					SelectedRail:       RailNIP,
					SourceAccount:      account,
					DestinationBank:    destBank,
					EstimatedLatency:   1000 + destBank.AvgLatencyMs,
					EstimatedCost:      r.baseConfig.NIPCost,
					SuccessProbability: destBank.AvgSuccessRate * 0.98,
					RequiredReserve:    req.Amount + r.baseConfig.NIPCost,
					TimeoutPolicy:      r.baseConfig.NIPTimeout,
					Reason:             fmt.Sprintf("NIBSS NIP via %s", account.BankName),
					CreatedAt:          time.Now(),
				})
				break
			}
		}
	}

	// NEFT for non-urgent, large transfers
	if req.Priority == PriorityLow && req.Amount > 100000 {
		for _, account := range r.accounts {
			if account.IsActive && r.hasAvailableLiquidity(account, req.Amount) {
				candidates = append(candidates, &RoutingDecision{
					TransferID:         req.TransferID,
					SelectedRail:       RailNEFT,
					SourceAccount:      account,
					DestinationBank:    destBank,
					EstimatedLatency:   3600000,
					EstimatedCost:      r.baseConfig.NEFTCost,
					SuccessProbability: 0.99,
					RequiredReserve:    req.Amount + r.baseConfig.NEFTCost,
					TimeoutPolicy:      r.baseConfig.NEFTTimeout,
					Reason:             fmt.Sprintf("NIBSS NEFT via %s (batch)", account.BankName),
					CreatedAt:          time.Now(),
				})
				break
			}
		}
	}

	return candidates
}

// hasAvailableLiquidity checks if an account has sufficient liquidity
func (r *MLSmartRouter) hasAvailableLiquidity(account *BankAccount, amount float64) bool {
	availableForTransfer := account.AvailableBalance - account.MinimumBalance
	if availableForTransfer < amount*r.baseConfig.MinLiquidityRatio {
		return false
	}

	remainingDailyLimit := account.MaxDailyOutflow - account.TodayOutflow
	if remainingDailyLimit < amount {
		return false
	}

	utilizationRate := account.TodayOutflow / account.MaxDailyOutflow
	if utilizationRate > r.baseConfig.MaxUtilizationRate {
		return false
	}

	return true
}

// scoreWithML scores candidates using ML models
func (r *MLSmartRouter) scoreWithML(
	ctx context.Context,
	candidates []*RoutingDecision,
	req *TransferRequest,
	destBank *NigerianBank,
) error {
	// Check ML service availability
	if !r.isMLServiceAvailable() {
		return errors.New("ML service unavailable")
	}

	// Build prediction requests
	var predRequests []MLPredictionRequest
	for _, c := range candidates {
		// Get real-time features from feature store
		bankFeatures := r.getBankFeatures(ctx, c.DestinationBank.Code)
		railFeatures := r.getRailFeatures(ctx, string(c.SelectedRail))

		predReq := MLPredictionRequest{
			BankCode:           c.DestinationBank.Code,
			BankCategory:       c.DestinationBank.Category,
			HasDirectAPI:       c.DestinationBank.HasDirectAPI,
			HasOnUs:            c.SourceAccount.HasOnUsCapability,
			Rail:               string(c.SelectedRail),
			Amount:             req.Amount,
			AmountBucket:       r.getAmountBucket(req.Amount),
			HourOfDay:          time.Now().Hour(),
			DayOfWeek:          int(time.Now().Weekday()),
			IsWeekend:          time.Now().Weekday() == time.Saturday || time.Now().Weekday() == time.Sunday,
			IsBusinessHours:    time.Now().Hour() >= 9 && time.Now().Hour() <= 17,
			IsMonthEnd:         time.Now().Day() > 25,
			BankSuccessRate1h:  bankFeatures.SuccessRate1h,
			BankSuccessRate24h: bankFeatures.SuccessRate24h,
			BankSuccessRate7d:  bankFeatures.SuccessRate7d,
			BankAvgLatency1h:   bankFeatures.AvgLatency1h,
			BankAvgLatency24h:  bankFeatures.AvgLatency24h,
			RailSuccessRate1h:  railFeatures.SuccessRate1h,
			RailSuccessRate24h: railFeatures.SuccessRate24h,
			AccountBalanceRatio: c.SourceAccount.AvailableBalance / c.RequiredReserve,
			DailyUtilization:   c.SourceAccount.TodayOutflow / c.SourceAccount.MaxDailyOutflow,
		}
		predRequests = append(predRequests, predReq)
	}

	// Call ML service for batch prediction
	batchReq := MLBatchPredictionRequest{Candidates: predRequests}
	predictions, err := r.callMLService(ctx, batchReq)
	if err != nil {
		return err
	}

	// Apply ML predictions to candidates
	for i, pred := range predictions.Predictions {
		if i >= len(candidates) {
			break
		}

		candidates[i].SuccessProbability = pred.SuccessProbability
		candidates[i].EstimatedLatency = pred.PredictedLatencyMs
		candidates[i].Score = pred.FinalScore

		// Apply priority adjustments
		candidates[i].Score = r.applyPriorityAdjustment(candidates[i].Score, req.Priority, pred)

		// Bonus for on-us
		if candidates[i].SelectedRail == RailOnUs {
			candidates[i].Score *= 1.15
		}
	}

	return nil
}

// callMLService calls the ML service for predictions
func (r *MLSmartRouter) callMLService(ctx context.Context, req MLBatchPredictionRequest) (*MLBatchPredictionResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(
		ctx,
		"POST",
		fmt.Sprintf("%s/api/v1/predict/batch", r.mlConfig.MLServiceURL),
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}

	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := r.httpClient.Do(httpReq)
	if err != nil {
		r.markMLServiceUnavailable()
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		r.markMLServiceUnavailable()
		return nil, fmt.Errorf("ML service returned status %d", resp.StatusCode)
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var predResp MLBatchPredictionResponse
	if err := json.Unmarshal(respBody, &predResp); err != nil {
		return nil, err
	}

	return &predResp, nil
}

// scoreWithRules scores candidates using rule-based logic (fallback)
func (r *MLSmartRouter) scoreWithRules(candidates []*RoutingDecision, req *TransferRequest) {
	if len(candidates) == 0 {
		return
	}

	// Find min/max for normalization
	var minCost, maxCost float64 = 1e9, 0
	var minLatency, maxLatency int = 1e9, 0
	var minSuccess, maxSuccess float64 = 1.0, 0

	for _, c := range candidates {
		if c.EstimatedCost < minCost {
			minCost = c.EstimatedCost
		}
		if c.EstimatedCost > maxCost {
			maxCost = c.EstimatedCost
		}
		if c.EstimatedLatency < minLatency {
			minLatency = c.EstimatedLatency
		}
		if c.EstimatedLatency > maxLatency {
			maxLatency = c.EstimatedLatency
		}
		if c.SuccessProbability < minSuccess {
			minSuccess = c.SuccessProbability
		}
		if c.SuccessProbability > maxSuccess {
			maxSuccess = c.SuccessProbability
		}
	}

	// Score each candidate
	for _, c := range candidates {
		var costScore, speedScore, successScore, liquidityScore float64

		// Cost score (lower cost = higher score)
		if maxCost > minCost {
			costScore = 1 - (c.EstimatedCost-minCost)/(maxCost-minCost)
		} else {
			costScore = 1.0
		}

		// Speed score (lower latency = higher score)
		if maxLatency > minLatency {
			speedScore = 1 - float64(c.EstimatedLatency-minLatency)/float64(maxLatency-minLatency)
		} else {
			speedScore = 1.0
		}

		// Success score (higher success = higher score)
		if maxSuccess > minSuccess {
			successScore = (c.SuccessProbability - minSuccess) / (maxSuccess - minSuccess)
		} else {
			successScore = 1.0
		}

		// Liquidity score
		if c.SourceAccount != nil {
			availableRatio := c.SourceAccount.AvailableBalance / c.RequiredReserve
			liquidityScore = min(availableRatio/r.baseConfig.MinLiquidityRatio, 1.0)
		}

		// Priority adjustments
		switch req.Priority {
		case PriorityCritical:
			c.Score = r.baseConfig.SuccessRateWeight*1.5*successScore +
				r.baseConfig.SpeedWeight*1.5*speedScore +
				r.baseConfig.CostWeight*0.5*costScore +
				r.baseConfig.LiquidityWeight*liquidityScore
		case PriorityHigh:
			c.Score = r.baseConfig.SuccessRateWeight*successScore +
				r.baseConfig.SpeedWeight*1.3*speedScore +
				r.baseConfig.CostWeight*0.7*costScore +
				r.baseConfig.LiquidityWeight*liquidityScore
		case PriorityLow:
			c.Score = r.baseConfig.SuccessRateWeight*successScore +
				r.baseConfig.SpeedWeight*0.5*speedScore +
				r.baseConfig.CostWeight*1.5*costScore +
				r.baseConfig.LiquidityWeight*liquidityScore
		default:
			c.Score = r.baseConfig.SuccessRateWeight*successScore +
				r.baseConfig.SpeedWeight*speedScore +
				r.baseConfig.CostWeight*costScore +
				r.baseConfig.LiquidityWeight*liquidityScore
		}

		// Bonus for on-us
		if c.SelectedRail == RailOnUs {
			c.Score *= 1.2
		}
	}
}

// applyPriorityAdjustment applies priority-based adjustments to ML score
func (r *MLSmartRouter) applyPriorityAdjustment(
	score float64,
	priority TransferPriority,
	pred MLPredictionResponse,
) float64 {
	switch priority {
	case PriorityCritical:
		// Boost success and speed components
		return score + 0.1*pred.SuccessScore + 0.1*pred.LatencyScore
	case PriorityHigh:
		// Boost speed component
		return score + 0.05*pred.LatencyScore
	case PriorityLow:
		// Boost cost component
		return score + 0.1*pred.CostScore
	default:
		return score
	}
}

// applyExploration applies epsilon-greedy exploration
func (r *MLSmartRouter) applyExploration(candidates []*RoutingDecision) *RoutingDecision {
	if len(candidates) == 0 {
		return nil
	}

	// With probability epsilon, explore (random selection)
	// With probability 1-epsilon, exploit (best selection)
	if len(candidates) > 1 && time.Now().UnixNano()%100 < int64(r.mlConfig.ExplorationRate*100) {
		// Explore: select randomly from the top three candidates.
		maxIdx := len(candidates)
		if maxIdx > 3 {
			maxIdx = 3
		}
		randomIdx := int(time.Now().UnixNano() % int64(maxIdx))
		return candidates[randomIdx]
	}

	// Exploit: select best
	return candidates[0]
}

// getBankFeatures gets real-time bank features from Redis
func (r *MLSmartRouter) getBankFeatures(ctx context.Context, bankCode string) BankFeatures {
	defaults := BankFeatures{
		SuccessRate1h:  0.95,
		SuccessRate24h: 0.95,
		SuccessRate7d:  0.95,
		AvgLatency1h:   1000,
		AvgLatency24h:  1000,
	}

	if r.redis == nil {
		return defaults
	}

	key := fmt.Sprintf("features:bank:%s", bankCode)
	data, err := r.redis.Get(ctx, key).Result()
	if err != nil {
		return defaults
	}

	var features BankFeatures
	if err := json.Unmarshal([]byte(data), &features); err != nil {
		return defaults
	}

	return features
}

// getRailFeatures gets real-time rail features from Redis
func (r *MLSmartRouter) getRailFeatures(ctx context.Context, rail string) RailFeatures {
	defaults := RailFeatures{
		SuccessRate1h:  0.95,
		SuccessRate24h: 0.95,
	}

	if r.redis == nil {
		return defaults
	}

	key := fmt.Sprintf("features:rail:%s", rail)
	data, err := r.redis.Get(ctx, key).Result()
	if err != nil {
		return defaults
	}

	var features RailFeatures
	if err := json.Unmarshal([]byte(data), &features); err != nil {
		return defaults
	}

	return features
}

// getAmountBucket categorizes amount into buckets
func (r *MLSmartRouter) getAmountBucket(amount float64) string {
	if amount < 10000 {
		return "small"
	} else if amount < 100000 {
		return "medium"
	} else if amount < 1000000 {
		return "large"
	}
	return "xlarge"
}

// isMLServiceAvailable checks if ML service is available
func (r *MLSmartRouter) isMLServiceAvailable() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	// Re-check every 30 seconds
	if time.Since(r.lastMLCheck) > 30*time.Second {
		go r.checkMLServiceHealth()
	}

	return r.mlServiceAvailable
}

// markMLServiceUnavailable marks ML service as unavailable
func (r *MLSmartRouter) markMLServiceUnavailable() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.mlServiceAvailable = false
	r.lastMLCheck = time.Now()
}

// checkMLServiceHealth checks ML service health
func (r *MLSmartRouter) checkMLServiceHealth() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s/health", r.mlConfig.MLServiceURL), nil)
	resp, err := r.httpClient.Do(req)

	r.mu.Lock()
	defer r.mu.Unlock()

	if err != nil || resp.StatusCode != http.StatusOK {
		r.mlServiceAvailable = false
	} else {
		r.mlServiceAvailable = true
	}
	r.lastMLCheck = time.Now()

	if resp != nil {
		resp.Body.Close()
	}
}

// cacheDecision caches the routing decision in Redis
func (r *MLSmartRouter) cacheDecision(ctx context.Context, decision *RoutingDecision) {
	if r.redis == nil {
		return
	}

	data, _ := json.Marshal(decision)
	r.redis.Set(ctx, fmt.Sprintf("routing:decision:%s", decision.TransferID), data, 24*time.Hour)
}

// recordDecision records the decision for online learning
func (r *MLSmartRouter) recordDecision(ctx context.Context, decision *RoutingDecision, req *TransferRequest) {
	if r.redis == nil {
		return
	}

	// Store decision details for later matching with outcome
	decisionData := map[string]interface{}{
		"transfer_id":            decision.TransferID,
		"bank_code":              decision.DestinationBank.Code,
		"rail":                   string(decision.SelectedRail),
		"amount":                 req.Amount,
		"predicted_success_rate": decision.SuccessProbability,
		"predicted_latency_ms":   decision.EstimatedLatency,
		"predicted_cost":         decision.EstimatedCost,
		"score":                  decision.Score,
		"timestamp":              time.Now().Format(time.RFC3339),
	}

	data, _ := json.Marshal(decisionData)
	r.redis.Set(ctx, fmt.Sprintf("decision:%s", decision.TransferID), data, time.Hour)
}

// RecordOutcome records the outcome of a transfer for online learning
func (r *MLSmartRouter) RecordOutcome(
	ctx context.Context,
	transferID string,
	wasSuccessful bool,
	actualLatencyMs int,
	actualCost float64,
	errorCode string,
	errorMessage string,
) error {
	if r.redis == nil {
		return nil
	}

	// Get original decision
	decisionData, err := r.redis.Get(ctx, fmt.Sprintf("decision:%s", transferID)).Result()
	if err != nil {
		return err
	}

	var decision map[string]interface{}
	if err := json.Unmarshal([]byte(decisionData), &decision); err != nil {
		return err
	}

	// Store outcome
	outcomeData := map[string]interface{}{
		"transfer_id":       transferID,
		"bank_code":         decision["bank_code"],
		"rail":              decision["rail"],
		"amount":            decision["amount"],
		"was_successful":    wasSuccessful,
		"actual_latency_ms": actualLatencyMs,
		"actual_cost":       actualCost,
		"error_code":        errorCode,
		"error_message":     errorMessage,
		"timestamp":         time.Now().Format(time.RFC3339),
	}

	// Store in database for model training
	if r.db != nil {
		r.db.Exec(`
			INSERT INTO routing_metrics (
				transfer_id, bank_code, rail, amount, was_successful,
				actual_latency_ms, actual_cost, predicted_success_rate,
				predicted_latency_ms, predicted_cost, hour_of_day, day_of_week, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			transferID,
			decision["bank_code"],
			decision["rail"],
			decision["amount"],
			wasSuccessful,
			actualLatencyMs,
			actualCost,
			decision["predicted_success_rate"],
			decision["predicted_latency_ms"],
			decision["predicted_cost"],
			time.Now().Hour(),
			int(time.Now().Weekday()),
			time.Now(),
		)
	}

	// Publish to Kafka for online learning (via Redis pub/sub as bridge)
	data, _ := json.Marshal(outcomeData)
	r.redis.Publish(ctx, "routing:outcomes", data)

	return nil
}

// GetDecision retrieves a cached routing decision
func (r *MLSmartRouter) GetDecision(ctx context.Context, transferID string) (*RoutingDecision, error) {
	if r.redis == nil {
		return nil, errors.New("redis not available")
	}

	data, err := r.redis.Get(ctx, fmt.Sprintf("routing:decision:%s", transferID)).Result()
	if err != nil {
		return nil, err
	}

	var decision RoutingDecision
	if err := json.Unmarshal([]byte(data), &decision); err != nil {
		return nil, err
	}

	return &decision, nil
}

// GetMLMetrics returns ML model metrics
func (r *MLSmartRouter) GetMLMetrics(ctx context.Context) (map[string]interface{}, error) {
	resp, err := r.httpClient.Get(fmt.Sprintf("%s/api/v1/metrics", r.mlConfig.MLServiceURL))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var metrics map[string]interface{}
	if err := json.Unmarshal(body, &metrics); err != nil {
		return nil, err
	}

	return metrics, nil
}

// ReserveBalance reserves balance for a transfer
func (r *MLSmartRouter) ReserveBalance(ctx context.Context, decision *RoutingDecision) error {
	if decision.SourceAccount == nil {
		return errors.New("no source account in decision")
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	account := r.accounts[decision.SourceAccount.BankCode]
	if account == nil {
		return errors.New("source account not found")
	}

	if account.AvailableBalance < decision.RequiredReserve {
		return errors.New("insufficient balance")
	}

	account.AvailableBalance -= decision.RequiredReserve
	account.ReservedBalance += decision.RequiredReserve

	// Update database
	return r.db.Model(&BankAccount{}).
		Where("id = ?", account.ID).
		Updates(map[string]interface{}{
			"available_balance": account.AvailableBalance,
			"reserved_balance":  account.ReservedBalance,
			"updated_at":        time.Now(),
		}).Error
}

// CommitBalance commits reserved balance after successful transfer
func (r *MLSmartRouter) CommitBalance(ctx context.Context, decision *RoutingDecision) error {
	if decision.SourceAccount == nil {
		return errors.New("no source account in decision")
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	account := r.accounts[decision.SourceAccount.BankCode]
	if account == nil {
		return errors.New("source account not found")
	}

	account.ReservedBalance -= decision.RequiredReserve
	account.CurrentBalance -= decision.RequiredReserve
	account.TodayOutflow += decision.RequiredReserve

	return r.db.Model(&BankAccount{}).
		Where("id = ?", account.ID).
		Updates(map[string]interface{}{
			"reserved_balance": account.ReservedBalance,
			"current_balance":  account.CurrentBalance,
			"today_outflow":    account.TodayOutflow,
			"updated_at":       time.Now(),
		}).Error
}

// ReleaseBalance releases reserved balance after failed transfer
func (r *MLSmartRouter) ReleaseBalance(ctx context.Context, decision *RoutingDecision) error {
	if decision.SourceAccount == nil {
		return errors.New("no source account in decision")
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	account := r.accounts[decision.SourceAccount.BankCode]
	if account == nil {
		return errors.New("source account not found")
	}

	account.ReservedBalance -= decision.RequiredReserve
	account.AvailableBalance += decision.RequiredReserve

	return r.db.Model(&BankAccount{}).
		Where("id = ?", account.ID).
		Updates(map[string]interface{}{
			"reserved_balance":  account.ReservedBalance,
			"available_balance": account.AvailableBalance,
			"updated_at":        time.Now(),
		}).Error
}

// RefreshAccountBalances refreshes cached account balances from database
func (r *MLSmartRouter) RefreshAccountBalances() error {
	return r.loadBankAccounts()
}
