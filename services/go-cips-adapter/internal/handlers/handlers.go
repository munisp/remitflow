// Package handlers — CIPS HTTP handler implementations
package handlers

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/remitflow/cips-adapter/internal/models"
)

// ─── In-memory store (replace with PostgreSQL in production) ──────────────────
var (
	mu           sync.RWMutex
	transfersDB  = map[string]*models.TransferStatus{}
)

var cipsParticipants = []models.CIPSParticipant{
	{BIC: "ICBKCNBJ", Name: "Industrial and Commercial Bank of China", CNAPSCode: "102100099996", Country: "CN", Currency: "CNY", IsActive: true, ParticipantID: "ICBC001"},
	{BIC: "BKCHCNBJ", Name: "Bank of China", CNAPSCode: "104100000004", Country: "CN", Currency: "CNY", IsActive: true, ParticipantID: "BOC001"},
	{BIC: "PCBCCNBJ", Name: "China Construction Bank", CNAPSCode: "105100000017", Country: "CN", Currency: "CNY", IsActive: true, ParticipantID: "CCB001"},
	{BIC: "ABOCCNBJ", Name: "Agricultural Bank of China", CNAPSCode: "103100000026", Country: "CN", Currency: "CNY", IsActive: true, ParticipantID: "ABC001"},
	{BIC: "BCOMCNSH", Name: "Bank of Communications", CNAPSCode: "301290000007", Country: "CN", Currency: "CNY", IsActive: true, ParticipantID: "BOCOM001"},
	{BIC: "CMBCCNBS", Name: "China Merchants Bank", CNAPSCode: "308584000013", Country: "CN", Currency: "CNY", IsActive: true, ParticipantID: "CMB001"},
	{BIC: "HSBCHKHH", Name: "HSBC (Hong Kong)", CNAPSCode: "", Country: "HK", Currency: "CNH", IsActive: true, ParticipantID: "HSBC001"},
	{BIC: "SCBLSGSG", Name: "Standard Chartered Singapore", CNAPSCode: "", Country: "SG", Currency: "CNH", IsActive: true, ParticipantID: "SCB001"},
	{BIC: "REMFFLOW", Name: "RemitFlow Technologies Ltd", CNAPSCode: "999000000001", Country: "CN", Currency: "CNY", IsActive: true, ParticipantID: "REMITFLOW001"},
}

func generateID(prefix string) string {
	b := make([]byte, 8)
	rand.Read(b)
	return fmt.Sprintf("%s%d%s", prefix, time.Now().UnixMilli(), hex.EncodeToString(b)[:8])
}

func verifyHMAC(payload, signature, secret string) bool {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

// ─── Health ────────────────────────────────────────────────────────────────────
func Health(c *gin.Context) {
	c.JSON(http.StatusOK, models.HealthResponse{
		Status:    "healthy",
		Service:   "cips-adapter",
		Version:   "v110.0.0",
		Timestamp: time.Now().UTC(),
		Checks: map[string]string{
			"cips_switch":    "connected",
			"database":       "connected",
			"compliance_api": "connected",
		},
	})
}

func Ready(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"ready": true})
}

func Metrics(c *gin.Context) {
	mu.RLock()
	count := len(transfersDB)
	mu.RUnlock()
	c.JSON(http.StatusOK, gin.H{
		"total_transfers":    count,
		"service":            "cips-adapter",
		"uptime_seconds":     time.Since(startTime).Seconds(),
	})
}

var startTime = time.Now()

// ─── Participants ──────────────────────────────────────────────────────────────
func ListParticipants(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"participants": cipsParticipants,
		"total":        len(cipsParticipants),
	})
}

func GetParticipant(c *gin.Context) {
	bic := c.Param("bic")
	for _, p := range cipsParticipants {
		if p.BIC == bic {
			c.JSON(http.StatusOK, p)
			return
		}
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "Participant not found", "bic": bic})
}

// ─── Account Lookup ────────────────────────────────────────────────────────────
func LookupAccount(c *gin.Context) {
	var req models.AccountLookupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Find participant by BIC
	var bankName string
	for _, p := range cipsParticipants {
		if p.BIC == req.BankBIC {
			bankName = p.Name
			break
		}
	}
	if bankName == "" {
		bankName = "Unknown Bank"
	}

	// In production: call CIPS Switch party lookup API with mTLS
	// Sandbox: return mock verified account
	c.JSON(http.StatusOK, models.AccountLookupResponse{
		Found:       true,
		AccountName: "张伟 (Zhang Wei)",
		BankName:    bankName,
		BankBIC:     req.BankBIC,
		CNAPSCode:   req.CNAPSCode,
		Currency:    "CNY",
		Country:     "CN",
		Verified:    true,
	})
}

