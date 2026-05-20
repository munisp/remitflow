package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
	_ "github.com/lib/pq"
)

// Audit models
type AuditLog struct {
	ID          int       `json:"id" db:"id"`
	UserID      string    `json:"user_id" db:"user_id"`
	Action      string    `json:"action" db:"action"`
	Resource    string    `json:"resource" db:"resource"`
	ResourceID  string    `json:"resource_id" db:"resource_id"`
	Details     string    `json:"details" db:"details"`
	IPAddress   string    `json:"ip_address" db:"ip_address"`
	UserAgent   string    `json:"user_agent" db:"user_agent"`
	Status      string    `json:"status" db:"status"`
	Timestamp   time.Time `json:"timestamp" db:"timestamp"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}

type ComplianceCheck struct {
	ID            int       `json:"id" db:"id"`
	CheckType     string    `json:"check_type" db:"check_type"`
	EntityType    string    `json:"entity_type" db:"entity_type"`
	EntityID      string    `json:"entity_id" db:"entity_id"`
	RuleName      string    `json:"rule_name" db:"rule_name"`
	Status        string    `json:"status" db:"status"`
	Severity      string    `json:"severity" db:"severity"`
	Details       string    `json:"details" db:"details"`
	Remediation   string    `json:"remediation" db:"remediation"`
	CheckedAt     time.Time `json:"checked_at" db:"checked_at"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
}

type SecurityEvent struct {
	ID          int       `json:"id" db:"id"`
	EventType   string    `json:"event_type" db:"event_type"`
	Severity    string    `json:"severity" db:"severity"`
	Source      string    `json:"source" db:"source"`
	UserID      string    `json:"user_id" db:"user_id"`
	IPAddress   string    `json:"ip_address" db:"ip_address"`
	Description string    `json:"description" db:"description"`
	Details     string    `json:"details" db:"details"`
	Status      string    `json:"status" db:"status"`
	Timestamp   time.Time `json:"timestamp" db:"timestamp"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}

type AuditReport struct {
	ID          int       `json:"id" db:"id"`
	ReportType  string    `json:"report_type" db:"report_type"`
	Title       string    `json:"title" db:"title"`
	Description string    `json:"description" db:"description"`
	Period      string    `json:"period" db:"period"`
	StartDate   time.Time `json:"start_date" db:"start_date"`
	EndDate     time.Time `json:"end_date" db:"end_date"`
	Status      string    `json:"status" db:"status"`
	FilePath    string    `json:"file_path" db:"file_path"`
	GeneratedBy string    `json:"generated_by" db:"generated_by"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}

type AuditService struct {
	db *sql.DB
}

func NewAuditService(db *sql.DB) *AuditService {
	return &AuditService{db: db}
}

