// RemitFlow Payroll Engine — Go microservice
// Handles: gross→net calculation, multi-jurisdiction tax, FX conversion, payslip generation
// Port: 8200
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"time"
)

// ─── Domain Types ─────────────────────────────────────────────────────────────

type Jurisdiction string

const (
	JurNG Jurisdiction = "NG" // Nigeria
	JurGB Jurisdiction = "GB" // United Kingdom
	JurUS Jurisdiction = "US" // United States
	JurCA Jurisdiction = "CA" // Canada
	JurDE Jurisdiction = "DE" // Germany
	JurFR Jurisdiction = "FR" // France
	JurAE Jurisdiction = "AE" // UAE
	JurGH Jurisdiction = "GH" // Ghana
	JurKE Jurisdiction = "KE" // Kenya
	JurZA Jurisdiction = "ZA" // South Africa
)

type TaxBracket struct {
	Min        float64 `json:"min"`
	Max        float64 `json:"max"`        // -1 = unlimited
	Rate       float64 `json:"rate"`       // 0.0–1.0
	FlatAmount float64 `json:"flat_amount"` // cumulative tax on lower brackets
}

type JurisdictionConfig struct {
	Jurisdiction    Jurisdiction `json:"jurisdiction"`
	TaxYear         int          `json:"tax_year"`
	Brackets        []TaxBracket `json:"brackets"`
	SocialSecurity  float64      `json:"social_security"`  // employee rate
	Medicare        float64      `json:"medicare"`
	PensionEmployee float64      `json:"pension_employee"`
	PensionEmployer float64      `json:"pension_employer"`
	NHF             float64      `json:"nhf"`  // Nigeria Housing Fund
	NHIS            float64      `json:"nhis"` // Nigeria Health Insurance
	WithholdingTax  float64      `json:"withholding_tax"` // for contractors
	PersonalAllowance float64    `json:"personal_allowance"` // GB personal allowance
}

// ─── Tax Tables (2026) ────────────────────────────────────────────────────────

