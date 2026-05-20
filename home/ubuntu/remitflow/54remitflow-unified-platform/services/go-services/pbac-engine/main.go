package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/golang-jwt/jwt/v4"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Policy represents a PBAC policy
type Policy struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	Name        string    `json:"name" gorm:"uniqueIndex;not null"`
	Description string    `json:"description"`
	Resource    string    `json:"resource" gorm:"not null"`
	Action      string    `json:"action" gorm:"not null"`
	Effect      string    `json:"effect" gorm:"not null"` // ALLOW or DENY
	Conditions  string    `json:"conditions" gorm:"type:jsonb"`
	Priority    int       `json:"priority" gorm:"default:100"`
	Active      bool      `json:"active" gorm:"default:true"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// PolicyRule represents a policy rule condition
type PolicyRule struct {
	Field    string      `json:"field"`
	Operator string      `json:"operator"`
	Value    interface{} `json:"value"`
}

// PolicyCondition represents policy conditions
type PolicyCondition struct {
	Rules []PolicyRule `json:"rules"`
	Logic string       `json:"logic"` // AND or OR
}

// AccessRequest represents an access request
type AccessRequest struct {
	Subject  string                 `json:"subject"`
	Resource string                 `json:"resource"`
	Action   string                 `json:"action"`
	Context  map[string]interface{} `json:"context"`
}

// AccessResponse represents an access response
type AccessResponse struct {
	Decision    string   `json:"decision"` // ALLOW or DENY
	Reason      string   `json:"reason"`
	Policies    []string `json:"policies"`
	RequestID   string   `json:"request_id"`
	ProcessTime int64    `json:"process_time_ms"`
}

// PolicyTemplate represents a policy template
type PolicyTemplate struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	Name        string    `json:"name" gorm:"uniqueIndex;not null"`
	Description string    `json:"description"`
	Category    string    `json:"category"`
	Template    string    `json:"template" gorm:"type:text"`
	Variables   string    `json:"variables" gorm:"type:jsonb"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// AuditLog represents policy audit logs
type AuditLog struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	RequestID string    `json:"request_id" gorm:"index"`
	Subject   string    `json:"subject" gorm:"index"`
	Resource  string    `json:"resource" gorm:"index"`
	Action    string    `json:"action" gorm:"index"`
	Decision  string    `json:"decision" gorm:"index"`
	Reason    string    `json:"reason"`
	Policies  string    `json:"policies" gorm:"type:jsonb"`
	Context   string    `json:"context" gorm:"type:jsonb"`
	Timestamp time.Time `json:"timestamp" gorm:"index"`
	Duration  int64     `json:"duration_ms"`
}

// PBACEngine represents the main PBAC engine
type PBACEngine struct {
	db    *gorm.DB
	redis *redis.Client
}

// NewPBACEngine creates a new PBAC engine
func NewPBACEngine() *PBACEngine {
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
		DB:       0,
	})

	// Test Redis connection
	ctx := context.Background()
	_, err = rdb.Ping(ctx).Result()
	if err != nil {
		log.Printf("Redis connection failed: %v", err)
	}

	engine := &PBACEngine{
		db:    db,
		redis: rdb,
	}

	// Auto-migrate database
	engine.migrate()

	// Initialize default policies
	engine.initializeDefaultPolicies()

	return engine
}

// migrate performs database migrations
func (p *PBACEngine) migrate() {
	err := p.db.AutoMigrate(&Policy{}, &PolicyTemplate{}, &AuditLog{})
	if err != nil {
		log.Fatal("Failed to migrate database:", err)
	}
}

