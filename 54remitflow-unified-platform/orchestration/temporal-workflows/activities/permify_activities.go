package activities

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"
	
	"github.com/shopspring/decimal"
	permify "github.com/Permify/permify-go/v1"
)

// PermifyClient wraps the Permify client
type PermifyClient struct{
	client    *permify.Client
	tenantID  string
}

// NewPermifyClient creates a new Permify client
func NewPermifyClient(endpoint, apiKey, tenantID string) (*PermifyClient, error) {
	client, err := permify.NewClient(
		permify.Config{
			Endpoint: endpoint,
			APIKey:   apiKey,
		},
	)
	if err != nil {
		return nil, err
	}

	return &PermifyClient{
		client:   client,
		tenantID: tenantID,
	}, nil
}

// PermifyAuthRequest represents an authorization request
type PermifyAuthRequest struct {
	TenantID     string                 `json:"tenant_id"`
	EntityType   string                 `json:"entity_type"`   // e.g., "transaction", "account", "user"
	EntityID     string                 `json:"entity_id"`
	Permission   string                 `json:"permission"`    // e.g., "execute", "view", "approve"
	SubjectType  string                 `json:"subject_type"`  // e.g., "user", "service"
	SubjectID    string                 `json:"subject_id"`
	Context      map[string]interface{} `json:"context,omitempty"` // Additional context for decision
}

// PermifyAuthResult represents authorization result
type PermifyAuthResult struct {
	Allowed    bool                   `json:"allowed"`
	EntityType string                 `json:"entity_type"`
	EntityID   string                 `json:"entity_id"`
	Permission string                 `json:"permission"`
	SubjectID  string                 `json:"subject_id"`
	Reason     string                 `json:"reason,omitempty"`
	Context    map[string]interface{} `json:"context,omitempty"`
	CheckedAt  time.Time              `json:"checked_at"`
}

// PermifyRelationship represents a relationship between entities
type PermifyRelationship struct {
	EntityType     string `json:"entity_type"`
	EntityID       string `json:"entity_id"`
	Relation       string `json:"relation"` // e.g., "owner", "member", "viewer"
	SubjectType    string `json:"subject_type"`
	SubjectID      string `json:"subject_id"`
	SubjectRelation string `json:"subject_relation,omitempty"`
}

// PermifyDecisionLog represents an authorization decision log
type PermifyDecisionLog struct {
	LogID      string                 `json:"log_id"`
	TenantID   string                 `json:"tenant_id"`
	Decision   string                 `json:"decision"` // allowed, denied
	EntityType string                 `json:"entity_type"`
	EntityID   string                 `json:"entity_id"`
	Permission string                 `json:"permission"`
	SubjectID  string                 `json:"subject_id"`
	Context    map[string]interface{} `json:"context,omitempty"`
	Reason     string                 `json:"reason,omitempty"`
	Timestamp  time.Time              `json:"timestamp"`
}

// CheckPermifyAuthorization checks if a subject has permission on an entity
func (pc *PermifyClient) CheckPermifyAuthorization(ctx context.Context, req *PermifyAuthRequest) (*PermifyAuthResult, error) {
	// Prepare check request
	checkReq := &permify.PermissionCheckRequest{
		TenantID: req.TenantID,
		Metadata: &permify.PermissionCheckRequestMetadata{
			SnapToken:     "",
			SchemaVersion: "",
			Depth:         20,
		},
		Entity: &permify.Entity{
			Type: req.EntityType,
			ID:   req.EntityID,
		},
		Permission: req.Permission,
		Subject: &permify.Subject{
			Type:     req.SubjectType,
			ID:       req.SubjectID,
			Relation: "",
		},
	}

	// Add context if provided
	if req.Context != nil {
		contextJSON, _ := json.Marshal(req.Context)
		checkReq.Context = &permify.Context{
			Data: contextJSON,
		}
	}

	// Execute permission check
	response, err := pc.client.Permission.Check(ctx, checkReq)
	if err != nil {
		return &PermifyAuthResult{
			Allowed:    false,
			EntityType: req.EntityType,
			EntityID:   req.EntityID,
			Permission: req.Permission,
			SubjectID:  req.SubjectID,
			Reason:     fmt.Sprintf("Permission check failed: %v", err),
			CheckedAt:  time.Now(),
		}, err
	}

	// Parse result
	allowed := response.Can == permify.CheckResult_CHECK_RESULT_ALLOWED

	result := &PermifyAuthResult{
		Allowed:    allowed,
		EntityType: req.EntityType,
		EntityID:   req.EntityID,
		Permission: req.Permission,
		SubjectID:  req.SubjectID,
		Context:    req.Context,
		CheckedAt:  time.Now(),
	}

	if !allowed {
		result.Reason = pc.determineReason(req)
	}

	return result, nil
}

