package multibank

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

// BankStatement represents a bank statement record
type BankStatement struct {
	ID              string    `json:"id" gorm:"primaryKey"`
	BankCode        string    `json:"bank_code" gorm:"index"`
	AccountNumber   string    `json:"account_number" gorm:"index"`
	TransactionDate time.Time `json:"transaction_date" gorm:"index"`
	ValueDate       time.Time `json:"value_date"`
	Reference       string    `json:"reference" gorm:"index"`
	Narration       string    `json:"narration"`
	DebitAmount     float64   `json:"debit_amount"`
	CreditAmount    float64   `json:"credit_amount"`
	Balance         float64   `json:"balance"`
	TransactionType string    `json:"transaction_type"` // debit, credit
	Channel         string    `json:"channel"`          // NIP, NEFT, POS, ATM, etc.
	CounterpartyAccount string `json:"counterparty_account"`
	CounterpartyBank    string `json:"counterparty_bank"`
	CounterpartyName    string `json:"counterparty_name"`
	IsMatched       bool      `json:"is_matched" gorm:"default:false"`
	MatchedWith     string    `json:"matched_with"` // Internal transaction ID
	MatchConfidence float64   `json:"match_confidence"`
	ImportedAt      time.Time `json:"imported_at"`
	CreatedAt       time.Time `json:"created_at"`
}

// InternalTransaction represents our internal transaction record
type InternalTransaction struct {
	ID                string    `json:"id" gorm:"primaryKey"`
	TransferID        string    `json:"transfer_id" gorm:"index"`
	BankCode          string    `json:"bank_code" gorm:"index"`
	AccountNumber     string    `json:"account_number" gorm:"index"`
	TransactionDate   time.Time `json:"transaction_date" gorm:"index"`
	Amount            float64   `json:"amount"`
	Currency          string    `json:"currency" gorm:"default:'NGN'"`
	TransactionType   string    `json:"transaction_type"` // debit, credit
	Reference         string    `json:"reference" gorm:"index"`
	ProviderReference string    `json:"provider_reference"`
	SessionID         string    `json:"session_id"`
	Narration         string    `json:"narration"`
	CounterpartyAccount string `json:"counterparty_account"`
	CounterpartyBank    string `json:"counterparty_bank"`
	Status            string    `json:"status"` // pending, confirmed, reconciled, disputed
	IsReconciled      bool      `json:"is_reconciled" gorm:"default:false"`
	ReconciledWith    string    `json:"reconciled_with"` // Bank statement ID
	ReconciledAt      *time.Time `json:"reconciled_at"`
	CreatedAt         time.Time `json:"created_at"`
}

// ReconciliationResult represents the result of a reconciliation run
type ReconciliationResult struct {
	ID                  string    `json:"id" gorm:"primaryKey"`
	BankCode            string    `json:"bank_code"`
	AccountNumber       string    `json:"account_number"`
	ReconciliationDate  time.Time `json:"reconciliation_date"`
	PeriodStart         time.Time `json:"period_start"`
	PeriodEnd           time.Time `json:"period_end"`
	OpeningBalance      float64   `json:"opening_balance"`
	ClosingBalance      float64   `json:"closing_balance"`
	TotalDebits         float64   `json:"total_debits"`
	TotalCredits        float64   `json:"total_credits"`
	MatchedCount        int       `json:"matched_count"`
	UnmatchedBankCount  int       `json:"unmatched_bank_count"`
	UnmatchedInternalCount int    `json:"unmatched_internal_count"`
	DiscrepancyAmount   float64   `json:"discrepancy_amount"`
	Status              string    `json:"status"` // completed, partial, failed
	Notes               string    `json:"notes"`
	CreatedAt           time.Time `json:"created_at"`
}

// ReconciliationException represents an exception during reconciliation
type ReconciliationException struct {
	ID                string    `json:"id" gorm:"primaryKey"`
	ReconciliationID  string    `json:"reconciliation_id" gorm:"index"`
	ExceptionType     string    `json:"exception_type"` // unmatched_bank, unmatched_internal, amount_mismatch, duplicate
	BankStatementID   string    `json:"bank_statement_id"`
	InternalTxnID     string    `json:"internal_txn_id"`
	BankAmount        float64   `json:"bank_amount"`
	InternalAmount    float64   `json:"internal_amount"`
	Difference        float64   `json:"difference"`
	Description       string    `json:"description"`
	Status            string    `json:"status"` // pending, resolved, escalated
	ResolvedBy        string    `json:"resolved_by"`
	ResolvedAt        *time.Time `json:"resolved_at"`
	Resolution        string    `json:"resolution"`
	CreatedAt         time.Time `json:"created_at"`
}

