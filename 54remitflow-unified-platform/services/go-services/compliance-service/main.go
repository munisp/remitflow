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

// Compliance models
type ComplianceRule struct {
	ID          int       `json:"id" db:"id"`
	RuleName    string    `json:"rule_name" db:"rule_name"`
	Category    string    `json:"category" db:"category"`
	Framework   string    `json:"framework" db:"framework"`
	Description string    `json:"description" db:"description"`
	Severity    string    `json:"severity" db:"severity"`
	IsActive    bool      `json:"is_active" db:"is_active"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
}

type ComplianceViolation struct {
	ID           int       `json:"id" db:"id"`
	RuleID       int       `json:"rule_id" db:"rule_id"`
	EntityType   string    `json:"entity_type" db:"entity_type"`
	EntityID     string    `json:"entity_id" db:"entity_id"`
	ViolationType string   `json:"violation_type" db:"violation_type"`
	Severity     string    `json:"severity" db:"severity"`
	Description  string    `json:"description" db:"description"`
	Details      string    `json:"details" db:"details"`
	Status       string    `json:"status" db:"status"`
	DetectedAt   time.Time `json:"detected_at" db:"detected_at"`
	ResolvedAt   *time.Time `json:"resolved_at" db:"resolved_at"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
}

type RegulatoryFramework struct {
	ID          int       `json:"id" db:"id"`
	Name        string    `json:"name" db:"name"`
	Code        string    `json:"code" db:"code"`
	Description string    `json:"description" db:"description"`
	Country     string    `json:"country" db:"country"`
	Authority   string    `json:"authority" db:"authority"`
	Version     string    `json:"version" db:"version"`
	IsActive    bool      `json:"is_active" db:"is_active"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
}

type ComplianceReport struct {
	ID            int       `json:"id" db:"id"`
	ReportType    string    `json:"report_type" db:"report_type"`
	Framework     string    `json:"framework" db:"framework"`
	Title         string    `json:"title" db:"title"`
	Period        string    `json:"period" db:"period"`
	StartDate     time.Time `json:"start_date" db:"start_date"`
	EndDate       time.Time `json:"end_date" db:"end_date"`
	Status        string    `json:"status" db:"status"`
	ComplianceScore float64 `json:"compliance_score" db:"compliance_score"`
	TotalRules    int       `json:"total_rules" db:"total_rules"`
	PassedRules   int       `json:"passed_rules" db:"passed_rules"`
	FailedRules   int       `json:"failed_rules" db:"failed_rules"`
	FilePath      string    `json:"file_path" db:"file_path"`
	GeneratedBy   string    `json:"generated_by" db:"generated_by"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
}

type ComplianceService struct {
	db *sql.DB
}

func NewComplianceService(db *sql.DB) *ComplianceService {
	return &ComplianceService{db: db}
}

