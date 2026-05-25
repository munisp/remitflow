// RemitFlow — Temporal Workflow Worker (Go)
// Implements durable, fault-tolerant workflows for:
//   - Cross-border transfer lifecycle (initiate → compliance → rail → settle)
//   - KYC document review workflow
//   - Monthly partner payout workflow
//   - FX rate lock & expiry workflow
//   - AML case escalation workflow
//
// Temporal server: temporal:7233 (default)

package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

// ─── Task Queues ──────────────────────────────────────────────────────────────
const (
	TaskQueueTransfer = "remitflow-transfers"
	TaskQueueKYC      = "remitflow-kyc"
	TaskQueuePayout   = "remitflow-payouts"
	TaskQueueCompliance = "remitflow-compliance"
)

// ─── Transfer Workflow ────────────────────────────────────────────────────────
type TransferInput struct {
	TransactionID string  `json:"transaction_id"`
	UserID        int64   `json:"user_id"`
	Rail          string  `json:"rail"` // mojaloop, cips, upi, pix
	Amount        float64 `json:"amount"`
	FromCurrency  string  `json:"from_currency"`
	ToCurrency    string  `json:"to_currency"`
	RecipientID   string  `json:"recipient_id"`
	RecipientName string  `json:"recipient_name"`
	Purpose       string  `json:"purpose"`
}

type TransferResult struct {
	Success     bool    `json:"success"`
	ExternalRef string  `json:"external_ref"`
	FinalStatus string  `json:"final_status"`
	FeeAmount   float64 `json:"fee_amount"`
	Message     string  `json:"message"`
}

// TransferWorkflow — durable cross-border transfer lifecycle
func TransferWorkflow(ctx workflow.Context, input TransferInput) (*TransferResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("TransferWorkflow started", "txnID", input.TransactionID, "rail", input.Rail)

	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	// Step 1: Validate transfer
	var validationResult map[string]interface{}
	if err := workflow.ExecuteActivity(ctx, ValidateTransferActivity, input).Get(ctx, &validationResult); err != nil {
		return &TransferResult{Success: false, FinalStatus: "VALIDATION_FAILED", Message: err.Error()}, nil
	}

	// Step 2: AML / Compliance screening
	var complianceResult map[string]interface{}
	complianceCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 60 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{MaximumAttempts: 2},
	})
	if err := workflow.ExecuteActivity(complianceCtx, ComplianceScreenActivity, input).Get(ctx, &complianceResult); err != nil {
		return &TransferResult{Success: false, FinalStatus: "COMPLIANCE_FAILED", Message: err.Error()}, nil
	}
	if cleared, _ := complianceResult["cleared"].(bool); !cleared {
		return &TransferResult{
			Success:     false,
			FinalStatus: "COMPLIANCE_BLOCKED",
			Message:     fmt.Sprintf("AML screening blocked transfer: %v", complianceResult["message"]),
		}, nil
	}

	// Step 3: Reserve funds (debit wallet)
	var reserveResult map[string]interface{}
	if err := workflow.ExecuteActivity(ctx, ReserveFundsActivity, input).Get(ctx, &reserveResult); err != nil {
		return &TransferResult{Success: false, FinalStatus: "RESERVE_FAILED", Message: err.Error()}, nil
	}

	// Step 4: Initiate payment rail transfer
	railCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 120 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval: 5 * time.Second,
			MaximumAttempts: 3,
		},
	})
	var railResult map[string]interface{}
	if err := workflow.ExecuteActivity(railCtx, InitiateRailTransferActivity, input).Get(ctx, &railResult); err != nil {
		// Compensate: release reserved funds
		_ = workflow.ExecuteActivity(ctx, ReleaseFundsActivity, input).Get(ctx, nil)
		return &TransferResult{Success: false, FinalStatus: "RAIL_FAILED", Message: err.Error()}, nil
	}

	externalRef, _ := railResult["external_ref"].(string)
	feeAmount, _ := railResult["fee_amount"].(float64)

	// Step 5: Wait for settlement (with timeout)
	settlementCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 24 * time.Hour, // CIPS can take up to 24h
		HeartbeatTimeout:    5 * time.Minute,
	})
	var settlementResult map[string]interface{}
	if err := workflow.ExecuteActivity(settlementCtx, WaitForSettlementActivity, map[string]interface{}{
		"transaction_id": input.TransactionID,
		"external_ref":   externalRef,
		"rail":           input.Rail,
	}).Get(ctx, &settlementResult); err != nil {
		logger.Warn("Settlement timeout, marking as pending", "txnID", input.TransactionID)
		return &TransferResult{
			Success:     true,
			ExternalRef: externalRef,
			FinalStatus: "PENDING_SETTLEMENT",
			FeeAmount:   feeAmount,
			Message:     "Transfer submitted, awaiting settlement confirmation",
		}, nil
	}

	// Step 6: Confirm settlement, send notification
	_ = workflow.ExecuteActivity(ctx, SendNotificationActivity, map[string]interface{}{
		"user_id":        input.UserID,
		"transaction_id": input.TransactionID,
		"status":         "COMPLETED",
		"amount":         input.Amount,
		"currency":       input.FromCurrency,
	}).Get(ctx, nil)

	logger.Info("TransferWorkflow completed", "txnID", input.TransactionID, "ref", externalRef)
	return &TransferResult{
		Success:     true,
		ExternalRef: externalRef,
		FinalStatus: "COMPLETED",
		FeeAmount:   feeAmount,
		Message:     "Transfer completed successfully",
	}, nil
}