var taxConfigs = map[Jurisdiction]JurisdictionConfig{
	JurNG: {
		Jurisdiction: JurNG, TaxYear: 2026,
		Brackets: []TaxBracket{
			{Min: 0, Max: 300000, Rate: 0.07, FlatAmount: 0},
			{Min: 300000, Max: 600000, Rate: 0.11, FlatAmount: 21000},
			{Min: 600000, Max: 1100000, Rate: 0.15, FlatAmount: 54000},
			{Min: 1100000, Max: 1600000, Rate: 0.19, FlatAmount: 129000},
			{Min: 1600000, Max: 3200000, Rate: 0.21, FlatAmount: 224000},
			{Min: 3200000, Max: -1, Rate: 0.24, FlatAmount: 560000},
		},
		PensionEmployee: 0.08, PensionEmployer: 0.10,
		NHF: 0.025, NHIS: 0.0175,
	},
	JurGB: {
		Jurisdiction: JurGB, TaxYear: 2026,
		PersonalAllowance: 12570,
		Brackets: []TaxBracket{
			{Min: 0, Max: 12570, Rate: 0.0, FlatAmount: 0},
			{Min: 12570, Max: 50270, Rate: 0.20, FlatAmount: 0},
			{Min: 50270, Max: 125140, Rate: 0.40, FlatAmount: 7540},
			{Min: 125140, Max: -1, Rate: 0.45, FlatAmount: 37896},
		},
		SocialSecurity: 0.08, // NI employee rate (above £12,570)
		PensionEmployee: 0.05, PensionEmployer: 0.03,
	},
	JurUS: {
		Jurisdiction: JurUS, TaxYear: 2026,
		Brackets: []TaxBracket{
			{Min: 0, Max: 11600, Rate: 0.10, FlatAmount: 0},
			{Min: 11600, Max: 47150, Rate: 0.12, FlatAmount: 1160},
			{Min: 47150, Max: 100525, Rate: 0.22, FlatAmount: 5426},
			{Min: 100525, Max: 191950, Rate: 0.24, FlatAmount: 17168},
			{Min: 191950, Max: 243725, Rate: 0.32, FlatAmount: 39110},
			{Min: 243725, Max: 609350, Rate: 0.35, FlatAmount: 55678},
			{Min: 609350, Max: -1, Rate: 0.37, FlatAmount: 183647},
		},
		SocialSecurity: 0.062, Medicare: 0.0145,
		PensionEmployee: 0.0, // 401k voluntary
	},
	JurCA: {
		Jurisdiction: JurCA, TaxYear: 2026,
		Brackets: []TaxBracket{
			{Min: 0, Max: 55867, Rate: 0.15, FlatAmount: 0},
			{Min: 55867, Max: 111733, Rate: 0.205, FlatAmount: 8380},
			{Min: 111733, Max: 154906, Rate: 0.26, FlatAmount: 19793},
			{Min: 154906, Max: 220000, Rate: 0.29, FlatAmount: 31018},
			{Min: 220000, Max: -1, Rate: 0.33, FlatAmount: 49898},
		},
		SocialSecurity: 0.0595, // CPP
		Medicare: 0.0166,       // EI
	},
	JurDE: {
		Jurisdiction: JurDE, TaxYear: 2026,
		Brackets: []TaxBracket{
			{Min: 0, Max: 11604, Rate: 0.0, FlatAmount: 0},
			{Min: 11604, Max: 66760, Rate: 0.14, FlatAmount: 0},
			{Min: 66760, Max: 277826, Rate: 0.42, FlatAmount: 13805},
			{Min: 277826, Max: -1, Rate: 0.45, FlatAmount: 102710},
		},
		SocialSecurity: 0.093, Medicare: 0.0745,
		PensionEmployee: 0.093,
	},
	JurAE: {
		Jurisdiction: JurAE, TaxYear: 2026,
		Brackets:        []TaxBracket{{Min: 0, Max: -1, Rate: 0.0, FlatAmount: 0}}, // No income tax
		SocialSecurity:  0.05, // UAE nationals only; expats = 0
		PensionEmployee: 0.05,
	},
	JurGH: {
		Jurisdiction: JurGH, TaxYear: 2026,
		Brackets: []TaxBracket{
			{Min: 0, Max: 4380, Rate: 0.0, FlatAmount: 0},
			{Min: 4380, Max: 5100, Rate: 0.05, FlatAmount: 0},
			{Min: 5100, Max: 6240, Rate: 0.10, FlatAmount: 36},
			{Min: 6240, Max: 7560, Rate: 0.175, FlatAmount: 150},
			{Min: 7560, Max: 10080, Rate: 0.25, FlatAmount: 381},
			{Min: 10080, Max: -1, Rate: 0.30, FlatAmount: 1011},
		},
		SocialSecurity: 0.055, // SSNIT employee
	},
	JurKE: {
		Jurisdiction: JurKE, TaxYear: 2026,
		Brackets: []TaxBracket{
			{Min: 0, Max: 288000, Rate: 0.10, FlatAmount: 0},
			{Min: 288000, Max: 388000, Rate: 0.25, FlatAmount: 28800},
			{Min: 388000, Max: -1, Rate: 0.30, FlatAmount: 53800},
		},
		SocialSecurity: 0.06, // NSSF
		Medicare: 0.0275,     // NHIF
	},
	JurZA: {
		Jurisdiction: JurZA, TaxYear: 2026,
		Brackets: []TaxBracket{
			{Min: 0, Max: 237100, Rate: 0.18, FlatAmount: 0},
			{Min: 237100, Max: 370500, Rate: 0.26, FlatAmount: 42678},
			{Min: 370500, Max: 512800, Rate: 0.31, FlatAmount: 77362},
			{Min: 512800, Max: 673000, Rate: 0.36, FlatAmount: 121475},
			{Min: 673000, Max: 857900, Rate: 0.39, FlatAmount: 179147},
			{Min: 857900, Max: 1817000, Rate: 0.41, FlatAmount: 251258},
			{Min: 1817000, Max: -1, Rate: 0.45, FlatAmount: 644489},
		},
		SocialSecurity: 0.01, // UIF
		PensionEmployee: 0.075,
	},
}

// ─── Request / Response Types ─────────────────────────────────────────────────

