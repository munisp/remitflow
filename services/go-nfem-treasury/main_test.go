package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestBuildEntitlementQuery(t *testing.T) {
	t.Run("without bankCode", func(t *testing.T) {
		q, args := buildEntitlementQuery(5, "")
		for _, want := range []string{
			"FROM bdc_nfem_entitlements",
			"tenant_id = $1",
			"cap_usd", "used_usd",
			"ORDER BY week_start DESC",
		} {
			if !strings.Contains(q, want) {
				t.Errorf("query missing %q:\n%s", want, q)
			}
		}
		if strings.Contains(q, "bank_code = $2") {
			t.Errorf("query should not filter bank_code without a bankCode:\n%s", q)
		}
		if !reflect.DeepEqual(args, []any{int64(5)}) {
			t.Errorf("args = %v", args)
		}
	})

	t.Run("with bankCode", func(t *testing.T) {
		q, args := buildEntitlementQuery(5, "GTB")
		if !strings.Contains(q, "bank_code = $2") {
			t.Errorf("query missing bank_code filter:\n%s", q)
		}
		if !reflect.DeepEqual(args, []any{int64(5), "GTB"}) {
			t.Errorf("args = %v", args)
		}
	})
}

func TestBuildBatchQuery(t *testing.T) {
	t.Run("without bankCode", func(t *testing.T) {
		q, args := buildBatchQuery(5, "")
		if strings.Contains(q, "JOIN") {
			t.Errorf("query should not join without a bankCode:\n%s", q)
		}
		if !strings.Contains(q, "FROM bdc_nfem_purchase_batches") || !strings.Contains(q, "tenant_id = $1") {
			t.Errorf("unexpected query:\n%s", q)
		}
		if !reflect.DeepEqual(args, []any{int64(5)}) {
			t.Errorf("args = %v", args)
		}
	})

	t.Run("with bankCode joins entitlements", func(t *testing.T) {
		q, args := buildBatchQuery(5, "GTB")
		for _, want := range []string{
			"JOIN bdc_nfem_entitlements",
			"e.bank_code = $2",
		} {
			if !strings.Contains(q, want) {
				t.Errorf("query missing %q:\n%s", want, q)
			}
		}
		if !reflect.DeepEqual(args, []any{int64(5), "GTB"}) {
			t.Errorf("args = %v", args)
		}
	})
}

func TestMapEntitlement(t *testing.T) {
	week := time.Date(2026, 3, 23, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		name          string
		cap, used     float64
		wantRemaining float64
	}{
		{"full headroom", 150000, 0, 150000},
		{"partial", 150000, 43210.55, 106789.45},
		{"exhausted", 150000, 150000, 0},
		{"rounding", 100.10, 0.05, 100.05},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dto := mapEntitlement(1, 7, "GTB", week, tc.cap, tc.used, 3)
			if dto.RemainingUSD != tc.wantRemaining {
				t.Errorf("RemainingUSD = %v, want %v", dto.RemainingUSD, tc.wantRemaining)
			}
			if dto.WeekStart != "2026-03-23" {
				t.Errorf("WeekStart = %q", dto.WeekStart)
			}
			if dto.Version != 3 || dto.BankCode != "GTB" || dto.TenantID != 7 {
				t.Errorf("unexpected dto: %+v", dto)
			}
		})
	}
}

func TestLiquidationTarget(t *testing.T) {
	if got, ok := liquidationTarget("market"); !ok || got != "liquidated" {
		t.Errorf("market → (%q, %v)", got, ok)
	}
	if got, ok := liquidationTarget("return"); !ok || got != "returned" {
		t.Errorf("return → (%q, %v)", got, ok)
	}
	if _, ok := liquidationTarget("sell"); ok {
		t.Errorf("unexpected ok for invalid mode")
	}
}

func TestBuildLiquidationUpdate(t *testing.T) {
	t.Run("market sets liquidated_at and guard", func(t *testing.T) {
		q := buildLiquidationUpdate("market")
		for _, want := range []string{
			"UPDATE bdc_nfem_purchase_batches",
			"status = 'liquidated'",
			"liquidated_at = now()",
			"WHERE id = $1 AND status = 'selling'", // single-winner guard
		} {
			if !strings.Contains(q, want) {
				t.Errorf("query missing %q:\n%s", want, q)
			}
		}
	})

	t.Run("return does not set liquidated_at", func(t *testing.T) {
		q := buildLiquidationUpdate("return")
		for _, want := range []string{
			"status = 'returned'",
			"WHERE id = $1 AND status = 'selling'",
		} {
			if !strings.Contains(q, want) {
				t.Errorf("query missing %q:\n%s", want, q)
			}
		}
		if strings.Contains(q, "liquidated_at") {
			t.Errorf("return mode must not set liquidated_at:\n%s", q)
		}
	})
}

