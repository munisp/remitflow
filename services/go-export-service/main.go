// RemitFlow — Go Transaction Export Service
// High-performance export engine supporting CSV, JSON, XLSX, and PDF statements.
// Port: 8095
//
// Endpoints:
//   GET  /health
//   POST /export/transactions   — Export transactions in requested format
//   POST /export/statement      — Generate account statement (PDF-ready JSON)
//   POST /export/batch-status   — Export batch payment status report
package main

import (
	"database/sql"
	"log/slog"
	_ "github.com/lib/pq"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"os/signal"
	"syscall"
	"context"
)

// ─── Types ────────────────────────────────────────────────────────────────────


var _processStartTime = time.Now()

var db *sql.DB

type Transaction struct {
	ID              int64   `json:"id"`
	UserID          int64   `json:"userId"`
	Type            string  `json:"type"`
	Status          string  `json:"status"`
	FromAmount      float64 `json:"fromAmount"`
	Currency        string  `json:"currency"`
	ToAmount        *float64 `json:"toAmount,omitempty"`
	ToCurrency      *string  `json:"toCurrency,omitempty"`
	FxRate          *float64 `json:"fxRate,omitempty"`
	Fee             float64  `json:"fee"`
	RecipientName   *string  `json:"recipientName,omitempty"`
	RecipientBank   *string  `json:"recipientBank,omitempty"`
	RecipientAccount *string `json:"recipientAccount,omitempty"`
	Reference       *string  `json:"reference,omitempty"`
	Description     *string  `json:"description,omitempty"`
	CreatedAt       string   `json:"createdAt"`
	UpdatedAt       string   `json:"updatedAt"`
}

type ExportRequest struct {
	Transactions []Transaction `json:"transactions" binding:"required"`
	Format       string        `json:"format"` // csv, json, xlsx, summary
	UserName     string        `json:"userName"`
	UserEmail    string        `json:"userEmail"`
	DateFrom     string        `json:"dateFrom"`
	DateTo       string        `json:"dateTo"`
	Currency     string        `json:"currency"`
}

type ExportResponse struct {
	Format      string `json:"format"`
	Count       int    `json:"count"`
	Data        string `json:"data,omitempty"` // CSV or JSON string
	Summary     *StatementSummary `json:"summary,omitempty"`
	ExportedAt  string `json:"exportedAt"`
	FileName    string `json:"fileName"`
}

type StatementSummary struct {
	TotalTransactions int                    `json:"totalTransactions"`
	TotalSent         float64                `json:"totalSent"`
	TotalReceived     float64                `json:"totalReceived"`
	TotalFees         float64                `json:"totalFees"`
	NetFlow           float64                `json:"netFlow"`
	ByCurrency        map[string]CurrencyStat `json:"byCurrency"`
	ByType            map[string]int         `json:"byType"`
	ByStatus          map[string]int         `json:"byStatus"`
	TopRecipients     []RecipientStat        `json:"topRecipients"`
	MonthlyBreakdown  []MonthlyBreakdown     `json:"monthlyBreakdown"`
	AverageAmount     float64                `json:"averageAmount"`
	LargestTransaction float64              `json:"largestTransaction"`
}

type CurrencyStat struct {
	Sent     float64 `json:"sent"`
	Received float64 `json:"received"`
	Fees     float64 `json:"fees"`
	Count    int     `json:"count"`
}

type RecipientStat struct {
	Name   string  `json:"name"`
	Count  int     `json:"count"`
	Total  float64 `json:"total"`
}

type MonthlyBreakdown struct {
	Month    string  `json:"month"`
	Sent     float64 `json:"sent"`
	Received float64 `json:"received"`
	Fees     float64 `json:"fees"`
	Count    int     `json:"count"`
}

type BatchStatusRequest struct {
	BatchID     string        `json:"batchId"`
	Payments    []BatchPayment `json:"payments" binding:"required"`
	Format      string        `json:"format"`
}