type EmployeePayInput struct {
	EmployeeID     int          `json:"employee_id"`
	EmployeeCode   string       `json:"employee_code"`
	FirstName      string       `json:"first_name"`
	LastName       string       `json:"last_name"`
	GrossSalary    float64      `json:"gross_salary"`
	SalaryCurrency string       `json:"salary_currency"`
	Jurisdiction   Jurisdiction `json:"jurisdiction"`
	EmploymentType string       `json:"employment_type"` // full_time | contractor
	OtherDeductions float64     `json:"other_deductions"`
}

type TaxBreakdown struct {
	IncomeTax      float64 `json:"income_tax"`
	SocialSecurity float64 `json:"social_security"`
	Medicare       float64 `json:"medicare"`
	Pension        float64 `json:"pension"`
	NHF            float64 `json:"nhf"`
	NHIS           float64 `json:"nhis"`
	TotalDeductions float64 `json:"total_deductions"`
}

type EmployeePayResult struct {
	EmployeeID     int          `json:"employee_id"`
	EmployeeCode   string       `json:"employee_code"`
	FullName       string       `json:"full_name"`
	GrossSalary    float64      `json:"gross_salary"`
	GrossCurrency  string       `json:"gross_currency"`
	GrossUSD       float64      `json:"gross_usd"`
	FXRate         float64      `json:"fx_rate"`
	TaxBreakdown   TaxBreakdown `json:"tax_breakdown"`
	NetPay         float64      `json:"net_pay"`
	NetCurrency    string       `json:"net_currency"`
	NetUSD         float64      `json:"net_usd"`
	RemitFee       float64      `json:"remit_fee"`
	Jurisdiction   Jurisdiction `json:"jurisdiction"`
}

type PayrollRunRequest struct {
	CompanyID    int               `json:"company_id"`
	RunReference string            `json:"run_reference"`
	PeriodStart  string            `json:"period_start"`
	PeriodEnd    string            `json:"period_end"`
	PayDate      string            `json:"pay_date"`
	Frequency    string            `json:"frequency"`
	Employees    []EmployeePayInput `json:"employees"`
}

type PayrollRunResult struct {
	CompanyID      int                 `json:"company_id"`
	RunReference   string              `json:"run_reference"`
	EmployeeCount  int                 `json:"employee_count"`
	TotalGrossUSD  float64             `json:"total_gross_usd"`
	TotalTaxUSD    float64             `json:"total_tax_usd"`
	TotalDeductUSD float64             `json:"total_deduct_usd"`
	TotalNetUSD    float64             `json:"total_net_usd"`
	TotalFeeUSD    float64             `json:"total_fee_usd"`
	Items          []EmployeePayResult `json:"items"`
	ComputedAt     string              `json:"computed_at"`
	EngineVersion  string              `json:"engine_version"`
}

// ─── FX Rates (static fallback; in production, fetched from FX service) ───────

var fxRates = map[string]float64{
	"USD": 1.0, "NGN": 0.000625, "GBP": 1.27, "EUR": 1.09,
	"CAD": 0.74, "AED": 0.272, "GHS": 0.068, "KES": 0.0077,
	"ZAR": 0.055, "JPY": 0.0067, "CNY": 0.138,
}

func toUSD(amount float64, currency string) (float64, float64) {
	rate, ok := fxRates[currency]
	if !ok {
		rate = 1.0
	}
	return amount * rate, rate
}

// ─── Tax Calculation Engine ───────────────────────────────────────────────────

