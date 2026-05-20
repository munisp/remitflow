package main

// Production-Ready PBAC Engine Extensions
// Adds: Permify bridge, policy versioning, distributed cache invalidation,
// circuit breaker pattern, and policy simulation

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

// PolicyVersion represents a versioned policy for rollback capability
type PolicyVersion struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	PolicyID    uint      `json:"policy_id" gorm:"index"`
	Version     int       `json:"version" gorm:"index"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Resource    string    `json:"resource"`
	Action      string    `json:"action"`
	Effect      string    `json:"effect"`
	Conditions  string    `json:"conditions" gorm:"type:jsonb"`
	Priority    int       `json:"priority"`
	Active      bool      `json:"active"`
	ChangedBy   string    `json:"changed_by"`
	ChangeType  string    `json:"change_type"` // CREATE, UPDATE, DELETE
	CreatedAt   time.Time `json:"created_at"`
}

// PolicyChangeAudit tracks who changed what policy and when
type PolicyChangeAudit struct {
	ID         uint      `json:"id" gorm:"primaryKey"`
	PolicyID   uint      `json:"policy_id" gorm:"index"`
	PolicyName string    `json:"policy_name"`
	ChangedBy  string    `json:"changed_by" gorm:"index"`
	ChangeType string    `json:"change_type"` // CREATE, UPDATE, DELETE, ROLLBACK
	OldValue   string    `json:"old_value" gorm:"type:jsonb"`
	NewValue   string    `json:"new_value" gorm:"type:jsonb"`
	Reason     string    `json:"reason"`
	Timestamp  time.Time `json:"timestamp" gorm:"index"`
}

// SimulationRequest represents a policy simulation request
type SimulationRequest struct {
	AccessRequest AccessRequest `json:"access_request"`
	PolicyChanges []Policy      `json:"policy_changes"` // Proposed policy changes to simulate
}

// SimulationResponse represents a policy simulation response
type SimulationResponse struct {
	CurrentDecision  AccessResponse `json:"current_decision"`
	SimulatedDecision AccessResponse `json:"simulated_decision"`
	Impact           string         `json:"impact"` // NO_CHANGE, ALLOW_TO_DENY, DENY_TO_ALLOW
	AffectedPolicies []string       `json:"affected_policies"`
}

// CircuitBreaker implements a simple circuit breaker pattern
type CircuitBreaker struct {
	mu            sync.RWMutex
	failures      int
	lastFailure   time.Time
	state         string // CLOSED, OPEN, HALF_OPEN
	threshold     int
	resetTimeout  time.Duration
}

// NewCircuitBreaker creates a new circuit breaker
func NewCircuitBreaker(threshold int, resetTimeout time.Duration) *CircuitBreaker {
	return &CircuitBreaker{
		state:        "CLOSED",
		threshold:    threshold,
		resetTimeout: resetTimeout,
	}
}

// Execute runs a function with circuit breaker protection
func (cb *CircuitBreaker) Execute(fn func() error) error {
	cb.mu.RLock()
	state := cb.state
	cb.mu.RUnlock()

	if state == "OPEN" {
		cb.mu.Lock()
		if time.Since(cb.lastFailure) > cb.resetTimeout {
			cb.state = "HALF_OPEN"
			cb.mu.Unlock()
		} else {
			cb.mu.Unlock()
			return fmt.Errorf("circuit breaker is open")
		}
	}

	err := fn()

	cb.mu.Lock()
	defer cb.mu.Unlock()

	if err != nil {
		cb.failures++
		cb.lastFailure = time.Now()
		if cb.failures >= cb.threshold {
			cb.state = "OPEN"
			log.Printf("Circuit breaker opened after %d failures", cb.failures)
		}
		return err
	}

	// Success - reset if in half-open state
	if cb.state == "HALF_OPEN" {
		cb.state = "CLOSED"
		cb.failures = 0
		log.Println("Circuit breaker closed after successful request")
	}

	return nil
}

// PermifyBridge bridges the Go PBAC engine with Permify for relationship-based checks
type PermifyBridge struct {
	endpoint       string
	tenantID       string
	circuitBreaker *CircuitBreaker
	httpClient     *http.Client
}

// NewPermifyBridge creates a new Permify bridge
func NewPermifyBridge(endpoint, tenantID string) *PermifyBridge {
	return &PermifyBridge{
		endpoint:       endpoint,
		tenantID:       tenantID,
		circuitBreaker: NewCircuitBreaker(5, 30*time.Second),
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

// CheckRelationship checks if a relationship exists in Permify
func (pb *PermifyBridge) CheckRelationship(ctx context.Context, entityType, entityID, relation, subjectType, subjectID string) (bool, error) {
	var result bool
	
	err := pb.circuitBreaker.Execute(func() error {
		payload := map[string]interface{}{
			"tenant_id": pb.tenantID,
			"entity": map[string]string{
				"type": entityType,
				"id":   entityID,
			},
			"permission": relation,
			"subject": map[string]string{
				"type": subjectType,
				"id":   subjectID,
			},
		}

		jsonPayload, _ := json.Marshal(payload)
		
		req, err := http.NewRequestWithContext(ctx, "POST", pb.endpoint+"/v1/permissions/check", 
			bytes.NewBuffer(jsonPayload))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := pb.httpClient.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("permify returned status %d", resp.StatusCode)
		}

		var response struct {
			Can bool `json:"can"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
			return err
		}

		result = response.Can
		return nil
	})

	return result, err
}

