import os
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
	_ "github.com/lib/pq"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// Configuration
type Config struct {
	Port        string `json:"port"`
	DatabaseURL string `json:"database_url"`
	RedisURL    string `json:"redis_url"`
}

// Service structure
type ReportingService struct {
	config      *Config
	logger      *zap.Logger
	db          *sql.DB
	redisClient *redis.Client
	router      *gin.Engine
	metrics     *Metrics
}

// Metrics structure
type Metrics struct {
	ReportsGenerated *prometheus.CounterVec
	QueryDuration    *prometheus.HistogramVec
	CacheHits        prometheus.Counter
	CacheMisses      prometheus.Counter
}

// Report structures
type ReportRequest struct {
	ReportType  string                 `json:"report_type" binding:"required"`
	DateFrom    time.Time              `json:"date_from" binding:"required"`
	DateTo      time.Time              `json:"date_to" binding:"required"`
	Filters     map[string]interface{} `json:"filters"`
	GroupBy     []string               `json:"group_by"`
	Aggregation string                 `json:"aggregation"`
	Format      string                 `json:"format"`
}

type ReportResponse struct {
	ReportID    string      `json:"report_id"`
	ReportType  string      `json:"report_type"`
	Status      string      `json:"status"`
	Data        interface{} `json:"data"`
	Metadata    Metadata    `json:"metadata"`
	GeneratedAt time.Time   `json:"generated_at"`
	ExpiresAt   time.Time   `json:"expires_at"`
}

type Metadata struct {
	TotalRecords int           `json:"total_records"`
	QueryTime    time.Duration `json:"query_time"`
	Cached       bool          `json:"cached"`
	Filters      interface{}   `json:"filters"`
	GroupBy      []string      `json:"group_by"`
}

// Dashboard structures
type DashboardData struct {
	KPIs         map[string]interface{} `json:"kpis"`
	Charts       []ChartData            `json:"charts"`
	Tables       []TableData            `json:"tables"`
	Alerts       []AlertData            `json:"alerts"`
	LastUpdated  time.Time              `json:"last_updated"`
}

type ChartData struct {
	ID          string                 `json:"id"`
	Title       string                 `json:"title"`
	Type        string                 `json:"type"`
	Data        []map[string]interface{} `json:"data"`
	Config      map[string]interface{} `json:"config"`
}

type TableData struct {
	ID      string                   `json:"id"`
	Title   string                   `json:"title"`
	Headers []string                 `json:"headers"`
	Rows    [][]interface{}          `json:"rows"`
	Config  map[string]interface{}   `json:"config"`
}

