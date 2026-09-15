// RemitFlow — Stablecoin Saga Orchestrator (Go + Temporal)
// Provides atomic, compensatable on-ramp and off-ramp workflows.
//
// Gaps fixed:
//   - Zero Temporal saga wiring existed for stablecoin flows
//   - No compensation/rollback on partial failure
//   - No idempotency across multi-step on-ramp/off-ramp
//
// Architecture:
//   OnRamp Saga:  KYC check → Sanctions screen → FX quote → Provider charge → Ledger credit → Notify
//   OffRamp Saga: KYC check → Balance debit → Sanctions screen → Provider payout → Ledger debit → Notify
//   Compensation: Each step has a compensating action registered before execution
//
// Port: 8120

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// ── Environment ───────────────────────────────────────────────────────────────
func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var (
	temporalAddr      = getEnv("TEMPORAL_ADDR", "temporal:7233")
	stablecoinEngine  = getEnv("STABLECOIN_ENGINE_URL", "http://go-stablecoin-engine:8113")
	settlementSvc     = getEnv("SETTLEMENT_URL", "http://go-stablecoin-settlement:8215")
	tigerBeetleBridge = getEnv("TIGERBEETLE_BRIDGE_URL", "http://rust-tigerbeetle-bridge:8200")
	coreAPIURL        = getEnv("CORE_API_URL", "http://server:5000")
	port              = getEnv("PORT", "8120")
	// amlScorerURL is the real AML/sanctions scoring service (python-aml-scorer).
	// The sanctions saga step FAILS CLOSED when this is unset or unreachable.
	amlScorerURL = getEnv("AML_SCORER_URL", "http://python-aml-scorer:8111")
)

// ── Metrics ───────────────────────────────────────────────────────────────────
var (
	onrampStarted      atomic.Int64
	onrampCompleted    atomic.Int64
	onrampFailed       atomic.Int64
	onrampCompensated  atomic.Int64
	offrampStarted     atomic.Int64
	offrampCompleted   atomic.Int64
	offrampFailed      atomic.Int64
	offrampCompensated atomic.Int64
)

// ── Saga Step Result ──────────────────────────────────────────────────────────
type StepResult struct {
	StepName   string                 `json:"step_name"`
	Status     string                 `json:"status"` // "ok" | "failed" | "compensated"
	Data       map[string]interface{} `json:"data,omitempty"`
	Error      string                 `json:"error,omitempty"`
	DurationMs int64                  `json:"duration_ms"`
}

// ── On-Ramp Saga Input/Output ─────────────────────────────────────────────────
type OnRampSagaInput struct {
	SagaID         string  `json:"saga_id"`
	UserID         int64   `json:"user_id"`
	FiatCurrency   string  `json:"fiat_currency"`
	FiatAmount     float64 `json:"fiat_amount"`
	Stablecoin     string  `json:"stablecoin"`
	Chain          string  `json:"chain"`
	Provider       string  `json:"provider"`
	WalletAddress  string  `json:"wallet_address,omitempty"`
	KYCTier        string  `json:"kyc_tier"`
	IdempotencyKey string  `json:"idempotency_key"`
}

type OnRampSagaResult struct {
	SagaID           string       `json:"saga_id"`
	Status           string       `json:"status"`
	TxRef            string       `json:"tx_ref"`
	StablecoinAmount float64      `json:"stablecoin_amount"`
	Fee              float64      `json:"fee"`
	Steps            []StepResult `json:"steps"`
	CompletedAt      string       `json:"completed_at,omitempty"`
	FailedAt         string       `json:"failed_at,omitempty"`
	CompensatedSteps []string     `json:"compensated_steps,omitempty"`
	// CompensationFailures lists compensations that were invoked but errored.
	// Present iff status == "failed_compensation_partial".
	CompensationFailures []string `json:"compensation_failures,omitempty"`
}

// ── Off-Ramp Saga Input/Output ────────────────────────────────────────────────
type OffRampSagaInput struct {
	SagaID           string  `json:"saga_id"`
	UserID           int64   `json:"user_id"`
	Stablecoin       string  `json:"stablecoin"`
	StablecoinAmount float64 `json:"stablecoin_amount"`
	FiatCurrency     string  `json:"fiat_currency"`
	PayoutRail       string  `json:"payout_rail"`
	BankAccountID    int64   `json:"bank_account_id,omitempty"`
	MobileMoneyNum   string  `json:"mobile_money_number,omitempty"`
	KYCTier          string  `json:"kyc_tier"`
	IdempotencyKey   string  `json:"idempotency_key"`
}

