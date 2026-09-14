// Deterministic builders for CBN BDC regulatory returns.
//
// IMPORTANT (honest-adapter policy, SPEC-bdc §0 rule 4): the real CBN field
// layouts for FIFX / FinA / CARP / TRMS / extranet submissions are NOT publicly
// published. Every builder here therefore emits formatVersion "v1-fixture":
// an internally-consistent fixture layout derived from the requirement
// inventory (M7 regulatory reporting). Fixture fidelity against the real CBN
// layouts is validated during the CBN Provisional Approval (PA) window.
// NOTHING in this package claims CBN conformance.
package main

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// FixtureFormatVersion is stamped on every built payload. Bumped only with an
// explicit fixture-layout change; golden files under testdata/ pin the bytes.
const FixtureFormatVersion = "v1-fixture"

// fixtureNotice documents the honest-adapter stance in response metadata.
const fixtureNotice = "fixture layout (formatVersion v1-fixture); real CBN field layouts are not public — fidelity is validated in the PA window; NOT CBN-conformance certified"

// Return types supported by this service.
var returnTypes = map[string]bool{
	"fifx":     true,
	"fina":     true,
	"carp":     true,
	"trms":     true,
	"extranet": true,
}

// purposeCodes mirrors the approved-purpose list from the BDC SPEC (§3.1).
var purposeCodes = map[string]bool{
	"PTA": true, "BTA": true, "SCHOOL_FEES": true, "MEDICAL": true,
	"EXAM_FEES": true, "SUBSCRIPTION": true, "NONRESIDENT_REPATRIATION": true,
}

// txnTypes mirrors bdc_transactions.txn_type in the BDC schema (SPEC §2.11).
var txnTypes = map[string]bool{
	"buy_fx": true, "sell_fx": true, "imto_payout": true,
	"nfem_purchase": true, "nfem_return": true,
}

// sofThresholdUsdMinor is the source-of-funds declaration trigger: $10k cents.
const sofThresholdUsdMinor int64 = 1_000_000

