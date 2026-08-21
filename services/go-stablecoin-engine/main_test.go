package main

// Tests for GO-C4: fail-closed sanctions screening and no fabricated tx hashes.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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
