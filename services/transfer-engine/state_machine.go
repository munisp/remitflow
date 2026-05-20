package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"go.uber.org/zap"
)

// TransferState represents a valid lifecycle state for a transfer.
type TransferState string

const (
	StateInitiated   TransferState = "initiated"
	StateFraudCheck  TransferState = "fraud_check"
	StateAMLCheck    TransferState = "aml_check"
	StateKYCCheck    TransferState = "kyc_check"
	StateProcessing  TransferState = "processing"
	StatePartnerSent TransferState = "partner_sent"
	StateCompleted   TransferState = "completed"
	StateFailed      TransferState = "failed"
	StateCancelled   TransferState = "cancelled"
	StateReversed    TransferState = "reversed"
)

// StateLabels maps each state to a human-readable label.
var StateLabels = map[TransferState]string{
	StateInitiated:   "Transfer Initiated",
	StateFraudCheck:  "Fraud Screening",
	StateAMLCheck:    "AML Compliance Check",
	StateKYCCheck:    "KYC Verification",
	StateProcessing:  "Processing Transfer",
	StatePartnerSent: "Sent to Partner Network",
	StateCompleted:   "Transfer Completed",
	StateFailed:      "Transfer Failed",
	StateCancelled:   "Transfer Cancelled",
	StateReversed:    "Transfer Reversed",
}

// StateDurationMs is the simulated processing time for each state.
var StateDurationMs = map[TransferState]time.Duration{
	StateFraudCheck:  2 * time.Second,
	StateAMLCheck:    3 * time.Second,
	StateKYCCheck:    1 * time.Second,
	StateProcessing:  5 * time.Second,
	StatePartnerSent: 30 * time.Second,
}

// ValidTransitions defines the allowed next states from each state.
var ValidTransitions = map[TransferState][]TransferState{
	StateInitiated:   {StateFraudCheck, StateCancelled},
	StateFraudCheck:  {StateAMLCheck, StateFailed, StateCancelled},
	StateAMLCheck:    {StateKYCCheck, StateFailed},
	StateKYCCheck:    {StateProcessing, StateFailed},
	StateProcessing:  {StatePartnerSent, StateFailed},
	StatePartnerSent: {StateCompleted, StateFailed},
	StateCompleted:   {StateReversed},
	StateFailed:      {},
	StateCancelled:   {},
	StateReversed:    {},
}

// StateTransitionResult is returned by AdvanceState.
type StateTransitionResult struct {
	Success          bool
	PreviousState    TransferState
	NewState         TransferState
	Message          string
	RequiresReview   bool
	EstimatedMs      int64
}

// StateMachineService handles transfer lifecycle transitions.
type StateMachineService struct {
	db     *sql.DB
	logger *zap.Logger
}

// NewStateMachineService creates a new StateMachineService.
func NewStateMachineService(db *sql.DB, logger *zap.Logger) *StateMachineService {
	return &StateMachineService{db: db, logger: logger}
}

// AdvanceState transitions a transfer to the target state.
func (s *StateMachineService) AdvanceState(
	ctx context.Context,
	transferID string,
	userID int64,
	targetState TransferState,
	failureReason string,
	partnerRef string,
	requiresReview bool,
) (*StateTransitionResult, error) {
	// Fetch current state
	var currentStateStr string
	var reference string
	row := s.db.QueryRowContext(ctx,
		"SELECT status, reference FROM transactions WHERE id = ? LIMIT 1",
		transferID,
	)
	if err := row.Scan(&currentStateStr, &reference); err != nil {
		return nil, fmt.Errorf("transfer %s not found: %w", transferID, err)
	}

	currentState := TransferState(currentStateStr)
	allowed := ValidTransitions[currentState]

	// Validate transition
	valid := false
	for _, s := range allowed {
		if s == targetState {
			valid = true
			break
		}
	}
	if !valid {
		return &StateTransitionResult{
			Success:       false,
			PreviousState: currentState,
			NewState:      currentState,
			Message:       fmt.Sprintf("Invalid transition: %s → %s", currentState, targetState),
		}, nil
	}

	now := time.Now().UnixMilli()

	// Update transaction
	_, err := s.db.ExecContext(ctx,
		"UPDATE transactions SET status = ?, updated_at = ?, failure_reason = ?, partner_reference = ? WHERE id = ?",
		string(targetState), now, nullableString(failureReason), nullableString(partnerRef), transferID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to update transaction state: %w", err)
	}

	// Insert audit log
	auditDetails, _ := json.Marshal(map[string]interface{}{
		"from":           string(currentState),
		"to":             string(targetState),
		"failureReason":  failureReason,
		"partnerRef":     partnerRef,
		"requiresReview": requiresReview,
	})
	_, _ = s.db.ExecContext(ctx,
		"INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		userID, "transfer_state_change", "transaction", transferID, string(auditDetails), "go-engine", now,
	)

	// Insert in-app notification
	notifTitle := getNotificationTitle(targetState, reference)
	notifBody := getNotificationBody(targetState, failureReason, partnerRef)
	notifData, _ := json.Marshal(map[string]interface{}{
		"transferId": transferID,
		"reference":  reference,
		"state":      string(targetState),
	})
	_, _ = s.db.ExecContext(ctx,
		"INSERT INTO notifications (user_id, type, title, body, data, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		userID, "transfer_update", notifTitle, notifBody, string(notifData), 0, now,
	)

	s.logger.Info("transfer state advanced",
		zap.String("transfer_id", transferID),
		zap.Int64("user_id", userID),
		zap.String("from", string(currentState)),
		zap.String("to", string(targetState)),
	)

	estimatedMs := int64(0)
	if d, ok := StateDurationMs[targetState]; ok {
		estimatedMs = d.Milliseconds()
	}

	return &StateTransitionResult{
		Success:        true,
		PreviousState:  currentState,
		NewState:       targetState,
		Message:        StateLabels[targetState],
		RequiresReview: requiresReview,
		EstimatedMs:    estimatedMs,
	}, nil
}

