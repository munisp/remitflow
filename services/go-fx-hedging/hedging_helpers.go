package main

import (
	"fmt"
	"math"
	"strings"
	"time"
)

func blackScholesCall(spot, strike, riskFreeRate, volatility, timeToExpiry float64) float64 {
	if timeToExpiry <= 0 {
		return math.Max(0, spot-strike)
	}
	price, _, _, _, _ := blackScholes("call", spot, strike, riskFreeRate, volatility, timeToExpiry)
	return price
}

func blackScholesPut(spot, strike, riskFreeRate, volatility, timeToExpiry float64) float64 {
	if timeToExpiry <= 0 {
		return math.Max(0, strike-spot)
	}
	price, _, _, _, _ := blackScholes("put", spot, strike, riskFreeRate, volatility, timeToExpiry)
	return price
}

func validateForwardContract(contract ForwardContract) error {
	if contract.Notional <= 0 {
		return fmt.Errorf("forward notional must be positive")
	}
	if contract.ContractRate <= 0 {
		return fmt.Errorf("forward contract rate must be positive")
	}
	if contract.Direction != "buy" && contract.Direction != "sell" {
		return fmt.Errorf("forward direction must be buy or sell")
	}
	pair := strings.ToUpper(strings.ReplaceAll(contract.CurrencyPair, "/", ""))
	supported := map[string]bool{"USDNGN": true, "USDGHS": true, "USDKES": true, "USDZAR": true, "USDEUR": true, "USDGBP": true}
	if !supported[pair] {
		return fmt.Errorf("unsupported currency pair %q", contract.CurrencyPair)
	}
	daysToExpiry := time.Until(contract.ExpiryDate).Hours() / 24
	if daysToExpiry <= 0 || daysToExpiry > 365 {
		return fmt.Errorf("forward expiry must be between 1 and 365 days")
	}
	return nil
}

func calculateMarkToMarketPnL(contractRate, marketRate, notional float64, direction string) float64 {
	difference := (marketRate - contractRate) * notional
	if direction == "sell" {
		return -difference
	}
	return difference
}

func shouldTriggerAutoHedge(exposure, threshold float64) bool {
	return exposure > 0 && threshold > 0 && exposure > threshold
}

func calculateHedgeCoverageRatio(hedged, exposure float64) float64 {
	if exposure <= 0 {
		return 0
	}
	return hedged / exposure
}
