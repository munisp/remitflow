package workflows

import (
	"time"
	"go.temporal.io/sdk/workflow"
	"go.temporal.io/sdk/temporal"
	"github.com/nigerian-remittance/orchestration/models"
	"github.com/nigerian-remittance/orchestration/activities"
	"github.com/shopspring/decimal"
)

// SavingsAccountInput represents input for savings account creation
type SavingsAccountInput struct {
	UserID           models.UserID   `json:"user_id"`
	AccountType      string          `json:"account_type"` // fixed, flexible, target
	TargetAmount     decimal.Decimal `json:"target_amount,omitempty"` // For target savings
	TargetDate       *time.Time      `json:"target_date,omitempty"` // For target savings
	InterestRate     decimal.Decimal `json:"interest_rate"` // Annual interest rate
	Currency         string          `json:"currency"`
	InitialDeposit   decimal.Decimal `json:"initial_deposit"`
	AutoSaveEnabled  bool            `json:"auto_save_enabled"`
	AutoSaveAmount   decimal.Decimal `json:"auto_save_amount,omitempty"`
	AutoSaveSchedule string          `json:"auto_save_schedule,omitempty"` // cron expression
	SourceWalletID   string          `json:"source_wallet_id"`
	Action           string          `json:"action"` // create, deposit, withdraw, close
	SavingsAccountID string          `json:"savings_account_id,omitempty"` // For deposit/withdraw/close
	Amount           decimal.Decimal `json:"amount,omitempty"` // For deposit/withdraw
}

// SavingsAccountResult represents the workflow result
type SavingsAccountResult struct {
	Success          bool            `json:"success"`
	Action           string          `json:"action"`
	SavingsAccountID string          `json:"savings_account_id"`
	AccountNumber    string          `json:"account_number"`
	Balance          decimal.Decimal `json:"balance"`
	InterestEarned   decimal.Decimal `json:"interest_earned"`
	Status           string          `json:"status"` // active, closed
	Message          string          `json:"message"`
	CompletedAt      time.Time       `json:"completed_at"`
}

// SavingsAccountWorkflow implements Journey 21: Savings Account Creation & Auto-Save
//
// Steps (for create action):
// 1. Validate user eligibility
// 2. Check KYC compliance
// 3. Validate initial deposit amount
// 4. Create savings account in core banking
// 5. Transfer initial deposit (TigerBeetle)
// 6. Setup auto-save (if enabled)
// 7. Calculate projected returns
// 8. Send welcome notification
// 9. Log to analytics
func SavingsAccountWorkflow(ctx workflow.Context, input SavingsAccountInput) (*SavingsAccountResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("SavingsAccountWorkflow started",
		"user_id", input.UserID,
		"action", input.Action,
		"account_type", input.AccountType)

	// Workflow execution options
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    5 * time.Minute,
			MaximumAttempts:    5,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	result := &SavingsAccountResult{
		Success: false,
		Action:  input.Action,
	}

	// Route based on action
	switch input.Action {
	case "create":
		return createSavingsAccount(ctx, input, result, logger)
	case "deposit":
		return depositToSavings(ctx, input, result, logger)
	case "withdraw":
		return withdrawFromSavings(ctx, input, result, logger)
	case "close":
		return closeSavingsAccount(ctx, input, result, logger)
	default:
		result.Message = "Invalid action: " + input.Action
		return result, nil
	}
}