// ReconciliationEngine handles bank statement reconciliation
type ReconciliationEngine struct {
	db    *gorm.DB
	redis *redis.Client
	mu    sync.RWMutex
}

// NewReconciliationEngine creates a new reconciliation engine
func NewReconciliationEngine(db *gorm.DB, redis *redis.Client) *ReconciliationEngine {
	return &ReconciliationEngine{
		db:    db,
		redis: redis,
	}
}

// ImportBankStatement imports a bank statement from CSV
func (re *ReconciliationEngine) ImportBankStatement(ctx context.Context, bankCode, accountNumber string, reader io.Reader) (int, error) {
	csvReader := csv.NewReader(reader)
	
	// Read header
	header, err := csvReader.Read()
	if err != nil {
		return 0, fmt.Errorf("failed to read header: %w", err)
	}
	
	// Map header columns
	colMap := make(map[string]int)
	for i, col := range header {
		colMap[strings.ToLower(strings.TrimSpace(col))] = i
	}
	
	var statements []*BankStatement
	importedAt := time.Now()
	
	for {
		record, err := csvReader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue // Skip malformed rows
		}
		
		stmt := &BankStatement{
			ID:            uuid.New().String(),
			BankCode:      bankCode,
			AccountNumber: accountNumber,
			ImportedAt:    importedAt,
			CreatedAt:     time.Now(),
		}
		
		// Parse fields based on column mapping
		if idx, ok := colMap["date"]; ok && idx < len(record) {
			stmt.TransactionDate, _ = time.Parse("2006-01-02", record[idx])
		}
		if idx, ok := colMap["transaction date"]; ok && idx < len(record) {
			stmt.TransactionDate, _ = time.Parse("2006-01-02", record[idx])
		}
		if idx, ok := colMap["value date"]; ok && idx < len(record) {
			stmt.ValueDate, _ = time.Parse("2006-01-02", record[idx])
		}
		if idx, ok := colMap["reference"]; ok && idx < len(record) {
			stmt.Reference = record[idx]
		}
		if idx, ok := colMap["narration"]; ok && idx < len(record) {
			stmt.Narration = record[idx]
		}
		if idx, ok := colMap["description"]; ok && idx < len(record) {
			stmt.Narration = record[idx]
		}
		if idx, ok := colMap["debit"]; ok && idx < len(record) {
			fmt.Sscanf(strings.ReplaceAll(record[idx], ",", ""), "%f", &stmt.DebitAmount)
		}
		if idx, ok := colMap["credit"]; ok && idx < len(record) {
			fmt.Sscanf(strings.ReplaceAll(record[idx], ",", ""), "%f", &stmt.CreditAmount)
		}
		if idx, ok := colMap["balance"]; ok && idx < len(record) {
			fmt.Sscanf(strings.ReplaceAll(record[idx], ",", ""), "%f", &stmt.Balance)
		}
		
		// Determine transaction type
		if stmt.DebitAmount > 0 {
			stmt.TransactionType = "debit"
		} else if stmt.CreditAmount > 0 {
			stmt.TransactionType = "credit"
		}
		
		statements = append(statements, stmt)
	}
	
	// Batch insert
	if len(statements) > 0 {
		if err := re.db.CreateInBatches(statements, 100).Error; err != nil {
			return 0, fmt.Errorf("failed to insert statements: %w", err)
		}
	}
	
	return len(statements), nil
}

