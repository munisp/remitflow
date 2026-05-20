package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"context"
)

// =====================================================
// ID GENERATION SERVICE
// =====================================================

type IDType string
type IDStatus string

const (
	// ID Types
	IDTypeAccount     IDType = "account"
	IDTypeTransaction IDType = "transaction"
	IDTypeAgent       IDType = "agent"
	IDTypeCustomer    IDType = "customer"
	IDTypeTransfer    IDType = "transfer"
	IDTypePayment     IDType = "payment"
	IDTypeOrder       IDType = "order"
	IDTypeInvoice     IDType = "invoice"
	IDTypeSession     IDType = "session"
	IDTypeDevice      IDType = "device"

	// ID Status
	IDStatusReserved IDStatus = "reserved"
	IDStatusAssigned IDStatus = "assigned"
	IDStatusUsed     IDStatus = "used"
	IDStatusExpired  IDStatus = "expired"
)

// GeneratedID represents a generated ID
type GeneratedID struct {
	ID          uuid.UUID `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Type        IDType    `json:"type" gorm:"not null;index"`
	Value       string    `json:"value" gorm:"not null;uniqueIndex"`
	NumericID   int64     `json:"numeric_id" gorm:"uniqueIndex"`
	Status      IDStatus  `json:"status" gorm:"default:'reserved';index"`
	ReservedBy  string    `json:"reserved_by"`
	AssignedTo  string    `json:"assigned_to"`
	UsedBy      string    `json:"used_by"`
	ExpiresAt   *time.Time `json:"expires_at"`
	ReservedAt  time.Time `json:"reserved_at"`
	AssignedAt  *time.Time `json:"assigned_at"`
	UsedAt      *time.Time `json:"used_at"`
	Metadata    map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// IDSequence manages numeric ID sequences
type IDSequence struct {
	ID          uuid.UUID `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Type        IDType    `json:"type" gorm:"not null;uniqueIndex"`
	CurrentValue int64    `json:"current_value" gorm:"not null;default:1"`
	Increment   int64     `json:"increment" gorm:"not null;default:1"`
	MinValue    int64     `json:"min_value" gorm:"not null;default:1"`
	MaxValue    int64     `json:"max_value" gorm:"not null;default:9223372036854775807"`
	Prefix      string    `json:"prefix"`
	Suffix      string    `json:"suffix"`
	PadLength   int       `json:"pad_length" gorm:"default:0"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// IDReservation represents a batch ID reservation
type IDReservation struct {
	ID          uuid.UUID `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Type        IDType    `json:"type" gorm:"not null;index"`
	Count       int       `json:"count" gorm:"not null"`
	StartValue  int64     `json:"start_value" gorm:"not null"`
	EndValue    int64     `json:"end_value" gorm:"not null"`
	ReservedBy  string    `json:"reserved_by" gorm:"not null"`
	Status      string    `json:"status" gorm:"default:'active'"`
	ExpiresAt   time.Time `json:"expires_at"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// IDGenerationService manages ID generation
type IDGenerationService struct {
	db          *gorm.DB
	redis       *redis.Client
	mutex       sync.RWMutex
	sequences   map[IDType]*IDSequence
	reservations map[string]*IDReservation
}

// NewIDGenerationService creates a new ID generation service
func NewIDGenerationService(db *gorm.DB, redis *redis.Client) *IDGenerationService {
	service := &IDGenerationService{
		db:           db,
		redis:        redis,
		sequences:    make(map[IDType]*IDSequence),
		reservations: make(map[string]*IDReservation),
	}
	
	// Initialize sequences
	service.initializeSequences()
	
	// Start cleanup routine
	go service.cleanupExpiredIDs()
	
	return service
}

// initializeSequences initializes ID sequences for all types
func (s *IDGenerationService) initializeSequences() {
	idTypes := []IDType{
		IDTypeAccount, IDTypeTransaction, IDTypeAgent, IDTypeCustomer,
		IDTypeTransfer, IDTypePayment, IDTypeOrder, IDTypeInvoice,
		IDTypeSession, IDTypeDevice,
	}

	for _, idType := range idTypes {
		var sequence IDSequence
		result := s.db.Where("type = ?", idType).First(&sequence)
		
		if result.Error != nil {
			// Create new sequence
			sequence = IDSequence{
				Type:         idType,
				CurrentValue: 1,
				Increment:    1,
				MinValue:     1,
				MaxValue:     9223372036854775807,
				Prefix:       string(idType)[:3] + "_",
				PadLength:    10,
			}
			s.db.Create(&sequence)
		}
		
		s.sequences[idType] = &sequence
	}
}

// GenerateUUID generates a new UUID
func (s *IDGenerationService) GenerateUUID(idType IDType, reservedBy string, metadata map[string]interface{}) (*GeneratedID, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	id := &GeneratedID{
		Type:       idType,
		Value:      uuid.New().String(),
		Status:     IDStatusReserved,
		ReservedBy: reservedBy,
		ReservedAt: time.Now(),
		ExpiresAt:  timePtr(time.Now().Add(24 * time.Hour)), // 24 hour expiry
		Metadata:   metadata,
	}

	if err := s.db.Create(id).Error; err != nil {
		return nil, fmt.Errorf("failed to create UUID: %w", err)
	}

	// Cache in Redis
	s.cacheID(id)

	return id, nil
}

// GenerateNumericID generates a new numeric ID
func (s *IDGenerationService) GenerateNumericID(idType IDType, reservedBy string, metadata map[string]interface{}) (*GeneratedID, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	sequence, exists := s.sequences[idType]
	if !exists {
		return nil, fmt.Errorf("sequence not found for type: %s", idType)
	}

	// Get next value
	nextValue := sequence.CurrentValue
	sequence.CurrentValue += sequence.Increment

	// Check bounds
	if sequence.CurrentValue > sequence.MaxValue {
		sequence.CurrentValue = sequence.MinValue
	}

	// Update sequence in database
	if err := s.db.Save(sequence).Error; err != nil {
		return nil, fmt.Errorf("failed to update sequence: %w", err)
	}

	// Generate formatted ID
	formattedID := s.formatNumericID(sequence, nextValue)

	id := &GeneratedID{
		Type:       idType,
		Value:      formattedID,
		NumericID:  nextValue,
		Status:     IDStatusReserved,
		ReservedBy: reservedBy,
		ReservedAt: time.Now(),
		ExpiresAt:  timePtr(time.Now().Add(24 * time.Hour)),
		Metadata:   metadata,
	}

	if err := s.db.Create(id).Error; err != nil {
		return nil, fmt.Errorf("failed to create numeric ID: %w", err)
	}

	// Cache in Redis
	s.cacheID(id)

	return id, nil
}

// GenerateCustomID generates a custom formatted ID
func (s *IDGenerationService) GenerateCustomID(idType IDType, format string, reservedBy string, metadata map[string]interface{}) (*GeneratedID, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	customID := s.generateCustomFormat(format)

	id := &GeneratedID{
		Type:       idType,
		Value:      customID,
		Status:     IDStatusReserved,
		ReservedBy: reservedBy,
		ReservedAt: time.Now(),
		ExpiresAt:  timePtr(time.Now().Add(24 * time.Hour)),
		Metadata:   metadata,
	}

	if err := s.db.Create(id).Error; err != nil {
		return nil, fmt.Errorf("failed to create custom ID: %w", err)
	}

	// Cache in Redis
	s.cacheID(id)

	return id, nil
}

// ReserveBatchIDs reserves a batch of IDs
func (s *IDGenerationService) ReserveBatchIDs(idType IDType, count int, reservedBy string) (*IDReservation, []GeneratedID, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	sequence, exists := s.sequences[idType]
	if !exists {
		return nil, nil, fmt.Errorf("sequence not found for type: %s", idType)
	}

	startValue := sequence.CurrentValue
	endValue := startValue + int64(count) - 1

	// Check bounds
	if endValue > sequence.MaxValue {
		return nil, nil, fmt.Errorf("batch exceeds maximum value")
	}

	// Update sequence
	sequence.CurrentValue = endValue + 1
	if err := s.db.Save(sequence).Error; err != nil {
		return nil, nil, fmt.Errorf("failed to update sequence: %w", err)
	}

	// Create reservation
	reservation := &IDReservation{
		Type:       idType,
		Count:      count,
		StartValue: startValue,
		EndValue:   endValue,
		ReservedBy: reservedBy,
		Status:     "active",
		ExpiresAt:  time.Now().Add(24 * time.Hour),
	}

	if err := s.db.Create(reservation).Error; err != nil {
		return nil, nil, fmt.Errorf("failed to create reservation: %w", err)
	}

	// Generate IDs
	var ids []GeneratedID
	for i := startValue; i <= endValue; i++ {
		formattedID := s.formatNumericID(sequence, i)
		
		id := GeneratedID{
			Type:       idType,
			Value:      formattedID,
			NumericID:  i,
			Status:     IDStatusReserved,
			ReservedBy: reservedBy,
			ReservedAt: time.Now(),
			ExpiresAt:  &reservation.ExpiresAt,
		}

		if err := s.db.Create(&id).Error; err != nil {
			return nil, nil, fmt.Errorf("failed to create batch ID: %w", err)
		}

		ids = append(ids, id)
		s.cacheID(&id)
	}

	return reservation, ids, nil
}

// AssignID assigns a reserved ID to an entity
func (s *IDGenerationService) AssignID(idValue string, assignedTo string) (*GeneratedID, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	var id GeneratedID
	if err := s.db.Where("value = ?", idValue).First(&id).Error; err != nil {
		return nil, fmt.Errorf("ID not found: %w", err)
	}

	if id.Status != IDStatusReserved {
		return nil, fmt.Errorf("ID is not in reserved status")
	}

	// Check expiry
	if id.ExpiresAt != nil && time.Now().After(*id.ExpiresAt) {
		id.Status = IDStatusExpired
		s.db.Save(&id)
		return nil, fmt.Errorf("ID has expired")
	}

	// Assign ID
	now := time.Now()
	id.Status = IDStatusAssigned
	id.AssignedTo = assignedTo
	id.AssignedAt = &now

	if err := s.db.Save(&id).Error; err != nil {
		return nil, fmt.Errorf("failed to assign ID: %w", err)
	}

	// Update cache
	s.cacheID(&id)

	return &id, nil
}

// UseID marks an ID as used
func (s *IDGenerationService) UseID(idValue string, usedBy string) (*GeneratedID, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	var id GeneratedID
	if err := s.db.Where("value = ?", idValue).First(&id).Error; err != nil {
		return nil, fmt.Errorf("ID not found: %w", err)
	}

	if id.Status != IDStatusAssigned && id.Status != IDStatusReserved {
		return nil, fmt.Errorf("ID is not in assignable status")
	}

	// Use ID
	now := time.Now()
	id.Status = IDStatusUsed
	id.UsedBy = usedBy
	id.UsedAt = &now

	if err := s.db.Save(&id).Error; err != nil {
		return nil, fmt.Errorf("failed to use ID: %w", err)
	}

	// Update cache
	s.cacheID(&id)

	return &id, nil
}

// GetID retrieves an ID by value
func (s *IDGenerationService) GetID(idValue string) (*GeneratedID, error) {
	// Try cache first
	if cachedID := s.getCachedID(idValue); cachedID != nil {
		return cachedID, nil
	}

	// Query database
	var id GeneratedID
	if err := s.db.Where("value = ?", idValue).First(&id).Error; err != nil {
		return nil, fmt.Errorf("ID not found: %w", err)
	}

	// Cache result
	s.cacheID(&id)

	return &id, nil
}

// ValidateID validates an ID format and availability
func (s *IDGenerationService) ValidateID(idValue string, idType IDType) (bool, error) {
	id, err := s.GetID(idValue)
	if err != nil {
		return false, err
	}

	// Check type match
	if id.Type != idType {
		return false, fmt.Errorf("ID type mismatch")
	}

	// Check status
	if id.Status == IDStatusExpired {
		return false, fmt.Errorf("ID has expired")
	}

	// Check expiry
	if id.ExpiresAt != nil && time.Now().After(*id.ExpiresAt) {
		return false, fmt.Errorf("ID has expired")
	}

	return true, nil
}

// formatNumericID formats a numeric ID according to sequence settings
func (s *IDGenerationService) formatNumericID(sequence *IDSequence, value int64) string {
	formatted := fmt.Sprintf("%0*d", sequence.PadLength, value)
	return sequence.Prefix + formatted + sequence.Suffix
}

// generateCustomFormat generates ID based on custom format
func (s *IDGenerationService) generateCustomFormat(format string) string {
	now := time.Now()
	
	// Replace format placeholders
	result := strings.ReplaceAll(format, "{YYYY}", fmt.Sprintf("%04d", now.Year()))
	result = strings.ReplaceAll(result, "{MM}", fmt.Sprintf("%02d", now.Month()))
	result = strings.ReplaceAll(result, "{DD}", fmt.Sprintf("%02d", now.Day()))
	result = strings.ReplaceAll(result, "{HH}", fmt.Sprintf("%02d", now.Hour()))
	result = strings.ReplaceAll(result, "{mm}", fmt.Sprintf("%02d", now.Minute()))
	result = strings.ReplaceAll(result, "{ss}", fmt.Sprintf("%02d", now.Second()))
	result = strings.ReplaceAll(result, "{UUID}", uuid.New().String())
	result = strings.ReplaceAll(result, "{RAND4}", s.generateRandomString(4))
	result = strings.ReplaceAll(result, "{RAND8}", s.generateRandomString(8))
	result = strings.ReplaceAll(result, "{TIMESTAMP}", fmt.Sprintf("%d", now.Unix()))
	
	return result
}

// generateRandomString generates a random string of specified length
func (s *IDGenerationService) generateRandomString(length int) string {
	bytes := make([]byte, length/2)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)[:length]
}

// cacheID caches an ID in Redis
func (s *IDGenerationService) cacheID(id *GeneratedID) {
	if s.redis == nil {
		return
	}

	data, err := json.Marshal(id)
	if err != nil {
		return
	}

	ctx := context.Background()
	s.redis.Set(ctx, fmt.Sprintf("id:%s", id.Value), data, 24*time.Hour)
}

// getCachedID retrieves an ID from Redis cache
func (s *IDGenerationService) getCachedID(idValue string) *GeneratedID {
	if s.redis == nil {
		return nil
	}

	ctx := context.Background()
	data, err := s.redis.Get(ctx, fmt.Sprintf("id:%s", idValue)).Result()
	if err != nil {
		return nil
	}

	var id GeneratedID
	if err := json.Unmarshal([]byte(data), &id); err != nil {
		return nil
	}

	return &id
}

// cleanupExpiredIDs periodically cleans up expired IDs
func (s *IDGenerationService) cleanupExpiredIDs() {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for range ticker.C {
		now := time.Now()
		
		// Update expired IDs
		s.db.Model(&GeneratedID{}).
			Where("expires_at < ? AND status != ?", now, IDStatusExpired).
			Update("status", IDStatusExpired)

		// Clean up old expired IDs (older than 30 days)
		cutoff := now.AddDate(0, 0, -30)
		s.db.Where("status = ? AND updated_at < ?", IDStatusExpired, cutoff).
			Delete(&GeneratedID{})

		log.Printf("Cleaned up expired IDs")
	}
}

// =====================================================
// HTTP HANDLERS
// =====================================================

var idService *IDGenerationService

// generateUUIDHandler generates a UUID
func generateUUIDHandler(c *gin.Context) {
	var req struct {
		Type       IDType                 `json:"type" binding:"required"`
		ReservedBy string                 `json:"reserved_by" binding:"required"`
		Metadata   map[string]interface{} `json:"metadata"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	id, err := idService.GenerateUUID(req.Type, req.ReservedBy, req.Metadata)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, id)
}

