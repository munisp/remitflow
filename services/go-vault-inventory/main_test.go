package main

import (
	"database/sql"
	"errors"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

func TestBuildStockQuery(t *testing.T) {
	q, args := buildStockQuery(7, "vault", 42)
	for _, want := range []string{
		"FROM bdc_denomination_inventory",
		"tenant_id = $1",
		"location_type = $2",
		"location_id = $3",
	} {
		if !strings.Contains(q, want) {
			t.Errorf("stock query missing %q:\n%s", want, q)
		}
	}
	wantArgs := []any{int64(7), "vault", int64(42)}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Errorf("args = %v, want %v", args, wantArgs)
	}
}

func TestComputeTotals(t *testing.T) {
	cases := []struct {
		name string
		rows []stockRow
		want map[string]float64
	}{
		{
			name: "empty",
			rows: []stockRow{},
			want: map[string]float64{},
		},
		{
			name: "single currency single denomination",
			rows: []stockRow{{Currency: "USD", Denomination: 100, NoteCount: 10}},
			want: map[string]float64{"USD": 1000},
		},
		{
			name: "multiple denominations same currency",
			rows: []stockRow{
				{Currency: "USD", Denomination: 100, NoteCount: 10},
				{Currency: "USD", Denomination: 50, NoteCount: 7},
				{Currency: "USD", Denomination: 0.5, NoteCount: 3},
			},
			want: map[string]float64{"USD": 1351.5},
		},
		{
			name: "multiple currencies stay separate",
			rows: []stockRow{
				{Currency: "USD", Denomination: 100, NoteCount: 1},
				{Currency: "EUR", Denomination: 200, NoteCount: 2},
				{Currency: "GBP", Denomination: 20.5, NoteCount: 4},
			},
			want: map[string]float64{"USD": 100, "EUR": 400, "GBP": 82},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := computeTotals(tc.rows)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("computeTotals() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestBuildAdjustQuery(t *testing.T) {
	req := adjustRequest{
		TenantID: 3, LocationType: "drawer", LocationID: 9,
		Currency: "USD", Denomination: 100, Delta: -5, ExpectedVersion: 11,
	}
	q, args := buildAdjustQuery(req)
	for _, want := range []string{
		"UPDATE bdc_denomination_inventory",
		"note_count = note_count + $6",
		"version = version + 1",
		"version = $7",         // optimistic-concurrency guard
		"note_count + $6 >= 0", // non-negative stock invariant
		"RETURNING note_count, version",
	} {
		if !strings.Contains(q, want) {
			t.Errorf("adjust query missing %q:\n%s", want, q)
		}
	}
	wantArgs := []any{int64(3), "drawer", int64(9), "USD", 100.0, -5, 11}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Errorf("args = %v, want %v", args, wantArgs)
	}
}

func TestAdjustValidate(t *testing.T) {
	base := adjustRequest{
		TenantID: 1, LocationType: "vault", LocationID: 1,
		Currency: "USD", Denomination: 100, Delta: 1, ExpectedVersion: 0,
	}
	cases := []struct {
		name    string
		mutate  func(*adjustRequest)
		wantErr bool
	}{
		{"valid", func(a *adjustRequest) {}, false},
		{"valid negative delta", func(a *adjustRequest) { a.Delta = -3 }, false},
		{"zero tenant", func(a *adjustRequest) { a.TenantID = 0 }, true},
		{"bad location type", func(a *adjustRequest) { a.LocationType = "safe" }, true},
		{"cit location ok", func(a *adjustRequest) { a.LocationType = "cit" }, false},
		{"zero location id", func(a *adjustRequest) { a.LocationID = 0 }, true},
		{"lowercase currency", func(a *adjustRequest) { a.Currency = "usd" }, true},
		{"bad currency length", func(a *adjustRequest) { a.Currency = "USDD" }, true},
		{"zero denomination", func(a *adjustRequest) { a.Denomination = 0 }, true},
		{"zero delta", func(a *adjustRequest) { a.Delta = 0 }, true},
		{"negative version", func(a *adjustRequest) { a.ExpectedVersion = -1 }, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a := base
			tc.mutate(&a)
			got := a.validate()
			if tc.wantErr && got == "" {
				t.Errorf("validate() = ok, want error")
			}
			if !tc.wantErr && got != "" {
				t.Errorf("validate() = %q, want ok", got)
			}
		})
	}
}

func TestClassifyAdjustErr(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{"no rows → 409 conflict", sql.ErrNoRows, http.StatusConflict, "CONFLICT"},
		{"other error → 500", errors.New("boom"), http.StatusInternalServerError, "INTERNAL"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, code, _ := classifyAdjustErr(tc.err)
			if status != tc.wantStatus || code != tc.wantCode {
				t.Errorf("classifyAdjustErr() = (%d, %s), want (%d, %s)",
					status, code, tc.wantStatus, tc.wantCode)
			}
		})
	}
}