// ─── KYC Workflow ─────────────────────────────────────────────────────────────
type KYCInput struct {
	UserID   int64  `json:"user_id"`
	DocType  string `json:"doc_type"`
	DocURL   string `json:"doc_url"`
	TierGoal string `json:"tier_goal"` // tier1, tier2, tier3
}

func KYCReviewWorkflow(ctx workflow.Context, input KYCInput) (map[string]interface{}, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("KYCReviewWorkflow started", "userID", input.UserID, "docType", input.DocType)

	ao := workflow.ActivityOptions{StartToCloseTimeout: 5 * time.Minute}
	ctx = workflow.WithActivityOptions(ctx, ao)

	// Step 1: OCR extraction
	var ocrResult map[string]interface{}
	if err := workflow.ExecuteActivity(ctx, OCRExtractActivity, input).Get(ctx, &ocrResult); err != nil {
		return map[string]interface{}{"status": "FAILED", "reason": "OCR_ERROR"}, nil
	}

	// Step 2: Liveness check (for selfie)
	if input.DocType == "selfie" {
		var livenessResult map[string]interface{}
		if err := workflow.ExecuteActivity(ctx, LivenessCheckActivity, input).Get(ctx, &livenessResult); err != nil {
			return map[string]interface{}{"status": "FAILED", "reason": "LIVENESS_FAILED"}, nil
		}
	}

	// Step 3: Sanctions / PEP check on extracted name
	var sanctionsResult map[string]interface{}
	if err := workflow.ExecuteActivity(ctx, SanctionsCheckActivity, ocrResult).Get(ctx, &sanctionsResult); err != nil {
		return map[string]interface{}{"status": "FAILED", "reason": "SANCTIONS_CHECK_ERROR"}, nil
	}
	if hit, _ := sanctionsResult["hit"].(bool); hit {
		return map[string]interface{}{"status": "REJECTED", "reason": "SANCTIONS_HIT"}, nil
	}

	// Step 4: Auto-approve or queue for manual review
	riskScore, _ := ocrResult["risk_score"].(float64)
	if riskScore < 0.3 {
		return map[string]interface{}{"status": "APPROVED", "tier": input.TierGoal}, nil
	}

	// Wait for manual review signal (up to 72 hours)
	reviewCtx, cancel := workflow.WithCancel(ctx)
	defer cancel()
	reviewSignal := workflow.GetSignalChannel(reviewCtx, "kyc-review-decision")
	var decision map[string]interface{}
	timerFired := false

	workflow.Go(ctx, func(ctx workflow.Context) {
		workflow.NewTimer(ctx, 72*time.Hour).Get(ctx, nil)
		timerFired = true
		cancel()
	})

	reviewSignal.Receive(ctx, &decision)
	if timerFired {
		return map[string]interface{}{"status": "EXPIRED", "reason": "REVIEW_TIMEOUT"}, nil
	}

	return decision, nil
}

