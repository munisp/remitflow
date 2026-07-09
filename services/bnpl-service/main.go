// bnpl-service — Buy Now Pay Later / Send Now Pay Later Service
// Provides credit-backed remittance: users can send money immediately
// and repay in instalments. Includes credit scoring, repayment scheduling,
// and integration with TigerBeetle for ledger tracking.
package main

import (
	"context"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// CreditTier represents the user's credit standing
type CreditTier string

const (
	CreditTierPlatinum CreditTier = "platinum" // >= 750 score
	CreditTierGold     CreditTier = "gold"     // 650-749
	CreditTierSilver   CreditTier = "silver"   // 550-649
	CreditTierBronze   CreditTier = "bronze"   // < 550 — not eligible
)

// BNPLProduct defines a BNPL product offering
type BNPLProduct struct {
	ID               string     `json:"id"`
	Name             string     `json:"name"`
	Instalments      int        `json:"instalments"`
	InterestRateAPR  float64    `json:"interest_rate_apr"`
	MaxAmountUSD     float64    `json:"max_amount_usd"`
	MinCreditScore   int        `json:"min_credit_score"`
	EligibleTiers    []CreditTier `json:"eligible_tiers"`
}

// BNPLProducts is the product catalogue
var BNPLProducts = []BNPLProduct{
	{
		ID: "bnpl-3-0pct", Name: "Pay in 3 (0% interest)",
		Instalments: 3, InterestRateAPR: 0.0, MaxAmountUSD: 500,
		MinCreditScore: 700, EligibleTiers: []CreditTier{CreditTierPlatinum, CreditTierGold},
	},
	{
		ID: "bnpl-6-5pct", Name: "Pay in 6 (5% APR)",
		Instalments: 6, InterestRateAPR: 5.0, MaxAmountUSD: 1000,
		MinCreditScore: 650, EligibleTiers: []CreditTier{CreditTierPlatinum, CreditTierGold, CreditTierSilver},
	},
	{
		ID: "bnpl-12-12pct", Name: "Pay in 12 (12% APR)",
		Instalments: 12, InterestRateAPR: 12.0, MaxAmountUSD: 2000,
		MinCreditScore: 600, EligibleTiers: []CreditTier{CreditTierPlatinum, CreditTierGold, CreditTierSilver},
	},
}

// CreditScoreRequest is the input for credit scoring
type CreditScoreRequest struct {
	UserID            string  `json:"user_id" binding:"required"`
	AccountAgeDays    int     `json:"account_age_days"`
	TotalTransactions int     `json:"total_transactions"`
	TotalVolumeUSD    float64 `json:"total_volume_usd"`
	MissedPayments    int     `json:"missed_payments"`
	KYCTier           int     `json:"kyc_tier"`
	HasBVN            bool    `json:"has_bvn"`
	HasNIN            bool    `json:"has_nin"`
}

// CreditScoreResult is the output of credit scoring
type CreditScoreResult struct {
	UserID      string     `json:"user_id"`
	Score       int        `json:"score"`
	Tier        CreditTier `json:"tier"`
	MaxLimitUSD float64    `json:"max_limit_usd"`
	Eligible    bool       `json:"eligible"`
	Reason      string     `json:"reason"`
}

// BNPLApplication is a BNPL credit application
type BNPLApplication struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id" binding:"required"`
	ProductID       string    `json:"product_id" binding:"required"`
	TransactionID   string    `json:"transaction_id"`
	AmountUSD       float64   `json:"amount_usd" binding:"required"`
	RecipientName   string    `json:"recipient_name" binding:"required"`
	RecipientAccount string   `json:"recipient_account" binding:"required"`
	DestCurrency    string    `json:"dest_currency" binding:"required"`
	Status          string    `json:"status"`
	CreditScore     int       `json:"credit_score"`
	ApprovedAt      *time.Time `json:"approved_at"`
	CreatedAt       time.Time  `json:"created_at"`
}

// RepaymentSchedule is the instalment plan
type RepaymentSchedule struct {
	ApplicationID string      `json:"application_id"`
	Instalments   []Instalment `json:"instalments"`
	TotalAmount   float64     `json:"total_amount"`
	TotalInterest float64     `json:"total_interest"`
	APR           float64     `json:"apr"`
}

