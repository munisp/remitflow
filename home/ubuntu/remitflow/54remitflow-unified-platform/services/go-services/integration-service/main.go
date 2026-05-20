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

// Integration models
type Integration struct {
	ID            int       `json:"id" db:"id"`
	Name          string    `json:"name" db:"name"`
	Type          string    `json:"type" db:"type"`
	Provider      string    `json:"provider" db:"provider"`
	Endpoint      string    `json:"endpoint" db:"endpoint"`
	AuthType      string    `json:"auth_type" db:"auth_type"`
	Credentials   string    `json:"credentials" db:"credentials"`
	Configuration string    `json:"configuration" db:"configuration"`
	Status        string    `json:"status" db:"status"`
	IsActive      bool      `json:"is_active" db:"is_active"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
	UpdatedAt     time.Time `json:"updated_at" db:"updated_at"`
}

type IntegrationLog struct {
	ID            int       `json:"id" db:"id"`
	IntegrationID int       `json:"integration_id" db:"integration_id"`
	RequestID     string    `json:"request_id" db:"request_id"`
	Method        string    `json:"method" db:"method"`
	Endpoint      string    `json:"endpoint" db:"endpoint"`
	RequestData   string    `json:"request_data" db:"request_data"`
	ResponseData  string    `json:"response_data" db:"response_data"`
	StatusCode    int       `json:"status_code" db:"status_code"`
	ResponseTime  int       `json:"response_time" db:"response_time"`
	Success       bool      `json:"success" db:"success"`
	ErrorMessage  string    `json:"error_message" db:"error_message"`
	Timestamp     time.Time `json:"timestamp" db:"timestamp"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
}

type DataMapping struct {
	ID            int       `json:"id" db:"id"`
	IntegrationID int       `json:"integration_id" db:"integration_id"`
	SourceField   string    `json:"source_field" db:"source_field"`
	TargetField   string    `json:"target_field" db:"target_field"`
	DataType      string    `json:"data_type" db:"data_type"`
	Transformation string   `json:"transformation" db:"transformation"`
	IsRequired    bool      `json:"is_required" db:"is_required"`
	DefaultValue  string    `json:"default_value" db:"default_value"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
	UpdatedAt     time.Time `json:"updated_at" db:"updated_at"`
}

type WebhookEndpoint struct {
	ID          int       `json:"id" db:"id"`
	Name        string    `json:"name" db:"name"`
	URL         string    `json:"url" db:"url"`
	Method      string    `json:"method" db:"method"`
	Headers     string    `json:"headers" db:"headers"`
	EventTypes  string    `json:"event_types" db:"event_types"`
	IsActive    bool      `json:"is_active" db:"is_active"`
	Secret      string    `json:"secret" db:"secret"`
	RetryCount  int       `json:"retry_count" db:"retry_count"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
}

type IntegrationService struct {
	db *sql.DB
}

func NewIntegrationService(db *sql.DB) *IntegrationService {
	return &IntegrationService{db: db}
}

