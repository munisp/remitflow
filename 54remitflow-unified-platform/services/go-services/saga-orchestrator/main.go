package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lib/pq"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// =====================================================
// SAGA PATTERN IMPLEMENTATION
// =====================================================

type SagaStatus string
type StepStatus string
type CompensationStatus string

const (
	SagaStatusPending     SagaStatus = "pending"
	SagaStatusInProgress  SagaStatus = "in_progress"
	SagaStatusCompleted   SagaStatus = "completed"
	SagaStatusFailed      SagaStatus = "failed"
	SagaStatusCompensated SagaStatus = "compensated"

	StepStatusPending    StepStatus = "pending"
	StepStatusExecuting  StepStatus = "executing"
	StepStatusCompleted  StepStatus = "completed"
	StepStatusFailed     StepStatus = "failed"
	StepStatusSkipped    StepStatus = "skipped"

	CompensationStatusNotRequired CompensationStatus = "not_required"
	CompensationStatusPending     CompensationStatus = "pending"
	CompensationStatusExecuting   CompensationStatus = "executing"
	CompensationStatusCompleted   CompensationStatus = "completed"
	CompensationStatusFailed      CompensationStatus = "failed"
)

// Saga represents a distributed transaction
type Saga struct {
	ID                uuid.UUID          `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Name              string             `json:"name" gorm:"not null"`
	Status            SagaStatus         `json:"status" gorm:"default:'pending'"`
	CurrentStep       int                `json:"current_step" gorm:"default:0"`
	TotalSteps        int                `json:"total_steps" gorm:"not null"`
	Context           map[string]interface{} `json:"context" gorm:"type:jsonb"`
	StartedAt         *time.Time         `json:"started_at"`
	CompletedAt       *time.Time         `json:"completed_at"`
	FailedAt          *time.Time         `json:"failed_at"`
	CompensatedAt     *time.Time         `json:"compensated_at"`
	ErrorMessage      string             `json:"error_message"`
	RetryCount        int                `json:"retry_count" gorm:"default:0"`
	MaxRetries        int                `json:"max_retries" gorm:"default:3"`
	TimeoutSeconds    int                `json:"timeout_seconds" gorm:"default:300"`
	CreatedAt         time.Time          `json:"created_at"`
	UpdatedAt         time.Time          `json:"updated_at"`
	Steps             []SagaStep         `json:"steps" gorm:"foreignKey:SagaID"`
}

// SagaStep represents a single step in a saga
type SagaStep struct {
	ID                 uuid.UUID          `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	SagaID             uuid.UUID          `json:"saga_id" gorm:"type:uuid;not null"`
	StepNumber         int                `json:"step_number" gorm:"not null"`
	Name               string             `json:"name" gorm:"not null"`
	ServiceURL         string             `json:"service_url" gorm:"not null"`
	Action             string             `json:"action" gorm:"not null"`
	CompensationURL    string             `json:"compensation_url"`
	CompensationAction string             `json:"compensation_action"`
	Status             StepStatus         `json:"status" gorm:"default:'pending'"`
	CompensationStatus CompensationStatus `json:"compensation_status" gorm:"default:'not_required'"`
	Input              map[string]interface{} `json:"input" gorm:"type:jsonb"`
	Output             map[string]interface{} `json:"output" gorm:"type:jsonb"`
	ErrorMessage       string             `json:"error_message"`
	StartedAt          *time.Time         `json:"started_at"`
	CompletedAt        *time.Time         `json:"completed_at"`
	FailedAt           *time.Time         `json:"failed_at"`
	CompensatedAt      *time.Time         `json:"compensated_at"`
	RetryCount         int                `json:"retry_count" gorm:"default:0"`
	MaxRetries         int                `json:"max_retries" gorm:"default:3"`
	CreatedAt          time.Time          `json:"created_at"`
	UpdatedAt          time.Time          `json:"updated_at"`
}

// SagaOrchestrator manages saga execution
type SagaOrchestrator struct {
	db     *gorm.DB
	client *http.Client
	mutex  sync.RWMutex
}

