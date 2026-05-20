package activities

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"time"
	
	"github.com/tigerbeetle/tigerbeetle-go"
	"github.com/shopspring/decimal"
)

// TigerBeetleClient wraps the TigerBeetle client
type TigerBeetleClient struct {
	client    tigerbeetle.Client
	clusterID uint128
}

// uint128 represents a 128-bit unsigned integer
type uint128 struct {
	Lo uint64
	Hi uint64
}

// NewTigerBeetleClient creates a new TigerBeetle client
func NewTigerBeetleClient(addresses []string, clusterID uint128) (*TigerBeetleClient, error) {
	client, err := tigerbeetle.NewClient(clusterID, addresses)
	if err != nil {
		return nil, fmt.Errorf("failed to create TigerBeetle client: %w", err)
	}

	return &TigerBeetleClient{
		client:    client,
		clusterID: clusterID,
	}, nil
}

// TigerBeetleAccount represents an account in the ledger
type TigerBeetleAccount struct {
	ID             uint128           `json:"id"`
	UserData128    uint128           `json:"user_data_128"`
	UserData64     uint64            `json:"user_data_64"`
	UserData32     uint32            `json:"user_data_32"`
	Ledger         uint32            `json:"ledger"`
	Code           uint16            `json:"code"`
	Flags          AccountFlags      `json:"flags"`
	DebitsPosted   decimal.Decimal   `json:"debits_posted"`
	DebitsReserved decimal.Decimal   `json:"debits_reserved"`
	CreditsPosted  decimal.Decimal   `json:"credits_posted"`
	CreditsReserved decimal.Decimal  `json:"credits_reserved"`
	Timestamp      time.Time         `json:"timestamp"`
}

// AccountFlags represents account configuration flags
type AccountFlags uint16

const (
	AccountFlagsNone                        AccountFlags = 0
	AccountFlagsLinked                      AccountFlags = 1 << 0
	AccountFlagsDebitsM ustNotExceedCredits AccountFlags = 1 << 1
	AccountFlagsCreditsM ustNotExceedDebits AccountFlags = 1 << 2
)

// TigerBeetleTransfer represents a transfer between accounts
type TigerBeetleTransfer struct {
	ID              uint128          `json:"id"`
	DebitAccountID  uint128          `json:"debit_account_id"`
	CreditAccountID uint128          `json:"credit_account_id"`
	Amount          decimal.Decimal  `json:"amount"`
	UserData128     uint128          `json:"user_data_128"`
	UserData64      uint64           `json:"user_data_64"`
	UserData32      uint32           `json:"user_data_32"`
	Timeout         uint64           `json:"timeout"`
	Ledger          uint32           `json:"ledger"`
	Code            uint16           `json:"code"`
	Flags           TransferFlags    `json:"flags"`
	Timestamp       time.Time        `json:"timestamp"`
}

// TransferFlags represents transfer configuration flags
type TransferFlags uint16

const (
	TransferFlagsNone              TransferFlags = 0
	TransferFlagsLinked            TransferFlags = 1 << 0
	TransferFlagsPending           TransferFlags = 1 << 1
	TransferFlagsPostPendingTransfer TransferFlags = 1 << 2
	TransferFlagsVoidPendingTransfer TransferFlags = 1 << 3
	TransferFlagsBalancingDebit    TransferFlags = 1 << 4
	TransferFlagsBalancingCredit   TransferFlags = 1 << 5
)

// TransferCode represents the type of transfer
type TransferCode uint16

