// xrpl_adapter.go — REAL XRPL (XRP Ledger) rail adapter for the ODL
// orchestrator. Go standard library only — ZERO new module dependencies.
//
// ════════════════════════════════════════════════════════════════════════
// TRUST MODEL (READ BEFORE ENABLING)
// ════════════════════════════════════════════════════════════════════════
//
// This adapter talks JSON-RPC over HTTP(S) to a rippled server configured via
// XRPL_RPC_URL. The operator MUST point this at a TRUSTED, SELF-HOSTED rippled
// node. Two reasons:
//
//  1. Server-side signing. The adapter uses the rippled `sign` method, which
//     means the account secret (XRPL_SEED, a family-seed like "sXXX...") is
//     transmitted to the rippled server over the RPC connection. ANYONE who
//     controls or can observe that server learns the secret and can drain the
//     account. NEVER set XRPL_SEED when XRPL_RPC_URL points at a public or
//     third-party endpoint. Public endpoints (s1.ripple.com, xrplcluster.com,
//     ...) must only ever be used WITHOUT a seed (and then this adapter stays
//     unavailable because signing is impossible — by design).
//  2. Result integrity. This adapter trusts `engine_result` and `tx`
//     (validated-ledger) responses from the configured server. A malicious or
//     compromised server could lie about transaction outcomes. Self-hosting
//     the node is the mitigation.
//
// HONESTY INVARIANTS
// ════════════════════════════════════════════════════════════════════════
//   - Every transaction hash reported by this adapter is taken verbatim from a
//     rippled response (`sign`/`submit`/`tx`). Hashes are NEVER invented.
//   - A payment is reported successful only when `submit` returned
//     engine_result == "tesSUCCESS" AND a subsequent `tx` lookup confirms the
//     hash in a VALIDATED ledger. Provisional results are not success.
//   - XRP-only: Amount is always an integer string of drops (1 XRP = 1_000_000
//     drops). IOU/issued-currency Amount objects are intentionally NOT
//     supported — adding them requires path-finding and trust-line checks that
//     are out of scope; attempting one fails with an explicit error.
//   - Retries are bounded and applied ONLY to transport-level errors (dial,
//     timeout, connection reset). rippled-level errors are never retried
//     blindly.
//
// ════════════════════════════════════════════════════════════════════════
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"time"
)

// ── Configuration ────────────────────────────────────────────────────────────

// XRPLConfig holds the operator-supplied XRPL rail configuration.
type XRPLConfig struct {
	// RPCURL is the JSON-RPC endpoint of the operator's TRUSTED, SELF-HOSTED
	// rippled server. See the trust-model banner above.
	RPCURL string
	// Seed is the family seed (sXXX...) of the ODL source account. It is sent
	// to the rippled server for server-side signing — therefore the server
	// MUST be self-hosted and trusted.
	Seed string
	// Account is the classic address (rXXX...) of the ODL source account. If
	// empty, rippled derives it from the seed during `sign`.
	Account string
	// Destination is the classic address of the ODL bridge destination account
	// (e.g. the off-ramp partner's XRPL deposit address). Required to execute.
	Destination string
	// DestinationTag is the optional destination tag for the bridge payment.
	DestinationTag *uint32
	// RequestTimeout bounds every individual JSON-RPC call.
	RequestTimeout time.Duration
	// ConfirmTimeout bounds the total sign→submit→confirm pipeline.
	ConfirmTimeout time.Duration
	// MaxTransportRetries bounds retries on transport-level errors only.
	MaxTransportRetries int
}

// xrplConfigFromEnv loads XRPL rail configuration from the environment.
// Returns (nil, false) when the rail is not configured; callers must then
// keep the corridor fail-closed (UNAVAILABLE).
//
// Required to be "configured": XRPL_RPC_URL + XRPL_SEED.
// Required to execute a payment: XRPL_DESTINATION_ACCOUNT (+ optional
// XRPL_DESTINATION_TAG).
func xrplConfigFromEnv() (*XRPLConfig, bool) {
	rpcURL := os.Getenv("XRPL_RPC_URL")
	seed := os.Getenv("XRPL_SEED")
	if rpcURL == "" || seed == "" {
		return nil, false
	}
	cfg := &XRPLConfig{
		RPCURL:              rpcURL,
		Seed:                seed,
		Account:             os.Getenv("XRPL_ACCOUNT"),
		Destination:         os.Getenv("XRPL_DESTINATION_ACCOUNT"),
		RequestTimeout:      10 * time.Second,
		ConfirmTimeout:      60 * time.Second,
		MaxTransportRetries: 2,
	}
	if tag := os.Getenv("XRPL_DESTINATION_TAG"); tag != "" {
		if v, err := strconv.ParseUint(tag, 10, 32); err == nil {
			t32 := uint32(v)
			cfg.DestinationTag = &t32
		} else {
			slog.Warn("[XRPL] ignoring unparsable XRPL_DESTINATION_TAG", "value", tag)
		}
	}
	return cfg, true
}

