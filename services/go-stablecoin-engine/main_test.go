package main

// Tests for GO-C4: fail-closed sanctions screening and no fabricated tx hashes.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

// GO-C4: with no sanctions backend configured, screening fails closed.
func TestScreenSanctions_FailsClosedUnconfigured(t *testing.T) {
	appCfg = Config{}
	if _, err := screenSanctions("John Doe"); err == nil {
		t.Fatal("screening passed with no backend configured")
	}
	// A name that the old stub would "allow"/"block" by substring is irrelevant now.
	if _, err := screenSanctions("sanctioned person"); err == nil {
		t.Fatal("screening passed by substring with no backend configured")
	}
}

// GO-C4: backend-flagged sanctioned entity is blocked; clean entity allowed.
func TestScreenSanctions_UsesBackend(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in map[string]string
		json.NewDecoder(r.Body).Decode(&in)
		json.NewEncoder(w).Encode(map[string]any{
			"isSanctioned": strings.Contains(in["name"], "BADACTOR"),
			"riskLevel":    "high",
		})
	}))
	defer srv.Close()
	appCfg = Config{SanctionsServiceURL: srv.URL}

	res, err := screenSanctions("user-BADACTOR-1")
	if err != nil || !res.Sanctioned || res.Action != "block" {
		t.Fatalf("sanctioned entity not blocked: %+v err=%v", res, err)
	}
	res, err = screenSanctions("user-42")
	if err != nil || res.Sanctioned {
		t.Fatalf("clean entity blocked: %+v err=%v", res, err)
	}
	appCfg = Config{}
}

// GO-C4: backend outage fails closed (error), never "allow".
func TestScreenSanctions_BackendErrorFailsClosed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	appCfg = Config{SanctionsServiceURL: srv.URL}
	if _, err := screenSanctions("user-1"); err == nil {
		t.Fatal("backend 500 did not fail closed")
	}
	appCfg = Config{}
}

// GO-C4: on-ramp must NOT fabricate a settled tx hash when no chain settlement
// service is configured.
func TestProcessOnRamp_NoFabricatedTxHash(t *testing.T) {
	appCfg = Config{}
	_, err := processOnRamp(OnRampRequest{
		UserID: 1, FiatAmount: 100, FiatCurrency: "USD", Stablecoin: "USDC", Chain: "polygon",
	})
	if err == nil {
		t.Fatal("on-ramp settled without chain settlement backend")
	}
}

// GO-C4: on-ramp with a real backend uses the backend's tx hash; zero hash rejected.
func TestProcessOnRamp_RequiresRealTxHash(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"tx_hash": "0x0000000000000000000000000000000000000000000000000000000000000000"})
	}))
	defer srv.Close()
	appCfg = Config{ChainSettlementURL: srv.URL}
	if _, err := processOnRamp(OnRampRequest{UserID: 1, FiatAmount: 100, FiatCurrency: "USD", Stablecoin: "USDC"}); err == nil {
		t.Fatal("zero tx hash accepted as settlement")
	}
	appCfg = Config{}
}