const (
	// Authentication & Security Services (5000-5099)
	TransferCodeBiometricEnrollment TransferCode = 5001
	TransferCode2FASetup            TransferCode = 5002
	TransferCodePasswordReset       TransferCode = 5003
	TransferCodeSocialLogin         TransferCode = 5004
	TransferCodeBeneficiaryVerification TransferCode = 5005
	
	// Domestic Transactions (1000-1099)
	TransferCodeNIBSSTransfer       TransferCode = 1001
	TransferCodeRecurringPayment    TransferCode = 1002
	TransferCodeBillPayment         TransferCode = 1003
	TransferCodeAirtimeTopup        TransferCode = 1004
	TransferCodeP2PTransfer         TransferCode = 1005
	
	// International Remittances (2000-2099)
	TransferCodeSWIFTTransfer       TransferCode = 2001
	TransferCodeWiseTransfer        TransferCode = 2002
	TransferCodeCurrencyConversion  TransferCode = 2003
	TransferCodePAPSSTransfer       TransferCode = 2004
	TransferCodeCryptoRemittance    TransferCode = 2005
	
	// Wallet Operations (3000-3099)
	TransferCodeWalletTopup         TransferCode = 3001
	TransferCodeWalletWithdrawal    TransferCode = 3002
	TransferCodeRefund              TransferCode = 3003
	
	// Financial Services (4000-4099)
	TransferCodeSavingsDeposit      TransferCode = 4001
	TransferCodeSavingsWithdrawal   TransferCode = 4002
	TransferCodeInvestmentPurchase  TransferCode = 4003
	TransferCodeInvestmentRedemption TransferCode = 4004
	TransferCodeLoanDisbursement    TransferCode = 4005
	TransferCodeLoanRepayment       TransferCode = 4006
	TransferCodeInsurancePremium    TransferCode = 4007
	TransferCodeInsuranceClaim      TransferCode = 4008
	TransferCodeRewardRedemption    TransferCode = 4009
	
	// Fees & Commissions (6000-6099)
	TransferCodeTransactionFee      TransferCode = 6001
	TransferCodeServiceFee          TransferCode = 6002
	TransferCodeCommission          TransferCode = 6003
)

// LedgerID represents different ledgers
type LedgerID uint32

const (
	LedgerMain      LedgerID = 1  // Main operational ledger
	LedgerFees      LedgerID = 2  // Fees and commissions
	LedgerReserves  LedgerID = 3  // Reserved funds
	LedgerEscrow    LedgerID = 4  // Escrow accounts
)

// CreateTigerBeetleAccounts creates multiple accounts
func (tb *TigerBeetleClient) CreateTigerBeetleAccounts(ctx context.Context, accounts []*TigerBeetleAccount) error {
	tbAccounts := make([]tigerbeetle.Account, len(accounts))
	
	for i, acc := range accounts {
		tbAccounts[i] = tigerbeetle.Account{
			ID:             tb.uint128ToTB(acc.ID),
			UserData128:    tb.uint128ToTB(acc.UserData128),
			UserData64:     acc.UserData64,
			UserData32:     acc.UserData32,
			Ledger:         acc.Ledger,
			Code:           acc.Code,
			Flags:          uint16(acc.Flags),
		}
	}
	
	results, err := tb.client.CreateAccounts(tbAccounts)
	if err != nil {
		return fmt.Errorf("failed to create accounts: %w", err)
	}
	
	if len(results) > 0 {
		return fmt.Errorf("account creation failed: %d errors", len(results))
	}
	
	return nil
}

// ExecuteTigerBeetleTransfer executes a single transfer
func (tb *TigerBeetleClient) ExecuteTigerBeetleTransfer(ctx context.Context, transfer *TigerBeetleTransfer) error {
	tbTransfer := tigerbeetle.Transfer{
		ID:              tb.uint128ToTB(transfer.ID),
		DebitAccountID:  tb.uint128ToTB(transfer.DebitAccountID),
		CreditAccountID: tb.uint128ToTB(transfer.CreditAccountID),
		Amount:          tb.decimalToUint128(transfer.Amount),
		UserData128:     tb.uint128ToTB(transfer.UserData128),
		UserData64:      transfer.UserData64,
		UserData32:      transfer.UserData32,
		Timeout:         transfer.Timeout,
		Ledger:          transfer.Ledger,
		Code:            transfer.Code,
		Flags:           uint16(transfer.Flags),
	}
	
	results, err := tb.client.CreateTransfers([]tigerbeetle.Transfer{tbTransfer})
	if err != nil {
		return fmt.Errorf("failed to execute transfer: %w", err)
	}
	
	if len(results) > 0 {
		return fmt.Errorf("transfer failed: result code %d", results[0].Result)
	}
	
	return nil
}

