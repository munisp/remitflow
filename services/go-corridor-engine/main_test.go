// RemitFlow — Corridor Engine Test Suite
// Covers: fee calculation, spread validation, corridor health scoring,
// regulatory limits, dynamic spread adjustment, and health endpoint.
package main

import (
	"math"
	"os"
	"testing"
)

// ── Fee Calculation ───────────────────────────────────────────────────────────

func TestCorridorEngine_FeeCalculation(t *testing.T) {
	tests := []struct {
		name        string
		amount      float64
		fromCcy     string
		toCcy       string
		wantFeeMin  float64
		wantFeeMax  float64
	}{
		{"USD→NGN standard", 500, "USD", "NGN", 2.0, 25.0},
		{"USD→GHS standard", 200, "USD", "GHS", 1.0, 15.0},
		{"USD→KES standard", 100, "USD", "KES", 0.5, 10.0},
		{"large transfer USD→NGN", 10000, "USD", "NGN", 10.0, 100.0},
		{"micro transfer", 10, "USD", "NGN", 0.5, 5.0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fee, err := calculateCorridorFee(tt.amount, tt.fromCcy, tt.toCcy)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if fee < tt.wantFeeMin || fee > tt.wantFeeMax {
				t.Errorf("fee=%.4f, want [%.4f, %.4f]", fee, tt.wantFeeMin, tt.wantFeeMax)
			}
		})
	}
}

// ── Spread Validation ─────────────────────────────────────────────────────────

func TestCorridorEngine_SpreadBounds(t *testing.T) {
	tests := []struct {
		pair      string
		wantMin   float64
		wantMax   float64
	}{
		{"USDNGN", 0.001, 0.05},  // 0.1% to 5%
		{"USDGHS", 0.001, 0.05},
		{"USDKES", 0.001, 0.04},
		{"EURUSD", 0.0001, 0.01}, // tighter for major pairs
	}

	for _, tt := range tests {
		t.Run(tt.pair, func(t *testing.T) {
			spread := getCorridorSpread(tt.pair)
			if spread < tt.wantMin || spread > tt.wantMax {
				t.Errorf("spread=%.5f for %s, want [%.5f, %.5f]",
					spread, tt.pair, tt.wantMin, tt.wantMax)
			}
		})
	}
}

// ── Corridor Health Score ─────────────────────────────────────────────────────

func TestCorridorEngine_HealthScore(t *testing.T) {
	tests := []struct {
		name          string
		successRate   float64
		avgLatencyMs  float64
		wantScoreMin  float64
		wantScoreMax  float64
	}{
		{"excellent corridor", 0.999, 200, 90, 100},
		{"good corridor", 0.97, 500, 70, 90},
		{"degraded corridor", 0.90, 2000, 40, 70},
		{"poor corridor", 0.80, 5000, 0, 40},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			score := calculateCorridorHealthScore(tt.successRate, tt.avgLatencyMs)
			if score < tt.wantScoreMin || score > tt.wantScoreMax {
				t.Errorf("health score=%.1f, want [%.1f, %.1f]",
					score, tt.wantScoreMin, tt.wantScoreMax)
			}
		})
	}
}

// ── Regulatory Limits ─────────────────────────────────────────────────────────

func TestCorridorEngine_RegulatoryLimits(t *testing.T) {
	tests := []struct {
		name        string
		amount      float64
		fromCountry string
		toCountry   string
		wantErr     bool
	}{
		{"within CBN limit NG→GH", 4_999_999, "NG", "GH", false},
		{"exceeds CBN limit NG→GH", 5_000_001, "NG", "GH", true},
		{"within PAPSS limit", 9_999_999, "GH", "KE", false},
		{"zero amount", 0, "NG", "GH", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := checkRegulatoryLimit(tt.amount, tt.fromCountry, tt.toCountry)
			if tt.wantErr && err == nil {
				t.Error("expected regulatory limit error but got nil")
			}
			if !tt.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

// ── Dynamic Spread Adjustment ─────────────────────────────────────────────────

func TestCorridorEngine_DynamicSpreadAdjustment(t *testing.T) {
	baseSpread := 0.015 // 1.5%

	// High volume should reduce spread (volume discount)
	highVolumeSpread := adjustSpreadForVolume(baseSpread, 1_000_000)
	if highVolumeSpread >= baseSpread {
		t.Errorf("high volume should reduce spread: base=%.4f, adjusted=%.4f",
			baseSpread, highVolumeSpread)
	}

	// Low liquidity should increase spread
	lowLiquiditySpread := adjustSpreadForLiquidity(baseSpread, 0.2)
	if lowLiquiditySpread <= baseSpread {
		t.Errorf("low liquidity should increase spread: base=%.4f, adjusted=%.4f",
			baseSpread, lowLiquiditySpread)
	}

	// Spread must never go below minimum
	minSpread := 0.001
	adjustedSpread := adjustSpreadForVolume(baseSpread, 100_000_000)
	if adjustedSpread < minSpread {
		t.Errorf("spread %.5f is below minimum %.5f", adjustedSpread, minSpread)
	}
}

// ── Revenue Calculation ───────────────────────────────────────────────────────

func TestCorridorEngine_RevenueCalculation(t *testing.T) {
	amount := 10_000.0
	spread := 0.015
	baseFee := 5.0

	revenue := calculateCorridorRevenue(amount, spread, baseFee)
	expectedRevenue := amount*spread + baseFee // 150 + 5 = 155
	if math.Abs(revenue-expectedRevenue) > 0.01 {
		t.Errorf("revenue=%.2f, want %.2f", revenue, expectedRevenue)
	}
}

// ── Benchmarks ────────────────────────────────────────────────────────────────

func BenchmarkCorridorEngine_FeeCalculation(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = calculateCorridorFee(500.0, "USD", "NGN")
	}
}

func BenchmarkCorridorEngine_HealthScore(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		calculateCorridorHealthScore(0.999, 200)
	}
}

// ── Integration Stub ──────────────────────────────────────────────────────────

func TestCorridorEngine_LiveIntegration(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping integration test")
	}
}