// Initialize database tables
func (s *ComplianceService) InitTables() error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS regulatory_frameworks (
			id SERIAL PRIMARY KEY,
			name VARCHAR(200) NOT NULL,
			code VARCHAR(50) UNIQUE NOT NULL,
			description TEXT,
			country VARCHAR(100) NOT NULL,
			authority VARCHAR(200) NOT NULL,
			version VARCHAR(20) NOT NULL,
			is_active BOOLEAN DEFAULT true,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS compliance_rules (
			id SERIAL PRIMARY KEY,
			rule_name VARCHAR(200) NOT NULL,
			category VARCHAR(100) NOT NULL,
			framework VARCHAR(50) NOT NULL,
			description TEXT NOT NULL,
			severity VARCHAR(20) NOT NULL,
			is_active BOOLEAN DEFAULT true,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (framework) REFERENCES regulatory_frameworks(code)
		)`,
		`CREATE TABLE IF NOT EXISTS compliance_violations (
			id SERIAL PRIMARY KEY,
			rule_id INTEGER NOT NULL,
			entity_type VARCHAR(50) NOT NULL,
			entity_id VARCHAR(100) NOT NULL,
			violation_type VARCHAR(100) NOT NULL,
			severity VARCHAR(20) NOT NULL,
			description TEXT NOT NULL,
			details TEXT,
			status VARCHAR(20) NOT NULL DEFAULT 'open',
			detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			resolved_at TIMESTAMP,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (rule_id) REFERENCES compliance_rules(id)
		)`,
		`CREATE TABLE IF NOT EXISTS compliance_reports (
			id SERIAL PRIMARY KEY,
			report_type VARCHAR(50) NOT NULL,
			framework VARCHAR(50) NOT NULL,
			title VARCHAR(200) NOT NULL,
			period VARCHAR(50) NOT NULL,
			start_date DATE NOT NULL,
			end_date DATE NOT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'pending',
			compliance_score DECIMAL(5,2) DEFAULT 0.00,
			total_rules INTEGER DEFAULT 0,
			passed_rules INTEGER DEFAULT 0,
			failed_rules INTEGER DEFAULT 0,
			file_path VARCHAR(500),
			generated_by VARCHAR(50) NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (framework) REFERENCES regulatory_frameworks(code)
		)`,
	}

	for _, query := range queries {
		if _, err := s.db.Exec(query); err != nil {
			return fmt.Errorf("failed to create table: %v", err)
		}
	}

	// Insert default regulatory frameworks
	s.insertDefaultFrameworks()
	s.insertDefaultRules()

	return nil
}

func (s *ComplianceService) insertDefaultFrameworks() {
	frameworks := []RegulatoryFramework{
		{
			Name: "Central Bank of Nigeria Guidelines",
			Code: "CBN",
			Description: "Nigerian banking regulations and guidelines",
			Country: "Nigeria",
			Authority: "Central Bank of Nigeria",
			Version: "2023.1",
			IsActive: true,
		},
		{
			Name: "Payment Card Industry Data Security Standard",
			Code: "PCI_DSS",
			Description: "Security standards for organizations that handle credit cards",
			Country: "Global",
			Authority: "PCI Security Standards Council",
			Version: "4.0",
			IsActive: true,
		},
		{
			Name: "General Data Protection Regulation",
			Code: "GDPR",
			Description: "European Union data protection regulation",
			Country: "EU",
			Authority: "European Commission",
			Version: "2018",
			IsActive: true,
		},
		{
			Name: "Sarbanes-Oxley Act",
			Code: "SOX",
			Description: "US federal law for financial reporting",
			Country: "USA",
			Authority: "SEC",
			Version: "2002",
			IsActive: true,
		},
	}

	for _, framework := range frameworks {
		query := `INSERT INTO regulatory_frameworks (name, code, description, country, authority, version, is_active)
				  VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (code) DO NOTHING`
		s.db.Exec(query, framework.Name, framework.Code, framework.Description,
				  framework.Country, framework.Authority, framework.Version, framework.IsActive)
	}
}

func (s *ComplianceService) insertDefaultRules() {
	rules := []ComplianceRule{
		{
			RuleName: "KYC Documentation Required",
			Category: "Customer Onboarding",
			Framework: "CBN",
			Description: "All customers must provide valid KYC documentation",
			Severity: "high",
			IsActive: true,
		},
		{
			RuleName: "Transaction Limit Compliance",
			Category: "Transaction Processing",
			Framework: "CBN",
			Description: "Daily transaction limits must be enforced",
			Severity: "medium",
			IsActive: true,
		},
		{
			RuleName: "Data Encryption at Rest",
			Category: "Data Security",
			Framework: "PCI_DSS",
			Description: "All sensitive data must be encrypted when stored",
			Severity: "critical",
			IsActive: true,
		},
		{
			RuleName: "Data Retention Policy",
			Category: "Data Management",
			Framework: "GDPR",
			Description: "Personal data retention must comply with GDPR requirements",
			Severity: "high",
			IsActive: true,
		},
		{
			RuleName: "Financial Reporting Accuracy",
			Category: "Financial Controls",
			Framework: "SOX",
			Description: "Financial reports must be accurate and complete",
			Severity: "critical",
			IsActive: true,
		},
	}

	for _, rule := range rules {
		query := `INSERT INTO compliance_rules (rule_name, category, framework, description, severity, is_active)
				  VALUES ($1, $2, $3, $4, $5, $6)`
		s.db.Exec(query, rule.RuleName, rule.Category, rule.Framework,
				  rule.Description, rule.Severity, rule.IsActive)
	}
}

// Regulatory Framework endpoints
func (s *ComplianceService) getRegulatoryFrameworks(c *gin.Context) {
	country := c.Query("country")
	isActive := c.Query("is_active")

	query := `SELECT id, name, code, description, country, authority, version, is_active, created_at, updated_at 
			  FROM regulatory_frameworks WHERE 1=1`
	args := []interface{}{}
	argCount := 0

	if country != "" {
		argCount++
		query += fmt.Sprintf(" AND country = $%d", argCount)
		args = append(args, country)
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

	var frameworks []RegulatoryFramework
	for rows.Next() {
		var framework RegulatoryFramework
		err := rows.Scan(&framework.ID, &framework.Name, &framework.Code, &framework.Description,
						&framework.Country, &framework.Authority, &framework.Version, &framework.IsActive,
						&framework.CreatedAt, &framework.UpdatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		frameworks = append(frameworks, framework)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": frameworks,
		"count": len(frameworks),
	})
}

// Compliance Rules endpoints
func (s *ComplianceService) getComplianceRules(c *gin.Context) {
	framework := c.Query("framework")
	category := c.Query("category")
	severity := c.Query("severity")
	isActive := c.Query("is_active")

	query := `SELECT id, rule_name, category, framework, description, severity, is_active, created_at, updated_at 
			  FROM compliance_rules WHERE 1=1`
	args := []interface{}{}
	argCount := 0

	if framework != "" {
		argCount++
		query += fmt.Sprintf(" AND framework = $%d", argCount)
		args = append(args, framework)
	}

	if category != "" {
		argCount++
		query += fmt.Sprintf(" AND category = $%d", argCount)
		args = append(args, category)
	}

	if severity != "" {
		argCount++
		query += fmt.Sprintf(" AND severity = $%d", argCount)
		args = append(args, severity)
	}

	if isActive != "" {
		argCount++
		query += fmt.Sprintf(" AND is_active = $%d", argCount)
		args = append(args, isActive == "true")
	}

	query += " ORDER BY severity DESC, rule_name"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var rules []ComplianceRule
	for rows.Next() {
		var rule ComplianceRule
		err := rows.Scan(&rule.ID, &rule.RuleName, &rule.Category, &rule.Framework,
						&rule.Description, &rule.Severity, &rule.IsActive,
						&rule.CreatedAt, &rule.UpdatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		rules = append(rules, rule)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": rules,
		"count": len(rules),
	})
}

func (s *ComplianceService) createComplianceRule(c *gin.Context) {
	var rule ComplianceRule
	if err := c.ShouldBindJSON(&rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	query := `INSERT INTO compliance_rules (rule_name, category, framework, description, severity, is_active)
			  VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at, updated_at`
	
	err := s.db.QueryRow(query, rule.RuleName, rule.Category, rule.Framework,
						rule.Description, rule.Severity, rule.IsActive).
						Scan(&rule.ID, &rule.CreatedAt, &rule.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"status": "success",
		"data": rule,
	})
}

// Compliance Violations endpoints
func (s *ComplianceService) getComplianceViolations(c *gin.Context) {
	entityType := c.Query("entity_type")
	entityID := c.Query("entity_id")
	severity := c.Query("severity")
	status := c.Query("status")
	limit := c.DefaultQuery("limit", "100")

	query := `SELECT id, rule_id, entity_type, entity_id, violation_type, severity, 
			  description, details, status, detected_at, resolved_at, created_at 
			  FROM compliance_violations WHERE 1=1`
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

	argCount++
	query += fmt.Sprintf(" ORDER BY detected_at DESC LIMIT $%d", argCount)
	args = append(args, limit)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var violations []ComplianceViolation
	for rows.Next() {
		var violation ComplianceViolation
		err := rows.Scan(&violation.ID, &violation.RuleID, &violation.EntityType, &violation.EntityID,
						&violation.ViolationType, &violation.Severity, &violation.Description, &violation.Details,
						&violation.Status, &violation.DetectedAt, &violation.ResolvedAt, &violation.CreatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		violations = append(violations, violation)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": violations,
		"count": len(violations),
	})
}

func (s *ComplianceService) createComplianceViolation(c *gin.Context) {
	var violation ComplianceViolation
	if err := c.ShouldBindJSON(&violation); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	query := `INSERT INTO compliance_violations (rule_id, entity_type, entity_id, violation_type, 
			  severity, description, details, status, detected_at)
			  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, created_at`
	
	err := s.db.QueryRow(query, violation.RuleID, violation.EntityType, violation.EntityID,
						violation.ViolationType, violation.Severity, violation.Description,
						violation.Details, violation.Status, time.Now()).
						Scan(&violation.ID, &violation.CreatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"status": "success",
		"data": violation,
	})
}

// Compliance Reports endpoints
func (s *ComplianceService) getComplianceReports(c *gin.Context) {
	framework := c.Query("framework")
	reportType := c.Query("report_type")
	status := c.Query("status")
	limit := c.DefaultQuery("limit", "50")

	query := `SELECT id, report_type, framework, title, period, start_date, end_date, 
			  status, compliance_score, total_rules, passed_rules, failed_rules, 
			  file_path, generated_by, created_at 
			  FROM compliance_reports WHERE 1=1`
	args := []interface{}{}
	argCount := 0

	if framework != "" {
		argCount++
		query += fmt.Sprintf(" AND framework = $%d", argCount)
		args = append(args, framework)
	}

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

	var reports []ComplianceReport
	for rows.Next() {
		var report ComplianceReport
		err := rows.Scan(&report.ID, &report.ReportType, &report.Framework, &report.Title,
						&report.Period, &report.StartDate, &report.EndDate, &report.Status,
						&report.ComplianceScore, &report.TotalRules, &report.PassedRules,
						&report.FailedRules, &report.FilePath, &report.GeneratedBy, &report.CreatedAt)
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
func (s *ComplianceService) getDashboardSummary(c *gin.Context) {
	framework := c.Query("framework")

	// Get total rules
	var totalRules int
	var activeRules int
	ruleQuery := `SELECT COUNT(*), SUM(CASE WHEN is_active THEN 1 ELSE 0 END) FROM compliance_rules`
	args := []interface{}{}
	
	if framework != "" {
		ruleQuery += " WHERE framework = $1"
		args = append(args, framework)
	}
	
	err := s.db.QueryRow(ruleQuery, args...).Scan(&totalRules, &activeRules)
	if err != nil {
		totalRules = 0
		activeRules = 0
	}

	// Get violations summary
	var totalViolations int
	var openViolations int
	var criticalViolations int
	violationQuery := `SELECT COUNT(*), 
					   SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END),
					   SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END)
					   FROM compliance_violations 
					   WHERE detected_at >= NOW() - INTERVAL '30 days'`
	
	err = s.db.QueryRow(violationQuery).Scan(&totalViolations, &openViolations, &criticalViolations)
	if err != nil {
		totalViolations = 0
		openViolations = 0
		criticalViolations = 0
	}

	// Calculate compliance score
	complianceScore := 100.0
	if totalRules > 0 {
		violationRate := float64(openViolations) / float64(totalRules)
		complianceScore = (1.0 - violationRate) * 100.0
		if complianceScore < 0 {
			complianceScore = 0
		}
	}

	summary := gin.H{
		"rules": gin.H{
			"total": totalRules,
			"active": activeRules,
		},
		"violations": gin.H{
			"total": totalViolations,
			"open": openViolations,
			"critical": criticalViolations,
		},
		"compliance_score": complianceScore,
		"generated_at": time.Now(),
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": summary,
	})
}

// Health check endpoint
func (s *ComplianceService) healthCheck(c *gin.Context) {
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
		"service": "compliance-service",
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
	service := NewComplianceService(db)
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
		
		// Regulatory Frameworks
		api.GET("/compliance/frameworks", service.getRegulatoryFrameworks)
		
		// Compliance Rules
		api.GET("/compliance/rules", service.getComplianceRules)
		api.POST("/compliance/rules", service.createComplianceRule)
		
		// Compliance Violations
		api.GET("/compliance/violations", service.getComplianceViolations)
		api.POST("/compliance/violations", service.createComplianceViolation)
		
		// Compliance Reports
		api.GET("/compliance/reports", service.getComplianceReports)
		
		// Dashboard Summary
		api.GET("/compliance/dashboard", service.getDashboardSummary)
	}

	port := getEnv("PORT", "8082")
	log.Printf("Compliance Service starting on port %s", port)
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

