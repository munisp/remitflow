package workflows

import (
	"time"
	"go.temporal.io/sdk/workflow"
	"go.temporal.io/sdk/temporal"
	"github.com/nigerian-remittance/orchestration/models"
	"github.com/nigerian-remittance/orchestration/activities"
)

// SocialLoginInput represents input for social login integration
type SocialLoginInput struct {
	UserID       models.UserID `json:"user_id,omitempty"` // For linking existing account
	Provider     string        `json:"provider"` // google, facebook, apple, twitter
	AuthCode     string        `json:"auth_code"` // OAuth authorization code
	RedirectURI  string        `json:"redirect_uri"`
	Action       string        `json:"action"` // link, unlink, login
	DeviceInfo   map[string]interface{} `json:"device_info"`
}

// SocialLoginResult represents the workflow result
type SocialLoginResult struct {
	Success       bool      `json:"success"`
	Action        string    `json:"action"`
	UserID        models.UserID `json:"user_id,omitempty"`
	Email         string    `json:"email,omitempty"`
	Name          string    `json:"name,omitempty"`
	ProfilePicture string   `json:"profile_picture,omitempty"`
	AccessToken   string    `json:"access_token,omitempty"` // JWT token
	RefreshToken  string    `json:"refresh_token,omitempty"`
	ExpiresIn     int       `json:"expires_in,omitempty"`
	IsNewUser     bool      `json:"is_new_user"`
	Message       string    `json:"message"`
	CompletedAt   time.Time `json:"completed_at"`
}

// SocialLoginWorkflow implements Journey 5: Social Login Integration
//
// Steps (for login action):
// 1. Exchange auth code for access token
// 2. Fetch user profile from provider
// 3. Check if user exists (by email)
// 4. If new user: Create account
// 5. If existing: Link social account
// 6. Update Keycloak with social identity
// 7. Generate platform JWT token
// 8. Send welcome/login notification
// 9. Log to analytics
func SocialLoginWorkflow(ctx workflow.Context, input SocialLoginInput) (*SocialLoginResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("SocialLoginWorkflow started",
		"provider", input.Provider,
		"action", input.Action)

	// Workflow execution options
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	result := &SocialLoginResult{
		Success: false,
		Action:  input.Action,
	}

	// Route based on action
	switch input.Action {
	case "login":
		return socialLogin(ctx, input, result, logger)
	case "link":
		return linkSocialAccount(ctx, input, result, logger)
	case "unlink":
		return unlinkSocialAccount(ctx, input, result, logger)
	default:
		result.Message = "Invalid action: " + input.Action
		return result, nil
	}
}

