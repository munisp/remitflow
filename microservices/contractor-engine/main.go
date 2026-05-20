// contractor-engine — Go microservice for contractor invoice processing,
// multi-currency FX conversion, payment routing, and withholding tax calculation.
// Listens on :8210. Called by the TypeScript tRPC router via HTTP.
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"strings"
	"time"
)

// ─── Domain Types ─────────────────────────────────────────────────────────────

type InvoiceLineItem struct {
	Description string  `json:"description"`
	Quantity    float64 `json:"quantity"`
	UnitPrice   float64 `json:"unit_price"`
	Total       float64 `json:"total"`
}

type InvoiceCalcRequest struct {
	ContractorCountry string            `json:"contractor_country"`
	Currency          string            `json:"currency"`
	LineItems         []InvoiceLineItem `json:"line_items"`
	IncludeVAT        bool              `json:"include_vat"`
}

type InvoiceCalcResponse struct {
	Subtotal          float64 `json:"subtotal"`
	VATRate           float64 `json:"vat_rate"`
	VATAmount         float64 `json:"vat_amount"`
	WithholdingTaxRate float64 `json:"withholding_tax_rate"`
	WithholdingTax    float64 `json:"withholding_tax"`
	Total             float64 `json:"total"`
	NetPayable        float64 `json:"net_payable"`
	Currency          string  `json:"currency"`
	PaymentRail       string  `json:"payment_rail"`
	EstimatedDays     int     `json:"estimated_days"`
}

type PaymentRouteRequest struct {
	FromCountry string  `json:"from_country"`
	ToCountry   string  `json:"to_country"`
	Currency    string  `json:"currency"`
	AmountUSD   float64 `json:"amount_usd"`
}

type PaymentRouteResponse struct {
	Rail            string  `json:"rail"`
	EstimatedDays   int     `json:"estimated_days"`
	FeeUSD          float64 `json:"fee_usd"`
	FeePct          float64 `json:"fee_pct"`
	Supported       bool    `json:"supported"`
	AlternativeRail string  `json:"alternative_rail,omitempty"`
	Notes           string  `json:"notes,omitempty"`
}

type BatchPaymentRequest struct {
	Payments []struct {
		ContractorID  int     `json:"contractor_id"`
		AmountUSD     float64 `json:"amount_usd"`
		Currency      string  `json:"currency"`
		Country       string  `json:"country"`
		BankAccount   string  `json:"bank_account"`
		RoutingCode   string  `json:"routing_code"`
	} `json:"payments"`
	ScheduledDate string `json:"scheduled_date"`
}

type BatchPaymentResponse struct {
	TotalPayments   int     `json:"total_payments"`
	TotalAmountUSD  float64 `json:"total_amount_usd"`
	TotalFeesUSD    float64 `json:"total_fees_usd"`
	EstimatedDate   string  `json:"estimated_date"`
	Rails           map[string]int `json:"rails"`
	ValidationErrors []string `json:"validation_errors"`
}

// ─── Tax & VAT Tables ─────────────────────────────────────────────────────────

var vatRates = map[string]float64{
	"NG": 7.5, "GB": 20.0, "KE": 16.0, "GH": 15.0,
	"ZA": 15.0, "US": 0.0, "CA": 5.0, "DE": 19.0,
	"FR": 20.0, "AE": 5.0, "SG": 9.0, "AU": 10.0,
}

var withholdingTaxRates = map[string]float64{
	"NG": 5.0,  // WHT on professional services
	"KE": 5.0,  // WHT on management fees
	"GH": 8.0,  // WHT on services
	"ZA": 15.0, // WHT on foreign contractors
	"GB": 0.0,  // No WHT for registered contractors
	"US": 0.0,  // W-8BEN exemption for foreign
	"DE": 0.0,
	"FR": 0.0,
	"AE": 0.0,
	"SG": 0.0,
}

// ─── Payment Rail Routing ─────────────────────────────────────────────────────

type RailConfig struct {
	Rail          string
	Days          int
	FeePct        float64
	MinFeeUSD     float64
	MaxFeeUSD     float64
	Alternative   string
}

func selectPaymentRail(toCountry, currency string, amountUSD float64) RailConfig {
	switch toCountry {
	case "NG":
		if amountUSD > 10000 {
			return RailConfig{"SWIFT", 3, 0.25, 15, 50, "NIP"}
		}
		return RailConfig{"NIP", 0, 0.1, 0.5, 5, ""}
	case "KE", "TZ", "UG":
		return RailConfig{"M-Pesa", 0, 0.5, 0.1, 10, "SWIFT"}
	case "GH":
		return RailConfig{"GhIPSS", 0, 0.3, 0.5, 8, "SWIFT"}
	case "ZA":
		return RailConfig{"RTGS", 1, 0.2, 2, 20, "SWIFT"}
	case "GB":
		if currency == "GBP" {
			return RailConfig{"FPS", 0, 0.0, 0.0, 0.5, "CHAPS"}
		}
		return RailConfig{"SWIFT", 2, 0.15, 5, 30, ""}
	case "US":
		if currency == "USD" {
			return RailConfig{"ACH", 1, 0.1, 0.25, 5, "FedWire"}
		}
		return RailConfig{"SWIFT", 2, 0.2, 10, 40, ""}
	case "AE":
		return RailConfig{"SWIFT", 1, 0.15, 5, 25, ""}
	case "DE", "FR", "NL", "ES":
		if currency == "EUR" {
			return RailConfig{"SEPA", 1, 0.05, 0.5, 5, "SWIFT"}
		}
		return RailConfig{"SWIFT", 2, 0.2, 8, 35, ""}
	default:
		return RailConfig{"SWIFT", 3, 0.3, 15, 60, ""}
	}
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"service": "contractor-engine",
		"status":  "healthy",
		"version": "1.0.0",
		"time":    time.Now().UTC().Format(time.RFC3339),
	})
}

