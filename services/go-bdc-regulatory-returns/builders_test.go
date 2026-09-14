package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"
)

var update = flag.Bool("update", false, "regenerate golden files under testdata/")

// goldenTypes covers every builder required by the contract.
var goldenTypes = []string{"fifx", "fina", "carp", "trms", "extranet"}

func loadBuildRequest(t *testing.T, returnType string) BuildRequest {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", returnType+"_input.json"))
	if err != nil {
		t.Fatalf("read input fixture: %v", err)
	}
	var req BuildRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		t.Fatalf("parse input fixture: %v", err)
	}
	return req
}

// TestBuildersGolden pins each builder's payload bytes against testdata/.
func TestBuildersGolden(t *testing.T) {
	for _, rt := range goldenTypes {
		t.Run(rt, func(t *testing.T) {
			req := loadBuildRequest(t, rt)
			payload, errs := buildReturn(req.TenantID, req.ReturnType, req.PeriodStart, req.PeriodEnd, req.Data)
			if len(errs) != 0 {
				t.Fatalf("golden input should validate clean, got %v", errs)
			}
			got, err := json.MarshalIndent(payload, "", "  ")
			if err != nil {
				t.Fatalf("marshal payload: %v", err)
			}
			got = append(got, '\n')
			golden := filepath.Join("testdata", rt+"_expected.json")
			if *update {
				if err := os.WriteFile(golden, got, 0o644); err != nil {
					t.Fatalf("update golden: %v", err)
				}
			}
			want, err := os.ReadFile(golden)
			if err != nil {
				t.Fatalf("read golden (run `go test -update` to create): %v", err)
			}
			if !bytes.Equal(got, want) {
				t.Errorf("payload mismatch for %s\ngot:\n%s\nwant:\n%s", rt, got, want)
			}
		})
	}
}

// TestBuildersDeterministic: same input → same payload bytes, including when
// the transaction order is shuffled.
func TestBuildersDeterministic(t *testing.T) {
	req := loadBuildRequest(t, "fifx")
	p1, _ := buildReturn(req.TenantID, req.ReturnType, req.PeriodStart, req.PeriodEnd, req.Data)
	b1, _ := json.Marshal(p1)

	// Reverse the transaction slice; payload must not change.
	rev := req.Data
	rev.Transactions = make([]TxnRecord, len(req.Data.Transactions))
	for i, tx := range req.Data.Transactions {
		rev.Transactions[len(req.Data.Transactions)-1-i] = tx
	}
	p2, _ := buildReturn(req.TenantID, req.ReturnType, req.PeriodStart, req.PeriodEnd, rev)
	b2, _ := json.Marshal(p2)

	if !bytes.Equal(b1, b2) {
		t.Errorf("builder is not deterministic under input reordering\ngot:  %s\nwant: %s", b2, b1)
	}
}

// TestValidationErrorsAreSpecific: every error carries field, rule and value.
func TestValidationErrorsAreSpecific(t *testing.T) {
	data := ReturnData{Transactions: []TxnRecord{{
		TxnRef: "", Date: "2026-09-20", TxnType: "sell_fx", Currency: "usd",
		FxAmountMinor: -5, NairaAmountMinor: 0, RateMinor: 0,
		PurposeCode: "HOLIDAY", CashPortionMinor: 100, // -5 fx → 100*4 > -5 trips the cash cap too
	}}}
	_, errs := buildReturn(0, "fifx", "2026-09-01", "2026-09-07", data)
	if len(errs) == 0 {
		t.Fatal("expected validation errors")
	}
	for _, e := range errs {
		if e.Field == "" || e.Rule == "" {
			t.Errorf("validation error missing field/rule: %+v", e)
		}
	}
	// Spot-check specific rules we rely on downstream.
	wantRules := map[string]bool{
		"transactions[0].txnRef":      false,
		"transactions[0].date":        false,
		"transactions[0].currency":    false,
		"transactions[0].purposeCode": false,
	}
	for _, e := range errs {
		if _, ok := wantRules[e.Field]; ok {
			wantRules[e.Field] = true
		}
	}
	for field, seen := range wantRules {
		if !seen {
			t.Errorf("expected a validation error for %s", field)
		}
	}
}

// TestFinAComputedBreach: integer basis-point limit math.
func TestFinAComputedBreach(t *testing.T) {
	data := ReturnData{Balances: &BalanceRecord{
		ShareholdersFundsMinor: 100_000, NopUsdMinor: 31_000, // 31% > 30% cap
		BorrowingMinor: 40_000, NopLimitPct: 30, BorrowingLimitPct: 50,
	}}
	payload, errs := buildReturn(1, "fina", "2026-09-01", "2026-09-07", data)
	if len(errs) != 0 {
		t.Fatalf("unexpected validation errors: %v", errs)
	}
	p, ok := payload.(finaPayload)
	if !ok {
		t.Fatalf("unexpected payload type %T", payload)
	}
	if p.Computed.NopPctBps != 3100 || !p.Computed.NopBreach {
		t.Errorf("expected NOP 3100bps breach, got %+v", p.Computed)
	}
	if p.Computed.BorrowingPctBps != 4000 || p.Computed.BorrowingBreach {
		t.Errorf("expected borrowing 4000bps no-breach, got %+v", p.Computed)
	}
}

// TestTRMSRequiresSoF: $10k+ lines without a SoF declaration are rejected.
func TestTRMSRequiresSoF(t *testing.T) {
	data := ReturnData{Transactions: []TxnRecord{{
		TxnRef: "TXN-9", Date: "2026-09-02", TxnType: "sell_fx", Currency: "USD",
		FxAmountMinor: sofThresholdUsdMinor, NairaAmountMinor: 100, RateMinor: 1,
		PurposeCode: "PTA",
	}}}
	_, errs := buildReturn(1, "trms", "2026-09-01", "2026-09-07", data)
	found := false
	for _, e := range errs {
		if e.Field == "transactions[0].sofDeclarationId" && e.Rule == "required_at_or_above_10k_usd" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected SoF-required error, got %v", errs)
	}
}
