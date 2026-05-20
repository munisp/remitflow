// expense-policy — Go microservice for business expense policy evaluation,
// receipt validation, auto-approval decisions, and spend analytics.
// Listens on :8212.
package main

import (
	"fmt"
	"encoding/json"
	"log"
	"math"
	"net/http"
	"os"
	"strings"
	"time"
)

// ─── Types ────────────────────────────────────────────────────────────────────

type Policy struct {
	ID              int     `json:"id"`
	Category        string  `json:"category"`
	MaxAmountUSD    float64 `json:"max_amount_usd"`
	RequiresReceipt bool    `json:"requires_receipt"`
	Action          string  `json:"action"` // auto_approve | require_review | reject
}

type ExpenseItem struct {
	Category    string  `json:"category"`
	AmountUSD   float64 `json:"amount_usd"`
	HasReceipt  bool    `json:"has_receipt"`
	Description string  `json:"description"`
	MerchantName string `json:"merchant_name"`
}

type PolicyEvalRequest struct {
	Policies []Policy      `json:"policies"`
	Items    []ExpenseItem `json:"items"`
	EmployeeLevel string   `json:"employee_level"` // junior | mid | senior | executive
}

type ItemDecision struct {
	ItemIndex   int     `json:"item_index"`
	Category    string  `json:"category"`
	AmountUSD   float64 `json:"amount_usd"`
	Decision    string  `json:"decision"` // auto_approve | require_review | reject
	Reason      string  `json:"reason"`
	PolicyID    int     `json:"policy_id,omitempty"`
	FlaggedRisk string  `json:"flagged_risk,omitempty"`
}

type PolicyEvalResponse struct {
	Decisions        []ItemDecision `json:"decisions"`
	TotalAmountUSD   float64        `json:"total_amount_usd"`
	AutoApprovedUSD  float64        `json:"auto_approved_usd"`
	RequiresReviewUSD float64       `json:"requires_review_usd"`
	RejectedUSD      float64        `json:"rejected_usd"`
	OverallDecision  string         `json:"overall_decision"`
	RiskFlags        []string       `json:"risk_flags"`
}

type SpendAnalyticsRequest struct {
	Items []struct {
		Category  string  `json:"category"`
		Amount    float64 `json:"amount"`
		Date      string  `json:"date"`
		Approved  bool    `json:"approved"`
	} `json:"items"`
	PeriodDays int `json:"period_days"`
}

type SpendAnalyticsResponse struct {
	TotalSpendUSD      float64            `json:"total_spend_usd"`
	ApprovedSpendUSD   float64            `json:"approved_spend_usd"`
	RejectedSpendUSD   float64            `json:"rejected_spend_usd"`
	ByCategory         map[string]float64 `json:"by_category"`
	TopCategory        string             `json:"top_category"`
	DailyAvgUSD        float64            `json:"daily_avg_usd"`
	ComplianceRate     float64            `json:"compliance_rate"`
}

// ─── Level-based limits ───────────────────────────────────────────────────────

var levelMultipliers = map[string]float64{
	"junior":    0.5,
	"mid":       1.0,
	"senior":    2.0,
	"executive": 5.0,
}

// ─── Risk detection ───────────────────────────────────────────────────────────

var highRiskMerchants = []string{
	"casino", "gambling", "adult", "nightclub", "bar", "liquor",
}

func isHighRiskMerchant(name string) bool {
	lower := strings.ToLower(name)
	for _, kw := range highRiskMerchants {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}

func detectSplitting(items []ExpenseItem) bool {
	// Detect potential expense splitting (multiple similar amounts on same day)
	categoryAmounts := make(map[string][]float64)
	for _, item := range items {
		categoryAmounts[item.Category] = append(categoryAmounts[item.Category], item.AmountUSD)
	}
	for _, amounts := range categoryAmounts {
		if len(amounts) >= 3 {
			// Check if amounts are suspiciously similar
			avg := 0.0
			for _, a := range amounts {
				avg += a
			}
			avg /= float64(len(amounts))
			allSimilar := true
			for _, a := range amounts {
				if math.Abs(a-avg)/avg > 0.1 { // within 10% of average
					allSimilar = false
					break
				}
			}
			if allSimilar {
				return true
			}
		}
	}
	return false
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"service": "expense-policy",
		"status":  "healthy",
		"version": "1.0.0",
		"time":    time.Now().UTC().Format(time.RFC3339),
	})
}