var (
	currencyRe = regexp.MustCompile(`^[A-Z]{3}$`)
	dateRe     = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

// ─── Input model (the `data` jsonb section of a build request) ───────────────

// TxnRecord is one BDC transaction as staged by the B3 reporting router.
// All money is minor units (kobo/cents) — integer-only, deterministic.
type TxnRecord struct {
	TxnRef           string `json:"txnRef"`
	Date             string `json:"date"` // YYYY-MM-DD
	TxnType          string `json:"txnType"`
	Currency         string `json:"currency"`
	FxAmountMinor    int64  `json:"fxAmountMinor"`
	NairaAmountMinor int64  `json:"nairaAmountMinor"`
	RateMinor        int64  `json:"rateMinor"`
	PurposeCode      string `json:"purposeCode,omitempty"`
	PaymentMethod    string `json:"paymentMethod,omitempty"`
	CustomerType     string `json:"customerType,omitempty"`
	BranchCode       string `json:"branchCode,omitempty"`
	CashPortionMinor int64  `json:"cashPortionMinor,omitempty"`
	SofDeclarationID string `json:"sofDeclarationId,omitempty"`
	PepFlag          bool   `json:"pepFlag,omitempty"`
}

// BalanceRecord carries the EOD position figures used by the fina return.
type BalanceRecord struct {
	ShareholdersFundsMinor int64 `json:"shareholdersFundsMinor"`
	NopUsdMinor            int64 `json:"nopUsdMinor"`
	BorrowingMinor         int64 `json:"borrowingMinor"`
	NopLimitPct            int   `json:"nopLimitPct"`       // default 30 per SPEC
	BorrowingLimitPct      int   `json:"borrowingLimitPct"` // default 50 per SPEC
}

// BranchRecord identifies a licensed branch for the carp return.
type BranchRecord struct {
	BranchCode string `json:"branchCode"`
	StateCode  string `json:"stateCode"`
	Status     string `json:"status,omitempty"`
}

// ReturnData is the generic staged dataset; each builder consumes the
// sections relevant to its return type.
type ReturnData struct {
	Transactions []TxnRecord    `json:"transactions,omitempty"`
	Balances     *BalanceRecord `json:"balances,omitempty"`
	Branches     []BranchRecord `json:"branches,omitempty"`
}

// ValidationError pinpoints a rejected field: which field, which rule, what value.
type ValidationError struct {
	Field string `json:"field"`
	Rule  string `json:"rule"`
	Value string `json:"value"`
}

func (v ValidationError) String() string {
	return fmt.Sprintf("%s: %s (value=%q)", v.Field, v.Rule, v.Value)
}

// ─── Shared validation helpers ───────────────────────────────────────────────

func validateHeader(tenantID int64, returnType, periodStart, periodEnd string) []ValidationError {
	var errs []ValidationError
	if tenantID <= 0 {
		errs = append(errs, ValidationError{"tenantId", "positive_integer", fmt.Sprintf("%d", tenantID)})
	}
	if !returnTypes[returnType] {
		errs = append(errs, ValidationError{"returnType", "enum(fifx|fina|carp|trms|extranet)", returnType})
	}
	if !dateRe.MatchString(periodStart) {
		errs = append(errs, ValidationError{"periodStart", "format(YYYY-MM-DD)", periodStart})
	}
	if !dateRe.MatchString(periodEnd) {
		errs = append(errs, ValidationError{"periodEnd", "format(YYYY-MM-DD)", periodEnd})
	}
	if dateRe.MatchString(periodStart) && dateRe.MatchString(periodEnd) && periodStart > periodEnd {
		errs = append(errs, ValidationError{"periodStart", "period_start_before_end", periodStart + ">" + periodEnd})
	}
	return errs
}

// validateTxn checks the rules common to every transaction line. Field paths
// are indexed (transactions[i].field) so callers can locate the bad row.
func validateTxn(i int, t TxnRecord, periodStart, periodEnd string) []ValidationError {
	var errs []ValidationError
	p := fmt.Sprintf("transactions[%d].", i)
	if t.TxnRef == "" {
		errs = append(errs, ValidationError{p + "txnRef", "required", t.TxnRef})
	}
	if !dateRe.MatchString(t.Date) {
		errs = append(errs, ValidationError{p + "date", "format(YYYY-MM-DD)", t.Date})
	} else if t.Date < periodStart || t.Date > periodEnd {
		errs = append(errs, ValidationError{p + "date", "within_period", t.Date})
	}
	if !txnTypes[t.TxnType] {
		errs = append(errs, ValidationError{p + "txnType", "enum(buy_fx|sell_fx|imto_payout|nfem_purchase|nfem_return)", t.TxnType})
	}
	if !currencyRe.MatchString(t.Currency) {
		errs = append(errs, ValidationError{p + "currency", "format(ISO4217-alpha3-upper)", t.Currency})
	}
	if t.FxAmountMinor <= 0 {
		errs = append(errs, ValidationError{p + "fxAmountMinor", "positive", fmt.Sprintf("%d", t.FxAmountMinor)})
	}
	if t.NairaAmountMinor <= 0 {
		errs = append(errs, ValidationError{p + "nairaAmountMinor", "positive", fmt.Sprintf("%d", t.NairaAmountMinor)})
	}
	if t.RateMinor <= 0 {
		errs = append(errs, ValidationError{p + "rateMinor", "positive", fmt.Sprintf("%d", t.RateMinor)})
	}
	if t.TxnType == "sell_fx" && !purposeCodes[t.PurposeCode] {
		errs = append(errs, ValidationError{p + "purposeCode", "required_approved_purpose_for_sell_fx", t.PurposeCode})
	}
	// 25% cash-settlement cap (requirement inventory §C) — checked on the FX leg.
	if t.CashPortionMinor < 0 || t.CashPortionMinor*4 > t.FxAmountMinor {
		errs = append(errs, ValidationError{p + "cashPortionMinor", "cash_cap_25pct_of_fx_amount", fmt.Sprintf("%d", t.CashPortionMinor)})
	}
	return errs
}

// sortedTxns returns a copy of txns ordered by (date, txnRef) so payload bytes
// are independent of input ordering.
func sortedTxns(txns []TxnRecord) []TxnRecord {
	out := make([]TxnRecord, len(txns))
	copy(out, txns)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Date != out[j].Date {
			return out[i].Date < out[j].Date
		}
		return out[i].TxnRef < out[j].TxnRef
	})
	return out
}

