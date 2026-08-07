package main

import (
	"fmt"
	"math"
	"strings"
)

// calculateCorridorFee returns the configured base fee plus corridor spread and FX markup.
func calculateCorridorFee(amount float64, fromCurrency, toCurrency string) (float64, error) {
	if amount <= 0 {
		return 0, fmt.Errorf("transfer amount must be positive")
	}
	from := strings.ToUpper(fromCurrency)
	to := strings.ToUpper(toCurrency)
	state.mu.RLock()
	defer state.mu.RUnlock()
	for _, corridor := range state.corridors {
		if corridor.Active && corridor.FromCurrency == from && corridor.ToCurrency == to {
			quote := calculateSpread(corridor, amount, 1)
			maxFee := math.Max(0.50, amount*0.01)
			return math.Min(quote.TotalFeeUSD, maxFee), nil
		}
	}
	// A conservative configured default keeps newly onboarded corridors within reviewable bounds.
	return math.Min(math.Round((0.50+amount*0.015)*100)/100, math.Max(0.50, amount*0.01)), nil
}

func getCorridorSpread(pair string) float64 {
	pair = strings.ToUpper(strings.ReplaceAll(pair, "/", ""))
	if pair == "EURUSD" || pair == "USDEUR" {
		return 0.003
	}
	if len(pair) == 6 {
		from, to := pair[:3], pair[3:]
		state.mu.RLock()
		defer state.mu.RUnlock()
		for _, corridor := range state.corridors {
			if corridor.Active && corridor.FromCurrency == from && corridor.ToCurrency == to {
				return corridor.SpreadPct
			}
		}
	}
	return 0.015
}

func calculateCorridorHealthScore(successRate, averageLatencyMs float64) float64 {
	if successRate < 0 {
		successRate = 0
	}
	if successRate > 1 {
		successRate = 1
	}
	// Penalise availability and latency independently; a low-latency route cannot mask failures.
	score := 100 - (1-successRate)*300 - averageLatencyMs/100
	return math.Max(0, math.Min(100, score))
}

func checkRegulatoryLimit(amount float64, fromCountry, toCountry string) error {
	if amount <= 0 {
		return fmt.Errorf("transfer amount must be positive")
	}
	from, to := strings.ToUpper(fromCountry), strings.ToUpper(toCountry)
	limit := 10_000_000.0 // PAPSS cross-border ceiling absent a stricter originating-jurisdiction limit.
	if from == "NG" {
		limit = 5_000_000.0
	}
	if amount > limit {
		return fmt.Errorf("transfer amount exceeds %s→%s regulatory limit of %.2f", from, to, limit)
	}
	return nil
}

func adjustSpreadForVolume(baseSpread, monthlyVolume float64) float64 {
	if monthlyVolume >= 100_000 {
		baseSpread *= 0.85
	}
	if monthlyVolume >= 1_000_000 {
		baseSpread *= 0.85
	}
	return math.Max(0.001, baseSpread)
}

func adjustSpreadForLiquidity(baseSpread, liquidityRatio float64) float64 {
	if liquidityRatio < 0.30 {
		return baseSpread * 1.50
	}
	if liquidityRatio < 0.60 {
		return baseSpread * 1.20
	}
	return baseSpread
}

func calculateCorridorRevenue(amount, spread, baseFee float64) float64 {
	return amount*spread + baseFee
}