// initializeDefaultPolicies creates default banking policies
func (p *PBACEngine) initializeDefaultPolicies() {
	defaultPolicies := []Policy{
		{
			Name:        "admin_full_access",
			Description: "Full access for system administrators",
			Resource:    "*",
			Action:      "*",
			Effect:      "ALLOW",
			Conditions:  `{"rules":[{"field":"role","operator":"eq","value":"admin"}],"logic":"AND"}`,
			Priority:    1,
			Active:      true,
		},
		{
			Name:        "agent_transaction_access",
			Description: "Allow agents to process transactions",
			Resource:    "transactions",
			Action:      "create",
			Effect:      "ALLOW",
			Conditions:  `{"rules":[{"field":"role","operator":"eq","value":"agent"},{"field":"status","operator":"eq","value":"active"}],"logic":"AND"}`,
			Priority:    10,
			Active:      true,
		},
		{
			Name:        "customer_view_own_data",
			Description: "Allow customers to view their own data",
			Resource:    "accounts",
			Action:      "read",
			Effect:      "ALLOW",
			Conditions:  `{"rules":[{"field":"role","operator":"eq","value":"customer"},{"field":"owner_id","operator":"eq","value":"{{subject_id}}"}],"logic":"AND"}`,
			Priority:    20,
			Active:      true,
		},
		{
			Name:        "deny_inactive_users",
			Description: "Deny access for inactive users",
			Resource:    "*",
			Action:      "*",
			Effect:      "DENY",
			Conditions:  `{"rules":[{"field":"status","operator":"eq","value":"inactive"}],"logic":"AND"}`,
			Priority:    5,
			Active:      true,
		},
		{
			Name:        "branch_manager_branch_access",
			Description: "Allow branch managers to access their branch data",
			Resource:    "branches",
			Action:      "*",
			Effect:      "ALLOW",
			Conditions:  `{"rules":[{"field":"role","operator":"eq","value":"branch_manager"},{"field":"branch_id","operator":"eq","value":"{{user_branch_id}}"}],"logic":"AND"}`,
			Priority:    15,
			Active:      true,
		},
		{
			Name:        "high_value_transaction_approval",
			Description: "Require approval for high-value transactions",
			Resource:    "transactions",
			Action:      "create",
			Effect:      "DENY",
			Conditions:  `{"rules":[{"field":"amount","operator":"gt","value":1000000},{"field":"approval_status","operator":"ne","value":"approved"}],"logic":"AND"}`,
			Priority:    8,
			Active:      true,
		},
	}

	for _, policy := range defaultPolicies {
		var existingPolicy Policy
		result := p.db.Where("name = ?", policy.Name).First(&existingPolicy)
		if result.Error == gorm.ErrRecordNotFound {
			p.db.Create(&policy)
			log.Printf("Created default policy: %s", policy.Name)
		}
	}

	// Initialize policy templates
	p.initializePolicyTemplates()
}

// initializePolicyTemplates creates default policy templates
func (p *PBACEngine) initializePolicyTemplates() {
	templates := []PolicyTemplate{
		{
			Name:        "role_based_access",
			Description: "Template for role-based access control",
			Category:    "authentication",
			Template:    `{"rules":[{"field":"role","operator":"eq","value":"{{role}}"}],"logic":"AND"}`,
			Variables:   `{"role":{"type":"string","description":"User role","required":true}}`,
		},
		{
			Name:        "resource_owner_access",
			Description: "Template for resource owner access",
			Category:    "authorization",
			Template:    `{"rules":[{"field":"owner_id","operator":"eq","value":"{{subject_id}}"}],"logic":"AND"}`,
			Variables:   `{"subject_id":{"type":"string","description":"Subject ID","required":true}}`,
		},
		{
			Name:        "time_based_access",
			Description: "Template for time-based access control",
			Category:    "temporal",
			Template:    `{"rules":[{"field":"current_time","operator":"between","value":["{{start_time}}","{{end_time}}"]}],"logic":"AND"}`,
			Variables:   `{"start_time":{"type":"string","description":"Start time","required":true},"end_time":{"type":"string","description":"End time","required":true}}`,
		},
		{
			Name:        "amount_threshold_control",
			Description: "Template for amount-based access control",
			Category:    "financial",
			Template:    `{"rules":[{"field":"amount","operator":"{{operator}}","value":{{threshold}}}],"logic":"AND"}`,
			Variables:   `{"operator":{"type":"string","description":"Comparison operator","required":true},"threshold":{"type":"number","description":"Amount threshold","required":true}}`,
		},
	}

	for _, template := range templates {
		var existingTemplate PolicyTemplate
		result := p.db.Where("name = ?", template.Name).First(&existingTemplate)
		if result.Error == gorm.ErrRecordNotFound {
			p.db.Create(&template)
			log.Printf("Created policy template: %s", template.Name)
		}
	}
}

