package multibank

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

// LiquidityThreshold defines thresholds for liquidity alerts
type LiquidityThreshold struct {
	CriticalLow  float64 `json:"critical_low"`  // Below this triggers critical alert
	Low          float64 `json:"low"`           // Below this triggers low alert
	Optimal      float64 `json:"optimal"`       // Target balance
	High         float64 `json:"high"`          // Above this triggers high alert
	CriticalHigh float64 `json:"critical_high"` // Above this triggers critical high alert
}

// LiquidityAlert represents a liquidity alert
type LiquidityAlert struct {
	ID           string    `json:"id" gorm:"primaryKey"`
	BankCode     string    `json:"bank_code" gorm:"index"`
	BankName     string    `json:"bank_name"`
	AlertType    string    `json:"alert_type"` // critical_low, low, high, critical_high
	CurrentBalance float64 `json:"current_balance"`
	Threshold    float64   `json:"threshold"`
	Message      string    `json:"message"`
	IsResolved   bool      `json:"is_resolved" gorm:"default:false"`
	ResolvedAt   *time.Time `json:"resolved_at"`
	CreatedAt    time.Time `json:"created_at"`
}

// SweepInstruction represents an instruction to move funds between accounts
type SweepInstruction struct {
	ID              string    `json:"id" gorm:"primaryKey"`
	SourceBankCode  string    `json:"source_bank_code"`
	SourceAccount   string    `json:"source_account"`
	DestBankCode    string    `json:"dest_bank_code"`
	DestAccount     string    `json:"dest_account"`
	Amount          float64   `json:"amount"`
	Currency        string    `json:"currency" gorm:"default:'NGN'"`
	Reason          string    `json:"reason"`
	Status          string    `json:"status"` // pending, processing, completed, failed
	TransferRef     string    `json:"transfer_ref"`
	ScheduledAt     time.Time `json:"scheduled_at"`
	ExecutedAt      *time.Time `json:"executed_at"`
	CreatedAt       time.Time `json:"created_at"`
}

// LiquidityForecast represents a liquidity forecast
type LiquidityForecast struct {
	BankCode          string    `json:"bank_code"`
	BankName          string    `json:"bank_name"`
	CurrentBalance    float64   `json:"current_balance"`
	PredictedInflow   float64   `json:"predicted_inflow"`
	PredictedOutflow  float64   `json:"predicted_outflow"`
	PredictedBalance  float64   `json:"predicted_balance"`
	ForecastPeriod    string    `json:"forecast_period"` // 1h, 4h, 24h
	ConfidenceLevel   float64   `json:"confidence_level"`
	RecommendedAction string    `json:"recommended_action"`
	GeneratedAt       time.Time `json:"generated_at"`
}

// LiquidityManager manages liquidity across all bank accounts
type LiquidityManager struct {
	db            *gorm.DB
	redis         *redis.Client
	router        *SmartRouter
	connectorMgr  *ConnectorManager
	thresholds    map[string]*LiquidityThreshold // Keyed by bank code
	mu            sync.RWMutex
}

// NewLiquidityManager creates a new liquidity manager
func NewLiquidityManager(db *gorm.DB, redis *redis.Client, router *SmartRouter, connectorMgr *ConnectorManager) *LiquidityManager {
	lm := &LiquidityManager{
		db:           db,
		redis:        redis,
		router:       router,
		connectorMgr: connectorMgr,
		thresholds:   make(map[string]*LiquidityThreshold),
	}
	
	// Set default thresholds for all accounts
	lm.initializeDefaultThresholds()
	
	return lm
}

// initializeDefaultThresholds sets default thresholds based on account limits
func (lm *LiquidityManager) initializeDefaultThresholds() {
	accounts := lm.router.GetAllAccountBalances()
	
	lm.mu.Lock()
	defer lm.mu.Unlock()
	
	for _, account := range accounts {
		// Default thresholds based on daily limit
		dailyLimit := account.MaxDailyOutflow
		lm.thresholds[account.BankCode] = &LiquidityThreshold{
			CriticalLow:  dailyLimit * 0.1,  // 10% of daily limit
			Low:          dailyLimit * 0.25, // 25% of daily limit
			Optimal:      dailyLimit * 0.5,  // 50% of daily limit
			High:         dailyLimit * 0.8,  // 80% of daily limit
			CriticalHigh: dailyLimit * 1.0,  // 100% of daily limit
		}
	}
}

// SetThreshold sets custom threshold for a bank account
func (lm *LiquidityManager) SetThreshold(bankCode string, threshold *LiquidityThreshold) {
	lm.mu.Lock()
	defer lm.mu.Unlock()
	lm.thresholds[bankCode] = threshold
}