// ExecuteTigerBeetleTransfers executes multiple transfers atomically
func (tb *TigerBeetleClient) ExecuteTigerBeetleTransfers(ctx context.Context, transfers []*TigerBeetleTransfer) error {
	tbTransfers := make([]tigerbeetle.Transfer, len(transfers))
	
	for i, transfer := range transfers {
		tbTransfers[i] = tigerbeetle.Transfer{
			ID:              tb.uint128ToTB(transfer.ID),
			DebitAccountID:  tb.uint128ToTB(transfer.DebitAccountID),
			CreditAccountID: tb.uint128ToTB(transfer.CreditAccountID),
			Amount:          tb.decimalToUint128(transfer.Amount),
			UserData128:     tb.uint128ToTB(transfer.UserData128),
			UserData64:      transfer.UserData64,
			UserData32:      transfer.UserData32,
			Timeout:         transfer.Timeout,
			Ledger:          transfer.Ledger,
			Code:            transfer.Code,
			Flags:           uint16(transfer.Flags),
		}
	}
	
	results, err := tb.client.CreateTransfers(tbTransfers)
	if err != nil {
		return fmt.Errorf("failed to execute transfers: %w", err)
	}
	
	if len(results) > 0 {
		return fmt.Errorf("transfers failed: %d errors", len(results))
	}
	
	return nil
}

// ReserveFunds reserves funds for a pending transaction
func (tb *TigerBeetleClient) ReserveFunds(ctx context.Context, transferID, debitAccountID, creditAccountID uint128, amount decimal.Decimal, ledger uint32, code uint16, timeout uint64) error {
	transfer := &TigerBeetleTransfer{
		ID:              transferID,
		DebitAccountID:  debitAccountID,
		CreditAccountID: creditAccountID,
		Amount:          amount,
		Ledger:          ledger,
		Code:            code,
		Flags:           TransferFlagsPending,
		Timeout:         timeout,
	}
	
	return tb.ExecuteTigerBeetleTransfer(ctx, transfer)
}

// CommitReservedFunds commits a pending transfer
func (tb *TigerBeetleClient) CommitReservedFunds(ctx context.Context, pendingTransferID, commitTransferID uint128) error {
	transfer := &TigerBeetleTransfer{
		ID:              commitTransferID,
		DebitAccountID:  uint128{}, // Not used for post-pending
		CreditAccountID: uint128{}, // Not used for post-pending
		Amount:          decimal.Zero,
		UserData128:     pendingTransferID, // Reference to pending transfer
		Flags:           TransferFlagsPostPendingTransfer,
	}
	
	return tb.ExecuteTigerBeetleTransfer(ctx, transfer)
}

// VoidReservedFunds voids a pending transfer
func (tb *TigerBeetleClient) VoidReservedFunds(ctx context.Context, pendingTransferID, voidTransferID uint128) error {
	transfer := &TigerBeetleTransfer{
		ID:              voidTransferID,
		DebitAccountID:  uint128{}, // Not used for void-pending
		CreditAccountID: uint128{}, // Not used for void-pending
		Amount:          decimal.Zero,
		UserData128:     pendingTransferID, // Reference to pending transfer
		Flags:           TransferFlagsVoidPendingTransfer,
	}
	
	return tb.ExecuteTigerBeetleTransfer(ctx, transfer)
}

// GetAccountBalance retrieves account balance
func (tb *TigerBeetleClient) GetAccountBalance(ctx context.Context, accountID uint128) (*TigerBeetleAccount, error) {
	accounts, err := tb.client.LookupAccounts([]tigerbeetle.Uint128{tb.uint128ToTB(accountID)})
	if err != nil {
		return nil, fmt.Errorf("failed to lookup account: %w", err)
	}
	
	if len(accounts) == 0 {
		return nil, errors.New("account not found")
	}
	
	acc := accounts[0]
	return &TigerBeetleAccount{
		ID:              tb.tbToUint128(acc.ID),
		UserData128:     tb.tbToUint128(acc.UserData128),
		UserData64:      acc.UserData64,
		UserData32:      acc.UserData32,
		Ledger:          acc.Ledger,
		Code:            acc.Code,
		Flags:           AccountFlags(acc.Flags),
		DebitsPosted:    tb.uint128ToDecimal(acc.DebitsPosted),
		DebitsReserved:  tb.uint128ToDecimal(acc.DebitsReserved),
		CreditsPosted:   tb.uint128ToDecimal(acc.CreditsPosted),
		CreditsReserved: tb.uint128ToDecimal(acc.CreditsReserved),
		Timestamp:       time.Unix(0, int64(acc.Timestamp)),
	}, nil
}