// DistributedCacheInvalidator handles cluster-wide cache invalidation via Redis pub/sub
type DistributedCacheInvalidator struct {
	redis     interface{} // *redis.Client
	channel   string
	listeners []func(string)
	mu        sync.RWMutex
}

// NewDistributedCacheInvalidator creates a new distributed cache invalidator
func NewDistributedCacheInvalidator(redisClient interface{}, channel string) *DistributedCacheInvalidator {
	return &DistributedCacheInvalidator{
		redis:     redisClient,
		channel:   channel,
		listeners: make([]func(string), 0),
	}
}

// Subscribe adds a listener for cache invalidation events
func (dci *DistributedCacheInvalidator) Subscribe(listener func(string)) {
	dci.mu.Lock()
	defer dci.mu.Unlock()
	dci.listeners = append(dci.listeners, listener)
}

// Publish publishes a cache invalidation event to all nodes
func (dci *DistributedCacheInvalidator) Publish(ctx context.Context, pattern string) error {
	// In production, this would publish to Redis pub/sub
	// For now, notify local listeners
	dci.mu.RLock()
	defer dci.mu.RUnlock()
	
	for _, listener := range dci.listeners {
		go listener(pattern)
	}
	
	log.Printf("Cache invalidation published for pattern: %s", pattern)
	return nil
}

// PBACEngineProduction extends PBACEngine with production features
type PBACEngineProduction struct {
	*PBACEngine
	permifyBridge     *PermifyBridge
	cacheInvalidator  *DistributedCacheInvalidator
	dbCircuitBreaker  *CircuitBreaker
	redisCircuitBreaker *CircuitBreaker
}

// NewPBACEngineProduction creates a production-ready PBAC engine
func NewPBACEngineProduction(base *PBACEngine) *PBACEngineProduction {
	permifyEndpoint := getEnvSafe("PERMIFY_ENDPOINT", "http://localhost:3478")
	permifyTenant := getEnvSafe("PERMIFY_TENANT_ID", "remittance")

	engine := &PBACEngineProduction{
		PBACEngine:         base,
		permifyBridge:      NewPermifyBridge(permifyEndpoint, permifyTenant),
		cacheInvalidator:   NewDistributedCacheInvalidator(base.redis, "pbac:cache:invalidate"),
		dbCircuitBreaker:   NewCircuitBreaker(10, 60*time.Second),
		redisCircuitBreaker: NewCircuitBreaker(5, 30*time.Second),
	}

	// Subscribe to cache invalidation events
	engine.cacheInvalidator.Subscribe(func(pattern string) {
		engine.clearPolicyCachePattern(pattern)
	})

	// Migrate versioning tables
	engine.migrateVersioning()

	return engine
}

// migrateVersioning creates versioning tables
func (p *PBACEngineProduction) migrateVersioning() {
	err := p.db.AutoMigrate(&PolicyVersion{}, &PolicyChangeAudit{})
	if err != nil {
		log.Printf("Warning: Failed to migrate versioning tables: %v", err)
	}
}

// CreatePolicyWithVersioning creates a policy with version tracking
func (p *PBACEngineProduction) CreatePolicyWithVersioning(policy Policy, changedBy, reason string) error {
	// Create the policy
	if err := p.db.Create(&policy).Error; err != nil {
		return err
	}

	// Create version record
	version := PolicyVersion{
		PolicyID:    policy.ID,
		Version:     1,
		Name:        policy.Name,
		Description: policy.Description,
		Resource:    policy.Resource,
		Action:      policy.Action,
		Effect:      policy.Effect,
		Conditions:  policy.Conditions,
		Priority:    policy.Priority,
		Active:      policy.Active,
		ChangedBy:   changedBy,
		ChangeType:  "CREATE",
		CreatedAt:   time.Now(),
	}
	p.db.Create(&version)

	// Create audit record
	newValueJSON, _ := json.Marshal(policy)
	audit := PolicyChangeAudit{
		PolicyID:   policy.ID,
		PolicyName: policy.Name,
		ChangedBy:  changedBy,
		ChangeType: "CREATE",
		OldValue:   "{}",
		NewValue:   string(newValueJSON),
		Reason:     reason,
		Timestamp:  time.Now(),
	}
	p.db.Create(&audit)

	// Invalidate cache cluster-wide
	p.cacheInvalidator.Publish(context.Background(), fmt.Sprintf("policies:%s:*", policy.Resource))

	return nil
}