// Reconcile performs reconciliation for a bank account
func (re *ReconciliationEngine) Reconcile(ctx context.Context, bankCode, accountNumber string, periodStart, periodEnd time.Time) (*ReconciliationResult, error) {
	result := &ReconciliationResult{
		ID:                 uuid.New().String(),
		BankCode:           bankCode,
		AccountNumber:      accountNumber,
		ReconciliationDate: time.Now(),
		PeriodStart:        periodStart,
		PeriodEnd:          periodEnd,
		CreatedAt:          time.Now(),
	}
	
	// Get bank statements for the period
	var bankStatements []BankStatement
	if err := re.db.Where("bank_code = ? AND account_number = ? AND transaction_date BETWEEN ? AND ? AND is_matched = ?",
		bankCode, accountNumber, periodStart, periodEnd, false).
		Order("transaction_date ASC").
		Find(&bankStatements).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch bank statements: %w", err)
	}
	
	// Get internal transactions for the period
	var internalTxns []InternalTransaction
	if err := re.db.Where("bank_code = ? AND account_number = ? AND transaction_date BETWEEN ? AND ? AND is_reconciled = ?",
		bankCode, accountNumber, periodStart, periodEnd, false).
		Order("transaction_date ASC").
		Find(&internalTxns).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch internal transactions: %w", err)
	}
	
	// Calculate totals from bank statements
	for _, stmt := range bankStatements {
		result.TotalDebits += stmt.DebitAmount
		result.TotalCredits += stmt.CreditAmount
	}
	
	// Get opening and closing balances
	if len(bankStatements) > 0 {
		// Opening balance = first statement balance - first transaction amount
		first := bankStatements[0]
		if first.TransactionType == "debit" {
			result.OpeningBalance = first.Balance + first.DebitAmount
		} else {
			result.OpeningBalance = first.Balance - first.CreditAmount
		}
		result.ClosingBalance = bankStatements[len(bankStatements)-1].Balance
	}
	
	// Perform matching
	matchedCount := 0
	var exceptions []*ReconciliationException
	
	// Phase 1: Exact reference matching
	for i := range bankStatements {
		if bankStatements[i].IsMatched {
			continue
		}
		
		for j := range internalTxns {
			if internalTxns[j].IsReconciled {
				continue
			}
			
			// Match by reference
			if re.matchByReference(&bankStatements[i], &internalTxns[j]) {
				// Verify amount
				bankAmount := bankStatements[i].DebitAmount + bankStatements[i].CreditAmount
				if math.Abs(bankAmount-internalTxns[j].Amount) < 0.01 {
					// Perfect match
					re.recordMatch(&bankStatements[i], &internalTxns[j], 1.0)
					matchedCount++
				} else {
					// Amount mismatch
					exceptions = append(exceptions, &ReconciliationException{
						ID:               uuid.New().String(),
						ReconciliationID: result.ID,
						ExceptionType:    "amount_mismatch",
						BankStatementID:  bankStatements[i].ID,
						InternalTxnID:    internalTxns[j].ID,
						BankAmount:       bankAmount,
						InternalAmount:   internalTxns[j].Amount,
						Difference:       bankAmount - internalTxns[j].Amount,
						Description:      fmt.Sprintf("Amount mismatch: Bank %.2f vs Internal %.2f", bankAmount, internalTxns[j].Amount),
						Status:           "pending",
						CreatedAt:        time.Now(),
					})
				}
				break
			}
		}
	}
	
	// Phase 2: Fuzzy matching for unmatched items
	for i := range bankStatements {
		if bankStatements[i].IsMatched {
			continue
		}
		
		bestMatch := -1
		bestConfidence := 0.0
		
		for j := range internalTxns {
			if internalTxns[j].IsReconciled {
				continue
			}
			
			confidence := re.calculateMatchConfidence(&bankStatements[i], &internalTxns[j])
			if confidence > bestConfidence && confidence >= 0.7 {
				bestMatch = j
				bestConfidence = confidence
			}
		}
		
		if bestMatch >= 0 {
			re.recordMatch(&bankStatements[i], &internalTxns[bestMatch], bestConfidence)
			matchedCount++
		}
	}
	
	// Record unmatched bank statements
	for i := range bankStatements {
		if !bankStatements[i].IsMatched {
			result.UnmatchedBankCount++
			exceptions = append(exceptions, &ReconciliationException{
				ID:               uuid.New().String(),
				ReconciliationID: result.ID,
				ExceptionType:    "unmatched_bank",
				BankStatementID:  bankStatements[i].ID,
				BankAmount:       bankStatements[i].DebitAmount + bankStatements[i].CreditAmount,
				Description:      fmt.Sprintf("Unmatched bank statement: %s - %.2f", bankStatements[i].Reference, bankStatements[i].DebitAmount+bankStatements[i].CreditAmount),
				Status:           "pending",
				CreatedAt:        time.Now(),
			})
		}
	}
	
	// Record unmatched internal transactions
	for j := range internalTxns {
		if !internalTxns[j].IsReconciled {
			result.UnmatchedInternalCount++
			exceptions = append(exceptions, &ReconciliationException{
				ID:               uuid.New().String(),
				ReconciliationID: result.ID,
				ExceptionType:    "unmatched_internal",
				InternalTxnID:    internalTxns[j].ID,
				InternalAmount:   internalTxns[j].Amount,
				Description:      fmt.Sprintf("Unmatched internal transaction: %s - %.2f", internalTxns[j].Reference, internalTxns[j].Amount),
				Status:           "pending",
				CreatedAt:        time.Now(),
			})
		}
	}
	
	// Calculate discrepancy
	result.MatchedCount = matchedCount
	result.DiscrepancyAmount = result.TotalCredits - result.TotalDebits - (result.ClosingBalance - result.OpeningBalance)
	
	// Determine status
	if result.UnmatchedBankCount == 0 && result.UnmatchedInternalCount == 0 && math.Abs(result.DiscrepancyAmount) < 0.01 {
		result.Status = "completed"
	} else if matchedCount > 0 {
		result.Status = "partial"
	} else {
		result.Status = "failed"
	}
	
	// Save result and exceptions
	re.db.Create(result)
	if len(exceptions) > 0 {
		re.db.CreateInBatches(exceptions, 100)
	}
	
	// Publish reconciliation event
	re.publishReconciliationEvent(ctx, result)
	
	return result, nil
}