// ─── Payload line types (fixed struct field order = deterministic bytes) ─────

// payloadHeader is stamped on every return payload.
type payloadHeader struct {
	ReturnType    string `json:"returnType"`
	TenantID      int64  `json:"tenantId"`
	PeriodStart   string `json:"periodStart"`
	PeriodEnd     string `json:"periodEnd"`
	FormatVersion string `json:"formatVersion"`
}

func newHeader(tenantID int64, returnType, periodStart, periodEnd string) payloadHeader {
	return payloadHeader{
		ReturnType:    returnType,
		TenantID:      tenantID,
		PeriodStart:   periodStart,
		PeriodEnd:     periodEnd,
		FormatVersion: FixtureFormatVersion,
	}
}

// ─── FIFX — periodic FX purchase/sale return ─────────────────────────────────

type fifxLine struct {
	TxnRef           string `json:"txnRef"`
	Date             string `json:"date"`
	TxnType          string `json:"txnType"`
	Currency         string `json:"currency"`
	FxAmountMinor    int64  `json:"fxAmountMinor"`
	NairaAmountMinor int64  `json:"nairaAmountMinor"`
	RateMinor        int64  `json:"rateMinor"`
	PurposeCode      string `json:"purposeCode"`
	PaymentMethod    string `json:"paymentMethod"`
	CustomerType     string `json:"customerType"`
}

type fifxCurrencyTotal struct {
	Currency         string `json:"currency"`
	FxAmountMinor    int64  `json:"fxAmountMinor"`
	NairaAmountMinor int64  `json:"nairaAmountMinor"`
}

type fifxSummary struct {
	TransactionCount int                 `json:"transactionCount"`
	BuyCount         int                 `json:"buyCount"`
	SellCount        int                 `json:"sellCount"`
	TotalsByCurrency []fifxCurrencyTotal `json:"totalsByCurrency"`
}

type fifxPayload struct {
	Header  payloadHeader `json:"header"`
	Lines   []fifxLine    `json:"lines"`
	Summary fifxSummary   `json:"summary"`
}

func buildFIFX(tenantID int64, periodStart, periodEnd string, data ReturnData) (interface{}, []ValidationError) {
	var errs []ValidationError
	for i, t := range data.Transactions {
		for _, e := range validateTxn(i, t, periodStart, periodEnd) {
			errs = append(errs, e)
		}
		if t.TxnType != "buy_fx" && t.TxnType != "sell_fx" {
			errs = append(errs, ValidationError{
				fmt.Sprintf("transactions[%d].txnType", i), "fifx_scope(buy_fx|sell_fx)", t.TxnType})
		}
	}

	txns := sortedTxns(data.Transactions)
	lines := make([]fifxLine, 0, len(txns))
	totals := map[string]*fifxCurrencyTotal{}
	buyCount, sellCount := 0, 0
	for _, t := range txns {
		lines = append(lines, fifxLine{
			TxnRef: t.TxnRef, Date: t.Date, TxnType: t.TxnType, Currency: t.Currency,
			FxAmountMinor: t.FxAmountMinor, NairaAmountMinor: t.NairaAmountMinor,
			RateMinor: t.RateMinor, PurposeCode: t.PurposeCode,
			PaymentMethod: t.PaymentMethod, CustomerType: t.CustomerType,
		})
		if t.TxnType == "buy_fx" {
			buyCount++
		} else if t.TxnType == "sell_fx" {
			sellCount++
		}
		ct, ok := totals[t.Currency]
		if !ok {
			ct = &fifxCurrencyTotal{Currency: t.Currency}
			totals[t.Currency] = ct
		}
		ct.FxAmountMinor += t.FxAmountMinor
		ct.NairaAmountMinor += t.NairaAmountMinor
	}
	currencies := make([]string, 0, len(totals))
	for c := range totals {
		currencies = append(currencies, c)
	}
	sort.Strings(currencies)
	totalsList := make([]fifxCurrencyTotal, 0, len(currencies))
	for _, c := range currencies {
		totalsList = append(totalsList, *totals[c])
	}

	return fifxPayload{
		Header: newHeader(tenantID, "fifx", periodStart, periodEnd),
		Lines:  lines,
		Summary: fifxSummary{
			TransactionCount: len(lines),
			BuyCount:         buyCount,
			SellCount:        sellCount,
			TotalsByCurrency: totalsList,
		},
	}, errs
}

