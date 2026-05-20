package activities

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"
	
	"github.com/Nerzal/gocloak/v13"
	"github.com/shopspring/decimal"
)

// KeycloakClient wraps the Keycloak client
type KeycloakClient struct {
	client      *gocloak.GoCloak
	realm       string
	clientID    string
	clientSecret string
}

// NewKeycloakClient creates a new Keycloak client
func NewKeycloakClient(baseURL, realm, clientID, clientSecret string) *KeycloakClient {
	return &KeycloakClient{
		client:       gocloak.NewClient(baseURL),
		realm:        realm,
		clientID:     clientID,
		clientSecret: clientSecret,
	}
}

// KeycloakSession represents a user session
type KeycloakSession struct {
	Valid        bool                   `json:"valid"`
	UserID       string                 `json:"user_id"`
	Username     string                 `json:"username"`
	Email        string                 `json:"email"`
	Roles        []string               `json:"roles"`
	Attributes   map[string]interface{} `json:"attributes"`
	ExpiresAt    time.Time              `json:"expires_at"`
	SessionID    string                 `json:"session_id"`
}

// KeycloakPermissionResult represents permission check result
type KeycloakPermissionResult struct {
	HasPermission bool     `json:"has_permission"`
	UserID        string   `json:"user_id"`
	Permission    string   `json:"permission"`
	Roles         []string `json:"roles"`
	Reason        string   `json:"reason,omitempty"`
}

// KeycloakMFAResult represents MFA validation result
type KeycloakMFAResult struct {
	Valid      bool      `json:"valid"`
	UserID     string    `json:"user_id"`
	MFAType    string    `json:"mfa_type"` // totp, sms, email
	ValidatedAt time.Time `json:"validated_at"`
}