// determineReason determines why authorization was denied
func (pc *PermifyClient) determineReason(req *PermifyAuthRequest) string {
	// Check context for specific denial reasons
	if req.Context != nil {
		// Check KYC tier
		if kycTier, ok := req.Context["kyc_tier"].(string); ok {
			if kycTier == "basic" && (req.Permission == "transfer:international" || req.Permission == "financial:investment") {
				return "Enhanced KYC tier required for this operation"
			}
		}

		// Check amount limits
		if amount, ok := req.Context["amount"].(decimal.Decimal); ok {
			if limit, ok := req.Context["user_limit"].(decimal.Decimal); ok {
				if amount.GreaterThan(limit) {
					return fmt.Sprintf("Transaction amount exceeds user limit: %s > %s", amount.String(), limit.String())
				}
			}
		}

		// Check AML score
		if amlScore, ok := req.Context["aml_score"].(float64); ok {
			if amlScore > 0.8 {
				return "Transaction blocked due to high AML risk score"
			}
		}

		// Check country restrictions
		if country, ok := req.Context["country"].(string); ok {
			restrictedCountries := []string{"KP", "IR", "SY"} // North Korea, Iran, Syria
			for _, restricted := range restrictedCountries {
				if country == restricted {
					return fmt.Sprintf("Transactions to %s are not permitted", country)
				}
			}
		}
	}

	return fmt.Sprintf("User does not have %s permission on %s", req.Permission, req.EntityType)
}

// CreatePermifyRelationship creates a relationship between entities
func (pc *PermifyClient) CreatePermifyRelationship(ctx context.Context, rel *PermifyRelationship) error {
	// Prepare relationship tuple
	tuple := &permify.Tuple{
		Entity: &permify.Entity{
			Type: rel.EntityType,
			ID:   rel.EntityID,
		},
		Relation: rel.Relation,
		Subject: &permify.Subject{
			Type:     rel.SubjectType,
			ID:       rel.SubjectID,
			Relation: rel.SubjectRelation,
		},
	}

	// Write relationship
	_, err := pc.client.Data.Write(ctx, &permify.DataWriteRequest{
		TenantID: pc.tenantID,
		Metadata: &permify.DataWriteRequestMetadata{
			SchemaVersion: "",
		},
		Tuples: []*permify.Tuple{tuple},
	})

	if err != nil {
		return fmt.Errorf("failed to create relationship: %w", err)
	}

	return nil
}

// DeletePermifyRelationship deletes a relationship between entities
func (pc *PermifyClient) DeletePermifyRelationship(ctx context.Context, rel *PermifyRelationship) error {
	// Prepare relationship tuple
	tuple := &permify.Tuple{
		Entity: &permify.Entity{
			Type: rel.EntityType,
			ID:   rel.EntityID,
		},
		Relation: rel.Relation,
		Subject: &permify.Subject{
			Type:     rel.SubjectType,
			ID:       rel.SubjectID,
			Relation: rel.SubjectRelation,
		},
	}

	// Delete relationship
	_, err := pc.client.Data.Delete(ctx, &permify.DataDeleteRequest{
		TenantID: pc.tenantID,
		Metadata: &permify.DataDeleteRequestMetadata{
			SchemaVersion: "",
		},
		Tuples: []*permify.Tuple{tuple},
	})

	if err != nil {
		return fmt.Errorf("failed to delete relationship: %w", err)
	}

	return nil
}