// CheckLiquidity checks liquidity levels and generates alerts
func (lm *LiquidityManager) CheckLiquidity(ctx context.Context) ([]*LiquidityAlert, error) {
	accounts := lm.router.GetAllAccountBalances()
	var alerts []*LiquidityAlert
	
	lm.mu.RLock()
	defer lm.mu.RUnlock()
	
	for _, account := range accounts {
		threshold, exists := lm.thresholds[account.BankCode]
		if !exists {
			continue
		}
		
		var alert *LiquidityAlert
		
		if account.AvailableBalance < threshold.CriticalLow {
			alert = &LiquidityAlert{
				ID:             uuid.New().String(),
				BankCode:       account.BankCode,
				BankName:       account.BankName,
				AlertType:      "critical_low",
				CurrentBalance: account.AvailableBalance,
				Threshold:      threshold.CriticalLow,
				Message:        fmt.Sprintf("CRITICAL: %s balance (%.2f) is below critical threshold (%.2f)", account.BankName, account.AvailableBalance, threshold.CriticalLow),
				CreatedAt:      time.Now(),
			}
		} else if account.AvailableBalance < threshold.Low {
			alert = &LiquidityAlert{
				ID:             uuid.New().String(),
				BankCode:       account.BankCode,
				BankName:       account.BankName,
				AlertType:      "low",
				CurrentBalance: account.AvailableBalance,
				Threshold:      threshold.Low,
				Message:        fmt.Sprintf("LOW: %s balance (%.2f) is below low threshold (%.2f)", account.BankName, account.AvailableBalance, threshold.Low),
				CreatedAt:      time.Now(),
			}
		} else if account.AvailableBalance > threshold.CriticalHigh {
			alert = &LiquidityAlert{
				ID:             uuid.New().String(),
				BankCode:       account.BankCode,
				BankName:       account.BankName,
				AlertType:      "critical_high",
				CurrentBalance: account.AvailableBalance,
				Threshold:      threshold.CriticalHigh,
				Message:        fmt.Sprintf("CRITICAL HIGH: %s balance (%.2f) exceeds critical high threshold (%.2f)", account.BankName, account.AvailableBalance, threshold.CriticalHigh),
				CreatedAt:      time.Now(),
			}
		} else if account.AvailableBalance > threshold.High {
			alert = &LiquidityAlert{
				ID:             uuid.New().String(),
				BankCode:       account.BankCode,
				BankName:       account.BankName,
				AlertType:      "high",
				CurrentBalance: account.AvailableBalance,
				Threshold:      threshold.High,
				Message:        fmt.Sprintf("HIGH: %s balance (%.2f) exceeds high threshold (%.2f)", account.BankName, account.AvailableBalance, threshold.High),
				CreatedAt:      time.Now(),
			}
		}
		
		if alert != nil {
			alerts = append(alerts, alert)
			// Save alert to database
			lm.db.Create(alert)
			// Publish alert to Redis
			lm.publishAlert(ctx, alert)
		}
	}
	
	return alerts, nil
}

// publishAlert publishes an alert to Redis pub/sub
func (lm *LiquidityManager) publishAlert(ctx context.Context, alert *LiquidityAlert) {
	if lm.redis == nil {
		return
	}
	
	data, _ := json.Marshal(alert)
	lm.redis.Publish(ctx, "liquidity:alerts", data)
}

// GenerateSweepPlan generates a plan to rebalance liquidity
func (lm *LiquidityManager) GenerateSweepPlan(ctx context.Context) ([]*SweepInstruction, error) {
	accounts := lm.router.GetAllAccountBalances()
	var instructions []*SweepInstruction
	
	lm.mu.RLock()
	defer lm.mu.RUnlock()
	
	// Categorize accounts by liquidity status
	var lowAccounts, highAccounts []*BankAccount
	
	for _, account := range accounts {
		threshold, exists := lm.thresholds[account.BankCode]
		if !exists {
			continue
		}
		
		if account.AvailableBalance < threshold.Low {
			lowAccounts = append(lowAccounts, account)
		} else if account.AvailableBalance > threshold.High {
			highAccounts = append(highAccounts, account)
		}
	}
	
	// Sort low accounts by deficit (most urgent first)
	sort.Slice(lowAccounts, func(i, j int) bool {
		thresholdI := lm.thresholds[lowAccounts[i].BankCode]
		thresholdJ := lm.thresholds[lowAccounts[j].BankCode]
		deficitI := thresholdI.Optimal - lowAccounts[i].AvailableBalance
		deficitJ := thresholdJ.Optimal - lowAccounts[j].AvailableBalance
		return deficitI > deficitJ
	})
	
	// Sort high accounts by surplus (most excess first)
	sort.Slice(highAccounts, func(i, j int) bool {
		thresholdI := lm.thresholds[highAccounts[i].BankCode]
		thresholdJ := lm.thresholds[highAccounts[j].BankCode]
		surplusI := highAccounts[i].AvailableBalance - thresholdI.Optimal
		surplusJ := highAccounts[j].AvailableBalance - thresholdJ.Optimal
		return surplusI > surplusJ
	})
	
	// Generate sweep instructions
	for _, lowAccount := range lowAccounts {
		threshold := lm.thresholds[lowAccount.BankCode]
		deficit := threshold.Optimal - lowAccount.AvailableBalance
		
		for _, highAccount := range highAccounts {
			if deficit <= 0 {
				break
			}
			
			highThreshold := lm.thresholds[highAccount.BankCode]
			surplus := highAccount.AvailableBalance - highThreshold.Optimal
			
			if surplus <= 0 {
				continue
			}
			
			// Calculate sweep amount
			sweepAmount := min(deficit, surplus)
			
			instruction := &SweepInstruction{
				ID:             uuid.New().String(),
				SourceBankCode: highAccount.BankCode,
				SourceAccount:  highAccount.AccountNumber,
				DestBankCode:   lowAccount.BankCode,
				DestAccount:    lowAccount.AccountNumber,
				Amount:         sweepAmount,
				Currency:       "NGN",
				Reason:         fmt.Sprintf("Rebalance: %s surplus to %s deficit", highAccount.BankName, lowAccount.BankName),
				Status:         "pending",
				ScheduledAt:    time.Now(),
				CreatedAt:      time.Now(),
			}
			
			instructions = append(instructions, instruction)
			deficit -= sweepAmount
			
			// Update surplus tracking
			highAccount.AvailableBalance -= sweepAmount
		}
	}
	
	return instructions, nil
}