// EvaluateAccess evaluates an access request against policies
func (p *PBACEngine) EvaluateAccess(ctx context.Context, request AccessRequest) AccessResponse {
	startTime := time.Now()
	requestID := uuid.New().String()

	response := AccessResponse{
		RequestID:   requestID,
		Decision:    "DENY",
		Reason:      "No matching policies found",
		Policies:    []string{},
		ProcessTime: 0,
	}

	// Get applicable policies
	policies, err := p.getApplicablePolicies(request.Resource, request.Action)
	if err != nil {
		response.Reason = fmt.Sprintf("Error retrieving policies: %v", err)
		p.auditLog(request, response, time.Since(startTime))
		return response
	}

	// Evaluate policies in priority order
	allowPolicies := []string{}
	denyPolicies := []string{}

	for _, policy := range policies {
		if p.evaluatePolicy(policy, request) {
			if policy.Effect == "ALLOW" {
				allowPolicies = append(allowPolicies, policy.Name)
			} else {
				denyPolicies = append(denyPolicies, policy.Name)
			}
		}
	}

	// Decision logic: DENY takes precedence
	if len(denyPolicies) > 0 {
		response.Decision = "DENY"
		response.Reason = "Access denied by policy"
		response.Policies = denyPolicies
	} else if len(allowPolicies) > 0 {
		response.Decision = "ALLOW"
		response.Reason = "Access granted by policy"
		response.Policies = allowPolicies
	}

	response.ProcessTime = time.Since(startTime).Milliseconds()

	// Audit log
	p.auditLog(request, response, time.Since(startTime))

	return response
}

// getApplicablePolicies retrieves policies applicable to the request
func (p *PBACEngine) getApplicablePolicies(resource, action string) ([]Policy, error) {
	var policies []Policy

	// Cache key
	cacheKey := fmt.Sprintf("policies:%s:%s", resource, action)

	// Try to get from cache
	if p.redis != nil {
		cached, err := p.redis.Get(context.Background(), cacheKey).Result()
		if err == nil {
			json.Unmarshal([]byte(cached), &policies)
			return policies, nil
		}
	}

	// Query database
	query := p.db.Where("active = ?", true).
		Where("(resource = ? OR resource = '*')", resource).
		Where("(action = ? OR action = '*')", action).
		Order("priority ASC")

	err := query.Find(&policies).Error
	if err != nil {
		return nil, err
	}

	// Cache the result
	if p.redis != nil {
		cached, _ := json.Marshal(policies)
		p.redis.Set(context.Background(), cacheKey, cached, 5*time.Minute)
	}

	return policies, nil
}

// evaluatePolicy evaluates a single policy against the request
func (p *PBACEngine) evaluatePolicy(policy Policy, request AccessRequest) bool {
	if policy.Conditions == "" {
		return true
	}

	var condition PolicyCondition
	err := json.Unmarshal([]byte(policy.Conditions), &condition)
	if err != nil {
		log.Printf("Error parsing policy conditions for %s: %v", policy.Name, err)
		return false
	}

	return p.evaluateCondition(condition, request)
}

// evaluateCondition evaluates policy conditions
func (p *PBACEngine) evaluateCondition(condition PolicyCondition, request AccessRequest) bool {
	results := []bool{}

	for _, rule := range condition.Rules {
		result := p.evaluateRule(rule, request)
		results = append(results, result)
	}

	if condition.Logic == "OR" {
		for _, result := range results {
			if result {
				return true
			}
		}
		return false
	} else { // AND logic (default)
		for _, result := range results {
			if !result {
				return false
			}
		}
		return true
	}
}