// createSavingsAccount handles savings account creation
func createSavingsAccount(ctx workflow.Context, input SavingsAccountInput, result *SavingsAccountResult, logger workflow.Logger) (*SavingsAccountResult, error) {
	// Step 1: Validate user eligibility
	logger.Info("Step 1: Validating user eligibility")
	var eligibility activities.EligibilityCheckResult
	err := workflow.ExecuteActivity(ctx, activities.CheckSavingsEligibility, map[string]interface{}{
		"user_id":      input.UserID,
		"account_type": input.AccountType,
	}).Get(ctx, &eligibility)

	if err != nil {
		logger.Error("Eligibility check failed", "error", err)
		return nil, err
	}

	if !eligibility.Eligible {
		result.Message = "Not eligible for savings account: " + eligibility.Reason
		return result, nil
	}

	// Step 2: Check KYC compliance
	logger.Info("Step 2: Checking KYC compliance")
	var kycCheck activities.KYCComplianceResult
	err = workflow.ExecuteActivity(ctx, activities.CheckKYCCompliance, map[string]interface{}{
		"user_id":       input.UserID,
		"required_tier": 2, // Savings requires Tier 2 KYC
	}).Get(ctx, &kycCheck)

	if err != nil || !kycCheck.Compliant {
		result.Message = "KYC Tier 2 verification required for savings accounts"
		return result, nil
	}

	// Step 3: Validate initial deposit amount
	logger.Info("Step 3: Validating initial deposit")
	var depositValidation activities.DepositValidationResult
	err = workflow.ExecuteActivity(ctx, activities.ValidateInitialDeposit, map[string]interface{}{
		"account_type": input.AccountType,
		"amount":       input.InitialDeposit,
		"currency":     input.Currency,
	}).Get(ctx, &depositValidation)

	if err != nil || !depositValidation.Valid {
		result.Message = "Invalid initial deposit: " + depositValidation.Reason
		return result, nil
	}

	// Step 4: Check source wallet balance
	logger.Info("Step 4: Checking source wallet balance")
	var balanceCheck activities.BalanceCheckResult
	err = workflow.ExecuteActivity(ctx, activities.CheckWalletBalance, map[string]interface{}{
		"wallet_id": input.SourceWalletID,
		"currency":  input.Currency,
		"amount":    input.InitialDeposit,
	}).Get(ctx, &balanceCheck)

	if err != nil || !balanceCheck.Sufficient {
		result.Message = "Insufficient balance in source wallet"
		return result, nil
	}

	// Step 5: Create savings account in core banking
	logger.Info("Step 5: Creating savings account")
	var accountCreation activities.SavingsAccountCreationResult
	err = workflow.ExecuteActivity(ctx, activities.CreateSavingsAccount, map[string]interface{}{
		"user_id":       input.UserID,
		"account_type":  input.AccountType,
		"target_amount": input.TargetAmount,
		"target_date":   input.TargetDate,
		"interest_rate": input.InterestRate,
		"currency":      input.Currency,
	}).Get(ctx, &accountCreation)

	if err != nil {
		logger.Error("Account creation failed", "error", err)
		return nil, err
	}

	result.SavingsAccountID = accountCreation.SavingsAccountID
	result.AccountNumber = accountCreation.AccountNumber
	logger.Info("Savings account created", "account_id", result.SavingsAccountID)

	// Step 6: Transfer initial deposit (TigerBeetle)
	logger.Info("Step 6: Transferring initial deposit")
	var transfer activities.TransferResult
	err = workflow.ExecuteActivity(ctx, activities.TransferToSavings, map[string]interface{}{
		"source_wallet_id":   input.SourceWalletID,
		"savings_account_id": result.SavingsAccountID,
		"amount":             input.InitialDeposit,
		"currency":           input.Currency,
		"description":        "Initial deposit to savings account",
	}).Get(ctx, &transfer)

	if err != nil {
		logger.Error("Initial deposit transfer failed, compensating", "error", err)
		// Compensate: Delete savings account
		_ = workflow.ExecuteActivity(ctx, activities.DeleteSavingsAccount, map[string]interface{}{
			"savings_account_id": result.SavingsAccountID,
		}).Get(ctx, nil)
		return nil, err
	}

	result.Balance = input.InitialDeposit

	// Step 7: Setup auto-save (if enabled)
	if input.AutoSaveEnabled {
		logger.Info("Step 7: Setting up auto-save")
		var autoSaveSetup activities.AutoSaveSetupResult
		err = workflow.ExecuteActivity(ctx, activities.SetupAutoSave, map[string]interface{}{
			"savings_account_id": result.SavingsAccountID,
			"source_wallet_id":   input.SourceWalletID,
			"amount":             input.AutoSaveAmount,
			"schedule":           input.AutoSaveSchedule,
		}).Get(ctx, &autoSaveSetup)

		if err != nil {
			logger.Warn("Auto-save setup failed (non-critical)", "error", err)
			// Continue even if auto-save fails
		}
	}

	// Step 8: Calculate projected returns
	logger.Info("Step 8: Calculating projected returns")
	var projection activities.SavingsProjectionResult
	err = workflow.ExecuteActivity(ctx, activities.CalculateSavingsProjection, map[string]interface{}{
		"initial_deposit":   input.InitialDeposit,
		"auto_save_amount":  input.AutoSaveAmount,
		"auto_save_schedule": input.AutoSaveSchedule,
		"interest_rate":     input.InterestRate,
		"target_date":       input.TargetDate,
	}).Get(ctx, &projection)

	if err != nil {
		logger.Warn("Projection calculation failed (non-critical)", "error", err)
	}

	// Step 9: Send welcome notification
	logger.Info("Step 9: Sending welcome notification")
	_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
		"user_id": input.UserID,
		"type":    "savings_account_created",
		"channel": "email,push",
		"data": map[string]interface{}{
			"account_number":     result.AccountNumber,
			"account_type":       input.AccountType,
			"initial_deposit":    input.InitialDeposit,
			"interest_rate":      input.InterestRate,
			"projected_returns":  projection.ProjectedReturns,
			"auto_save_enabled":  input.AutoSaveEnabled,
		},
	}).Get(ctx, nil)

	// Step 10: Log to analytics
	logger.Info("Step 10: Logging to analytics")
	_ = workflow.ExecuteActivity(ctx, activities.LogToAnalytics, map[string]interface{}{
		"event_type": "savings_account_created",
		"user_id":    input.UserID,
		"data": map[string]interface{}{
			"account_type":      input.AccountType,
			"initial_deposit":   input.InitialDeposit,
			"auto_save_enabled": input.AutoSaveEnabled,
			"interest_rate":     input.InterestRate,
		},
	}).Get(ctx, nil)

	result.Success = true
	result.Status = "active"
	result.Message = "Savings account created successfully"
	result.CompletedAt = time.Now()

	logger.Info("SavingsAccountWorkflow (create) completed successfully")
	return result, nil
}