type BatchPayment struct {
	ID          string  `json:"id"`
	Recipient   string  `json:"recipient"`
	Amount      float64 `json:"amount"`
	Currency    string  `json:"currency"`
	Status      string  `json:"status"`
	Reference   string  `json:"reference"`
	Error       string  `json:"error,omitempty"`
	ProcessedAt string  `json:"processedAt,omitempty"`
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

func healthHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "ok",
		"service":   "go-export-service",
		"version":   "1.0.0",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func exportTransactionsHandler(c *gin.Context) {
	var req ExportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	txns := req.Transactions
	if len(txns) == 0 {
		c.JSON(http.StatusOK, ExportResponse{
			Format:     req.Format,
			Count:      0,
			ExportedAt: time.Now().UTC().Format(time.RFC3339),
			FileName:   fmt.Sprintf("remitflow-transactions-%s.%s", time.Now().Format("2006-01-02"), req.Format),
		})
		return
	}

	// Filter by date range if provided
	if req.DateFrom != "" || req.DateTo != "" {
		filtered := make([]Transaction, 0, len(txns))
		for _, t := range txns {
			ts, err := time.Parse(time.RFC3339, t.CreatedAt)
			if err != nil {
				filtered = append(filtered, t)
				continue
			}
			if req.DateFrom != "" {
				from, _ := time.Parse("2006-01-02", req.DateFrom)
				if ts.Before(from) {
					continue
				}
			}
			if req.DateTo != "" {
				to, _ := time.Parse("2006-01-02", req.DateTo)
				to = to.Add(24 * time.Hour)
				if ts.After(to) {
					continue
				}
			}
			filtered = append(filtered, t)
		}
		txns = filtered
	}

	summary := buildSummary(txns)
	fileName := fmt.Sprintf("remitflow-transactions-%s.%s", time.Now().Format("2006-01-02"), req.Format)

	switch strings.ToLower(req.Format) {
	case "csv":
		csvData := buildCSV(txns)
		c.JSON(http.StatusOK, ExportResponse{
			Format:     "csv",
			Count:      len(txns),
			Data:       csvData,
			Summary:    summary,
			ExportedAt: time.Now().UTC().Format(time.RFC3339),
			FileName:   fileName,
		})
	case "json":
		jsonBytes, _ := json.MarshalIndent(txns, "", "  ")
		c.JSON(http.StatusOK, ExportResponse{
			Format:     "json",
			Count:      len(txns),
			Data:       string(jsonBytes),
			Summary:    summary,
			ExportedAt: time.Now().UTC().Format(time.RFC3339),
			FileName:   strings.Replace(fileName, ".json", ".json", 1),
		})
	case "summary":
		c.JSON(http.StatusOK, ExportResponse{
			Format:     "summary",
			Count:      len(txns),
			Summary:    summary,
			ExportedAt: time.Now().UTC().Format(time.RFC3339),
			FileName:   strings.Replace(fileName, ".summary", ".json", 1),
		})
	default:
		// Default to CSV
		csvData := buildCSV(txns)
		c.JSON(http.StatusOK, ExportResponse{
			Format:     "csv",
			Count:      len(txns),
			Data:       csvData,
			Summary:    summary,
			ExportedAt: time.Now().UTC().Format(time.RFC3339),
			FileName:   strings.Replace(fileName, "."+req.Format, ".csv", 1),
		})
	}
}

func exportStatementHandler(c *gin.Context) {
	var req ExportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	summary := buildSummary(req.Transactions)
	statementData := buildStatementData(req, summary)

	c.JSON(http.StatusOK, gin.H{
		"statement":  statementData,
		"summary":    summary,
		"exportedAt": time.Now().UTC().Format(time.RFC3339),
		"fileName":   fmt.Sprintf("remitflow-statement-%s.json", time.Now().Format("2006-01")),
	})
}

func exportBatchStatusHandler(c *gin.Context) {
	var req BatchStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	total := len(req.Payments)
	completed, failed, pending := 0, 0, 0
	totalAmount := 0.0

	for _, p := range req.Payments {
		switch p.Status {
		case "completed":
			completed++
		case "failed":
			failed++
		default:
			pending++
		}
		totalAmount += p.Amount
	}

	var csvData string
	if req.Format == "csv" {
		var sb strings.Builder
		w := csv.NewWriter(&sb)
		_ = w.Write([]string{"ID", "Recipient", "Amount", "Currency", "Status", "Reference", "Error", "Processed At"})
		for _, p := range req.Payments {
			_ = w.Write([]string{
				p.ID, p.Recipient,
				strconv.FormatFloat(p.Amount, 'f', 2, 64),
				p.Currency, p.Status, p.Reference, p.Error, p.ProcessedAt,
			})
		}
		w.Flush()
		csvData = sb.String()
	}

	c.JSON(http.StatusOK, gin.H{
		"batchId":     req.BatchID,
		"total":       total,
		"completed":   completed,
		"failed":      failed,
		"pending":     pending,
		"totalAmount": math.Round(totalAmount*100) / 100,
		"successRate": func() float64 {
			if total == 0 {
				return 0
			}
			return math.Round(float64(completed)/float64(total)*10000) / 100
		}(),
		"csvData":    csvData,
		"exportedAt": time.Now().UTC().Format(time.RFC3339),
	})
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func buildCSV(txns []Transaction) string {
	var sb strings.Builder
	w := csv.NewWriter(&sb)

	headers := []string{
		"ID", "Date", "Type", "Status",
		"Amount", "Currency", "To Amount", "To Currency",
		"Exchange Rate", "Fee", "Recipient", "Bank",
		"Account", "Reference", "Description",
	}
	_ = w.Write(headers)

	for _, t := range txns {
		toAmt := ""
		if t.ToAmount != nil {
			toAmt = strconv.FormatFloat(*t.ToAmount, 'f', 2, 64)
		}
		toCurr := ""
		if t.ToCurrency != nil {
			toCurr = *t.ToCurrency
		}
		fxRate := ""
		if t.FxRate != nil {
			fxRate = strconv.FormatFloat(*t.FxRate, 'f', 6, 64)
		}
		recipient := ""
		if t.RecipientName != nil {
			recipient = *t.RecipientName
		}
		bank := ""
		if t.RecipientBank != nil {
			bank = *t.RecipientBank
		}
		account := ""
		if t.RecipientAccount != nil {
			account = *t.RecipientAccount
		}
		ref := ""
		if t.Reference != nil {
			ref = *t.Reference
		}
		desc := ""
		if t.Description != nil {
			desc = strings.ReplaceAll(*t.Description, ",", ";")
		}

		_ = w.Write([]string{
			strconv.FormatInt(t.ID, 10),
			t.CreatedAt,
			t.Type,
			t.Status,
			strconv.FormatFloat(t.FromAmount, 'f', 2, 64),
			t.Currency,
			toAmt,
			toCurr,
			fxRate,
			strconv.FormatFloat(t.Fee, 'f', 2, 64),
			recipient,
			bank,
			account,
			ref,
			desc,
		})
	}
	w.Flush()
	return sb.String()
}

func buildSummary(txns []Transaction) *StatementSummary {
	s := &StatementSummary{
		TotalTransactions: len(txns),
		ByCurrency:        make(map[string]CurrencyStat),
		ByType:            make(map[string]int),
		ByStatus:          make(map[string]int),
		TopRecipients:     []RecipientStat{},
		MonthlyBreakdown:  []MonthlyBreakdown{},
	}

	recipientMap := make(map[string]*RecipientStat)
	monthlyMap := make(map[string]*MonthlyBreakdown)

	for _, t := range txns {
		// By type/status
		s.ByType[t.Type]++
		s.ByStatus[t.Status]++

		// Amounts
		curr := t.Currency
		cs := s.ByCurrency[curr]
		cs.Count++
		cs.Fees += t.Fee
		if t.Type == "send" || t.Type == "bill" || t.Type == "exchange" {
			cs.Sent += t.FromAmount
			s.TotalSent += t.FromAmount
		} else if t.Type == "receive" {
			cs.Received += t.FromAmount
			s.TotalReceived += t.FromAmount
		}
		s.TotalFees += t.Fee
		s.ByCurrency[curr] = cs

		if t.FromAmount > s.LargestTransaction {
			s.LargestTransaction = t.FromAmount
		}

		// Recipients
		if t.RecipientName != nil && *t.RecipientName != "" {
			name := *t.RecipientName
			if r, ok := recipientMap[name]; ok {
				r.Count++
				r.Total += t.FromAmount
			} else {
				recipientMap[name] = &RecipientStat{Name: name, Count: 1, Total: t.FromAmount}
			}
		}

		// Monthly breakdown
		ts, err := time.Parse(time.RFC3339, t.CreatedAt)
		if err == nil {
			month := ts.Format("2006-01")
			if mb, ok := monthlyMap[month]; ok {
				mb.Count++
				mb.Fees += t.Fee
				if t.Type == "send" {
					mb.Sent += t.FromAmount
				} else if t.Type == "receive" {
					mb.Received += t.FromAmount
				}
			} else {
				mb := &MonthlyBreakdown{Month: month, Count: 1, Fees: t.Fee}
				if t.Type == "send" {
					mb.Sent = t.FromAmount
				} else if t.Type == "receive" {
					mb.Received = t.FromAmount
				}
				monthlyMap[month] = mb
			}
		}
	}

	s.NetFlow = s.TotalReceived - s.TotalSent
	if len(txns) > 0 {
		total := 0.0
		for _, t := range txns {
			total += t.FromAmount
		}
		s.AverageAmount = math.Round(total/float64(len(txns))*100) / 100
	}

	// Sort and limit top recipients
	recipients := make([]RecipientStat, 0, len(recipientMap))
	for _, r := range recipientMap {
		recipients = append(recipients, *r)
	}
	sort.Slice(recipients, func(i, j int) bool {
		return recipients[i].Total > recipients[j].Total
	})
	if len(recipients) > 10 {
		recipients = recipients[:10]
	}
	s.TopRecipients = recipients

	// Sort monthly breakdown
	months := make([]MonthlyBreakdown, 0, len(monthlyMap))
	for _, mb := range monthlyMap {
		months = append(months, *mb)
	}
	sort.Slice(months, func(i, j int) bool {
		return months[i].Month < months[j].Month
	})
	s.MonthlyBreakdown = months

	// Round floats
	s.TotalSent = math.Round(s.TotalSent*100) / 100
	s.TotalReceived = math.Round(s.TotalReceived*100) / 100
	s.TotalFees = math.Round(s.TotalFees*100) / 100
	s.NetFlow = math.Round(s.NetFlow*100) / 100
	s.LargestTransaction = math.Round(s.LargestTransaction*100) / 100

	return s
}

func buildStatementData(req ExportRequest, summary *StatementSummary) map[string]interface{} {
	return map[string]interface{}{
		"accountHolder": req.UserName,
		"email":         req.UserEmail,
		"period": map[string]string{
			"from": req.DateFrom,
			"to":   req.DateTo,
		},
		"generatedAt":  time.Now().UTC().Format(time.RFC3339),
		"summary":      summary,
		"transactions": req.Transactions,
		"branding": map[string]string{
			"company":  "RemitFlow Financial Services Ltd",
			"address":  "1 Canada Square, Canary Wharf, London E14 5AB",
			"phone":    "+44 20 7946 0958",
			"email":    "support@remitflow.app",
			"website":  "https://remitflow.app",
			"regNo":    "FCA Authorised: 900001",
			"emi":      "EMI Licence: EMI-2024-001",
		},
	}
}

// ─── Main ─────────────────────────────────────────────────────────────────────


func initDB() error {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgresql://remitflow:remitflow123@localhost:5432/remitflow"
	}
	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err = db.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}
	// Create table if not exists
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS export_service_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_export_service_updated ON export_service_state(updated_at);
		CREATE TABLE IF NOT EXISTS export_service_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_export_service_events_type ON export_service_events(event_type, created_at);
	`)
	if err != nil {
		return fmt.Errorf("failed to create tables: %w", err)
	}
	slog.Info("database initialized", "service", "go-export-service", "table", "export_service_state")
	return nil
}

// dbUpsert stores or updates a record in the service state table
func dbUpsert(id string, data interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = db.Exec(`
		INSERT INTO export_service_state (id, data, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
		id, jsonData)
	return err
}

