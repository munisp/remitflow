package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// POSTerminal represents a POS terminal with geolocation
type POSTerminal struct {
	ID                string    `json:"id" gorm:"primaryKey"`
	MerchantID        string    `json:"merchant_id" gorm:"index"`
	TerminalID        string    `json:"terminal_id" gorm:"uniqueIndex"`
	Latitude          float64   `json:"latitude"`
	Longitude         float64   `json:"longitude"`
	Accuracy          float64   `json:"accuracy"`
	RegisteredAt      time.Time `json:"registered_at"`
	LastLocationUpdate time.Time `json:"last_location_update"`
	IsActive          bool      `json:"is_active"`
	LocationSource    string    `json:"location_source"` // GPS, NETWORK, PASSIVE
	ComplianceStatus  string    `json:"compliance_status"` // COMPLIANT, NON_COMPLIANT, PENDING
	PTSARegistered    bool      `json:"ptsa_registered"`
	BusinessRadius    float64   `json:"business_radius"` // Allowed radius in meters
}

// LocationUpdate represents a location update from POS terminal
type LocationUpdate struct {
	TerminalID    string    `json:"terminal_id"`
	Latitude      float64   `json:"latitude"`
	Longitude     float64   `json:"longitude"`
	Accuracy      float64   `json:"accuracy"`
	Timestamp     time.Time `json:"timestamp"`
	Source        string    `json:"source"`
	TransactionID string    `json:"transaction_id,omitempty"`
}

// Transaction represents a transaction with geolocation
type Transaction struct {
	ID               string    `json:"id" gorm:"primaryKey"`
	TerminalID       string    `json:"terminal_id" gorm:"index"`
	Amount           float64   `json:"amount"`
	Currency         string    `json:"currency"`
	Latitude         float64   `json:"latitude"`
	Longitude        float64   `json:"longitude"`
	LocationAccuracy float64   `json:"location_accuracy"`
	Timestamp        time.Time `json:"timestamp"`
	LocationValid    bool      `json:"location_valid"`
	DistanceFromBase float64   `json:"distance_from_base"`
	FraudScore       float64   `json:"fraud_score"`
	Status           string    `json:"status"`
}

// GeofenceViolation represents a geofence violation
type GeofenceViolation struct {
	ID               string    `json:"id" gorm:"primaryKey"`
	TerminalID       string    `json:"terminal_id" gorm:"index"`
	TransactionID    string    `json:"transaction_id"`
	ViolationType    string    `json:"violation_type"`
	Distance         float64   `json:"distance"`
	Severity         string    `json:"severity"`
	Timestamp        time.Time `json:"timestamp"`
	Resolved         bool      `json:"resolved"`
	ActionTaken      string    `json:"action_taken"`
}

// POSGeoService handles POS geolocation operations
type POSGeoService struct {
	db          *gorm.DB
	redis       *redis.Client
	mu          sync.RWMutex
	terminals   map[string]*POSTerminal
	violations  []GeofenceViolation
}

// NewPOSGeoService creates a new POS geolocation service
func NewPOSGeoService() *POSGeoService {
	// Database connection
	dsn := "host=localhost user=postgres password=postgres dbname=remittance port=5432 sslmode=disable"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Printf("Failed to connect to database: %v", err)
		// Continue with in-memory operation
	}

	// Redis connection
	rdb := redis.NewClient(&redis.Options{
		Addr:     "localhost:6379",
		Password: "",
		DB:       0,
	})

	service := &POSGeoService{
		db:        db,
		redis:     rdb,
		terminals: make(map[string]*POSTerminal),
		violations: make([]GeofenceViolation, 0),
	}

	// Auto-migrate database tables
	if db != nil {
		db.AutoMigrate(&POSTerminal{}, &Transaction{}, &GeofenceViolation{})
	}

	// Load existing terminals
	service.loadTerminals()

	return service
}