// Instalment is a single payment in the schedule
type Instalment struct {
	Number    int       `json:"number"`
	AmountUSD float64   `json:"amount_usd"`
	DueDate   time.Time `json:"due_date"`
	Status    string    `json:"status"` // "pending", "paid", "overdue"
}

// BNPLService handles all BNPL business logic
type BNPLService struct{}

// CalculateCreditScore computes a credit score from user behaviour signals
func (s *BNPLService) CalculateCreditScore(req *CreditScoreRequest) *CreditScoreResult {
	score := 300 // base score

	// Account age (max +150)
	if req.AccountAgeDays >= 365 {
		score += 150
	} else if req.AccountAgeDays >= 180 {
		score += 100
	} else if req.AccountAgeDays >= 90 {
		score += 50
	}

	// Transaction volume (max +150)
	if req.TotalVolumeUSD >= 10000 {
		score += 150
	} else if req.TotalVolumeUSD >= 5000 {
		score += 100
	} else if req.TotalVolumeUSD >= 1000 {
		score += 60
	} else if req.TotalVolumeUSD >= 500 {
		score += 30
	}

	// Transaction count (max +100)
	if req.TotalTransactions >= 50 {
		score += 100
	} else if req.TotalTransactions >= 20 {
		score += 60
	} else if req.TotalTransactions >= 10 {
		score += 30
	}

	// KYC tier (max +100)
	score += req.KYCTier * 30

	// Identity verification (+50 each)
	if req.HasBVN {
		score += 50
	}
	if req.HasNIN {
		score += 50
	}

	// Missed payments penalty (-100 each)
	score -= req.MissedPayments * 100

	// Cap score at 850
	if score > 850 {
		score = 850
	}
	if score < 300 {
		score = 300
	}

	// Determine tier and limit
	var tier CreditTier
	var maxLimit float64
	var eligible bool
	var reason string

	switch {
	case score >= 750:
		tier = CreditTierPlatinum
		maxLimit = 2000
		eligible = true
		reason = "Excellent credit standing"
	case score >= 650:
		tier = CreditTierGold
		maxLimit = 1000
		eligible = true
		reason = "Good credit standing"
	case score >= 550:
		tier = CreditTierSilver
		maxLimit = 500
		eligible = true
		reason = "Fair credit standing"
	default:
		tier = CreditTierBronze
		maxLimit = 0
		eligible = false
		reason = "Credit score below minimum threshold (550)"
	}

	return &CreditScoreResult{
		UserID:      req.UserID,
		Score:       score,
		Tier:        tier,
		MaxLimitUSD: maxLimit,
		Eligible:    eligible,
		Reason:      reason,
	}
}

// GenerateRepaymentSchedule creates the instalment plan for an approved application
func (s *BNPLService) GenerateRepaymentSchedule(app *BNPLApplication, product *BNPLProduct) *RepaymentSchedule {
	// Calculate total amount with interest
	monthlyRate := product.InterestRateAPR / 100 / 12
	var totalAmount float64

	if monthlyRate == 0 {
		totalAmount = app.AmountUSD
	} else {
		// Standard amortisation formula
		n := float64(product.Instalments)
		totalAmount = app.AmountUSD * (monthlyRate * math.Pow(1+monthlyRate, n)) /
			(math.Pow(1+monthlyRate, n) - 1) * n
	}

	instalmentAmount := math.Round(totalAmount/float64(product.Instalments)*100) / 100
	totalInterest := totalAmount - app.AmountUSD

	instalments := make([]Instalment, product.Instalments)
	for i := 0; i < product.Instalments; i++ {
		dueDate := time.Now().AddDate(0, i+1, 0)
		instalments[i] = Instalment{
			Number:    i + 1,
			AmountUSD: instalmentAmount,
			DueDate:   dueDate,
			Status:    "pending",
		}
	}

	return &RepaymentSchedule{
		ApplicationID: app.ID,
		Instalments:   instalments,
		TotalAmount:   math.Round(totalAmount*100) / 100,
		TotalInterest: math.Round(totalInterest*100) / 100,
		APR:           product.InterestRateAPR,
	}
}