// LogTigerBeetleTransaction logs a transaction for audit purposes
func (tb *TigerBeetleClient) LogTigerBeetleTransaction(ctx context.Context, transfer *TigerBeetleTransfer) error {
	// In production, this would write to an audit log store
	// For now, we'll log to application logs
	fmt.Printf("[TIGERBEETLE_TRANSACTION] ID=%s DebitAccount=%s CreditAccount=%s Amount=%s Code=%d\n",
		tb.uint128ToString(transfer.ID),
		tb.uint128ToString(transfer.DebitAccountID),
		tb.uint128ToString(transfer.CreditAccountID),
		transfer.Amount.String(),
		transfer.Code,
	)
	
	return nil
}

// RecordBiometricEnrollmentFee records biometric enrollment fee
func (tb *TigerBeetleClient) RecordBiometricEnrollmentFee(ctx context.Context, userAccountID uint128, fee decimal.Decimal) error {
	if fee.IsZero() {
		return nil // No fee to record
	}
	
	transferID := tb.generateTransferID()
	serviceAccountID := tb.getServiceAccountID("biometric_fees")
	
	transfer := &TigerBeetleTransfer{
		ID:              transferID,
		DebitAccountID:  userAccountID,
		CreditAccountID: serviceAccountID,
		Amount:          fee,
		Ledger:          uint32(LedgerFees),
		Code:            uint16(TransferCodeBiometricEnrollment),
		Flags:           TransferFlagsNone,
	}
	
	return tb.ExecuteTigerBeetleTransfer(ctx, transfer)
}

// Record2FASetupFee records 2FA setup fee
func (tb *TigerBeetleClient) Record2FASetupFee(ctx context.Context, userAccountID uint128, fee decimal.Decimal) error {
	if fee.IsZero() {
		return nil
	}
	
	transferID := tb.generateTransferID()
	serviceAccountID := tb.getServiceAccountID("2fa_services")
	
	transfer := &TigerBeetleTransfer{
		ID:              transferID,
		DebitAccountID:  userAccountID,
		CreditAccountID: serviceAccountID,
		Amount:          fee,
		Ledger:          uint32(LedgerFees),
		Code:            uint16(TransferCode2FASetup),
		Flags:           TransferFlagsNone,
	}
	
	return tb.ExecuteTigerBeetleTransfer(ctx, transfer)
}

// RecordPasswordResetCost records password reset verification costs
func (tb *TigerBeetleClient) RecordPasswordResetCost(ctx context.Context, smsCost, emailCost decimal.Decimal) error {
	platformAccountID := tb.getServiceAccountID("platform_operating")
	
	transfers := []*TigerBeetleTransfer{}
	
	// Record SMS cost
	if !smsCost.IsZero() {
		smsProviderAccountID := tb.getServiceAccountID("sms_provider")
		transfers = append(transfers, &TigerBeetleTransfer{
			ID:              tb.generateTransferID(),
			DebitAccountID:  platformAccountID,
			CreditAccountID: smsProviderAccountID,
			Amount:          smsCost,
			Ledger:          uint32(LedgerFees),
			Code:            uint16(TransferCodePasswordReset),
			Flags:           TransferFlagsNone,
		})
	}
	
	// Record email cost
	if !emailCost.IsZero() {
		emailProviderAccountID := tb.getServiceAccountID("email_provider")
		transfers = append(transfers, &TigerBeetleTransfer{
			ID:              tb.generateTransferID(),
			DebitAccountID:  platformAccountID,
			CreditAccountID: emailProviderAccountID,
			Amount:          emailCost,
			Ledger:          uint32(LedgerFees),
			Code:            uint16(TransferCodePasswordReset),
			Flags:           TransferFlagsLinked, // Link transfers for atomicity
		})
	}
	
	if len(transfers) == 0 {
		return nil
	}
	
	return tb.ExecuteTigerBeetleTransfers(ctx, transfers)
}

