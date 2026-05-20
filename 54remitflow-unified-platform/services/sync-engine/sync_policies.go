// Package sync provides configurable sync policies
// Allows customization of sync behavior per entity type and agent tier
package sync

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// SyncPolicy defines sync behavior for an entity type
type SyncPolicy struct {
	ID                string            `json:"id"`
	Name              string            `json:"name"`
	EntityType        string            `json:"entity_type"`
	Enabled           bool              `json:"enabled"`
	Priority          SyncPriority      `json:"priority"`
	SyncFrequency     time.Duration     `json:"sync_frequency"`
	MaxOfflineDuration time.Duration    `json:"max_offline_duration"`
	ConflictResolution string           `json:"conflict_resolution"` // lww, local_wins, remote_wins, merge, manual
	RetryPolicy       *RetryPolicy      `json:"retry_policy"`
	CompressionPolicy *CompressionPolicy `json:"compression_policy"`
	EncryptionRequired bool             `json:"encryption_required"`
	BatchSize         int               `json:"batch_size"`
	Conditions        []PolicyCondition `json:"conditions,omitempty"`
	CreatedAt         time.Time         `json:"created_at"`
	UpdatedAt         time.Time         `json:"updated_at"`
}

// RetryPolicy defines retry behavior
type RetryPolicy struct {
	MaxRetries      int           `json:"max_retries"`
	InitialDelay    time.Duration `json:"initial_delay"`
	MaxDelay        time.Duration `json:"max_delay"`
	BackoffFactor   float64       `json:"backoff_factor"`
	RetryableErrors []string      `json:"retryable_errors,omitempty"`
}

// CompressionPolicy defines compression behavior
type CompressionPolicy struct {
	Enabled           bool                 `json:"enabled"`
	Algorithm         CompressionAlgorithm `json:"algorithm"`
	MinSizeToCompress int                  `json:"min_size_to_compress"`
	Level             CompressionLevel     `json:"level"`
}

// PolicyCondition defines a condition for policy application
type PolicyCondition struct {
	Field    string      `json:"field"`
	Operator string      `json:"operator"` // eq, ne, gt, lt, gte, lte, in, contains
	Value    interface{} `json:"value"`
}

// AgentTierPolicy defines sync policies per agent tier
type AgentTierPolicy struct {
	Tier              string        `json:"tier"` // bronze, silver, gold, platinum
	MaxSyncRPS        float64       `json:"max_sync_rps"`
	MaxOfflineDuration time.Duration `json:"max_offline_duration"`
	MaxPendingItems   int           `json:"max_pending_items"`
	PriorityBoost     int           `json:"priority_boost"` // Added to base priority
	Features          []string      `json:"features"`       // Enabled features
}

// DefaultSyncPolicy returns a default sync policy
func DefaultSyncPolicy(entityType string) *SyncPolicy {
	return &SyncPolicy{
		ID:                 fmt.Sprintf("policy-%s", entityType),
		Name:               fmt.Sprintf("Default %s Policy", entityType),
		EntityType:         entityType,
		Enabled:            true,
		Priority:           PriorityNormal,
		SyncFrequency:      30 * time.Second,
		MaxOfflineDuration: 7 * 24 * time.Hour,
		ConflictResolution: "lww",
		RetryPolicy: &RetryPolicy{
			MaxRetries:    5,
			InitialDelay:  1 * time.Second,
			MaxDelay:      5 * time.Minute,
			BackoffFactor: 2.0,
		},
		CompressionPolicy: &CompressionPolicy{
			Enabled:           true,
			Algorithm:         CompressionAuto,
			MinSizeToCompress: 256,
			Level:             CompressionDefault,
		},
		EncryptionRequired: true,
		BatchSize:          100,
		CreatedAt:          time.Now(),
		UpdatedAt:          time.Now(),
	}
}

