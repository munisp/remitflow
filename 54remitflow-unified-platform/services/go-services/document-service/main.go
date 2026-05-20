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

// Document models
type Document struct {
	ID           int       `json:"id" db:"id"`
	DocumentType string    `json:"document_type" db:"document_type"`
	Title        string    `json:"title" db:"title"`
	Description  string    `json:"description" db:"description"`
	FilePath     string    `json:"file_path" db:"file_path"`
	FileSize     int64     `json:"file_size" db:"file_size"`
	MimeType     string    `json:"mime_type" db:"mime_type"`
	EntityType   string    `json:"entity_type" db:"entity_type"`
	EntityID     string    `json:"entity_id" db:"entity_id"`
	UploadedBy   string    `json:"uploaded_by" db:"uploaded_by"`
	Status       string    `json:"status" db:"status"`
	Version      int       `json:"version" db:"version"`
	Tags         string    `json:"tags" db:"tags"`
	Metadata     string    `json:"metadata" db:"metadata"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
}

type DocumentVerification struct {
	ID           int       `json:"id" db:"id"`
	DocumentID   int       `json:"document_id" db:"document_id"`
	VerifyType   string    `json:"verify_type" db:"verify_type"`
	Status       string    `json:"status" db:"status"`
	Score        float64   `json:"score" db:"score"`
	Details      string    `json:"details" db:"details"`
	VerifiedBy   string    `json:"verified_by" db:"verified_by"`
	VerifiedAt   time.Time `json:"verified_at" db:"verified_at"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
}

type DocumentTemplate struct {
	ID          int       `json:"id" db:"id"`
	Name        string    `json:"name" db:"name"`
	Category    string    `json:"category" db:"category"`
	Description string    `json:"description" db:"description"`
	Template    string    `json:"template" db:"template"`
	Fields      string    `json:"fields" db:"fields"`
	IsActive    bool      `json:"is_active" db:"is_active"`
	CreatedBy   string    `json:"created_by" db:"created_by"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
}

type DocumentOCR struct {
	ID           int       `json:"id" db:"id"`
	DocumentID   int       `json:"document_id" db:"document_id"`
	ExtractedText string   `json:"extracted_text" db:"extracted_text"`
	Confidence   float64   `json:"confidence" db:"confidence"`
	Language     string    `json:"language" db:"language"`
	ProcessedBy  string    `json:"processed_by" db:"processed_by"`
	ProcessedAt  time.Time `json:"processed_at" db:"processed_at"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
}

type DocumentService struct {
	db *sql.DB
}

func NewDocumentService(db *sql.DB) *DocumentService {
	return &DocumentService{db: db}
}