// ExecuteSweep executes a sweep instruction
func (lm *LiquidityManager) ExecuteSweep(ctx context.Context, instruction *SweepInstruction) error {
	// Update status to processing
	instruction.Status = "processing"
	lm.db.Save(instruction)
	
	// Create transfer request
	req := &TransferRequest{
		TransferID:        uuid.New().String(),
		Amount:            instruction.Amount,
		Currency:          instruction.Currency,
		DestAccountNumber: instruction.DestAccount,
		DestBankCode:      instruction.DestBankCode,
		Narration:         fmt.Sprintf("Liquidity sweep: %s", instruction.ID),
		Reference:         instruction.ID,
		Priority:          PriorityNormal,
		IdempotencyKey:    instruction.ID,
	}
	
	// Route the transfer
	decision, err := lm.router.Route(ctx, req)
	if err != nil {
		instruction.Status = "failed"
		lm.db.Save(instruction)
		return fmt.Errorf("routing failed: %w", err)
	}
	
	// Reserve balance
	if err := lm.router.ReserveBalance(ctx, decision); err != nil {
		instruction.Status = "failed"
		lm.db.Save(instruction)
		return fmt.Errorf("reserve failed: %w", err)
	}
	
	// Execute transfer
	result, err := lm.connectorMgr.ExecuteTransfer(ctx, req, decision)
	if err != nil {
		lm.router.ReleaseBalance(ctx, decision)
		instruction.Status = "failed"
		lm.db.Save(instruction)
		return fmt.Errorf("transfer failed: %w", err)
	}
	
	// Update based on result
	if result.Status == StatusSuccessful {
		lm.router.CommitBalance(ctx, decision)
		instruction.Status = "completed"
		instruction.TransferRef = result.ProviderReference
		now := time.Now()
		instruction.ExecutedAt = &now
	} else {
		lm.router.ReleaseBalance(ctx, decision)
		instruction.Status = "failed"
	}
	
	lm.db.Save(instruction)
	
	return nil
}

// ExecuteSweepPlan executes all sweep instructions in a plan
func (lm *LiquidityManager) ExecuteSweepPlan(ctx context.Context, instructions []*SweepInstruction) error {
	for _, instruction := range instructions {
		if err := lm.ExecuteSweep(ctx, instruction); err != nil {
			// Log error but continue with other sweeps
			fmt.Printf("Sweep %s failed: %v\n", instruction.ID, err)
		}
	}
	return nil
}

