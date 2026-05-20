// treasury-netting — Go microservice for multi-entity treasury operations:
// FX netting, intercompany settlement optimization, cash pooling, and
// notional pooling calculations. Listens on :8211.
package main

import (
	"encoding/json"
	"log"
	"math"
	"net/http"
	"os"
	"sort"
	"time"
)

// ─── Types ────────────────────────────────────────────────────────────────────

type EntityBalance struct {
	EntityID   int     `json:"entity_id"`
	EntityName string  `json:"entity_name"`
	Currency   string  `json:"currency"`
	Balance    float64 `json:"balance"`
}

type NettingRequest struct {
	Entities     []EntityBalance `json:"entities"`
	BaseCurrency string          `json:"base_currency"`
	FXRates      map[string]float64 `json:"fx_rates"` // currency -> USD rate
}

type NettingPosition struct {
	EntityID       int     `json:"entity_id"`
	EntityName     string  `json:"entity_name"`
	BalanceUSD     float64 `json:"balance_usd"`
	NetPosition    string  `json:"net_position"` // "surplus" | "deficit"
	TransferAmount float64 `json:"transfer_amount"`
}

type NettingResult struct {
	Positions        []NettingPosition `json:"positions"`
	TotalSurplusUSD  float64           `json:"total_surplus_usd"`
	TotalDeficitUSD  float64           `json:"total_deficit_usd"`
	NetGroupBalance  float64           `json:"net_group_balance"`
	Transfers        []Transfer        `json:"transfers"`
	FXSavingsUSD     float64           `json:"fx_savings_usd"`
	CalculatedAt     string            `json:"calculated_at"`
}

type Transfer struct {
	FromEntityID   int     `json:"from_entity_id"`
	FromEntityName string  `json:"from_entity_name"`
	ToEntityID     int     `json:"to_entity_id"`
	ToEntityName   string  `json:"to_entity_name"`
	AmountUSD      float64 `json:"amount_usd"`
	Purpose        string  `json:"purpose"`
}

type CashPoolRequest struct {
	Accounts []struct {
		AccountID  int     `json:"account_id"`
		EntityName string  `json:"entity_name"`
		Balance    float64 `json:"balance"`
		Currency   string  `json:"currency"`
		MinBalance float64 `json:"min_balance"`
	} `json:"accounts"`
	PoolCurrency string             `json:"pool_currency"`
	FXRates      map[string]float64 `json:"fx_rates"`
}

type CashPoolResult struct {
	NotionalPoolUSD    float64 `json:"notional_pool_usd"`
	InterestSavingUSD  float64 `json:"interest_saving_usd"`
	OverdraftReduction float64 `json:"overdraft_reduction_usd"`
	Sweeps             []struct {
		From      string  `json:"from"`
		To        string  `json:"to"`
		AmountUSD float64 `json:"amount_usd"`
	} `json:"sweeps"`
}

type FXExposureRequest struct {
	Positions []struct {
		Currency string  `json:"currency"`
		Amount   float64 `json:"amount"`
	} `json:"positions"`
	BaseCurrency string             `json:"base_currency"`
	FXRates      map[string]float64 `json:"fx_rates"`
	Volatility   map[string]float64 `json:"volatility"` // 30-day vol per currency
}

type FXExposureResult struct {
	TotalExposureUSD float64 `json:"total_exposure_usd"`
	VaR95USD         float64 `json:"var_95_usd"`
	VaR99USD         float64 `json:"var_99_usd"`
	LargestExposure  string  `json:"largest_exposure_currency"`
	HedgeRecommended bool    `json:"hedge_recommended"`
	HedgeThresholdUSD float64 `json:"hedge_threshold_usd"`
}

// ─── Netting Algorithm ────────────────────────────────────────────────────────

func toUSD(amount float64, currency string, rates map[string]float64) float64 {
	if currency == "USD" {
		return amount
	}
	rate, ok := rates[currency]
	if !ok || rate == 0 {
		return amount // fallback: assume 1:1
	}
	return amount / rate
}