// ── JSON-RPC client ──────────────────────────────────────────────────────────

// XRPLAdapter is a minimal stdlib-only XRPL JSON-RPC client.
type XRPLAdapter struct {
	cfg    XRPLConfig
	client *http.Client
}

func newXRPLAdapter(cfg XRPLConfig) *XRPLAdapter {
	return &XRPLAdapter{
		cfg:    cfg,
		client: &http.Client{Timeout: cfg.RequestTimeout},
	}
}

// xrplRPCRequest is the rippled JSON-RPC request envelope: a single-command
// object with an optional "params" array containing exactly one object.
type xrplRPCRequest struct {
	Method string           `json:"method"`
	Params []map[string]any `json:"params,omitempty"`
}

// xrplRPCResponse mirrors rippled's JSON-RPC response envelope. "result" is
// kept raw so each method decodes its own shape; error-style failures surface
// inside result as {"error": ..., "error_message": ...} with status "error".
type xrplRPCResponse struct {
	Result json.RawMessage `json:"result"`
}

// xrplResultErrorPeek extracts rippled-level error fields from a raw result.
type xrplResultErrorPeek struct {
	Status        string `json:"status"`
	Error         string `json:"error"`
	ErrorMessage  string `json:"error_message"`
	ErrorCode     int    `json:"error_code"`
	EngineResult  string `json:"engine_result"`
	EngineMessage string `json:"engine_result_message"`
}

// doRPC performs one JSON-RPC call. Transport-level errors (network, timeout)
// are retried up to cfg.MaxTransportRetries times with a short backoff;
// rippled-level errors (HTTP 200 with result.error, or non-200 status) are
// returned immediately without retry — a duplicated `submit` is safe (same
// signed blob → same tx hash), but a duplicated application-level effect is
// never assumed away here.
func (a *XRPLAdapter) doRPC(ctx context.Context, method string, params map[string]any) (json.RawMessage, error) {
	reqBody, err := json.Marshal(xrplRPCRequest{Method: method, Params: []map[string]any{params}})
	if err != nil {
		return nil, fmt.Errorf("xrpl: marshal %s request: %w", method, err)
	}

	var lastErr error
	for attempt := 0; attempt <= a.cfg.MaxTransportRetries; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(time.Duration(attempt) * 500 * time.Millisecond):
			}
		}
		raw, transportErr := a.doRPCOnce(ctx, reqBody)
		if transportErr == nil {
			return raw, nil
		}
		var rpcErr *XRPLRPCError
		if errors.As(transportErr, &rpcErr) || errors.Is(ctx.Err(), context.Canceled) {
			return nil, transportErr // rippled-level error: never retried
		}
		lastErr = transportErr
		slog.Warn("[XRPL] transport error, will retry if budget remains",
			"method", method, "attempt", attempt, "err", transportErr)
	}
	return nil, fmt.Errorf("xrpl: %s failed after %d transport attempts: %w",
		method, a.cfg.MaxTransportRetries+1, lastErr)
}