// depositToSavings handles deposits to savings account
func depositToSavings(ctx workflow.Context, input SavingsAccountInput, result *SavingsAccountResult, logger workflow.Logger) (*SavingsAccountResult, error) {
	logger.Info("Depositing to savings account", "account_id", input.SavingsAccountID)

	// Validate savings account
	var account activities.SavingsAccountLoadResult
	err := workflow.ExecuteActivity(ctx, activities.LoadSavingsAccount, map[string]interface{}{
		"savings_account_id": input.SavingsAccountID,
	}).Get(ctx, &account)

	if err != nil || account.Status != "active" {
		result.Message = "Savings account not active"
		return result, nil
	}

	// Check balance
	var balanceCheck activities.BalanceCheckResult
	err = workflow.ExecuteActivity(ctx, activities.CheckWalletBalance, map[string]interface{}{
		"wallet_id": input.SourceWalletID,
		"currency":  account.Currency,
		"amount":    input.Amount,
	}).Get(ctx, &balanceCheck)

	if err != nil || !balanceCheck.Sufficient {
		result.Message = "Insufficient balance"
		return result, nil
	}

	// Transfer to savings
	var transfer activities.TransferResult
	err = workflow.ExecuteActivity(ctx, activities.TransferToSavings, map[string]interface{}{
		"source_wallet_id":   input.SourceWalletID,
		"savings_account_id": input.SavingsAccountID,
		"amount":             input.Amount,
		"currency":           account.Currency,
		"description":        "Deposit to savings account",
	}).Get(ctx, &transfer)

	if err != nil {
		return nil, err
	}

	// Calculate interest
	_ = workflow.ExecuteActivity(ctx, activities.CalculateAndCreditInterest, map[string]interface{}{
		"savings_account_id": input.SavingsAccountID,
	}).Get(ctx, nil)

	result.Success = true
	result.SavingsAccountID = input.SavingsAccountID
	result.Balance = account.Balance.Add(input.Amount)
	result.Message = "Deposit successful"
	result.CompletedAt = time.Now()

	return result, nil
}