// ─── FinA — financial position return (NOP / borrowing vs limits) ────────────

type finaComputed struct {
	NopPctBps         int64 `json:"nopPctBps"` // NOP as % of shareholders' funds, basis points
	BorrowingPctBps   int64 `json:"borrowingPctBps"`
	NopLimitBps       int64 `json:"nopLimitBps"`
	BorrowingLimitBps int64 `json:"borrowingLimitBps"`
	NopBreach         bool  `json:"nopBreach"`
	BorrowingBreach   bool  `json:"borrowingBreach"`
}

type finaPayload struct {
	Header   payloadHeader `json:"header"`
	Balances BalanceRecord `json:"balances"`
	Computed finaComputed  `json:"computed"`
}

func buildFinA(tenantID int64, periodStart, periodEnd string, data ReturnData) (interface{}, []ValidationError) {
	var errs []ValidationError
	if data.Balances == nil {
		errs = append(errs, ValidationError{"balances", "required_section", "null"})
		return finaPayload{Header: newHeader(tenantID, "fina", periodStart, periodEnd)}, errs
	}
	b := *data.Balances
	if b.ShareholdersFundsMinor <= 0 {
		errs = append(errs, ValidationError{"balances.shareholdersFundsMinor", "positive", fmt.Sprintf("%d", b.ShareholdersFundsMinor)})
	}
	if b.NopUsdMinor < 0 {
		errs = append(errs, ValidationError{"balances.nopUsdMinor", "non_negative", fmt.Sprintf("%d", b.NopUsdMinor)})
	}
	if b.BorrowingMinor < 0 {
		errs = append(errs, ValidationError{"balances.borrowingMinor", "non_negative", fmt.Sprintf("%d", b.BorrowingMinor)})
	}
	if b.NopLimitPct < 1 || b.NopLimitPct > 100 {
		errs = append(errs, ValidationError{"balances.nopLimitPct", "range(1..100)", fmt.Sprintf("%d", b.NopLimitPct)})
	}
	if b.BorrowingLimitPct < 1 || b.BorrowingLimitPct > 100 {
		errs = append(errs, ValidationError{"balances.borrowingLimitPct", "range(1..100)", fmt.Sprintf("%d", b.BorrowingLimitPct)})
	}

	var computed finaComputed
	if b.ShareholdersFundsMinor > 0 {
		// Integer-only basis-point math: pct_bps = value * 10000 / funds.
		computed.NopPctBps = b.NopUsdMinor * 10000 / b.ShareholdersFundsMinor
		computed.BorrowingPctBps = b.BorrowingMinor * 10000 / b.ShareholdersFundsMinor
		computed.NopLimitBps = int64(b.NopLimitPct) * 100
		computed.BorrowingLimitBps = int64(b.BorrowingLimitPct) * 100
		computed.NopBreach = computed.NopPctBps > computed.NopLimitBps
		computed.BorrowingBreach = computed.BorrowingPctBps > computed.BorrowingLimitBps
	}

	return finaPayload{
		Header:   newHeader(tenantID, "fina", periodStart, periodEnd),
		Balances: b,
		Computed: computed,
	}, errs
}

// ─── CARP — consolidated branch activity return ──────────────────────────────

type carpBranchLine struct {
	BranchCode       string `json:"branchCode"`
	StateCode        string `json:"stateCode"`
	TransactionCount int    `json:"transactionCount"`
	BuyCount         int    `json:"buyCount"`
	SellCount        int    `json:"sellCount"`
	BuyFxMinor       int64  `json:"buyFxMinor"`
	SellFxMinor      int64  `json:"sellFxMinor"`
}

type carpSummary struct {
	BranchCount      int   `json:"branchCount"`
	TransactionCount int   `json:"transactionCount"`
	TotalBuyFxMinor  int64 `json:"totalBuyFxMinor"`
	TotalSellFxMinor int64 `json:"totalSellFxMinor"`
}

type carpPayload struct {
	Header   payloadHeader    `json:"header"`
	Branches []carpBranchLine `json:"branches"`
	Summary  carpSummary      `json:"summary"`
}

