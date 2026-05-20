package main

import (
	"os"
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/golang-jwt/jwt/v4"
	"github.com/google/uuid"
	"github.com/skip2/go-qrcode"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// QRCode represents a QR code record
type QRCode struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	QRCodeID    string    `json:"qr_code_id" gorm:"uniqueIndex;not null"`
	Type        string    `json:"type" gorm:"not null"` // payment, auth, agent_verification, transaction
	Purpose     string    `json:"purpose"`
	Data        string    `json:"data" gorm:"type:text"`
	EncryptedData string  `json:"encrypted_data" gorm:"type:text"`
	Metadata    string    `json:"metadata" gorm:"type:jsonb"`
	CreatedBy   string    `json:"created_by"`
	ExpiresAt   *time.Time `json:"expires_at"`
	UsageCount  int       `json:"usage_count" gorm:"default:0"`
	MaxUsage    int       `json:"max_usage" gorm:"default:1"`
	Status      string    `json:"status" gorm:"default:active"` // active, expired, used, revoked
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// QRUsage represents QR code usage tracking
type QRUsage struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	QRCodeID  string    `json:"qr_code_id" gorm:"index"`
	UsedBy    string    `json:"used_by"`
	UsedAt    time.Time `json:"used_at"`
	IPAddress string    `json:"ip_address"`
	UserAgent string    `json:"user_agent"`
	Location  string    `json:"location"`
	Success   bool      `json:"success"`
	ErrorMsg  string    `json:"error_msg"`
	Metadata  string    `json:"metadata" gorm:"type:jsonb"`
}

// QRTemplate represents QR code templates
type QRTemplate struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	Name        string    `json:"name" gorm:"uniqueIndex;not null"`
	Type        string    `json:"type" gorm:"not null"`
	Description string    `json:"description"`
	Template    string    `json:"template" gorm:"type:text"`
	Variables   string    `json:"variables" gorm:"type:jsonb"`
	Settings    string    `json:"settings" gorm:"type:jsonb"`
	Active      bool      `json:"active" gorm:"default:true"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// QRRequest represents a QR code generation request
type QRRequest struct {
	Type        string                 `json:"type" binding:"required"`
	Purpose     string                 `json:"purpose"`
	Data        map[string]interface{} `json:"data" binding:"required"`
	ExpiresIn   int                    `json:"expires_in"` // seconds
	MaxUsage    int                    `json:"max_usage"`
	Size        int                    `json:"size"`
	ErrorLevel  string                 `json:"error_level"`
	Logo        string                 `json:"logo"`
	Template    string                 `json:"template"`
}

// QRResponse represents a QR code generation response
type QRResponse struct {
	QRCodeID    string    `json:"qr_code_id"`
	Type        string    `json:"type"`
	Purpose     string    `json:"purpose"`
	ImageData   string    `json:"image_data"` // base64 encoded
	URL         string    `json:"url"`
	ExpiresAt   *time.Time `json:"expires_at"`
	MaxUsage    int       `json:"max_usage"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
}

// QRValidationRequest represents a QR code validation request
type QRValidationRequest struct {
	QRCodeID  string                 `json:"qr_code_id" binding:"required"`
	Context   map[string]interface{} `json:"context"`
	UserAgent string                 `json:"user_agent"`
	IPAddress string                 `json:"ip_address"`
	Location  string                 `json:"location"`
}

// QRValidationResponse represents a QR code validation response
type QRValidationResponse struct {
	Valid       bool                   `json:"valid"`
	QRCodeID    string                 `json:"qr_code_id"`
	Type        string                 `json:"type"`
	Purpose     string                 `json:"purpose"`
	Data        map[string]interface{} `json:"data"`
	UsageCount  int                    `json:"usage_count"`
	MaxUsage    int                    `json:"max_usage"`
	ExpiresAt   *time.Time             `json:"expires_at"`
	Status      string                 `json:"status"`
	Message     string                 `json:"message"`
	UsageID     uint                   `json:"usage_id,omitempty"`
}

// QRService represents the main QR service
type QRService struct {
	db          *gorm.DB
	redis       *redis.Client
	encryptionKey []byte
}