// LogPermifyDecision logs an authorization decision
func (pc *PermifyClient) LogPermifyDecision(ctx context.Context, log *PermifyDecisionLog) error {
	// In production, this would write to a decision log store
	// For now, we'll log to application logs
	logJSON, _ := json.Marshal(log)
	fmt.Printf("[PERMIFY_DECISION] %s\n", string(logJSON))

	// You could also store decisions in a database or send to analytics
	return nil
}

// LogPermifyDenial logs an authorization denial
func (pc *PermifyClient) LogPermifyDenial(ctx context.Context, entityType, entityID, permission, subjectID, reason string) error {
	log := &PermifyDecisionLog{
		LogID:      generateLogID(),
		TenantID:   pc.tenantID,
		Decision:   "denied",
		EntityType: entityType,
		EntityID:   entityID,
		Permission: permission,
		SubjectID:  subjectID,
		Reason:     reason,
		Timestamp:  time.Now(),
	}

	return pc.LogPermifyDecision(ctx, log)
}

// CheckTransactionAuthorization checks authorization for financial transactions
func (pc *PermifyClient) CheckTransactionAuthorization(ctx context.Context, userID, transactionID string, amount decimal.Decimal, currency, transactionType string, context map[string]interface{}) (*PermifyAuthResult, error) {
	// Enhance context with transaction details
	enhancedContext := make(map[string]interface{})
	for k, v := range context {
		enhancedContext[k] = v
	}
	enhancedContext["amount"] = amount
	enhancedContext["currency"] = currency
	enhancedContext["transaction_type"] = transactionType

	// Check authorization
	return pc.CheckPermifyAuthorization(ctx, &PermifyAuthRequest{
		TenantID:    pc.tenantID,
		EntityType:  "transaction",
		EntityID:    transactionID,
		Permission:  "execute",
		SubjectType: "user",
		SubjectID:   userID,
		Context:     enhancedContext,
	})
}

// CheckAccountAuthorization checks authorization for account operations
func (pc *PermifyClient) CheckAccountAuthorization(ctx context.Context, userID, accountID, operation string, context map[string]interface{}) (*PermifyAuthResult, error) {
	return pc.CheckPermifyAuthorization(ctx, &PermifyAuthRequest{
		TenantID:    pc.tenantID,
		EntityType:  "account",
		EntityID:    accountID,
		Permission:  operation, // e.g., "view", "withdraw", "close"
		SubjectType: "user",
		SubjectID:   userID,
		Context:     context,
	})
}

// CheckFinancialProductAuthorization checks authorization for financial products
func (pc *PermifyClient) CheckFinancialProductAuthorization(ctx context.Context, userID, productID, productType, operation string, context map[string]interface{}) (*PermifyAuthResult, error) {
	// Enhance context with product type
	enhancedContext := make(map[string]interface{})
	for k, v := range context {
		enhancedContext[k] = v
	}
	enhancedContext["product_type"] = productType

	return pc.CheckPermifyAuthorization(ctx, &PermifyAuthRequest{
		TenantID:    pc.tenantID,
		EntityType:  "financial_product",
		EntityID:    productID,
		Permission:  operation, // e.g., "purchase", "redeem", "cancel"
		SubjectType: "user",
		SubjectID:   userID,
		Context:     enhancedContext,
	})
}