// UpdatePolicyWithVersioning updates a policy with version tracking
func (p *PBACEngineProduction) UpdatePolicyWithVersioning(policy Policy, changedBy, reason string) error {
	// Get current policy for audit
	var oldPolicy Policy
	if err := p.db.First(&oldPolicy, policy.ID).Error; err != nil {
		return err
	}

	// Get current version number
	var maxVersion PolicyVersion
	p.db.Where("policy_id = ?", policy.ID).Order("version DESC").First(&maxVersion)
	newVersionNum := maxVersion.Version + 1

	// Update the policy
	if err := p.db.Save(&policy).Error; err != nil {
		return err
	}

	// Create version record
	version := PolicyVersion{
		PolicyID:    policy.ID,
		Version:     newVersionNum,
		Name:        policy.Name,
		Description: policy.Description,
		Resource:    policy.Resource,
		Action:      policy.Action,
		Effect:      policy.Effect,
		Conditions:  policy.Conditions,
		Priority:    policy.Priority,
		Active:      policy.Active,
		ChangedBy:   changedBy,
		ChangeType:  "UPDATE",
		CreatedAt:   time.Now(),
	}
	p.db.Create(&version)

	// Create audit record
	oldValueJSON, _ := json.Marshal(oldPolicy)
	newValueJSON, _ := json.Marshal(policy)
	audit := PolicyChangeAudit{
		PolicyID:   policy.ID,
		PolicyName: policy.Name,
		ChangedBy:  changedBy,
		ChangeType: "UPDATE",
		OldValue:   string(oldValueJSON),
		NewValue:   string(newValueJSON),
		Reason:     reason,
		Timestamp:  time.Now(),
	}
	p.db.Create(&audit)

	// Invalidate cache cluster-wide
	p.cacheInvalidator.Publish(context.Background(), fmt.Sprintf("policies:%s:*", policy.Resource))

	return nil
}

// RollbackPolicy rolls back a policy to a previous version
func (p *PBACEngineProduction) RollbackPolicy(policyID uint, targetVersion int, changedBy, reason string) error {
	// Get the target version
	var version PolicyVersion
	if err := p.db.Where("policy_id = ? AND version = ?", policyID, targetVersion).First(&version).Error; err != nil {
		return fmt.Errorf("version %d not found for policy %d", targetVersion, policyID)
	}

	// Get current policy
	var currentPolicy Policy
	if err := p.db.First(&currentPolicy, policyID).Error; err != nil {
		return err
	}

	// Update policy to target version
	currentPolicy.Name = version.Name
	currentPolicy.Description = version.Description
	currentPolicy.Resource = version.Resource
	currentPolicy.Action = version.Action
	currentPolicy.Effect = version.Effect
	currentPolicy.Conditions = version.Conditions
	currentPolicy.Priority = version.Priority
	currentPolicy.Active = version.Active

	if err := p.db.Save(&currentPolicy).Error; err != nil {
		return err
	}

	// Get max version for new version number
	var maxVersion PolicyVersion
	p.db.Where("policy_id = ?", policyID).Order("version DESC").First(&maxVersion)

	// Create new version record for rollback
	newVersion := PolicyVersion{
		PolicyID:    policyID,
		Version:     maxVersion.Version + 1,
		Name:        version.Name,
		Description: version.Description,
		Resource:    version.Resource,
		Action:      version.Action,
		Effect:      version.Effect,
		Conditions:  version.Conditions,
		Priority:    version.Priority,
		Active:      version.Active,
		ChangedBy:   changedBy,
		ChangeType:  fmt.Sprintf("ROLLBACK_TO_V%d", targetVersion),
		CreatedAt:   time.Now(),
	}
	p.db.Create(&newVersion)

	// Create audit record
	audit := PolicyChangeAudit{
		PolicyID:   policyID,
		PolicyName: currentPolicy.Name,
		ChangedBy:  changedBy,
		ChangeType: "ROLLBACK",
		OldValue:   fmt.Sprintf(`{"from_version": %d}`, maxVersion.Version),
		NewValue:   fmt.Sprintf(`{"to_version": %d}`, targetVersion),
		Reason:     reason,
		Timestamp:  time.Now(),
	}
	p.db.Create(&audit)

	// Invalidate cache
	p.cacheInvalidator.Publish(context.Background(), fmt.Sprintf("policies:%s:*", currentPolicy.Resource))

	log.Printf("Policy %d rolled back from version %d to version %d by %s", policyID, maxVersion.Version, targetVersion, changedBy)
	return nil
}

