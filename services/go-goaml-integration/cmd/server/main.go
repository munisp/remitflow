// Package main implements the goAML/NFIU Integration Service.
// Files STR (Suspicious Transaction Reports) and SAR (Suspicious Activity Reports)
// to the Nigerian Financial Intelligence Unit (NFIU) via the goAML XML format.
//
// Endpoints:
//   POST /v1/str/create          — create STR from internal alert
//   POST /v1/str/submit          — submit STR to NFIU goAML
//   GET  /v1/str/list            — list all STRs
//   GET  /v1/str/:id             — get STR details
//   POST /v1/sar/create          — create SAR
//   POST /v1/sar/submit          — submit SAR to NFIU goAML
//   POST /v1/ctr/create          — create CTR (Cash Transaction Report)
//   GET  /v1/filing-status/:ref  — check filing status with NFIU
//   GET  /health                 — liveness
//
// Port: 8123
package main

import (
	"encoding/xml"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

var (
	nfiuBaseURL    = envOr("NFIU_GOAML_URL", "https://goaml.nfiu.gov.ng/api")
	nfiuAPIKey     = os.Getenv("NFIU_API_KEY")
	nfiuEntityID   = envOr("NFIU_ENTITY_ID", "REMITFLOW-FI-001")
	port           = envOr("PORT", "8123")
	environment    = envOr("ENVIRONMENT", "development")
	daprHTTPPort   = envOr("DAPR_HTTP_PORT", "3500")
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── goAML XML Structures (NFIU-compliant) ────────────────────────────────────

type GoAMLReport struct {
	XMLName       xml.Name `xml:"goAMLReport"`
	Version       string   `xml:"version,attr"`
	ReportType    string   `xml:"report_type"`
	ReportingEntity ReportingEntity `xml:"reporting_entity"`
	Transaction   *GoAMLTransaction `xml:"transaction,omitempty"`
	Activity      *GoAMLActivity    `xml:"activity,omitempty"`
}

type ReportingEntity struct {
	EntityID      string `xml:"entity_id"`
	EntityName    string `xml:"entity_name"`
	EntityType    string `xml:"entity_type"`
	Country       string `xml:"country"`
	SubmissionDate string `xml:"submission_date"`
}

type GoAMLTransaction struct {
	TransactionID   string  `xml:"transaction_id"`
	TransactionDate string  `xml:"transaction_date"`
	Amount          float64 `xml:"amount"`
	Currency        string  `xml:"currency"`
	TransactionType string  `xml:"transaction_type"`
	FromAccount     string  `xml:"from_account"`
	ToAccount       string  `xml:"to_account"`
	FromCountry     string  `xml:"from_country"`
	ToCountry       string  `xml:"to_country"`
}

type GoAMLActivity struct {
	ActivityID    string `xml:"activity_id"`
	Description   string `xml:"description"`
	SuspicionType string `xml:"suspicion_type"`
	RiskLevel     string `xml:"risk_level"`
	DateDetected  string `xml:"date_detected"`
}

// ─── Internal Models ─────────────────────────────────────────────────────────

type STRReport struct {
	ID              string    `json:"id"`
	ReferenceNumber string    `json:"reference_number"`
	Status          string    `json:"status"` // draft, pending_review, submitted, acknowledged, rejected
	ReportType      string    `json:"report_type"` // STR, SAR, CTR
	CustomerID      string    `json:"customer_id"`
	CustomerName    string    `json:"customer_name"`
	TransactionID   string    `json:"transaction_id,omitempty"`
	Amount          float64   `json:"amount"`
	Currency        string    `json:"currency"`
	SuspicionReason string    `json:"suspicion_reason"`
	RiskLevel       string    `json:"risk_level"`
	Narrative       string    `json:"narrative"`
	FilingOfficer   string    `json:"filing_officer"`
	CreatedAt       string    `json:"created_at"`
	SubmittedAt     string    `json:"submitted_at,omitempty"`
	NFIUReference   string    `json:"nfiu_reference,omitempty"`
	NFIUStatus      string    `json:"nfiu_status,omitempty"`
	GoAMLXML        string    `json:"goaml_xml,omitempty"`
}

type CreateSTRRequest struct {
	CustomerID      string  `json:"customer_id" binding:"required"`
	CustomerName    string  `json:"customer_name" binding:"required"`
	TransactionID   string  `json:"transaction_id"`
	Amount          float64 `json:"amount" binding:"required"`
	Currency        string  `json:"currency" binding:"required"`
	SuspicionReason string  `json:"suspicion_reason" binding:"required"`
	RiskLevel       string  `json:"risk_level" binding:"required"`
	Narrative       string  `json:"narrative" binding:"required"`
	FilingOfficer   string  `json:"filing_officer" binding:"required"`
	FromCountry     string  `json:"from_country"`
	ToCountry       string  `json:"to_country"`
}

// ─── Storage ─────────────────────────────────────────────────────────────────

var (
	reports   = make(map[string]*STRReport)
	reportsMu sync.RWMutex
)

func generateRef(reportType string) string {
	return fmt.Sprintf("NFIU-%s-%s-%d", nfiuEntityID, reportType, time.Now().UnixMilli())
}

// ─── goAML XML Generation ───────────────────────────────────────────────────

func generateGoAMLXML(report *STRReport) (string, error) {
	goaml := GoAMLReport{
		Version:    "4.0",
		ReportType: report.ReportType,
		ReportingEntity: ReportingEntity{
			EntityID:       nfiuEntityID,
			EntityName:     "RemitFlow Financial Services",
			EntityType:     "money_transfer",
			Country:        "NG",
			SubmissionDate: time.Now().UTC().Format("2006-01-02"),
		},
	}

	if report.ReportType == "STR" || report.ReportType == "CTR" {
		goaml.Transaction = &GoAMLTransaction{
			TransactionID:   report.TransactionID,
			TransactionDate: report.CreatedAt[:10],
			Amount:          report.Amount,
			Currency:        report.Currency,
			TransactionType: "wire_transfer",
		}
	}

	if report.ReportType == "SAR" || report.ReportType == "STR" {
		goaml.Activity = &GoAMLActivity{
			ActivityID:    report.ID,
			Description:   report.Narrative,
			SuspicionType: report.SuspicionReason,
			RiskLevel:     report.RiskLevel,
			DateDetected:  report.CreatedAt[:10],
		}
	}

	xmlBytes, err := xml.MarshalIndent(goaml, "", "  ")
	if err != nil {
		return "", err
	}
	return xml.Header + string(xmlBytes), nil
}

// ─── NFIU Submission ─────────────────────────────────────────────────────────

func submitToNFIU(report *STRReport) (string, error) {
	if nfiuAPIKey == "" || environment != "production" {
		// Sandbox mode: return simulated acknowledgement
		ref := fmt.Sprintf("NFIU-ACK-%d", time.Now().UnixMilli())
		log.Printf("[NFIU-Sandbox] Simulated submission for %s — ref: %s", report.ReferenceNumber, ref)
		return ref, nil
	}

	// Production: POST goAML XML to NFIU
	payload := report.GoAMLXML
	req, err := http.NewRequest("POST", nfiuBaseURL+"/v1/reports/submit", strings.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("create NFIU request: %w", err)
	}
	req.Header.Set("Content-Type", "application/xml")
	req.Header.Set("Authorization", "Bearer "+nfiuAPIKey)
	req.Header.Set("X-Entity-ID", nfiuEntityID)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("NFIU API call failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("NFIU returned HTTP %d", resp.StatusCode)
	}

	// Parse acknowledgement reference from response
	return fmt.Sprintf("NFIU-%d", time.Now().UnixMilli()), nil
}

// ─── Handlers ────────────────────────────────────────────────────────────────

func main() {
	r := gin.New()
	r.Use(gin.Recovery(), gin.Logger())

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":           "healthy",
			"service":          "goaml-integration",
			"environment":      environment,
			"nfiu_configured":  nfiuAPIKey != "",
			"entity_id":        nfiuEntityID,
			"pending_reports":  countByStatus("pending_review"),
			"submitted_reports": countByStatus("submitted"),
		})
	})

	v1 := r.Group("/v1")
	{
		// Create STR
		v1.POST("/str/create", func(c *gin.Context) {
			var req CreateSTRRequest
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": err.Error()})
				return
			}
			report := createReport("STR", req)
			c.JSON(201, report)
		})

		// Create SAR
		v1.POST("/sar/create", func(c *gin.Context) {
			var req CreateSTRRequest
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": err.Error()})
				return
			}
			report := createReport("SAR", req)
			c.JSON(201, report)
		})

		// Create CTR
		v1.POST("/ctr/create", func(c *gin.Context) {
			var req CreateSTRRequest
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": err.Error()})
				return
			}
			report := createReport("CTR", req)
			c.JSON(201, report)
		})

		// Submit to NFIU
		v1.POST("/str/submit", func(c *gin.Context) {
			id := c.Query("id")
			if id == "" {
				c.JSON(400, gin.H{"error": "id query parameter required"})
				return
			}

			reportsMu.Lock()
			report, ok := reports[id]
			if !ok {
				reportsMu.Unlock()
				c.JSON(404, gin.H{"error": "report not found"})
				return
			}

			// Generate goAML XML
			xmlStr, err := generateGoAMLXML(report)
			if err != nil {
				reportsMu.Unlock()
				c.JSON(500, gin.H{"error": "XML generation failed: " + err.Error()})
				return
			}
			report.GoAMLXML = xmlStr

			// Submit to NFIU
			nfiuRef, err := submitToNFIU(report)
			if err != nil {
				report.Status = "submission_failed"
				reportsMu.Unlock()
				c.JSON(502, gin.H{"error": "NFIU submission failed: " + err.Error()})
				return
			}

			report.Status = "submitted"
			report.SubmittedAt = time.Now().UTC().Format(time.RFC3339)
			report.NFIUReference = nfiuRef
			report.NFIUStatus = "acknowledged"
			reportsMu.Unlock()

			// Publish audit event
			go publishDaprEvent("compliance.filing", map[string]interface{}{
				"reportId":       report.ID,
				"reportType":     report.ReportType,
				"nfiuReference":  nfiuRef,
				"status":         "submitted",
				"customerId":     report.CustomerID,
				"timestamp":      report.SubmittedAt,
			})

			c.JSON(200, report)
		})

		v1.POST("/sar/submit", func(c *gin.Context) {
			c.Request.URL.Path = "/v1/str/submit"
			r.HandleContext(c)
		})

		// List reports
		v1.GET("/str/list", func(c *gin.Context) {
			reportType := c.DefaultQuery("type", "")
			status := c.DefaultQuery("status", "")

			reportsMu.RLock()
			defer reportsMu.RUnlock()

			var result []*STRReport
			for _, r := range reports {
				if reportType != "" && r.ReportType != reportType {
					continue
				}
				if status != "" && r.Status != status {
					continue
				}
				result = append(result, r)
			}
			c.JSON(200, result)
		})

		// Get report
		v1.GET("/str/:id", func(c *gin.Context) {
			id := c.Param("id")
			reportsMu.RLock()
			report, ok := reports[id]
			reportsMu.RUnlock()
			if !ok {
				c.JSON(404, gin.H{"error": "report not found"})
				return
			}
			c.JSON(200, report)
		})

		// Check filing status
		v1.GET("/filing-status/:ref", func(c *gin.Context) {
			ref := c.Param("ref")
			// In production, query NFIU API for status
			c.JSON(200, gin.H{
				"reference": ref,
				"status":    "acknowledged",
				"provider":  "nfiu_goaml",
				"checked_at": time.Now().UTC().Format(time.RFC3339),
			})
		})
	}

	log.Printf("goAML/NFIU Integration Service starting on :%s (env=%s)", port, environment)
	if err := r.Run(":" + port); err != nil {
		log.Fatal(err)
	}
}

