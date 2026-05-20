package multibank

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

// TransferRail represents the type of transfer rail
type TransferRail string

const (
	RailOnUs   TransferRail = "on_us"   // Intra-bank transfer (same bank)
	RailNIP    TransferRail = "nip"     // NIBSS Instant Payment
	RailNEFT   TransferRail = "neft"    // NIBSS Electronic Funds Transfer
	RailRTGS   TransferRail = "rtgs"    // Real-Time Gross Settlement
	RailDirect TransferRail = "direct"  // Direct bank API
)

// TransferPriority represents the priority of a transfer
type TransferPriority string

const (
	PriorityCritical TransferPriority = "critical" // Must succeed immediately
	PriorityHigh     TransferPriority = "high"     // Time-sensitive
	PriorityNormal   TransferPriority = "normal"   // Standard transfer
	PriorityLow      TransferPriority = "low"      // Can be batched
)

// RoutingDecision represents the output of the smart router
type RoutingDecision struct {
	TransferID       string           `json:"transfer_id"`
	SelectedRail     TransferRail     `json:"selected_rail"`
	SourceAccount    *BankAccount     `json:"source_account"`
	DestinationBank  *NigerianBank    `json:"destination_bank"`
	EstimatedLatency int              `json:"estimated_latency_ms"`
	EstimatedCost    float64          `json:"estimated_cost"`
	SuccessProbability float64        `json:"success_probability"`
	Score            float64          `json:"score"`
	Reason           string           `json:"reason"`
	FallbackRails    []TransferRail   `json:"fallback_rails"`
	RequiredReserve  float64          `json:"required_reserve"`
	TimeoutPolicy    time.Duration    `json:"timeout_policy"`
	CreatedAt        time.Time        `json:"created_at"`
}

// TransferRequest represents a transfer request to be routed
type TransferRequest struct {
	TransferID        string           `json:"transfer_id"`
	Amount            float64          `json:"amount"`
	Currency          string           `json:"currency"`
	SourceAgentID     string           `json:"source_agent_id"`
	DestAccountNumber string           `json:"dest_account_number"`
	DestBankCode      string           `json:"dest_bank_code"`
	DestAccountName   string           `json:"dest_account_name"`
	Narration         string           `json:"narration"`
	Reference         string           `json:"reference"`
	Priority          TransferPriority `json:"priority"`
	IdempotencyKey    string           `json:"idempotency_key"`
	Metadata          map[string]interface{} `json:"metadata"`
}