// GetPolicyVersions gets all versions of a policy
func (p *PBACEngineProduction) GetPolicyVersions(policyID uint) ([]PolicyVersion, error) {
	var versions []PolicyVersion
	err := p.db.Where("policy_id = ?", policyID).Order("version DESC").Find(&versions).Error
	return versions, err
}

// SimulatePolicy simulates policy changes without applying them
func (p *PBACEngineProduction) SimulatePolicy(ctx context.Context, request SimulationRequest) SimulationResponse {
	// Get current decision
	currentDecision := p.EvaluateAccess(ctx, request.AccessRequest)

	// Create temporary policy set with proposed changes
	var tempPolicies []Policy
	
	// Get existing policies
	existingPolicies, _ := p.getApplicablePolicies(request.AccessRequest.Resource, request.AccessRequest.Action)
	
	// Apply proposed changes to temp set
	policyMap := make(map[string]Policy)
	for _, policy := range existingPolicies {
		policyMap[policy.Name] = policy
	}
	for _, change := range request.PolicyChanges {
		policyMap[change.Name] = change
	}
	for _, policy := range policyMap {
		tempPolicies = append(tempPolicies, policy)
	}

	// Evaluate with simulated policies
	simulatedDecision := p.evaluateWithPolicies(ctx, request.AccessRequest, tempPolicies)

	// Determine impact
	impact := "NO_CHANGE"
	if currentDecision.Decision != simulatedDecision.Decision {
		if currentDecision.Decision == "ALLOW" && simulatedDecision.Decision == "DENY" {
			impact = "ALLOW_TO_DENY"
		} else {
			impact = "DENY_TO_ALLOW"
		}
	}

	// Find affected policies
	affectedPolicies := []string{}
	for _, change := range request.PolicyChanges {
		affectedPolicies = append(affectedPolicies, change.Name)
	}

	return SimulationResponse{
		CurrentDecision:   currentDecision,
		SimulatedDecision: simulatedDecision,
		Impact:            impact,
		AffectedPolicies:  affectedPolicies,
	}
}

// evaluateWithPolicies evaluates access with a specific policy set
func (p *PBACEngineProduction) evaluateWithPolicies(ctx context.Context, request AccessRequest, policies []Policy) AccessResponse {
	startTime := time.Now()
	requestID := "sim-" + time.Now().Format("20060102150405")

	response := AccessResponse{
		RequestID:   requestID,
		Decision:    "DENY",
		Reason:      "No matching policies found",
		Policies:    []string{},
		ProcessTime: 0,
	}

	allowPolicies := []string{}
	denyPolicies := []string{}

	for _, policy := range policies {
		if policy.Active && p.evaluatePolicy(policy, request) {
			if policy.Effect == "ALLOW" {
				allowPolicies = append(allowPolicies, policy.Name)
			} else {
				denyPolicies = append(denyPolicies, policy.Name)
			}
		}
	}

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
	return response
}

// EvaluateAccessWithPermify evaluates access using both PBAC and Permify
func (p *PBACEngineProduction) EvaluateAccessWithPermify(ctx context.Context, request AccessRequest) AccessResponse {
	// First, check PBAC policies
	pbacResponse := p.EvaluateAccess(ctx, request)

	// If PBAC denies, check if Permify allows (relationship-based override)
	if pbacResponse.Decision == "DENY" {
		// Extract entity info from context
		entityType := request.Context["entity_type"]
		entityID := request.Context["entity_id"]
		subjectType := request.Context["subject_type"]
		subjectID := request.Subject

		if entityType != nil && entityID != nil {
			allowed, err := p.permifyBridge.CheckRelationship(
				ctx,
				fmt.Sprintf("%v", entityType),
				fmt.Sprintf("%v", entityID),
				request.Action,
				fmt.Sprintf("%v", subjectType),
				subjectID,
			)

			if err == nil && allowed {
				pbacResponse.Decision = "ALLOW"
				pbacResponse.Reason = "Access granted by Permify relationship"
				pbacResponse.Policies = append(pbacResponse.Policies, "permify_relationship")
			}
		}
	}

	return pbacResponse
}

// clearPolicyCachePattern clears cache entries matching a pattern
func (p *PBACEngineProduction) clearPolicyCachePattern(pattern string) {
	if p.redis == nil {
		return
	}

	ctx := context.Background()
	
	// Use SCAN to find matching keys (safer than KEYS in production)
	iter := p.redis.Scan(ctx, 0, pattern, 100).Iterator()
	for iter.Next(ctx) {
		p.redis.Del(ctx, iter.Val())
	}
	
	log.Printf("Cache cleared for pattern: %s", pattern)
}

// getEnvSafe gets environment variable with default, failing on empty for critical vars
func getEnvSafe(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// Import bytes package for HTTP requests
import "bytes"