func buildCARP(tenantID int64, periodStart, periodEnd string, data ReturnData) (interface{}, []ValidationError) {
	var errs []ValidationError
	if len(data.Branches) == 0 {
		errs = append(errs, ValidationError{"branches", "required_non_empty", "[]"})
	}
	seen := map[string]bool{}
	for i, br := range data.Branches {
		p := fmt.Sprintf("branches[%d].", i)
		if br.BranchCode == "" {
			errs = append(errs, ValidationError{p + "branchCode", "required", br.BranchCode})
		} else if seen[br.BranchCode] {
			errs = append(errs, ValidationError{p + "branchCode", "unique", br.BranchCode})
		}
		seen[br.BranchCode] = true
		if len(br.StateCode) != 2 || br.StateCode != strings.ToUpper(br.StateCode) {
			errs = append(errs, ValidationError{p + "stateCode", "format(2-letter-upper)", br.StateCode})
		}
	}
	for i, t := range data.Transactions {
		for _, e := range validateTxn(i, t, periodStart, periodEnd) {
			errs = append(errs, e)
		}
		if t.BranchCode == "" {
			errs = append(errs, ValidationError{fmt.Sprintf("transactions[%d].branchCode", i), "required_for_carp", t.BranchCode})
		} else if !seen[t.BranchCode] {
			errs = append(errs, ValidationError{fmt.Sprintf("transactions[%d].branchCode", i), "reference(branches)", t.BranchCode})
		}
	}

	agg := map[string]*carpBranchLine{}
	for _, t := range data.Transactions {
		line, ok := agg[t.BranchCode]
		if !ok {
			line = &carpBranchLine{BranchCode: t.BranchCode}
			agg[t.BranchCode] = line
		}
		line.TransactionCount++
		if t.TxnType == "buy_fx" {
			line.BuyCount++
			line.BuyFxMinor += t.FxAmountMinor
		} else if t.TxnType == "sell_fx" {
			line.SellCount++
			line.SellFxMinor += t.FxAmountMinor
		}
	}
	// Emit one line per registered branch (even with zero activity), ordered by code.
	branches := make([]BranchRecord, len(data.Branches))
	copy(branches, data.Branches)
	sort.SliceStable(branches, func(i, j int) bool { return branches[i].BranchCode < branches[j].BranchCode })

	lines := make([]carpBranchLine, 0, len(branches))
	var summary carpSummary
	for _, br := range branches {
		line := carpBranchLine{BranchCode: br.BranchCode, StateCode: br.StateCode}
		if a, ok := agg[br.BranchCode]; ok {
			line = *a
			line.StateCode = br.StateCode
		}
		summary.TransactionCount += line.TransactionCount
		summary.TotalBuyFxMinor += line.BuyFxMinor
		summary.TotalSellFxMinor += line.SellFxMinor
		lines = append(lines, line)
	}
	summary.BranchCount = len(lines)

	return carpPayload{
		Header:   newHeader(tenantID, "carp", periodStart, periodEnd),
		Branches: lines,
		Summary:  summary,
	}, errs
}

// ─── TRMS — transaction-monitoring return (reportable lines) ─────────────────

// Reportable = amount at/above the $10k SoF threshold OR PEP-involved.
type trmsLine struct {
	TxnRef           string `json:"txnRef"`
	Date             string `json:"date"`
	Currency         string `json:"currency"`
	FxAmountMinor    int64  `json:"fxAmountMinor"`
	CustomerType     string `json:"customerType"`
	SofDeclarationID string `json:"sofDeclarationId"`
	PepFlag          bool   `json:"pepFlag"`
	ReportReason     string `json:"reportReason"` // threshold|pep|threshold+pep
}

type trmsSummary struct {
	ReportableCount        int   `json:"reportableCount"`
	TotalReportableFxMinor int64 `json:"totalReportableFxMinor"`
	PepCount               int   `json:"pepCount"`
}

type trmsPayload struct {
	Header  payloadHeader `json:"header"`
	Lines   []trmsLine    `json:"lines"`
	Summary trmsSummary   `json:"summary"`
}

func trmsReason(t TxnRecord) string {
	threshold := t.FxAmountMinor >= sofThresholdUsdMinor
	switch {
	case threshold && t.PepFlag:
		return "threshold+pep"
	case threshold:
		return "threshold"
	case t.PepFlag:
		return "pep"
	}
	return ""
}

