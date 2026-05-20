package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// Security Framework for POS Management System
type SecurityFramework struct {
	privateKey     *rsa.PrivateKey
	publicKey      *rsa.PublicKey
	jwtSecret      []byte
	encryptionKey  []byte
	sessionManager *SessionManager
	authManager    *AuthenticationManager
	auditLogger    *AuditLogger
	rateLimiter    *RateLimiter
	mutex          sync.RWMutex
}

// Session Management
type SessionManager struct {
	sessions map[string]*Session
	mutex    sync.RWMutex
}

type Session struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	Role        string    `json:"role"`
	Permissions []string  `json:"permissions"`
	CreatedAt   time.Time `json:"created_at"`
	ExpiresAt   time.Time `json:"expires_at"`
	LastAccess  time.Time `json:"last_access"`
	IPAddress   string    `json:"ip_address"`
	UserAgent   string    `json:"user_agent"`
	IsActive    bool      `json:"is_active"`
}

// Authentication Manager
type AuthenticationManager struct {
	users       map[string]*User
	roles       map[string]*Role
	permissions map[string]*Permission
	mutex       sync.RWMutex
}

type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"password_hash"`
	Role         string    `json:"role"`
	IsActive     bool      `json:"is_active"`
	CreatedAt    time.Time `json:"created_at"`
	LastLogin    time.Time `json:"last_login"`
	FailedLogins int       `json:"failed_logins"`
	LockedUntil  time.Time `json:"locked_until"`
	MFAEnabled   bool      `json:"mfa_enabled"`
	MFASecret    string    `json:"mfa_secret"`
}

type Role struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Permissions []string `json:"permissions"`
	IsActive    bool     `json:"is_active"`
}

type Permission struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Resource    string `json:"resource"`
	Action      string `json:"action"`
}

// Audit Logger
type AuditLogger struct {
	logs  []AuditLog
	mutex sync.RWMutex
}

type AuditLog struct {
	ID        string                 `json:"id"`
	Timestamp time.Time              `json:"timestamp"`
	UserID    string                 `json:"user_id"`
	Action    string                 `json:"action"`
	Resource  string                 `json:"resource"`
	IPAddress string                 `json:"ip_address"`
	UserAgent string                 `json:"user_agent"`
	Success   bool                   `json:"success"`
	Details   map[string]interface{} `json:"details"`
	Risk      string                 `json:"risk"`
}

// Rate Limiter
type RateLimiter struct {
	requests map[string][]time.Time
	mutex    sync.RWMutex
}

// JWT Claims
type JWTClaims struct {
	UserID      string   `json:"user_id"`
	Username    string   `json:"username"`
	Role        string   `json:"role"`
	Permissions []string `json:"permissions"`
	SessionID   string   `json:"session_id"`
	jwt.RegisteredClaims
}

// Message Encryption
type EncryptedMessage struct {
	Data      string `json:"data"`
	Nonce     string `json:"nonce"`
	Signature string `json:"signature"`
	Timestamp int64  `json:"timestamp"`
}

// Initialize Security Framework
func NewSecurityFramework() *SecurityFramework {
	// Generate RSA key pair
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		log.Fatal("Failed to generate RSA key pair:", err)
	}

	// Generate encryption key
	encryptionKey := make([]byte, 32)
	if _, err := rand.Read(encryptionKey); err != nil {
		log.Fatal("Failed to generate encryption key:", err)
	}

	// Generate JWT secret
	jwtSecret := make([]byte, 64)
	if _, err := rand.Read(jwtSecret); err != nil {
		log.Fatal("Failed to generate JWT secret:", err)
	}

	sf := &SecurityFramework{
		privateKey:     privateKey,
		publicKey:      &privateKey.PublicKey,
		jwtSecret:      jwtSecret,
		encryptionKey:  encryptionKey,
		sessionManager: NewSessionManager(),
		authManager:    NewAuthenticationManager(),
		auditLogger:    NewAuditLogger(),
		rateLimiter:    NewRateLimiter(),
	}

	// Initialize default roles and permissions
	sf.initializeDefaultRolesAndPermissions()

	return sf
}

func NewSessionManager() *SessionManager {
	return &SessionManager{
		sessions: make(map[string]*Session),
	}
}

func NewAuthenticationManager() *AuthenticationManager {
	return &AuthenticationManager{
		users:       make(map[string]*User),
		roles:       make(map[string]*Role),
		permissions: make(map[string]*Permission),
	}
}

func NewAuditLogger() *AuditLogger {
	return &AuditLogger{
		logs: make([]AuditLog, 0),
	}
}

func NewRateLimiter() *RateLimiter {
	return &RateLimiter{
		requests: make(map[string][]time.Time),
	}
}

// Initialize default roles and permissions
func (sf *SecurityFramework) initializeDefaultRolesAndPermissions() {
	// Define permissions
	permissions := []Permission{
		{ID: "terminal_read", Name: "Read Terminals", Description: "View terminal information", Resource: "terminals", Action: "read"},
		{ID: "terminal_write", Name: "Write Terminals", Description: "Modify terminal configuration", Resource: "terminals", Action: "write"},
		{ID: "terminal_delete", Name: "Delete Terminals", Description: "Remove terminals", Resource: "terminals", Action: "delete"},
		{ID: "update_push", Name: "Push Updates", Description: "Send updates to terminals", Resource: "updates", Action: "create"},
		{ID: "command_execute", Name: "Execute Commands", Description: "Execute commands on terminals", Resource: "commands", Action: "execute"},
		{ID: "metrics_read", Name: "Read Metrics", Description: "View system metrics", Resource: "metrics", Action: "read"},
		{ID: "alerts_manage", Name: "Manage Alerts", Description: "Manage system alerts", Resource: "alerts", Action: "manage"},
		{ID: "users_manage", Name: "Manage Users", Description: "Manage user accounts", Resource: "users", Action: "manage"},
		{ID: "system_admin", Name: "System Administration", Description: "Full system administration", Resource: "system", Action: "admin"},
	}

	for _, perm := range permissions {
		sf.authManager.permissions[perm.ID] = &perm
	}

	// Define roles
	roles := []Role{
		{
			ID:          "viewer",
			Name:        "Viewer",
			Description: "Read-only access to terminals and metrics",
			Permissions: []string{"terminal_read", "metrics_read"},
			IsActive:    true,
		},
		{
			ID:          "operator",
			Name:        "Operator",
			Description: "Can view and manage terminals",
			Permissions: []string{"terminal_read", "terminal_write", "update_push", "command_execute", "metrics_read", "alerts_manage"},
			IsActive:    true,
		},
		{
			ID:          "admin",
			Name:        "Administrator",
			Description: "Full system access",
			Permissions: []string{"terminal_read", "terminal_write", "terminal_delete", "update_push", "command_execute", "metrics_read", "alerts_manage", "users_manage", "system_admin"},
			IsActive:    true,
		},
	}

	for _, role := range roles {
		sf.authManager.roles[role.ID] = &role
	}

	adminPassword := os.Getenv("POS_ADMIN_PASSWORD")
	if adminPassword == "" {
		log.Fatal("POS_ADMIN_PASSWORD env var is required")
	}

	// Create default admin user
	adminUser := &User{
		ID:           "admin",
		Username:     "admin",
		Email:        "admin@posmanagement.com",
		PasswordHash: sf.hashPassword(adminPassword),
		Role:         "admin",
		IsActive:     true,
		CreatedAt:    time.Now(),
		MFAEnabled:   false,
	}

	sf.authManager.users[adminUser.ID] = adminUser
}

// Authentication Methods
func (sf *SecurityFramework) Authenticate(username, password string, ipAddress, userAgent string) (*Session, error) {
	sf.authManager.mutex.RLock()
	defer sf.authManager.mutex.RUnlock()

	// Find user
	var user *User
	for _, u := range sf.authManager.users {
		if u.Username == username {
			user = u
			break
		}
	}

	if user == nil {
		sf.logAuditEvent("", "authentication_failed", "users", ipAddress, userAgent, false, map[string]interface{}{
			"username": username,
			"reason":   "user_not_found",
		})
		return nil, errors.New("invalid credentials")
	}

	// Check if user is locked
	if time.Now().Before(user.LockedUntil) {
		sf.logAuditEvent(user.ID, "authentication_failed", "users", ipAddress, userAgent, false, map[string]interface{}{
			"username": username,
			"reason":   "account_locked",
		})
		return nil, errors.New("account locked")
	}

	// Check if user is active
	if !user.IsActive {
		sf.logAuditEvent(user.ID, "authentication_failed", "users", ipAddress, userAgent, false, map[string]interface{}{
			"username": username,
			"reason":   "account_inactive",
		})
		return nil, errors.New("account inactive")
	}

	// Verify password
	if !sf.verifyPassword(password, user.PasswordHash) {
		user.FailedLogins++
		if user.FailedLogins >= 5 {
			user.LockedUntil = time.Now().Add(30 * time.Minute)
		}

		sf.logAuditEvent(user.ID, "authentication_failed", "users", ipAddress, userAgent, false, map[string]interface{}{
			"username":      username,
			"reason":        "invalid_password",
			"failed_logins": user.FailedLogins,
		})
		return nil, errors.New("invalid credentials")
	}

	// Reset failed logins on successful authentication
	user.FailedLogins = 0
	user.LastLogin = time.Now()

	// Create session
	session := sf.sessionManager.CreateSession(user.ID, user.Role, sf.getRolePermissions(user.Role), ipAddress, userAgent)

	sf.logAuditEvent(user.ID, "authentication_success", "users", ipAddress, userAgent, true, map[string]interface{}{
		"username":   username,
		"session_id": session.ID,
	})

	return session, nil
}

func (sf *SecurityFramework) ValidateSession(sessionID string) (*Session, error) {
	return sf.sessionManager.ValidateSession(sessionID)
}

func (sf *SecurityFramework) InvalidateSession(sessionID string) error {
	return sf.sessionManager.InvalidateSession(sessionID)
}

// Session Management Methods
func (sm *SessionManager) CreateSession(userID, role string, permissions []string, ipAddress, userAgent string) *Session {
	sm.mutex.Lock()
	defer sm.mutex.Unlock()

	sessionID := generateSessionID()
	session := &Session{
		ID:          sessionID,
		UserID:      userID,
		Role:        role,
		Permissions: permissions,
		CreatedAt:   time.Now(),
		ExpiresAt:   time.Now().Add(8 * time.Hour),
		LastAccess:  time.Now(),
		IPAddress:   ipAddress,
		UserAgent:   userAgent,
		IsActive:    true,
	}

	sm.sessions[sessionID] = session
	return session
}

func (sm *SessionManager) ValidateSession(sessionID string) (*Session, error) {
	sm.mutex.RLock()
	defer sm.mutex.RUnlock()

	session, exists := sm.sessions[sessionID]
	if !exists {
		return nil, errors.New("session not found")
	}

	if !session.IsActive {
		return nil, errors.New("session inactive")
	}

	if time.Now().After(session.ExpiresAt) {
		return nil, errors.New("session expired")
	}

	// Update last access
	session.LastAccess = time.Now()
	return session, nil
}

func (sm *SessionManager) InvalidateSession(sessionID string) error {
	sm.mutex.Lock()
	defer sm.mutex.Unlock()

	session, exists := sm.sessions[sessionID]
	if !exists {
		return errors.New("session not found")
	}

	session.IsActive = false
	return nil
}

func (sm *SessionManager) CleanupExpiredSessions() {
	sm.mutex.Lock()
	defer sm.mutex.Unlock()

	now := time.Now()
	for sessionID, session := range sm.sessions {
		if now.After(session.ExpiresAt) {
			delete(sm.sessions, sessionID)
		}
	}
}

// JWT Token Methods
func (sf *SecurityFramework) GenerateJWT(session *Session) (string, error) {
	claims := JWTClaims{
		UserID:      session.UserID,
		Role:        session.Role,
		Permissions: session.Permissions,
		SessionID:   session.ID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(session.ExpiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
			Issuer:    "pos-management-system",
			Subject:   session.UserID,
			ID:        session.ID,
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(sf.jwtSecret)
}

func (sf *SecurityFramework) ValidateJWT(tokenString string) (*JWTClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return sf.jwtSecret, nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*JWTClaims); ok && token.Valid {
		// Validate session still exists
		_, err := sf.ValidateSession(claims.SessionID)
		if err != nil {
			return nil, err
		}
		return claims, nil
	}

	return nil, errors.New("invalid token")
}

// Message Encryption Methods
func (sf *SecurityFramework) EncryptMessage(data []byte) (*EncryptedMessage, error) {
	// Create AES cipher
	block, err := aes.NewCipher(sf.encryptionKey)
	if err != nil {
		return nil, err
	}

	// Create GCM
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	// Generate nonce
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	// Encrypt data
	ciphertext := gcm.Seal(nil, nonce, data, nil)

	// Create signature
	signature, err := sf.signData(ciphertext)
	if err != nil {
		return nil, err
	}

	return &EncryptedMessage{
		Data:      base64.StdEncoding.EncodeToString(ciphertext),
		Nonce:     base64.StdEncoding.EncodeToString(nonce),
		Signature: base64.StdEncoding.EncodeToString(signature),
		Timestamp: time.Now().Unix(),
	}, nil
}

func (sf *SecurityFramework) DecryptMessage(encMsg *EncryptedMessage) ([]byte, error) {
	// Verify timestamp (prevent replay attacks)
	if time.Now().Unix()-encMsg.Timestamp > 300 { // 5 minutes
		return nil, errors.New("message too old")
	}

	// Decode data
	ciphertext, err := base64.StdEncoding.DecodeString(encMsg.Data)
	if err != nil {
		return nil, err
	}

	// Decode nonce
	nonce, err := base64.StdEncoding.DecodeString(encMsg.Nonce)
	if err != nil {
		return nil, err
	}

	// Decode signature
	signature, err := base64.StdEncoding.DecodeString(encMsg.Signature)
	if err != nil {
		return nil, err
	}

	// Verify signature
	if !sf.verifySignature(ciphertext, signature) {
		return nil, errors.New("invalid signature")
	}

	// Create AES cipher
	block, err := aes.NewCipher(sf.encryptionKey)
	if err != nil {
		return nil, err
	}

	// Create GCM
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	// Decrypt data
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, err
	}

	return plaintext, nil
}

// Digital Signature Methods
func (sf *SecurityFramework) signData(data []byte) ([]byte, error) {
	hash := sha256.Sum256(data)
	return rsa.SignPKCS1v15(rand.Reader, sf.privateKey, crypto.SHA256, hash[:])
}

func (sf *SecurityFramework) verifySignature(data, signature []byte) bool {
	hash := sha256.Sum256(data)
	err := rsa.VerifyPKCS1v15(sf.publicKey, crypto.SHA256, hash[:], signature)
	return err == nil
}

// Rate Limiting Methods
func (rl *RateLimiter) IsAllowed(identifier string, limit int, window time.Duration) bool {
	rl.mutex.Lock()
	defer rl.mutex.Unlock()

	now := time.Now()
	cutoff := now.Add(-window)

	// Get existing requests
	requests, exists := rl.requests[identifier]
	if !exists {
		requests = make([]time.Time, 0)
	}

	// Filter out old requests
	validRequests := make([]time.Time, 0)
	for _, req := range requests {
		if req.After(cutoff) {
			validRequests = append(validRequests, req)
		}
	}

	// Check if limit exceeded
	if len(validRequests) >= limit {
		return false
	}

	// Add current request
	validRequests = append(validRequests, now)
	rl.requests[identifier] = validRequests

	return true
}

// Authorization Methods
func (sf *SecurityFramework) HasPermission(session *Session, resource, action string) bool {
	for _, perm := range session.Permissions {
		if permission, exists := sf.authManager.permissions[perm]; exists {
			if permission.Resource == resource && permission.Action == action {
				return true
			}
			// Check for admin permission
			if permission.Resource == "system" && permission.Action == "admin" {
				return true
			}
		}
	}
	return false
}

func (sf *SecurityFramework) getRolePermissions(roleID string) []string {
	if role, exists := sf.authManager.roles[roleID]; exists {
		return role.Permissions
	}
	return []string{}
}

// Audit Logging Methods
func (sf *SecurityFramework) logAuditEvent(userID, action, resource, ipAddress, userAgent string, success bool, details map[string]interface{}) {
	sf.auditLogger.mutex.Lock()
	defer sf.auditLogger.mutex.Unlock()

	auditLog := AuditLog{
		ID:        generateAuditID(),
		Timestamp: time.Now(),
		UserID:    userID,
		Action:    action,
		Resource:  resource,
		IPAddress: ipAddress,
		UserAgent: userAgent,
		Success:   success,
		Details:   details,
		Risk:      sf.calculateRiskLevel(action, success, details),
	}

	sf.auditLogger.logs = append(sf.auditLogger.logs, auditLog)

	// Log to file or external system in production
	log.Printf("AUDIT: %+v", auditLog)
}

func (sf *SecurityFramework) calculateRiskLevel(action string, success bool, details map[string]interface{}) string {
	if !success {
		return "medium"
	}

	highRiskActions := []string{"authentication_failed", "terminal_delete", "system_admin", "users_manage"}
	for _, riskAction := range highRiskActions {
		if action == riskAction {
			return "high"
		}
	}

	return "low"
}

// Utility Methods
func (sf *SecurityFramework) hashPassword(password string) string {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		log.Fatal("Failed to hash password:", err)
	}
	return string(hash)
}

func (sf *SecurityFramework) verifyPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func generateSessionID() string {
	bytes := make([]byte, 32)
	rand.Read(bytes)
	return base64.URLEncoding.EncodeToString(bytes)
}

func generateAuditID() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return base64.URLEncoding.EncodeToString(bytes)
}

// HTTP Middleware
func (sf *SecurityFramework) AuthenticationMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Extract token from Authorization header
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, "Authorization header required", http.StatusUnauthorized)
			return
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		if tokenString == authHeader {
			http.Error(w, "Bearer token required", http.StatusUnauthorized)
			return
		}

		// Validate JWT
		claims, err := sf.ValidateJWT(tokenString)
		if err != nil {
			http.Error(w, "Invalid token", http.StatusUnauthorized)
			return
		}

		// Rate limiting
		if !sf.rateLimiter.IsAllowed(claims.UserID, 100, time.Minute) {
			http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
			return
		}

		// Add claims to request context
		r.Header.Set("X-User-ID", claims.UserID)
		r.Header.Set("X-User-Role", claims.Role)
		r.Header.Set("X-Session-ID", claims.SessionID)

		next(w, r)
	}
}

func (sf *SecurityFramework) AuthorizationMiddleware(resource, action string) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			sessionID := r.Header.Get("X-Session-ID")
			if sessionID == "" {
				http.Error(w, "Session required", http.StatusUnauthorized)
				return
			}

			session, err := sf.ValidateSession(sessionID)
			if err != nil {
				http.Error(w, "Invalid session", http.StatusUnauthorized)
				return
			}

			if !sf.HasPermission(session, resource, action) {
				sf.logAuditEvent(session.UserID, "authorization_failed", resource, r.RemoteAddr, r.UserAgent(), false, map[string]interface{}{
					"required_resource": resource,
					"required_action":   action,
				})
				http.Error(w, "Insufficient permissions", http.StatusForbidden)
				return
			}

			sf.logAuditEvent(session.UserID, action, resource, r.RemoteAddr, r.UserAgent(), true, map[string]interface{}{
				"endpoint": r.URL.Path,
				"method":   r.Method,
			})

			next(w, r)
		}
	}
}

// Public Key Export (for terminal clients)
func (sf *SecurityFramework) GetPublicKeyPEM() string {
	pubKeyBytes, err := x509.MarshalPKIXPublicKey(sf.publicKey)
	if err != nil {
		log.Fatal("Failed to marshal public key:", err)
	}

	pubKeyPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: pubKeyBytes,
	})

	return string(pubKeyPEM)
}

// Health Check
func (sf *SecurityFramework) HealthCheck() map[string]interface{} {
	sf.sessionManager.mutex.RLock()
	activeSessions := len(sf.sessionManager.sessions)
	sf.sessionManager.mutex.RUnlock()

	sf.auditLogger.mutex.RLock()
	totalAuditLogs := len(sf.auditLogger.logs)
	sf.auditLogger.mutex.RUnlock()

	return map[string]interface{}{
		"status":          "healthy",
		"active_sessions": activeSessions,
		"total_users":     len(sf.authManager.users),
		"total_roles":     len(sf.authManager.roles),
		"audit_logs":      totalAuditLogs,
		"timestamp":       time.Now().Unix(),
	}
}

// Cleanup routine
func (sf *SecurityFramework) StartCleanupRoutine() {
	ticker := time.NewTicker(1 * time.Hour)
	go func() {
		for range ticker.C {
			sf.sessionManager.CleanupExpiredSessions()
			sf.cleanupOldAuditLogs()
			sf.cleanupRateLimitData()
		}
	}()
}

func (sf *SecurityFramework) cleanupOldAuditLogs() {
	sf.auditLogger.mutex.Lock()
	defer sf.auditLogger.mutex.Unlock()

	cutoff := time.Now().Add(-30 * 24 * time.Hour) // Keep 30 days
	validLogs := make([]AuditLog, 0)

	for _, log := range sf.auditLogger.logs {
		if log.Timestamp.After(cutoff) {
			validLogs = append(validLogs, log)
		}
	}

	sf.auditLogger.logs = validLogs
}

func (sf *SecurityFramework) cleanupRateLimitData() {
	sf.rateLimiter.mutex.Lock()
	defer sf.rateLimiter.mutex.Unlock()

	cutoff := time.Now().Add(-1 * time.Hour)
	for identifier, requests := range sf.rateLimiter.requests {
		validRequests := make([]time.Time, 0)
		for _, req := range requests {
			if req.After(cutoff) {
				validRequests = append(validRequests, req)
			}
		}
		if len(validRequests) == 0 {
			delete(sf.rateLimiter.requests, identifier)
		} else {
			sf.rateLimiter.requests[identifier] = validRequests
		}
	}
}