// ─── Transfer Initiation (pacs.008) ───────────────────────────────────────────
func InitiateTransfer(c *gin.Context) {
	var req models.TransferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	txID := generateID("CIPS")
	msgID := fmt.Sprintf("REMITFLOW%s%s", time.Now().Format("20060102"), txID[4:12])

	// AML / Sanctions check
	if req.Amount > 50000 {
		// High-value transfers require enhanced due diligence
		c.Header("X-EDD-Required", "true")
	}

	// Calculate CIPS fee (0.1% of amount, min 10 CNY, max 500 CNY)
	fee := math.Max(10, math.Min(500, req.Amount*0.001))

	// Estimated settlement: CIPS operates 05:00-20:00 CST, T+0 same day
	now := time.Now().UTC()
	settlementTime := now.Add(2 * time.Hour)

	// Build ISO 20022 pacs.008 message (simplified)
	pacs008 := map[string]interface{}{
		"msgId":   msgID,
		"creDtTm": now.Format(time.RFC3339),
		"nbOfTxs": 1,
		"ctrlSum": fmt.Sprintf("%.2f", req.Amount),
		"grpHdr": map[string]interface{}{
			"initgPty": map[string]string{
				"nm": "RemitFlow Technologies Ltd",
				"id": os.Getenv("CIPS_PARTICIPANT_ID"),
			},
		},
		"cdtTrfTxInf": map[string]interface{}{
			"pmtId": map[string]string{
				"instrId":    txID,
				"endToEndId": req.Reference,
			},
			"amt": map[string]interface{}{
				"instdAmt": map[string]string{
					"ccy":   req.Currency,
					"value": fmt.Sprintf("%.2f", req.Amount),
				},
			},
			"cdtrAgt": map[string]interface{}{
				"finInstnId": map[string]string{"bicfi": req.PayeeBIC},
			},
			"cdtr": map[string]interface{}{
				"nm":     req.PayeeName,
				"pstlAdr": map[string]string{"ctry": req.PayeeCountry},
			},
			"cdtrAcct": map[string]interface{}{
				"id": map[string]interface{}{
					"othr": map[string]string{"id": req.PayeeAccount},
				},
			},
			"purp": map[string]string{"cd": req.Purpose},
			"rmtInf": map[string]string{"ustrd": req.Note},
		},
	}

	// Store transfer state
	status := &models.TransferStatus{
		TransactionID:     txID,
		MsgID:             msgID,
		Status:            "ACCP", // Accepted Customer Profile
		StatusDescription: "Transfer accepted by CIPS Switch, pending settlement",
		UpdatedAt:         now,
	}
	mu.Lock()
	transfersDB[txID] = status
	mu.Unlock()

	// In production: POST to CIPS Switch with mTLS + HMAC-SHA256 signature
	// Simulate async settlement after 2 seconds (sandbox)
	go func() {
		time.Sleep(2 * time.Second)
		mu.Lock()
		if s, ok := transfersDB[txID]; ok {
			s.Status = "ACSC" // Accepted Settlement Completed
			s.StatusDescription = "Transfer settled successfully via CIPS"
			settled := time.Now().UTC()
			s.SettledAt = &settled
			s.UpdatedAt = time.Now().UTC()
		}
		mu.Unlock()
	}()

	c.JSON(http.StatusCreated, models.TransferResponse{
		TransactionID:       txID,
		MsgID:               msgID,
		Status:              "ACCP",
		StatusDescription:   "Transfer accepted by CIPS Switch",
		EstimatedSettlement: settlementTime,
		FeeAmount:           fee,
		FeeCurrency:         req.Currency,
		ExchangeRate:        0, // CNY-to-CNY, no FX
		CreatedAt:           now,
	})

	_ = pacs008 // Used in production CIPS API call
}

// ─── Transfer Status (pacs.002) ───────────────────────────────────────────────
func GetTransferStatus(c *gin.Context) {
	txID := c.Param("id")
	mu.RLock()
	status, ok := transfersDB[txID]
	mu.RUnlock()
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Transfer not found", "transaction_id": txID})
		return
	}
	c.JSON(http.StatusOK, status)
}

func ListTransfers(c *gin.Context) {
	mu.RLock()
	list := make([]*models.TransferStatus, 0, len(transfersDB))
	for _, v := range transfersDB {
		list = append(list, v)
	}
	mu.RUnlock()
	c.JSON(http.StatusOK, gin.H{"transfers": list, "total": len(list)})
}

// ─── Transfer Cancellation (camt.056) ─────────────────────────────────────────
func CancelTransfer(c *gin.Context) {
	txID := c.Param("id")
	var req models.CancellationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	mu.Lock()
	defer mu.Unlock()
	status, ok := transfersDB[txID]
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Transfer not found"})
		return
	}
	if status.Status == "ACSC" {
		c.JSON(http.StatusConflict, models.CancellationResponse{
			TransactionID: txID,
			Accepted:      false,
			Message:       "Cannot cancel: transfer already settled",
		})
		return
	}
	status.Status = "RJCT"
	status.StatusDescription = "Cancelled: " + req.Reason
	status.UpdatedAt = time.Now().UTC()

	c.JSON(http.StatusOK, models.CancellationResponse{
		TransactionID: txID,
		Accepted:      true,
		Message:       "Cancellation request submitted to CIPS Switch",
	})
}