// NewQRService creates a new QR service
func NewQRService() *QRService {
	// Database connection
	dbHost := getEnv("DB_HOST", "localhost")
	dbPort := getEnv("DB_PORT", "5432")
	dbUser := getEnv("DB_USER", "postgres")
	dbPassword := getEnv("DB_PASSWORD", "password")
	dbName := getEnv("DB_NAME", "remittance")

	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		dbHost, dbPort, dbUser, dbPassword, dbName)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}

	// Redis connection
	redisHost := getEnv("REDIS_HOST", "localhost")
	redisPort := getEnv("REDIS_PORT", "6379")
	redisPassword := getEnv("REDIS_PASSWORD", "")

	rdb := redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:%s", redisHost, redisPort),
		Password: redisPassword,
		DB:       1, // Use DB 1 for QR service
	})

	// Test Redis connection
	ctx := context.Background()
	_, err = rdb.Ping(ctx).Result()
	if err != nil {
		log.Printf("Redis connection failed: %v", err)
	}

	// Encryption key
	encryptionKey := []byte(getEnv("ENCRYPTION_KEY", "remittance-qr-key-32-bytes!"))
	if len(encryptionKey) != 32 {
		// Ensure 32 bytes for AES-256
		hash := sha256.Sum256(encryptionKey)
		encryptionKey = hash[:]
	}

	service := &QRService{
		db:            db,
		redis:         rdb,
		encryptionKey: encryptionKey,
	}

	// Auto-migrate database
	service.migrate()

	// Initialize templates
	service.initializeTemplates()

	return service
}

// migrate performs database migrations
func (q *QRService) migrate() {
	err := q.db.AutoMigrate(&QRCode{}, &QRUsage{}, &QRTemplate{})
	if err != nil {
		log.Fatal("Failed to migrate database:", err)
	}
}

// initializeTemplates creates default QR code templates
func (q *QRService) initializeTemplates() {
	templates := []QRTemplate{
		{
			Name:        "payment_request",
			Type:        "payment",
			Description: "Template for payment requests",
			Template:    `{"action":"payment","amount":"{{amount}}","currency":"{{currency}}","recipient":"{{recipient}}","reference":"{{reference}}"}`,
			Variables:   `{"amount":{"type":"number","required":true},"currency":{"type":"string","default":"NGN"},"recipient":{"type":"string","required":true},"reference":{"type":"string","required":true}}`,
			Settings:    `{"expires_in":3600,"max_usage":1,"size":256,"error_level":"M"}`,
			Active:      true,
		},
		{
			Name:        "agent_verification",
			Type:        "agent_verification",
			Description: "Template for agent verification",
			Template:    `{"action":"verify_agent","agent_id":"{{agent_id}}","branch_id":"{{branch_id}}","verification_code":"{{verification_code}}"}`,
			Variables:   `{"agent_id":{"type":"string","required":true},"branch_id":{"type":"string","required":true},"verification_code":{"type":"string","required":true}}`,
			Settings:    `{"expires_in":300,"max_usage":1,"size":256,"error_level":"H"}`,
			Active:      true,
		},
		{
			Name:        "transaction_receipt",
			Type:        "transaction",
			Description: "Template for transaction receipts",
			Template:    `{"action":"transaction_receipt","transaction_id":"{{transaction_id}}","amount":"{{amount}}","type":"{{type}}","timestamp":"{{timestamp}}"}`,
			Variables:   `{"transaction_id":{"type":"string","required":true},"amount":{"type":"number","required":true},"type":{"type":"string","required":true},"timestamp":{"type":"string","required":true}}`,
			Settings:    `{"expires_in":86400,"max_usage":10,"size":256,"error_level":"M"}`,
			Active:      true,
		},
		{
			Name:        "authentication",
			Type:        "auth",
			Description: "Template for authentication QR codes",
			Template:    `{"action":"authenticate","user_id":"{{user_id}}","session_id":"{{session_id}}","challenge":"{{challenge}}"}`,
			Variables:   `{"user_id":{"type":"string","required":true},"session_id":{"type":"string","required":true},"challenge":{"type":"string","required":true}}`,
			Settings:    `{"expires_in":300,"max_usage":1,"size":256,"error_level":"H"}`,
			Active:      true,
		},
		{
			Name:        "account_linking",
			Type:        "account",
			Description: "Template for account linking",
			Template:    `{"action":"link_account","account_number":"{{account_number}}","bank_code":"{{bank_code}}","verification_token":"{{verification_token}}"}`,
			Variables:   `{"account_number":{"type":"string","required":true},"bank_code":{"type":"string","required":true},"verification_token":{"type":"string","required":true}}`,
			Settings:    `{"expires_in":1800,"max_usage":1,"size":256,"error_level":"H"}`,
			Active:      true,
		},
	}

	for _, template := range templates {
		var existingTemplate QRTemplate
		result := q.db.Where("name = ?", template.Name).First(&existingTemplate)
		if result.Error == gorm.ErrRecordNotFound {
			q.db.Create(&template)
			log.Printf("Created QR template: %s", template.Name)
		}
	}
}