type AlertData struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`
	Severity    string    `json:"severity"`
	Message     string    `json:"message"`
	Timestamp   time.Time `json:"timestamp"`
	Acknowledged bool     `json:"acknowledged"`
}

// Analytics structures
type AnalyticsQuery struct {
	Metric      string                 `json:"metric"`
	Dimensions  []string               `json:"dimensions"`
	Filters     map[string]interface{} `json:"filters"`
	DateRange   DateRange              `json:"date_range"`
	Granularity string                 `json:"granularity"`
}

type DateRange struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
}

type AnalyticsResult struct {
	Metric      string                   `json:"metric"`
	Data        []map[string]interface{} `json:"data"`
	Summary     map[string]interface{}   `json:"summary"`
	Trends      map[string]interface{}   `json:"trends"`
	QueryTime   time.Duration            `json:"query_time"`
}

// Transaction Analytics
type TransactionAnalytics struct {
	TotalVolume        float64                `json:"total_volume"`
	TotalCount         int64                  `json:"total_count"`
	AverageAmount      float64                `json:"average_amount"`
	SuccessRate        float64                `json:"success_rate"`
	FraudRate          float64                `json:"fraud_rate"`
	TopChannels        []ChannelMetric        `json:"top_channels"`
	HourlyDistribution []HourlyMetric         `json:"hourly_distribution"`
	GeographicData     []GeographicMetric     `json:"geographic_data"`
	TrendData          []TrendMetric          `json:"trend_data"`
}

type ChannelMetric struct {
	Channel string  `json:"channel"`
	Volume  float64 `json:"volume"`
	Count   int64   `json:"count"`
	Share   float64 `json:"share"`
}

type HourlyMetric struct {
	Hour   int     `json:"hour"`
	Volume float64 `json:"volume"`
	Count  int64   `json:"count"`
}

type GeographicMetric struct {
	Region string  `json:"region"`
	Volume float64 `json:"volume"`
	Count  int64   `json:"count"`
	Lat    float64 `json:"lat"`
	Lng    float64 `json:"lng"`
}

type TrendMetric struct {
	Date   time.Time `json:"date"`
	Volume float64   `json:"volume"`
	Count  int64     `json:"count"`
}

// Agent Performance Analytics
type AgentPerformance struct {
	AgentID             string                 `json:"agent_id"`
	AgentName           string                 `json:"agent_name"`
	TransactionVolume   float64                `json:"transaction_volume"`
	TransactionCount    int64                  `json:"transaction_count"`
	CommissionEarned    float64                `json:"commission_earned"`
	CustomerCount       int64                  `json:"customer_count"`
	SuccessRate         float64                `json:"success_rate"`
	AverageResponseTime time.Duration          `json:"average_response_time"`
	Rating              float64                `json:"rating"`
	Ranking             int                    `json:"ranking"`
	Trends              []AgentTrendMetric     `json:"trends"`
}

type AgentTrendMetric struct {
	Date   time.Time `json:"date"`
	Volume float64   `json:"volume"`
	Count  int64     `json:"count"`
}

func main() {
	// Initialize logger
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	// Load configuration
	config := loadConfig()

	// Initialize service
	service := &ReportingService{
		config: config,
		logger: logger,
	}

	// Initialize components
	if err := service.initialize(); err != nil {
		logger.Fatal("Failed to initialize service", zap.Error(err))
	}

	// Setup routes
	service.setupRoutes()

	// Start server
	service.start()
}

func loadConfig() *Config {
	return &Config{
		Port:        getEnv("PORT", "8089"),
		DatabaseURL: getEnv("DATABASE_URL", "postgres://user:password@os.getenv("HOST", "os.getenv("HOST", "localhost")")/remittance?sslmode=disable"),
		RedisURL:    getEnv("REDIS_URL", "redis://os.getenv("HOST", "os.getenv("HOST", "localhost")"):6379"),
	}
}

func (rs *ReportingService) initialize() error {
	// Initialize database
	var err error
	rs.db, err = sql.Open("postgres", rs.config.DatabaseURL)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	if err := rs.db.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	// Initialize Redis
	opt, err := redis.ParseURL(rs.config.RedisURL)
	if err != nil {
		return fmt.Errorf("failed to parse Redis URL: %w", err)
	}
	rs.redisClient = redis.NewClient(opt)

	// Test Redis connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := rs.redisClient.Ping(ctx).Err(); err != nil {
		rs.logger.Warn("Redis connection failed, continuing without cache", zap.Error(err))
	}

	// Initialize metrics
	rs.initializeMetrics()

	// Initialize Gin router
	if os.Getenv("GIN_MODE") == "production" {
		gin.SetMode(gin.ReleaseMode)
	}
	rs.router = gin.New()
	rs.router.Use(gin.Recovery())
	rs.router.Use(gin.Logger())

	// Setup CORS
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Type", "Authorization"}
	rs.router.Use(cors.New(config))

	return nil
}

func (rs *ReportingService) initializeMetrics() {
	rs.metrics = &Metrics{
		ReportsGenerated: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "reports_generated_total",
				Help: "Total number of reports generated",
			},
			[]string{"report_type", "format"},
		),
		QueryDuration: prometheus.NewHistogramVec(
			prometheus.HistogramOpts{
				Name:    "query_duration_seconds",
				Help:    "Query execution duration",
				Buckets: prometheus.DefBuckets,
			},
			[]string{"query_type"},
		),
		CacheHits: prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "cache_hits_total",
				Help: "Total number of cache hits",
			},
		),
		CacheMisses: prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "cache_misses_total",
				Help: "Total number of cache misses",
			},
		),
	}

	prometheus.MustRegister(
		rs.metrics.ReportsGenerated,
		rs.metrics.QueryDuration,
		rs.metrics.CacheHits,
		rs.metrics.CacheMisses,
	)
}

func (rs *ReportingService) setupRoutes() {
	// Health check
	rs.router.GET("/health", rs.healthCheckHandler)

	// Metrics
	rs.router.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// API routes
	api := rs.router.Group("/api/v1")
	{
		// Reports
		reports := api.Group("/reports")
		{
			reports.POST("/generate", rs.generateReportHandler)
			reports.GET("/:report_id", rs.getReportHandler)
			reports.GET("", rs.listReportsHandler)
			reports.DELETE("/:report_id", rs.deleteReportHandler)
		}

		// Dashboard
		dashboard := api.Group("/dashboard")
		{
			dashboard.GET("/overview", rs.dashboardOverviewHandler)
			dashboard.GET("/transactions", rs.transactionDashboardHandler)
			dashboard.GET("/agents", rs.agentDashboardHandler)
			dashboard.GET("/fraud", rs.fraudDashboardHandler)
			dashboard.GET("/financial", rs.financialDashboardHandler)
		}

		// Analytics
		analytics := api.Group("/analytics")
		{
			analytics.POST("/query", rs.analyticsQueryHandler)
			analytics.GET("/transactions", rs.transactionAnalyticsHandler)
			analytics.GET("/agents/performance", rs.agentPerformanceHandler)
			analytics.GET("/customers", rs.customerAnalyticsHandler)
			analytics.GET("/fraud", rs.fraudAnalyticsHandler)
			analytics.GET("/financial", rs.financialAnalyticsHandler)
			analytics.GET("/geographic", rs.geographicAnalyticsHandler)
		}

		// Real-time data
		realtime := api.Group("/realtime")
		{
			realtime.GET("/transactions", rs.realtimeTransactionsHandler)
			realtime.GET("/alerts", rs.realtimeAlertsHandler)
			realtime.GET("/kpis", rs.realtimeKPIsHandler)
		}

		// Export
		export := api.Group("/export")
		{
			export.POST("/csv", rs.exportCSVHandler)
			export.POST("/excel", rs.exportExcelHandler)
			export.POST("/pdf", rs.exportPDFHandler)
		}
	}
}

// Handler implementations
func (rs *ReportingService) healthCheckHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"timestamp": time.Now(),
		"service":   "reporting-analytics",
		"version":   "2.0.0",
	})
}

func (rs *ReportingService) generateReportHandler(c *gin.Context) {
	var req ReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Generate report ID
	reportID := fmt.Sprintf("report_%d", time.Now().Unix())

	// Check cache first
	cacheKey := rs.generateCacheKey(&req)
	if rs.redisClient != nil {
		cached, err := rs.redisClient.Get(c.Request.Context(), cacheKey).Result()
		if err == nil {
			rs.metrics.CacheHits.Inc()
			var cachedReport ReportResponse
			if json.Unmarshal([]byte(cached), &cachedReport) == nil {
				cachedReport.ReportID = reportID
				c.JSON(http.StatusOK, cachedReport)
				return
			}
		}
		rs.metrics.CacheMisses.Inc()
	}

	// Generate report
	start := time.Now()
	data, err := rs.generateReportData(&req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	queryTime := time.Since(start)

	response := ReportResponse{
		ReportID:    reportID,
		ReportType:  req.ReportType,
		Status:      "completed",
		Data:        data,
		Metadata: Metadata{
			TotalRecords: len(data.([]map[string]interface{})),
			QueryTime:    queryTime,
			Cached:       false,
			Filters:      req.Filters,
			GroupBy:      req.GroupBy,
		},
		GeneratedAt: time.Now(),
		ExpiresAt:   time.Now().Add(24 * time.Hour),
	}

	// Cache the result
	if rs.redisClient != nil {
		responseBytes, _ := json.Marshal(response)
		rs.redisClient.Set(c.Request.Context(), cacheKey, responseBytes, time.Hour)
	}

	// Record metrics
	rs.metrics.ReportsGenerated.WithLabelValues(req.ReportType, req.Format).Inc()
	rs.metrics.QueryDuration.WithLabelValues("report_generation").Observe(queryTime.Seconds())

	c.JSON(http.StatusOK, response)
}

func (rs *ReportingService) getReportHandler(c *gin.Context) {
	reportID := c.Param("report_id")
	
	// In a real implementation, you would fetch from database
	c.JSON(http.StatusOK, gin.H{
		"report_id": reportID,
		"status":    "completed",
		"message":   "Report retrieved successfully",
	})
}

func (rs *ReportingService) listReportsHandler(c *gin.Context) {
	// Query parameters
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	reportType := c.Query("report_type")

	// Build query
	query := `
		SELECT report_id, report_type, status, generated_at, expires_at
		FROM reports 
		WHERE 1=1
	`
	args := []interface{}{}
	argIndex := 1

	if reportType != "" {
		query += fmt.Sprintf(" AND report_type = $%d", argIndex)
		args = append(args, reportType)
		argIndex++
	}

	query += fmt.Sprintf(" ORDER BY generated_at DESC LIMIT $%d OFFSET $%d", argIndex, argIndex+1)
	args = append(args, limit, (page-1)*limit)

	rows, err := rs.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var reports []map[string]interface{}
	for rows.Next() {
		var reportID, reportType, status string
		var generatedAt, expiresAt time.Time
		
		if err := rows.Scan(&reportID, &reportType, &status, &generatedAt, &expiresAt); err != nil {
			continue
		}

		reports = append(reports, map[string]interface{}{
			"report_id":    reportID,
			"report_type":  reportType,
			"status":       status,
			"generated_at": generatedAt,
			"expires_at":   expiresAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"reports": reports,
		"page":    page,
		"limit":   limit,
		"total":   len(reports),
	})
}

func (rs *ReportingService) deleteReportHandler(c *gin.Context) {
	reportID := c.Param("report_id")
	
	// Delete from database
	_, err := rs.db.Exec("DELETE FROM reports WHERE report_id = $1", reportID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Report deleted successfully"})
}

func (rs *ReportingService) dashboardOverviewHandler(c *gin.Context) {
	dashboard := DashboardData{
		KPIs: map[string]interface{}{
			"total_transactions":    rs.getTotalTransactions(),
			"total_volume":         rs.getTotalVolume(),
			"active_agents":        rs.getActiveAgents(),
			"success_rate":         rs.getSuccessRate(),
			"fraud_rate":           rs.getFraudRate(),
			"average_amount":       rs.getAverageTransactionAmount(),
		},
		Charts: []ChartData{
			{
				ID:    "transaction_trends",
				Title: "Transaction Trends",
				Type:  "line",
				Data:  rs.getTransactionTrends(),
			},
			{
				ID:    "channel_distribution",
				Title: "Channel Distribution",
				Type:  "pie",
				Data:  rs.getChannelDistribution(),
			},
		},
		Tables: []TableData{
			{
				ID:      "top_agents",
				Title:   "Top Performing Agents",
				Headers: []string{"Agent", "Volume", "Count", "Success Rate"},
				Rows:    rs.getTopAgents(),
			},
		},
		Alerts:      rs.getActiveAlerts(),
		LastUpdated: time.Now(),
	}

	c.JSON(http.StatusOK, dashboard)
}

func (rs *ReportingService) transactionDashboardHandler(c *gin.Context) {
	analytics := rs.getTransactionAnalytics(c.Query("date_from"), c.Query("date_to"))
	c.JSON(http.StatusOK, analytics)
}

func (rs *ReportingService) agentDashboardHandler(c *gin.Context) {
	agents := rs.getAgentPerformanceData()
	c.JSON(http.StatusOK, gin.H{"agents": agents})
}

func (rs *ReportingService) fraudDashboardHandler(c *gin.Context) {
	fraudData := rs.getFraudAnalytics()
	c.JSON(http.StatusOK, fraudData)
}

func (rs *ReportingService) financialDashboardHandler(c *gin.Context) {
	financialData := rs.getFinancialAnalytics()
	c.JSON(http.StatusOK, financialData)
}

func (rs *ReportingService) analyticsQueryHandler(c *gin.Context) {
	var query AnalyticsQuery
	if err := c.ShouldBindJSON(&query); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	start := time.Now()
	result := rs.executeAnalyticsQuery(&query)
	result.QueryTime = time.Since(start)

	rs.metrics.QueryDuration.WithLabelValues("analytics_query").Observe(result.QueryTime.Seconds())

	c.JSON(http.StatusOK, result)
}

func (rs *ReportingService) transactionAnalyticsHandler(c *gin.Context) {
	analytics := rs.getTransactionAnalytics(c.Query("date_from"), c.Query("date_to"))
	c.JSON(http.StatusOK, analytics)
}

func (rs *ReportingService) agentPerformanceHandler(c *gin.Context) {
	performance := rs.getAgentPerformanceData()
	c.JSON(http.StatusOK, performance)
}

func (rs *ReportingService) customerAnalyticsHandler(c *gin.Context) {
	analytics := rs.getCustomerAnalytics()
	c.JSON(http.StatusOK, analytics)
}

func (rs *ReportingService) fraudAnalyticsHandler(c *gin.Context) {
	analytics := rs.getFraudAnalytics()
	c.JSON(http.StatusOK, analytics)
}

func (rs *ReportingService) financialAnalyticsHandler(c *gin.Context) {
	analytics := rs.getFinancialAnalytics()
	c.JSON(http.StatusOK, analytics)
}

func (rs *ReportingService) geographicAnalyticsHandler(c *gin.Context) {
	analytics := rs.getGeographicAnalytics()
	c.JSON(http.StatusOK, analytics)
}

func (rs *ReportingService) realtimeTransactionsHandler(c *gin.Context) {
	transactions := rs.getRealtimeTransactions()
	c.JSON(http.StatusOK, gin.H{"transactions": transactions})
}

func (rs *ReportingService) realtimeAlertsHandler(c *gin.Context) {
	alerts := rs.getRealtimeAlerts()
	c.JSON(http.StatusOK, gin.H{"alerts": alerts})
}

func (rs *ReportingService) realtimeKPIsHandler(c *gin.Context) {
	kpis := rs.getRealtimeKPIs()
	c.JSON(http.StatusOK, gin.H{"kpis": kpis})
}

func (rs *ReportingService) exportCSVHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "CSV export functionality"})
}

func (rs *ReportingService) exportExcelHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "Excel export functionality"})
}

func (rs *ReportingService) exportPDFHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "PDF export functionality"})
}

// Helper functions for data generation
func (rs *ReportingService) generateReportData(req *ReportRequest) (interface{}, error) {
	// Mock data generation based on report type
	switch req.ReportType {
	case "transaction_summary":
		return rs.generateTransactionSummary(req)
	case "agent_performance":
		return rs.generateAgentPerformanceReport(req)
	case "fraud_analysis":
		return rs.generateFraudAnalysisReport(req)
	case "financial_summary":
		return rs.generateFinancialSummaryReport(req)
	default:
		return nil, fmt.Errorf("unsupported report type: %s", req.ReportType)
	}
}

func (rs *ReportingService) generateTransactionSummary(req *ReportRequest) ([]map[string]interface{}, error) {
	query := `
		SELECT 
			DATE(created_at) as date,
			COUNT(*) as transaction_count,
			SUM(amount) as total_volume,
			AVG(amount) as average_amount,
			COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_transactions
		FROM transactions 
		WHERE created_at BETWEEN $1 AND $2
		GROUP BY DATE(created_at)
		ORDER BY date DESC
	`

	rows, err := rs.db.Query(query, req.DateFrom, req.DateTo)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var date time.Time
		var count int64
		var volume, average float64
		var successful int64

		if err := rows.Scan(&date, &count, &volume, &average, &successful); err != nil {
			continue
		}

		results = append(results, map[string]interface{}{
			"date":                   date,
			"transaction_count":      count,
			"total_volume":          volume,
			"average_amount":        average,
			"successful_transactions": successful,
			"success_rate":          float64(successful) / float64(count) * 100,
		})
	}

	return results, nil
}

func (rs *ReportingService) generateAgentPerformanceReport(req *ReportRequest) ([]map[string]interface{}, error) {
	// Mock implementation
	return []map[string]interface{}{
		{
			"agent_id":           "AGT001",
			"agent_name":         "John Doe",
			"transaction_volume": 150000.00,
			"transaction_count":  250,
			"commission_earned":  1500.00,
			"success_rate":       98.5,
		},
	}, nil
}

func (rs *ReportingService) generateFraudAnalysisReport(req *ReportRequest) ([]map[string]interface{}, error) {
	// Mock implementation
	return []map[string]interface{}{
		{
			"date":           time.Now().Format("2006-01-02"),
			"fraud_alerts":   15,
			"blocked_amount": 25000.00,
			"fraud_rate":     0.8,
		},
	}, nil
}

func (rs *ReportingService) generateFinancialSummaryReport(req *ReportRequest) ([]map[string]interface{}, error) {
	// Mock implementation
	return []map[string]interface{}{
		{
			"total_revenue":    50000.00,
			"total_commission": 5000.00,
			"net_profit":       45000.00,
			"margin":           90.0,
		},
	}, nil
}

// Mock data functions
func (rs *ReportingService) getTotalTransactions() int64 {
	var count int64
	rs.db.QueryRow("SELECT COUNT(*) FROM transactions WHERE DATE(created_at) = CURRENT_DATE").Scan(&count)
	return count
}

func (rs *ReportingService) getTotalVolume() float64 {
	var volume float64
	rs.db.QueryRow("SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE DATE(created_at) = CURRENT_DATE").Scan(&volume)
	return volume
}

func (rs *ReportingService) getActiveAgents() int64 {
	var count int64
	rs.db.QueryRow("SELECT COUNT(DISTINCT agent_id) FROM transactions WHERE DATE(created_at) = CURRENT_DATE").Scan(&count)
	return count
}

func (rs *ReportingService) getSuccessRate() float64 {
	var rate float64
	rs.db.QueryRow(`
		SELECT 
			COALESCE(
				COUNT(CASE WHEN status = 'completed' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0),
				0
			)
		FROM transactions 
		WHERE DATE(created_at) = CURRENT_DATE
	`).Scan(&rate)
	return rate
}

func (rs *ReportingService) getFraudRate() float64 {
	// Mock implementation
	return 0.5
}

func (rs *ReportingService) getAverageTransactionAmount() float64 {
	var avg float64
	rs.db.QueryRow("SELECT COALESCE(AVG(amount), 0) FROM transactions WHERE DATE(created_at) = CURRENT_DATE").Scan(&avg)
	return avg
}

func (rs *ReportingService) getTransactionTrends() []map[string]interface{} {
	// Mock implementation
	return []map[string]interface{}{
		{"date": "2024-01-01", "volume": 100000, "count": 150},
		{"date": "2024-01-02", "volume": 120000, "count": 180},
	}
}

func (rs *ReportingService) getChannelDistribution() []map[string]interface{} {
	// Mock implementation
	return []map[string]interface{}{
		{"channel": "Mobile", "percentage": 45},
		{"channel": "Web", "percentage": 30},
		{"channel": "USSD", "percentage": 25},
	}
}

func (rs *ReportingService) getTopAgents() [][]interface{} {
	// Mock implementation
	return [][]interface{}{
		{"John Doe", 150000, 250, 98.5},
		{"Jane Smith", 140000, 230, 97.8},
	}
}

func (rs *ReportingService) getActiveAlerts() []AlertData {
	// Mock implementation
	return []AlertData{
		{
			ID:        "alert_001",
			Type:      "fraud",
			Severity:  "high",
			Message:   "Suspicious transaction pattern detected",
			Timestamp: time.Now(),
		},
	}
}

func (rs *ReportingService) getTransactionAnalytics(dateFrom, dateTo string) TransactionAnalytics {
	// Mock implementation
	return TransactionAnalytics{
		TotalVolume:   500000.00,
		TotalCount:    1000,
		AverageAmount: 500.00,
		SuccessRate:   98.5,
		FraudRate:     0.5,
	}
}

func (rs *ReportingService) getAgentPerformanceData() []AgentPerformance {
	// Mock implementation
	return []AgentPerformance{
		{
			AgentID:           "AGT001",
			AgentName:         "John Doe",
			TransactionVolume: 150000,
			TransactionCount:  250,
			CommissionEarned:  1500,
			SuccessRate:       98.5,
			Rating:            4.8,
			Ranking:           1,
		},
	}
}

func (rs *ReportingService) getFraudAnalytics() map[string]interface{} {
	return map[string]interface{}{
		"total_alerts":     25,
		"blocked_amount":   50000.00,
		"fraud_rate":       0.8,
		"false_positives":  2,
	}
}

func (rs *ReportingService) getFinancialAnalytics() map[string]interface{} {
	return map[string]interface{}{
		"total_revenue":    100000.00,
		"total_commission": 10000.00,
		"net_profit":       90000.00,
		"margin":           90.0,
	}
}

func (rs *ReportingService) getCustomerAnalytics() map[string]interface{} {
	return map[string]interface{}{
		"total_customers":   5000,
		"active_customers":  4500,
		"new_customers":     100,
		"churn_rate":        2.5,
	}
}

func (rs *ReportingService) getGeographicAnalytics() []GeographicMetric {
	return []GeographicMetric{
		{Region: "Lagos", Volume: 200000, Count: 400, Lat: 6.5244, Lng: 3.3792},
		{Region: "Abuja", Volume: 150000, Count: 300, Lat: 9.0765, Lng: 7.3986},
	}
}

func (rs *ReportingService) getRealtimeTransactions() []map[string]interface{} {
	return []map[string]interface{}{
		{
			"id":        "TXN001",
			"amount":    1000.00,
			"status":    "completed",
			"timestamp": time.Now(),
		},
	}
}

func (rs *ReportingService) getRealtimeAlerts() []AlertData {
	return rs.getActiveAlerts()
}

func (rs *ReportingService) getRealtimeKPIs() map[string]interface{} {
	return map[string]interface{}{
		"transactions_per_minute": 15,
		"success_rate":           98.5,
		"average_response_time":  250,
	}
}

func (rs *ReportingService) executeAnalyticsQuery(query *AnalyticsQuery) AnalyticsResult {
	// Mock implementation
	return AnalyticsResult{
		Metric: query.Metric,
		Data: []map[string]interface{}{
			{"value": 100, "timestamp": time.Now()},
		},
		Summary: map[string]interface{}{
			"total": 100,
			"average": 50,
		},
	}
}

func (rs *ReportingService) generateCacheKey(req *ReportRequest) string {
	return fmt.Sprintf("report:%s:%s:%s", req.ReportType, req.DateFrom.Format("2006-01-02"), req.DateTo.Format("2006-01-02"))
}

func (rs *ReportingService) start() {
	rs.logger.Info("Starting Reporting & Analytics Service", zap.String("port", rs.config.Port))
	log.Fatal(rs.router.Run(":" + rs.config.Port))
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