// Initialize database tables
func (s *DocumentService) InitTables() error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS documents (
			id SERIAL PRIMARY KEY,
			document_type VARCHAR(50) NOT NULL,
			title VARCHAR(200) NOT NULL,
			description TEXT,
			file_path VARCHAR(500) NOT NULL,
			file_size BIGINT NOT NULL,
			mime_type VARCHAR(100) NOT NULL,
			entity_type VARCHAR(50) NOT NULL,
			entity_id VARCHAR(100) NOT NULL,
			uploaded_by VARCHAR(50) NOT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'pending',
			version INTEGER NOT NULL DEFAULT 1,
			tags TEXT,
			metadata JSONB,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			INDEX idx_documents_entity (entity_type, entity_id),
			INDEX idx_documents_type (document_type),
			INDEX idx_documents_status (status)
		)`,
		`CREATE TABLE IF NOT EXISTS document_verifications (
			id SERIAL PRIMARY KEY,
			document_id INTEGER NOT NULL,
			verify_type VARCHAR(50) NOT NULL,
			status VARCHAR(20) NOT NULL,
			score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
			details TEXT,
			verified_by VARCHAR(50) NOT NULL,
			verified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
			INDEX idx_verification_document (document_id),
			INDEX idx_verification_status (status)
		)`,
		`CREATE TABLE IF NOT EXISTS document_templates (
			id SERIAL PRIMARY KEY,
			name VARCHAR(200) NOT NULL,
			category VARCHAR(100) NOT NULL,
			description TEXT,
			template TEXT NOT NULL,
			fields JSONB,
			is_active BOOLEAN DEFAULT true,
			created_by VARCHAR(50) NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			INDEX idx_template_category (category),
			INDEX idx_template_active (is_active)
		)`,
		`CREATE TABLE IF NOT EXISTS document_ocr (
			id SERIAL PRIMARY KEY,
			document_id INTEGER NOT NULL,
			extracted_text TEXT NOT NULL,
			confidence DECIMAL(5,2) NOT NULL DEFAULT 0.00,
			language VARCHAR(10) NOT NULL DEFAULT 'en',
			processed_by VARCHAR(50) NOT NULL,
			processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
			INDEX idx_ocr_document (document_id),
			INDEX idx_ocr_confidence (confidence)
		)`,
	}

	for _, query := range queries {
		if _, err := s.db.Exec(query); err != nil {
			return fmt.Errorf("failed to create table: %v", err)
		}
	}

	// Insert default document templates
	s.insertDefaultTemplates()

	return nil
}

func (s *DocumentService) insertDefaultTemplates() {
	templates := []DocumentTemplate{
		{
			Name: "KYC Identity Document",
			Category: "Identity Verification",
			Description: "Template for identity document verification",
			Template: "Identity Document Verification Form",
			Fields: `{"fields": [{"name": "document_number", "type": "string", "required": true}, {"name": "full_name", "type": "string", "required": true}, {"name": "date_of_birth", "type": "date", "required": true}, {"name": "expiry_date", "type": "date", "required": false}]}`,
			IsActive: true,
			CreatedBy: "system",
		},
		{
			Name: "Business Registration Certificate",
			Category: "Business Verification",
			Description: "Template for business registration documents",
			Template: "Business Registration Certificate",
			Fields: `{"fields": [{"name": "business_name", "type": "string", "required": true}, {"name": "registration_number", "type": "string", "required": true}, {"name": "registration_date", "type": "date", "required": true}, {"name": "business_type", "type": "string", "required": true}]}`,
			IsActive: true,
			CreatedBy: "system",
		},
		{
			Name: "Bank Statement",
			Category: "Financial Verification",
			Description: "Template for bank statement verification",
			Template: "Bank Statement Verification",
			Fields: `{"fields": [{"name": "account_number", "type": "string", "required": true}, {"name": "account_holder", "type": "string", "required": true}, {"name": "statement_period", "type": "string", "required": true}, {"name": "bank_name", "type": "string", "required": true}]}`,
			IsActive: true,
			CreatedBy: "system",
		},
	}

	for _, template := range templates {
		query := `INSERT INTO document_templates (name, category, description, template, fields, is_active, created_by)
				  VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`
		s.db.Exec(query, template.Name, template.Category, template.Description,
				  template.Template, template.Fields, template.IsActive, template.CreatedBy)
	}
}

// Document endpoints
func (s *DocumentService) getDocuments(c *gin.Context) {
	entityType := c.Query("entity_type")
	entityID := c.Query("entity_id")
	documentType := c.Query("document_type")
	status := c.Query("status")
	limit := c.DefaultQuery("limit", "100")

	query := `SELECT id, document_type, title, description, file_path, file_size, 
			  mime_type, entity_type, entity_id, uploaded_by, status, version, 
			  tags, metadata, created_at, updated_at 
			  FROM documents WHERE 1=1`
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

	if documentType != "" {
		argCount++
		query += fmt.Sprintf(" AND document_type = $%d", argCount)
		args = append(args, documentType)
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

	var documents []Document
	for rows.Next() {
		var doc Document
		err := rows.Scan(&doc.ID, &doc.DocumentType, &doc.Title, &doc.Description,
						&doc.FilePath, &doc.FileSize, &doc.MimeType, &doc.EntityType,
						&doc.EntityID, &doc.UploadedBy, &doc.Status, &doc.Version,
						&doc.Tags, &doc.Metadata, &doc.CreatedAt, &doc.UpdatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		documents = append(documents, doc)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": documents,
		"count": len(documents),
	})
}

func (s *DocumentService) createDocument(c *gin.Context) {
	var doc Document
	if err := c.ShouldBindJSON(&doc); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	query := `INSERT INTO documents (document_type, title, description, file_path, 
			  file_size, mime_type, entity_type, entity_id, uploaded_by, status, 
			  version, tags, metadata)
			  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
			  RETURNING id, created_at, updated_at`
	
	err := s.db.QueryRow(query, doc.DocumentType, doc.Title, doc.Description,
						doc.FilePath, doc.FileSize, doc.MimeType, doc.EntityType,
						doc.EntityID, doc.UploadedBy, doc.Status, doc.Version,
						doc.Tags, doc.Metadata).Scan(&doc.ID, &doc.CreatedAt, &doc.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"status": "success",
		"data": doc,
	})
}

func (s *DocumentService) updateDocumentStatus(c *gin.Context) {
	id := c.Param("id")
	var updateData struct {
		Status string `json:"status" binding:"required"`
	}

	if err := c.ShouldBindJSON(&updateData); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	query := `UPDATE documents SET status = $1, updated_at = CURRENT_TIMESTAMP 
			  WHERE id = $2 RETURNING id, status, updated_at`
	
	var doc Document
	err := s.db.QueryRow(query, updateData.Status, id).Scan(&doc.ID, &doc.Status, &doc.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "Document not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": doc,
	})
}

// Document Verification endpoints
func (s *DocumentService) getDocumentVerifications(c *gin.Context) {
	documentID := c.Query("document_id")
	verifyType := c.Query("verify_type")
	status := c.Query("status")
	limit := c.DefaultQuery("limit", "100")

	query := `SELECT id, document_id, verify_type, status, score, details, 
			  verified_by, verified_at, created_at 
			  FROM document_verifications WHERE 1=1`
	args := []interface{}{}
	argCount := 0

	if documentID != "" {
		argCount++
		query += fmt.Sprintf(" AND document_id = $%d", argCount)
		args = append(args, documentID)
	}

	if verifyType != "" {
		argCount++
		query += fmt.Sprintf(" AND verify_type = $%d", argCount)
		args = append(args, verifyType)
	}

	if status != "" {
		argCount++
		query += fmt.Sprintf(" AND status = $%d", argCount)
		args = append(args, status)
	}

	argCount++
	query += fmt.Sprintf(" ORDER BY verified_at DESC LIMIT $%d", argCount)
	args = append(args, limit)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var verifications []DocumentVerification
	for rows.Next() {
		var verification DocumentVerification
		err := rows.Scan(&verification.ID, &verification.DocumentID, &verification.VerifyType,
						&verification.Status, &verification.Score, &verification.Details,
						&verification.VerifiedBy, &verification.VerifiedAt, &verification.CreatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		verifications = append(verifications, verification)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": verifications,
		"count": len(verifications),
	})
}

func (s *DocumentService) createDocumentVerification(c *gin.Context) {
	var verification DocumentVerification
	if err := c.ShouldBindJSON(&verification); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	query := `INSERT INTO document_verifications (document_id, verify_type, status, 
			  score, details, verified_by, verified_at)
			  VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`
	
	err := s.db.QueryRow(query, verification.DocumentID, verification.VerifyType,
						verification.Status, verification.Score, verification.Details,
						verification.VerifiedBy, time.Now()).
						Scan(&verification.ID, &verification.CreatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"status": "success",
		"data": verification,
	})
}

// Document Templates endpoints
func (s *DocumentService) getDocumentTemplates(c *gin.Context) {
	category := c.Query("category")
	isActive := c.Query("is_active")

	query := `SELECT id, name, category, description, template, fields, is_active, 
			  created_by, created_at, updated_at 
			  FROM document_templates WHERE 1=1`
	args := []interface{}{}
	argCount := 0

	if category != "" {
		argCount++
		query += fmt.Sprintf(" AND category = $%d", argCount)
		args = append(args, category)
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

	var templates []DocumentTemplate
	for rows.Next() {
		var template DocumentTemplate
		err := rows.Scan(&template.ID, &template.Name, &template.Category, &template.Description,
						&template.Template, &template.Fields, &template.IsActive, &template.CreatedBy,
						&template.CreatedAt, &template.UpdatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		templates = append(templates, template)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": templates,
		"count": len(templates),
	})
}

// OCR Processing endpoints
func (s *DocumentService) processDocumentOCR(c *gin.Context) {
	var ocrData DocumentOCR
	if err := c.ShouldBindJSON(&ocrData); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Simulate OCR processing with OLMOCR/GOT-OCR2.0
	// In real implementation, this would call the actual OCR service
	ocrData.Confidence = 95.5 // Simulated confidence score
	ocrData.Language = "en"
	ocrData.ProcessedBy = "OLMOCR-v2.0"

	query := `INSERT INTO document_ocr (document_id, extracted_text, confidence, 
			  language, processed_by, processed_at)
			  VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`
	
	err := s.db.QueryRow(query, ocrData.DocumentID, ocrData.ExtractedText,
						ocrData.Confidence, ocrData.Language, ocrData.ProcessedBy,
						time.Now()).Scan(&ocrData.ID, &ocrData.CreatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"status": "success",
		"data": ocrData,
		"message": "OCR processing completed successfully",
	})
}

func (s *DocumentService) getDocumentOCR(c *gin.Context) {
	documentID := c.Param("document_id")

	query := `SELECT id, document_id, extracted_text, confidence, language, 
			  processed_by, processed_at, created_at 
			  FROM document_ocr WHERE document_id = $1 
			  ORDER BY processed_at DESC LIMIT 1`

	var ocr DocumentOCR
	err := s.db.QueryRow(query, documentID).Scan(&ocr.ID, &ocr.DocumentID,
												&ocr.ExtractedText, &ocr.Confidence,
												&ocr.Language, &ocr.ProcessedBy,
												&ocr.ProcessedAt, &ocr.CreatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "OCR data not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": ocr,
	})
}

// Dashboard summary endpoint
func (s *DocumentService) getDashboardSummary(c *gin.Context) {
	// Get document summary
	var totalDocs int
	var pendingDocs int
	var verifiedDocs int
	err := s.db.QueryRow(`SELECT COUNT(*), 
						  SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END),
						  SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END)
						  FROM documents`).Scan(&totalDocs, &pendingDocs, &verifiedDocs)
	if err != nil {
		totalDocs = 0
		pendingDocs = 0
		verifiedDocs = 0
	}

	// Get verification summary
	var totalVerifications int
	var avgScore float64
	err = s.db.QueryRow(`SELECT COUNT(*), COALESCE(AVG(score), 0) 
						 FROM document_verifications`).Scan(&totalVerifications, &avgScore)
	if err != nil {
		totalVerifications = 0
		avgScore = 0
	}

	// Get OCR summary
	var totalOCR int
	var avgConfidence float64
	err = s.db.QueryRow(`SELECT COUNT(*), COALESCE(AVG(confidence), 0) 
						 FROM document_ocr`).Scan(&totalOCR, &avgConfidence)
	if err != nil {
		totalOCR = 0
		avgConfidence = 0
	}

	summary := gin.H{
		"documents": gin.H{
			"total": totalDocs,
			"pending": pendingDocs,
			"verified": verifiedDocs,
		},
		"verifications": gin.H{
			"total": totalVerifications,
			"average_score": avgScore,
		},
		"ocr_processing": gin.H{
			"total": totalOCR,
			"average_confidence": avgConfidence,
		},
		"generated_at": time.Now(),
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": summary,
	})
}

// Health check endpoint
func (s *DocumentService) healthCheck(c *gin.Context) {
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
		"service": "document-service",
		"timestamp": time.Now(),
		"database": "connected",
		"ocr_engine": "OLMOCR-v2.0",
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
	service := NewDocumentService(db)
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
		
		// Documents
		api.GET("/documents", service.getDocuments)
		api.POST("/documents", service.createDocument)
		api.PUT("/documents/:id/status", service.updateDocumentStatus)
		
		// Document Verifications
		api.GET("/documents/verifications", service.getDocumentVerifications)
		api.POST("/documents/verifications", service.createDocumentVerification)
		
		// Document Templates
		api.GET("/documents/templates", service.getDocumentTemplates)
		
		// OCR Processing
		api.POST("/documents/ocr", service.processDocumentOCR)
		api.GET("/documents/:document_id/ocr", service.getDocumentOCR)
		
		// Dashboard Summary
		api.GET("/documents/dashboard", service.getDashboardSummary)
	}

	port := getEnv("PORT", "8083")
	log.Printf("Document Service starting on port %s", port)
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