// NewSagaOrchestrator creates a new saga orchestrator
func NewSagaOrchestrator(db *gorm.DB) *SagaOrchestrator {
	return &SagaOrchestrator{
		db: db,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// CreateSaga creates a new saga
func (so *SagaOrchestrator) CreateSaga(name string, steps []SagaStepDefinition, context map[string]interface{}) (*Saga, error) {
	so.mutex.Lock()
	defer so.mutex.Unlock()

	saga := &Saga{
		ID:             uuid.New(),
		Name:           name,
		Status:         SagaStatusPending,
		CurrentStep:    0,
		TotalSteps:     len(steps),
		Context:        context,
		TimeoutSeconds: 300,
		MaxRetries:     3,
	}

	// Create saga steps
	for i, stepDef := range steps {
		step := SagaStep{
			ID:                 uuid.New(),
			SagaID:             saga.ID,
			StepNumber:         i + 1,
			Name:               stepDef.Name,
			ServiceURL:         stepDef.ServiceURL,
			Action:             stepDef.Action,
			CompensationURL:    stepDef.CompensationURL,
			CompensationAction: stepDef.CompensationAction,
			Status:             StepStatusPending,
			CompensationStatus: CompensationStatusNotRequired,
			Input:              stepDef.Input,
			MaxRetries:         stepDef.MaxRetries,
		}
		saga.Steps = append(saga.Steps, step)
	}

	if err := so.db.Create(saga).Error; err != nil {
		return nil, fmt.Errorf("failed to create saga: %w", err)
	}

	return saga, nil
}

// ExecuteSaga executes a saga
func (so *SagaOrchestrator) ExecuteSaga(sagaID uuid.UUID) error {
	saga, err := so.GetSaga(sagaID)
	if err != nil {
		return fmt.Errorf("failed to get saga: %w", err)
	}

	if saga.Status != SagaStatusPending {
		return fmt.Errorf("saga is not in pending status")
	}

	// Update saga status to in progress
	now := time.Now()
	saga.Status = SagaStatusInProgress
	saga.StartedAt = &now
	if err := so.db.Save(saga).Error; err != nil {
		return fmt.Errorf("failed to update saga status: %w", err)
	}

	// Execute steps sequentially
	for i, step := range saga.Steps {
		if err := so.executeStep(saga, &step); err != nil {
			log.Printf("Step %d failed: %v", i+1, err)
			
			// Mark saga as failed
			failedAt := time.Now()
			saga.Status = SagaStatusFailed
			saga.FailedAt = &failedAt
			saga.ErrorMessage = err.Error()
			so.db.Save(saga)

			// Start compensation
			if err := so.compensateSaga(saga); err != nil {
				log.Printf("Compensation failed: %v", err)
			}
			return err
		}
		saga.CurrentStep = i + 1
		so.db.Save(saga)
	}

	// Mark saga as completed
	completedAt := time.Now()
	saga.Status = SagaStatusCompleted
	saga.CompletedAt = &completedAt
	so.db.Save(saga)

	return nil
}

// executeStep executes a single saga step
func (so *SagaOrchestrator) executeStep(saga *Saga, step *SagaStep) error {
	// Update step status
	now := time.Now()
	step.Status = StepStatusExecuting
	step.StartedAt = &now
	so.db.Save(step)

	// Prepare request payload
	payload := map[string]interface{}{
		"saga_id":     saga.ID,
		"step_id":     step.ID,
		"step_number": step.StepNumber,
		"input":       step.Input,
		"context":     saga.Context,
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	// Make HTTP request to service
	url := fmt.Sprintf("%s/%s", step.ServiceURL, step.Action)
	resp, err := so.client.Post(url, "application/json", 
		strings.NewReader(string(payloadBytes)))
	if err != nil {
		step.Status = StepStatusFailed
		step.ErrorMessage = err.Error()
		failedAt := time.Now()
		step.FailedAt = &failedAt
		so.db.Save(step)
		return fmt.Errorf("failed to execute step: %w", err)
	}
	defer resp.Body.Close()

	// Handle response
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		// Success
		var result map[string]interface{}
		if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
			step.Output = result
		}
		
		completedAt := time.Now()
		step.Status = StepStatusCompleted
		step.CompletedAt = &completedAt
		so.db.Save(step)
		return nil
	} else {
		// Failure
		var errorResp map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&errorResp)
		
		errorMsg := fmt.Sprintf("HTTP %d", resp.StatusCode)
		if msg, ok := errorResp["error"].(string); ok {
			errorMsg = msg
		}
		
		step.Status = StepStatusFailed
		step.ErrorMessage = errorMsg
		failedAt := time.Now()
		step.FailedAt = &failedAt
		so.db.Save(step)
		
		return fmt.Errorf("step failed with status %d: %s", resp.StatusCode, errorMsg)
	}
}

// compensateSaga executes compensation for all completed steps
func (so *SagaOrchestrator) compensateSaga(saga *Saga) error {
	log.Printf("Starting compensation for saga %s", saga.ID)

	// Compensate steps in reverse order
	for i := len(saga.Steps) - 1; i >= 0; i-- {
		step := &saga.Steps[i]
		
		// Only compensate completed steps
		if step.Status != StepStatusCompleted {
			continue
		}

		if step.CompensationURL == "" || step.CompensationAction == "" {
			log.Printf("No compensation defined for step %s", step.Name)
			continue
		}

		if err := so.compensateStep(saga, step); err != nil {
			log.Printf("Compensation failed for step %s: %v", step.Name, err)
			// Continue with other compensations even if one fails
		}
	}

	// Mark saga as compensated
	compensatedAt := time.Now()
	saga.Status = SagaStatusCompensated
	saga.CompensatedAt = &compensatedAt
	so.db.Save(saga)

	return nil
}