// GenerateQR generates a new QR code
func (q *QRService) GenerateQR(request QRRequest, createdBy string) (*QRResponse, error) {
	// Generate unique QR code ID
	qrCodeID := uuid.New().String()

	// Process template if specified
	if request.Template != "" {
		processedData, err := q.processTemplate(request.Template, request.Data)
		if err != nil {
			return nil, fmt.Errorf("template processing error: %v", err)
		}
		request.Data = processedData
	}

	// Serialize data
	dataJSON, err := json.Marshal(request.Data)
	if err != nil {
		return nil, fmt.Errorf("data serialization error: %v", err)
	}

	// Encrypt sensitive data
	encryptedData, err := q.encrypt(string(dataJSON))
	if err != nil {
		return nil, fmt.Errorf("encryption error: %v", err)
	}

	// Calculate expiration
	var expiresAt *time.Time
	if request.ExpiresIn > 0 {
		expiry := time.Now().Add(time.Duration(request.ExpiresIn) * time.Second)
		expiresAt = &expiry
	}

	// Set defaults
	if request.MaxUsage == 0 {
		request.MaxUsage = 1
	}
	if request.Size == 0 {
		request.Size = 256
	}
	if request.ErrorLevel == "" {
		request.ErrorLevel = "M"
	}

	// Create QR code record
	qrCode := QRCode{
		QRCodeID:      qrCodeID,
		Type:          request.Type,
		Purpose:       request.Purpose,
		Data:          string(dataJSON),
		EncryptedData: encryptedData,
		Metadata:      q.createMetadata(request),
		CreatedBy:     createdBy,
		ExpiresAt:     expiresAt,
		MaxUsage:      request.MaxUsage,
		Status:        "active",
	}

	// Save to database
	if err := q.db.Create(&qrCode).Error; err != nil {
		return nil, fmt.Errorf("database error: %v", err)
	}

	// Generate QR code image
	qrURL := q.generateQRURL(qrCodeID)
	imageData, err := q.generateQRImage(qrURL, request.Size, request.ErrorLevel, request.Logo)
	if err != nil {
		return nil, fmt.Errorf("QR image generation error: %v", err)
	}

	// Cache QR code data
	q.cacheQRCode(qrCodeID, qrCode)

	response := &QRResponse{
		QRCodeID:  qrCodeID,
		Type:      request.Type,
		Purpose:   request.Purpose,
		ImageData: imageData,
		URL:       qrURL,
		ExpiresAt: expiresAt,
		MaxUsage:  request.MaxUsage,
		Status:    "active",
		CreatedAt: qrCode.CreatedAt,
	}

	return response, nil
}