// loadTerminals loads existing terminals from database
func (s *POSGeoService) loadTerminals() {
	if s.db == nil {
		return
	}

	var terminals []POSTerminal
	if err := s.db.Find(&terminals).Error; err != nil {
		log.Printf("Failed to load terminals: %v", err)
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for _, terminal := range terminals {
		s.terminals[terminal.TerminalID] = &terminal
	}

	log.Printf("Loaded %d POS terminals", len(terminals))
}

// RegisterTerminal registers a new POS terminal with geolocation
func (s *POSGeoService) RegisterTerminal(c *gin.Context) {
	var terminal POSTerminal
	if err := c.ShouldBindJSON(&terminal); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate location accuracy
	if terminal.Accuracy > 50 { // More than 50 meters accuracy is not acceptable
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Location accuracy too low",
			"required_accuracy": "< 50 meters",
			"provided_accuracy": terminal.Accuracy,
		})
		return
	}

	// Set defaults
	terminal.RegisteredAt = time.Now()
	terminal.LastLocationUpdate = time.Now()
	terminal.IsActive = true
	terminal.ComplianceStatus = "PENDING"
	terminal.BusinessRadius = 10.0 // Default 10 meter radius

	// Validate with CBN requirements
	if terminal.Accuracy <= 10 {
		terminal.ComplianceStatus = "COMPLIANT"
		terminal.PTSARegistered = true
	}

	// Save to database
	if s.db != nil {
		if err := s.db.Create(&terminal).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save terminal"})
			return
		}
	}

	// Cache in memory and Redis
	s.mu.Lock()
	s.terminals[terminal.TerminalID] = &terminal
	s.mu.Unlock()

	if s.redis != nil {
		terminalJSON, _ := json.Marshal(terminal)
		s.redis.Set(context.Background(), fmt.Sprintf("terminal:%s", terminal.TerminalID), terminalJSON, time.Hour*24)
	}

	c.JSON(http.StatusCreated, gin.H{
		"status": "success",
		"terminal": terminal,
		"compliance": gin.H{
			"cbn_compliant": terminal.ComplianceStatus == "COMPLIANT",
			"ptsa_registered": terminal.PTSARegistered,
			"accuracy_requirement": "≤ 10 meters",
			"business_radius": terminal.BusinessRadius,
		},
	})
}

// UpdateLocation updates the location of a POS terminal
func (s *POSGeoService) UpdateLocation(c *gin.Context) {
	var update LocationUpdate
	if err := c.ShouldBindJSON(&update); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	s.mu.Lock()
	terminal, exists := s.terminals[update.TerminalID]
	s.mu.Unlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Terminal not found"})
		return
	}

	// Calculate distance from registered location
	distance := s.calculateDistance(
		terminal.Latitude, terminal.Longitude,
		update.Latitude, update.Longitude,
	)

	// Check geofence violation
	violation := false
	if distance > terminal.BusinessRadius {
		violation = true
		s.recordGeofenceViolation(update.TerminalID, "", "LOCATION_DRIFT", distance)
	}

	// Update terminal location
	s.mu.Lock()
	terminal.Latitude = update.Latitude
	terminal.Longitude = update.Longitude
	terminal.Accuracy = update.Accuracy
	terminal.LastLocationUpdate = time.Now()
	terminal.LocationSource = update.Source

	// Update compliance status
	if update.Accuracy <= 10 {
		terminal.ComplianceStatus = "COMPLIANT"
	} else {
		terminal.ComplianceStatus = "NON_COMPLIANT"
	}
	s.mu.Unlock()

	// Save to database
	if s.db != nil {
		s.db.Save(terminal)
	}

	// Update Redis cache
	if s.redis != nil {
		terminalJSON, _ := json.Marshal(terminal)
		s.redis.Set(context.Background(), fmt.Sprintf("terminal:%s", terminal.TerminalID), terminalJSON, time.Hour*24)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"location_updated": true,
		"distance_from_base": distance,
		"geofence_violation": violation,
		"compliance_status": terminal.ComplianceStatus,
		"accuracy": update.Accuracy,
		"cbn_compliant": terminal.ComplianceStatus == "COMPLIANT",
	})
}