// evaluateRule evaluates a single rule
func (p *PBACEngine) evaluateRule(rule PolicyRule, request AccessRequest) bool {
	// Get the field value from context
	fieldValue, exists := request.Context[rule.Field]
	if !exists {
		return false
	}

	// Handle template variables
	ruleValue := p.processTemplateVariables(rule.Value, request)

	switch rule.Operator {
	case "eq":
		return fmt.Sprintf("%v", fieldValue) == fmt.Sprintf("%v", ruleValue)
	case "ne":
		return fmt.Sprintf("%v", fieldValue) != fmt.Sprintf("%v", ruleValue)
	case "gt":
		return p.compareNumbers(fieldValue, ruleValue, ">")
	case "gte":
		return p.compareNumbers(fieldValue, ruleValue, ">=")
	case "lt":
		return p.compareNumbers(fieldValue, ruleValue, "<")
	case "lte":
		return p.compareNumbers(fieldValue, ruleValue, "<=")
	case "in":
		return p.checkInArray(fieldValue, ruleValue)
	case "contains":
		return strings.Contains(fmt.Sprintf("%v", fieldValue), fmt.Sprintf("%v", ruleValue))
	case "between":
		return p.checkBetween(fieldValue, ruleValue)
	default:
		return false
	}
}

// processTemplateVariables processes template variables in rule values
func (p *PBACEngine) processTemplateVariables(value interface{}, request AccessRequest) interface{} {
	valueStr := fmt.Sprintf("%v", value)

	// Replace common template variables
	valueStr = strings.ReplaceAll(valueStr, "{{subject_id}}", request.Subject)
	
	// Replace context variables
	for key, val := range request.Context {
		placeholder := fmt.Sprintf("{{%s}}", key)
		valueStr = strings.ReplaceAll(valueStr, placeholder, fmt.Sprintf("%v", val))
	}

	return valueStr
}

// compareNumbers compares numeric values
func (p *PBACEngine) compareNumbers(a, b interface{}, operator string) bool {
	aFloat, aErr := strconv.ParseFloat(fmt.Sprintf("%v", a), 64)
	bFloat, bErr := strconv.ParseFloat(fmt.Sprintf("%v", b), 64)

	if aErr != nil || bErr != nil {
		return false
	}

	switch operator {
	case ">":
		return aFloat > bFloat
	case ">=":
		return aFloat >= bFloat
	case "<":
		return aFloat < bFloat
	case "<=":
		return aFloat <= bFloat
	default:
		return false
	}
}

// checkInArray checks if value is in array
func (p *PBACEngine) checkInArray(value, array interface{}) bool {
	valueStr := fmt.Sprintf("%v", value)
	
	switch arr := array.(type) {
	case []interface{}:
		for _, item := range arr {
			if fmt.Sprintf("%v", item) == valueStr {
				return true
			}
		}
	case []string:
		for _, item := range arr {
			if item == valueStr {
				return true
			}
		}
	}
	
	return false
}

// checkBetween checks if value is between two values
func (p *PBACEngine) checkBetween(value, range_ interface{}) bool {
	valueFloat, err := strconv.ParseFloat(fmt.Sprintf("%v", value), 64)
	if err != nil {
		return false
	}

	switch r := range_.(type) {
	case []interface{}:
		if len(r) != 2 {
			return false
		}
		min, err1 := strconv.ParseFloat(fmt.Sprintf("%v", r[0]), 64)
		max, err2 := strconv.ParseFloat(fmt.Sprintf("%v", r[1]), 64)
		if err1 != nil || err2 != nil {
			return false
		}
		return valueFloat >= min && valueFloat <= max
	}

	return false
}

// auditLog logs access requests for audit purposes
func (p *PBACEngine) auditLog(request AccessRequest, response AccessResponse, duration time.Duration) {
	contextJSON, _ := json.Marshal(request.Context)
	policiesJSON, _ := json.Marshal(response.Policies)

	auditLog := AuditLog{
		RequestID: response.RequestID,
		Subject:   request.Subject,
		Resource:  request.Resource,
		Action:    request.Action,
		Decision:  response.Decision,
		Reason:    response.Reason,
		Policies:  string(policiesJSON),
		Context:   string(contextJSON),
		Timestamp: time.Now(),
		Duration:  duration.Milliseconds(),
	}

	p.db.Create(&auditLog)
}

// REST API Handlers