// UpdatePermifyRelationships updates multiple relationships atomically
func (pc *PermifyClient) UpdatePermifyRelationships(ctx context.Context, toCreate, toDelete []*PermifyRelationship) error {
	// Prepare tuples to create
	createTuples := make([]*permify.Tuple, len(toCreate))
	for i, rel := range toCreate {
		createTuples[i] = &permify.Tuple{
			Entity: &permify.Entity{
				Type: rel.EntityType,
				ID:   rel.EntityID,
			},
			Relation: rel.Relation,
			Subject: &permify.Subject{
				Type:     rel.SubjectType,
				ID:       rel.SubjectID,
				Relation: rel.SubjectRelation,
			},
		}
	}

	// Prepare tuples to delete
	deleteTuples := make([]*permify.Tuple, len(toDelete))
	for i, rel := range toDelete {
		deleteTuples[i] = &permify.Tuple{
			Entity: &permify.Entity{
				Type: rel.EntityType,
				ID:   rel.EntityID,
			},
			Relation: rel.Relation,
			Subject: &permify.Subject{
				Type:     rel.SubjectType,
				ID:       rel.SubjectID,
				Relation: rel.SubjectRelation,
			},
		}
	}

	// Write new relationships
	if len(createTuples) > 0 {
		_, err := pc.client.Data.Write(ctx, &permify.DataWriteRequest{
			TenantID: pc.tenantID,
			Metadata: &permify.DataWriteRequestMetadata{
				SchemaVersion: "",
			},
			Tuples: createTuples,
		})
		if err != nil {
			return fmt.Errorf("failed to create relationships: %w", err)
		}
	}

	// Delete old relationships
	if len(deleteTuples) > 0 {
		_, err := pc.client.Data.Delete(ctx, &permify.DataDeleteRequest{
			TenantID: pc.tenantID,
			Metadata: &permify.DataDeleteRequestMetadata{
				SchemaVersion: "",
			},
			Tuples: deleteTuples,
		})
		if err != nil {
			return fmt.Errorf("failed to delete relationships: %w", err)
		}
	}

	return nil
}

// GetUserPermissions retrieves all permissions a user has
func (pc *PermifyClient) GetUserPermissions(ctx context.Context, userID string) ([]string, error) {
	// In production, this would query Permify's permission list API
	// For now, we'll return a placeholder
	permissions := []string{
		"transfer:domestic",
		"wallet:topup",
		"wallet:withdraw",
		"financial:savings",
	}

	return permissions, nil
}

// generateLogID generates a unique log ID
func generateLogID() string {
	return fmt.Sprintf("log_%d", time.Now().UnixNano())
}

// Helper functions for common authorization patterns

// RequiresEnhancedKYC checks if operation requires enhanced KYC
func RequiresEnhancedKYC(operation string) bool {
	enhancedKYCOperations := []string{
		"transfer:international",
		"financial:investment",
		"financial:loan",
		"crypto:transfer",
	}

	for _, op := range enhancedKYCOperations {
		if operation == op {
			return true
		}
	}

	return false
}

// GetAmountLimit gets the transaction limit for a user based on KYC tier
func GetAmountLimit(kycTier string) decimal.Decimal {
	limits := map[string]decimal.Decimal{
		"basic":    decimal.NewFromInt(50000),    // ₦50k
		"standard": decimal.NewFromInt(500000),   // ₦500k
		"enhanced": decimal.NewFromInt(5000000),  // ₦5M
		"premium":  decimal.NewFromInt(50000000), // ₦50M
	}

	if limit, ok := limits[kycTier]; ok {
		return limit
	}

	return decimal.NewFromInt(50000) // Default to basic tier limit
}

// IsHighRiskCountry checks if a country is high-risk
func IsHighRiskCountry(countryCode string) bool {
	highRiskCountries := []string{
		"KP", // North Korea
		"IR", // Iran
		"SY", // Syria
		"CU", // Cuba
		"SD", // Sudan
	}

	for _, country := range highRiskCountries {
		if countryCode == country {
			return true
		}
	}

	return false
}