// ForecastLiquidity generates liquidity forecasts
func (lm *LiquidityManager) ForecastLiquidity(ctx context.Context, period string) ([]*LiquidityForecast, error) {
	accounts := lm.router.GetAllAccountBalances()
	var forecasts []*LiquidityForecast
	
	// Get historical transaction data from Redis/DB
	// This is a simplified forecast - in production would use ML models
	
	for _, account := range accounts {
		// Get historical averages (simplified)
		avgInflow := account.MaxDailyOutflow * 0.4  // Assume 40% of limit as avg inflow
		avgOutflow := account.TodayOutflow * 1.1    // Assume 10% more than today
		
		var multiplier float64
		switch period {
		case "1h":
			multiplier = 1.0 / 24.0
		case "4h":
			multiplier = 4.0 / 24.0
		case "24h":
			multiplier = 1.0
		default:
			multiplier = 1.0
		}
		
		predictedInflow := avgInflow * multiplier
		predictedOutflow := avgOutflow * multiplier
		predictedBalance := account.AvailableBalance + predictedInflow - predictedOutflow
		
		var recommendedAction string
		threshold := lm.thresholds[account.BankCode]
		if threshold != nil {
			if predictedBalance < threshold.Low {
				recommendedAction = "FUND: Predicted balance will be low"
			} else if predictedBalance > threshold.High {
				recommendedAction = "SWEEP: Predicted balance will be high"
			} else {
				recommendedAction = "HOLD: Balance within optimal range"
			}
		}
		
		forecast := &LiquidityForecast{
			BankCode:          account.BankCode,
			BankName:          account.BankName,
			CurrentBalance:    account.AvailableBalance,
			PredictedInflow:   predictedInflow,
			PredictedOutflow:  predictedOutflow,
			PredictedBalance:  predictedBalance,
			ForecastPeriod:    period,
			ConfidenceLevel:   0.75, // Simplified confidence
			RecommendedAction: recommendedAction,
			GeneratedAt:       time.Now(),
		}
		
		forecasts = append(forecasts, forecast)
	}
	
	return forecasts, nil
}

// GetLiquiditySummary returns a summary of liquidity across all accounts
func (lm *LiquidityManager) GetLiquiditySummary(ctx context.Context) (map[string]interface{}, error) {
	accounts := lm.router.GetAllAccountBalances()
	
	var totalBalance, totalAvailable, totalReserved float64
	var healthyCount, lowCount, criticalCount int
	
	lm.mu.RLock()
	defer lm.mu.RUnlock()
	
	for _, account := range accounts {
		totalBalance += account.CurrentBalance
		totalAvailable += account.AvailableBalance
		totalReserved += account.ReservedBalance
		
		threshold, exists := lm.thresholds[account.BankCode]
		if exists {
			if account.AvailableBalance < threshold.CriticalLow {
				criticalCount++
			} else if account.AvailableBalance < threshold.Low {
				lowCount++
			} else {
				healthyCount++
			}
		}
	}
	
	return map[string]interface{}{
		"total_accounts":     len(accounts),
		"total_balance":      totalBalance,
		"total_available":    totalAvailable,
		"total_reserved":     totalReserved,
		"healthy_accounts":   healthyCount,
		"low_accounts":       lowCount,
		"critical_accounts":  criticalCount,
		"last_checked":       time.Now(),
	}, nil
}

// ResetDailyOutflows resets daily outflow counters (call at midnight)
func (lm *LiquidityManager) ResetDailyOutflows(ctx context.Context) error {
	return lm.db.Model(&BankAccount{}).
		Where("is_active = ?", true).
		Update("today_outflow", 0).Error
}

// SyncBalancesFromBanks syncs balances from actual bank accounts
func (lm *LiquidityManager) SyncBalancesFromBanks(ctx context.Context) error {
	accounts := lm.router.GetAllAccountBalances()
	
	for _, account := range accounts {
		// Get balance from bank connector
		connector, exists := lm.connectorMgr.directConnectors[account.BankCode]
		if !exists {
			continue
		}
		
		result, err := connector.BalanceEnquiry(ctx, account.AccountNumber)
		if err != nil {
			continue
		}
		
		// Update account balance
		lm.db.Model(&BankAccount{}).
			Where("id = ?", account.ID).
			Updates(map[string]interface{}{
				"current_balance":   result.LedgerBalance,
				"available_balance": result.AvailableBalance,
				"last_synced_at":    time.Now(),
				"updated_at":        time.Now(),
			})
	}
	
	// Refresh router's cached accounts
	return lm.router.RefreshAccountBalances()
}

// StartLiquidityMonitor starts background liquidity monitoring
func (lm *LiquidityManager) StartLiquidityMonitor(ctx context.Context, checkInterval time.Duration) {
	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()
	
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// Check liquidity and generate alerts
			alerts, err := lm.CheckLiquidity(ctx)
			if err != nil {
				fmt.Printf("Liquidity check error: %v\n", err)
				continue
			}
			
			// If there are critical alerts, generate sweep plan
			hasCritical := false
			for _, alert := range alerts {
				if alert.AlertType == "critical_low" || alert.AlertType == "critical_high" {
					hasCritical = true
					break
				}
			}
			
			if hasCritical {
				plan, err := lm.GenerateSweepPlan(ctx)
				if err != nil {
					fmt.Printf("Sweep plan generation error: %v\n", err)
					continue
				}
				
				// Auto-execute sweep plan for critical situations
				if len(plan) > 0 {
					go lm.ExecuteSweepPlan(ctx, plan)
				}
			}
		}
	}
}
