package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type NettingPosition struct {
	Country     string  `json:"country"`
	Currency    string  `json:"currency"`
	GrossDebit  float64 `json:"gross_debit"`
	GrossCredit float64 `json:"gross_credit"`
	NetPosition float64 `json:"net_position"`
}

func isSupportedPAPSSCurrency(currency string) bool {
	_, ok := map[string]bool{"NGN": true, "GHS": true, "KES": true, "TZS": true, "ZMW": true, "RWF": true, "UGX": true, "XOF": true, "XAF": true, "ZWL": true}[strings.ToUpper(currency)]
	return ok
}

func isValidPAPSSCorridor(fromCountry, toCountry string) bool {
	from, to := strings.ToUpper(strings.TrimSpace(fromCountry)), strings.ToUpper(strings.TrimSpace(toCountry))
	if from == "" || to == "" || from == to {
		return false
	}
	if _, ok := PAPSSCorridors[from+"-"+to]; ok {
		return true
	}
	_, ok := PAPSSCorridors[to+"-"+from]
	return ok
}

func validatePAPSSTransferAmount(amount float64, currency string) error {
	if amount <= 0 {
		return fmt.Errorf("amount must be positive")
	}
	if !isSupportedPAPSSCurrency(currency) {
		return fmt.Errorf("unsupported PAPSS currency %s", currency)
	}
	limits := map[string]float64{"NGN": 50_000_000, "GHS": 500_000, "KES": 10_000_000, "TZS": 1_000_000_000, "ZMW": 10_000_000, "RWF": 100_000_000, "UGX": 500_000_000, "XOF": 100_000_000, "XAF": 100_000_000, "ZWL": 1_000_000_000}
	if amount > limits[strings.ToUpper(currency)] {
		return fmt.Errorf("amount exceeds PAPSS daily limit for %s", strings.ToUpper(currency))
	}
	return nil
}

func calculateMultilateralNetting(positions []NettingPosition) map[string]NettingPosition {
	result := make(map[string]NettingPosition, len(positions))
	for _, position := range positions {
		position.NetPosition = position.GrossCredit - position.GrossDebit
		result[position.Country] = position
	}
	return result
}

func generatePAPSSIdempotencyKey(transferID, fromCountry, toCountry string, amount float64) string {
	payload := fmt.Sprintf("%s|%s|%s|%.2f", transferID, strings.ToUpper(fromCountry), strings.ToUpper(toCountry), math.Round(amount*100)/100)
	digest := sha256.Sum256([]byte(payload))
	return "papss_" + hex.EncodeToString(digest[:])
}

func generatePAPSSSettlementRef(fromCountry, toCountry string) string {
	return fmt.Sprintf("PAPSS-%s-%s-%d", strings.ToUpper(fromCountry), strings.ToUpper(toCountry), time.Now().UTC().UnixNano())
}

func getPAPSSAPIURL() string {
	if endpoint := os.Getenv("PAPSS_API_URL"); endpoint != "" {
		return endpoint
	}
	return "https://api.papss.com/v1"
}

func handleInitiateTransfer(c *gin.Context) { initiateTransfer(loadConfig())(c) }
func handleListCorridors(c *gin.Context)   { getCorridors()(c) }
func handleTriggerNetting(c *gin.Context)  { triggerNetting(loadConfig())(c) }

func handleGetTransfer(c *gin.Context) {
	c.JSON(http.StatusNotFound, gin.H{"error": "transfer not found", "transfer_id": c.Param("id")})
}

func handleComplianceScreen(c *gin.Context) {
	var input struct {
		PayerCountry string  `json:"payerCountry"`
		PayeeCountry string  `json:"payeeCountry"`
		Amount       float64 `json:"amount"`
		Currency     string  `json:"currency"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid compliance payload"})
		return
	}
	sanctioned := map[string]bool{"IR": true, "KP": true, "SY": true, "CU": true}
	cleared := !sanctioned[strings.ToUpper(input.PayerCountry)] && !sanctioned[strings.ToUpper(input.PayeeCountry)] && input.Amount <= 40_000_000
	status := "cleared"
	if !cleared {
		status = "review_required"
	}
	c.JSON(http.StatusOK, gin.H{"cleared": cleared, "status": status})
}