func buildTRMS(tenantID int64, periodStart, periodEnd string, data ReturnData) (interface{}, []ValidationError) {
	var errs []ValidationError
	for i, t := range data.Transactions {
		for _, e := range validateTxn(i, t, periodStart, periodEnd) {
			errs = append(errs, e)
		}
		// SoF declaration is mandatory at/above $10k (requirement inventory §C).
		if t.FxAmountMinor >= sofThresholdUsdMinor && t.SofDeclarationID == "" {
			errs = append(errs, ValidationError{
				fmt.Sprintf("transactions[%d].sofDeclarationId", i), "required_at_or_above_10k_usd", t.SofDeclarationID})
		}
	}

	txns := sortedTxns(data.Transactions)
	lines := make([]trmsLine, 0)
	var summary trmsSummary
	for _, t := range txns {
		reason := trmsReason(t)
		if reason == "" {
			continue
		}
		lines = append(lines, trmsLine{
			TxnRef: t.TxnRef, Date: t.Date, Currency: t.Currency,
			FxAmountMinor: t.FxAmountMinor, CustomerType: t.CustomerType,
			SofDeclarationID: t.SofDeclarationID, PepFlag: t.PepFlag, ReportReason: reason,
		})
		summary.ReportableCount++
		summary.TotalReportableFxMinor += t.FxAmountMinor
		if t.PepFlag {
			summary.PepCount++
		}
	}

	return trmsPayload{
		Header:  newHeader(tenantID, "trms", periodStart, periodEnd),
		Lines:   lines,
		Summary: summary,
	}, errs
}

// ─── Extranet — CBN extranet consolidated periodic upload ────────────────────

type extranetSections struct {
	FifxLineCount       int  `json:"fifxLineCount"`
	TrmsReportableCount int  `json:"trmsReportableCount"`
	BranchCount         int  `json:"branchCount"`
	BalancesIncluded    bool `json:"balancesIncluded"`
}

type extranetPayload struct {
	Header   payloadHeader    `json:"header"`
	Sections extranetSections `json:"sections"`
}

func buildExtranet(tenantID int64, periodStart, periodEnd string, data ReturnData) (interface{}, []ValidationError) {
	var errs []ValidationError
	if len(data.Transactions) == 0 && len(data.Branches) == 0 && data.Balances == nil {
		errs = append(errs, ValidationError{"data", "required_section(transactions|branches|balances)", "{}"})
	}
	for i, t := range data.Transactions {
		for _, e := range validateTxn(i, t, periodStart, periodEnd) {
			errs = append(errs, e)
		}
	}

	trmsCount := 0
	for _, t := range data.Transactions {
		if trmsReason(t) != "" {
			trmsCount++
		}
	}

	return extranetPayload{
		Header: newHeader(tenantID, "extranet", periodStart, periodEnd),
		Sections: extranetSections{
			FifxLineCount:       len(data.Transactions),
			TrmsReportableCount: trmsCount,
			BranchCount:         len(data.Branches),
			BalancesIncluded:    data.Balances != nil,
		},
	}, errs
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

// buildReturn validates the header, dispatches to the typed builder, and
// returns the payload plus all validation errors found.
func buildReturn(tenantID int64, returnType, periodStart, periodEnd string, data ReturnData) (interface{}, []ValidationError) {
	errs := validateHeader(tenantID, returnType, periodStart, periodEnd)
	var payload interface{}
	var bErrs []ValidationError
	switch returnType {
	case "fifx":
		payload, bErrs = buildFIFX(tenantID, periodStart, periodEnd, data)
	case "fina":
		payload, bErrs = buildFinA(tenantID, periodStart, periodEnd, data)
	case "carp":
		payload, bErrs = buildCARP(tenantID, periodStart, periodEnd, data)
	case "trms":
		payload, bErrs = buildTRMS(tenantID, periodStart, periodEnd, data)
	case "extranet":
		payload, bErrs = buildExtranet(tenantID, periodStart, periodEnd, data)
	default:
		payload = map[string]string{"header.returnType": returnType}
	}
	return payload, append(errs, bErrs...)
}