func handleEvaluate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req PolicyEvalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Build policy lookup by category
	policyMap := make(map[string]Policy)
	for _, p := range req.Policies {
		policyMap[p.Category] = p
	}

	levelMult := levelMultipliers[req.EmployeeLevel]
	if levelMult == 0 {
		levelMult = 1.0
	}

	decisions := []ItemDecision{}
	totalAmount := 0.0
	autoApproved := 0.0
	requiresReview := 0.0
	rejected := 0.0
	riskFlags := []string{}

	// Check for splitting
	if detectSplitting(req.Items) {
		riskFlags = append(riskFlags, "Potential expense splitting detected — multiple similar amounts in same category")
	}

	for i, item := range req.Items {
		totalAmount += item.AmountUSD
		decision := ItemDecision{
			ItemIndex: i,
			Category:  item.Category,
			AmountUSD: item.AmountUSD,
		}

		// High-risk merchant check
		if item.MerchantName != "" && isHighRiskMerchant(item.MerchantName) {
			decision.Decision = "reject"
			decision.Reason = "Merchant category not permitted under expense policy"
			decision.FlaggedRisk = "high_risk_merchant"
			rejected += item.AmountUSD
			decisions = append(decisions, decision)
			continue
		}

		policy, hasPol := policyMap[item.Category]
		if !hasPol {
			// No policy for category — require review
			decision.Decision = "require_review"
			decision.Reason = "No policy defined for category — manual review required"
			requiresReview += item.AmountUSD
			decisions = append(decisions, decision)
			continue
		}

		decision.PolicyID = policy.ID
		effectiveLimit := policy.MaxAmountUSD * levelMult

		// Receipt check
		if policy.RequiresReceipt && !item.HasReceipt {
			decision.Decision = "reject"
			decision.Reason = "Receipt required but not provided"
			rejected += item.AmountUSD
			decisions = append(decisions, decision)
			continue
		}

		// Amount check
		if item.AmountUSD > effectiveLimit {
			decision.Decision = "reject"
			decision.Reason = "Amount exceeds policy limit of $" + formatAmount(effectiveLimit) + " for " + req.EmployeeLevel + " level"
			rejected += item.AmountUSD
			decisions = append(decisions, decision)
			continue
		}

		// Apply policy action
		switch policy.Action {
		case "auto_approve":
			decision.Decision = "auto_approve"
			decision.Reason = "Within policy limits — auto-approved"
			autoApproved += item.AmountUSD
		case "require_review":
			decision.Decision = "require_review"
			decision.Reason = "Policy requires manager review"
			requiresReview += item.AmountUSD
		case "reject":
			decision.Decision = "reject"
			decision.Reason = "Category not permitted under current policy"
			rejected += item.AmountUSD
		default:
			decision.Decision = "require_review"
			decision.Reason = "Unknown policy action — defaulting to review"
			requiresReview += item.AmountUSD
		}

		decisions = append(decisions, decision)
	}

	// Overall decision
	overall := "auto_approve"
	if rejected > 0 {
		overall = "reject"
	} else if requiresReview > 0 {
		overall = "require_review"
	}

	resp := PolicyEvalResponse{
		Decisions:         decisions,
		TotalAmountUSD:    math.Round(totalAmount*100) / 100,
		AutoApprovedUSD:   math.Round(autoApproved*100) / 100,
		RequiresReviewUSD: math.Round(requiresReview*100) / 100,
		RejectedUSD:       math.Round(rejected*100) / 100,
		OverallDecision:   overall,
		RiskFlags:         riskFlags,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func handleAnalytics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req SpendAnalyticsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	byCategory := make(map[string]float64)
	totalSpend := 0.0
	approvedSpend := 0.0
	rejectedSpend := 0.0

	for _, item := range req.Items {
		totalSpend += item.Amount
		byCategory[item.Category] += item.Amount
		if item.Approved {
			approvedSpend += item.Amount
		} else {
			rejectedSpend += item.Amount
		}
	}

	topCat := ""
	topAmt := 0.0
	for cat, amt := range byCategory {
		if amt > topAmt {
			topAmt = amt
			topCat = cat
		}
	}

	days := req.PeriodDays
	if days == 0 {
		days = 30
	}
	dailyAvg := totalSpend / float64(days)

	complianceRate := 0.0
	if totalSpend > 0 {
		complianceRate = approvedSpend / totalSpend * 100
	}

	resp := SpendAnalyticsResponse{
		TotalSpendUSD:    math.Round(totalSpend*100) / 100,
		ApprovedSpendUSD: math.Round(approvedSpend*100) / 100,
		RejectedSpendUSD: math.Round(rejectedSpend*100) / 100,
		ByCategory:       byCategory,
		TopCategory:      topCat,
		DailyAvgUSD:      math.Round(dailyAvg*100) / 100,
		ComplianceRate:   math.Round(complianceRate*100) / 100,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func formatAmount(amount float64) string {
	return strings.TrimRight(strings.TrimRight(
		strings.Replace(
			strings.Replace(
				string([]byte(fmt.Sprintf("%.2f", amount))),
				"", "", -1),
			"", "", -1),
		"0"), ".")
}

func fmt_sprintf(format string, a ...interface{}) string {
	return fmt.Sprintf(format, a...)
}

func main() {
	port := os.Getenv("EXPENSE_POLICY_PORT")
	if port == "" {
		port = "8212"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/evaluate", handleEvaluate)
	mux.HandleFunc("/analytics", handleAnalytics)

	log.Printf("[expense-policy] Starting on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