// withdrawFromSavings handles withdrawals from savings account
func withdrawFromSavings(ctx workflow.Context, input SavingsAccountInput, result *SavingsAccountResult, logger workflow.Logger) (*SavingsAccountResult, error) {
	logger.Info("Withdrawing from savings account", "account_id", input.SavingsAccountID)

	// Load account
	var account activities.SavingsAccountLoadResult
	err := workflow.ExecuteActivity(ctx, activities.LoadSavingsAccount, map[string]interface{}{
		"savings_account_id": input.SavingsAccountID,
	}).Get(ctx, &account)

	if err != nil {
		return nil, err
	}

	// Check withdrawal rules
	var withdrawalCheck activities.WithdrawalCheckResult
	err = workflow.ExecuteActivity(ctx, activities.CheckWithdrawalEligibility, map[string]interface{}{
		"savings_account_id": input.SavingsAccountID,
		"amount":             input.Amount,
		"account_type":       account.AccountType,
	}).Get(ctx, &withdrawalCheck)

	if err != nil || !withdrawalCheck.Allowed {
		result.Message = "Withdrawal not allowed: " + withdrawalCheck.Reason
		return result, nil
	}

	// Execute withdrawal
	var withdrawal activities.TransferResult
	err = workflow.ExecuteActivity(ctx, activities.WithdrawFromSavings, map[string]interface{}{
		"savings_account_id": input.SavingsAccountID,
		"target_wallet_id":   input.SourceWalletID,
		"amount":             input.Amount,
		"currency":           account.Currency,
		"penalty_fee":        withdrawalCheck.PenaltyFee,
	}).Get(ctx, &withdrawal)

	if err != nil {
		return nil, err
	}

	result.Success = true
	result.SavingsAccountID = input.SavingsAccountID
	result.Balance = account.Balance.Sub(input.Amount).Sub(withdrawalCheck.PenaltyFee)
	result.Message = "Withdrawal successful"
	result.CompletedAt = time.Now()

	return result, nil
}

// closeSavingsAccount handles savings account closure
func closeSavingsAccount(ctx workflow.Context, input SavingsAccountInput, result *SavingsAccountResult, logger workflow.Logger) (*SavingsAccountResult, error) {
	logger.Info("Closing savings account", "account_id", input.SavingsAccountID)

	// Load account
	var account activities.SavingsAccountLoadResult
	err := workflow.ExecuteActivity(ctx, activities.LoadSavingsAccount, map[string]interface{}{
		"savings_account_id": input.SavingsAccountID,
	}).Get(ctx, &account)

	if err != nil {
		return nil, err
	}

	// Calculate final interest
	var finalInterest activities.InterestCalculationResult
	_ = workflow.ExecuteActivity(ctx, activities.CalculateFinalInterest, map[string]interface{}{
		"savings_account_id": input.SavingsAccountID,
	}).Get(ctx, &finalInterest)

	// Transfer balance back to wallet
	if account.Balance.GreaterThan(decimal.Zero) {
		_ = workflow.ExecuteActivity(ctx, activities.WithdrawFromSavings, map[string]interface{}{
			"savings_account_id": input.SavingsAccountID,
			"target_wallet_id":   input.SourceWalletID,
			"amount":             account.Balance,
			"currency":           account.Currency,
			"penalty_fee":        decimal.Zero,
		}).Get(ctx, nil)
	}

	// Close account
	err = workflow.ExecuteActivity(ctx, activities.CloseSavingsAccount, map[string]interface{}{
		"savings_account_id": input.SavingsAccountID,
	}).Get(ctx, nil)

	if err != nil {
		return nil, err
	}

	result.Success = true
	result.SavingsAccountID = input.SavingsAccountID
	result.Status = "closed"
	result.InterestEarned = finalInterest.TotalInterest
	result.Message = "Savings account closed successfully"
	result.CompletedAt = time.Now()

	return result, nil
}
