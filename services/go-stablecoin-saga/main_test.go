package main

// Tests for wave12 compensation honesty + live FX + real TB bridge contract.

import (
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

// deterministicU128 is stable, seed-sensitive, and within TB's id range.
func TestDeterministicU128(t *testing.T) {
	a1 := deterministicU128("reversal:123")
	a2 := deterministicU128("reversal:123")
	b := deterministicU128("reversal:124")
	if a1 != a2 {
		t.Fatal("same seed produced different ids")
	}
	if a1 == b {
		t.Fatal("different seeds collided")
	}
	n, ok := new(big.Int).SetString(a1, 10)
	if !ok || n.Sign() <= 0 {
		t.Fatalf("id %q not a positive u128", a1)
	}
	max := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 128), big.NewInt(1))
	if n.Cmp(max) >= 0 {
		t.Fatalf("id %q out of TigerBeetle id range", a1)
	}
}

// Compensations run in REVERSE order and failures are collected honestly.
func TestRunCompensations_ReverseOrderAndFailures(t *testing.T) {
	var order []string
	comps := []compensation{
		{name: "first", fn: func() error { order = append(order, "first"); return nil }},
		{name: "second", fn: func() error { order = append(order, "second"); return fmt.Errorf("boom") }},
		{name: "third", fn: func() error { order = append(order, "third"); return nil }},
	}
	ok, bad := runCompensations(comps)
	if !reflect.DeepEqual(order, []string{"third", "second", "first"}) {
		t.Fatalf("execution order = %v, want reverse registration order", order)
	}
	if !reflect.DeepEqual(ok, []string{"third", "first"}) || !reflect.DeepEqual(bad, []string{"second"}) {
		t.Fatalf("ok=%v bad=%v", ok, bad)
	}
}

// getEngineFXRate parses the engine pair response and fails closed otherwise.
func TestGetEngineFXRate(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("from") == "NGN" && r.URL.Query().Get("to") == "USD" {
			json.NewEncoder(w).Encode(map[string]interface{}{"from": "NGN", "to": "USD", "rate": 0.000625})
			return
		}
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()
	old := stablecoinEngine
	stablecoinEngine = srv.URL
	defer func() { stablecoinEngine = old }()

	rate, err := getEngineFXRate("NGN", "USD")
	if err != nil || rate != 0.000625 {
		t.Fatalf("rate=%v err=%v", rate, err)
	}
	if _, err := getEngineFXRate("XXX", "USD"); err == nil {
		t.Fatal("unknown pair did not fail closed")
	}

	stablecoinEngine = "http://127.0.0.1:1" // unreachable
	if _, err := getEngineFXRate("NGN", "USD"); err == nil {
		t.Fatal("unreachable engine did not fail closed")
	}
}

// postTBTransfer treats the bridge's per-index error array as failure.
func TestPostTBTransfer_PerIndexErrorFails(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"errors": []map[string]interface{}{{"index": 0, "code": 40, "reason": "debit account not found"}},
		})
	}))
	defer srv.Close()
	old := tigerBeetleBridge
	tigerBeetleBridge = srv.URL
	defer func() { tigerBeetleBridge = old }()

	err := postTBTransfer(tbTransfer{ID: "1", DebitAccountID: "2", CreditAccountID: "3", Amount: "100", Ledger: 9001, Code: 1})
	if err == nil {
		t.Fatal("per-index bridge error treated as success")
	}
}

// ledgerReversal posts the exact inverse (swapped accounts, reversal id).
func TestLedgerReversal_InvertsTransfer(t *testing.T) {
	var got tbTransfer
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Transfers []tbTransfer `json:"transfers"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		got = body.Transfers[0]
		json.NewEncoder(w).Encode(map[string]interface{}{"errors": []interface{}{}})
	}))
	defer srv.Close()
	old := tigerBeetleBridge
	tigerBeetleBridge = srv.URL
	defer func() { tigerBeetleBridge = old }()

	orig := tbTransfer{ID: "42", DebitAccountID: "100", CreditAccountID: "200", Amount: "5000000", Ledger: 9001, Code: 1}
	if err := ledgerReversal(orig); err != nil {
		t.Fatalf("reversal failed: %v", err)
	}
	if got.ID != deterministicU128("reversal:42") {
		t.Fatalf("reversal id = %q, want sha256-derived reversal id", got.ID)
	}
	if got.DebitAccountID != "200" || got.CreditAccountID != "100" {
		t.Fatalf("accounts not swapped: %+v", got)
	}
	if got.Amount != orig.Amount || got.Ledger != orig.Ledger {
		t.Fatalf("amount/ledger not preserved: %+v", got)
	}
}

// A bridge error marks the reversal compensation failed (no swallowing).
func TestLedgerReversal_ErrorPropagates(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()
	old := tigerBeetleBridge
	tigerBeetleBridge = srv.URL
	defer func() { tigerBeetleBridge = old }()
	if err := ledgerReversal(tbTransfer{ID: "7", DebitAccountID: "1", CreditAccountID: "2", Amount: "1", Ledger: 9001, Code: 1}); err == nil {
		t.Fatal("bridge outage swallowed by reversal compensation")
	}
}

// tbMinorUnits converts major units to 6-decimal minor units.
func TestTBMinorUnits(t *testing.T) {
	if got := tbMinorUnits(12.5); got != "12500000" {
		t.Fatalf("tbMinorUnits(12.5) = %q", got)
	}
}