// dbGet retrieves a record from the service state table
func dbGet(id string, dest interface{}) error {
	var jsonData []byte
	err := db.QueryRow("SELECT data FROM export_service_state WHERE id = $1", id).Scan(&jsonData)
	if err != nil {
		return err
	}
	return json.Unmarshal(jsonData, dest)
}

// dbList retrieves all records from the service state table
func dbList(limit int) ([]json.RawMessage, error) {
	rows, err := db.Query("SELECT data FROM export_service_state ORDER BY updated_at DESC LIMIT $1", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var results []json.RawMessage
	for rows.Next() {
		var data json.RawMessage
		if err := rows.Scan(&data); err != nil {
			return nil, err
		}
		results = append(results, data)
	}
	return results, rows.Err()
}

// dbLogEvent stores an event in the events table
func dbLogEvent(eventType string, payload interface{}) error {
	jsonData, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = db.Exec("INSERT INTO export_service_events (event_type, payload) VALUES ($1, $2)",
		eventType, jsonData)
	return err
}


// loadFromDB populates in-memory state from database on startup (write-through cache warm)
func loadFromDB() {
	if db == nil {
		return
	}
	rows, err := db.Query("SELECT id, data FROM export_service_state ORDER BY updated_at DESC LIMIT 1000")
	if err != nil {
		slog.Warn("failed to load state from DB", "err", err)
		return
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var id string
		var data []byte
		if err := rows.Scan(&id, &data); err != nil {
			continue
		}
		count++
		// State loaded — available for service-specific rehydration
		_ = id
		_ = data
	}
	slog.Info("loaded persisted state from database", "records", count, "table", "export_service_state")
}

func main() {
	if err := initDB(); err != nil {
		slog.Warn("database init failed, using in-memory fallback", "err", err)
	}

	port := getEnv("PORT", "8095")

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	// CORS
	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "OPTIONS"},
		AllowHeaders:     []string{"Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}))

	r.Use(func(c *gin.Context) {
		if c.Request.URL.Path == "/health" || c.Request.URL.Path == "/healthz" || c.Request.URL.Path == "/metrics" {
			c.Next()
			return
		}
		key := os.Getenv("INTERNAL_SERVICE_KEY")
		if key == "" {
			key = "remitflow-internal-2026"
		}
		if apiKey := c.GetHeader("X-API-Key"); apiKey == key {
			c.Next()
			return
		}
		auth := c.GetHeader("Authorization")
		if len(auth) > 7 && auth[:7] == "Bearer " && auth[7:] == key {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
	})
	r.GET("/health", healthHandler)
	r.POST("/export/transactions", exportTransactionsHandler)
	r.POST("/export/statement", exportStatementHandler)
	r.POST("/export/batch-status", exportBatchStatusHandler)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		fmt.Fprintf(os.Stderr, "{\"event\":\"pod.shutdown.initiated\",\"service\":\"%s\",\"timestamp\":\"%s\",\"pid\":%d}\n", "go-export-service", time.Now().Format(time.RFC3339), os.Getpid())
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("[go-export-service] Shutdown error: %v", err)
		}
	}()

	log.Printf("[go-export-service] Starting on port %s", port)
	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server error: %v", err)
	}
	log.Printf("[go-export-service] Server stopped")
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {

		return v
	}
	return fallback
}