// doRPCOnce performs a single JSON-RPC round-trip and decodes the envelope.
// It returns a *retryable* error only for transport failures; rippled-level
// errors are wrapped in XRPLRPCError (non-retryable).
func (a *XRPLAdapter) doRPCOnce(ctx context.Context, body []byte) (json.RawMessage, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.RPCURL, bytes.NewReader(body))
	if err != nil {
		return nil, &XRPLRPCError{Message: fmt.Sprintf("build request: %v", err)}
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.client.Do(req)
	if err != nil {
		return nil, err // transport error — retryable
	}
	defer resp.Body.Close()

	respBody, rerr := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if rerr != nil {
		return nil, rerr // transport error — retryable
	}

	var env xrplRPCResponse
	if err := json.Unmarshal(respBody, &env); err != nil {
		// A syntactically broken response from the server is not retryable.
		return nil, &XRPLRPCError{Message: fmt.Sprintf("decode response: %v", err)}
	}
	var peek xrplResultErrorPeek
	_ = json.Unmarshal(env.Result, &peek)
	if resp.StatusCode != http.StatusOK {
		return nil, &XRPLRPCError{
			Message: fmt.Sprintf("HTTP %d from rippled (error=%s %s)",
				resp.StatusCode, peek.Error, peek.ErrorMessage),
		}
	}
	if peek.Error != "" {
		return nil, &XRPLRPCError{
			Message: fmt.Sprintf("rippled error=%s code=%d: %s",
				peek.Error, peek.ErrorCode, peek.ErrorMessage),
		}
	}
	return env.Result, nil
}

// XRPLRPCError is a non-retryable rippled-level error.
type XRPLRPCError struct{ Message string }

func (e *XRPLRPCError) Error() string { return "xrpl rpc: " + e.Message }

// ── XRPL methods ─────────────────────────────────────────────────────────────

// AccountInfoResult is the subset of `account_info` we rely on.
type AccountInfoResult struct {
	AccountData struct {
		Account  string `json:"Account"`
		Balance  string `json:"Balance"` // drops
		Sequence uint32 `json:"Sequence"`
	} `json:"account_data"`
	LedgerIndex int64 `json:"ledger_current_index"`
}

// AccountInfo fetches account data (balance in drops, current sequence).
func (a *XRPLAdapter) AccountInfo(ctx context.Context) (*AccountInfoResult, error) {
	acct := a.cfg.Account
	params := map[string]any{"ledger_index": "current"}
	if acct != "" {
		params["account"] = acct
	} else {
		return nil, fmt.Errorf("xrpl: account_info requires XRPL_ACCOUNT when not derivable")
	}
	raw, err := a.doRPC(ctx, "account_info", params)
	if err != nil {
		return nil, err
	}
	var res AccountInfoResult
	if err := json.Unmarshal(raw, &res); err != nil {
		return nil, fmt.Errorf("xrpl: decode account_info: %w", err)
	}
	return &res, nil
}

// FeeResult is the subset of `fee` we rely on.
type FeeResult struct {
	Drops struct {
		MedianFee  string `json:"median_fee"`
		MinimumFee string `json:"minimum_fee"`
		OpenLedger string `json:"open_ledger_fee"`
		BaseFeeXRP string `json:"base_fee_xrp"`
	} `json:"drops"`
	LedgerCurrentIndex int64 `json:"ledger_current_index"`
}

// Fee fetches current fee levels (in drops).
func (a *XRPLAdapter) Fee(ctx context.Context) (*FeeResult, error) {
	raw, err := a.doRPC(ctx, "fee", map[string]any{})
	if err != nil {
		return nil, err
	}
	var res FeeResult
	if err := json.Unmarshal(raw, &res); err != nil {
		return nil, fmt.Errorf("xrpl: decode fee: %w", err)
	}
	return &res, nil
}

// ServerStateResult is the subset of `server_state` we rely on.
type ServerStateResult struct {
	State struct {
		ValidatedLedger struct {
			Seq int64 `json:"seq"`
		} `json:"validated_ledger"`
		ServerState string `json:"server_state"`
	} `json:"state"`
}

// ServerState fetches server state including the latest validated ledger seq.
func (a *XRPLAdapter) ServerState(ctx context.Context) (*ServerStateResult, error) {
	raw, err := a.doRPC(ctx, "server_state", map[string]any{})
	if err != nil {
		return nil, err
	}
	var res ServerStateResult
	if err := json.Unmarshal(raw, &res); err != nil {
		return nil, fmt.Errorf("xrpl: decode server_state: %w", err)
	}
	return &res, nil
}

// SignResult is the subset of `sign` we rely on.
type SignResult struct {
	TxBlob string `json:"tx_blob"`
	TxJSON struct {
		Account string `json:"Account"`
		Hash    string `json:"hash"`
	} `json:"tx_json"`
}