// BankAccount represents our prefunded account at a bank
type BankAccount struct {
	ID                string    `json:"id" gorm:"primaryKey"`
	BankCode          string    `json:"bank_code" gorm:"index"`
	BankName          string    `json:"bank_name"`
	AccountNumber     string    `json:"account_number"`
	AccountName       string    `json:"account_name"`
	Currency          string    `json:"currency" gorm:"default:'NGN'"`
	CurrentBalance    float64   `json:"current_balance"`
	AvailableBalance  float64   `json:"available_balance"`
	ReservedBalance   float64   `json:"reserved_balance"`
	MinimumBalance    float64   `json:"minimum_balance"`
	MaxDailyOutflow   float64   `json:"max_daily_outflow"`
	TodayOutflow      float64   `json:"today_outflow"`
	IsActive          bool      `json:"is_active" gorm:"default:true"`
	HasOnUsCapability bool      `json:"has_on_us_capability"`
	LastSyncedAt      time.Time `json:"last_synced_at"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// RoutingConfig holds configuration for the smart router
type RoutingConfig struct {
	// Weights for scoring (must sum to 1.0)
	CostWeight           float64 `json:"cost_weight"`
	SpeedWeight          float64 `json:"speed_weight"`
	SuccessRateWeight    float64 `json:"success_rate_weight"`
	LiquidityWeight      float64 `json:"liquidity_weight"`
	
	// Thresholds
	MinLiquidityRatio    float64 `json:"min_liquidity_ratio"`    // Min available/required ratio
	MaxUtilizationRate   float64 `json:"max_utilization_rate"`   // Max daily outflow utilization
	MinSuccessRate       float64 `json:"min_success_rate"`       // Min acceptable success rate
	
	// Costs per rail (in NGN)
	NIPCost              float64 `json:"nip_cost"`
	NEFTCost             float64 `json:"neft_cost"`
	OnUsCost             float64 `json:"on_us_cost"`
	DirectCost           float64 `json:"direct_cost"`
	
	// Timeouts per rail
	NIPTimeout           time.Duration `json:"nip_timeout"`
	NEFTTimeout          time.Duration `json:"neft_timeout"`
	OnUsTimeout          time.Duration `json:"on_us_timeout"`
	DirectTimeout        time.Duration `json:"direct_timeout"`
}

// DefaultRoutingConfig returns the default routing configuration
func DefaultRoutingConfig() *RoutingConfig {
	return &RoutingConfig{
		CostWeight:         0.20,
		SpeedWeight:        0.25,
		SuccessRateWeight:  0.35,
		LiquidityWeight:    0.20,
		
		MinLiquidityRatio:  1.5,
		MaxUtilizationRate: 0.8,
		MinSuccessRate:     0.90,
		
		NIPCost:            52.50,  // NIBSS NIP fee
		NEFTCost:           25.00,  // NEFT fee
		OnUsCost:           0.00,   // Free for on-us
		DirectCost:         10.00,  // Direct API fee
		
		NIPTimeout:         30 * time.Second,
		NEFTTimeout:        24 * time.Hour,
		OnUsTimeout:        10 * time.Second,
		DirectTimeout:      15 * time.Second,
	}
}

// SmartRouter implements intelligent payment routing
type SmartRouter struct {
	db            *gorm.DB
	redis         *redis.Client
	bankDirectory *BankDirectory
	config        *RoutingConfig
	accounts      map[string]*BankAccount // Keyed by bank code
	mu            sync.RWMutex
}

// NewSmartRouter creates a new smart router
func NewSmartRouter(db *gorm.DB, redis *redis.Client, bankDirectory *BankDirectory, config *RoutingConfig) *SmartRouter {
	if config == nil {
		config = DefaultRoutingConfig()
	}
	
	router := &SmartRouter{
		db:            db,
		redis:         redis,
		bankDirectory: bankDirectory,
		config:        config,
		accounts:      make(map[string]*BankAccount),
	}
	
	// Load bank accounts from database
	router.loadBankAccounts()
	
	return router
}

// loadBankAccounts loads all bank accounts from the database
func (r *SmartRouter) loadBankAccounts() error {
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

// Route determines the optimal route for a transfer
func (r *SmartRouter) Route(ctx context.Context, req *TransferRequest) (*RoutingDecision, error) {
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
	
	// Score and rank candidates
	r.scoreCandidates(candidates, req)
	
	// Sort by score (descending)
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].Score > candidates[j].Score
	})
	
	// Select best candidate
	best := candidates[0]
	
	// Set fallback rails
	if len(candidates) > 1 {
		for i := 1; i < len(candidates) && i <= 3; i++ {
			best.FallbackRails = append(best.FallbackRails, candidates[i].SelectedRail)
		}
	}
	
	// Cache the decision
	r.cacheDecision(ctx, best)
	
	return best, nil
}

// generateCandidates generates all possible routing candidates
func (r *SmartRouter) generateCandidates(ctx context.Context, req *TransferRequest, destBank *NigerianBank, withinHours bool) []*RoutingDecision {
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
				EstimatedLatency:   destBank.AvgLatencyMs / 2, // On-us is faster
				EstimatedCost:      r.config.OnUsCost,
				SuccessProbability: min(destBank.AvgSuccessRate * 1.05, 1.0), // On-us has higher success
				RequiredReserve:    req.Amount,
				TimeoutPolicy:      r.config.OnUsTimeout,
				Reason:             "On-us transfer via matching bank account",
				CreatedAt:          time.Now(),
			})
		}
	}
	
	// Check for direct API opportunity
	if destBank.HasDirectAPI {
		// Find any account with sufficient liquidity
		for _, account := range r.accounts {
			if account.IsActive && r.hasAvailableLiquidity(account, req.Amount) {
				candidates = append(candidates, &RoutingDecision{
					TransferID:         req.TransferID,
					SelectedRail:       RailDirect,
					SourceAccount:      account,
					DestinationBank:    destBank,
					EstimatedLatency:   destBank.AvgLatencyMs,
					EstimatedCost:      r.config.DirectCost,
					SuccessProbability: destBank.AvgSuccessRate,
					RequiredReserve:    req.Amount,
					TimeoutPolicy:      r.config.DirectTimeout,
					Reason:             fmt.Sprintf("Direct API via %s", account.BankName),
					CreatedAt:          time.Now(),
				})
				break // Only need one direct option
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
					EstimatedLatency:   1000 + destBank.AvgLatencyMs, // NIP adds overhead
					EstimatedCost:      r.config.NIPCost,
					SuccessProbability: destBank.AvgSuccessRate * 0.98, // Slightly lower for interbank
					RequiredReserve:    req.Amount + r.config.NIPCost,
					TimeoutPolicy:      r.config.NIPTimeout,
					Reason:             fmt.Sprintf("NIBSS NIP via %s", account.BankName),
					CreatedAt:          time.Now(),
				})
				break // Only need one NIP option
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
					EstimatedLatency:   3600000, // 1 hour average
					EstimatedCost:      r.config.NEFTCost,
					SuccessProbability: 0.99, // NEFT is very reliable
					RequiredReserve:    req.Amount + r.config.NEFTCost,
					TimeoutPolicy:      r.config.NEFTTimeout,
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
func (r *SmartRouter) hasAvailableLiquidity(account *BankAccount, amount float64) bool {
	// Check minimum balance requirement
	availableForTransfer := account.AvailableBalance - account.MinimumBalance
	if availableForTransfer < amount*r.config.MinLiquidityRatio {
		return false
	}
	
	// Check daily outflow limit
	remainingDailyLimit := account.MaxDailyOutflow - account.TodayOutflow
	if remainingDailyLimit < amount {
		return false
	}
	
	// Check utilization rate
	utilizationRate := account.TodayOutflow / account.MaxDailyOutflow
	if utilizationRate > r.config.MaxUtilizationRate {
		return false
	}
	
	return true
}

// scoreCandidates scores all routing candidates
func (r *SmartRouter) scoreCandidates(candidates []*RoutingDecision, req *TransferRequest) {
	if len(candidates) == 0 {
		return
	}
	
	// Find min/max for normalization
	var minCost, maxCost float64 = math.MaxFloat64, 0
	var minLatency, maxLatency int = math.MaxInt32, 0
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
		// Normalize scores (0-1, higher is better)
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
		
		// Liquidity score (based on available balance ratio)
		if c.SourceAccount != nil {
			availableRatio := c.SourceAccount.AvailableBalance / c.RequiredReserve
			liquidityScore = min(availableRatio/r.config.MinLiquidityRatio, 1.0)
		}
		
		// Priority adjustments
		switch req.Priority {
		case PriorityCritical:
			// Prioritize success and speed
			c.Score = r.config.SuccessRateWeight*1.5*successScore +
				r.config.SpeedWeight*1.5*speedScore +
				r.config.CostWeight*0.5*costScore +
				r.config.LiquidityWeight*liquidityScore
		case PriorityHigh:
			// Prioritize speed
			c.Score = r.config.SuccessRateWeight*successScore +
				r.config.SpeedWeight*1.3*speedScore +
				r.config.CostWeight*0.7*costScore +
				r.config.LiquidityWeight*liquidityScore
		case PriorityLow:
			// Prioritize cost
			c.Score = r.config.SuccessRateWeight*successScore +
				r.config.SpeedWeight*0.5*speedScore +
				r.config.CostWeight*1.5*costScore +
				r.config.LiquidityWeight*liquidityScore
		default:
			// Normal priority - balanced
			c.Score = r.config.SuccessRateWeight*successScore +
				r.config.SpeedWeight*speedScore +
				r.config.CostWeight*costScore +
				r.config.LiquidityWeight*liquidityScore
		}
		
		// Bonus for on-us (always preferred when available)
		if c.SelectedRail == RailOnUs {
			c.Score *= 1.2
		}
	}
}

// cacheDecision caches the routing decision in Redis
func (r *SmartRouter) cacheDecision(ctx context.Context, decision *RoutingDecision) {
	if r.redis == nil {
		return
	}
	
	data, _ := json.Marshal(decision)
	r.redis.Set(ctx, fmt.Sprintf("routing:decision:%s", decision.TransferID), data, 24*time.Hour)
}

// GetDecision retrieves a cached routing decision
func (r *SmartRouter) GetDecision(ctx context.Context, transferID string) (*RoutingDecision, error) {
	if r.redis == nil {
		return nil, errors.New("redis not available")
	}
	
	data, err := r.redis.Get(ctx, fmt.Sprintf("routing:decision:%s", transferID)).Bytes()
	if err != nil {
		return nil, err
	}
	
	var decision RoutingDecision
	if err := json.Unmarshal(data, &decision); err != nil {
		return nil, err
	}
	
	return &decision, nil
}

// ReserveBalance reserves balance for a transfer
func (r *SmartRouter) ReserveBalance(ctx context.Context, decision *RoutingDecision) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	
	account := decision.SourceAccount
	if account == nil {
		return errors.New("no source account in decision")
	}
	
	// Check available balance
	if account.AvailableBalance < decision.RequiredReserve {
		return errors.New("insufficient available balance")
	}
	
	// Reserve the balance
	account.AvailableBalance -= decision.RequiredReserve
	account.ReservedBalance += decision.RequiredReserve
	
	// Update in database
	return r.db.Model(&BankAccount{}).
		Where("id = ?", account.ID).
		Updates(map[string]interface{}{
			"available_balance": account.AvailableBalance,
			"reserved_balance":  account.ReservedBalance,
			"updated_at":        time.Now(),
		}).Error
}

// CommitBalance commits a reserved balance after successful transfer
func (r *SmartRouter) CommitBalance(ctx context.Context, decision *RoutingDecision) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	
	account := decision.SourceAccount
	if account == nil {
		return errors.New("no source account in decision")
	}
	
	// Release from reserved, deduct from current
	account.ReservedBalance -= decision.RequiredReserve
	account.CurrentBalance -= decision.RequiredReserve
	account.TodayOutflow += decision.RequiredReserve
	
	// Update in database
	return r.db.Model(&BankAccount{}).
		Where("id = ?", account.ID).
		Updates(map[string]interface{}{
			"reserved_balance": account.ReservedBalance,
			"current_balance":  account.CurrentBalance,
			"today_outflow":    account.TodayOutflow,
			"updated_at":       time.Now(),
		}).Error
}

// ReleaseBalance releases a reserved balance after failed transfer
func (r *SmartRouter) ReleaseBalance(ctx context.Context, decision *RoutingDecision) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	
	account := decision.SourceAccount
	if account == nil {
		return errors.New("no source account in decision")
	}
	
	// Release from reserved back to available
	account.ReservedBalance -= decision.RequiredReserve
	account.AvailableBalance += decision.RequiredReserve
	
	// Update in database
	return r.db.Model(&BankAccount{}).
		Where("id = ?", account.ID).
		Updates(map[string]interface{}{
			"available_balance": account.AvailableBalance,
			"reserved_balance":  account.ReservedBalance,
			"updated_at":        time.Now(),
		}).Error
}

// GetAccountBalance gets the current balance for a bank account
func (r *SmartRouter) GetAccountBalance(bankCode string) (*BankAccount, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	
	account, exists := r.accounts[bankCode]
	if !exists {
		return nil, fmt.Errorf("no account found for bank %s", bankCode)
	}
	
	return account, nil
}

// GetAllAccountBalances returns all bank account balances
func (r *SmartRouter) GetAllAccountBalances() []*BankAccount {
	r.mu.RLock()
	defer r.mu.RUnlock()
	
	accounts := make([]*BankAccount, 0, len(r.accounts))
	for _, account := range r.accounts {
		accounts = append(accounts, account)
	}
	
	return accounts
}

// RefreshAccountBalances refreshes all account balances from the database
func (r *SmartRouter) RefreshAccountBalances() error {
	return r.loadBankAccounts()
}

// Helper function
func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