// KeycloakEventLog represents an authentication event
type KeycloakEventLog struct {
	EventID   string                 `json:"event_id"`
	UserID    string                 `json:"user_id"`
	EventType string                 `json:"event_type"`
	Action    string                 `json:"action"`
	IPAddress string                 `json:"ip_address,omitempty"`
	UserAgent string                 `json:"user_agent,omitempty"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
	Timestamp time.Time              `json:"timestamp"`
}

// ValidateKeycloakSession validates a user session token
func (kc *KeycloakClient) ValidateKeycloakSession(ctx context.Context, sessionToken string) (*KeycloakSession, error) {
	// Introspect token
	rptResult, err := kc.client.RetrospectToken(ctx, sessionToken, kc.clientID, kc.clientSecret, kc.realm)
	if err != nil {
		return &KeycloakSession{Valid: false}, err
	}

	if !*rptResult.Active {
		return &KeycloakSession{Valid: false}, errors.New("session token is not active")
	}

	// Get user info from token
	userInfo, err := kc.client.GetUserInfo(ctx, sessionToken, kc.realm)
	if err != nil {
		return &KeycloakSession{Valid: false}, err
	}

	// Extract roles
	roles := make([]string, 0)
	if realmAccess, ok := (*userInfo)["realm_access"].(map[string]interface{}); ok {
		if rolesList, ok := realmAccess["roles"].([]interface{}); ok {
			for _, role := range rolesList {
				if roleStr, ok := role.(string); ok {
					roles = append(roles, roleStr)
				}
			}
		}
	}

	// Calculate expiration
	expiresAt := time.Now().Add(time.Duration(*rptResult.Exp) * time.Second)

	return &KeycloakSession{
		Valid:      true,
		UserID:     (*userInfo)["sub"].(string),
		Username:   (*userInfo)["preferred_username"].(string),
		Email:      (*userInfo)["email"].(string),
		Roles:      roles,
		Attributes: *userInfo,
		ExpiresAt:  expiresAt,
		SessionID:  sessionToken,
	}, nil
}

// CheckKeycloakPermission checks if a user has a specific permission
func (kc *KeycloakClient) CheckKeycloakPermission(ctx context.Context, userID, permission string) (*KeycloakPermissionResult, error) {
	// Get admin token
	token, err := kc.client.LoginClient(ctx, kc.clientID, kc.clientSecret, kc.realm)
	if err != nil {
		return nil, err
	}

	// Get user
	user, err := kc.client.GetUserByID(ctx, token.AccessToken, kc.realm, userID)
	if err != nil {
		return &KeycloakPermissionResult{
			HasPermission: false,
			UserID:        userID,
			Permission:    permission,
			Reason:        "User not found",
		}, err
	}

	// Get user roles
	roles, err := kc.client.GetRealmRolesByUserID(ctx, token.AccessToken, kc.realm, userID)
	if err != nil {
		return nil, err
	}

	roleNames := make([]string, len(*roles))
	for i, role := range *roles {
		roleNames[i] = *role.Name
	}

	// Check permission based on roles
	hasPermission := kc.checkPermissionFromRoles(permission, roleNames)

	result := &KeycloakPermissionResult{
		HasPermission: hasPermission,
		UserID:        userID,
		Permission:    permission,
		Roles:         roleNames,
	}

	if !hasPermission {
		result.Reason = fmt.Sprintf("User does not have required permission: %s", permission)
	}

	return result, nil
}

// checkPermissionFromRoles checks if roles grant a specific permission
func (kc *KeycloakClient) checkPermissionFromRoles(permission string, roles []string) bool {
	// Permission mapping (simplified - in production, use Keycloak's authorization services)
	permissionMap := map[string][]string{
		"transfer:domestic":       {"user", "premium_user", "admin"},
		"transfer:international":  {"premium_user", "admin"},
		"transfer:crypto":         {"premium_user", "admin"},
		"wallet:topup":            {"user", "premium_user", "admin"},
		"wallet:withdraw":         {"user", "premium_user", "admin"},
		"financial:savings":       {"user", "premium_user", "admin"},
		"financial:investment":    {"premium_user", "admin"},
		"financial:loan":          {"premium_user", "admin"},
		"financial:insurance":     {"user", "premium_user", "admin"},
		"admin:all":               {"admin"},
	}

	allowedRoles, exists := permissionMap[permission]
	if !exists {
		return false
	}

	for _, userRole := range roles {
		for _, allowedRole := range allowedRoles {
			if userRole == allowedRole {
				return true
			}
		}
	}

	return false
}

// ValidateKeycloakMFA validates multi-factor authentication
func (kc *KeycloakClient) ValidateKeycloakMFA(ctx context.Context, userID, mfaCode, mfaType string) (*KeycloakMFAResult, error) {
	// Get admin token
	token, err := kc.client.LoginClient(ctx, kc.clientID, kc.clientSecret, kc.realm)
	if err != nil {
		return nil, err
	}

	// Get user
	user, err := kc.client.GetUserByID(ctx, token.AccessToken, kc.realm, userID)
	if err != nil {
		return &KeycloakMFAResult{
			Valid:  false,
			UserID: userID,
		}, err
	}

	// Check if user has MFA enabled
	if user.TOTPEnabled == nil || !*user.TOTPEnabled {
		return &KeycloakMFAResult{
			Valid:  false,
			UserID: userID,
		}, errors.New("MFA not enabled for user")
	}

	// Validate MFA code (in production, use Keycloak's credential validation)
	// This is a simplified version
	valid := kc.validateMFACode(userID, mfaCode, mfaType)

	return &KeycloakMFAResult{
		Valid:       valid,
		UserID:      userID,
		MFAType:     mfaType,
		ValidatedAt: time.Now(),
	}, nil
}

// validateMFACode validates the MFA code (simplified implementation)
func (kc *KeycloakClient) validateMFACode(userID, code, mfaType string) bool {
	// In production, this would validate against Keycloak's credential store
	// For now, we'll use a placeholder implementation
	return len(code) == 6 // Basic validation
}

// LogKeycloakEvent logs an authentication event
func (kc *KeycloakClient) LogKeycloakEvent(ctx context.Context, event *KeycloakEventLog) error {
	// Get admin token
	token, err := kc.client.LoginClient(ctx, kc.clientID, kc.clientSecret, kc.realm)
	if err != nil {
		return err
	}

	// In production, this would use Keycloak's event logging API
	// For now, we'll log to application logs
	eventJSON, _ := json.Marshal(event)
	fmt.Printf("[KEYCLOAK_EVENT] %s\n", string(eventJSON))

	// You could also store events in a database or send to analytics
	return nil
}

// GetUserAttributes retrieves user attributes from Keycloak
func (kc *KeycloakClient) GetUserAttributes(ctx context.Context, userID string) (map[string]interface{}, error) {
	// Get admin token
	token, err := kc.client.LoginClient(ctx, kc.clientID, kc.clientSecret, kc.realm)
	if err != nil {
		return nil, err
	}

	// Get user
	user, err := kc.client.GetUserByID(ctx, token.AccessToken, kc.realm, userID)
	if err != nil {
		return nil, err
	}

	// Extract attributes
	attributes := make(map[string]interface{})
	if user.Attributes != nil {
		for key, values := range *user.Attributes {
			if len(values) > 0 {
				attributes[key] = values[0]
			}
		}
	}

	// Add standard attributes
	if user.Email != nil {
		attributes["email"] = *user.Email
	}
	if user.FirstName != nil {
		attributes["first_name"] = *user.FirstName
	}
	if user.LastName != nil {
		attributes["last_name"] = *user.LastName
	}
	if user.Username != nil {
		attributes["username"] = *user.Username
	}

	return attributes, nil
}

// RequiresMFA determines if an action requires MFA
func (kc *KeycloakClient) RequiresMFA(ctx context.Context, userID, action string) (bool, error) {
	// Get user attributes
	attributes, err := kc.GetUserAttributes(ctx, userID)
	if err != nil {
		return false, err
	}

	// Check if user has MFA enabled
	mfaEnabled, _ := attributes["mfa_enabled"].(bool)
	if !mfaEnabled {
		return false, nil
	}

	// High-risk actions that require MFA
	highRiskActions := []string{
		"transfer:international",
		"transfer:crypto",
		"financial:loan",
		"financial:investment",
		"wallet:withdraw",
		"kyc:upgrade",
		"security:password_reset",
	}

	for _, highRiskAction := range highRiskActions {
		if action == highRiskAction {
			return true, nil
		}
	}

	// Check transaction amount threshold
	if amountStr, ok := attributes["mfa_amount_threshold"].(string); ok {
		threshold, err := decimal.NewFromString(amountStr)
		if err == nil {
			// If action involves amount, check threshold
			// This would need to be passed as context
			return true, nil // Simplified
		}
	}

	return false, nil
}

// UpdateUserAttribute updates a user attribute in Keycloak
func (kc *KeycloakClient) UpdateUserAttribute(ctx context.Context, userID, key, value string) error {
	// Get admin token
	token, err := kc.client.LoginClient(ctx, kc.clientID, kc.clientSecret, kc.realm)
	if err != nil {
		return err
	}

	// Get user
	user, err := kc.client.GetUserByID(ctx, token.AccessToken, kc.realm, userID)
	if err != nil {
		return err
	}

	// Update attribute
	if user.Attributes == nil {
		attrs := make(map[string][]string)
		user.Attributes = &attrs
	}

	(*user.Attributes)[key] = []string{value}

	// Update user
	err = kc.client.UpdateUser(ctx, token.AccessToken, kc.realm, *user)
	if err != nil {
		return err
	}

	return nil
}

// CreateKeycloakUser creates a new user in Keycloak
func (kc *KeycloakClient) CreateKeycloakUser(ctx context.Context, email, username, firstName, lastName, password string) (string, error) {
	// Get admin token
	token, err := kc.client.LoginClient(ctx, kc.clientID, kc.clientSecret, kc.realm)
	if err != nil {
		return "", err
	}

	// Create user
	enabled := true
	emailVerified := false
	
	user := gocloak.User{
		Email:         &email,
		Username:      &username,
		FirstName:     &firstName,
		LastName:      &lastName,
		Enabled:       &enabled,
		EmailVerified: &emailVerified,
	}

	userID, err := kc.client.CreateUser(ctx, token.AccessToken, kc.realm, user)
	if err != nil {
		return "", err
	}

	// Set password
	err = kc.client.SetPassword(ctx, token.AccessToken, userID, kc.realm, password, false)
	if err != nil {
		// Cleanup: delete user if password set fails
		_ = kc.client.DeleteUser(ctx, token.AccessToken, kc.realm, userID)
		return "", err
	}

	return userID, nil
}

// DeleteKeycloakUser deletes a user from Keycloak
func (kc *KeycloakClient) DeleteKeycloakUser(ctx context.Context, userID string) error {
	// Get admin token
	token, err := kc.client.LoginClient(ctx, kc.clientID, kc.clientSecret, kc.realm)
	if err != nil {
		return err
	}

	// Delete user
	err = kc.client.DeleteUser(ctx, token.AccessToken, kc.realm, userID)
	if err != nil {
		return err
	}

	return nil
}

// AssignRoleToUser assigns a role to a user
func (kc *KeycloakClient) AssignRoleToUser(ctx context.Context, userID, roleName string) error {
	// Get admin token
	token, err := kc.client.LoginClient(ctx, kc.clientID, kc.clientSecret, kc.realm)
	if err != nil {
		return err
	}

	// Get role
	role, err := kc.client.GetRealmRole(ctx, token.AccessToken, kc.realm, roleName)
	if err != nil {
		return err
	}

	// Assign role to user
	err = kc.client.AddRealmRoleToUser(ctx, token.AccessToken, kc.realm, userID, []gocloak.Role{*role})
	if err != nil {
		return err
	}

	return nil
}

// RemoveRoleFromUser removes a role from a user
func (kc *KeycloakClient) RemoveRoleFromUser(ctx context.Context, userID, roleName string) error {
	// Get admin token
	token, err := kc.client.LoginClient(ctx, kc.clientID, kc.clientSecret, kc.realm)
	if err != nil {
		return err
	}

	// Get role
	role, err := kc.client.GetRealmRole(ctx, token.AccessToken, kc.realm, roleName)
	if err != nil {
		return err
	}

	// Remove role from user
	err = kc.client.DeleteRealmRoleFromUser(ctx, token.AccessToken, kc.realm, userID, []gocloak.Role{*role})
	if err != nil {
		return err
	}

	return nil
}