// ─── Settlement ────────────────────────────────────────────────────────────────
func GetSettlementWindows(c *gin.Context) {
	now := time.Now().UTC()
	windows := []models.SettlementWindow{
		{
			WindowID:    fmt.Sprintf("SW%s01", now.Format("20060102")),
			OpenTime:    time.Date(now.Year(), now.Month(), now.Day(), 5, 0, 0, 0, time.UTC),
			CloseTime:   time.Date(now.Year(), now.Month(), now.Day(), 9, 0, 0, 0, time.UTC),
			Status:      "CLOSED",
			TotalAmount: 45_230_000.00,
			Currency:    "CNY",
			TxCount:     1247,
		},
		{
			WindowID:    fmt.Sprintf("SW%s02", now.Format("20060102")),
			OpenTime:    time.Date(now.Year(), now.Month(), now.Day(), 9, 0, 0, 0, time.UTC),
			CloseTime:   time.Date(now.Year(), now.Month(), now.Day(), 14, 0, 0, 0, time.UTC),
			Status:      "OPEN",
			TotalAmount: 128_450_000.00,
			Currency:    "CNY",
			TxCount:     3891,
		},
		{
			WindowID:    fmt.Sprintf("SW%s03", now.Format("20060102")),
			OpenTime:    time.Date(now.Year(), now.Month(), now.Day(), 14, 0, 0, 0, time.UTC),
			CloseTime:   time.Date(now.Year(), now.Month(), now.Day(), 20, 0, 0, 0, time.UTC),
			Status:      "PENDING",
			TotalAmount: 0,
			Currency:    "CNY",
			TxCount:     0,
		},
	}
	c.JSON(http.StatusOK, gin.H{"windows": windows})
}

func ConfirmSettlement(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"confirmed": true, "message": "Settlement window confirmed"})
}

// ─── Compliance ────────────────────────────────────────────────────────────────
func ScreenTransaction(c *gin.Context) {
	var req models.ComplianceScreenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	riskScore := 0.05
	flags := []string{}

	// High-value threshold (PBOC reporting: >200,000 CNY)
	if req.Amount > 200000 {
		riskScore += 0.3
		flags = append(flags, "HIGH_VALUE_TRANSACTION")
	}
	// Cross-border (non-CN to CN)
	if req.PayerCountry != "CN" && req.PayeeCountry == "CN" {
		riskScore += 0.1
		flags = append(flags, "CROSS_BORDER_INBOUND")
	}
	// Sanctioned countries check (simplified)
	sanctionedCountries := map[string]bool{"KP": true, "IR": true, "CU": true, "SY": true}
	if sanctionedCountries[req.PayerCountry] || sanctionedCountries[req.PayeeCountry] {
		riskScore = 1.0
		flags = append(flags, "SANCTIONED_COUNTRY")
	}

	riskLevel := "LOW"
	if riskScore > 0.7 {
		riskLevel = "CRITICAL"
	} else if riskScore > 0.4 {
		riskLevel = "HIGH"
	} else if riskScore > 0.2 {
		riskLevel = "MEDIUM"
	}

	c.JSON(http.StatusOK, models.ComplianceScreenResult{
		Cleared:      riskScore < 0.7,
		RiskScore:    riskScore,
		RiskLevel:    riskLevel,
		Flags:        flags,
		RequiresKYC:  req.Amount > 50000,
		RequiresSAR:  riskScore > 0.5,
		SanctionsHit: riskScore >= 1.0,
		PEPMatch:     false,
		Message:      fmt.Sprintf("AML screening complete. Risk: %s (%.2f)", riskLevel, riskScore),
	})
}

func CheckSanctions(c *gin.Context) {
	name := c.Param("name")
	// In production: query OFAC SDN, UN Consolidated, EU Consolidated lists
	c.JSON(http.StatusOK, gin.H{
		"name":          name,
		"sanctions_hit": false,
		"pep_match":     false,
		"lists_checked": []string{"OFAC_SDN", "UN_CONSOLIDATED", "EU_CONSOLIDATED", "PBOC_BLACKLIST"},
		"checked_at":    time.Now().UTC(),
	})
}

// ─── Callbacks ────────────────────────────────────────────────────────────────
func HandlePacs002Callback(c *gin.Context) {
	var cb models.Pacs002Callback
	if err := c.ShouldBindJSON(&cb); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify HMAC signature from CIPS Switch
	secret := os.Getenv("CIPS_WEBHOOK_SECRET")
	if secret == "" {
		secret = os.Getenv("CIPS_WEBHOOK_SECRET_FALLBACK")
	}
	payload := fmt.Sprintf("%s:%s:%s", cb.MsgID, cb.TransactionID, cb.Status)
	if !verifyHMAC(payload, cb.Signature, secret) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid HMAC signature"})
		return
	}

	mu.Lock()
	if status, ok := transfersDB[cb.TransactionID]; ok {
		status.Status = cb.Status
		status.StatusDescription = cb.StatusReason
		status.UpdatedAt = time.Now().UTC()
		if cb.Status == "ACSC" {
			settled := time.Now().UTC()
			status.SettledAt = &settled
		}
	}
	mu.Unlock()

	c.JSON(http.StatusOK, gin.H{"acknowledged": true})
}

func HandleCamt056Callback(c *gin.Context) {
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"acknowledged": true, "type": "camt.056"})
}