func handleCalculateInvoice(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req InvoiceCalcRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Calculate subtotal from line items
	subtotal := 0.0
	for i, item := range req.LineItems {
		req.LineItems[i].Total = math.Round(item.Quantity*item.UnitPrice*100) / 100
		subtotal += req.LineItems[i].Total
	}

	country := strings.ToUpper(req.ContractorCountry)

	// VAT
	vatRate := vatRates[country]
	vatAmount := 0.0
	if req.IncludeVAT {
		vatAmount = math.Round(subtotal*vatRate/100*100) / 100
	}

	// Withholding tax (deducted from payment)
	whtRate := withholdingTaxRates[country]
	whtAmount := math.Round(subtotal*whtRate/100*100) / 100

	total := math.Round((subtotal+vatAmount)*100) / 100
	netPayable := math.Round((total-whtAmount)*100) / 100

	// Payment rail
	rail := selectPaymentRail(country, req.Currency, subtotal)

	resp := InvoiceCalcResponse{
		Subtotal:           subtotal,
		VATRate:            vatRate,
		VATAmount:          vatAmount,
		WithholdingTaxRate: whtRate,
		WithholdingTax:     whtAmount,
		Total:              total,
		NetPayable:         netPayable,
		Currency:           req.Currency,
		PaymentRail:        rail.Rail,
		EstimatedDays:      rail.Days,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func handleRoutePayment(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req PaymentRouteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	rail := selectPaymentRail(strings.ToUpper(req.ToCountry), req.Currency, req.AmountUSD)
	fee := math.Max(rail.MinFeeUSD, math.Min(rail.MaxFeeUSD, req.AmountUSD*rail.FeePct/100))
	fee = math.Round(fee*100) / 100

	notes := ""
	if req.AmountUSD > 50000 {
		notes = "Amount exceeds $50,000 — enhanced due diligence required before processing"
	}

	resp := PaymentRouteResponse{
		Rail:            rail.Rail,
		EstimatedDays:   rail.Days,
		FeeUSD:          fee,
		FeePct:          rail.FeePct,
		Supported:       true,
		AlternativeRail: rail.Alternative,
		Notes:           notes,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func handleBatchPayments(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req BatchPaymentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	totalAmount := 0.0
	totalFees := 0.0
	rails := make(map[string]int)
	var validationErrors []string

	for i, p := range req.Payments {
		if p.AmountUSD <= 0 {
			validationErrors = append(validationErrors, fmt.Sprintf("Payment %d: amount must be > 0", i+1))
			continue
		}
		if p.BankAccount == "" {
			validationErrors = append(validationErrors, fmt.Sprintf("Payment %d: bank account required", i+1))
			continue
		}
		if p.AmountUSD > 1000000 {
			validationErrors = append(validationErrors, fmt.Sprintf("Payment %d: exceeds single payment limit of $1,000,000", i+1))
			continue
		}

		rail := selectPaymentRail(strings.ToUpper(p.Country), p.Currency, p.AmountUSD)
		fee := math.Max(rail.MinFeeUSD, math.Min(rail.MaxFeeUSD, p.AmountUSD*rail.FeePct/100))

		totalAmount += p.AmountUSD
		totalFees += fee
		rails[rail.Rail]++
	}

	// Estimated completion date
	estimatedDate := time.Now().AddDate(0, 0, 2).Format("2006-01-02")
	if req.ScheduledDate != "" {
		estimatedDate = req.ScheduledDate
	}

	resp := BatchPaymentResponse{
		TotalPayments:    len(req.Payments),
		TotalAmountUSD:   math.Round(totalAmount*100) / 100,
		TotalFeesUSD:     math.Round(totalFees*100) / 100,
		EstimatedDate:    estimatedDate,
		Rails:            rails,
		ValidationErrors: validationErrors,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func handleWithholdingTax(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	country := strings.ToUpper(r.URL.Query().Get("country"))
	rate, ok := withholdingTaxRates[country]
	if !ok {
		rate = 0.0
	}
	vatRate := vatRates[country]
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"country":          country,
		"withholding_rate": rate,
		"vat_rate":         vatRate,
	})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	port := os.Getenv("CONTRACTOR_ENGINE_PORT")
	if port == "" {
		port = "8210"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/calculate-invoice", handleCalculateInvoice)
	mux.HandleFunc("/route-payment", handleRoutePayment)
	mux.HandleFunc("/batch-payments", handleBatchPayments)
	mux.HandleFunc("/withholding-tax", handleWithholdingTax)

	log.Printf("[contractor-engine] Starting on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