// setupRoutes sets up the REST API routes
func (p *PBACEngine) setupRoutes() *gin.Engine {
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
		c.JSON(200, gin.H{"status": "healthy", "service": "pbac-engine"})
	})

	// API routes
	api := r.Group("/api/v1")
	{
		// Access evaluation
		api.POST("/evaluate", p.handleEvaluateAccess)
		
		// Policy management
		api.GET("/policies", p.handleGetPolicies)
		api.POST("/policies", p.handleCreatePolicy)
		api.GET("/policies/:id", p.handleGetPolicy)
		api.PUT("/policies/:id", p.handleUpdatePolicy)
		api.DELETE("/policies/:id", p.handleDeletePolicy)
		
		// Policy templates
		api.GET("/templates", p.handleGetTemplates)
		api.POST("/templates", p.handleCreateTemplate)
		
		// Audit logs
		api.GET("/audit", p.handleGetAuditLogs)
		
		// Bulk operations
		api.POST("/policies/bulk", p.handleBulkCreatePolicies)
		api.POST("/evaluate/batch", p.handleBatchEvaluate)
	}

	return r
}

// handleEvaluateAccess handles access evaluation requests
func (p *PBACEngine) handleEvaluateAccess(c *gin.Context) {
	var request AccessRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(400, gin.H{"error": "Invalid request format", "details": err.Error()})
		return
	}

	response := p.EvaluateAccess(c.Request.Context(), request)
	c.JSON(200, response)
}

// handleGetPolicies handles getting all policies
func (p *PBACEngine) handleGetPolicies(c *gin.Context) {
	var policies []Policy
	
	query := p.db
	
	// Filters
	if resource := c.Query("resource"); resource != "" {
		query = query.Where("resource = ? OR resource = '*'", resource)
	}
	if action := c.Query("action"); action != "" {
		query = query.Where("action = ? OR action = '*'", action)
	}
	if active := c.Query("active"); active != "" {
		query = query.Where("active = ?", active == "true")
	}
	
	// Pagination
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset := (page - 1) * limit
	
	query = query.Offset(offset).Limit(limit).Order("priority ASC")
	
	if err := query.Find(&policies).Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to retrieve policies"})
		return
	}
	
	c.JSON(200, gin.H{"policies": policies, "page": page, "limit": limit})
}

// handleCreatePolicy handles creating a new policy
func (p *PBACEngine) handleCreatePolicy(c *gin.Context) {
	var policy Policy
	if err := c.ShouldBindJSON(&policy); err != nil {
		c.JSON(400, gin.H{"error": "Invalid policy format", "details": err.Error()})
		return
	}

	if err := p.db.Create(&policy).Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to create policy", "details": err.Error()})
		return
	}

	// Clear cache
	p.clearPolicyCache()

	c.JSON(201, policy)
}

// handleGetPolicy handles getting a specific policy
func (p *PBACEngine) handleGetPolicy(c *gin.Context) {
	id := c.Param("id")
	var policy Policy
	
	if err := p.db.First(&policy, id).Error; err != nil {
		c.JSON(404, gin.H{"error": "Policy not found"})
		return
	}
	
	c.JSON(200, policy)
}

// handleUpdatePolicy handles updating a policy
func (p *PBACEngine) handleUpdatePolicy(c *gin.Context) {
	id := c.Param("id")
	var policy Policy
	
	if err := p.db.First(&policy, id).Error; err != nil {
		c.JSON(404, gin.H{"error": "Policy not found"})
		return
	}
	
	if err := c.ShouldBindJSON(&policy); err != nil {
		c.JSON(400, gin.H{"error": "Invalid policy format", "details": err.Error()})
		return
	}
	
	if err := p.db.Save(&policy).Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to update policy"})
		return
	}

	// Clear cache
	p.clearPolicyCache()
	
	c.JSON(200, policy)
}

// handleDeletePolicy handles deleting a policy
func (p *PBACEngine) handleDeletePolicy(c *gin.Context) {
	id := c.Param("id")
	
	if err := p.db.Delete(&Policy{}, id).Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to delete policy"})
		return
	}

	// Clear cache
	p.clearPolicyCache()
	
	c.JSON(200, gin.H{"message": "Policy deleted successfully"})
}