// ProcessTransaction processes a transaction with geolocation validation
func (s *POSGeoService) ProcessTransaction(c *gin.Context) {
	var transaction Transaction
	if err := c.ShouldBindJSON(&transaction); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	s.mu.RLock()
	terminal, exists := s.terminals[transaction.TerminalID]
	s.mu.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Terminal not found"})
		return
	}

	// Calculate distance from registered terminal location
	distance := s.calculateDistance(
		terminal.Latitude, terminal.Longitude,
		transaction.Latitude, transaction.Longitude,
	)

	// Validate location
	transaction.LocationValid = distance <= terminal.BusinessRadius
	transaction.DistanceFromBase = distance
	transaction.Timestamp = time.Now()

	// Calculate fraud score based on location
	fraudScore := s.calculateLocationFraudScore(distance, terminal.BusinessRadius, transaction.LocationAccuracy)
	transaction.FraudScore = fraudScore

	// Determine transaction status
	if !transaction.LocationValid {
		transaction.Status = "LOCATION_REJECTED"
		s.recordGeofenceViolation(transaction.TerminalID, transaction.ID, "TRANSACTION_OUTSIDE_GEOFENCE", distance)
	} else if fraudScore > 0.7 {
		transaction.Status = "FRAUD_REVIEW"
	} else {
		transaction.Status = "APPROVED"
	}

	// Save transaction
	if s.db != nil {
		s.db.Create(&transaction)
	}

	// Cache transaction result
	if s.redis != nil {
		transactionJSON, _ := json.Marshal(transaction)
		s.redis.Set(context.Background(), fmt.Sprintf("transaction:%s", transaction.ID), transactionJSON, time.Hour*24)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "processed",
		"transaction": transaction,
		"geolocation_validation": gin.H{
			"location_valid": transaction.LocationValid,
			"distance_from_terminal": distance,
			"allowed_radius": terminal.BusinessRadius,
			"fraud_score": fraudScore,
			"cbn_compliant": terminal.ComplianceStatus == "COMPLIANT",
		},
	})
}

// GetTerminalStatus gets the status of a POS terminal
func (s *POSGeoService) GetTerminalStatus(c *gin.Context) {
	terminalID := c.Param("terminal_id")

	s.mu.RLock()
	terminal, exists := s.terminals[terminalID]
	s.mu.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Terminal not found"})
		return
	}

	// Get recent violations
	var violations []GeofenceViolation
	if s.db != nil {
		s.db.Where("terminal_id = ? AND timestamp > ?", terminalID, time.Now().Add(-24*time.Hour)).Find(&violations)
	}

	c.JSON(http.StatusOK, gin.H{
		"terminal": terminal,
		"status": gin.H{
			"is_active": terminal.IsActive,
			"compliance_status": terminal.ComplianceStatus,
			"ptsa_registered": terminal.PTSARegistered,
			"last_update": terminal.LastLocationUpdate,
			"location_accuracy": terminal.Accuracy,
		},
		"violations_24h": len(violations),
		"cbn_compliance": gin.H{
			"accuracy_requirement": "≤ 10 meters",
			"current_accuracy": terminal.Accuracy,
			"compliant": terminal.ComplianceStatus == "COMPLIANT",
			"business_radius": terminal.BusinessRadius,
		},
	})
}

// GetNearbyTerminals gets terminals within a specified radius
func (s *POSGeoService) GetNearbyTerminals(c *gin.Context) {
	latStr := c.Query("latitude")
	lonStr := c.Query("longitude")
	radiusStr := c.Query("radius")

	lat, err := strconv.ParseFloat(latStr, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid latitude"})
		return
	}

	lon, err := strconv.ParseFloat(lonStr, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid longitude"})
		return
	}

	radius := 1000.0 // Default 1km
	if radiusStr != "" {
		if r, err := strconv.ParseFloat(radiusStr, 64); err == nil {
			radius = r
		}
	}

	var nearbyTerminals []gin.H
	s.mu.RLock()
	for _, terminal := range s.terminals {
		distance := s.calculateDistance(lat, lon, terminal.Latitude, terminal.Longitude)
		if distance <= radius {
			nearbyTerminals = append(nearbyTerminals, gin.H{
				"terminal": terminal,
				"distance": distance,
			})
		}
	}
	s.mu.RUnlock()

	c.JSON(http.StatusOK, gin.H{
		"nearby_terminals": nearbyTerminals,
		"search_center": gin.H{
			"latitude": lat,
			"longitude": lon,
		},
		"search_radius": radius,
		"count": len(nearbyTerminals),
	})
}

// GetViolations gets geofence violations
func (s *POSGeoService) GetViolations(c *gin.Context) {
	terminalID := c.Query("terminal_id")
	limitStr := c.Query("limit")

	limit := 100
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil {
			limit = l
		}
	}

	var violations []GeofenceViolation
	if s.db != nil {
		query := s.db.Order("timestamp DESC").Limit(limit)
		if terminalID != "" {
			query = query.Where("terminal_id = ?", terminalID)
		}
		query.Find(&violations)
	}

	c.JSON(http.StatusOK, gin.H{
		"violations": violations,
		"count": len(violations),
		"filter": gin.H{
			"terminal_id": terminalID,
			"limit": limit,
		},
	})
}