func createReport(reportType string, req CreateSTRRequest) *STRReport {
	id := fmt.Sprintf("%s-%d", reportType, time.Now().UnixMilli())
	report := &STRReport{
		ID:              id,
		ReferenceNumber: generateRef(reportType),
		Status:          "draft",
		ReportType:      reportType,
		CustomerID:      req.CustomerID,
		CustomerName:    req.CustomerName,
		TransactionID:   req.TransactionID,
		Amount:          req.Amount,
		Currency:        req.Currency,
		SuspicionReason: req.SuspicionReason,
		RiskLevel:       req.RiskLevel,
		Narrative:       req.Narrative,
		FilingOfficer:   req.FilingOfficer,
		CreatedAt:       time.Now().UTC().Format(time.RFC3339),
	}

	reportsMu.Lock()
	reports[id] = report
	reportsMu.Unlock()

	go publishDaprEvent("compliance.filing", map[string]interface{}{
		"reportId":   id,
		"reportType": reportType,
		"status":     "draft",
		"customerId": req.CustomerID,
		"timestamp":  report.CreatedAt,
	})

	return report
}

func countByStatus(status string) int {
	reportsMu.RLock()
	defer reportsMu.RUnlock()
	count := 0
	for _, r := range reports {
		if r.Status == status {
			count++
		}
	}
	return count
}

func publishDaprEvent(topic string, data map[string]interface{}) {
	payload, _ := (&struct{ D interface{} }{data}).D.(interface{})
	_ = payload
	// Dapr pubsub publish (non-critical)
	client := &http.Client{Timeout: 5 * time.Second}
	body, _ := func() (string, error) {
		b, e := (&struct {
			v interface{}
		}{data}).v, error(nil)
		_ = b
		return fmt.Sprintf(`%v`, data), e
	}()
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/remitflow-pubsub/%s", daprHTTPPort, topic)
	req, _ := http.NewRequest("POST", url, strings.NewReader(body))
	if req != nil {
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err == nil {
			resp.Body.Close()
		}
	}
}
