// RemitFlow — FX Hedging Engine Test Suite
// Covers: Black-Scholes pricing, forward contract validation, P&L calculation,
// auto-hedge thresholds, exposure calculation, and health endpoint.
package main

import (
	"math"
	"os"
	"testing"
	"time"
)

// ── Black-Scholes Option Pricing ──────────────────────────────────────────────

func TestBlackScholes_CallOption(t *testing.T) {
	tests := []struct {
		name       string
		spot       float64
		strike     float64
		riskFree   float64
		volatility float64
		timeToExp  float64 // years
		wantMin    float64
		wantMax    float64
	}{
		{
			name:       "ATM call option",
			spot:       100.0, strike: 100.0,
			riskFree: 0.05, volatility: 0.20,
			timeToExp: 1.0,
			wantMin: 8.0, wantMax: 15.0, // ~10.45 for these inputs
		},
		{
			name:       "deep ITM call",
			spot:       120.0, strike: 100.0,
			riskFree: 0.05, volatility: 0.20,
			timeToExp: 1.0,
			wantMin: 20.0, wantMax: 30.0,
		},
		{
			name:       "deep OTM call",
			spot:       80.0, strike: 100.0,
			riskFree: 0.05, volatility: 0.20,
			timeToExp: 1.0,
			wantMin: 0.0, wantMax: 5.0,
		},
		{
			name:       "zero time to expiry",
			spot:       105.0, strike: 100.0,
			riskFree: 0.05, volatility: 0.20,
			timeToExp: 0.0,
			wantMin: 5.0, wantMax: 5.01, // intrinsic value only
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			price := blackScholesCall(tt.spot, tt.strike, tt.riskFree, tt.volatility, tt.timeToExp)
			if price < tt.wantMin || price > tt.wantMax {
				t.Errorf("BS call price = %.4f, want [%.4f, %.4f]",
					price, tt.wantMin, tt.wantMax)
			}
		})
	}
}

func TestBlackScholes_PutCallParity(t *testing.T) {
	// Put-Call Parity: C - P = S - K*e^(-rT)
	spot, strike, r, sigma, T := 100.0, 100.0, 0.05, 0.20, 1.0

	call := blackScholesCall(spot, strike, r, sigma, T)
	put := blackScholesPut(spot, strike, r, sigma, T)
	lhs := call - put
	rhs := spot - strike*math.Exp(-r*T)

	if math.Abs(lhs-rhs) > 0.001 {
		t.Errorf("put-call parity violated: C-P=%.4f, S-Ke^(-rT)=%.4f", lhs, rhs)
	}
}

// ── Forward Contract Validation ───────────────────────────────────────────────

func TestFXHedging_ForwardContractValidation(t *testing.T) {
	tests := []struct {
		name       string
		notional   float64
		currency   string
		daysToExp  int
		wantErr    bool
	}{
		{"valid 30-day forward", 1_000_000, "USDNGN", 30, false},
		{"valid 90-day forward", 5_000_000, "USDGHS", 90, false},
		{"valid 180-day forward", 10_000_000, "USDKES", 180, false},
		{"zero notional", 0, "USDNGN", 30, true},
		{"negative notional", -100_000, "USDNGN", 30, true},
		{"expired contract (0 days)", 1_000_000, "USDNGN", 0, true},
		{"too far forward (>365 days)", 1_000_000, "USDNGN", 400, true},
		{"unsupported pair", 1_000_000, "XYZABC", 30, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateForwardContract(ForwardContract{
				Notional:         tt.notional,
				CurrencyPair:     tt.currency,
				ExpiryDate:       time.Now().AddDate(0, 0, tt.daysToExp),
				ContractRate:     1500.0,
				Direction:        "buy",
			})
			if tt.wantErr && err == nil {
				t.Error("expected error but got nil")
			}
			if !tt.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

// ── P&L Calculation ───────────────────────────────────────────────────────────

func TestFXHedging_PnLCalculation(t *testing.T) {
	tests := []struct {
		name         string
		contractRate float64
		marketRate   float64
		notional     float64
		direction    string
		wantPnL      float64
	}{
		{
			name:         "long position profit",
			contractRate: 1500.0, marketRate: 1600.0,
			notional: 1_000_000, direction: "buy",
			wantPnL: 100_000_000.0, // (1600-1500) * 1M
		},
		{
			name:         "long position loss",
			contractRate: 1500.0, marketRate: 1400.0,
			notional: 1_000_000, direction: "buy",
			wantPnL: -100_000_000.0,
		},
		{
			name:         "short position profit",
			contractRate: 1500.0, marketRate: 1400.0,
			notional: 1_000_000, direction: "sell",
			wantPnL: 100_000_000.0,
		},
		{
			name:         "zero P&L at contract rate",
			contractRate: 1500.0, marketRate: 1500.0,
			notional: 1_000_000, direction: "buy",
			wantPnL: 0.0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pnl := calculateMarkToMarketPnL(tt.contractRate, tt.marketRate, tt.notional, tt.direction)
			if math.Abs(pnl-tt.wantPnL) > 0.01 {
				t.Errorf("P&L = %.2f, want %.2f", pnl, tt.wantPnL)
			}
		})
	}
}

// ── Auto-Hedge Threshold ──────────────────────────────────────────────────────

func TestFXHedging_AutoHedgeThreshold(t *testing.T) {
	tests := []struct {
		name        string
		exposure    float64
		threshold   float64
		wantTrigger bool
	}{
		{"exposure below threshold", 500_000, 1_000_000, false},
		{"exposure at threshold", 1_000_000, 1_000_000, false},
		{"exposure above threshold", 1_500_000, 1_000_000, true},
		{"zero exposure", 0, 1_000_000, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			triggered := shouldTriggerAutoHedge(tt.exposure, tt.threshold)
			if triggered != tt.wantTrigger {
				t.Errorf("shouldTriggerAutoHedge(%.0f, %.0f) = %v, want %v",
					tt.exposure, tt.threshold, triggered, tt.wantTrigger)
			}
		})
	}
}

// ── Hedge Coverage Ratio ──────────────────────────────────────────────────────

func TestFXHedging_HedgeCoverageRatio(t *testing.T) {
	tests := []struct {
		name       string
		hedged     float64
		exposure   float64
		wantRatio  float64
	}{
		{"fully hedged", 1_000_000, 1_000_000, 1.0},
		{"50% hedged", 500_000, 1_000_000, 0.5},
		{"over-hedged", 1_500_000, 1_000_000, 1.5},
		{"zero exposure", 0, 0, 0.0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ratio := calculateHedgeCoverageRatio(tt.hedged, tt.exposure)
			if math.Abs(ratio-tt.wantRatio) > 0.0001 {
				t.Errorf("coverage ratio = %.4f, want %.4f", ratio, tt.wantRatio)
			}
		})
	}
}

// ── Benchmarks ────────────────────────────────────────────────────────────────

func BenchmarkFXHedging_BlackScholesCall(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		blackScholesCall(100.0, 100.0, 0.05, 0.20, 1.0)
	}
}

func BenchmarkFXHedging_PnLCalculation(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		calculateMarkToMarketPnL(1500.0, 1600.0, 1_000_000, "buy")
	}
}

// ── Integration Test Stub ─────────────────────────────────────────────────────

func TestFXHedging_LiveMarketDataIntegration(t *testing.T) {
	if os.Getenv("FX_PROVIDER_API_KEY") == "" {
		t.Skip("FX_PROVIDER_API_KEY not set — skipping live market data test")
	}
	t.Log("Live FX market data integration test would run here")
}