// ─── Payout Workflow ──────────────────────────────────────────────────────────
type PayoutInput struct {
	Month     string `json:"month"` // YYYY-MM
	PartnerID int64  `json:"partner_id"`
}

func MonthlyPayoutWorkflow(ctx workflow.Context, input PayoutInput) (map[string]interface{}, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("MonthlyPayoutWorkflow started", "month", input.Month, "partnerID", input.PartnerID)

	ao := workflow.ActivityOptions{StartToCloseTimeout: 10 * time.Minute}
	ctx = workflow.WithActivityOptions(ctx, ao)

	var earningsResult map[string]interface{}
	if err := workflow.ExecuteActivity(ctx, CalculateEarningsActivity, input).Get(ctx, &earningsResult); err != nil {
		return nil, err
	}

	var payoutResult map[string]interface{}
	if err := workflow.ExecuteActivity(ctx, ExecutePayoutActivity, earningsResult).Get(ctx, &payoutResult); err != nil {
		return nil, err
	}

	_ = workflow.ExecuteActivity(ctx, SendPayoutNotificationActivity, payoutResult).Get(ctx, nil)
	return payoutResult, nil
}

// ─── Activity Implementations ─────────────────────────────────────────────────
func ValidateTransferActivity(ctx context.Context, input TransferInput) (map[string]interface{}, error) {
	activity.RecordHeartbeat(ctx, "validating")
	if input.Amount <= 0 {
		return nil, fmt.Errorf("invalid amount: %.2f", input.Amount)
	}
	return map[string]interface{}{"valid": true}, nil
}

func ComplianceScreenActivity(ctx context.Context, input TransferInput) (map[string]interface{}, error) {
	activity.RecordHeartbeat(ctx, "screening")
	// In production: call compliance microservice
	return map[string]interface{}{"cleared": true, "risk_score": 0.05, "risk_level": "LOW"}, nil
}

func ReserveFundsActivity(ctx context.Context, input TransferInput) (map[string]interface{}, error) {
	activity.RecordHeartbeat(ctx, "reserving")
	return map[string]interface{}{"reserved": true, "reservation_id": fmt.Sprintf("RSV%d", time.Now().UnixMilli())}, nil
}

func ReleaseFundsActivity(ctx context.Context, input TransferInput) (map[string]interface{}, error) {
	return map[string]interface{}{"released": true}, nil
}

func InitiateRailTransferActivity(ctx context.Context, input TransferInput) (map[string]interface{}, error) {
	activity.RecordHeartbeat(ctx, "initiating_rail")
	// In production: call appropriate rail microservice (CIPS/UPI/PIX/Mojaloop)
	railURL := map[string]string{
		"cips":      "http://cips-adapter:8091/api/v1/transfers",
		"upi":       "http://upi-adapter:8092/api/v1/transfers",
		"pix":       "http://pix-adapter:8093/api/v1/transfers",
		"mojaloop":  "http://remitflow-core:3000/api/mojaloop/transfer",
	}
	url, ok := railURL[input.Rail]
	if !ok {
		return nil, fmt.Errorf("unsupported rail: %s", input.Rail)
	}
	log.Printf("[Temporal] Calling rail %s at %s", input.Rail, url)
	return map[string]interface{}{
		"external_ref": fmt.Sprintf("%s%d", input.Rail[:3], time.Now().UnixMilli()),
		"fee_amount":   input.Amount * 0.005,
		"status":       "PROCESSING",
	}, nil
}

func WaitForSettlementActivity(ctx context.Context, params map[string]interface{}) (map[string]interface{}, error) {
	activity.RecordHeartbeat(ctx, "waiting_settlement")
	// Poll rail status until settled or timeout
	for i := 0; i < 10; i++ {
		time.Sleep(5 * time.Second)
		activity.RecordHeartbeat(ctx, fmt.Sprintf("poll_%d", i))
		// In production: check rail status API
		if i >= 2 { // Simulate settlement after ~10s
			return map[string]interface{}{"settled": true, "settled_at": time.Now()}, nil
		}
	}
	return nil, fmt.Errorf("settlement timeout")
}

func SendNotificationActivity(ctx context.Context, params map[string]interface{}) (map[string]interface{}, error) {
	log.Printf("[Temporal] Sending notification: %v", params)
	return map[string]interface{}{"sent": true}, nil
}