// socialLogin handles social login/registration
func socialLogin(ctx workflow.Context, input SocialLoginInput, result *SocialLoginResult, logger workflow.Logger) (*SocialLoginResult, error) {
	// Step 1: Exchange auth code for access token
	logger.Info("Step 1: Exchanging auth code for access token")
	var tokenExchange activities.OAuthTokenExchangeResult
	err := workflow.ExecuteActivity(ctx, activities.ExchangeOAuthCode, map[string]interface{}{
		"provider":     input.Provider,
		"auth_code":    input.AuthCode,
		"redirect_uri": input.RedirectURI,
	}).Get(ctx, &tokenExchange)

	if err != nil {
		logger.Error("OAuth token exchange failed", "error", err)
		return nil, err
	}

	if !tokenExchange.Success {
		result.Message = "OAuth authentication failed: " + tokenExchange.Error
		return result, nil
	}

	// Step 2: Fetch user profile from provider
	logger.Info("Step 2: Fetching user profile from provider")
	var profile activities.SocialProfileResult
	err = workflow.ExecuteActivity(ctx, activities.FetchSocialProfile, map[string]interface{}{
		"provider":     input.Provider,
		"access_token": tokenExchange.AccessToken,
	}).Get(ctx, &profile)

	if err != nil {
		logger.Error("Profile fetch failed", "error", err)
		return nil, err
	}

	result.Email = profile.Email
	result.Name = profile.Name
	result.ProfilePicture = profile.ProfilePicture

	// Step 3: Check if user exists by email
	logger.Info("Step 3: Checking if user exists", "email", profile.Email)
	var userLookup activities.UserLookupResult
	err = workflow.ExecuteActivity(ctx, activities.LookupUserByEmail, map[string]interface{}{
		"email": profile.Email,
	}).Get(ctx, &userLookup)

	if err != nil {
		logger.Error("User lookup failed", "error", err)
		return nil, err
	}

	if !userLookup.Found {
		// New user - create account
		logger.Info("Step 4: Creating new user account")
		result.IsNewUser = true

		var userCreation activities.UserCreationResult
		err = workflow.ExecuteActivity(ctx, activities.CreateUserFromSocial, map[string]interface{}{
			"email":           profile.Email,
			"name":            profile.Name,
			"profile_picture": profile.ProfilePicture,
			"provider":        input.Provider,
			"provider_id":     profile.ProviderUserID,
		}).Get(ctx, &userCreation)

		if err != nil {
			logger.Error("User creation failed", "error", err)
			return nil, err
		}

		result.UserID = userCreation.UserID
		logger.Info("New user created", "user_id", result.UserID)

		// Send welcome email
		_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
			"user_id": result.UserID,
			"type":    "welcome_social_signup",
			"channel": "email",
			"data": map[string]interface{}{
				"name":     profile.Name,
				"provider": input.Provider,
			},
		}).Get(ctx, nil)

	} else {
		// Existing user - link social account if not already linked
		logger.Info("Step 4: User exists, linking social account")
		result.IsNewUser = false
		result.UserID = userLookup.UserID

		var linkResult activities.SocialLinkResult
		err = workflow.ExecuteActivity(ctx, activities.LinkSocialAccount, map[string]interface{}{
			"user_id":     userLookup.UserID,
			"provider":    input.Provider,
			"provider_id": profile.ProviderUserID,
		}).Get(ctx, &linkResult)

		if err != nil {
			logger.Warn("Social account linking failed (non-critical)", "error", err)
			// Continue even if linking fails
		}

		// Send login notification
		_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
			"user_id": result.UserID,
			"type":    "social_login",
			"channel": "email",
			"data": map[string]interface{}{
				"provider":    input.Provider,
				"device_info": input.DeviceInfo,
				"login_time":  time.Now(),
			},
		}).Get(ctx, nil)
	}

	// Step 5: Update Keycloak with social identity
	logger.Info("Step 5: Updating Keycloak with social identity")
	err = workflow.ExecuteActivity(ctx, activities.UpdateKeycloakSocialIdentity, map[string]interface{}{
		"user_id":     result.UserID,
		"provider":    input.Provider,
		"provider_id": profile.ProviderUserID,
		"email":       profile.Email,
	}).Get(ctx, nil)

	if err != nil {
		logger.Warn("Keycloak update failed (non-critical)", "error", err)
	}

	// Step 6: Generate platform JWT tokens
	logger.Info("Step 6: Generating platform JWT tokens")
	var jwtTokens activities.JWTTokenResult
	err = workflow.ExecuteActivity(ctx, activities.GenerateJWTTokens, map[string]interface{}{
		"user_id":     result.UserID,
		"email":       profile.Email,
		"device_info": input.DeviceInfo,
	}).Get(ctx, &jwtTokens)

	if err != nil {
		logger.Error("JWT generation failed", "error", err)
		return nil, err
	}

	result.AccessToken = jwtTokens.AccessToken
	result.RefreshToken = jwtTokens.RefreshToken
	result.ExpiresIn = jwtTokens.ExpiresIn

	// Step 7: Update Permify permissions
	logger.Info("Step 7: Updating Permify permissions")
	_ = workflow.ExecuteActivity(ctx, activities.UpdatePermifyUserPermissions, map[string]interface{}{
		"user_id": result.UserID,
		"role":    "user",
	}).Get(ctx, nil)

	// Step 8: Log to analytics
	logger.Info("Step 8: Logging to analytics")
	_ = workflow.ExecuteActivity(ctx, activities.LogToAnalytics, map[string]interface{}{
		"event_type": "social_login",
		"user_id":    result.UserID,
		"data": map[string]interface{}{
			"provider":   input.Provider,
			"is_new_user": result.IsNewUser,
			"device_info": input.DeviceInfo,
		},
	}).Get(ctx, nil)

	result.Success = true
	if result.IsNewUser {
		result.Message = "Account created successfully via " + input.Provider
	} else {
		result.Message = "Logged in successfully via " + input.Provider
	}
	result.CompletedAt = time.Now()

	logger.Info("SocialLoginWorkflow (login) completed successfully", "is_new_user", result.IsNewUser)
	return result, nil
}