// ValidateQR validates a QR code
func (q *QRService) ValidateQR(request QRValidationRequest) (*QRValidationResponse, error) {
	// Get QR code from cache or database
	qrCode, err := q.getQRCode(request.QRCodeID)
	if err != nil {
		return &QRValidationResponse{
			Valid:    false,
			QRCodeID: request.QRCodeID,
			Message:  "QR code not found",
		}, nil
	}

	// Check if QR code is active
	if qrCode.Status != "active" {
		return &QRValidationResponse{
			Valid:    false,
			QRCodeID: request.QRCodeID,
			Status:   qrCode.Status,
			Message:  fmt.Sprintf("QR code is %s", qrCode.Status),
		}, nil
	}

	// Check expiration
	if qrCode.ExpiresAt != nil && time.Now().After(*qrCode.ExpiresAt) {
		// Update status to expired
		q.db.Model(&qrCode).Update("status", "expired")
		q.clearQRCodeCache(request.QRCodeID)

		return &QRValidationResponse{
			Valid:     false,
			QRCodeID:  request.QRCodeID,
			Status:    "expired",
			ExpiresAt: qrCode.ExpiresAt,
			Message:   "QR code has expired",
		}, nil
	}

	// Check usage limit
	if qrCode.UsageCount >= qrCode.MaxUsage {
		// Update status to used
		q.db.Model(&qrCode).Update("status", "used")
		q.clearQRCodeCache(request.QRCodeID)

		return &QRValidationResponse{
			Valid:      false,
			QRCodeID:   request.QRCodeID,
			Status:     "used",
			UsageCount: qrCode.UsageCount,
			MaxUsage:   qrCode.MaxUsage,
			Message:    "QR code usage limit exceeded",
		}, nil
	}

	// Decrypt data
	var data map[string]interface{}
	if qrCode.EncryptedData != "" {
		decryptedData, err := q.decrypt(qrCode.EncryptedData)
		if err != nil {
			return &QRValidationResponse{
				Valid:    false,
				QRCodeID: request.QRCodeID,
				Message:  "Data decryption error",
			}, nil
		}
		json.Unmarshal([]byte(decryptedData), &data)
	} else {
		json.Unmarshal([]byte(qrCode.Data), &data)
	}

	// Record usage
	usage := QRUsage{
		QRCodeID:  request.QRCodeID,
		UsedBy:    request.Context["user_id"].(string),
		UsedAt:    time.Now(),
		IPAddress: request.IPAddress,
		UserAgent: request.UserAgent,
		Location:  request.Location,
		Success:   true,
		Metadata:  q.createUsageMetadata(request.Context),
	}

	if err := q.db.Create(&usage).Error; err != nil {
		log.Printf("Error recording QR usage: %v", err)
	}

	// Update usage count
	q.db.Model(&qrCode).Update("usage_count", qrCode.UsageCount+1)

	// Update cache
	qrCode.UsageCount++
	q.cacheQRCode(request.QRCodeID, *qrCode)

	response := &QRValidationResponse{
		Valid:      true,
		QRCodeID:   request.QRCodeID,
		Type:       qrCode.Type,
		Purpose:    qrCode.Purpose,
		Data:       data,
		UsageCount: qrCode.UsageCount,
		MaxUsage:   qrCode.MaxUsage,
		ExpiresAt:  qrCode.ExpiresAt,
		Status:     qrCode.Status,
		Message:    "QR code is valid",
		UsageID:    usage.ID,
	}

	return response, nil
}

// processTemplate processes QR code template
func (q *QRService) processTemplate(templateName string, data map[string]interface{}) (map[string]interface{}, error) {
	var template QRTemplate
	if err := q.db.Where("name = ? AND active = ?", templateName, true).First(&template).Error; err != nil {
		return nil, fmt.Errorf("template not found: %s", templateName)
	}

	// Parse template
	var templateData map[string]interface{}
	if err := json.Unmarshal([]byte(template.Template), &templateData); err != nil {
		return nil, fmt.Errorf("invalid template format: %v", err)
	}

	// Replace variables
	processedData := q.replaceTemplateVariables(templateData, data)

	return processedData, nil
}

// replaceTemplateVariables replaces template variables with actual values
func (q *QRService) replaceTemplateVariables(template map[string]interface{}, data map[string]interface{}) map[string]interface{} {
	result := make(map[string]interface{})

	for key, value := range template {
		switch v := value.(type) {
		case string:
			// Replace {{variable}} patterns
			if strings.HasPrefix(v, "{{") && strings.HasSuffix(v, "}}") {
				varName := strings.Trim(v, "{}")
				if val, exists := data[varName]; exists {
					result[key] = val
				} else {
					result[key] = v // Keep original if variable not found
				}
			} else {
				result[key] = v
			}
		case map[string]interface{}:
			result[key] = q.replaceTemplateVariables(v, data)
		default:
			result[key] = v
		}
	}

	return result
}