// Sign performs SERVER-SIDE signing: the seed is transmitted to the rippled
// server configured in XRPL_RPC_URL. That server MUST be self-hosted and
// trusted (see the trust-model banner at the top of this file).
func (a *XRPLAdapter) Sign(ctx context.Context, txJSON map[string]any) (*SignResult, error) {
	params := map[string]any{
		"tx_json": txJSON,
		"secret":  a.cfg.Seed,
		"offline": false,
	}
	raw, err := a.doRPC(ctx, "sign", params)
	if err != nil {
		return nil, err
	}
	var res SignResult
	if err := json.Unmarshal(raw, &res); err != nil {
		return nil, fmt.Errorf("xrpl: decode sign: %w", err)
	}
	if res.TxBlob == "" {
		return nil, fmt.Errorf("xrpl: sign returned no tx_blob")
	}
	return &res, nil
}

// SubmitResult is the subset of `submit` we rely on.
type SubmitResult struct {
	EngineResult        string `json:"engine_result"`
	EngineResultMessage string `json:"engine_result_message"`
	TxJSON              struct {
		Hash string `json:"hash"`
	} `json:"tx_json"`
	Accepted       bool  `json:"accepted"`
	KeptUnchanged  bool  `json:"kept_unchanged"`
	LedgerCurIndex int64 `json:"ledger_current_index"`
}

// Submit submits a signed transaction blob. The returned hash ALWAYS comes
// from rippled's response (tx_json.hash) — never computed locally.
func (a *XRPLAdapter) Submit(ctx context.Context, blob string) (*SubmitResult, error) {
	raw, err := a.doRPC(ctx, "submit", map[string]any{"tx_blob": blob})
	if err != nil {
		return nil, err
	}
	var res SubmitResult
	if err := json.Unmarshal(raw, &res); err != nil {
		return nil, fmt.Errorf("xrpl: decode submit: %w", err)
	}
	return &res, nil
}

// TxResult is the subset of `tx` we rely on.
type TxResult struct {
	Hash      string `json:"hash"`
	Validated bool   `json:"validated"`
	LedgerIdx int64  `json:"ledger_index"`
	Meta      struct {
		TransactionResult string `json:"TransactionResult"`
	} `json:"meta"`
}

// Tx looks up a transaction by hash. `validated` == true means it is in a
// validated ledger (final).
func (a *XRPLAdapter) Tx(ctx context.Context, hash string) (*TxResult, error) {
	raw, err := a.doRPC(ctx, "tx", map[string]any{"transaction": hash})
	if err != nil {
		return nil, err
	}
	var res TxResult
	if err := json.Unmarshal(raw, &res); err != nil {
		return nil, fmt.Errorf("xrpl: decode tx: %w", err)
	}
	return &res, nil
}

// ── Payment pipeline ─────────────────────────────────────────────────────────

// XRPLPaymentOutcome is the honest record of one XRPL bridge payment. Every
// field is sourced from a rippled response.
type XRPLPaymentOutcome struct {
	TxHash       string `json:"tx_hash"`
	EngineResult string `json:"engine_result"`
	LedgerIndex  int64  `json:"ledger_index"`
	FeeDrops     string `json:"fee_drops"`
	Account      string `json:"account"`
	Destination  string `json:"destination"`
	AmountDrops  string `json:"amount_drops"`
}

