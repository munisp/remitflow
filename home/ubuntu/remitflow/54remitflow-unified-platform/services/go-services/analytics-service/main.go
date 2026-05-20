package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
	_ "github.com/lib/pq"
)

// Analytics models
type TransactionAnalytics struct {
	ID              int       `json:"id" db:"id"`
	AgentID         string    `json:"agent_id" db:"agent_id"`
	TransactionType string    `json:"transaction_type" db:"transaction_type"`
	Amount          float64   `json:"amount" db:"amount"`
	Date            time.Time `json:"date" db:"date"`
	Status          string    `json:"status" db:"status"`
	Channel         string    `json:"channel" db:"channel"`
	Region          string    `json:"region" db:"region"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
}

type PerformanceMetrics struct {
	ID                int       `json:"id" db:"id"`
	AgentID           string    `json:"agent_id" db:"agent_id"`
	TotalTransactions int       `json:"total_transactions" db:"total_transactions"`
	TotalVolume       float64   `json:"total_volume" db:"total_volume"`
	SuccessRate       float64   `json:"success_rate" db:"success_rate"`
	AverageAmount     float64   `json:"average_amount" db:"average_amount"`
	PeakHour          int       `json:"peak_hour" db:"peak_hour"`
	Date              time.Time `json:"date" db:"date"`
	CreatedAt         time.Time `json:"created_at" db:"created_at"`
}

type RevenueAnalytics struct {
	ID            int       `json:"id" db:"id"`
	AgentID       string    `json:"agent_id" db:"agent_id"`
	Commission    float64   `json:"commission" db:"commission"`
	Fees          float64   `json:"fees" db:"fees"`
	TotalRevenue  float64   `json:"total_revenue" db:"total_revenue"`
	Date          time.Time `json:"date" db:"date"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
}