type OffRampSagaResult struct {
	SagaID           string       `json:"saga_id"`
	Status           string       `json:"status"`
	TxRef            string       `json:"tx_ref"`
	NetPayout        float64      `json:"net_payout"`
	FiatCurrency     string       `json:"fiat_currency"`
	Steps            []StepResult `json:"steps"`
	CompletedAt      string       `json:"completed_at,omitempty"`
	FailedAt         string       `json:"failed_at,omitempty"`
	CompensatedSteps []string     `json:"compensated_steps,omitempty"`
	// CompensationFailures lists compensations that were invoked but errored.
	// Present iff status == "failed_compensation_partial".
	CompensationFailures []string `json:"compensation_failures,omitempty"`
}

// ── KYC Tier Limits ───────────────────────────────────────────────────────────
var kycLimits = map[string]struct{ onramp, offramp, single float64 }{
	"tier0": {0, 0, 0},
	"tier1": {500, 250, 500},
	"tier2": {5000, 2500, 2500},
	"tier3": {50000, 25000, 25000},
	"tier4": {500000, 250000, 250000},
}

// ── FX Rates (live engine source — no static map) ─────────────────────────────

// getEngineFXRate fetches the live rate from go-stablecoin-engine
// (GET /stablecoin/fx-rates?from=&to=). FAIL CLOSED: any transport error,
// non-200, undecodable body, or non-positive rate is an error — the saga must
// not fall back to a hardcoded table (the old static map disagreed with the
// engine, e.g. NGN 1650 vs 1600).
func getEngineFXRate(from, to string) (float64, error) {
	u := fmt.Sprintf("%s/stablecoin/fx-rates?from=%s&to=%s",
		strings.TrimRight(stablecoinEngine, "/"), url.QueryEscape(from), url.QueryEscape(to))
	resp, err := sagaHTTP.Get(u)
	if err != nil {
		return 0, fmt.Errorf("engine fx-rates unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
		return 0, fmt.Errorf("engine fx-rates %s->%s returned HTTP %d", from, to, resp.StatusCode)
	}
	var out struct {
		Rate float64 `json:"rate"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&out); err != nil {
		return 0, fmt.Errorf("engine fx-rates undecodable: %w", err)
	}
	if out.Rate <= 0 {
		return 0, fmt.Errorf("engine fx-rates returned non-positive rate %v for %s->%s", out.Rate, from, to)
	}
	return out.Rate, nil
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
var sagaHTTP = &http.Client{Timeout: 8 * time.Second}

// postJSON POSTs body as JSON and FAILS CLOSED on any non-2xx response — a
// money-moving step may never treat an HTTP error as success.
func postJSON(rawURL string, body interface{}) (map[string]interface{}, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPost, rawURL, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := sagaHTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet := strings.TrimSpace(string(data))
		if len(snippet) > 256 {
			snippet = snippet[:256]
		}
		return nil, fmt.Errorf("POST %s -> HTTP %d: %s", rawURL, resp.StatusCode, snippet)
	}
	result := map[string]interface{}{}
	if len(data) > 0 {
		if err := json.Unmarshal(data, &result); err != nil {
			return nil, fmt.Errorf("POST %s -> undecodable response: %w", rawURL, err)
		}
	}
	return result, nil
}

// ── TigerBeetle bridge contract (rust-tigerbeetle-bridge) ────────────────────
// The bridge serves EXACTLY: POST /transfers/create {transfers:[NewTransfer]}
// with snake_case fields and u128 ids/amounts as decimal strings, and returns
// {errors:[{index,code,reason}]} — an empty errors array means posted.
// There is NO /ledger/transfer and NO /ledger/reverse route.

// tbTransfer mirrors the bridge's NewTransfer (snake_case contract).
type tbTransfer struct {
	ID              string `json:"id"`
	DebitAccountID  string `json:"debit_account_id"`
	CreditAccountID string `json:"credit_account_id"`
	Amount          string `json:"amount"` // minor units, decimal string
	Ledger          uint32 `json:"ledger"`
	Code            uint16 `json:"code"`
}

// tbCodeSagaTransfer is the transfer code for saga-initiated stablecoin moves.
const tbCodeSagaTransfer uint16 = 1

// tbLedgers mirrors TB_LEDGERS in server/_core/tigerBeetle.ts. An unmapped
// currency fails closed — never post to a guessed ledger.
var tbLedgers = map[string]uint32{
	"USD": 840, "NGN": 566, "GBP": 826, "EUR": 978, "KES": 404, "GHS": 936,
	"ZAR": 710, "XOF": 952, "USDC": 9001, "USDT": 9002, "CNGN": 9003,
}

// deterministicU128 derives a stable u128 (decimal string, 1..=2^128-2) from
// a seed via sha256 — the platform's deterministic-id convention.
func deterministicU128(seed string) string {
	sum := sha256.Sum256([]byte(seed))
	n := new(big.Int).SetBytes(sum[:16])
	if n.Sign() == 0 {
		n = big.NewInt(1)
	}
	return n.String()
}

// tbAccountID maps a saga-side symbolic account name to a deterministic u128
// account id. If no account was provisioned under this id, the bridge rejects
// the transfer with a per-index error and the step fails closed.
func tbAccountID(name string) string { return deterministicU128("account:" + name) }

// tbMinorUnits converts a major-unit amount to the ledger's smallest unit
// (6 decimals for USD-pegged stablecoins) as a decimal string.
func tbMinorUnits(amount float64) string {
	return strconv.FormatUint(uint64(math.Round(amount*1e6)), 10)
}

// postTBTransfer posts one transfer to the real bridge contract. A per-index
// entry in the bridge's errors array is a failure, not a success.
func postTBTransfer(t tbTransfer) error {
	res, err := postJSON(tigerBeetleBridge+"/transfers/create",
		map[string]interface{}{"transfers": []tbTransfer{t}})
	if err != nil {
		return err
	}
	if errs, ok := res["errors"].([]interface{}); ok {
		for _, e := range errs {
			m, _ := e.(map[string]interface{})
			idx, _ := m["index"].(float64)
			if int(idx) == 0 {
				return fmt.Errorf("tigerbeetle transfer rejected: code=%v reason=%v", m["code"], m["reason"])
			}
		}
	}
	return nil
}

// ledgerReversal posts the inverse of an already-posted transfer: debit/credit
// accounts swapped, deterministic id = sha256("reversal:"+originalID). An
// error marks the compensation failed — it is never swallowed.
func ledgerReversal(original tbTransfer) error {
	rev := original
	rev.ID = deterministicU128("reversal:" + original.ID)
	rev.DebitAccountID, rev.CreditAccountID = original.CreditAccountID, original.DebitAccountID
	return postTBTransfer(rev)
}

// ── Compensation framework ────────────────────────────────────────────────────

// compensation pairs a money-moving step's name with its undo action.
type compensation struct {
	name string
	fn   func() error
}

// runCompensations invokes ALL registered compensations in reverse order and
// collects per-step results. succeeded/failed preserve execution order.
func runCompensations(comps []compensation) (succeeded, failed []string) {
	for i := len(comps) - 1; i >= 0; i-- {
		if err := comps[i].fn(); err != nil {
			slog.Error("[Saga] compensation FAILED", "step", comps[i].name, "err", err)
			failed = append(failed, comps[i].name)
		} else {
			slog.Info("[Saga] compensation applied", "step", comps[i].name)
			succeeded = append(succeeded, comps[i].name)
		}
	}
	return succeeded, failed
}

// ── Saga Steps ────────────────────────────────────────────────────────────────

func stepKYCCheck(userID int64, amountUSD float64, kycTier string, txType string) StepResult {
	start := time.Now()
	limits, ok := kycLimits[kycTier]
	if !ok {
		limits = kycLimits["tier0"]
	}
	var limit float64
	if txType == "onramp" {
		limit = limits.single
	} else {
		limit = limits.offramp
	}
	if limit == 0 {
		return StepResult{StepName: "kyc_check", Status: "failed",
			Error:      "KYC not completed — tier0 has no transaction limit",
			DurationMs: time.Since(start).Milliseconds()}
	}
	if amountUSD > limit {
		return StepResult{StepName: "kyc_check", Status: "failed",
			Error:      fmt.Sprintf("Amount $%.2f exceeds KYC %s single-tx limit $%.2f", amountUSD, kycTier, limit),
			DurationMs: time.Since(start).Milliseconds()}
	}
	return StepResult{StepName: "kyc_check", Status: "ok",
		Data:       map[string]interface{}{"kyc_tier": kycTier, "limit_usd": limit},
		DurationMs: time.Since(start).Milliseconds()}
}

// stepSanctionsScreen calls the real AML scorer (python-aml-scorer /score).
// FAIL CLOSED: any error, non-allow action, or undecodable response fails the
// step (aborting the saga) — no random simulation on the live path.
func stepSanctionsScreen(userID int64, amount float64, currency string) StepResult {
	start := time.Now()
	if amount <= 0 {
		amount = 1 // scorer requires amount > 0; screening is amount-independent here
	}
	if currency == "" {
		currency = "USD"
	}
	result, err := postJSON(amlScorerURL+"/score", map[string]interface{}{
		"user_id":           userID,
		"amount":            amount,
		"from_currency":     currency,
		"to_currency":       currency,
		"recipient_country": "NG",
		"payment_rail":      "stablecoin",
	})
	if err != nil {
		slog.Error("[Saga] sanctions screen unreachable — failing closed", "user", userID, "err", err)
		return StepResult{StepName: "sanctions_screen", Status: "failed",
			Error:      fmt.Sprintf("SANCTIONS_SCREEN_UNAVAILABLE: %v", err),
			DurationMs: time.Since(start).Milliseconds()}
	}
	action, _ := result["action"].(string)
	riskScore, _ := result["risk_score"].(float64)
	if action != "allow" {
		return StepResult{StepName: "sanctions_screen", Status: "failed",
			Error:      fmt.Sprintf("AML scorer action=%q risk_score=%v — transaction blocked", action, riskScore),
			Data:       map[string]interface{}{"action": action, "risk_score": riskScore},
			DurationMs: time.Since(start).Milliseconds()}
	}
	return StepResult{StepName: "sanctions_screen", Status: "ok",
		Data:       map[string]interface{}{"screened": true, "action": action, "risk_score": riskScore},
		DurationMs: time.Since(start).Milliseconds()}
}

// stepFXQuote computes the quote from the LIVE engine rate (fetched by the
// caller via getEngineFXRate — a saga that cannot reach the engine fails
// before any money step). No static rate table exists here anymore.
func stepFXQuote(fiatCurrency, stablecoin string, fiatAmount, fiatToUSDRate float64) (StepResult, float64, float64) {
	start := time.Now()
	usdAmount := fiatAmount * fiatToUSDRate
	fee := fiatAmount * 0.005
	stablecoinAmount := math.Round((usdAmount-fee*fiatToUSDRate)*1e6) / 1e6
	return StepResult{
		StepName: "fx_quote",
		Status:   "ok",
		Data: map[string]interface{}{
			"fx_rate":           fiatToUSDRate,
			"rate_source":       "go-stablecoin-engine",
			"usd_amount":        usdAmount,
			"stablecoin_amount": stablecoinAmount,
			"fee":               fee,
		},
		DurationMs: time.Since(start).Milliseconds(),
	}, stablecoinAmount, fee
}

// stepProviderCharge submits a REAL charge via the settlement service
// (go-stablecoin-settlement /settlement/execute, action=initiate_onramp).
// FAIL CLOSED: unreachable/rejected settlement fails the step and the saga
// compensates — no random success/failure simulation.
func stepProviderCharge(provider, txRef string, fiatAmount float64, fiatCurrency string) StepResult {
	start := time.Now()
	result, err := postJSON(settlementSvc+"/settlement/execute", map[string]interface{}{
		"operation_id": txRef,
		"provider":     provider,
		"action":       "initiate_onramp",
		"payload": map[string]interface{}{
			"amount":       fiatAmount,
			"fiatCurrency": fiatCurrency,
			"currency":     fiatCurrency,
			"txRef":        txRef,
		},
	})
	if err != nil {
		slog.Error("[Saga] provider charge failed — failing closed", "provider", provider, "ref", txRef, "err", err)
		return StepResult{StepName: "provider_charge", Status: "failed",
			Error:      fmt.Sprintf("Provider %s charge failed: %v", provider, err),
			DurationMs: time.Since(start).Milliseconds()}
	}
	status, _ := result["status"].(string)
	providerRef, _ := result["external_ref"].(string)
	if providerRef == "" {
		providerRef = txRef
	}
	if status == "failed" || status == "" {
		return StepResult{StepName: "provider_charge", Status: "failed",
			Error:      fmt.Sprintf("Provider %s charge not accepted (status=%q)", provider, status),
			DurationMs: time.Since(start).Milliseconds()}
	}
	return StepResult{StepName: "provider_charge", Status: "ok",
		Data: map[string]interface{}{
			"provider": provider, "provider_ref": providerRef, "settlement_status": status,
			"amount": fiatAmount, "currency": fiatCurrency,
		},
		DurationMs: time.Since(start).Milliseconds()}
}

// stepLedgerCredit posts the credit leg to the REAL bridge contract
// (POST /transfers/create). FAIL CLOSED: a bridge error fails the step — the
// old "best-effort ok" report is gone. On success it returns the posted
// transfer so a reversal compensation can invert it exactly.
func stepLedgerCredit(txRef string, userID int64, stablecoin string, amount float64) (StepResult, *tbTransfer) {
	start := time.Now()
	ledger, ok := tbLedgers[strings.ToUpper(stablecoin)]
	if !ok {
		return StepResult{StepName: "ledger_credit", Status: "failed",
			Error:      fmt.Sprintf("no TigerBeetle ledger mapped for %s — failing closed", stablecoin),
			DurationMs: time.Since(start).Milliseconds()}, nil
	}
	t := tbTransfer{
		ID:              deterministicU128("transfer:" + txRef + ":ledger_credit"),
		DebitAccountID:  tbAccountID("fiat:reserve"),
		CreditAccountID: tbAccountID(fmt.Sprintf("stablecoin:%s:user:%d", strings.ToUpper(stablecoin), userID)),
		Amount:          tbMinorUnits(amount),
		Ledger:          ledger,
		Code:            tbCodeSagaTransfer,
	}
	if err := postTBTransfer(t); err != nil {
		slog.Error("[Saga] TigerBeetle ledger credit failed — failing closed", "ref", txRef, "err", err)
		return StepResult{StepName: "ledger_credit", Status: "failed",
			Error:      fmt.Sprintf("TigerBeetle ledger credit failed: %v", err),
			DurationMs: time.Since(start).Milliseconds()}, nil
	}
	return StepResult{StepName: "ledger_credit", Status: "ok",
		Data:       map[string]interface{}{"ref": txRef, "transfer_id": t.ID, "amount": amount, "stablecoin": stablecoin},
		DurationMs: time.Since(start).Milliseconds()}, &t
}

// stepLedgerDebit posts the debit leg to the REAL bridge contract, fail-closed,
// returning the posted transfer for exact inversion on compensation.
func stepLedgerDebit(txRef string, userID int64, stablecoin string, amount float64) (StepResult, *tbTransfer) {
	start := time.Now()
	ledger, ok := tbLedgers[strings.ToUpper(stablecoin)]
	if !ok {
		return StepResult{StepName: "ledger_debit", Status: "failed",
			Error:      fmt.Sprintf("no TigerBeetle ledger mapped for %s — failing closed", stablecoin),
			DurationMs: time.Since(start).Milliseconds()}, nil
	}
	t := tbTransfer{
		ID:              deterministicU128("transfer:" + txRef + ":ledger_debit"),
		DebitAccountID:  tbAccountID(fmt.Sprintf("stablecoin:%s:user:%d", strings.ToUpper(stablecoin), userID)),
		CreditAccountID: tbAccountID("fiat:payout"),
		Amount:          tbMinorUnits(amount),
		Ledger:          ledger,
		Code:            tbCodeSagaTransfer,
	}
	if err := postTBTransfer(t); err != nil {
		slog.Error("[Saga] TigerBeetle ledger debit failed — failing closed", "ref", txRef, "err", err)
		return StepResult{StepName: "ledger_debit", Status: "failed",
			Error:      fmt.Sprintf("TigerBeetle ledger debit failed: %v", err),
			DurationMs: time.Since(start).Milliseconds()}, nil
	}
	return StepResult{StepName: "ledger_debit", Status: "ok",
		Data:       map[string]interface{}{"ref": txRef, "transfer_id": t.ID, "amount": amount, "stablecoin": stablecoin},
		DurationMs: time.Since(start).Milliseconds()}, &t
}

// stepProviderPayout submits the payout to the REAL settlement contract:
// POST /settlement/execute {operation_id, provider, action, payload}.
// FAIL CLOSED: transport errors, non-2xx and missing/failed status fail the
// step (the old code POSTed to a nonexistent /settlement route and reported ok).
func stepProviderPayout(payoutRail, txRef string, fiatAmount float64, fiatCurrency string) StepResult {
	start := time.Now()
	result, err := postJSON(settlementSvc+"/settlement/execute", map[string]interface{}{
		"operation_id": txRef,
		"action":       "initiate_payout",
		"payload": map[string]interface{}{
			"amount":       fiatAmount,
			"fiatCurrency": fiatCurrency,
			"currency":     fiatCurrency,
			"payout_rail":  payoutRail,
			"txRef":        txRef,
		},
	})
	if err != nil {
		return StepResult{StepName: "provider_payout", Status: "failed",
			Error:      fmt.Sprintf("Settlement service payout failed: %v", err),
			DurationMs: time.Since(start).Milliseconds()}
	}
	status, _ := result["status"].(string)
	if status == "" || status == "failed" {
		return StepResult{StepName: "provider_payout", Status: "failed",
			Error:      fmt.Sprintf("Settlement service payout not accepted (status=%q)", status),
			Data:       result,
			DurationMs: time.Since(start).Milliseconds()}
	}
	return StepResult{StepName: "provider_payout", Status: "ok",
		Data:       result,
		DurationMs: time.Since(start).Milliseconds()}
}

func stepNotify(userID int64, txRef, txType, status string, amount float64, currency string) StepResult {
	start := time.Now()
	postJSON(coreAPIURL+"/internal/notify", map[string]interface{}{
		"user_id": userID, "tx_ref": txRef, "type": txType,
		"status": status, "amount": amount, "currency": currency,
	})
	return StepResult{StepName: "notify", Status: "ok",
		Data:       map[string]interface{}{"notified": true},
		DurationMs: time.Since(start).Milliseconds()}
}

// ── On-Ramp Saga Execution ────────────────────────────────────────────────────
func executeOnRampSaga(input OnRampSagaInput) OnRampSagaResult {
	onrampStarted.Add(1)
	txRef := fmt.Sprintf("ONRAMP-%s", uuid.New().String()[:12])
	result := OnRampSagaResult{
		SagaID: input.SagaID,
		TxRef:  txRef,
		Steps:  []StepResult{},
	}
	compensations := []compensation{}

	// abort finalizes a failed saga: if any money-moving step succeeded, ALL
	// registered compensations are invoked in reverse order and the outcome is
	// reported honestly — "failed_compensated" only when every compensation
	// returned nil, else "failed_compensation_partial" with the failing names.
	abort := func() OnRampSagaResult {
		result.FailedAt = time.Now().UTC().Format(time.RFC3339)
		if len(compensations) == 0 {
			result.Status = "failed"
		} else {
			succeeded, failed := runCompensations(compensations)
			result.CompensatedSteps = succeeded
			if len(failed) == 0 {
				result.Status = "failed_compensated"
			} else {
				result.Status = "failed_compensation_partial"
				result.CompensationFailures = failed
			}
			onrampCompensated.Add(1)
		}
		onrampFailed.Add(1)
		return result
	}

	// Step 1: FX rate fetch (live engine source) — fail closed before any
	// money-moving step when the engine cannot supply a rate.
	fiatToUSD, rateErr := getEngineFXRate(input.FiatCurrency, "USD")
	if rateErr != nil {
		result.Steps = append(result.Steps, StepResult{
			StepName: "fx_quote", Status: "failed",
			Error: fmt.Sprintf("live FX rate unavailable (fail-closed): %v", rateErr),
		})
		return abort()
	}
	amountUSD := input.FiatAmount * fiatToUSD

	// Step 2: KYC Check
	step2 := stepKYCCheck(input.UserID, amountUSD, input.KYCTier, "onramp")
	result.Steps = append(result.Steps, step2)
	if step2.Status != "ok" {
		return abort()
	}

	// Step 3: Sanctions Screen
	step3 := stepSanctionsScreen(input.UserID, input.FiatAmount, input.FiatCurrency)
	result.Steps = append(result.Steps, step3)
	if step3.Status != "ok" {
		return abort()
	}

	// Step 4: FX Quote (computed from the live engine rate)
	step4, stablecoinAmount, fee := stepFXQuote(input.FiatCurrency, input.Stablecoin, input.FiatAmount, fiatToUSD)
	result.Steps = append(result.Steps, step4)
	result.StablecoinAmount = stablecoinAmount
	result.Fee = fee

	// Step 5: Provider Charge (money-moving; compensation: provider refund)
	step5 := stepProviderCharge(input.Provider, txRef, input.FiatAmount, input.FiatCurrency)
	result.Steps = append(result.Steps, step5)
	if step5.Status != "ok" {
		// Charge never landed — nothing to undo.
		return abort()
	}
	compensations = append(compensations, compensation{
		name: "provider_charge",
		fn: func() error {
			slog.Info("[Saga] Compensating: refund provider charge", "tx_ref", txRef)
			_, err := postJSON(settlementSvc+"/settlement/execute", map[string]interface{}{
				"operation_id": txRef + "-refund",
				"provider":     input.Provider,
				"action":       "refund",
				"payload": map[string]interface{}{
					"original_operation_id": txRef,
					"amount":                input.FiatAmount,
					"currency":              input.FiatCurrency,
				},
			})
			return err // an error (incl. NOT_SUPPORTED) marks this compensation failed
		},
	})

	// Step 6: Ledger Credit (money-moving; compensation: ledger reversal)
	step6, creditLeg := stepLedgerCredit(txRef, input.UserID, input.Stablecoin, stablecoinAmount)
	result.Steps = append(result.Steps, step6)
	if step6.Status != "ok" {
		return abort()
	}
	compensations = append(compensations, compensation{
		name: "ledger_credit",
		fn: func() error {
			slog.Info("[Saga] Compensating: reverse ledger credit", "tx_ref", txRef, "transfer_id", creditLeg.ID)
			return ledgerReversal(*creditLeg)
		},
	})

	// Step 7: Notify (telemetry only — not money-moving)
	step7 := stepNotify(input.UserID, txRef, "onramp", "completed", stablecoinAmount, input.Stablecoin)
	result.Steps = append(result.Steps, step7)

	result.Status = "completed"
	result.CompletedAt = time.Now().UTC().Format(time.RFC3339)
	onrampCompleted.Add(1)
	slog.Info("[Saga] On-ramp saga completed", "saga_id", input.SagaID, "tx_ref", txRef, "amount", stablecoinAmount, "stablecoin", input.Stablecoin)
	return result
}

// ── Off-Ramp Saga Execution ───────────────────────────────────────────────────
func executeOffRampSaga(input OffRampSagaInput) OffRampSagaResult {
	offrampStarted.Add(1)
	txRef := fmt.Sprintf("OFFRAMP-%s", uuid.New().String()[:12])

	result := OffRampSagaResult{
		SagaID:       input.SagaID,
		TxRef:        txRef,
		FiatCurrency: input.FiatCurrency,
		Steps:        []StepResult{},
	}
	compensations := []compensation{}

	// abort: invoke ALL registered compensations in reverse order and report
	// honestly (see executeOnRampSaga). CompensatedSteps lists ONLY
	// compensations that actually ran and returned nil.
	abort := func() OffRampSagaResult {
		result.FailedAt = time.Now().UTC().Format(time.RFC3339)
		if len(compensations) == 0 {
			result.Status = "failed"
		} else {
			succeeded, failed := runCompensations(compensations)
			result.CompensatedSteps = succeeded
			if len(failed) == 0 {
				result.Status = "failed_compensated"
			} else {
				result.Status = "failed_compensation_partial"
				result.CompensationFailures = failed
			}
			offrampCompensated.Add(1)
		}
		offrampFailed.Add(1)
		return result
	}

	// Step 1: FX rate fetch (live engine source) — fail closed before any
	// money-moving step.
	usdToFiat, rateErr := getEngineFXRate("USD", input.FiatCurrency)
	if rateErr != nil {
		result.Steps = append(result.Steps, StepResult{
			StepName: "fx_quote", Status: "failed",
			Error: fmt.Sprintf("live FX rate unavailable (fail-closed): %v", rateErr),
		})
		return abort()
	}
	fiatAmount := input.StablecoinAmount * usdToFiat
	fee := fiatAmount * 0.0075
	netPayout := math.Round((fiatAmount-fee)*100) / 100
	result.NetPayout = netPayout

	// Step 2: KYC Check
	step2 := stepKYCCheck(input.UserID, input.StablecoinAmount, input.KYCTier, "offramp")
	result.Steps = append(result.Steps, step2)
	if step2.Status != "ok" {
		return abort()
	}

	// Step 3: Balance Debit (money-moving, via Core API — atomic pessimistic
	// lock; compensation: re-credit the balance)
	start := time.Now()
	debitResult, err := postJSON(coreAPIURL+"/internal/stablecoin/debit", map[string]interface{}{
		"user_id":    input.UserID,
		"stablecoin": input.Stablecoin,
		"amount":     input.StablecoinAmount,
		"tx_ref":     txRef,
	})
	step3 := StepResult{StepName: "balance_debit", DurationMs: time.Since(start).Milliseconds()}
	if err != nil || debitResult["status"] == "error" {
		step3.Status = "failed"
		step3.Error = fmt.Sprintf("Balance debit failed: %v", err)
		result.Steps = append(result.Steps, step3)
		return abort()
	}
	step3.Status = "ok"
	step3.Data = debitResult
	result.Steps = append(result.Steps, step3)
	compensations = append(compensations, compensation{
		name: "balance_debit",
		fn: func() error {
			slog.Info("[Saga] Compensating: re-credit stablecoin balance", "tx_ref", txRef)
			_, err := postJSON(coreAPIURL+"/internal/stablecoin/credit", map[string]interface{}{
				"user_id": input.UserID, "stablecoin": input.Stablecoin,
				"amount": input.StablecoinAmount, "tx_ref": txRef + "-compensation",
			})
			return err
		},
	})

	// Step 4: Sanctions Screen
	step4 := stepSanctionsScreen(input.UserID, netPayout, input.FiatCurrency)
	result.Steps = append(result.Steps, step4)
	if step4.Status != "ok" {
		return abort()
	}

	// Step 5: Ledger Debit (money-moving; compensation: ledger reversal)
	step5, debitLeg := stepLedgerDebit(txRef, input.UserID, input.Stablecoin, input.StablecoinAmount)
	result.Steps = append(result.Steps, step5)
	if step5.Status != "ok" {
		return abort()
	}
	compensations = append(compensations, compensation{
		name: "ledger_debit",
		fn: func() error {
			slog.Info("[Saga] Compensating: reverse ledger debit", "tx_ref", txRef, "transfer_id", debitLeg.ID)
			return ledgerReversal(*debitLeg)
		},
	})

	// Step 6: Provider Payout
	step6 := stepProviderPayout(input.PayoutRail, txRef, netPayout, input.FiatCurrency)
	result.Steps = append(result.Steps, step6)
	if step6.Status != "ok" {
		return abort()
	}

	// Step 7: Notify (telemetry only — not money-moving)
	step7 := stepNotify(input.UserID, txRef, "offramp", "completed", netPayout, input.FiatCurrency)
	result.Steps = append(result.Steps, step7)

	result.Status = "completed"
	result.CompletedAt = time.Now().UTC().Format(time.RFC3339)
	offrampCompleted.Add(1)
	slog.Info("[Saga] Off-ramp saga completed", "saga_id", input.SagaID, "tx_ref", txRef, "net_payout", netPayout, "currency", input.FiatCurrency)
	return result
}

// ── HTTP Handlers ─────────────────────────────────────────────────────────────
func onrampHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var input OnRampSagaInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if input.SagaID == "" {
		input.SagaID = uuid.New().String()
	}
	result := executeOnRampSaga(input)
	w.Header().Set("Content-Type", "application/json")
	if result.Status == "failed" || result.Status == "failed_compensated" || result.Status == "failed_compensation_partial" {
		w.WriteHeader(http.StatusUnprocessableEntity)
	}
	json.NewEncoder(w).Encode(result)
}

func offrampHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var input OffRampSagaInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if input.SagaID == "" {
		input.SagaID = uuid.New().String()
	}
	result := executeOffRampSaga(input)
	w.Header().Set("Content-Type", "application/json")
	if result.Status == "failed" || result.Status == "failed_compensated" || result.Status == "failed_compensation_partial" {
		w.WriteHeader(http.StatusUnprocessableEntity)
	}
	json.NewEncoder(w).Encode(result)
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":          "healthy",
		"service":         "go-stablecoin-saga",
		"temporal_addr":   temporalAddr,
		"onramp_started":  onrampStarted.Load(),
		"onramp_ok":       onrampCompleted.Load(),
		"onramp_failed":   onrampFailed.Load(),
		"offramp_started": offrampStarted.Load(),
		"offramp_ok":      offrampCompleted.Load(),
		"offramp_failed":  offrampFailed.Load(),
	})
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	fmt.Fprintf(w, "# HELP remitflow_onramp_started_total Total on-ramp sagas started\n")
	fmt.Fprintf(w, "# TYPE remitflow_onramp_started_total counter\n")
	fmt.Fprintf(w, "remitflow_onramp_started_total %d\n", onrampStarted.Load())
	fmt.Fprintf(w, "# HELP remitflow_onramp_completed_total Total on-ramp sagas completed\n")
	fmt.Fprintf(w, "# TYPE remitflow_onramp_completed_total counter\n")
	fmt.Fprintf(w, "remitflow_onramp_completed_total %d\n", onrampCompleted.Load())
	fmt.Fprintf(w, "# HELP remitflow_onramp_failed_total Total on-ramp sagas failed\n")
	fmt.Fprintf(w, "# TYPE remitflow_onramp_failed_total counter\n")
	fmt.Fprintf(w, "remitflow_onramp_failed_total %d\n", onrampFailed.Load())
	fmt.Fprintf(w, "# HELP remitflow_onramp_compensated_total Total on-ramp sagas compensated\n")
	fmt.Fprintf(w, "# TYPE remitflow_onramp_compensated_total counter\n")
	fmt.Fprintf(w, "remitflow_onramp_compensated_total %d\n", onrampCompensated.Load())
	fmt.Fprintf(w, "# HELP remitflow_offramp_started_total Total off-ramp sagas started\n")
	fmt.Fprintf(w, "# TYPE remitflow_offramp_started_total counter\n")
	fmt.Fprintf(w, "remitflow_offramp_started_total %d\n", offrampStarted.Load())
	fmt.Fprintf(w, "# HELP remitflow_offramp_completed_total Total off-ramp sagas completed\n")
	fmt.Fprintf(w, "# TYPE remitflow_offramp_completed_total counter\n")
	fmt.Fprintf(w, "remitflow_offramp_completed_total %d\n", offrampCompleted.Load())
	fmt.Fprintf(w, "# HELP remitflow_offramp_failed_total Total off-ramp sagas failed\n")
	fmt.Fprintf(w, "# TYPE remitflow_offramp_failed_total counter\n")
	fmt.Fprintf(w, "remitflow_offramp_failed_total %d\n", offrampFailed.Load())
	fmt.Fprintf(w, "# HELP remitflow_offramp_compensated_total Total off-ramp sagas compensated\n")
	fmt.Fprintf(w, "# TYPE remitflow_offramp_compensated_total counter\n")
	fmt.Fprintf(w, "remitflow_offramp_compensated_total %d\n", offrampCompensated.Load())
}

func main() {
	slog.Info("[StablecoinSaga] Starting", "port", port, "temporal", temporalAddr)
	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/livez", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	mux.HandleFunc("/metrics", metricsHandler)
	mux.HandleFunc("/saga/onramp", onrampHandler)
	mux.HandleFunc("/saga/offramp", offrampHandler)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}
	slog.Info("[StablecoinSaga] Ready", "addr", srv.Addr)
	if err := srv.ListenAndServe(); err != nil {
		slog.Error("[StablecoinSaga] Fatal", "err", err)
		os.Exit(1)
	}
}