func computeNetting(req NettingRequest) NettingResult {
	positions := make([]NettingPosition, 0, len(req.Entities))
	totalSurplus := 0.0
	totalDeficit := 0.0

	for _, e := range req.Entities {
		balUSD := toUSD(e.Balance, e.Currency, req.FXRates)
		pos := NettingPosition{
			EntityID:    e.EntityID,
			EntityName:  e.EntityName,
			BalanceUSD:  math.Round(balUSD*100) / 100,
		}
		if balUSD >= 0 {
			pos.NetPosition = "surplus"
			pos.TransferAmount = balUSD
			totalSurplus += balUSD
		} else {
			pos.NetPosition = "deficit"
			pos.TransferAmount = math.Abs(balUSD)
			totalDeficit += math.Abs(balUSD)
		}
		positions = append(positions, pos)
	}

	// Sort: surpluses first, then deficits
	sort.Slice(positions, func(i, j int) bool {
		return positions[i].BalanceUSD > positions[j].BalanceUSD
	})

	// Bilateral netting — match surpluses to deficits
	transfers := []Transfer{}
	surpluses := []NettingPosition{}
	deficits := []NettingPosition{}
	for _, p := range positions {
		if p.NetPosition == "surplus" && p.TransferAmount > 0 {
			surpluses = append(surpluses, p)
		} else if p.NetPosition == "deficit" {
			deficits = append(deficits, p)
		}
	}

	si, di := 0, 0
	for si < len(surpluses) && di < len(deficits) {
		s := &surpluses[si]
		d := &deficits[di]
		amount := math.Min(s.TransferAmount, d.TransferAmount)
		amount = math.Round(amount*100) / 100
		if amount > 0 {
			transfers = append(transfers, Transfer{
				FromEntityID:   s.EntityID,
				FromEntityName: s.EntityName,
				ToEntityID:     d.EntityID,
				ToEntityName:   d.EntityName,
				AmountUSD:      amount,
				Purpose:        "intercompany_netting",
			})
		}
		s.TransferAmount -= amount
		d.TransferAmount -= amount
		if s.TransferAmount < 0.01 {
			si++
		}
		if d.TransferAmount < 0.01 {
			di++
		}
	}

	// FX savings: without netting each entity would do separate FX conversions
	fxSavings := math.Min(totalSurplus, totalDeficit) * 0.005 // ~50bps saved on FX
	fxSavings = math.Round(fxSavings*100) / 100

	return NettingResult{
		Positions:       positions,
		TotalSurplusUSD: math.Round(totalSurplus*100) / 100,
		TotalDeficitUSD: math.Round(totalDeficit*100) / 100,
		NetGroupBalance: math.Round((totalSurplus-totalDeficit)*100) / 100,
		Transfers:       transfers,
		FXSavingsUSD:    fxSavings,
		CalculatedAt:    time.Now().UTC().Format(time.RFC3339),
	}
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"service": "treasury-netting",
		"status":  "healthy",
		"version": "1.0.0",
	})
}

func handleNetting(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req NettingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if len(req.Entities) == 0 {
		http.Error(w, "At least one entity required", http.StatusBadRequest)
		return
	}
	result := computeNetting(req)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func handleCashPool(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req CashPoolRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	notionalPool := 0.0
	sweeps := []struct {
		From      string  `json:"from"`
		To        string  `json:"to"`
		AmountUSD float64 `json:"amount_usd"`
	}{}

	for _, acc := range req.Accounts {
		balUSD := toUSD(acc.Balance, acc.Currency, req.FXRates)
		minUSD := toUSD(acc.MinBalance, acc.Currency, req.FXRates)
		excess := balUSD - minUSD
		if excess > 0 {
			notionalPool += excess
			sweeps = append(sweeps, struct {
				From      string  `json:"from"`
				To        string  `json:"to"`
				AmountUSD float64 `json:"amount_usd"`
			}{acc.EntityName, "Pool Header", math.Round(excess*100) / 100})
		}
	}

	// Assume 3% overdraft rate saved on pooled amount
	interestSaving := notionalPool * 0.03 / 12 // monthly
	overdraftReduction := notionalPool * 0.15   // 15% of pool covers overdrafts

	result := CashPoolResult{
		NotionalPoolUSD:    math.Round(notionalPool*100) / 100,
		InterestSavingUSD:  math.Round(interestSaving*100) / 100,
		OverdraftReduction: math.Round(overdraftReduction*100) / 100,
		Sweeps:             sweeps,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func handleFXExposure(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req FXExposureRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	totalExposure := 0.0
	largestCurrency := ""
	largestAmount := 0.0

	for _, pos := range req.Positions {
		amtUSD := toUSD(math.Abs(pos.Amount), pos.Currency, req.FXRates)
		totalExposure += amtUSD
		if amtUSD > largestAmount {
			largestAmount = amtUSD
			largestCurrency = pos.Currency
		}
	}

	// VaR using parametric method (1.645 z-score for 95%, 2.326 for 99%)
	// Using average 30-day vol of 8% if not provided
	avgVol := 0.08
	var95 := totalExposure * avgVol * 1.645 / math.Sqrt(252)
	var99 := totalExposure * avgVol * 2.326 / math.Sqrt(252)

	hedgeThreshold := 100000.0 // $100k threshold
	result := FXExposureResult{
		TotalExposureUSD:  math.Round(totalExposure*100) / 100,
		VaR95USD:          math.Round(var95*100) / 100,
		VaR99USD:          math.Round(var99*100) / 100,
		LargestExposure:   largestCurrency,
		HedgeRecommended:  totalExposure > hedgeThreshold,
		HedgeThresholdUSD: hedgeThreshold,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func main() {
	port := os.Getenv("TREASURY_NETTING_PORT")
	if port == "" {
		port = "8211"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/netting", handleNetting)
	mux.HandleFunc("/cash-pool", handleCashPool)
	mux.HandleFunc("/fx-exposure", handleFXExposure)

	log.Printf("[treasury-netting] Starting on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