// RecordSocialLoginFee records social login service fee
func (tb *TigerBeetleClient) RecordSocialLoginFee(ctx context.Context, userAccountID uint128, provider string, fee decimal.Decimal) error {
	if fee.IsZero() {
		return nil
	}
	
	transferID := tb.generateTransferID()
	serviceAccountID := tb.getServiceAccountID("social_login_services")
	
	transfer := &TigerBeetleTransfer{
		ID:              transferID,
		DebitAccountID:  userAccountID,
		CreditAccountID: serviceAccountID,
		Amount:          fee,
		Ledger:          uint32(LedgerFees),
		Code:            uint16(TransferCodeSocialLogin),
		Flags:           TransferFlagsNone,
	}
	
	return tb.ExecuteTigerBeetleTransfer(ctx, transfer)
}

// RecordBeneficiaryVerificationFee records beneficiary verification fee
func (tb *TigerBeetleClient) RecordBeneficiaryVerificationFee(ctx context.Context, userAccountID uint128, fee decimal.Decimal) error {
	if fee.IsZero() {
		return nil
	}
	
	transferID := tb.generateTransferID()
	serviceAccountID := tb.getServiceAccountID("verification_services")
	
	transfer := &TigerBeetleTransfer{
		ID:              transferID,
		DebitAccountID:  userAccountID,
		CreditAccountID: serviceAccountID,
		Amount:          fee,
		Ledger:          uint32(LedgerFees),
		Code:            uint16(TransferCodeBeneficiaryVerification),
		Flags:           TransferFlagsNone,
	}
	
	return tb.ExecuteTigerBeetleTransfer(ctx, transfer)
}

// Helper functions

func (tb *TigerBeetleClient) uint128ToTB(val uint128) tigerbeetle.Uint128 {
	var result tigerbeetle.Uint128
	binary.LittleEndian.PutUint64(result[:8], val.Lo)
	binary.LittleEndian.PutUint64(result[8:], val.Hi)
	return result
}

func (tb *TigerBeetleClient) tbToUint128(val tigerbeetle.Uint128) uint128 {
	return uint128{
		Lo: binary.LittleEndian.Uint64(val[:8]),
		Hi: binary.LittleEndian.Uint64(val[8:]),
	}
}

func (tb *TigerBeetleClient) decimalToUint128(val decimal.Decimal) tigerbeetle.Uint128 {
	// Convert decimal to smallest unit (e.g., kobo for NGN)
	amount := val.Mul(decimal.NewFromInt(100)).IntPart()
	
	var result tigerbeetle.Uint128
	binary.LittleEndian.PutUint64(result[:8], uint64(amount))
	binary.LittleEndian.PutUint64(result[8:], 0)
	return result
}

func (tb *TigerBeetleClient) uint128ToDecimal(val tigerbeetle.Uint128) decimal.Decimal {
	amount := binary.LittleEndian.Uint64(val[:8])
	return decimal.NewFromInt(int64(amount)).Div(decimal.NewFromInt(100))
}

func (tb *TigerBeetleClient) uint128ToString(val uint128) string {
	return fmt.Sprintf("%016x%016x", val.Hi, val.Lo)
}

func (tb *TigerBeetleClient) generateTransferID() uint128 {
	// In production, use a proper ID generation strategy
	timestamp := uint64(time.Now().UnixNano())
	return uint128{
		Lo: timestamp,
		Hi: 0,
	}
}

func (tb *TigerBeetleClient) getServiceAccountID(service string) uint128 {
	// In production, maintain a registry of service account IDs
	// For now, use a simple hash-based approach
	serviceIDs := map[string]uint128{
		"biometric_fees":        {Lo: 5001, Hi: 0},
		"2fa_services":          {Lo: 5002, Hi: 0},
		"platform_operating":    {Lo: 9001, Hi: 0},
		"sms_provider":          {Lo: 9002, Hi: 0},
		"email_provider":        {Lo: 9003, Hi: 0},
		"social_login_services": {Lo: 5004, Hi: 0},
		"verification_services": {Lo: 5005, Hi: 0},
	}
	
	if id, ok := serviceIDs[service]; ok {
		return id
	}
	
	// Default service account
	return uint128{Lo: 9999, Hi: 0}
}

// Close closes the TigerBeetle client connection
func (tb *TigerBeetleClient) Close() {
	tb.client.Close()
}