// generateQRURL generates the QR code URL
func (q *QRService) generateQRURL(qrCodeID string) string {
	baseURL := getEnv("QR_BASE_URL", "https://banking.agent.ng/qr")
	return fmt.Sprintf("%s/%s", baseURL, qrCodeID)
}

// generateQRImage generates QR code image
func (q *QRService) generateQRImage(content string, size int, errorLevel string, logoPath string) (string, error) {
	// Map error correction levels
	var level qrcode.RecoveryLevel
	switch errorLevel {
	case "L":
		level = qrcode.Low
	case "M":
		level = qrcode.Medium
	case "Q":
		level = qrcode.High
	case "H":
		level = qrcode.Highest
	default:
		level = qrcode.Medium
	}

	// Generate QR code
	qr, err := qrcode.New(content, level)
	if err != nil {
		return "", err
	}

	// Generate image
	img := qr.Image(size)

	// Add logo if specified
	if logoPath != "" {
		img, err = q.addLogoToQR(img, logoPath)
		if err != nil {
			log.Printf("Error adding logo: %v", err)
			// Continue without logo
		}
	}

	// Convert to base64
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return "", err
	}

	imageData := base64.StdEncoding.EncodeToString(buf.Bytes())
	return fmt.Sprintf("data:image/png;base64,%s", imageData), nil
}

// addLogoToQR adds a logo to the center of QR code
func (q *QRService) addLogoToQR(qrImg image.Image, logoPath string) (image.Image, error) {
	// This is a simplified implementation
	// In production, you would implement proper logo overlay
	return qrImg, nil
}

// getQRCode retrieves QR code from cache or database
func (q *QRService) getQRCode(qrCodeID string) (*QRCode, error) {
	// Try cache first
	if q.redis != nil {
		cached, err := q.redis.Get(context.Background(), fmt.Sprintf("qr:%s", qrCodeID)).Result()
		if err == nil {
			var qrCode QRCode
			if json.Unmarshal([]byte(cached), &qrCode) == nil {
				return &qrCode, nil
			}
		}
	}

	// Get from database
	var qrCode QRCode
	if err := q.db.Where("qr_code_id = ?", qrCodeID).First(&qrCode).Error; err != nil {
		return nil, err
	}

	// Cache the result
	q.cacheQRCode(qrCodeID, qrCode)

	return &qrCode, nil
}

// cacheQRCode caches QR code data
func (q *QRService) cacheQRCode(qrCodeID string, qrCode QRCode) {
	if q.redis != nil {
		data, _ := json.Marshal(qrCode)
		q.redis.Set(context.Background(), fmt.Sprintf("qr:%s", qrCodeID), data, 1*time.Hour)
	}
}

// clearQRCodeCache clears QR code from cache
func (q *QRService) clearQRCodeCache(qrCodeID string) {
	if q.redis != nil {
		q.redis.Del(context.Background(), fmt.Sprintf("qr:%s", qrCodeID))
	}
}

// encrypt encrypts data using AES
func (q *QRService) encrypt(plaintext string) (string, error) {
	block, err := aes.NewCipher(q.encryptionKey)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// decrypt decrypts data using AES
func (q *QRService) decrypt(ciphertext string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(q.encryptionKey)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}

	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}

	return string(plaintext), nil
}

// createMetadata creates metadata for QR code
func (q *QRService) createMetadata(request QRRequest) string {
	metadata := map[string]interface{}{
		"size":        request.Size,
		"error_level": request.ErrorLevel,
		"logo":        request.Logo,
		"template":    request.Template,
		"created_at":  time.Now().Unix(),
	}

	data, _ := json.Marshal(metadata)
	return string(data)
}

// createUsageMetadata creates metadata for QR usage
func (q *QRService) createUsageMetadata(context map[string]interface{}) string {
	metadata := map[string]interface{}{
		"context":   context,
		"timestamp": time.Now().Unix(),
	}

	data, _ := json.Marshal(metadata)
	return string(data)
}

// REST API Handlers