// linkSocialAccount handles linking social account to existing user
func linkSocialAccount(ctx workflow.Context, input SocialLoginInput, result *SocialLoginResult, logger workflow.Logger) (*SocialLoginResult, error) {
	logger.Info("Linking social account", "user_id", input.UserID, "provider", input.Provider)

	// Exchange auth code
	var tokenExchange activities.OAuthTokenExchangeResult
	err := workflow.ExecuteActivity(ctx, activities.ExchangeOAuthCode, map[string]interface{}{
		"provider":     input.Provider,
		"auth_code":    input.AuthCode,
		"redirect_uri": input.RedirectURI,
	}).Get(ctx, &tokenExchange)

	if err != nil || !tokenExchange.Success {
		result.Message = "OAuth authentication failed"
		return result, nil
	}

	// Fetch profile
	var profile activities.SocialProfileResult
	err = workflow.ExecuteActivity(ctx, activities.FetchSocialProfile, map[string]interface{}{
		"provider":     input.Provider,
		"access_token": tokenExchange.AccessToken,
	}).Get(ctx, &profile)

	if err != nil {
		return nil, err
	}

	// Check if this social account is already linked to another user
	var existingLink activities.SocialLinkCheckResult
	err = workflow.ExecuteActivity(ctx, activities.CheckSocialAccountLink, map[string]interface{}{
		"provider":    input.Provider,
		"provider_id": profile.ProviderUserID,
	}).Get(ctx, &existingLink)

	if err == nil && existingLink.Linked {
		result.Message = "This social account is already linked to another user"
		return result, nil
	}

	// Link social account
	var linkResult activities.SocialLinkResult
	err = workflow.ExecuteActivity(ctx, activities.LinkSocialAccount, map[string]interface{}{
		"user_id":     input.UserID,
		"provider":    input.Provider,
		"provider_id": profile.ProviderUserID,
	}).Get(ctx, &linkResult)

	if err != nil {
		return nil, err
	}

	// Update Keycloak
	_ = workflow.ExecuteActivity(ctx, activities.UpdateKeycloakSocialIdentity, map[string]interface{}{
		"user_id":     input.UserID,
		"provider":    input.Provider,
		"provider_id": profile.ProviderUserID,
		"email":       profile.Email,
	}).Get(ctx, nil)

	// Send notification
	_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
		"user_id": input.UserID,
		"type":    "social_account_linked",
		"channel": "email,push",
		"data": map[string]interface{}{
			"provider": input.Provider,
		},
	}).Get(ctx, nil)

	result.Success = true
	result.UserID = input.UserID
	result.Message = input.Provider + " account linked successfully"
	result.CompletedAt = time.Now()

	return result, nil
}

// unlinkSocialAccount handles unlinking social account from user
func unlinkSocialAccount(ctx workflow.Context, input SocialLoginInput, result *SocialLoginResult, logger workflow.Logger) (*SocialLoginResult, error) {
	logger.Info("Unlinking social account", "user_id", input.UserID, "provider", input.Provider)

	// Check if user has password set (can't unlink if it's the only login method)
	var passwordCheck activities.PasswordCheckResult
	err := workflow.ExecuteActivity(ctx, activities.CheckUserHasPassword, map[string]interface{}{
		"user_id": input.UserID,
	}).Get(ctx, &passwordCheck)

	if err != nil {
		return nil, err
	}

	// Count other social logins
	var socialCount activities.SocialAccountCountResult
	err = workflow.ExecuteActivity(ctx, activities.CountSocialAccounts, map[string]interface{}{
		"user_id": input.UserID,
	}).Get(ctx, &socialCount)

	if err != nil {
		return nil, err
	}

	// Prevent unlinking if it's the only login method
	if !passwordCheck.HasPassword && socialCount.Count <= 1 {
		result.Message = "Cannot unlink. Please set a password first or link another social account."
		return result, nil
	}

	// Unlink social account
	err = workflow.ExecuteActivity(ctx, activities.UnlinkSocialAccount, map[string]interface{}{
		"user_id":  input.UserID,
		"provider": input.Provider,
	}).Get(ctx, nil)

	if err != nil {
		return nil, err
	}

	// Update Keycloak
	_ = workflow.ExecuteActivity(ctx, activities.RemoveKeycloakSocialIdentity, map[string]interface{}{
		"user_id":  input.UserID,
		"provider": input.Provider,
	}).Get(ctx, nil)

	// Send notification
	_ = workflow.ExecuteActivity(ctx, activities.SendNotification, map[string]interface{}{
		"user_id": input.UserID,
		"type":    "social_account_unlinked",
		"channel": "email",
		"data": map[string]interface{}{
			"provider": input.Provider,
		},
	}).Get(ctx, nil)

	result.Success = true
	result.UserID = input.UserID
	result.Message = input.Provider + " account unlinked successfully"
	result.CompletedAt = time.Now()

	return result, nil
}