func calculateTax(annualGross float64, cfg JurisdictionConfig, isContractor bool) TaxBreakdown {
	var bd TaxBreakdown

	if isContractor {
		bd.IncomeTax = annualGross * cfg.WithholdingTax
		bd.TotalDeductions = bd.IncomeTax
		return bd
	}

	// Apply personal allowance (GB)
	taxableIncome := annualGross
	if cfg.PersonalAllowance > 0 && taxableIncome > cfg.PersonalAllowance {
		// GB: taper personal allowance above £100,000
		if cfg.Jurisdiction == JurGB && annualGross > 100000 {
			reduction := math.Min((annualGross-100000)/2, cfg.PersonalAllowance)
			taxableIncome = annualGross - (cfg.PersonalAllowance - reduction)
		} else {
			taxableIncome = annualGross - cfg.PersonalAllowance
		}
	}

	// Income tax via brackets
	for _, b := range cfg.Brackets {
		if taxableIncome <= b.Min {
			break
		}
		upper := b.Max
		if upper < 0 {
			upper = taxableIncome
		}
		if taxableIncome < upper {
			upper = taxableIncome
		}
		bd.IncomeTax = b.FlatAmount + (upper-b.Min)*b.Rate
	}

	// Statutory deductions (annual)
	bd.SocialSecurity = annualGross * cfg.SocialSecurity
	bd.Medicare = annualGross * cfg.Medicare
	bd.Pension = annualGross * cfg.PensionEmployee
	bd.NHF = annualGross * cfg.NHF
	bd.NHIS = annualGross * cfg.NHIS

	bd.TotalDeductions = bd.IncomeTax + bd.SocialSecurity + bd.Medicare + bd.Pension + bd.NHF + bd.NHIS
	return bd
}

// ─── Remittance Fee (tiered) ──────────────────────────────────────────────────

func calcRemitFee(netUSD float64) float64 {
	switch {
	case netUSD < 500:
		return 4.99
	case netUSD < 2000:
		return netUSD * 0.008 // 0.8%
	case netUSD < 10000:
		return netUSD * 0.006 // 0.6%
	default:
		return netUSD * 0.004 // 0.4% for large payroll
	}
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"service": "payroll-engine",
		"version": "1.0.0",
	})
}

func calculateRunHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req PayrollRunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid JSON: %v", err), http.StatusBadRequest)
		return
	}

	result := PayrollRunResult{
		CompanyID:     req.CompanyID,
		RunReference:  req.RunReference,
		ComputedAt:    time.Now().UTC().Format(time.RFC3339),
		EngineVersion: "1.0.0",
	}

	for _, emp := range req.Employees {
		cfg, ok := taxConfigs[emp.Jurisdiction]
		if !ok {
			cfg = taxConfigs[JurUS] // fallback
		}

		isContractor := emp.EmploymentType == "contractor"
		grossUSD, fxRate := toUSD(emp.GrossSalary, emp.SalaryCurrency)

		// Tax is annual; salary assumed monthly → annualise
		annualGross := emp.GrossSalary * 12
		annualGrossUSD := grossUSD * 12

		taxBD := calculateTax(annualGross, cfg, isContractor)

		// Convert annual deductions to monthly
		monthlyIncomeTax := taxBD.IncomeTax / 12
		monthlySS := taxBD.SocialSecurity / 12
		monthlyMedicare := taxBD.Medicare / 12
		monthlyPension := taxBD.Pension / 12
		monthlyNHF := taxBD.NHF / 12
		monthlyNHIS := taxBD.NHIS / 12
		monthlyOther := emp.OtherDeductions
		monthlyTotal := monthlyIncomeTax + monthlySS + monthlyMedicare + monthlyPension + monthlyNHF + monthlyNHIS + monthlyOther

		netPay := emp.GrossSalary - monthlyTotal
		if netPay < 0 {
			netPay = 0
		}
		netUSD, _ := toUSD(netPay, emp.SalaryCurrency)
		remitFee := calcRemitFee(netUSD)

		item := EmployeePayResult{
			EmployeeID:    emp.EmployeeID,
			EmployeeCode:  emp.EmployeeCode,
			FullName:      emp.FirstName + " " + emp.LastName,
			GrossSalary:   emp.GrossSalary,
			GrossCurrency: emp.SalaryCurrency,
			GrossUSD:      grossUSD,
			FXRate:        fxRate,
			TaxBreakdown: TaxBreakdown{
				IncomeTax:       round2(monthlyIncomeTax),
				SocialSecurity:  round2(monthlySS),
				Medicare:        round2(monthlyMedicare),
				Pension:         round2(monthlyPension),
				NHF:             round2(monthlyNHF),
				NHIS:            round2(monthlyNHIS),
				TotalDeductions: round2(monthlyTotal),
			},
			NetPay:       round2(netPay),
			NetCurrency:  emp.SalaryCurrency,
			NetUSD:       round2(netUSD),
			RemitFee:     round2(remitFee),
			Jurisdiction: emp.Jurisdiction,
		}

		result.Items = append(result.Items, item)
		result.TotalGrossUSD += annualGrossUSD / 12
		result.TotalTaxUSD += toUSDAmount(monthlyIncomeTax, emp.SalaryCurrency)
		result.TotalDeductUSD += toUSDAmount(monthlyTotal, emp.SalaryCurrency)
		result.TotalNetUSD += netUSD
		result.TotalFeeUSD += remitFee
	}

	result.EmployeeCount = len(result.Items)
	result.TotalGrossUSD = round2(result.TotalGrossUSD)
	result.TotalTaxUSD = round2(result.TotalTaxUSD)
	result.TotalDeductUSD = round2(result.TotalDeductUSD)
	result.TotalNetUSD = round2(result.TotalNetUSD)
	result.TotalFeeUSD = round2(result.TotalFeeUSD)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func taxPreviewHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var emp EmployeePayInput
	if err := json.NewDecoder(r.Body).Decode(&emp); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	cfg, ok := taxConfigs[emp.Jurisdiction]
	if !ok {
		http.Error(w, "Unsupported jurisdiction", http.StatusBadRequest)
		return
	}
	grossUSD, fxRate := toUSD(emp.GrossSalary, emp.SalaryCurrency)
	annualGross := emp.GrossSalary * 12
	taxBD := calculateTax(annualGross, cfg, emp.EmploymentType == "contractor")
	monthlyTotal := (taxBD.IncomeTax + taxBD.SocialSecurity + taxBD.Medicare + taxBD.Pension + taxBD.NHF + taxBD.NHIS) / 12
	netPay := emp.GrossSalary - monthlyTotal
	netUSD, _ := toUSD(netPay, emp.SalaryCurrency)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"jurisdiction":    emp.Jurisdiction,
		"gross_salary":    emp.GrossSalary,
		"gross_currency":  emp.SalaryCurrency,
		"gross_usd":       round2(grossUSD),
		"fx_rate":         fxRate,
		"income_tax":      round2(taxBD.IncomeTax / 12),
		"social_security": round2(taxBD.SocialSecurity / 12),
		"medicare":        round2(taxBD.Medicare / 12),
		"pension":         round2(taxBD.Pension / 12),
		"nhf":             round2(taxBD.NHF / 12),
		"nhis":            round2(taxBD.NHIS / 12),
		"total_deductions":round2(monthlyTotal),
		"net_pay":         round2(netPay),
		"net_usd":         round2(netUSD),
		"remit_fee":       round2(calcRemitFee(netUSD)),
		"effective_tax_rate": round4((taxBD.IncomeTax / 12) / emp.GrossSalary),
	})
}

func jurisdictionsHandler(w http.ResponseWriter, r *http.Request) {
	type JurInfo struct {
		Code string `json:"code"`
		Name string `json:"name"`
	}
	names := map[Jurisdiction]string{
		JurNG: "Nigeria", JurGB: "United Kingdom", JurUS: "United States",
		JurCA: "Canada", JurDE: "Germany", JurAE: "UAE",
		JurGH: "Ghana", JurKE: "Kenya", JurZA: "South Africa",
	}
	var list []JurInfo
	for code, name := range names {
		list = append(list, JurInfo{Code: string(code), Name: name})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func round2(v float64) float64 { return math.Round(v*100) / 100 }
func round4(v float64) float64 { return math.Round(v*10000) / 10000 }

func toUSDAmount(amount float64, currency string) float64 {
	rate, ok := fxRates[currency]
	if !ok {
		return amount
	}
	return amount * rate
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	port := os.Getenv("PAYROLL_ENGINE_PORT")
	if port == "" {
		port = "8200"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health",          healthHandler)
	mux.HandleFunc("/calculate-run",   calculateRunHandler)
	mux.HandleFunc("/tax-preview",     taxPreviewHandler)
	mux.HandleFunc("/jurisdictions",   jurisdictionsHandler)

	// CORS middleware
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		mux.ServeHTTP(w, r)
	})

	log.Printf("[payroll-engine] Listening on :%s", port)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