// generateNumericIDHandler generates a numeric ID
func generateNumericIDHandler(c *gin.Context) {
	var req struct {
		Type       IDType                 `json:"type" binding:"required"`
		ReservedBy string                 `json:"reserved_by" binding:"required"`
		Metadata   map[string]interface{} `json:"metadata"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	id, err := idService.GenerateNumericID(req.Type, req.ReservedBy, req.Metadata)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, id)
}

// generateCustomIDHandler generates a custom ID
func generateCustomIDHandler(c *gin.Context) {
	var req struct {
		Type       IDType                 `json:"type" binding:"required"`
		Format     string                 `json:"format" binding:"required"`
		ReservedBy string                 `json:"reserved_by" binding:"required"`
		Metadata   map[string]interface{} `json:"metadata"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	id, err := idService.GenerateCustomID(req.Type, req.Format, req.ReservedBy, req.Metadata)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, id)
}

// reserveBatchIDsHandler reserves a batch of IDs
func reserveBatchIDsHandler(c *gin.Context) {
	var req struct {
		Type       IDType `json:"type" binding:"required"`
		Count      int    `json:"count" binding:"required,min=1,max=1000"`
		ReservedBy string `json:"reserved_by" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	reservation, ids, err := idService.ReserveBatchIDs(req.Type, req.Count, req.ReservedBy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"reservation": reservation,
		"ids":         ids,
	})
}

// assignIDHandler assigns an ID
func assignIDHandler(c *gin.Context) {
	idValue := c.Param("id")
	
	var req struct {
		AssignedTo string `json:"assigned_to" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	id, err := idService.AssignID(idValue, req.AssignedTo)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, id)
}