// SendXRPPayment signs, submits, and confirms a native-XRP Payment of
// amountDrops (integer drops as a decimal string) to the configured bridge
// destination. Success requires engine_result == tesSUCCESS from submit AND a
// validated-ledger confirmation via `tx`. Context timeouts bound every stage.
//
// IOU/issued-currency payments are NOT supported (see banner): Amount here is
// always a drops string.
func (a *XRPLAdapter) SendXRPPayment(ctx context.Context, amountDrops string) (*XRPLPaymentOutcome, error) {
	if _, err := strconv.ParseUint(amountDrops, 10, 64); err != nil {
		return nil, fmt.Errorf("xrpl: amount must be integer drops (XRP-only; IOU not supported): %q", amountDrops)
	}
	if a.cfg.Destination == "" {
		return nil, fmt.Errorf("xrpl: XRPL_DESTINATION_ACCOUNT is required to execute a bridge payment")
	}

	ctx, cancel := context.WithTimeout(ctx, a.cfg.ConfirmTimeout)
	defer cancel()

	// 1. Account sequence + fee from the ledger.
	acct, err := a.AccountInfo(ctx)
	if err != nil {
		return nil, fmt.Errorf("xrpl: account_info: %w", err)
	}
	fee, err := a.Fee(ctx)
	if err != nil {
		return nil, fmt.Errorf("xrpl: fee: %w", err)
	}
	feeDrops := fee.Drops.MedianFee
	if feeDrops == "" || feeDrops == "0" {
		feeDrops = fee.Drops.MinimumFee
	}
	if feeDrops == "" || feeDrops == "0" {
		feeDrops = fee.Drops.OpenLedger
	}
	if _, err := strconv.ParseUint(feeDrops, 10, 64); err != nil || feeDrops == "" {
		return nil, fmt.Errorf("xrpl: rippled returned no usable fee level")
	}

	// LastLedgerSequence: current validated ledger + 20 ledgers (~80s) of runway.
	state, err := a.ServerState(ctx)
	if err != nil {
		return nil, fmt.Errorf("xrpl: server_state: %w", err)
	}
	lastLedger := state.State.ValidatedLedger.Seq + 20

	// 2. Build the Payment. XRP-only: Amount is a drops string, never an IOU
	// object.
	txJSON := map[string]any{
		"TransactionType":    "Payment",
		"Account":            acct.AccountData.Account,
		"Destination":        a.cfg.Destination,
		"Amount":             amountDrops,
		"Fee":                feeDrops,
		"Sequence":           acct.AccountData.Sequence,
		"LastLedgerSequence": lastLedger,
	}
	if a.cfg.DestinationTag != nil {
		txJSON["DestinationTag"] = *a.cfg.DestinationTag
	}

	// 3. Sign (server-side — trusted self-hosted rippled only, see banner).
	signed, err := a.Sign(ctx, txJSON)
	if err != nil {
		return nil, fmt.Errorf("xrpl: sign: %w", err)
	}

	// 4. Submit and demand tesSUCCESS. Provisional successes (ter*, etc.) are
	// NOT accepted as final.
	sub, err := a.Submit(ctx, signed.TxBlob)
	if err != nil {
		return nil, fmt.Errorf("xrpl: submit: %w", err)
	}
	txHash := sub.TxJSON.Hash
	if txHash == "" {
		txHash = signed.TxJSON.Hash // still rippled-sourced, never invented
	}
	if txHash == "" {
		return nil, fmt.Errorf("xrpl: rippled returned no transaction hash")
	}
	outcome := &XRPLPaymentOutcome{
		TxHash:       txHash,
		EngineResult: sub.EngineResult,
		FeeDrops:     feeDrops,
		Account:      acct.AccountData.Account,
		Destination:  a.cfg.Destination,
		AmountDrops:  amountDrops,
	}
	if sub.EngineResult != "tesSUCCESS" {
		return outcome, fmt.Errorf("xrpl: submit engine_result=%s: %s",
			sub.EngineResult, sub.EngineResultMessage)
	}

	// 5. Confirm in a VALIDATED ledger. Poll `tx` until validated, the
	// LastLedgerSequence deadline passes, or the context expires.
	poll := time.NewTicker(time.Second)
	defer poll.Stop()
	for {
		txRes, err := a.Tx(ctx, txHash)
		if err == nil && txRes.Validated {
			if txRes.Meta.TransactionResult != "" && txRes.Meta.TransactionResult != "tesSUCCESS" {
				return outcome, fmt.Errorf("xrpl: tx %s validated with result %s", txHash, txRes.Meta.TransactionResult)
			}
			outcome.LedgerIndex = txRes.LedgerIdx
			return outcome, nil
		}
		// Not yet validated (or txnNotFound while it propagates) — check the
		// last-ledger deadline before polling again.
		select {
		case <-ctx.Done():
			return outcome, fmt.Errorf("xrpl: confirmation timed out for tx %s (may still validate later; reconcile before retrying)", txHash)
		case <-poll.C:
		}
		cur, serr := a.ServerState(ctx)
		if serr == nil && cur.State.ValidatedLedger.Seq > lastLedger {
			return outcome, fmt.Errorf("xrpl: tx %s not validated by LastLedgerSequence %d (expired; safe to retry as a new tx)", txHash, lastLedger)
		}
	}
}