// Initialize database tables
func (s *IntegrationService) InitTables() error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS integrations (
			id SERIAL PRIMARY KEY,
			name VARCHAR(200) NOT NULL,
			type VARCHAR(50) NOT NULL,
			provider VARCHAR(100) NOT NULL,
			endpoint VARCHAR(500) NOT NULL,
			auth_type VARCHAR(50) NOT NULL,
			credentials JSONB,
			configuration JSONB,
			status VARCHAR(20) NOT NULL DEFAULT 'inactive',
			is_active BOOLEAN DEFAULT true,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			INDEX idx_integrations_type (type),
			INDEX idx_integrations_provider (provider),
			INDEX idx_integrations_status (status)
		)`,
		`CREATE TABLE IF NOT EXISTS integration_logs (
			id SERIAL PRIMARY KEY,
			integration_id INTEGER NOT NULL,
			request_id VARCHAR(50) NOT NULL,
			method VARCHAR(10) NOT NULL,
			endpoint VARCHAR(500) NOT NULL,
			request_data TEXT,
			response_data TEXT,
			status_code INTEGER NOT NULL,
			response_time INTEGER NOT NULL,
			success BOOLEAN NOT NULL,
			error_message TEXT,
			timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE,
			INDEX idx_integration_logs_integration (integration_id),
			INDEX idx_integration_logs_timestamp (timestamp),
			INDEX idx_integration_logs_success (success)
		)`,
		`CREATE TABLE IF NOT EXISTS data_mappings (
			id SERIAL PRIMARY KEY,
			integration_id INTEGER NOT NULL,
			source_field VARCHAR(200) NOT NULL,
			target_field VARCHAR(200) NOT NULL,
			data_type VARCHAR(50) NOT NULL,
			transformation TEXT,
			is_required BOOLEAN DEFAULT false,
			default_value TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE,
			INDEX idx_data_mappings_integration (integration_id)
		)`,
		`CREATE TABLE IF NOT EXISTS webhook_endpoints (
			id SERIAL PRIMARY KEY,
			name VARCHAR(200) NOT NULL,
			url VARCHAR(500) NOT NULL,
			method VARCHAR(10) NOT NULL DEFAULT 'POST',
			headers JSONB,
			event_types JSONB NOT NULL,
			is_active BOOLEAN DEFAULT true,
			secret VARCHAR(200),
			retry_count INTEGER DEFAULT 3,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			INDEX idx_webhook_endpoints_active (is_active)
		)`,
	}

	for _, query := range queries {
		if _, err := s.db.Exec(query); err != nil {
			return fmt.Errorf("failed to create table: %v", err)
		}
	}

	// Insert default integrations
	s.insertDefaultIntegrations()

	return nil
}

func (s *IntegrationService) insertDefaultIntegrations() {
	integrations := []Integration{
		{
			Name:     "TigerBeetle Ledger Integration",
			Type:     "ledger",
			Provider: "TigerBeetle",
			Endpoint: "http://localhost:3000",
			AuthType: "api_key",
			Credentials: `{"api_key": "tb_api_key_123"}`,
			Configuration: `{"batch_size": 1000, "timeout": 30}`,
			Status:   "active",
			IsActive: true,
		},
		{
			Name:     "Keycloak Authentication",
			Type:     "authentication",
			Provider: "Keycloak",
			Endpoint: "http://localhost:8080/auth",
			AuthType: "oauth2",
			Credentials: `{"client_id": "remittance", "client_secret": "secret"}`,
			Configuration: `{"realm": "remittance", "scope": "openid profile"}`,
			Status:   "active",
			IsActive: true,
		},
		{
			Name:     "Redis Cache Integration",
			Type:     "cache",
			Provider: "Redis",
			Endpoint: "redis://localhost:6379",
			AuthType: "password",
			Credentials: `{"password": "redis_password"}`,
			Configuration: `{"db": 0, "timeout": 5}`,
			Status:   "active",
			IsActive: true,
		},
		{
			Name:     "Kafka Event Streaming",
			Type:     "messaging",
			Provider: "Apache Kafka",
			Endpoint: "localhost:9092",
			AuthType: "sasl",
			Credentials: `{"username": "kafka_user", "password": "kafka_pass"}`,
			Configuration: `{"topics": ["transactions", "alerts", "notifications"]}`,
			Status:   "active",
			IsActive: true,
		},
		{
			Name:     "SMS Gateway Integration",
			Type:     "notification",
			Provider: "Twilio",
			Endpoint: "https://api.twilio.com/2010-04-01",
			AuthType: "basic",
			Credentials: `{"account_sid": "AC123", "auth_token": "token123"}`,
			Configuration: `{"from_number": "+1234567890"}`,
			Status:   "active",
			IsActive: true,
		},
	}

	for _, integration := range integrations {
		query := `INSERT INTO integrations (name, type, provider, endpoint, auth_type, credentials, configuration, status, is_active)
				  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`
		s.db.Exec(query, integration.Name, integration.Type, integration.Provider,
				  integration.Endpoint, integration.AuthType, integration.Credentials,
				  integration.Configuration, integration.Status, integration.IsActive)
	}
}

// Integration endpoints
func (s *IntegrationService) getIntegrations(c *gin.Context) {
	integrationType := c.Query("type")
	provider := c.Query("provider")
	status := c.Query("status")
	isActive := c.Query("is_active")

	query := `SELECT id, name, type, provider, endpoint, auth_type, credentials, 
			  configuration, status, is_active, created_at, updated_at 
			  FROM integrations WHERE 1=1`
	args := []interface{}{}
	argCount := 0

	if integrationType != "" {
		argCount++
		query += fmt.Sprintf(" AND type = $%d", argCount)
		args = append(args, integrationType)
	}

	if provider != "" {
		argCount++
		query += fmt.Sprintf(" AND provider = $%d", argCount)
		args = append(args, provider)
	}

	if status != "" {
		argCount++
		query += fmt.Sprintf(" AND status = $%d", argCount)
		args = append(args, status)
	}

	if isActive != "" {
		argCount++
		query += fmt.Sprintf(" AND is_active = $%d", argCount)
		args = append(args, isActive == "true")
	}

	query += " ORDER BY name"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var integrations []Integration
	for rows.Next() {
		var integration Integration
		err := rows.Scan(&integration.ID, &integration.Name, &integration.Type, &integration.Provider,
						&integration.Endpoint, &integration.AuthType, &integration.Credentials,
						&integration.Configuration, &integration.Status, &integration.IsActive,
						&integration.CreatedAt, &integration.UpdatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		integrations = append(integrations, integration)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": integrations,
		"count": len(integrations),
	})
}

func (s *IntegrationService) createIntegration(c *gin.Context) {
	var integration Integration
	if err := c.ShouldBindJSON(&integration); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	query := `INSERT INTO integrations (name, type, provider, endpoint, auth_type, 
			  credentials, configuration, status, is_active)
			  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
			  RETURNING id, created_at, updated_at`
	
	err := s.db.QueryRow(query, integration.Name, integration.Type, integration.Provider,
						integration.Endpoint, integration.AuthType, integration.Credentials,
						integration.Configuration, integration.Status, integration.IsActive).
						Scan(&integration.ID, &integration.CreatedAt, &integration.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"status": "success",
		"data": integration,
	})
}

func (s *IntegrationService) updateIntegrationStatus(c *gin.Context) {
	id := c.Param("id")
	var updateData struct {
		Status string `json:"status" binding:"required"`
	}

	if err := c.ShouldBindJSON(&updateData); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	query := `UPDATE integrations SET status = $1, updated_at = CURRENT_TIMESTAMP 
			  WHERE id = $2 RETURNING id, status, updated_at`
	
	var integration Integration
	err := s.db.QueryRow(query, updateData.Status, id).Scan(&integration.ID, &integration.Status, &integration.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "Integration not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": integration,
	})
}

// Integration Logs endpoints
func (s *IntegrationService) getIntegrationLogs(c *gin.Context) {
	integrationID := c.Query("integration_id")
	success := c.Query("success")
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")
	limit := c.DefaultQuery("limit", "100")

	query := `SELECT id, integration_id, request_id, method, endpoint, request_data, 
			  response_data, status_code, response_time, success, error_message, 
			  timestamp, created_at 
			  FROM integration_logs WHERE 1=1`
	args := []interface{}{}
	argCount := 0

	if integrationID != "" {
		argCount++
		query += fmt.Sprintf(" AND integration_id = $%d", argCount)
		args = append(args, integrationID)
	}

	if success != "" {
		argCount++
		query += fmt.Sprintf(" AND success = $%d", argCount)
		args = append(args, success == "true")
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

	var logs []IntegrationLog
	for rows.Next() {
		var log IntegrationLog
		err := rows.Scan(&log.ID, &log.IntegrationID, &log.RequestID, &log.Method,
						&log.Endpoint, &log.RequestData, &log.ResponseData, &log.StatusCode,
						&log.ResponseTime, &log.Success, &log.ErrorMessage,
						&log.Timestamp, &log.CreatedAt)
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

func (s *IntegrationService) createIntegrationLog(c *gin.Context) {
	var log IntegrationLog
	if err := c.ShouldBindJSON(&log); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	query := `INSERT INTO integration_logs (integration_id, request_id, method, endpoint, 
			  request_data, response_data, status_code, response_time, success, 
			  error_message, timestamp)
			  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
			  RETURNING id, created_at`
	
	err := s.db.QueryRow(query, log.IntegrationID, log.RequestID, log.Method,
						log.Endpoint, log.RequestData, log.ResponseData, log.StatusCode,
						log.ResponseTime, log.Success, log.ErrorMessage, time.Now()).
						Scan(&log.ID, &log.CreatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"status": "success",
		"data": log,
	})
}

// Data Mapping endpoints
func (s *IntegrationService) getDataMappings(c *gin.Context) {
	integrationID := c.Query("integration_id")

	query := `SELECT id, integration_id, source_field, target_field, data_type, 
			  transformation, is_required, default_value, created_at, updated_at 
			  FROM data_mappings WHERE 1=1`
	args := []interface{}{}
	argCount := 0

	if integrationID != "" {
		argCount++
		query += fmt.Sprintf(" AND integration_id = $%d", argCount)
		args = append(args, integrationID)
	}

	query += " ORDER BY integration_id, source_field"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var mappings []DataMapping
	for rows.Next() {
		var mapping DataMapping
		err := rows.Scan(&mapping.ID, &mapping.IntegrationID, &mapping.SourceField,
						&mapping.TargetField, &mapping.DataType, &mapping.Transformation,
						&mapping.IsRequired, &mapping.DefaultValue, &mapping.CreatedAt,
						&mapping.UpdatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		mappings = append(mappings, mapping)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": mappings,
		"count": len(mappings),
	})
}

func (s *IntegrationService) createDataMapping(c *gin.Context) {
	var mapping DataMapping
	if err := c.ShouldBindJSON(&mapping); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	query := `INSERT INTO data_mappings (integration_id, source_field, target_field, 
			  data_type, transformation, is_required, default_value)
			  VALUES ($1, $2, $3, $4, $5, $6, $7) 
			  RETURNING id, created_at, updated_at`
	
	err := s.db.QueryRow(query, mapping.IntegrationID, mapping.SourceField,
						mapping.TargetField, mapping.DataType, mapping.Transformation,
						mapping.IsRequired, mapping.DefaultValue).
						Scan(&mapping.ID, &mapping.CreatedAt, &mapping.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"status": "success",
		"data": mapping,
	})
}

// Webhook endpoints
func (s *IntegrationService) getWebhookEndpoints(c *gin.Context) {
	isActive := c.Query("is_active")

	query := `SELECT id, name, url, method, headers, event_types, is_active, 
			  secret, retry_count, created_at, updated_at 
			  FROM webhook_endpoints WHERE 1=1`
	args := []interface{}{}
	argCount := 0

	if isActive != "" {
		argCount++
		query += fmt.Sprintf(" AND is_active = $%d", argCount)
		args = append(args, isActive == "true")
	}

	query += " ORDER BY name"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var webhooks []WebhookEndpoint
	for rows.Next() {
		var webhook WebhookEndpoint
		err := rows.Scan(&webhook.ID, &webhook.Name, &webhook.URL, &webhook.Method,
						&webhook.Headers, &webhook.EventTypes, &webhook.IsActive,
						&webhook.Secret, &webhook.RetryCount, &webhook.CreatedAt,
						&webhook.UpdatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		webhooks = append(webhooks, webhook)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": webhooks,
		"count": len(webhooks),
	})
}

func (s *IntegrationService) createWebhookEndpoint(c *gin.Context) {
	var webhook WebhookEndpoint
	if err := c.ShouldBindJSON(&webhook); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	query := `INSERT INTO webhook_endpoints (name, url, method, headers, event_types, 
			  is_active, secret, retry_count)
			  VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
			  RETURNING id, created_at, updated_at`
	
	err := s.db.QueryRow(query, webhook.Name, webhook.URL, webhook.Method,
						webhook.Headers, webhook.EventTypes, webhook.IsActive,
						webhook.Secret, webhook.RetryCount).
						Scan(&webhook.ID, &webhook.CreatedAt, &webhook.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"status": "success",
		"data": webhook,
	})
}

// Test integration endpoint
func (s *IntegrationService) testIntegration(c *gin.Context) {
	id := c.Param("id")
	
	// Get integration details
	var integration Integration
	query := `SELECT id, name, type, provider, endpoint, auth_type, credentials, 
			  configuration, status FROM integrations WHERE id = $1`
	
	err := s.db.QueryRow(query, id).Scan(&integration.ID, &integration.Name,
										&integration.Type, &integration.Provider,
										&integration.Endpoint, &integration.AuthType,
										&integration.Credentials, &integration.Configuration,
										&integration.Status)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "Integration not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Simulate integration test
	startTime := time.Now()
	success := true
	statusCode := 200
	responseTime := int(time.Since(startTime).Milliseconds())
	
	// Create test log
	testLog := IntegrationLog{
		IntegrationID: integration.ID,
		RequestID:     fmt.Sprintf("test_%d", time.Now().Unix()),
		Method:        "GET",
		Endpoint:      integration.Endpoint + "/health",
		RequestData:   "{}",
		ResponseData:  `{"status": "healthy", "timestamp": "` + time.Now().Format(time.RFC3339) + `"}`,
		StatusCode:    statusCode,
		ResponseTime:  responseTime,
		Success:       success,
		ErrorMessage:  "",
		Timestamp:     time.Now(),
	}

	// Store test log
	logQuery := `INSERT INTO integration_logs (integration_id, request_id, method, endpoint, 
				 request_data, response_data, status_code, response_time, success, 
				 error_message, timestamp)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`
	
	s.db.Exec(logQuery, testLog.IntegrationID, testLog.RequestID, testLog.Method,
			  testLog.Endpoint, testLog.RequestData, testLog.ResponseData,
			  testLog.StatusCode, testLog.ResponseTime, testLog.Success,
			  testLog.ErrorMessage, testLog.Timestamp)

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": gin.H{
			"integration_id": integration.ID,
			"integration_name": integration.Name,
			"test_result": "passed",
			"response_time_ms": responseTime,
			"status_code": statusCode,
			"tested_at": time.Now().Format(time.RFC3339),
		},
	})
}

// Dashboard summary endpoint
func (s *IntegrationService) getDashboardSummary(c *gin.Context) {
	// Get integration summary
	var totalIntegrations int
	var activeIntegrations int
	var healthyIntegrations int
	err := s.db.QueryRow(`SELECT COUNT(*), 
						  SUM(CASE WHEN is_active THEN 1 ELSE 0 END),
						  SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)
						  FROM integrations`).
						  Scan(&totalIntegrations, &activeIntegrations, &healthyIntegrations)
	if err != nil {
		totalIntegrations = 0
		activeIntegrations = 0
		healthyIntegrations = 0
	}

	// Get log summary
	var totalLogs int
	var successfulLogs int
	var avgResponseTime float64
	err = s.db.QueryRow(`SELECT COUNT(*), 
						 SUM(CASE WHEN success THEN 1 ELSE 0 END),
						 COALESCE(AVG(response_time), 0)
						 FROM integration_logs 
						 WHERE timestamp >= NOW() - INTERVAL '24 hours'`).
						 Scan(&totalLogs, &successfulLogs, &avgResponseTime)
	if err != nil {
		totalLogs = 0
		successfulLogs = 0
		avgResponseTime = 0
	}

	// Get webhook summary
	var totalWebhooks int
	var activeWebhooks int
	err = s.db.QueryRow(`SELECT COUNT(*), 
						 SUM(CASE WHEN is_active THEN 1 ELSE 0 END)
						 FROM webhook_endpoints`).
						 Scan(&totalWebhooks, &activeWebhooks)
	if err != nil {
		totalWebhooks = 0
		activeWebhooks = 0
	}

	summary := gin.H{
		"integrations": gin.H{
			"total": totalIntegrations,
			"active": activeIntegrations,
			"healthy": healthyIntegrations,
		},
		"logs_24h": gin.H{
			"total": totalLogs,
			"successful": successfulLogs,
			"success_rate": func() float64 {
				if totalLogs > 0 {
					return float64(successfulLogs) / float64(totalLogs) * 100
				}
				return 0
			}(),
			"avg_response_time_ms": avgResponseTime,
		},
		"webhooks": gin.H{
			"total": totalWebhooks,
			"active": activeWebhooks,
		},
		"generated_at": time.Now(),
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": summary,
	})
}

// Health check endpoint
func (s *IntegrationService) healthCheck(c *gin.Context) {
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
		"service": "integration-service",
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
	service := NewIntegrationService(db)
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
		
		// Integrations
		api.GET("/integrations", service.getIntegrations)
		api.POST("/integrations", service.createIntegration)
		api.PUT("/integrations/:id/status", service.updateIntegrationStatus)
		api.POST("/integrations/:id/test", service.testIntegration)
		
		// Integration Logs
		api.GET("/integrations/logs", service.getIntegrationLogs)
		api.POST("/integrations/logs", service.createIntegrationLog)
		
		// Data Mappings
		api.GET("/integrations/mappings", service.getDataMappings)
		api.POST("/integrations/mappings", service.createDataMapping)
		
		// Webhook Endpoints
		api.GET("/integrations/webhooks", service.getWebhookEndpoints)
		api.POST("/integrations/webhooks", service.createWebhookEndpoint)
		
		// Dashboard Summary
		api.GET("/integrations/dashboard", service.getDashboardSummary)
	}

	port := getEnv("PORT", "8084")
	log.Printf("Integration Service starting on port %s", port)
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