// matchByReference checks if bank statement and internal transaction match by reference
func (re *ReconciliationEngine) matchByReference(stmt *BankStatement, txn *InternalTransaction) bool {
	// Check various reference fields
	if stmt.Reference != "" && (stmt.Reference == txn.Reference || stmt.Reference == txn.ProviderReference || stmt.Reference == txn.SessionID) {
		return true
	}
	
	// Check if reference is contained in narration
	if txn.Reference != "" && strings.Contains(strings.ToUpper(stmt.Narration), strings.ToUpper(txn.Reference)) {
		return true
	}
	
	return false
}

// calculateMatchConfidence calculates confidence score for fuzzy matching
func (re *ReconciliationEngine) calculateMatchConfidence(stmt *BankStatement, txn *InternalTransaction) float64 {
	var score float64
	
	// Amount match (40% weight)
	bankAmount := stmt.DebitAmount + stmt.CreditAmount
	if math.Abs(bankAmount-txn.Amount) < 0.01 {
		score += 0.4
	} else if math.Abs(bankAmount-txn.Amount)/txn.Amount < 0.01 {
		score += 0.3 // Within 1%
	}
	
	// Date match (30% weight)
	dateDiff := math.Abs(stmt.TransactionDate.Sub(txn.TransactionDate).Hours())
	if dateDiff < 1 {
		score += 0.3
	} else if dateDiff < 24 {
		score += 0.2
	} else if dateDiff < 72 {
		score += 0.1
	}
	
	// Transaction type match (15% weight)
	if (stmt.TransactionType == "debit" && txn.TransactionType == "debit") ||
		(stmt.TransactionType == "credit" && txn.TransactionType == "credit") {
		score += 0.15
	}
	
	// Counterparty match (15% weight)
	if stmt.CounterpartyAccount != "" && stmt.CounterpartyAccount == txn.CounterpartyAccount {
		score += 0.15
	} else if stmt.CounterpartyBank != "" && stmt.CounterpartyBank == txn.CounterpartyBank {
		score += 0.1
	}
	
	return score
}

// recordMatch records a match between bank statement and internal transaction
func (re *ReconciliationEngine) recordMatch(stmt *BankStatement, txn *InternalTransaction, confidence float64) {
	now := time.Now()
	
	stmt.IsMatched = true
	stmt.MatchedWith = txn.ID
	stmt.MatchConfidence = confidence
	re.db.Save(stmt)
	
	txn.IsReconciled = true
	txn.ReconciledWith = stmt.ID
	txn.ReconciledAt = &now
	txn.Status = "reconciled"
	re.db.Save(txn)
}

// publishReconciliationEvent publishes reconciliation event to Redis
func (re *ReconciliationEngine) publishReconciliationEvent(ctx context.Context, result *ReconciliationResult) {
	if re.redis == nil {
		return
	}
	
	event := map[string]interface{}{
		"event_type":       "reconciliation_completed",
		"reconciliation_id": result.ID,
		"bank_code":        result.BankCode,
		"account_number":   result.AccountNumber,
		"status":           result.Status,
		"matched_count":    result.MatchedCount,
		"unmatched_bank":   result.UnmatchedBankCount,
		"unmatched_internal": result.UnmatchedInternalCount,
		"discrepancy":      result.DiscrepancyAmount,
		"timestamp":        time.Now(),
	}
	
	data, _ := json.Marshal(event)
	re.redis.Publish(ctx, "reconciliation:events", data)
}