type TrendAnalysis struct {
	ID           int       `json:"id" db:"id"`
	MetricType   string    `json:"metric_type" db:"metric_type"`
	Period       string    `json:"period" db:"period"`
	Value        float64   `json:"value" db:"value"`
	Change       float64   `json:"change" db:"change"`
	Trend        string    `json:"trend" db:"trend"`
	Confidence   float64   `json:"confidence" db:"confidence"`
	Date         time.Time `json:"date" db:"date"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
}

type AnalyticsService struct {
	db *sql.DB
}

func NewAnalyticsService(db *sql.DB) *AnalyticsService {
	return &AnalyticsService{db: db}
}

// Initialize database tables
func (s *AnalyticsService) InitTables() error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS transaction_analytics (
			id SERIAL PRIMARY KEY,
			agent_id VARCHAR(50) NOT NULL,
			transaction_type VARCHAR(50) NOT NULL,
			amount DECIMAL(15,2) NOT NULL,
			date TIMESTAMP NOT NULL,
			status VARCHAR(20) NOT NULL,
			channel VARCHAR(30) NOT NULL,
			region VARCHAR(50) NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS performance_metrics (
			id SERIAL PRIMARY KEY,
			agent_id VARCHAR(50) NOT NULL,
			total_transactions INTEGER NOT NULL,
			total_volume DECIMAL(15,2) NOT NULL,
			success_rate DECIMAL(5,2) NOT NULL,
			average_amount DECIMAL(15,2) NOT NULL,
			peak_hour INTEGER NOT NULL,
			date DATE NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS revenue_analytics (
			id SERIAL PRIMARY KEY,
			agent_id VARCHAR(50) NOT NULL,
			commission DECIMAL(15,2) NOT NULL,
			fees DECIMAL(15,2) NOT NULL,
			total_revenue DECIMAL(15,2) NOT NULL,
			date DATE NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS trend_analysis (
			id SERIAL PRIMARY KEY,
			metric_type VARCHAR(50) NOT NULL,
			period VARCHAR(20) NOT NULL,
			value DECIMAL(15,2) NOT NULL,
			change DECIMAL(10,2) NOT NULL,
			trend VARCHAR(20) NOT NULL,
			confidence DECIMAL(5,2) NOT NULL,
			date DATE NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
	}

	for _, query := range queries {
		if _, err := s.db.Exec(query); err != nil {
			return fmt.Errorf("failed to create table: %v", err)
		}
	}
	return nil
}

// Transaction Analytics endpoints
func (s *AnalyticsService) getTransactionAnalytics(c *gin.Context) {
	agentID := c.Query("agent_id")
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")

	query := `SELECT id, agent_id, transaction_type, amount, date, status, channel, region, created_at 
			  FROM transaction_analytics WHERE 1=1`
	args := []interface{}{}
	argCount := 0

	if agentID != "" {
		argCount++
		query += fmt.Sprintf(" AND agent_id = $%d", argCount)
		args = append(args, agentID)
	}

	if startDate != "" {
		argCount++
		query += fmt.Sprintf(" AND date >= $%d", argCount)
		args = append(args, startDate)
	}

	if endDate != "" {
		argCount++
		query += fmt.Sprintf(" AND date <= $%d", argCount)
		args = append(args, endDate)
	}

	query += " ORDER BY date DESC LIMIT 1000"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var analytics []TransactionAnalytics
	for rows.Next() {
		var ta TransactionAnalytics
		err := rows.Scan(&ta.ID, &ta.AgentID, &ta.TransactionType, &ta.Amount, 
						&ta.Date, &ta.Status, &ta.Channel, &ta.Region, &ta.CreatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		analytics = append(analytics, ta)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": analytics,
		"count": len(analytics),
	})
}

func (s *AnalyticsService) createTransactionAnalytics(c *gin.Context) {
	var ta TransactionAnalytics
	if err := c.ShouldBindJSON(&ta); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	query := `INSERT INTO transaction_analytics (agent_id, transaction_type, amount, date, status, channel, region)
			  VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`
	
	err := s.db.QueryRow(query, ta.AgentID, ta.TransactionType, ta.Amount, 
						ta.Date, ta.Status, ta.Channel, ta.Region).Scan(&ta.ID, &ta.CreatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"status": "success",
		"data": ta,
	})
}

// Performance Metrics endpoints
func (s *AnalyticsService) getPerformanceMetrics(c *gin.Context) {
	agentID := c.Query("agent_id")
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")

	query := `SELECT id, agent_id, total_transactions, total_volume, success_rate, 
			  average_amount, peak_hour, date, created_at FROM performance_metrics WHERE 1=1`
	args := []interface{}{}
	argCount := 0

	if agentID != "" {
		argCount++
		query += fmt.Sprintf(" AND agent_id = $%d", argCount)
		args = append(args, agentID)
	}

	if startDate != "" {
		argCount++
		query += fmt.Sprintf(" AND date >= $%d", argCount)
		args = append(args, startDate)
	}

	if endDate != "" {
		argCount++
		query += fmt.Sprintf(" AND date <= $%d", argCount)
		args = append(args, endDate)
	}

	query += " ORDER BY date DESC LIMIT 1000"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var metrics []PerformanceMetrics
	for rows.Next() {
		var pm PerformanceMetrics
		err := rows.Scan(&pm.ID, &pm.AgentID, &pm.TotalTransactions, &pm.TotalVolume,
						&pm.SuccessRate, &pm.AverageAmount, &pm.PeakHour, &pm.Date, &pm.CreatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		metrics = append(metrics, pm)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": metrics,
		"count": len(metrics),
	})
}

func (s *AnalyticsService) createPerformanceMetrics(c *gin.Context) {
	var pm PerformanceMetrics
	if err := c.ShouldBindJSON(&pm); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	query := `INSERT INTO performance_metrics (agent_id, total_transactions, total_volume, 
			  success_rate, average_amount, peak_hour, date)
			  VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`
	
	err := s.db.QueryRow(query, pm.AgentID, pm.TotalTransactions, pm.TotalVolume,
						pm.SuccessRate, pm.AverageAmount, pm.PeakHour, pm.Date).Scan(&pm.ID, &pm.CreatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"status": "success",
		"data": pm,
	})
}

// Revenue Analytics endpoints
func (s *AnalyticsService) getRevenueAnalytics(c *gin.Context) {
	agentID := c.Query("agent_id")
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")

	query := `SELECT id, agent_id, commission, fees, total_revenue, date, created_at 
			  FROM revenue_analytics WHERE 1=1`
	args := []interface{}{}
	argCount := 0

	if agentID != "" {
		argCount++
		query += fmt.Sprintf(" AND agent_id = $%d", argCount)
		args = append(args, agentID)
	}

	if startDate != "" {
		argCount++
		query += fmt.Sprintf(" AND date >= $%d", argCount)
		args = append(args, startDate)
	}

	if endDate != "" {
		argCount++
		query += fmt.Sprintf(" AND date <= $%d", argCount)
		args = append(args, endDate)
	}

	query += " ORDER BY date DESC LIMIT 1000"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var analytics []RevenueAnalytics
	for rows.Next() {
		var ra RevenueAnalytics
		err := rows.Scan(&ra.ID, &ra.AgentID, &ra.Commission, &ra.Fees, 
						&ra.TotalRevenue, &ra.Date, &ra.CreatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		analytics = append(analytics, ra)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": analytics,
		"count": len(analytics),
	})
}

// Trend Analysis endpoints
func (s *AnalyticsService) getTrendAnalysis(c *gin.Context) {
	metricType := c.Query("metric_type")
	period := c.Query("period")

	query := `SELECT id, metric_type, period, value, change, trend, confidence, date, created_at 
			  FROM trend_analysis WHERE 1=1`
	args := []interface{}{}
	argCount := 0

	if metricType != "" {
		argCount++
		query += fmt.Sprintf(" AND metric_type = $%d", argCount)
		args = append(args, metricType)
	}

	if period != "" {
		argCount++
		query += fmt.Sprintf(" AND period = $%d", argCount)
		args = append(args, period)
	}

	query += " ORDER BY date DESC LIMIT 100"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var trends []TrendAnalysis
	for rows.Next() {
		var ta TrendAnalysis
		err := rows.Scan(&ta.ID, &ta.MetricType, &ta.Period, &ta.Value, 
						&ta.Change, &ta.Trend, &ta.Confidence, &ta.Date, &ta.CreatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		trends = append(trends, ta)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": trends,
		"count": len(trends),
	})
}

// Dashboard summary endpoint
func (s *AnalyticsService) getDashboardSummary(c *gin.Context) {
	agentID := c.Query("agent_id")
	
	// Get transaction summary
	var totalTransactions int
	var totalVolume float64
	var avgSuccessRate float64
	
	query := `SELECT COUNT(*), COALESCE(SUM(amount), 0), 
			  COALESCE(AVG(CASE WHEN status = 'completed' THEN 1.0 ELSE 0.0 END) * 100, 0)
			  FROM transaction_analytics`
	args := []interface{}{}
	
	if agentID != "" {
		query += " WHERE agent_id = $1"
		args = append(args, agentID)
	}
	
	err := s.db.QueryRow(query, args...).Scan(&totalTransactions, &totalVolume, &avgSuccessRate)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Get revenue summary
	var totalRevenue float64
	revenueQuery := `SELECT COALESCE(SUM(total_revenue), 0) FROM revenue_analytics`
	if agentID != "" {
		revenueQuery += " WHERE agent_id = $1"
	}
	
	err = s.db.QueryRow(revenueQuery, args...).Scan(&totalRevenue)
	if err != nil {
		totalRevenue = 0
	}

	summary := gin.H{
		"total_transactions": totalTransactions,
		"total_volume": totalVolume,
		"success_rate": avgSuccessRate,
		"total_revenue": totalRevenue,
		"generated_at": time.Now(),
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": summary,
	})
}

// Health check endpoint
func (s *AnalyticsService) healthCheck(c *gin.Context) {
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
		"service": "analytics-service",
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
	service := NewAnalyticsService(db)
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
		
		// Transaction Analytics
		api.GET("/analytics/transactions", service.getTransactionAnalytics)
		api.POST("/analytics/transactions", service.createTransactionAnalytics)
		
		// Performance Metrics
		api.GET("/analytics/performance", service.getPerformanceMetrics)
		api.POST("/analytics/performance", service.createPerformanceMetrics)
		
		// Revenue Analytics
		api.GET("/analytics/revenue", service.getRevenueAnalytics)
		
		// Trend Analysis
		api.GET("/analytics/trends", service.getTrendAnalysis)
		
		// Dashboard Summary
		api.GET("/analytics/dashboard", service.getDashboardSummary)
	}

	port := getEnv("PORT", "8080")
	log.Printf("Analytics Service starting on port %s", port)
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

