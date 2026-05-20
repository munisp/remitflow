package main

import (
	"math"
	"time"
)

// FraudRule represents a single scoring rule with a weight.
type FraudRule struct {
	ID          string
	Name        string
	Description string
	Weight      float64
	Enabled     bool
	Evaluate    func(req *ScoreTransactionRequest) bool
}

// ScoreTransactionRequest contains all signals used for fraud scoring.
type ScoreTransactionRequest struct {
	TransferID        string
	UserID            int64
	AmountUSD         float64
	SourceCountry     string
	DestCountry       string
	PaymentMethod     string
	HourOfDay         int
	IsNewDevice       bool
	IsNewBeneficiary  bool
	TransfersToday    int
}

// ScoreTransactionResponse contains the fraud assessment result.
type ScoreTransactionResponse struct {
	Score        float64  // 0.0 – 100.0
	RiskLevel    string   // low | medium | high | critical
	Flags        []string
	Block        bool
	ManualReview bool
	Reason       string
}

// FraudScorerService evaluates transactions against a rule set.
type FraudScorerService struct {
	rules []*FraudRule
}

// NewFraudScorerService initialises the scorer with all production rules.
func NewFraudScorerService() *FraudScorerService {
	return &FraudScorerService{
		rules: buildRules(),
	}
}

// Score evaluates a transaction and returns a composite fraud score.
func (f *FraudScorerService) Score(req *ScoreTransactionRequest) *ScoreTransactionResponse {
	var totalWeight float64
	var hitWeight float64
	var flags []string

	for _, rule := range f.rules {
		if !rule.Enabled {
			continue
		}
		totalWeight += rule.Weight
		if rule.Evaluate(req) {
			hitWeight += rule.Weight
			flags = append(flags, rule.Name)
		}
	}

	score := 0.0
	if totalWeight > 0 {
		score = math.Round((hitWeight/totalWeight)*100*10) / 10
	}

	riskLevel := "low"
	block := false
	manualReview := false
	reason := "Transaction passed all fraud checks."

	switch {
	case score >= 80:
		riskLevel = "critical"
		block = true
		reason = "Critical fraud risk. Transaction blocked automatically."
	case score >= 60:
		riskLevel = "high"
		manualReview = true
		reason = "High fraud risk. Manual review required before processing."
	case score >= 40:
		riskLevel = "medium"
		manualReview = true
		reason = "Medium fraud risk. Transaction flagged for review."
	default:
		riskLevel = "low"
	}

	return &ScoreTransactionResponse{
		Score:        score,
		RiskLevel:    riskLevel,
		Flags:        flags,
		Block:        block,
		ManualReview: manualReview,
		Reason:       reason,
	}
}

// Rules returns all configured fraud rules.
func (f *FraudScorerService) Rules() []*FraudRule {
	return f.rules
}

// buildRules returns the full production rule set.
func buildRules() []*FraudRule {
	return []*FraudRule{
		{
			ID: "R001", Name: "Large Amount", Weight: 20,
			Description: "Transfer amount exceeds $5,000 — elevated risk threshold.",
			Enabled: true,
			Evaluate: func(r *ScoreTransactionRequest) bool { return r.AmountUSD > 5_000 },
		},
		{
			ID: "R002", Name: "Very Large Amount", Weight: 30,
			Description: "Transfer amount exceeds $20,000 — high risk threshold.",
			Enabled: true,
			Evaluate: func(r *ScoreTransactionRequest) bool { return r.AmountUSD > 20_000 },
		},
		{
			ID: "R003", Name: "New Device", Weight: 15,
			Description: "Transfer initiated from a device not previously seen for this user.",
			Enabled: true,
			Evaluate: func(r *ScoreTransactionRequest) bool { return r.IsNewDevice },
		},
		{
			ID: "R004", Name: "New Beneficiary", Weight: 10,
			Description: "Transfer to a beneficiary added within the last 24 hours.",
			Enabled: true,
			Evaluate: func(r *ScoreTransactionRequest) bool { return r.IsNewBeneficiary },
		},
		{
			ID: "R005", Name: "Unusual Hour", Weight: 10,
			Description: "Transfer initiated between 01:00–05:00 local time.",
			Enabled: true,
			Evaluate: func(r *ScoreTransactionRequest) bool {
				return r.HourOfDay >= 1 && r.HourOfDay <= 5
			},
		},
		{
			ID: "R006", Name: "High Velocity", Weight: 25,
			Description: "More than 5 transfers initiated by this user today.",
			Enabled: true,
			Evaluate: func(r *ScoreTransactionRequest) bool { return r.TransfersToday > 5 },
		},
		{
			ID: "R007", Name: "High-Risk Corridor", Weight: 20,
			Description: "Transfer to a jurisdiction on the FATF grey/black list.",
			Enabled: true,
			Evaluate: func(r *ScoreTransactionRequest) bool {
				highRisk := map[string]bool{
					"KP": true, "IR": true, "SY": true, "YE": true, "LY": true,
					"SO": true, "SS": true, "CF": true, "MM": true,
				}
				return highRisk[r.DestCountry]
			},
		},
		{
			ID: "R008", Name: "Round Amount", Weight: 5,
			Description: "Suspiciously round transfer amount (e.g., exactly $1,000, $5,000).",
			Enabled: true,
			Evaluate: func(r *ScoreTransactionRequest) bool {
				return r.AmountUSD >= 1_000 && math.Mod(r.AmountUSD, 1_000) == 0
			},
		},
		{
			ID: "R009", Name: "Crypto Payment Method", Weight: 15,
			Description: "Payment funded via cryptocurrency — higher anonymity risk.",
			Enabled: true,
			Evaluate: func(r *ScoreTransactionRequest) bool {
				return r.PaymentMethod == "crypto"
			},
		},
		{
			ID: "R010", Name: "New Device + New Beneficiary", Weight: 20,
			Description: "Combination of new device AND new beneficiary in the same transaction.",
			Enabled: true,
			Evaluate: func(r *ScoreTransactionRequest) bool {
				return r.IsNewDevice && r.IsNewBeneficiary
			},
		},
	}
}

// ─── Unused import prevention ─────────────────────────────────────────────────
var _ = time.Now // keep time import for future use