// RunPipeline executes the full automated transfer pipeline asynchronously.
func (s *StateMachineService) RunPipeline(
	ctx context.Context,
	transferID string,
	userID int64,
	fraudScore float64,
	amlFlags []string,
	kycTier int32,
	amountUSD float64,
) {
	go func() {
		pipeline := []struct {
			state  TransferState
			delay  time.Duration
			check  func() (bool, string)
		}{
			{
				state: StateFraudCheck,
				delay: StateDurationMs[StateFraudCheck],
				check: func() (bool, string) {
					if fraudScore >= 80 {
						return false, fmt.Sprintf("High fraud risk score (%.0f/100). Transfer blocked.", fraudScore)
					}
					return true, ""
				},
			},
			{
				state: StateAMLCheck,
				delay: StateDurationMs[StateAMLCheck],
				check: func() (bool, string) {
					if len(amlFlags) > 0 && amountUSD >= 10_000 {
						return false, fmt.Sprintf("AML hold: %v. Manual review required.", amlFlags)
					}
					return true, ""
				},
			},
			{
				state: StateKYCCheck,
				delay: StateDurationMs[StateKYCCheck],
				check: func() (bool, string) {
					if kycTier == 0 && amountUSD > 500 {
						return false, "KYC verification required for transfers above $500."
					}
					return true, ""
				},
			},
			{
				state: StateProcessing,
				delay: StateDurationMs[StateProcessing],
				check: func() (bool, string) { return true, "" },
			},
			{
				state: StatePartnerSent,
				delay: StateDurationMs[StatePartnerSent],
				check: func() (bool, string) { return true, "" },
			},
		}

		for _, step := range pipeline {
			if _, err := s.AdvanceState(ctx, transferID, userID, step.state, "", "", false); err != nil {
				s.logger.Error("pipeline advance error", zap.String("transfer_id", transferID), zap.Error(err))
				return
			}
			time.Sleep(step.delay)

			ok, reason := step.check()
			if !ok {
				_, _ = s.AdvanceState(ctx, transferID, userID, StateFailed, reason, "", true)
				return
			}
		}

		// Generate partner reference
		partnerRef := fmt.Sprintf("RF-%d-%s", time.Now().UnixMilli(), randomHex(6))
		_, _ = s.AdvanceState(ctx, transferID, userID, StateCompleted, "", partnerRef, false)
	}()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func nullableString(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

func randomHex(n int) string {
	const chars = "0123456789ABCDEF"
	result := make([]byte, n)
	for i := range result {
		result[i] = chars[time.Now().UnixNano()%int64(len(chars))]
	}
	return string(result)
}

func getNotificationTitle(state TransferState, reference string) string {
	titles := map[TransferState]string{
		StateFraudCheck:  fmt.Sprintf("Transfer %s — Security Check", reference),
		StateAMLCheck:    fmt.Sprintf("Transfer %s — Compliance Review", reference),
		StateProcessing:  fmt.Sprintf("Transfer %s — Processing", reference),
		StatePartnerSent: fmt.Sprintf("Transfer %s — On Its Way!", reference),
		StateCompleted:   fmt.Sprintf("Transfer %s — Delivered! ✓", reference),
		StateFailed:      fmt.Sprintf("Transfer %s — Action Required", reference),
		StateCancelled:   fmt.Sprintf("Transfer %s — Cancelled", reference),
		StateReversed:    fmt.Sprintf("Transfer %s — Reversed", reference),
	}
	if t, ok := titles[state]; ok {
		return t
	}
	return fmt.Sprintf("Transfer %s — %s", reference, StateLabels[state])
}

func getNotificationBody(state TransferState, failureReason, partnerRef string) string {
	bodies := map[TransferState]string{
		StateFraudCheck:  "We're running a quick security check on your transfer.",
		StateAMLCheck:    "Compliance review in progress. Your transfer will continue shortly.",
		StateProcessing:  "Your transfer is being processed. Funds will arrive soon.",
		StatePartnerSent: fmt.Sprintf("Your transfer has been sent to our partner network. Ref: %s.", partnerRef),
		StateCompleted:   "Your transfer has been delivered successfully.",
		StateFailed:      failureReason,
		StateCancelled:   "Your transfer has been cancelled. No funds were deducted.",
		StateReversed:    "Your transfer has been reversed. Funds will be returned within 1-2 business days.",
	}
	if b, ok := bodies[state]; ok {
		return b
	}
	return StateLabels[state]
}