// Initialize database tables
func (s *AuditService) InitTables() error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS audit_logs (
			id SERIAL PRIMARY KEY,
			user_id VARCHAR(50) NOT NULL,
			action VARCHAR(100) NOT NULL,
			resource VARCHAR(100) NOT NULL,
			resource_id VARCHAR(100),
			details TEXT,
			ip_address INET,
			user_agent TEXT,
			status VARCHAR(20) NOT NULL DEFAULT 'success',
			timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			INDEX idx_audit_user_id (user_id),
			INDEX idx_audit_action (action),
			INDEX idx_audit_timestamp (timestamp)
		)`,
		`CREATE TABLE IF NOT EXISTS compliance_checks (
			id SERIAL PRIMARY KEY,
			check_type VARCHAR(50) NOT NULL,
			entity_type VARCHAR(50) NOT NULL,
			entity_id VARCHAR(100) NOT NULL,
			rule_name VARCHAR(100) NOT NULL,
			status VARCHAR(20) NOT NULL,
			severity VARCHAR(20) NOT NULL,
			details TEXT,
			remediation TEXT,
			checked_at TIMESTAMP NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			INDEX idx_compliance_entity (entity_type, entity_id),
			INDEX idx_compliance_status (status),
			INDEX idx_compliance_severity (severity)
		)`,
		`CREATE TABLE IF NOT EXISTS security_events (
			id SERIAL PRIMARY KEY,
			event_type VARCHAR(50) NOT NULL,
			severity VARCHAR(20) NOT NULL,
			source VARCHAR(100) NOT NULL,
			user_id VARCHAR(50),
			ip_address INET,
			description TEXT NOT NULL,
			details TEXT,
			status VARCHAR(20) NOT NULL DEFAULT 'open',
			timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			INDEX idx_security_event_type (event_type),
			INDEX idx_security_severity (severity),
			INDEX idx_security_timestamp (timestamp)
		)`,
		`CREATE TABLE IF NOT EXISTS audit_reports (
			id SERIAL PRIMARY KEY,
			report_type VARCHAR(50) NOT NULL,
			title VARCHAR(200) NOT NULL,
			description TEXT,
			period VARCHAR(50) NOT NULL,
			start_date DATE NOT NULL,
			end_date DATE NOT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'pending',
			file_path VARCHAR(500),
			generated_by VARCHAR(50) NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			INDEX idx_report_type (report_type),
			INDEX idx_report_status (status)
		)`,
	}

	for _, query := range queries {
		if _, err := s.db.Exec(query); err != nil {
			return fmt.Errorf("failed to create table: %v", err)
		}
	}
	return nil
}

// Audit Log endpoints
func (s *AuditService) getAuditLogs(c *gin.Context) {
	userID := c.Query("user_id")
	action := c.Query("action")
	resource := c.Query("resource")
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")
	limit := c.DefaultQuery("limit", "100")

	query := `SELECT id, user_id, action, resource, resource_id, details, 
			  ip_address, user_agent, status, timestamp, created_at 
			  FROM audit_logs WHERE 1=1`
	args := []interface{}{}
	argCount := 0

	if userID != "" {
		argCount++
		query += fmt.Sprintf(" AND user_id = $%d", argCount)
		args = append(args, userID)
	}

	if action != "" {
		argCount++
		query += fmt.Sprintf(" AND action = $%d", argCount)
		args = append(args, action)
	}

	if resource != "" {
		argCount++
		query += fmt.Sprintf(" AND resource = $%d", argCount)
		args = append(args, resource)
	}

	if startDate != "" {
		argCount++
		query += fmt.Sprintf(" AND timestamp >= $%d", argCount)
		args = append(args, startDate)
	}

	if endDate != "" {
		argCount++
		query += fmt.Sprintf(" AND timestamp <= $%d", argCount)
		args = append(args, endDate)
	}

	argCount++
	query += fmt.Sprintf(" ORDER BY timestamp DESC LIMIT $%d", argCount)
	args = append(args, limit)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var logs []AuditLog
	for rows.Next() {
		var log AuditLog
		err := rows.Scan(&log.ID, &log.UserID, &log.Action, &log.Resource,
						&log.ResourceID, &log.Details, &log.IPAddress, &log.UserAgent,
						&log.Status, &log.Timestamp, &log.CreatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		logs = append(logs, log)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": logs,
		"count": len(logs),
	})
}

func (s *AuditService) createAuditLog(c *gin.Context) {
	var log AuditLog
	if err := c.ShouldBindJSON(&log); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get client IP if not provided
	if log.IPAddress == "" {
		log.IPAddress = c.ClientIP()
	}

	// Get user agent if not provided
	if log.UserAgent == "" {
		log.UserAgent = c.GetHeader("User-Agent")
	}

	query := `INSERT INTO audit_logs (user_id, action, resource, resource_id, details, 
			  ip_address, user_agent, status, timestamp)
			  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, created_at`
	
	err := s.db.QueryRow(query, log.UserID, log.Action, log.Resource, log.ResourceID,
						log.Details, log.IPAddress, log.UserAgent, log.Status, 
						time.Now()).Scan(&log.ID, &log.CreatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"status": "success",
		"data": log,
	})
}

// Compliance Check endpoints
func (s *AuditService) getComplianceChecks(c *gin.Context) {
	entityType := c.Query("entity_type")
	entityID := c.Query("entity_id")
	status := c.Query("status")
	severity := c.Query("severity")
	limit := c.DefaultQuery("limit", "100")

	query := `SELECT id, check_type, entity_type, entity_id, rule_name, status, 
			  severity, details, remediation, checked_at, created_at 
			  FROM compliance_checks WHERE 1=1`
	args := []interface{}{}
	argCount := 0

	if entityType != "" {
		argCount++
		query += fmt.Sprintf(" AND entity_type = $%d", argCount)
		args = append(args, entityType)
	}

	if entityID != "" {
		argCount++
		query += fmt.Sprintf(" AND entity_id = $%d", argCount)
		args = append(args, entityID)
	}

	if status != "" {
		argCount++
		query += fmt.Sprintf(" AND status = $%d", argCount)
		args = append(args, status)
	}

	if severity != "" {
		argCount++
		query += fmt.Sprintf(" AND severity = $%d", argCount)
		args = append(args, severity)
	}

	argCount++
	query += fmt.Sprintf(" ORDER BY checked_at DESC LIMIT $%d", argCount)
	args = append(args, limit)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var checks []ComplianceCheck
	for rows.Next() {
		var check ComplianceCheck
		err := rows.Scan(&check.ID, &check.CheckType, &check.EntityType, &check.EntityID,
						&check.RuleName, &check.Status, &check.Severity, &check.Details,
						&check.Remediation, &check.CheckedAt, &check.CreatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		checks = append(checks, check)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": checks,
		"count": len(checks),
	})
}

func (s *AuditService) createComplianceCheck(c *gin.Context) {
	var check ComplianceCheck
	if err := c.ShouldBindJSON(&check); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	query := `INSERT INTO compliance_checks (check_type, entity_type, entity_id, rule_name, 
			  status, severity, details, remediation, checked_at)
			  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, created_at`
	
	err := s.db.QueryRow(query, check.CheckType, check.EntityType, check.EntityID,
						check.RuleName, check.Status, check.Severity, check.Details,
						check.Remediation, time.Now()).Scan(&check.ID, &check.CreatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"status": "success",
		"data": check,
	})
}

// Security Event endpoints
func (s *AuditService) getSecurityEvents(c *gin.Context) {
	eventType := c.Query("event_type")
	severity := c.Query("severity")
	status := c.Query("status")
	userID := c.Query("user_id")
	limit := c.DefaultQuery("limit", "100")

	query := `SELECT id, event_type, severity, source, user_id, ip_address, 
			  description, details, status, timestamp, created_at 
			  FROM security_events WHERE 1=1`
	args := []interface{}{}
	argCount := 0

	if eventType != "" {
		argCount++
		query += fmt.Sprintf(" AND event_type = $%d", argCount)
		args = append(args, eventType)
	}

	if severity != "" {
		argCount++
		query += fmt.Sprintf(" AND severity = $%d", argCount)
		args = append(args, severity)
	}

	if status != "" {
		argCount++
		query += fmt.Sprintf(" AND status = $%d", argCount)
		args = append(args, status)
	}

	if userID != "" {
		argCount++
		query += fmt.Sprintf(" AND user_id = $%d", argCount)
		args = append(args, userID)
	}

	argCount++
	query += fmt.Sprintf(" ORDER BY timestamp DESC LIMIT $%d", argCount)
	args = append(args, limit)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var events []SecurityEvent
	for rows.Next() {
		var event SecurityEvent
		err := rows.Scan(&event.ID, &event.EventType, &event.Severity, &event.Source,
						&event.UserID, &event.IPAddress, &event.Description, &event.Details,
						&event.Status, &event.Timestamp, &event.CreatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		events = append(events, event)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": events,
		"count": len(events),
	})
}

func (s *AuditService) createSecurityEvent(c *gin.Context) {
	var event SecurityEvent
	if err := c.ShouldBindJSON(&event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get client IP if not provided
	if event.IPAddress == "" {
		event.IPAddress = c.ClientIP()
	}

	query := `INSERT INTO security_events (event_type, severity, source, user_id, 
			  ip_address, description, details, status, timestamp)
			  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, created_at`
	
	err := s.db.QueryRow(query, event.EventType, event.Severity, event.Source,
						event.UserID, event.IPAddress, event.Description, event.Details,
						event.Status, time.Now()).Scan(&event.ID, &event.CreatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"status": "success",
		"data": event,
	})
}

// Audit Report endpoints
func (s *AuditService) getAuditReports(c *gin.Context) {
	reportType := c.Query("report_type")
	status := c.Query("status")
	limit := c.DefaultQuery("limit", "50")

	query := `SELECT id, report_type, title, description, period, start_date, 
			  end_date, status, file_path, generated_by, created_at 
			  FROM audit_reports WHERE 1=1`
	args := []interface{}{}
	argCount := 0

	if reportType != "" {
		argCount++
		query += fmt.Sprintf(" AND report_type = $%d", argCount)
		args = append(args, reportType)
	}

	if status != "" {
		argCount++
		query += fmt.Sprintf(" AND status = $%d", argCount)
		args = append(args, status)
	}

	argCount++
	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d", argCount)
	args = append(args, limit)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var reports []AuditReport
	for rows.Next() {
		var report AuditReport
		err := rows.Scan(&report.ID, &report.ReportType, &report.Title, &report.Description,
						&report.Period, &report.StartDate, &report.EndDate, &report.Status,
						&report.FilePath, &report.GeneratedBy, &report.CreatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		reports = append(reports, report)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": reports,
		"count": len(reports),
	})
}

// Dashboard summary endpoint
func (s *AuditService) getDashboardSummary(c *gin.Context) {
	// Get audit log summary
	var totalLogs int
	var failedActions int
	err := s.db.QueryRow(`SELECT COUNT(*), 
						  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) 
						  FROM audit_logs WHERE timestamp >= NOW() - INTERVAL '24 hours'`).
						  Scan(&totalLogs, &failedActions)
	if err != nil {
		totalLogs = 0
		failedActions = 0
	}

	// Get compliance summary
	var totalChecks int
	var failedChecks int
	err = s.db.QueryRow(`SELECT COUNT(*), 
						 SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) 
						 FROM compliance_checks WHERE checked_at >= NOW() - INTERVAL '24 hours'`).
						 Scan(&totalChecks, &failedChecks)
	if err != nil {
		totalChecks = 0
		failedChecks = 0
	}

	// Get security events summary
	var totalEvents int
	var criticalEvents int
	err = s.db.QueryRow(`SELECT COUNT(*), 
						 SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) 
						 FROM security_events WHERE timestamp >= NOW() - INTERVAL '24 hours'`).
						 Scan(&totalEvents, &criticalEvents)
	if err != nil {
		totalEvents = 0
		criticalEvents = 0
	}

	summary := gin.H{
		"audit_logs": gin.H{
			"total": totalLogs,
			"failed": failedActions,
		},
		"compliance_checks": gin.H{
			"total": totalChecks,
			"failed": failedChecks,
		},
		"security_events": gin.H{
			"total": totalEvents,
			"critical": criticalEvents,
		},
		"generated_at": time.Now(),
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": summary,
	})
}

// Health check endpoint
func (s *AuditService) healthCheck(c *gin.Context) {
	// Test database connection
	err := s.db.Ping()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status": "unhealthy",
			"error": "database connection failed",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "healthy",
		"service": "audit-service",
		"timestamp": time.Now(),
		"database": "connected",
	})
}

func main() {
	// Database connection
	dbHost := getEnv("DB_HOST", "localhost")
	dbPort := getEnv("DB_PORT", "5432")
	dbUser := getEnv("DB_USER", "postgres")
	dbPassword := getEnv("DB_PASSWORD", "password")
	dbName := getEnv("DB_NAME", "remittance")

	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		dbHost, dbPort, dbUser, dbPassword, dbName)

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}
	defer db.Close()

	// Test connection
	if err := db.Ping(); err != nil {
		log.Fatal("Failed to ping database:", err)
	}

	// Initialize service
	service := NewAuditService(db)
	if err := service.InitTables(); err != nil {
		log.Fatal("Failed to initialize tables:", err)
	}

	// Setup Gin router
	r := gin.Default()

	// CORS middleware
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"*"}
	r.Use(cors.New(config))

	// Routes
	api := r.Group("/api/v1")
	{
		// Health check
		api.GET("/health", service.healthCheck)
		
		// Audit Logs
		api.GET("/audit/logs", service.getAuditLogs)
		api.POST("/audit/logs", service.createAuditLog)
		
		// Compliance Checks
		api.GET("/audit/compliance", service.getComplianceChecks)
		api.POST("/audit/compliance", service.createComplianceCheck)
		
		// Security Events
		api.GET("/audit/security", service.getSecurityEvents)
		api.POST("/audit/security", service.createSecurityEvent)
		
		// Audit Reports
		api.GET("/audit/reports", service.getAuditReports)
		
		// Dashboard Summary
		api.GET("/audit/dashboard", service.getDashboardSummary)
	}

	port := getEnv("PORT", "8081")
	log.Printf("Audit Service starting on port %s", port)
	log.Fatal(r.Run("0.0.0.0:" + port))
}

func getEnv(key, defaultValue string) string {

// requireEnv returns the value of an environment variable or panics if not set
// Use this for critical configuration like database passwords, API keys, etc.
func requireEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("CRITICAL: Required environment variable %s is not set. Cannot start service.", key)
	}
	return value
}
	if value := os.Getenv(key); value != "" {

// requireEnv returns the value of an environment variable or panics if not set
// Use this for critical configuration like database passwords, API keys, etc.
func requireEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("CRITICAL: Required environment variable %s is not set. Cannot start service.", key)
	}
	return value
}
		return value

// requireEnv returns the value of an environment variable or panics if not set
// Use this for critical configuration like database passwords, API keys, etc.
func requireEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("CRITICAL: Required environment variable %s is not set. Cannot start service.", key)
	}
	return value
}
	}

// requireEnv returns the value of an environment variable or panics if not set
// Use this for critical configuration like database passwords, API keys, etc.
func requireEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("CRITICAL: Required environment variable %s is not set. Cannot start service.", key)
	}
	return value
}
	return defaultValue

// requireEnv returns the value of an environment variable or panics if not set
// Use this for critical configuration like database passwords, API keys, etc.
func requireEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("CRITICAL: Required environment variable %s is not set. Cannot start service.", key)
	}
	return value
}
}

// requireEnv returns the value of an environment variable or panics if not set
// Use this for critical configuration like database passwords, API keys, etc.
func requireEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("CRITICAL: Required environment variable %s is not set. Cannot start service.", key)
	}
	return value
}