func TestFXBTValidate(t *testing.T) {
	base := fxbtRequest{TenantID: 1, BankCode: "GTB", AmountUSD: 1000, Rate: 1530.5}
	cases := []struct {
		name    string
		mutate  func(*fxbtRequest)
		wantErr bool
	}{
		{"valid", func(r *fxbtRequest) {}, false},
		{"zero tenant", func(r *fxbtRequest) { r.TenantID = 0 }, true},
		{"empty bank", func(r *fxbtRequest) { r.BankCode = " " }, true},
		{"long bank", func(r *fxbtRequest) { r.BankCode = strings.Repeat("A", 17) }, true},
		{"zero amount", func(r *fxbtRequest) { r.AmountUSD = 0 }, true},
		{"negative rate", func(r *fxbtRequest) { r.Rate = -1 }, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := base
			tc.mutate(&r)
			got := r.validate()
			if tc.wantErr && got == "" {
				t.Errorf("validate() = ok, want error")
			}
			if !tc.wantErr && got != "" {
				t.Errorf("validate() = %q, want ok", got)
			}
		})
	}
}

func TestSubmitFXBTSandbox(t *testing.T) {
	cfg := fxbtConfig{Mode: "sandbox"}
	res, status := submitFXBT(context.Background(), cfg, fxbtRequest{
		TenantID: 1, BankCode: "GTB", AmountUSD: 50000, Rate: 1530,
	})
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if !res.Simulated {
		t.Errorf("sandbox result must carry simulated=true")
	}
	if !strings.HasPrefix(res.FXBTReference, "SIM-FXBT-") {
		t.Errorf("reference %q must carry SIM-FXBT- prefix", res.FXBTReference)
	}
}

func TestSubmitFXBTProductionWithoutCreds(t *testing.T) {
	cfg := fxbtConfig{Mode: "production"} // no BaseURL/creds
	_, status := submitFXBT(context.Background(), cfg, fxbtRequest{
		TenantID: 1, BankCode: "GTB", AmountUSD: 50000, Rate: 1530,
	})
	if status != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503 (fail closed, never fabricate)", status)
	}
}

func TestSubmitFXBTProductionUpstream(t *testing.T) {
	t.Run("upstream 2xx passes reference through unsimulated", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("X-Client-Id") != "cid" || r.Header.Get("X-Client-Secret") != "sec" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"reference":"FXBT-REAL-99"}`))
		}))
		defer srv.Close()

		cfg := fxbtConfig{Mode: "production", BaseURL: srv.URL, ClientID: "cid", ClientSecret: "sec"}
		res, status := submitFXBT(context.Background(), cfg, fxbtRequest{
			TenantID: 1, BankCode: "GTB", AmountUSD: 100, Rate: 1500,
		})
		if status != http.StatusOK {
			t.Fatalf("status = %d, want 200", status)
		}
		if res.Simulated {
			t.Errorf("production result must not be simulated")
		}
		if res.FXBTReference != "FXBT-REAL-99" {
			t.Errorf("reference = %q", res.FXBTReference)
		}
	})

	t.Run("upstream rejection propagates, no fabricated success", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
		}))
		defer srv.Close()

		cfg := fxbtConfig{Mode: "production", BaseURL: srv.URL, ClientID: "cid", ClientSecret: "sec"}
		_, status := submitFXBT(context.Background(), cfg, fxbtRequest{
			TenantID: 1, BankCode: "GTB", AmountUSD: 100, Rate: 1500,
		})
		if status == http.StatusOK {
			t.Errorf("upstream rejection must not yield 200")
		}
	})
}

func TestHandleFXBTRequestModes(t *testing.T) {
	body := `{"tenantId":1,"bankCode":"GTB","amountUsd":1000,"rate":1530}`

	t.Run("sandbox → 200 simulated", func(t *testing.T) {
		h := handleFXBTRequest(fxbtConfig{Mode: "sandbox"})
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/nfem/fxbt/request", strings.NewReader(body)))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d", rec.Code)
		}
		var res map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
			t.Fatal(err)
		}
		if res["simulated"] != true {
			t.Errorf("simulated = %v", res["simulated"])
		}
	})

	t.Run("production without creds → 503 UNAVAILABLE credentials not configured", func(t *testing.T) {
		h := handleFXBTRequest(fxbtConfig{Mode: "production"})
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/nfem/fxbt/request", strings.NewReader(body)))
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("status = %d, want 503", rec.Code)
		}
		var res map[string]string
		if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
			t.Fatal(err)
		}
		if res["error"] != "UNAVAILABLE" || res["reason"] != "credentials not configured" {
			t.Errorf("body = %v", res)
		}
	})

	t.Run("invalid body → 400", func(t *testing.T) {
		h := handleFXBTRequest(fxbtConfig{Mode: "sandbox"})
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/nfem/fxbt/request", strings.NewReader(`{"tenantId":0}`)))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
	})
}

func TestNewUUIDv4(t *testing.T) {
	re := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	for i := 0; i < 100; i++ {
		id := newUUIDv4()
		if !re.MatchString(id) {
			t.Fatalf("bad uuid: %q", id)
		}
	}
	if newUUIDv4() == newUUIDv4() {
		t.Errorf("uuids must differ")
	}
}