// useIDHandler marks an ID as used
func useIDHandler(c *gin.Context) {
	idValue := c.Param("id")
	
	var req struct {
		UsedBy string `json:"used_by" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	id, err := idService.UseID(idValue, req.UsedBy)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, id)
}

// getIDHandler retrieves an ID
func getIDHandler(c *gin.Context) {
	idValue := c.Param("id")

	id, err := idService.GetID(idValue)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ID not found"})
		return
	}

	c.JSON(http.StatusOK, id)
}

// validateIDHandler validates an ID
func validateIDHandler(c *gin.Context) {
	idValue := c.Param("id")
	idType := IDType(c.Query("type"))

	if idType == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "type parameter required"})
		return
	}

	valid, err := idService.ValidateID(idValue, idType)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"valid": false,
			"error": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"valid": valid})
}

// healthHandler returns service health
func healthHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"service":   "id-generation-service",
		"timestamp": time.Now().UTC(),
	})
}

// =====================================================
// MAIN FUNCTION
// =====================================================

func main() {
	// Database connection
	host := getEnv("DB_HOST", "localhost")
	port := getEnv("DB_PORT", "5432")
	user := requireEnv("DB_USER")      // Required - no default
	password := requireEnv("DB_PASSWORD") // Required - no default (security)
	dbname := requireEnv("DB_NAME")    // Required - no default
	sslmode := getEnv("DB_SSLMODE", "require") // Default to secure

	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		host, port, user, password, dbname, sslmode)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}

	// Redis connection
	redisURL := getEnv("REDIS_URL", "redis://localhost:6379/0")
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatal("Failed to parse Redis URL:", err)
	}

	redisClient := redis.NewClient(opt)
	if err := redisClient.Ping(context.Background()).Err(); err != nil {
		log.Printf("Redis connection failed: %v", err)
		redisClient = nil
	}

	// Auto-migrate the schema
	err = db.AutoMigrate(&GeneratedID{}, &IDSequence{}, &IDReservation{})
	if err != nil {
		log.Fatal("Failed to migrate database:", err)
	}

	// Initialize service
	idService = NewIDGenerationService(db, redisClient)

	// Setup Gin router
	r := gin.Default()

	// CORS middleware
	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"*"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	// Routes
	api := r.Group("/api/v1")
	{
		api.POST("/ids/uuid", generateUUIDHandler)
		api.POST("/ids/numeric", generateNumericIDHandler)
		api.POST("/ids/custom", generateCustomIDHandler)
		api.POST("/ids/batch", reserveBatchIDsHandler)
		api.PUT("/ids/:id/assign", assignIDHandler)
		api.PUT("/ids/:id/use", useIDHandler)
		api.GET("/ids/:id", getIDHandler)
		api.GET("/ids/:id/validate", validateIDHandler)
	}

	r.GET("/health", healthHandler)

	// Start server
	port = getEnv("PORT", "8111")
	log.Printf("ID Generation Service starting on port %s", port)
	log.Fatal(r.Run(":" + port))
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

func timePtr(t time.Time) *time.Time {
	return &t
}