// DefaultAgentTierPolicies returns default agent tier policies
func DefaultAgentTierPolicies() map[string]*AgentTierPolicy {
	return map[string]*AgentTierPolicy{
		"bronze": {
			Tier:               "bronze",
			MaxSyncRPS:         10,
			MaxOfflineDuration: 24 * time.Hour,
			MaxPendingItems:    100,
			PriorityBoost:      0,
			Features:           []string{"basic_sync"},
		},
		"silver": {
			Tier:               "silver",
			MaxSyncRPS:         50,
			MaxOfflineDuration: 3 * 24 * time.Hour,
			MaxPendingItems:    500,
			PriorityBoost:      1,
			Features:           []string{"basic_sync", "compression"},
		},
		"gold": {
			Tier:               "gold",
			MaxSyncRPS:         100,
			MaxOfflineDuration: 7 * 24 * time.Hour,
			MaxPendingItems:    2000,
			PriorityBoost:      2,
			Features:           []string{"basic_sync", "compression", "priority_sync"},
		},
		"platinum": {
			Tier:               "platinum",
			MaxSyncRPS:         500,
			MaxOfflineDuration: 14 * 24 * time.Hour,
			MaxPendingItems:    10000,
			PriorityBoost:      3,
			Features:           []string{"basic_sync", "compression", "priority_sync", "realtime_sync", "multi_region"},
		},
	}
}

// PolicyManager manages sync policies
type PolicyManager struct {
	mu           sync.RWMutex
	policies     map[string]*SyncPolicy     // entityType -> policy
	tierPolicies map[string]*AgentTierPolicy // tier -> policy
	agentTiers   map[string]string           // agentID -> tier
	overrides    map[string]*SyncPolicy      // agentID:entityType -> policy override
}

// NewPolicyManager creates a new policy manager
func NewPolicyManager() *PolicyManager {
	pm := &PolicyManager{
		policies:     make(map[string]*SyncPolicy),
		tierPolicies: DefaultAgentTierPolicies(),
		agentTiers:   make(map[string]string),
		overrides:    make(map[string]*SyncPolicy),
	}

	// Initialize default policies for common entity types
	defaultTypes := []string{
		"transaction", "cash_in", "cash_out", "transfer", "payment",
		"customer", "agent", "float", "inventory", "order",
	}

	for _, entityType := range defaultTypes {
		pm.policies[entityType] = DefaultSyncPolicy(entityType)
	}

	// Set critical priority for financial transactions
	for _, entityType := range []string{"transaction", "cash_in", "cash_out", "transfer", "payment"} {
		if policy, ok := pm.policies[entityType]; ok {
			policy.Priority = PriorityCritical
			policy.SyncFrequency = 5 * time.Second
		}
	}

	return pm
}

// GetPolicy returns the policy for an entity type
func (pm *PolicyManager) GetPolicy(entityType string) *SyncPolicy {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	if policy, ok := pm.policies[entityType]; ok {
		return policy
	}

	return DefaultSyncPolicy(entityType)
}

// GetEffectivePolicy returns the effective policy for an agent and entity type
func (pm *PolicyManager) GetEffectivePolicy(agentID, entityType string) *SyncPolicy {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	// Check for agent-specific override
	overrideKey := fmt.Sprintf("%s:%s", agentID, entityType)
	if override, ok := pm.overrides[overrideKey]; ok {
		return override
	}

	// Get base policy
	basePolicy := pm.policies[entityType]
	if basePolicy == nil {
		basePolicy = DefaultSyncPolicy(entityType)
	}

	// Apply tier modifications
	tier := pm.agentTiers[agentID]
	if tier == "" {
		tier = "bronze"
	}

	tierPolicy := pm.tierPolicies[tier]
	if tierPolicy == nil {
		return basePolicy
	}

	// Create effective policy with tier modifications
	effectivePolicy := *basePolicy
	effectivePolicy.Priority = SyncPriority(int(basePolicy.Priority) - tierPolicy.PriorityBoost)
	if effectivePolicy.Priority < PriorityCritical {
		effectivePolicy.Priority = PriorityCritical
	}

	if tierPolicy.MaxOfflineDuration < effectivePolicy.MaxOfflineDuration {
		effectivePolicy.MaxOfflineDuration = tierPolicy.MaxOfflineDuration
	}

	return &effectivePolicy
}