// GO-C4: onramp route returns 503 (not 200/settled) when unconfigured, and 401 without auth.
func TestOnRampRoute_FailClosed(t *testing.T) {
	appCfg = Config{}
	r := gin.New()
	t.Setenv("INTERNAL_SERVICE_KEY", "k")
	internalKey := "k"
	guarded := r.Group("/stablecoin", func(c *gin.Context) {
		if c.GetHeader("X-API-Key") != internalKey {
			c.AbortWithStatusJSON(401, gin.H{"error": "unauthorized"})
			return
		}
		c.Next()
	})
	guarded.POST("/onramp", func(c *gin.Context) {
		var req OnRampRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		if _, sErr := screenSanctions("user"); sErr != nil {
			c.JSON(503, gin.H{"error": "NOT_CONFIGURED"})
			return
		}
		result, err := processOnRamp(req)
		if err != nil {
			c.JSON(503, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, result)
	})

	body := `{"userId":1,"fiatAmount":100,"fiatCurrency":"USD","stablecoin":"USDC"}`
	// no auth header
	req := httptest.NewRequest("POST", "/stablecoin/onramp", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 401 {
		t.Fatalf("unauthenticated onramp got %d", w.Code)
	}
	// authed but unconfigured backends -> 503, no tx_hash
	req2 := httptest.NewRequest("POST", "/stablecoin/onramp", strings.NewReader(body))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("X-API-Key", "k")
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code != 503 {
		t.Fatalf("unconfigured onramp got %d", w2.Code)
	}
	if strings.Contains(w2.Body.String(), "tx_hash") {
		t.Fatal("fabricated tx_hash in response")
	}
}

// ── Wave12: quotes + fx-rates pair query ─────────────────────────────────────

// On-ramp quote mirrors the execution conversion math and carries no ids.
func TestComputeOnRampQuote(t *testing.T) {
	q := computeOnRampQuote(OnRampQuoteRequest{
		FiatCurrency: "NGN", FiatAmount: 160000, Stablecoin: "USDC",
	})
	// 160000 NGN * (1/1600 USD/NGN) = 100 USD = 100 USDC.
	if q.StablecoinAmount != 100 {
		t.Fatalf("stablecoinAmount = %v, want 100", q.StablecoinAmount)
	}
	if q.Fee != 800 { // 0.5% of 160000
		t.Fatalf("fee = %v, want 800", q.Fee)
	}
	if q.FiatAmount != 160000 || q.EstimatedTime != "instant" {
		t.Fatalf("unexpected quote: %+v", q)
	}
	if time.Until(q.ExpiresAt) <= 0 || time.Until(q.ExpiresAt) > quoteTTL {
		t.Fatalf("expiresAt outside quote TTL: %v", q.ExpiresAt)
	}
}

// Off-ramp quote nets out the 0.75% fee and uses the shared rail estimates.
func TestComputeOffRampQuote(t *testing.T) {
	q := computeOffRampQuote(OffRampQuoteRequest{
		Stablecoin: "USDC", StablecoinAmount: 100, FiatCurrency: "NGN", PayoutRail: "mobile_money",
	})
	// 100 USDC = 100 USD * 1600 = 160000 NGN gross; fee 1200; net 158800.
	if q.Fee != 1200 || q.FiatAmount != 158800 {
		t.Fatalf("fee/net = %v/%v, want 1200/158800", q.Fee, q.FiatAmount)
	}
	if q.EstimatedTime != "instant" {
		t.Fatalf("estimatedTime = %q, want instant", q.EstimatedTime)
	}
	// Unknown rail estimate is empty, never invented.
	q2 := computeOffRampQuote(OffRampQuoteRequest{
		Stablecoin: "USDC", StablecoinAmount: 1, FiatCurrency: "USD", PayoutRail: "carrier_pigeon",
	})
	if q2.EstimatedTime != "" {
		t.Fatalf("unknown rail got fabricated estimate %q", q2.EstimatedTime)
	}
}

// ?from=&to= returns one rate; unknown currency fails closed (400, no 1.0).
func TestFXRatesPairQuery(t *testing.T) {
	r := gin.New()
	r.GET("/stablecoin/fx-rates", func(c *gin.Context) {
		from, to := c.Query("from"), c.Query("to")
		if from != "" && to != "" {
			fromRate, ok1 := fallbackRates[strings.ToUpper(from)]
			toRate, ok2 := fallbackRates[strings.ToUpper(to)]
			if !ok1 || !ok2 {
				c.JSON(400, gin.H{"error": "unsupported currency pair"})
				return
			}
			c.JSON(200, gin.H{"from": strings.ToUpper(from), "to": strings.ToUpper(to), "rate": toRate / fromRate})
			return
		}
		c.JSON(200, FXRate{Base: "USD", Rates: fallbackRates, Timestamp: time.Now()})
	})

	req := httptest.NewRequest("GET", "/stablecoin/fx-rates?from=ngn&to=usd", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("pair query got %d", w.Code)
	}
	var out struct {
		From string  `json:"from"`
		To   string  `json:"to"`
		Rate float64 `json:"rate"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.From != "NGN" || out.To != "USD" || out.Rate != 1.0/1600.0 {
		t.Fatalf("bad pair rate: %+v", out)
	}

	req2 := httptest.NewRequest("GET", "/stablecoin/fx-rates?from=XXX&to=USD", nil)
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code != 400 {
		t.Fatalf("unknown currency not rejected: %d", w2.Code)
	}
}