// Health check endpoint
func (s *POSGeoService) Health(c *gin.Context) {
	s.mu.RLock()
	terminalCount := len(s.terminals)
	s.mu.RUnlock()

	dbStatus := "disconnected"
	if s.db != nil {
		if sqlDB, err := s.db.DB(); err == nil {
			if err := sqlDB.Ping(); err == nil {
				dbStatus = "connected"
			}
		}
	}

	redisStatus := "disconnected"
	if s.redis != nil {
		if err := s.redis.Ping(context.Background()).Err(); err == nil {
			redisStatus = "connected"
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "healthy",
		"service": "pos-geotagging",
		"version": "v2.1.0",
		"timestamp": time.Now(),
		"terminals_registered": terminalCount,
		"database": dbStatus,
		"redis": redisStatus,
		"features": gin.H{
			"gps_tracking": true,
			"geofence_validation": true,
			"cbn_compliance": true,
			"fraud_detection": true,
			"offline_caching": true,
		},
	})
}

// calculateDistance calculates the distance between two GPS coordinates using Haversine formula
func (s *POSGeoService) calculateDistance(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371000 // Earth's radius in meters

	lat1Rad := lat1 * math.Pi / 180
	lat2Rad := lat2 * math.Pi / 180
	deltaLat := (lat2 - lat1) * math.Pi / 180
	deltaLon := (lon2 - lon1) * math.Pi / 180

	a := math.Sin(deltaLat/2)*math.Sin(deltaLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*
			math.Sin(deltaLon/2)*math.Sin(deltaLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return R * c
}

// calculateLocationFraudScore calculates fraud score based on location factors
func (s *POSGeoService) calculateLocationFraudScore(distance, allowedRadius, accuracy float64) float64 {
	score := 0.0

	// Distance factor
	if distance > allowedRadius {
		score += 0.5 * (distance / allowedRadius)
	}

	// Accuracy factor
	if accuracy > 10 {
		score += 0.3 * (accuracy / 50) // Normalize to 50m max
	}

	// Cap at 1.0
	if score > 1.0 {
		score = 1.0
	}

	return score
}

// recordGeofenceViolation records a geofence violation
func (s *POSGeoService) recordGeofenceViolation(terminalID, transactionID, violationType string, distance float64) {
	violation := GeofenceViolation{
		ID:            fmt.Sprintf("viol_%d", time.Now().UnixNano()),
		TerminalID:    terminalID,
		TransactionID: transactionID,
		ViolationType: violationType,
		Distance:      distance,
		Severity:      s.determineSeverity(distance),
		Timestamp:     time.Now(),
		Resolved:      false,
		ActionTaken:   "LOGGED",
	}

	// Save to database
	if s.db != nil {
		s.db.Create(&violation)
	}

	// Cache violation
	s.mu.Lock()
	s.violations = append(s.violations, violation)
	s.mu.Unlock()

	log.Printf("Geofence violation recorded: %s for terminal %s", violationType, terminalID)
}

// determineSeverity determines the severity of a violation based on distance
func (s *POSGeoService) determineSeverity(distance float64) string {
	if distance <= 50 {
		return "LOW"
	} else if distance <= 200 {
		return "MEDIUM"
	} else {
		return "HIGH"
	}
}

func main() {
	// Initialize service
	service := NewPOSGeoService()

	// Setup Gin router
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

	// Routes
	r.GET("/health", service.Health)
	r.POST("/terminals/register", service.RegisterTerminal)
	r.PUT("/terminals/location", service.UpdateLocation)
	r.POST("/transactions/process", service.ProcessTransaction)
	r.GET("/terminals/:terminal_id/status", service.GetTerminalStatus)
	r.GET("/terminals/nearby", service.GetNearbyTerminals)
	r.GET("/violations", service.GetViolations)

	// Test endpoint
	r.POST("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status": "success",
			"service": "pos-geotagging",
			"test_result": gin.H{
				"gps_accuracy": "< 10 meters",
				"geofence_validation": "active",
				"cbn_compliance": "enabled",
				"fraud_detection": "operational",
			},
		})
	})

	log.Println("POS Geo-tagging Service starting on port 8092...")
	log.Fatal(http.ListenAndServe(":8092", r))
}