// SetPolicy sets a policy for an entity type
func (pm *PolicyManager) SetPolicy(policy *SyncPolicy) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	policy.UpdatedAt = time.Now()
	pm.policies[policy.EntityType] = policy
}

// SetAgentTier sets the tier for an agent
func (pm *PolicyManager) SetAgentTier(agentID, tier string) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.agentTiers[agentID] = tier
}

// GetAgentTier returns the tier for an agent
func (pm *PolicyManager) GetAgentTier(agentID string) string {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	if tier, ok := pm.agentTiers[agentID]; ok {
		return tier
	}
	return "bronze"
}

// SetOverride sets a policy override for an agent
func (pm *PolicyManager) SetOverride(agentID, entityType string, policy *SyncPolicy) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	key := fmt.Sprintf("%s:%s", agentID, entityType)
	policy.UpdatedAt = time.Now()
	pm.overrides[key] = policy
}

// RemoveOverride removes a policy override
func (pm *PolicyManager) RemoveOverride(agentID, entityType string) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	key := fmt.Sprintf("%s:%s", agentID, entityType)
	delete(pm.overrides, key)
}

// GetTierPolicy returns the policy for a tier
func (pm *PolicyManager) GetTierPolicy(tier string) *AgentTierPolicy {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	if policy, ok := pm.tierPolicies[tier]; ok {
		return policy
	}
	return pm.tierPolicies["bronze"]
}

// SetTierPolicy sets a tier policy
func (pm *PolicyManager) SetTierPolicy(policy *AgentTierPolicy) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.tierPolicies[policy.Tier] = policy
}

// ListPolicies returns all policies
func (pm *PolicyManager) ListPolicies() []*SyncPolicy {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	policies := make([]*SyncPolicy, 0, len(pm.policies))
	for _, policy := range pm.policies {
		policies = append(policies, policy)
	}
	return policies
}

// EvaluateConditions evaluates policy conditions against data
func (pm *PolicyManager) EvaluateConditions(conditions []PolicyCondition, data map[string]interface{}) bool {
	for _, condition := range conditions {
		if !pm.evaluateCondition(condition, data) {
			return false
		}
	}
	return true
}

func (pm *PolicyManager) evaluateCondition(condition PolicyCondition, data map[string]interface{}) bool {
	value, ok := data[condition.Field]
	if !ok {
		return false
	}

	switch condition.Operator {
	case "eq":
		return value == condition.Value
	case "ne":
		return value != condition.Value
	case "gt":
		return pm.compareNumeric(value, condition.Value) > 0
	case "lt":
		return pm.compareNumeric(value, condition.Value) < 0
	case "gte":
		return pm.compareNumeric(value, condition.Value) >= 0
	case "lte":
		return pm.compareNumeric(value, condition.Value) <= 0
	case "in":
		if arr, ok := condition.Value.([]interface{}); ok {
			for _, v := range arr {
				if value == v {
					return true
				}
			}
		}
		return false
	case "contains":
		if str, ok := value.(string); ok {
			if substr, ok := condition.Value.(string); ok {
				return len(str) > 0 && len(substr) > 0 && contains(str, substr)
			}
		}
		return false
	default:
		return false
	}
}

func (pm *PolicyManager) compareNumeric(a, b interface{}) int {
	aFloat := toFloat64(a)
	bFloat := toFloat64(b)

	if aFloat < bFloat {
		return -1
	}
	if aFloat > bFloat {
		return 1
	}
	return 0
}