func OCRExtractActivity(ctx context.Context, input KYCInput) (map[string]interface{}, error) {
	return map[string]interface{}{"extracted": true, "risk_score": 0.1, "name": "John Doe"}, nil
}

func LivenessCheckActivity(ctx context.Context, input KYCInput) (map[string]interface{}, error) {
	return map[string]interface{}{"liveness": true, "confidence": 0.98}, nil
}

func SanctionsCheckActivity(ctx context.Context, data map[string]interface{}) (map[string]interface{}, error) {
	return map[string]interface{}{"hit": false, "lists_checked": 4}, nil
}

func CalculateEarningsActivity(ctx context.Context, input PayoutInput) (map[string]interface{}, error) {
	return map[string]interface{}{"partner_id": input.PartnerID, "amount": 1250.00, "currency": "USD"}, nil
}

func ExecutePayoutActivity(ctx context.Context, earnings map[string]interface{}) (map[string]interface{}, error) {
	return map[string]interface{}{"payout_id": fmt.Sprintf("PAY%d", time.Now().UnixMilli()), "status": "COMPLETED"}, nil
}

func SendPayoutNotificationActivity(ctx context.Context, payout map[string]interface{}) (map[string]interface{}, error) {
	return map[string]interface{}{"sent": true}, nil
}

// ─── Main ─────────────────────────────────────────────────────────────────────
func main() {
	temporalHost := os.Getenv("TEMPORAL_HOST")
	if temporalHost == "" {
		temporalHost = "temporal:7233"
	}

	c, err := client.Dial(client.Options{HostPort: temporalHost})
	if err != nil {
		log.Fatalf("[Temporal] Failed to connect: %v", err)
	}
	defer c.Close()

	log.Printf("[Temporal] Connected to %s", temporalHost)

	// Register transfer worker
	transferWorker := worker.New(c, TaskQueueTransfer, worker.Options{
		MaxConcurrentActivityExecutionSize:  50,
		MaxConcurrentWorkflowTaskExecutionSize: 20,
	})
	transferWorker.RegisterWorkflow(TransferWorkflow)
	transferWorker.RegisterActivity(ValidateTransferActivity)
	transferWorker.RegisterActivity(ComplianceScreenActivity)
	transferWorker.RegisterActivity(ReserveFundsActivity)
	transferWorker.RegisterActivity(ReleaseFundsActivity)
	transferWorker.RegisterActivity(InitiateRailTransferActivity)
	transferWorker.RegisterActivity(WaitForSettlementActivity)
	transferWorker.RegisterActivity(SendNotificationActivity)

	// Register KYC worker
	kycWorker := worker.New(c, TaskQueueKYC, worker.Options{})
	kycWorker.RegisterWorkflow(KYCReviewWorkflow)
	kycWorker.RegisterActivity(OCRExtractActivity)
	kycWorker.RegisterActivity(LivenessCheckActivity)
	kycWorker.RegisterActivity(SanctionsCheckActivity)

	// Register payout worker
	payoutWorker := worker.New(c, TaskQueuePayout, worker.Options{})
	payoutWorker.RegisterWorkflow(MonthlyPayoutWorkflow)
	payoutWorker.RegisterActivity(CalculateEarningsActivity)
	payoutWorker.RegisterActivity(ExecutePayoutActivity)
	payoutWorker.RegisterActivity(SendPayoutNotificationActivity)

	if err := transferWorker.Start(); err != nil {
		log.Fatalf("[Temporal] Transfer worker start error: %v", err)
	}
	if err := kycWorker.Start(); err != nil {
		log.Fatalf("[Temporal] KYC worker start error: %v", err)
	}
	if err := payoutWorker.Start(); err != nil {
		log.Fatalf("[Temporal] Payout worker start error: %v", err)
	}

	// Savings Interest Worker
	savingsWorker := worker.New(c, TaskQueueSavings, worker.Options{MaxConcurrentActivityExecutionSize: 5})
	savingsWorker.RegisterWorkflow(SavingsInterestWorkflow)
	savingsWorker.RegisterActivity(FetchActiveSavingsAccountsActivity)
	savingsWorker.RegisterActivity(AccrueInterestActivity)
	if err := savingsWorker.Start(); err != nil {
		log.Fatalf("[Temporal] Savings worker start error: %v", err)
	}
	// Community Disbursement Worker
	disbursementWorker := worker.New(c, TaskQueueDisbursement, worker.Options{MaxConcurrentActivityExecutionSize: 3})
	disbursementWorker.RegisterWorkflow(CommunityDisbursementWorkflow)
	disbursementWorker.RegisterActivity(ComplianceCheckDisbursementActivity)
	disbursementWorker.RegisterActivity(ExecuteDisbursementActivity)
	disbursementWorker.RegisterActivity(NotifyDisbursementActivity)
	if err := disbursementWorker.Start(); err != nil {
		log.Fatalf("[Temporal] Disbursement worker start error: %v", err)
	}
	log.Println("[Temporal] All workers running. Waiting for workflows...")
	select {}
}