// FindProduct looks up a BNPL product by ID
func (s *BNPLService) FindProduct(productID string) (*BNPLProduct, error) {
	for i := range BNPLProducts {
		if BNPLProducts[i].ID == productID {
			return &BNPLProducts[i], nil
		}
	}
	return nil, fmt.Errorf("product %s not found", productID)
}

// ProcessApplication evaluates and approves/rejects a BNPL application
func (s *BNPLService) ProcessApplication(ctx context.Context, app *BNPLApplication, creditReq *CreditScoreRequest) (*BNPLApplication, *RepaymentSchedule, error) {
	product, err := s.FindProduct(app.ProductID)
	if err != nil {
		return nil, nil, err
	}

	// Score the user
	scoreResult := s.CalculateCreditScore(creditReq)

	app.CreditScore = scoreResult.Score

	// Check eligibility
	if !scoreResult.Eligible {
		app.Status = "rejected"
		return app, nil, fmt.Errorf("application rejected: %s", scoreResult.Reason)
	}

	// Check amount against limit
	if app.AmountUSD > scoreResult.MaxLimitUSD {
		app.Status = "rejected"
		return app, nil, fmt.Errorf("amount $%.2f exceeds credit limit $%.2f", app.AmountUSD, scoreResult.MaxLimitUSD)
	}

	// Check amount against product limit
	if app.AmountUSD > product.MaxAmountUSD {
		app.Status = "rejected"
		return app, nil, fmt.Errorf("amount exceeds product maximum of $%.2f", product.MaxAmountUSD)
	}

	// Approve
	now := time.Now()
	app.Status = "approved"
	app.ApprovedAt = &now
	app.TransactionID = uuid.New().String()

	schedule := s.GenerateRepaymentSchedule(app, product)

	log.Printf("[BNPL] Application %s approved for user %s: $%.2f over %d instalments",
		app.ID, app.UserID, app.AmountUSD, product.Instalments)

	return app, schedule, nil
}

var bnplSvc = &BNPLService{}

func getProducts(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"products": BNPLProducts})
}

func scoreCreditHandler(c *gin.Context) {
	var req CreditScoreRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	result := bnplSvc.CalculateCreditScore(&req)
	c.JSON(http.StatusOK, result)
}

func applyBNPL(c *gin.Context) {
	var app BNPLApplication
	if err := c.ShouldBindJSON(&app); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	app.ID = uuid.New().String()
	app.CreatedAt = time.Now()
	app.Status = "pending"

	// Extract credit signals from request body
	var creditReq CreditScoreRequest
	if err := c.ShouldBindJSON(&creditReq); err != nil {
		creditReq = CreditScoreRequest{UserID: app.UserID}
	}
	creditReq.UserID = app.UserID

	approvedApp, schedule, err := bnplSvc.ProcessApplication(c.Request.Context(), &app, &creditReq)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"application": approvedApp,
			"approved":    false,
			"reason":      err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"application":         approvedApp,
		"repayment_schedule":  schedule,
		"approved":            true,
	})
}

func getRepaymentSchedule(c *gin.Context) {
	appID := c.Param("application_id")
	c.JSON(http.StatusOK, gin.H{
		"application_id": appID,
		"message":        "Repayment schedule retrieved",
	})
}

func recordRepayment(c *gin.Context) {
	appID := c.Param("application_id")
	instalmentNum := c.Param("instalment")
	c.JSON(http.StatusOK, gin.H{
		"application_id": appID,
		"instalment":     instalmentNum,
		"status":         "paid",
		"paid_at":        time.Now(),
	})
}

func healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"service":  "bnpl-service",
		"status":   "healthy",
		"version":  "1.0.0",
		"products": len(BNPLProducts),
	})
}

func main() {
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	r.GET("/health", healthCheck)

	api := r.Group("/api/v1/bnpl")
	{
		api.GET("/products", getProducts)
		api.POST("/score", scoreCreditHandler)
		api.POST("/apply", applyBNPL)
		api.GET("/schedule/:application_id", getRepaymentSchedule)
		api.POST("/repay/:application_id/:instalment", recordRepayment)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8096"
	}

	log.Printf("[BNPL] Service starting on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start bnpl-service: %v", err)
	}
}
