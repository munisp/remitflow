package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

func isSupportedPaymentCurrency(currency string) bool {
	_, ok := map[string]bool{"USD": true, "EUR": true, "GBP": true, "NGN": true, "GHS": true, "KES": true, "ZAR": true}[strings.ToUpper(currency)]
	return ok
}

func generatePaymentIdempotencyKey(merchantID, orderID string, amount float64, currency string) string {
	payload := merchantID + "|" + orderID + "|" + strings.ToUpper(currency) + "|" + formatMoney(amount)
	digest := sha256.Sum256([]byte(payload))
	return "pay_" + hex.EncodeToString(digest[:])
}

func formatMoney(value float64) string {
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.2f", value), "0"), ".")
}

func isValidPaymentStatusTransition(from, to string) bool {
	valid := map[string]map[string]bool{
		"pending": {"processing": true, "cancelled": true},
		"processing": {"completed": true, "failed": true},
		"completed": {"refunded": true},
		"failed": {}, "cancelled": {}, "refunded": {},
	}
	return valid[from][to]
}

func handleCreatePaymentIntent(c *gin.Context) {
	var req struct {
		MerchantID string  `json:"merchantId"`
		Amount     float64 `json:"amount"`
		Currency   string  `json:"currency"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.MerchantID == "" || req.Amount <= 0 || !isSupportedPaymentCurrency(req.Currency) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "merchantId, positive amount, and supported currency are required"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"status": "pending", "idempotency_key": generatePaymentIdempotencyKey(req.MerchantID, "intent", req.Amount, req.Currency)})
}

func handleGetPayment(c *gin.Context) {
	c.JSON(http.StatusNotFound, gin.H{"error": "payment not found", "payment_id": c.Param("id")})
}

func handleCapturePayment(c *gin.Context) {
	c.JSON(http.StatusConflict, gin.H{"error": "payment must be loaded and in processing state before capture", "payment_id": c.Param("id")})
}

func handleCancelPayment(c *gin.Context) {
	c.JSON(http.StatusConflict, gin.H{"error": "payment must be loaded and pending before cancellation", "payment_id": c.Param("id")})
}

func handleBatchPayout(c *gin.Context) {
	var req struct {
		Recipients []struct { AccountID string `json:"accountId"`; Amount float64 `json:"amount"` } `json:"recipients"`
		Currency string `json:"currency"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Recipients) == 0 || len(req.Recipients) > 10_000 || !isSupportedPaymentCurrency(req.Currency) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "1-10000 recipients and a supported currency are required"})
		return
	}
	for _, recipient := range req.Recipients {
		if recipient.AccountID == "" || recipient.Amount <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "every recipient requires accountId and positive amount"})
			return
		}
	}
	c.JSON(http.StatusAccepted, gin.H{"status": "queued", "recipient_count": len(req.Recipients)})
}

func handleMerchantWebhook(c *gin.Context) { deliverWebhook(c) }