// compensateStep executes compensation for a single step
func (so *SagaOrchestrator) compensateStep(saga *Saga, step *SagaStep) error {
	// Update compensation status
	step.CompensationStatus = CompensationStatusExecuting
	so.db.Save(step)

	// Prepare compensation payload
	payload := map[string]interface{}{
		"saga_id":     saga.ID,
		"step_id":     step.ID,
		"step_number": step.StepNumber,
		"input":       step.Input,
		"output":      step.Output,
		"context":     saga.Context,
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal compensation payload: %w", err)
	}

	// Make HTTP request for compensation
	url := fmt.Sprintf("%s/%s", step.CompensationURL, step.CompensationAction)
	resp, err := so.client.Post(url, "application/json", 
		strings.NewReader(string(payloadBytes)))
	if err != nil {
		step.CompensationStatus = CompensationStatusFailed
		so.db.Save(step)
		return fmt.Errorf("failed to execute compensation: %w", err)
	}
	defer resp.Body.Close()

	// Handle compensation response
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		compensatedAt := time.Now()
		step.CompensationStatus = CompensationStatusCompleted
		step.CompensatedAt = &compensatedAt
		so.db.Save(step)
		return nil
	} else {
		step.CompensationStatus = CompensationStatusFailed
		so.db.Save(step)
		return fmt.Errorf("compensation failed with status %d", resp.StatusCode)
	}
}

// GetSaga retrieves a saga by ID
func (so *SagaOrchestrator) GetSaga(id uuid.UUID) (*Saga, error) {
	var saga Saga
	if err := so.db.Preload("Steps").First(&saga, "id = ?", id).Error; err != nil {
		return nil, fmt.Errorf("failed to get saga: %w", err)
	}
	return &saga, nil
}

// ListSagas lists sagas with pagination
func (so *SagaOrchestrator) ListSagas(page, limit int, status SagaStatus) ([]Saga, int64, error) {
	var sagas []Saga
	var total int64

	query := so.db.Model(&Saga{})
	if status != "" {
		query = query.Where("status = ?", status)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count sagas: %w", err)
	}

	offset := (page - 1) * limit
	if err := query.Preload("Steps").Order("created_at DESC").
		Offset(offset).Limit(limit).Find(&sagas).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to list sagas: %w", err)
	}

	return sagas, total, nil
}

// SagaStepDefinition defines a saga step
type SagaStepDefinition struct {
	Name               string                 `json:"name"`
	ServiceURL         string                 `json:"service_url"`
	Action             string                 `json:"action"`
	CompensationURL    string                 `json:"compensation_url"`
	CompensationAction string                 `json:"compensation_action"`
	Input              map[string]interface{} `json:"input"`
	MaxRetries         int                    `json:"max_retries"`
}

// =====================================================
// HTTP HANDLERS
// =====================================================

var orchestrator *SagaOrchestrator

// createSagaHandler creates a new saga
func createSagaHandler(c *gin.Context) {
	var req struct {
		Name    string                   `json:"name" binding:"required"`
		Steps   []SagaStepDefinition     `json:"steps" binding:"required"`
		Context map[string]interface{}   `json:"context"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	saga, err := orchestrator.CreateSaga(req.Name, req.Steps, req.Context)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, saga)
}

// executeSagaHandler executes a saga
func executeSagaHandler(c *gin.Context) {
	sagaID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid saga ID"})
		return
	}

	// Execute saga asynchronously
	go func() {
		if err := orchestrator.ExecuteSaga(sagaID); err != nil {
			log.Printf("Saga execution failed: %v", err)
		}
	}()

	c.JSON(http.StatusAccepted, gin.H{"message": "saga execution started"})
}

// getSagaHandler retrieves a saga
func getSagaHandler(c *gin.Context) {
	sagaID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid saga ID"})
		return
	}

	saga, err := orchestrator.GetSaga(sagaID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "saga not found"})
		return
	}

	c.JSON(http.StatusOK, saga)
}

// listSagasHandler lists sagas
func listSagasHandler(c *gin.Context) {
	page := 1
	limit := 50
	var status SagaStatus

	if p := c.Query("page"); p != "" {
		if parsed, err := strconv.Atoi(p); err == nil && parsed > 0 {
			page = parsed
		}
	}

	if l := c.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	if s := c.Query("status"); s != "" {
		status = SagaStatus(s)
	}

	sagas, total, err := orchestrator.ListSagas(page, limit, status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"sagas": sagas,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

// healthHandler returns service health
func healthHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"service":   "saga-orchestrator",
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

	// Auto-migrate the schema
	err = db.AutoMigrate(&Saga{}, &SagaStep{})
	if err != nil {
		log.Fatal("Failed to migrate database:", err)
	}

	// Initialize orchestrator
	orchestrator = NewSagaOrchestrator(db)

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
		api.POST("/sagas", createSagaHandler)
		api.POST("/sagas/:id/execute", executeSagaHandler)
		api.GET("/sagas/:id", getSagaHandler)
		api.GET("/sagas", listSagasHandler)
	}

	r.GET("/health", healthHandler)

	// Start server
	port = getEnv("PORT", "8110")
	log.Printf("Saga Orchestrator starting on port %s", port)
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