// setupRoutes sets up the REST API routes
func (q *QRService) setupRoutes() *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	// CORS middleware
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "healthy", "service": "qr-service"})
	})

	// API routes
	api := r.Group("/api/v1")
	{
		// QR code generation
		api.POST("/generate", q.handleGenerateQR)

		// QR code validation
		api.POST("/validate", q.handleValidateQR)

		// QR code management
		api.GET("/qr/:id", q.handleGetQR)
		api.PUT("/qr/:id/revoke", q.handleRevokeQR)
		api.GET("/qr/:id/usage", q.handleGetQRUsage)

		// Templates
		api.GET("/templates", q.handleGetTemplates)
		api.POST("/templates", q.handleCreateTemplate)

		// Analytics
		api.GET("/analytics", q.handleGetAnalytics)

		// Bulk operations
		api.POST("/generate/batch", q.handleBatchGenerate)
	}

	// QR code access endpoint
	r.GET("/qr/:id", q.handleQRAccess)

	return r
}

// handleGenerateQR handles QR code generation
func (q *QRService) handleGenerateQR(c *gin.Context) {
	var request QRRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(400, gin.H{"error": "Invalid request format", "details": err.Error()})
		return
	}

	// Get user from context (assuming JWT middleware)
	createdBy := c.GetString("user_id")
	if createdBy == "" {
		createdBy = "system"
	}

	response, err := q.GenerateQR(request, createdBy)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to generate QR code", "details": err.Error()})
		return
	}

	c.JSON(201, response)
}

// handleValidateQR handles QR code validation
func (q *QRService) handleValidateQR(c *gin.Context) {
	var request QRValidationRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(400, gin.H{"error": "Invalid request format", "details": err.Error()})
		return
	}

	// Add IP and User-Agent from request
	request.IPAddress = c.ClientIP()
	request.UserAgent = c.GetHeader("User-Agent")

	response, err := q.ValidateQR(request)
	if err != nil {
		c.JSON(500, gin.H{"error": "Validation error", "details": err.Error()})
		return
	}

	c.JSON(200, response)
}

// handleGetQR handles getting QR code details
func (q *QRService) handleGetQR(c *gin.Context) {
	qrCodeID := c.Param("id")

	qrCode, err := q.getQRCode(qrCodeID)
	if err != nil {
		c.JSON(404, gin.H{"error": "QR code not found"})
		return
	}

	// Don't return encrypted data
	response := gin.H{
		"qr_code_id":   qrCode.QRCodeID,
		"type":         qrCode.Type,
		"purpose":      qrCode.Purpose,
		"created_by":   qrCode.CreatedBy,
		"expires_at":   qrCode.ExpiresAt,
		"usage_count":  qrCode.UsageCount,
		"max_usage":    qrCode.MaxUsage,
		"status":       qrCode.Status,
		"created_at":   qrCode.CreatedAt,
		"updated_at":   qrCode.UpdatedAt,
	}

	c.JSON(200, response)
}

// handleRevokeQR handles QR code revocation
func (q *QRService) handleRevokeQR(c *gin.Context) {
	qrCodeID := c.Param("id")

	if err := q.db.Model(&QRCode{}).Where("qr_code_id = ?", qrCodeID).Update("status", "revoked").Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to revoke QR code"})
		return
	}

	// Clear cache
	q.clearQRCodeCache(qrCodeID)

	c.JSON(200, gin.H{"message": "QR code revoked successfully"})
}

// handleGetQRUsage handles getting QR code usage history
func (q *QRService) handleGetQRUsage(c *gin.Context) {
	qrCodeID := c.Param("id")

	var usage []QRUsage
	if err := q.db.Where("qr_code_id = ?", qrCodeID).Order("used_at DESC").Find(&usage).Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to retrieve usage history"})
		return
	}

	c.JSON(200, gin.H{"usage": usage, "count": len(usage)})
}

// handleGetTemplates handles getting QR templates
func (q *QRService) handleGetTemplates(c *gin.Context) {
	var templates []QRTemplate

	query := q.db
	if active := c.Query("active"); active != "" {
		query = query.Where("active = ?", active == "true")
	}
	if qrType := c.Query("type"); qrType != "" {
		query = query.Where("type = ?", qrType)
	}

	if err := query.Find(&templates).Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to retrieve templates"})
		return
	}

	c.JSON(200, gin.H{"templates": templates})
}