// ─── Savings Interest Workflow ────────────────────────────────────────────────

const TaskQueueSavings = "remitflow-savings"

type SavingsInterestInput struct {
RunDate string `json:"run_date"`
DryRun  bool   `json:"dry_run"`
}

type SavingsInterestResult struct {
AccountsProcessed int     `json:"accounts_processed"`
TotalInterest     float64 `json:"total_interest_accrued"`
RunDate           string  `json:"run_date"`
DryRun            bool    `json:"dry_run"`
}

// SavingsInterestWorkflow compounds daily interest on all active savings accounts.
// APY tiers: flex=3%, 30d=4%, 90d=5%, 180d=5.5%, 365d=6%
func SavingsInterestWorkflow(ctx workflow.Context, input SavingsInterestInput) (*SavingsInterestResult, error) {
ao := workflow.ActivityOptions{StartToCloseTimeout: 10 * time.Minute, RetryPolicy: &temporal.RetryPolicy{MaximumAttempts: 3}}
ctx = workflow.WithActivityOptions(ctx, ao)

var accounts []map[string]interface{}
if err := workflow.ExecuteActivity(ctx, FetchActiveSavingsAccountsActivity, input).Get(ctx, &accounts); err != nil {
 nil, fmt.Errorf("fetch savings accounts: %w", err)
}

var totalInterest float64
for _, acct := range accounts {
result map[string]interface{}
err := workflow.ExecuteActivity(ctx, AccrueInterestActivity, acct, input.DryRun).Get(ctx, &result); err != nil {
to accrue interest", zap.Any("account", acct["id"]), zap.Error(err))
tinue
v, ok := result["interest"].(float64); ok {
terest += v
!input.DryRun {
= workflow.ExecuteActivity(ctx, RecordInterestRunActivity, input.RunDate, len(accounts), totalInterest).Get(ctx, nil)
}

return &SavingsInterestResult{
tsProcessed: len(accounts),
terest:     totalInterest,
Date:           input.RunDate,
Run:            input.DryRun,
}, nil
}

func FetchActiveSavingsAccountsActivity(ctx context.Context, input SavingsInterestInput) ([]map[string]interface{}, error) {
log.Printf("[SavingsInterest] Fetching active savings accounts for run_date=%s", input.RunDate)
// In production: query DB for all active savings accounts
// SELECT id, user_id, balance, apy, lock_days, created_at FROM savings_accounts WHERE status='active'
return []map[string]interface{}{}, nil
}

func AccrueInterestActivity(ctx context.Context, account map[string]interface{}, dryRun bool) (map[string]interface{}, error) {
balance, _ := account["balance"].(float64)
apy, _ := account["apy"].(float64)
if apy == 0 {
 = 3.0 // default flex APY
}
dailyRate := apy / 100.0 / 365.0
interest := balance * dailyRate
log.Printf("[SavingsInterest] Account %v: balance=%.2f, APY=%.1f%%, daily_interest=%.4f, dry_run=%v",
t["id"], balance, apy, interest, dryRun)
if !dryRun {
In production: UPDATE savings_accounts SET balance = balance + interest WHERE id = account["id"]
INSERT INTO savings_interest_log (account_id, interest, run_date) VALUES (...)
}
return map[string]interface{}{"account_id": account["id"], "interest": interest, "applied": !dryRun}, nil
}

func RecordInterestRunActivity(ctx context.Context, runDate string, count int, total float64) error {
log.Printf("[SavingsInterest] Run complete: date=%s, accounts=%d, total_interest=%.4f", runDate, count, total)
// In production: INSERT INTO savings_interest_runs (run_date, accounts_processed, total_interest) VALUES (...)
return nil
}

// ─── Community Disbursement Workflow ─────────────────────────────────────────

const TaskQueueCommunity = "remitflow-community"

type DisbursementInput struct {
ProposalID        int    `json:"proposal_id"`
FundID            int    `json:"fund_id"`
Amount            string `json:"amount"`
Currency          string `json:"currency"`
RecipientUserID   int    `json:"recipient_user_id"`
DisbursementMethod string `json:"disbursement_method"` // wallet|bank|mobile_money
RequestedBy       int    `json:"requested_by"`
}

type DisbursementResult struct {
ProposalID  int    `json:"proposal_id"`
TxReference string `json:"tx_reference"`
Status      string `json:"status"`
Method      string `json:"method"`
}

// CommunityDisbursementWorkflow executes a multi-step fund release with compliance checks.
func CommunityDisbursementWorkflow(ctx workflow.Context, input DisbursementInput) (*DisbursementResult, error) {
ao := workflow.ActivityOptions{StartToCloseTimeout: 5 * time.Minute, RetryPolicy: &temporal.RetryPolicy{MaximumAttempts: 3}}
ctx = workflow.WithActivityOptions(ctx, ao)

// Step 1: Validate proposal is approved
var validation map[string]interface{}
if err := workflow.ExecuteActivity(ctx, ValidateProposalActivity, input).Get(ctx, &validation); err != nil {
 nil, fmt.Errorf("proposal validation: %w", err)
}
if approved, _ := validation["approved"].(bool); !approved {
 &DisbursementResult{ProposalID: input.ProposalID, Status: "rejected", Method: input.DisbursementMethod}, nil
}

// Step 2: Compliance check on recipient
var compliance map[string]interface{}
if err := workflow.ExecuteActivity(ctx, ComplianceCheckRecipientActivity, input.RecipientUserID).Get(ctx, &compliance); err != nil {
 nil, fmt.Errorf("compliance check: %w", err)
}

// Step 3: Execute disbursement
var txRef string
if err := workflow.ExecuteActivity(ctx, ExecuteDisbursementActivity, input).Get(ctx, &txRef); err != nil {
 nil, fmt.Errorf("disbursement execution: %w", err)
}

// Step 4: Notify recipient
_ = workflow.ExecuteActivity(ctx, NotifyDisbursementRecipientActivity, input, txRef).Get(ctx, nil)

return &DisbursementResult{
 input.ProposalID,
ce: txRef,
     "completed",
     input.DisbursementMethod,
}, nil
}

func ValidateProposalActivity(ctx context.Context, input DisbursementInput) (map[string]interface{}, error) {
log.Printf("[Disbursement] Validating proposal %d for fund %d", input.ProposalID, input.FundID)
// In production: SELECT status, votes_for, quorum FROM community_proposals WHERE id = input.ProposalID
return map[string]interface{}{"approved": true, "proposal_id": input.ProposalID}, nil
}

func ComplianceCheckRecipientActivity(ctx context.Context, recipientUserID int) (map[string]interface{}, error) {
log.Printf("[Disbursement] Compliance check for recipient user %d", recipientUserID)
// In production: check KYC tier, sanctions screening, fraud score
return map[string]interface{}{"clear": true, "user_id": recipientUserID}, nil
}

func ExecuteDisbursementActivity(ctx context.Context, input DisbursementInput) (string, error) {
ref := fmt.Sprintf("DISB-%d-%d", input.ProposalID, time.Now().UnixMilli())
log.Printf("[Disbursement] Executing disbursement %s: %s %s to user %d via %s",
input.Amount, input.Currency, input.RecipientUserID, input.DisbursementMethod)
// In production: credit recipient wallet, debit community fund, record transaction
return ref, nil
}

func NotifyDisbursementRecipientActivity(ctx context.Context, input DisbursementInput, txRef string) error {
log.Printf("[Disbursement] Notifying recipient user %d of disbursement %s", input.RecipientUserID, txRef)
// In production: send email/SMS to recipient
return nil
}