// GetReconciliationResult retrieves a reconciliation result
func (re *ReconciliationEngine) GetReconciliationResult(ctx context.Context, id string) (*ReconciliationResult, error) {
	var result ReconciliationResult
	if err := re.db.First(&result, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &result, nil
}

// GetExceptions retrieves exceptions for a reconciliation
func (re *ReconciliationEngine) GetExceptions(ctx context.Context, reconciliationID string) ([]ReconciliationException, error) {
	var exceptions []ReconciliationException
	if err := re.db.Where("reconciliation_id = ?", reconciliationID).Find(&exceptions).Error; err != nil {
		return nil, err
	}
	return exceptions, nil
}

// ResolveException resolves a reconciliation exception
func (re *ReconciliationEngine) ResolveException(ctx context.Context, exceptionID, resolution, resolvedBy string) error {
	now := time.Now()
	return re.db.Model(&ReconciliationException{}).
		Where("id = ?", exceptionID).
		Updates(map[string]interface{}{
			"status":      "resolved",
			"resolution":  resolution,
			"resolved_by": resolvedBy,
			"resolved_at": now,
		}).Error
}

// GetReconciliationSummary returns a summary of reconciliation status
func (re *ReconciliationEngine) GetReconciliationSummary(ctx context.Context, bankCode, accountNumber string) (map[string]interface{}, error) {
	var totalStatements, matchedStatements, unmatchedStatements int64
	var totalInternalTxns, reconciledTxns, unreconciledTxns int64
	
	// Count bank statements
	re.db.Model(&BankStatement{}).Where("bank_code = ? AND account_number = ?", bankCode, accountNumber).Count(&totalStatements)
	re.db.Model(&BankStatement{}).Where("bank_code = ? AND account_number = ? AND is_matched = ?", bankCode, accountNumber, true).Count(&matchedStatements)
	unmatchedStatements = totalStatements - matchedStatements
	
	// Count internal transactions
	re.db.Model(&InternalTransaction{}).Where("bank_code = ? AND account_number = ?", bankCode, accountNumber).Count(&totalInternalTxns)
	re.db.Model(&InternalTransaction{}).Where("bank_code = ? AND account_number = ? AND is_reconciled = ?", bankCode, accountNumber, true).Count(&reconciledTxns)
	unreconciledTxns = totalInternalTxns - reconciledTxns
	
	// Get latest reconciliation
	var latestRecon ReconciliationResult
	re.db.Where("bank_code = ? AND account_number = ?", bankCode, accountNumber).
		Order("reconciliation_date DESC").
		First(&latestRecon)
	
	// Count pending exceptions
	var pendingExceptions int64
	re.db.Model(&ReconciliationException{}).Where("status = ?", "pending").Count(&pendingExceptions)
	
	return map[string]interface{}{
		"bank_code":             bankCode,
		"account_number":        accountNumber,
		"total_bank_statements": totalStatements,
		"matched_statements":    matchedStatements,
		"unmatched_statements":  unmatchedStatements,
		"total_internal_txns":   totalInternalTxns,
		"reconciled_txns":       reconciledTxns,
		"unreconciled_txns":     unreconciledTxns,
		"pending_exceptions":    pendingExceptions,
		"last_reconciliation":   latestRecon.ReconciliationDate,
		"last_status":           latestRecon.Status,
		"match_rate":            float64(matchedStatements) / float64(max(totalStatements, 1)) * 100,
	}, nil
}

// DailyClose performs daily close reconciliation
func (re *ReconciliationEngine) DailyClose(ctx context.Context, bankCode, accountNumber string, closeDate time.Time) (*ReconciliationResult, error) {
	// Get the day's start and end
	startOfDay := time.Date(closeDate.Year(), closeDate.Month(), closeDate.Day(), 0, 0, 0, 0, closeDate.Location())
	endOfDay := startOfDay.Add(24 * time.Hour).Add(-time.Second)
	
	return re.Reconcile(ctx, bankCode, accountNumber, startOfDay, endOfDay)
}

// ScheduleReconciliation schedules automatic reconciliation
func (re *ReconciliationEngine) ScheduleReconciliation(ctx context.Context, bankCode, accountNumber string, schedule string) error {
	// Store schedule in Redis
	if re.redis == nil {
		return fmt.Errorf("redis not available")
	}
	
	scheduleKey := fmt.Sprintf("reconciliation:schedule:%s:%s", bankCode, accountNumber)
	return re.redis.Set(ctx, scheduleKey, schedule, 0).Err()
}

// Helper function
func max(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