func toFloat64(v interface{}) float64 {
	switch val := v.(type) {
	case int:
		return float64(val)
	case int64:
		return float64(val)
	case float64:
		return val
	case float32:
		return float64(val)
	default:
		return 0
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsHelper(s, substr))
}

func containsHelper(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// PolicyEngine applies policies to sync operations
type PolicyEngine struct {
	mu            sync.RWMutex
	policyManager *PolicyManager
	rateLimiter   *AdaptiveRateLimiter
	metrics       *SyncMetrics
}

// NewPolicyEngine creates a new policy engine
func NewPolicyEngine(policyManager *PolicyManager, rateLimiter *AdaptiveRateLimiter, metrics *SyncMetrics) *PolicyEngine {
	return &PolicyEngine{
		policyManager: policyManager,
		rateLimiter:   rateLimiter,
		metrics:       metrics,
	}
}

// ApplyPolicy applies the appropriate policy to a sync item
func (pe *PolicyEngine) ApplyPolicy(agentID string, item *SyncItem) (*SyncItem, error) {
	policy := pe.policyManager.GetEffectivePolicy(agentID, item.EntityType)

	if !policy.Enabled {
		return nil, fmt.Errorf("sync disabled for entity type: %s", item.EntityType)
	}

	// Apply priority from policy
	if item.Priority > policy.Priority {
		item.Priority = policy.Priority
	}

	// Apply retry policy
	if policy.RetryPolicy != nil {
		item.MaxRetries = policy.RetryPolicy.MaxRetries
	}

	// Check rate limit
	tierPolicy := pe.policyManager.GetTierPolicy(pe.policyManager.GetAgentTier(agentID))
	if pe.rateLimiter != nil {
		pe.rateLimiter.baseLimiter.SetAgentLimit(agentID, tierPolicy.MaxSyncRPS)
	}

	return item, nil
}

// ShouldSync determines if an item should be synced based on policy
func (pe *PolicyEngine) ShouldSync(agentID string, item *SyncItem, lastSyncTime time.Time) bool {
	policy := pe.policyManager.GetEffectivePolicy(agentID, item.EntityType)

	if !policy.Enabled {
		return false
	}

	// Check sync frequency
	if time.Since(lastSyncTime) < policy.SyncFrequency {
		return false
	}

	// Check conditions
	if len(policy.Conditions) > 0 {
		if data, ok := item.Data.(map[string]interface{}); ok {
			if !pe.policyManager.EvaluateConditions(policy.Conditions, data) {
				return false
			}
		}
	}

	return true
}

// GetConflictResolution returns the conflict resolution strategy for an entity type
func (pe *PolicyEngine) GetConflictResolution(agentID, entityType string) string {
	policy := pe.policyManager.GetEffectivePolicy(agentID, entityType)
	return policy.ConflictResolution
}

// PolicySnapshot represents a snapshot of all policies
type PolicySnapshot struct {
	Timestamp    time.Time                   `json:"timestamp"`
	Policies     map[string]*SyncPolicy      `json:"policies"`
	TierPolicies map[string]*AgentTierPolicy `json:"tier_policies"`
}

// ExportPolicies exports all policies as JSON
func (pm *PolicyManager) ExportPolicies() ([]byte, error) {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	snapshot := &PolicySnapshot{
		Timestamp:    time.Now(),
		Policies:     pm.policies,
		TierPolicies: pm.tierPolicies,
	}

	return json.MarshalIndent(snapshot, "", "  ")
}

// ImportPolicies imports policies from JSON
func (pm *PolicyManager) ImportPolicies(data []byte) error {
	var snapshot PolicySnapshot
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return err
	}

	pm.mu.Lock()
	defer pm.mu.Unlock()

	for entityType, policy := range snapshot.Policies {
		pm.policies[entityType] = policy
	}

	for tier, policy := range snapshot.TierPolicies {
		pm.tierPolicies[tier] = policy
	}

	return nil
}