// handleGetTemplates handles getting policy templates
func (p *PBACEngine) handleGetTemplates(c *gin.Context) {
	var templates []PolicyTemplate
	
	if err := p.db.Find(&templates).Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to retrieve templates"})
		return
	}
	
	c.JSON(200, gin.H{"templates": templates})
}

// handleCreateTemplate handles creating a policy template
func (p *PBACEngine) handleCreateTemplate(c *gin.Context) {
	var template PolicyTemplate
	if err := c.ShouldBindJSON(&template); err != nil {
		c.JSON(400, gin.H{"error": "Invalid template format", "details": err.Error()})
		return
	}

	if err := p.db.Create(&template).Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to create template", "details": err.Error()})
		return
	}

	c.JSON(201, template)
}

// handleGetAuditLogs handles getting audit logs
func (p *PBACEngine) handleGetAuditLogs(c *gin.Context) {
	var logs []AuditLog
	
	query := p.db
	
	// Filters
	if subject := c.Query("subject"); subject != "" {
		query = query.Where("subject = ?", subject)
	}
	if resource := c.Query("resource"); resource != "" {
		query = query.Where("resource = ?", resource)
	}
	if decision := c.Query("decision"); decision != "" {
		query = query.Where("decision = ?", decision)
	}
	
	// Time range
	if from := c.Query("from"); from != "" {
		if fromTime, err := time.Parse(time.RFC3339, from); err == nil {
			query = query.Where("timestamp >= ?", fromTime)
		}
	}
	if to := c.Query("to"); to != "" {
		if toTime, err := time.Parse(time.RFC3339, to); err == nil {
			query = query.Where("timestamp <= ?", toTime)
		}
	}
	
	// Pagination
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	offset := (page - 1) * limit
	
	query = query.Offset(offset).Limit(limit).Order("timestamp DESC")
	
	if err := query.Find(&logs).Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to retrieve audit logs"})
		return
	}
	
	c.JSON(200, gin.H{"logs": logs, "page": page, "limit": limit})
}

// handleBulkCreatePolicies handles bulk policy creation
func (p *PBACEngine) handleBulkCreatePolicies(c *gin.Context) {
	var policies []Policy
	if err := c.ShouldBindJSON(&policies); err != nil {
		c.JSON(400, gin.H{"error": "Invalid policies format", "details": err.Error()})
		return
	}

	if err := p.db.Create(&policies).Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to create policies", "details": err.Error()})
		return
	}

	// Clear cache
	p.clearPolicyCache()

	c.JSON(201, gin.H{"created": len(policies), "policies": policies})
}

// handleBatchEvaluate handles batch access evaluation
func (p *PBACEngine) handleBatchEvaluate(c *gin.Context) {
	var requests []AccessRequest
	if err := c.ShouldBindJSON(&requests); err != nil {
		c.JSON(400, gin.H{"error": "Invalid requests format", "details": err.Error()})
		return
	}

	responses := make([]AccessResponse, len(requests))
	for i, request := range requests {
		responses[i] = p.EvaluateAccess(c.Request.Context(), request)
	}

	c.JSON(200, gin.H{"responses": responses})
}

// clearPolicyCache clears the policy cache
func (p *PBACEngine) clearPolicyCache() {
	if p.redis != nil {
		ctx := context.Background()
		keys, err := p.redis.Keys(ctx, "policies:*").Result()
		if err == nil && len(keys) > 0 {
			p.redis.Del(ctx, keys...)
		}
	}
}

// getEnv gets environment variable with default value
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
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
	log.Println("🚀 Starting PBAC Engine Service...")

	// Initialize PBAC engine
	engine := NewPBACEngine()

	// Setup routes
	router := engine.setupRoutes()

	// Get port from environment
	port := getEnv("PORT", "8090")

	log.Printf("🌐 PBAC Engine running on port %s", port)
	log.Printf("🔗 Health check: http://localhost:%s/health", port)
	log.Printf("📋 API documentation: http://localhost:%s/api/v1", port)

	// Start server
	if err := router.Run("0.0.0.0:" + port); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}