// handleCreateTemplate handles creating QR templates
func (q *QRService) handleCreateTemplate(c *gin.Context) {
	var template QRTemplate
	if err := c.ShouldBindJSON(&template); err != nil {
		c.JSON(400, gin.H{"error": "Invalid template format", "details": err.Error()})
		return
	}

	if err := q.db.Create(&template).Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to create template", "details": err.Error()})
		return
	}

	c.JSON(201, template)
}

// handleGetAnalytics handles getting QR analytics
func (q *QRService) handleGetAnalytics(c *gin.Context) {
	analytics := q.getQRAnalytics()
	c.JSON(200, analytics)
}

// handleBatchGenerate handles batch QR generation
func (q *QRService) handleBatchGenerate(c *gin.Context) {
	var requests []QRRequest
	if err := c.ShouldBindJSON(&requests); err != nil {
		c.JSON(400, gin.H{"error": "Invalid request format", "details": err.Error()})
		return
	}

	createdBy := c.GetString("user_id")
	if createdBy == "" {
		createdBy = "system"
	}

	responses := make([]*QRResponse, len(requests))
	errors := make([]string, len(requests))

	for i, request := range requests {
		response, err := q.GenerateQR(request, createdBy)
		if err != nil {
			errors[i] = err.Error()
		} else {
			responses[i] = response
		}
	}

	c.JSON(200, gin.H{
		"responses": responses,
		"errors":    errors,
		"count":     len(requests),
	})
}

// handleQRAccess handles QR code access via URL
func (q *QRService) handleQRAccess(c *gin.Context) {
	qrCodeID := c.Param("id")

	qrCode, err := q.getQRCode(qrCodeID)
	if err != nil {
		c.JSON(404, gin.H{"error": "QR code not found"})
		return
	}

	// Return basic info for URL access
	c.JSON(200, gin.H{
		"qr_code_id": qrCode.QRCodeID,
		"type":       qrCode.Type,
		"purpose":    qrCode.Purpose,
		"status":     qrCode.Status,
		"expires_at": qrCode.ExpiresAt,
	})
}

// getQRAnalytics gets QR code analytics
func (q *QRService) getQRAnalytics() gin.H {
	var totalQRs int64
	var activeQRs int64
	var expiredQRs int64
	var usedQRs int64

	q.db.Model(&QRCode{}).Count(&totalQRs)
	q.db.Model(&QRCode{}).Where("status = ?", "active").Count(&activeQRs)
	q.db.Model(&QRCode{}).Where("status = ?", "expired").Count(&expiredQRs)
	q.db.Model(&QRCode{}).Where("status = ?", "used").Count(&usedQRs)

	// Usage by type
	var typeStats []struct {
		Type  string `json:"type"`
		Count int64  `json:"count"`
	}
	q.db.Model(&QRCode{}).Select("type, count(*) as count").Group("type").Scan(&typeStats)

	// Recent usage
	var recentUsage []QRUsage
	q.db.Where("used_at >= ?", time.Now().Add(-24*time.Hour)).
		Order("used_at DESC").
		Limit(100).
		Find(&recentUsage)

	return gin.H{
		"summary": gin.H{
			"total_qr_codes":  totalQRs,
			"active_qr_codes": activeQRs,
			"expired_qr_codes": expiredQRs,
			"used_qr_codes":   usedQRs,
		},
		"type_distribution": typeStats,
		"recent_usage":      recentUsage,
		"generated_at":      time.Now(),
	}
}

// getEnv gets environment variable with default value
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

func main() {
	log.Println("🚀 Starting QR Service...")

	// Initialize QR service
	service := NewQRService()

	// Setup routes
	router := service.setupRoutes()

	// Get port from environment
	port := getEnv("PORT", "8092")

	log.Printf("🌐 QR Service running on port %s", port)
	log.Printf("🔗 Health check: http://localhost:%s/health", port)
	log.Printf("📋 API documentation: http://localhost:%s/api/v1", port)

	// Start server
	if err := router.Run("0.0.0.0:" + port); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}

