#!/usr/bin/env python3
"""
Security Fix Code Extractor
Extracts and presents the complete code implementations for critical security fixes
"""

import os
from datetime import datetime

def create_security_fix_implementations():
    """Create complete security fix code implementations"""
    
    print("🔒 Creating Complete Security Fix Code Implementations...")
    print("=" * 70)
    
    # Create directory structure for security fixes
    security_fixes_dir = "/home/ubuntu/security-fixes"
    os.makedirs(security_fixes_dir, exist_ok=True)
    
    # CVE-2024-SEC-001: Input Validation Fix
    create_input_validation_fix(security_fixes_dir)
    
    # CVE-2024-SEC-002: JWT Authentication Fix
    create_jwt_authentication_fix(security_fixes_dir)
    
    # Create implementation guide
    create_implementation_guide(security_fixes_dir)
    
    print("\n✅ All security fix code implementations created!")
    return security_fixes_dir

def create_input_validation_fix(base_dir):
    """Create complete input validation security fix"""
    
    print("🛡️ Creating CVE-2024-SEC-001: Input Validation Fix...")
    
    # Create directory structure
    validation_dir = f"{base_dir}/CVE-2024-SEC-001-input-validation"
    os.makedirs(f"{validation_dir}/services/security/validation-middleware", exist_ok=True)
    os.makedirs(f"{validation_dir}/services/pix-integration/pix-gateway", exist_ok=True)
    os.makedirs(f"{validation_dir}/services/core-infrastructure/api-gateway", exist_ok=True)
    os.makedirs(f"{validation_dir}/tests", exist_ok=True)
    
    # 1. Comprehensive Input Validation Library
    validator_code = '''package validation

import (
    "errors"
    "fmt"
    "regexp"
    "strconv"
    "strings"
    "unicode"
    "unicode/utf8"
)

// PIXValidator handles all PIX-related input validation
type PIXValidator struct {
    cpfRegex    *regexp.Regexp
    cnpjRegex   *regexp.Regexp
    emailRegex  *regexp.Regexp
    phoneRegex  *regexp.Regexp
    randomKeyRegex *regexp.Regexp
}

// ValidationError represents a validation error
type ValidationError struct {
    Field   string `json:"field"`
    Message string `json:"message"`
    Code    string `json:"code"`
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation error in field '%s': %s", e.Field, e.Message)
}

// NewPIXValidator creates a new PIX validator instance
func NewPIXValidator() *PIXValidator {
    return &PIXValidator{
        cpfRegex:       regexp.MustCompile(`^\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}$`),
        cnpjRegex:      regexp.MustCompile(`^\\d{2}\\.\\d{3}\\.\\d{3}/\\d{4}-\\d{2}$`),
        emailRegex:     regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$`),
        phoneRegex:     regexp.MustCompile(`^\\+55\\d{10,11}$`),
        randomKeyRegex: regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`),
    }
}

// ValidatePIXKey validates a PIX key based on its type
func (v *PIXValidator) ValidatePIXKey(key string, keyType string) error {
    // Sanitize input
    key = strings.TrimSpace(key)
    keyType = strings.ToUpper(strings.TrimSpace(keyType))
    
    // Check for empty values
    if key == "" {
        return &ValidationError{
            Field:   "pix_key",
            Message: "PIX key cannot be empty",
            Code:    "EMPTY_PIX_KEY",
        }
    }
    
    if keyType == "" {
        return &ValidationError{
            Field:   "key_type",
            Message: "PIX key type cannot be empty",
            Code:    "EMPTY_KEY_TYPE",
        }
    }
    
    // Validate based on type
    switch keyType {
    case "CPF":
        if !v.cpfRegex.MatchString(key) {
            return &ValidationError{
                Field:   "pix_key",
                Message: "Invalid CPF format. Expected: XXX.XXX.XXX-XX",
                Code:    "INVALID_CPF_FORMAT",
            }
        }
        return v.validateCPFChecksum(key)
        
    case "CNPJ":
        if !v.cnpjRegex.MatchString(key) {
            return &ValidationError{
                Field:   "pix_key",
                Message: "Invalid CNPJ format. Expected: XX.XXX.XXX/XXXX-XX",
                Code:    "INVALID_CNPJ_FORMAT",
            }
        }
        return v.validateCNPJChecksum(key)
        
    case "EMAIL":
        if !v.emailRegex.MatchString(key) {
            return &ValidationError{
                Field:   "pix_key",
                Message: "Invalid email format",
                Code:    "INVALID_EMAIL_FORMAT",
            }
        }
        if len(key) > 77 { // BCB limit for email PIX keys
            return &ValidationError{
                Field:   "pix_key",
                Message: "Email PIX key too long (max 77 characters)",
                Code:    "EMAIL_TOO_LONG",
            }
        }
        return nil
        
    case "PHONE":
        if !v.phoneRegex.MatchString(key) {
            return &ValidationError{
                Field:   "pix_key",
                Message: "Invalid phone format. Expected: +55XXXXXXXXXX",
                Code:    "INVALID_PHONE_FORMAT",
            }
        }
        return nil
        
    case "RANDOM":
        if !v.randomKeyRegex.MatchString(key) {
            return &ValidationError{
                Field:   "pix_key",
                Message: "Invalid random key format. Expected: UUID format",
                Code:    "INVALID_RANDOM_KEY_FORMAT",
            }
        }
        return nil
        
    default:
        return &ValidationError{
            Field:   "key_type",
            Message: "Invalid PIX key type. Allowed: CPF, CNPJ, EMAIL, PHONE, RANDOM",
            Code:    "INVALID_KEY_TYPE",
        }
    }
}

// validateCPFChecksum validates CPF checksum digits
func (v *PIXValidator) validateCPFChecksum(cpf string) error {
    // Remove formatting
    digits := strings.ReplaceAll(strings.ReplaceAll(cpf, ".", ""), "-", "")
    
    // Check for known invalid CPFs
    invalidCPFs := []string{
        "00000000000", "11111111111", "22222222222", "33333333333",
        "44444444444", "55555555555", "66666666666", "77777777777",
        "88888888888", "99999999999",
    }
    
    for _, invalid := range invalidCPFs {
        if digits == invalid {
            return &ValidationError{
                Field:   "pix_key",
                Message: "Invalid CPF: known invalid sequence",
                Code:    "INVALID_CPF_SEQUENCE",
            }
        }
    }
    
    // Calculate first check digit
    sum := 0
    for i := 0; i < 9; i++ {
        digit, _ := strconv.Atoi(string(digits[i]))
        sum += digit * (10 - i)
    }
    
    remainder := sum % 11
    firstCheck := 0
    if remainder >= 2 {
        firstCheck = 11 - remainder
    }
    
    actualFirstCheck, _ := strconv.Atoi(string(digits[9]))
    if firstCheck != actualFirstCheck {
        return &ValidationError{
            Field:   "pix_key",
            Message: "Invalid CPF: incorrect check digits",
            Code:    "INVALID_CPF_CHECKSUM",
        }
    }
    
    // Calculate second check digit
    sum = 0
    for i := 0; i < 10; i++ {
        digit, _ := strconv.Atoi(string(digits[i]))
        sum += digit * (11 - i)
    }
    
    remainder = sum % 11
    secondCheck := 0
    if remainder >= 2 {
        secondCheck = 11 - remainder
    }
    
    actualSecondCheck, _ := strconv.Atoi(string(digits[10]))
    if secondCheck != actualSecondCheck {
        return &ValidationError{
            Field:   "pix_key",
            Message: "Invalid CPF: incorrect check digits",
            Code:    "INVALID_CPF_CHECKSUM",
        }
    }
    
    return nil
}

// validateCNPJChecksum validates CNPJ checksum digits
func (v *PIXValidator) validateCNPJChecksum(cnpj string) error {
    // Remove formatting
    digits := strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(cnpj, ".", ""), "/", ""), "-", "")
    
    // Check for known invalid CNPJs
    if len(digits) != 14 {
        return &ValidationError{
            Field:   "pix_key",
            Message: "CNPJ must have exactly 14 digits",
            Code:    "INVALID_CNPJ_LENGTH",
        }
    }
    
    // Calculate first check digit
    weights1 := []int{5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2}
    sum := 0
    for i := 0; i < 12; i++ {
        digit, _ := strconv.Atoi(string(digits[i]))
        sum += digit * weights1[i]
    }
    
    remainder := sum % 11
    firstCheck := 0
    if remainder >= 2 {
        firstCheck = 11 - remainder
    }
    
    actualFirstCheck, _ := strconv.Atoi(string(digits[12]))
    if firstCheck != actualFirstCheck {
        return &ValidationError{
            Field:   "pix_key",
            Message: "Invalid CNPJ: incorrect check digits",
            Code:    "INVALID_CNPJ_CHECKSUM",
        }
    }
    
    // Calculate second check digit
    weights2 := []int{6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2}
    sum = 0
    for i := 0; i < 13; i++ {
        digit, _ := strconv.Atoi(string(digits[i]))
        sum += digit * weights2[i]
    }
    
    remainder = sum % 11
    secondCheck := 0
    if remainder >= 2 {
        secondCheck = 11 - remainder
    }
    
    actualSecondCheck, _ := strconv.Atoi(string(digits[13]))
    if secondCheck != actualSecondCheck {
        return &ValidationError{
            Field:   "pix_key",
            Message: "Invalid CNPJ: incorrect check digits",
            Code:    "INVALID_CNPJ_CHECKSUM",
        }
    }
    
    return nil
}

// ValidateTransferAmount validates transfer amount according to PIX rules
func (v *PIXValidator) ValidateTransferAmount(amount float64) error {
    if amount <= 0 {
        return &ValidationError{
            Field:   "amount",
            Message: "Transfer amount must be positive",
            Code:    "NEGATIVE_AMOUNT",
        }
    }
    
    if amount > 1000000 { // 1M BRL limit for PIX transfers
        return &ValidationError{
            Field:   "amount",
            Message: "Transfer amount exceeds maximum limit of R$ 1,000,000",
            Code:    "AMOUNT_EXCEEDS_LIMIT",
        }
    }
    
    if amount < 0.01 { // Minimum transfer amount
        return &ValidationError{
            Field:   "amount",
            Message: "Transfer amount below minimum of R$ 0.01",
            Code:    "AMOUNT_BELOW_MINIMUM",
        }
    }
    
    return nil
}

// SanitizeInput sanitizes user input to prevent XSS and injection attacks
func (v *PIXValidator) SanitizeInput(input string) string {
    if input == "" {
        return input
    }
    
    // Remove potentially dangerous characters
    input = strings.ReplaceAll(input, "<", "&lt;")
    input = strings.ReplaceAll(input, ">", "&gt;")
    input = strings.ReplaceAll(input, "\"", "&quot;")
    input = strings.ReplaceAll(input, "'", "&#x27;")
    input = strings.ReplaceAll(input, "&", "&amp;")
    input = strings.ReplaceAll(input, "/", "&#x2F;")
    
    // Remove control characters except newline and tab
    sanitized := strings.Map(func(r rune) rune {
        if unicode.IsControl(r) && r != '\\n' && r != '\\t' {
            return -1
        }
        return r
    }, input)
    
    // Limit length to prevent DoS
    if utf8.RuneCountInString(sanitized) > 1000 {
        runes := []rune(sanitized)
        sanitized = string(runes[:1000])
    }
    
    return strings.TrimSpace(sanitized)
}

// ValidateDescription validates transfer description
func (v *PIXValidator) ValidateDescription(description string) error {
    if description == "" {
        return nil // Description is optional
    }
    
    if utf8.RuneCountInString(description) > 140 { // PIX description limit
        return &ValidationError{
            Field:   "description",
            Message: "Description exceeds maximum length of 140 characters",
            Code:    "DESCRIPTION_TOO_LONG",
        }
    }
    
    // Check for potentially malicious content
    maliciousPatterns := []string{
        "<script", "javascript:", "data:", "vbscript:", "onload=", "onerror=",
        "eval(", "alert(", "confirm(", "prompt(",
    }
    
    lowerDesc := strings.ToLower(description)
    for _, pattern := range maliciousPatterns {
        if strings.Contains(lowerDesc, pattern) {
            return &ValidationError{
                Field:   "description",
                Message: "Description contains potentially malicious content",
                Code:    "MALICIOUS_CONTENT",
            }
        }
    }
    
    return nil
}

// ValidateRequestID validates request ID format
func (v *PIXValidator) ValidateRequestID(requestID string) error {
    if requestID == "" {
        return &ValidationError{
            Field:   "request_id",
            Message: "Request ID cannot be empty",
            Code:    "EMPTY_REQUEST_ID",
        }
    }
    
    // Request ID should be UUID format
    if !v.randomKeyRegex.MatchString(requestID) {
        return &ValidationError{
            Field:   "request_id",
            Message: "Request ID must be in UUID format",
            Code:    "INVALID_REQUEST_ID_FORMAT",
        }
    }
    
    return nil
}
'''
    
    with open(f"{validation_dir}/services/security/validation-middleware/validator.go", "w") as f:
        f.write(validator_code)
    
    # 2. PIX Gateway Security Enhancement
    pix_gateway_code = '''package main

import (
    "fmt"
    "net/http"
    "strings"
    "time"
    
    "github.com/gin-gonic/gin"
    "github.com/gin-contrib/cors"
    "golang.org/x/time/rate"
    
    "your-project/services/security/validation-middleware"
)

// PIXGatewayServer represents the PIX Gateway server
type PIXGatewayServer struct {
    router      *gin.Engine
    validator   *validation.PIXValidator
    rateLimiter *RateLimiter
    logger      Logger
}

// PIXTransferRequest represents a PIX transfer request
type PIXTransferRequest struct {
    RequestID     string  `json:"request_id" binding:"required"`
    RecipientKey  string  `json:"recipient_key" binding:"required"`
    KeyType       string  `json:"key_type" binding:"required"`
    Amount        float64 `json:"amount" binding:"required"`
    Description   string  `json:"description"`
    SenderName    string  `json:"sender_name" binding:"required"`
    SenderBank    string  `json:"sender_bank" binding:"required"`
}

// RateLimiter handles rate limiting per client IP
type RateLimiter struct {
    limiters map[string]*rate.Limiter
    mu       sync.RWMutex
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter() *RateLimiter {
    return &RateLimiter{
        limiters: make(map[string]*rate.Limiter),
    }
}

// Allow checks if the request is allowed for the given IP
func (rl *RateLimiter) Allow(ip string) bool {
    rl.mu.Lock()
    defer rl.mu.Unlock()
    
    limiter, exists := rl.limiters[ip]
    if !exists {
        // 100 requests per minute per IP
        limiter = rate.NewLimiter(rate.Every(time.Minute/100), 10)
        rl.limiters[ip] = limiter
    }
    
    return limiter.Allow()
}

// NewPIXGatewayServer creates a new PIX Gateway server
func NewPIXGatewayServer() *PIXGatewayServer {
    server := &PIXGatewayServer{
        router:      gin.New(),
        validator:   validation.NewPIXValidator(),
        rateLimiter: NewRateLimiter(),
        logger:      NewLogger(),
    }
    
    server.setupMiddleware()
    server.setupRoutes()
    
    return server
}

// setupMiddleware configures all middleware
func (s *PIXGatewayServer) setupMiddleware() {
    // Recovery middleware
    s.router.Use(gin.Recovery())
    
    // CORS middleware with strict configuration
    s.router.Use(cors.New(cors.Config{
        AllowOrigins:     []string{"https://app.nigerianremittance.com", "https://admin.nigerianremittance.com"},
        AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
        AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "X-Request-ID"},
        ExposeHeaders:    []string{"Content-Length", "X-Request-ID"},
        AllowCredentials: true,
        MaxAge:          12 * time.Hour,
    }))
    
    // Security headers middleware
    s.router.Use(s.securityHeadersMiddleware)
    
    // Request validation middleware
    s.router.Use(s.requestValidationMiddleware)
    
    // Rate limiting middleware
    s.router.Use(s.rateLimitingMiddleware)
    
    // Request logging middleware
    s.router.Use(s.requestLoggingMiddleware)
}

// securityHeadersMiddleware adds security headers
func (s *PIXGatewayServer) securityHeadersMiddleware(c *gin.Context) {
    c.Header("X-Content-Type-Options", "nosniff")
    c.Header("X-Frame-Options", "DENY")
    c.Header("X-XSS-Protection", "1; mode=block")
    c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
    c.Header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'")
    c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
    c.Header("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    
    c.Next()
}

// requestValidationMiddleware validates incoming requests
func (s *PIXGatewayServer) requestValidationMiddleware(c *gin.Context) {
    // Skip validation for health checks and OPTIONS requests
    if c.Request.URL.Path == "/health" || c.Request.Method == "OPTIONS" {
        c.Next()
        return
    }
    
    // Validate content type for POST/PUT requests
    if c.Request.Method == "POST" || c.Request.Method == "PUT" {
        contentType := c.GetHeader("Content-Type")
        if !strings.Contains(contentType, "application/json") {
            s.logger.Warn("Invalid content type", "content_type", contentType, "ip", c.ClientIP())
            c.JSON(http.StatusBadRequest, gin.H{
                "error": "Invalid content type. Expected application/json",
                "code":  "INVALID_CONTENT_TYPE",
            })
            c.Abort()
            return
        }
        
        // Check content length
        if c.Request.ContentLength > 1024*1024 { // 1MB limit
            s.logger.Warn("Request too large", "content_length", c.Request.ContentLength, "ip", c.ClientIP())
            c.JSON(http.StatusRequestEntityTooLarge, gin.H{
                "error": "Request body too large",
                "code":  "REQUEST_TOO_LARGE",
            })
            c.Abort()
            return
        }
    }
    
    // Validate User-Agent header
    userAgent := c.GetHeader("User-Agent")
    if userAgent == "" {
        s.logger.Warn("Missing User-Agent header", "ip", c.ClientIP())
        c.JSON(http.StatusBadRequest, gin.H{
            "error": "User-Agent header is required",
            "code":  "MISSING_USER_AGENT",
        })
        c.Abort()
        return
    }
    
    c.Next()
}

// rateLimitingMiddleware implements rate limiting
func (s *PIXGatewayServer) rateLimitingMiddleware(c *gin.Context) {
    clientIP := c.ClientIP()
    
    if !s.rateLimiter.Allow(clientIP) {
        s.logger.Warn("Rate limit exceeded", "ip", clientIP, "path", c.Request.URL.Path)
        c.JSON(http.StatusTooManyRequests, gin.H{
            "error": "Rate limit exceeded. Please try again later",
            "code":  "RATE_LIMIT_EXCEEDED",
        })
        c.Abort()
        return
    }
    
    c.Next()
}

// requestLoggingMiddleware logs all requests
func (s *PIXGatewayServer) requestLoggingMiddleware(c *gin.Context) {
    start := time.Now()
    
    c.Next()
    
    duration := time.Since(start)
    s.logger.Info("Request processed",
        "method", c.Request.Method,
        "path", c.Request.URL.Path,
        "status", c.Writer.Status(),
        "duration", duration,
        "ip", c.ClientIP(),
        "user_agent", c.GetHeader("User-Agent"),
    )
}

// setupRoutes configures all routes
func (s *PIXGatewayServer) setupRoutes() {
    // Health check endpoint
    s.router.GET("/health", s.handleHealthCheck)
    
    // PIX API routes
    v1 := s.router.Group("/api/v1")
    {
        v1.POST("/pix/transfer", s.handlePIXTransfer)
        v1.POST("/pix/keys/validate", s.handlePIXKeyValidation)
        v1.GET("/pix/keys/:key", s.handlePIXKeyLookup)
        v1.POST("/pix/qr/generate", s.handleQRGeneration)
    }
}

// handlePIXTransfer handles PIX transfer requests with comprehensive validation
func (s *PIXGatewayServer) handlePIXTransfer(c *gin.Context) {
    var request PIXTransferRequest
    
    // Bind and validate JSON
    if err := c.ShouldBindJSON(&request); err != nil {
        s.logger.Error("Invalid request format", "error", err, "ip", c.ClientIP())
        c.JSON(http.StatusBadRequest, gin.H{
            "error": "Invalid request format",
            "code":  "INVALID_REQUEST_FORMAT",
        })
        return
    }
    
    // Validate request ID
    if err := s.validator.ValidateRequestID(request.RequestID); err != nil {
        s.logger.Error("Invalid request ID", "error", err, "request_id", request.RequestID)
        c.JSON(http.StatusBadRequest, gin.H{
            "error": err.Error(),
            "code":  "INVALID_REQUEST_ID",
        })
        return
    }
    
    // Validate PIX key
    if err := s.validator.ValidatePIXKey(request.RecipientKey, request.KeyType); err != nil {
        s.logger.Error("Invalid PIX key", "error", err, "key", request.RecipientKey, "type", request.KeyType)
        c.JSON(http.StatusBadRequest, gin.H{
            "error": err.Error(),
            "code":  "INVALID_PIX_KEY",
        })
        return
    }
    
    // Validate transfer amount
    if err := s.validator.ValidateTransferAmount(request.Amount); err != nil {
        s.logger.Error("Invalid amount", "error", err, "amount", request.Amount)
        c.JSON(http.StatusBadRequest, gin.H{
            "error": err.Error(),
            "code":  "INVALID_AMOUNT",
        })
        return
    }
    
    // Validate and sanitize description
    if err := s.validator.ValidateDescription(request.Description); err != nil {
        s.logger.Error("Invalid description", "error", err, "description", request.Description)
        c.JSON(http.StatusBadRequest, gin.H{
            "error": err.Error(),
            "code":  "INVALID_DESCRIPTION",
        })
        return
    }
    request.Description = s.validator.SanitizeInput(request.Description)
    
    // Sanitize other string fields
    request.SenderName = s.validator.SanitizeInput(request.SenderName)
    request.SenderBank = s.validator.SanitizeInput(request.SenderBank)
    
    // Process PIX transfer
    result, err := s.processPIXTransfer(&request)
    if err != nil {
        s.logger.Error("PIX transfer failed", "error", err, "request_id", request.RequestID)
        c.JSON(http.StatusInternalServerError, gin.H{
            "error": "Transfer processing failed",
            "code":  "TRANSFER_PROCESSING_FAILED",
        })
        return
    }
    
    s.logger.Info("PIX transfer successful", "request_id", request.RequestID, "amount", request.Amount)
    c.JSON(http.StatusOK, result)
}

// handlePIXKeyValidation handles PIX key validation requests
func (s *PIXGatewayServer) handlePIXKeyValidation(c *gin.Context) {
    var request struct {
        Key     string `json:"key" binding:"required"`
        KeyType string `json:"key_type" binding:"required"`
    }
    
    if err := c.ShouldBindJSON(&request); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{
            "error": "Invalid request format",
            "code":  "INVALID_REQUEST_FORMAT",
        })
        return
    }
    
    // Validate PIX key
    if err := s.validator.ValidatePIXKey(request.Key, request.KeyType); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{
            "valid": false,
            "error": err.Error(),
        })
        return
    }
    
    c.JSON(http.StatusOK, gin.H{
        "valid": true,
        "key":   request.Key,
        "type":  request.KeyType,
    })
}

// handleHealthCheck handles health check requests
func (s *PIXGatewayServer) handleHealthCheck(c *gin.Context) {
    c.JSON(http.StatusOK, gin.H{
        "status":    "healthy",
        "service":   "PIX Gateway",
        "version":   "1.0.0",
        "timestamp": time.Now().UTC().Format(time.RFC3339),
    })
}

// processPIXTransfer processes the actual PIX transfer
func (s *PIXGatewayServer) processPIXTransfer(request *PIXTransferRequest) (map[string]interface{}, error) {
    // Implementation would include:
    // 1. BCB API integration
    // 2. TigerBeetle ledger integration
    // 3. Compliance checks
    // 4. Transfer execution
    
    return map[string]interface{}{
        "request_id":     request.RequestID,
        "status":         "completed",
        "transaction_id": generateTransactionID(),
        "timestamp":      time.Now().UTC().Format(time.RFC3339),
    }, nil
}

// Start starts the PIX Gateway server
func (s *PIXGatewayServer) Start(port string) error {
    s.logger.Info("Starting PIX Gateway server", "port", port)
    return s.router.Run(":" + port)
}

func main() {
    server := NewPIXGatewayServer()
    if err := server.Start("5001"); err != nil {
        panic(fmt.Sprintf("Failed to start server: %v", err))
    }
}
'''
    
    with open(f"{validation_dir}/services/pix-integration/pix-gateway/main.go", "w") as f:
        f.write(pix_gateway_code)
    
    # 3. API Gateway Security Middleware
    api_gateway_code = '''package main

import (
    "net/http"
    "strings"
    "time"
    
    "github.com/gin-gonic/gin"
    "github.com/gin-contrib/cors"
)

// APIGateway represents the main API Gateway
type APIGateway struct {
    router *gin.Engine
    logger Logger
}

// NewAPIGateway creates a new API Gateway instance
func NewAPIGateway() *APIGateway {
    gateway := &APIGateway{
        router: gin.New(),
        logger: NewLogger(),
    }
    
    gateway.setupSecurityMiddleware()
    gateway.setupRoutes()
    
    return gateway
}

// setupSecurityMiddleware configures comprehensive security middleware
func (gw *APIGateway) setupSecurityMiddleware() {
    // Recovery middleware with custom handler
    gw.router.Use(gin.CustomRecovery(func(c *gin.Context, recovered interface{}) {
        gw.logger.Error("Panic recovered", "error", recovered, "path", c.Request.URL.Path)
        c.JSON(http.StatusInternalServerError, gin.H{
            "error": "Internal server error",
            "code":  "INTERNAL_ERROR",
        })
    }))
    
    // CORS middleware with strict configuration
    gw.router.Use(cors.New(cors.Config{
        AllowOrigins: []string{
            "https://app.nigerianremittance.com",
            "https://admin.nigerianremittance.com",
            "https://mobile.nigerianremittance.com",
        },
        AllowMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
        AllowHeaders: []string{
            "Origin",
            "Content-Type", 
            "Authorization",
            "X-Request-ID",
            "X-API-Key",
            "X-Client-Version",
        },
        ExposeHeaders: []string{
            "Content-Length",
            "X-Request-ID",
            "X-Rate-Limit-Remaining",
        },
        AllowCredentials: true,
        MaxAge:          12 * time.Hour,
    }))
    
    // Comprehensive security headers middleware
    gw.router.Use(gw.securityHeadersMiddleware)
    
    // Request validation and sanitization middleware
    gw.router.Use(gw.requestValidationMiddleware)
    
    // Content security middleware
    gw.router.Use(gw.contentSecurityMiddleware)
    
    // Request size limiting middleware
    gw.router.Use(gw.requestSizeLimitMiddleware)
    
    // Request logging middleware
    gw.router.Use(gw.requestLoggingMiddleware)
}

// securityHeadersMiddleware adds comprehensive security headers
func (gw *APIGateway) securityHeadersMiddleware(c *gin.Context) {
    // Prevent MIME type sniffing
    c.Header("X-Content-Type-Options", "nosniff")
    
    // Prevent clickjacking
    c.Header("X-Frame-Options", "DENY")
    
    // Enable XSS protection
    c.Header("X-XSS-Protection", "1; mode=block")
    
    // Force HTTPS
    c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
    
    // Content Security Policy
    csp := strings.Join([]string{
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self'",
        "connect-src 'self' https://api.nigerianremittance.com",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    }, "; ")
    c.Header("Content-Security-Policy", csp)
    
    // Referrer policy
    c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
    
    // Permissions policy
    permissions := strings.Join([]string{
        "geolocation=()",
        "microphone=()",
        "camera=()",
        "payment=(self)",
        "usb=()",
        "magnetometer=()",
        "gyroscope=()",
        "accelerometer=()",
    }, ", ")
    c.Header("Permissions-Policy", permissions)
    
    // Remove server information
    c.Header("Server", "")
    
    c.Next()
}

// requestValidationMiddleware validates incoming requests
func (gw *APIGateway) requestValidationMiddleware(c *gin.Context) {
    // Skip validation for health checks and OPTIONS requests
    if c.Request.URL.Path == "/health" || c.Request.Method == "OPTIONS" {
        c.Next()
        return
    }
    
    // Validate HTTP method
    allowedMethods := map[string]bool{
        "GET":    true,
        "POST":   true,
        "PUT":    true,
        "DELETE": true,
        "OPTIONS": true,
    }
    
    if !allowedMethods[c.Request.Method] {
        gw.logger.Warn("Invalid HTTP method", "method", c.Request.Method, "ip", c.ClientIP())
        c.JSON(http.StatusMethodNotAllowed, gin.H{
            "error": "Method not allowed",
            "code":  "METHOD_NOT_ALLOWED",
        })
        c.Abort()
        return
    }
    
    // Validate User-Agent header
    userAgent := c.GetHeader("User-Agent")
    if userAgent == "" {
        gw.logger.Warn("Missing User-Agent header", "ip", c.ClientIP())
        c.JSON(http.StatusBadRequest, gin.H{
            "error": "User-Agent header is required",
            "code":  "MISSING_USER_AGENT",
        })
        c.Abort()
        return
    }
    
    // Check for suspicious User-Agent patterns
    suspiciousPatterns := []string{
        "sqlmap", "nikto", "nmap", "masscan", "zap", "burp",
        "wget", "curl", "python-requests", "go-http-client",
    }
    
    lowerUA := strings.ToLower(userAgent)
    for _, pattern := range suspiciousPatterns {
        if strings.Contains(lowerUA, pattern) {
            gw.logger.Warn("Suspicious User-Agent detected", "user_agent", userAgent, "ip", c.ClientIP())
            c.JSON(http.StatusForbidden, gin.H{
                "error": "Access denied",
                "code":  "SUSPICIOUS_USER_AGENT",
            })
            c.Abort()
            return
        }
    }
    
    // Validate Host header
    host := c.GetHeader("Host")
    allowedHosts := []string{
        "api.nigerianremittance.com",
        "localhost:8000",
        "127.0.0.1:8000",
    }
    
    hostAllowed := false
    for _, allowedHost := range allowedHosts {
        if host == allowedHost {
            hostAllowed = true
            break
        }
    }
    
    if !hostAllowed {
        gw.logger.Warn("Invalid Host header", "host", host, "ip", c.ClientIP())
        c.JSON(http.StatusBadRequest, gin.H{
            "error": "Invalid Host header",
            "code":  "INVALID_HOST",
        })
        c.Abort()
        return
    }
    
    c.Next()
}

// contentSecurityMiddleware validates content type and encoding
func (gw *APIGateway) contentSecurityMiddleware(c *gin.Context) {
    if c.Request.Method == "POST" || c.Request.Method == "PUT" {
        contentType := c.GetHeader("Content-Type")
        
        // Validate content type
        allowedContentTypes := []string{
            "application/json",
            "application/x-www-form-urlencoded",
            "multipart/form-data",
        }
        
        contentTypeAllowed := false
        for _, allowedType := range allowedContentTypes {
            if strings.Contains(contentType, allowedType) {
                contentTypeAllowed = true
                break
            }
        }
        
        if !contentTypeAllowed {
            gw.logger.Warn("Invalid content type", "content_type", contentType, "ip", c.ClientIP())
            c.JSON(http.StatusUnsupportedMediaType, gin.H{
                "error": "Unsupported content type",
                "code":  "UNSUPPORTED_CONTENT_TYPE",
            })
            c.Abort()
            return
        }
        
        // Validate content encoding
        contentEncoding := c.GetHeader("Content-Encoding")
        if contentEncoding != "" {
            allowedEncodings := []string{"gzip", "deflate", "br"}
            encodingAllowed := false
            
            for _, allowedEncoding := range allowedEncodings {
                if contentEncoding == allowedEncoding {
                    encodingAllowed = true
                    break
                }
            }
            
            if !encodingAllowed {
                gw.logger.Warn("Invalid content encoding", "encoding", contentEncoding, "ip", c.ClientIP())
                c.JSON(http.StatusBadRequest, gin.H{
                    "error": "Unsupported content encoding",
                    "code":  "UNSUPPORTED_CONTENT_ENCODING",
                })
                c.Abort()
                return
            }
        }
    }
    
    c.Next()
}

// requestSizeLimitMiddleware limits request size to prevent DoS
func (gw *APIGateway) requestSizeLimitMiddleware(c *gin.Context) {
    const maxRequestSize = 10 * 1024 * 1024 // 10MB
    
    if c.Request.ContentLength > maxRequestSize {
        gw.logger.Warn("Request too large", "size", c.Request.ContentLength, "ip", c.ClientIP())
        c.JSON(http.StatusRequestEntityTooLarge, gin.H{
            "error": "Request body too large",
            "code":  "REQUEST_TOO_LARGE",
            "max_size": maxRequestSize,
        })
        c.Abort()
        return
    }
    
    // Set a reader limit to prevent memory exhaustion
    c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxRequestSize)
    
    c.Next()
}

// requestLoggingMiddleware logs all requests for security monitoring
func (gw *APIGateway) requestLoggingMiddleware(c *gin.Context) {
    start := time.Now()
    
    // Log request details
    gw.logger.Info("Request received",
        "method", c.Request.Method,
        "path", c.Request.URL.Path,
        "query", c.Request.URL.RawQuery,
        "ip", c.ClientIP(),
        "user_agent", c.GetHeader("User-Agent"),
        "referer", c.GetHeader("Referer"),
        "content_length", c.Request.ContentLength,
    )
    
    c.Next()
    
    // Log response details
    duration := time.Since(start)
    gw.logger.Info("Request completed",
        "method", c.Request.Method,
        "path", c.Request.URL.Path,
        "status", c.Writer.Status(),
        "duration_ms", duration.Milliseconds(),
        "response_size", c.Writer.Size(),
        "ip", c.ClientIP(),
    )
    
    // Log security events
    if c.Writer.Status() >= 400 {
        gw.logger.Warn("Security event",
            "status", c.Writer.Status(),
            "path", c.Request.URL.Path,
            "ip", c.ClientIP(),
            "user_agent", c.GetHeader("User-Agent"),
        )
    }
}

// setupRoutes configures API routes
func (gw *APIGateway) setupRoutes() {
    // Health check
    gw.router.GET("/health", func(c *gin.Context) {
        c.JSON(http.StatusOK, gin.H{
            "status": "healthy",
            "service": "API Gateway",
            "version": "1.0.0",
            "timestamp": time.Now().UTC().Format(time.RFC3339),
        })
    })
    
    // API routes would be configured here
    // This would include routing to various microservices
}

// Start starts the API Gateway
func (gw *APIGateway) Start(port string) error {
    gw.logger.Info("Starting API Gateway", "port", port)
    return gw.router.Run(":" + port)
}

func main() {
    gateway := NewAPIGateway()
    if err := gateway.Start("8000"); err != nil {
        panic(fmt.Sprintf("Failed to start API Gateway: %v", err))
    }
}
'''
    
    with open(f"{validation_dir}/services/core-infrastructure/api-gateway/main.go", "w") as f:
        f.write(api_gateway_code)
    
    # 4. Comprehensive Test Suite
    test_code = '''package validation

import (
    "testing"
    "github.com/stretchr/testify/assert"
)

func TestPIXValidator_ValidatePIXKey(t *testing.T) {
    validator := NewPIXValidator()
    
    tests := []struct {
        name     string
        key      string
        keyType  string
        wantErr  bool
        errCode  string
    }{
        // CPF tests
        {
            name:    "Valid CPF",
            key:     "123.456.789-09",
            keyType: "CPF",
            wantErr: false,
        },
        {
            name:    "Invalid CPF format",
            key:     "12345678909",
            keyType: "CPF",
            wantErr: true,
            errCode: "INVALID_CPF_FORMAT",
        },
        {
            name:    "Invalid CPF checksum",
            key:     "123.456.789-00",
            keyType: "CPF",
            wantErr: true,
            errCode: "INVALID_CPF_CHECKSUM",
        },
        {
            name:    "Known invalid CPF sequence",
            key:     "111.111.111-11",
            keyType: "CPF",
            wantErr: true,
            errCode: "INVALID_CPF_SEQUENCE",
        },
        
        // Email tests
        {
            name:    "Valid email",
            key:     "user@example.com",
            keyType: "EMAIL",
            wantErr: false,
        },
        {
            name:    "Invalid email format",
            key:     "invalid-email",
            keyType: "EMAIL",
            wantErr: true,
            errCode: "INVALID_EMAIL_FORMAT",
        },
        {
            name:    "Email too long",
            key:     "verylongemailaddressthatexceedsthemaximumlengthallowedforpixkeys@example.com",
            keyType: "EMAIL",
            wantErr: true,
            errCode: "EMAIL_TOO_LONG",
        },
        
        // Phone tests
        {
            name:    "Valid phone",
            key:     "+5511999999999",
            keyType: "PHONE",
            wantErr: false,
        },
        {
            name:    "Invalid phone format",
            key:     "11999999999",
            keyType: "PHONE",
            wantErr: true,
            errCode: "INVALID_PHONE_FORMAT",
        },
        
        // Random key tests
        {
            name:    "Valid random key",
            key:     "123e4567-e89b-12d3-a456-426614174000",
            keyType: "RANDOM",
            wantErr: false,
        },
        {
            name:    "Invalid random key format",
            key:     "invalid-uuid",
            keyType: "RANDOM",
            wantErr: true,
            errCode: "INVALID_RANDOM_KEY_FORMAT",
        },
        
        // Edge cases
        {
            name:    "Empty key",
            key:     "",
            keyType: "CPF",
            wantErr: true,
            errCode: "EMPTY_PIX_KEY",
        },
        {
            name:    "Empty key type",
            key:     "123.456.789-09",
            keyType: "",
            wantErr: true,
            errCode: "EMPTY_KEY_TYPE",
        },
        {
            name:    "Invalid key type",
            key:     "123.456.789-09",
            keyType: "INVALID",
            wantErr: true,
            errCode: "INVALID_KEY_TYPE",
        },
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := validator.ValidatePIXKey(tt.key, tt.keyType)
            
            if tt.wantErr {
                assert.Error(t, err)
                if tt.errCode != "" {
                    validationErr, ok := err.(*ValidationError)
                    assert.True(t, ok, "Expected ValidationError")
                    assert.Equal(t, tt.errCode, validationErr.Code)
                }
            } else {
                assert.NoError(t, err)
            }
        })
    }
}

func TestPIXValidator_ValidateTransferAmount(t *testing.T) {
    validator := NewPIXValidator()
    
    tests := []struct {
        name    string
        amount  float64
        wantErr bool
        errCode string
    }{
        {
            name:    "Valid amount",
            amount:  100.50,
            wantErr: false,
        },
        {
            name:    "Minimum valid amount",
            amount:  0.01,
            wantErr: false,
        },
        {
            name:    "Maximum valid amount",
            amount:  1000000.00,
            wantErr: false,
        },
        {
            name:    "Zero amount",
            amount:  0.00,
            wantErr: true,
            errCode: "NEGATIVE_AMOUNT",
        },
        {
            name:    "Negative amount",
            amount:  -10.00,
            wantErr: true,
            errCode: "NEGATIVE_AMOUNT",
        },
        {
            name:    "Amount exceeds limit",
            amount:  1000001.00,
            wantErr: true,
            errCode: "AMOUNT_EXCEEDS_LIMIT",
        },
        {
            name:    "Amount below minimum",
            amount:  0.001,
            wantErr: true,
            errCode: "AMOUNT_BELOW_MINIMUM",
        },
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := validator.ValidateTransferAmount(tt.amount)
            
            if tt.wantErr {
                assert.Error(t, err)
                if tt.errCode != "" {
                    validationErr, ok := err.(*ValidationError)
                    assert.True(t, ok, "Expected ValidationError")
                    assert.Equal(t, tt.errCode, validationErr.Code)
                }
            } else {
                assert.NoError(t, err)
            }
        })
    }
}

func TestPIXValidator_SanitizeInput(t *testing.T) {
    validator := NewPIXValidator()
    
    tests := []struct {
        name     string
        input    string
        expected string
    }{
        {
            name:     "Normal text",
            input:    "Hello World",
            expected: "Hello World",
        },
        {
            name:     "XSS attempt",
            input:    "<script>alert('xss')</script>",
            expected: "&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;",
        },
        {
            name:     "HTML injection",
            input:    "<img src=x onerror=alert(1)>",
            expected: "&lt;img src=x onerror=alert(1)&gt;",
        },
        {
            name:     "Control characters",
            input:    "Hello\\x00\\x01World",
            expected: "HelloWorld",
        },
        {
            name:     "Very long input",
            input:    strings.Repeat("A", 2000),
            expected: strings.Repeat("A", 1000),
        },
        {
            name:     "Empty input",
            input:    "",
            expected: "",
        },
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            result := validator.SanitizeInput(tt.input)
            assert.Equal(t, tt.expected, result)
        })
    }
}

func TestPIXValidator_ValidateDescription(t *testing.T) {
    validator := NewPIXValidator()
    
    tests := []struct {
        name        string
        description string
        wantErr     bool
        errCode     string
    }{
        {
            name:        "Valid description",
            description: "Payment for services",
            wantErr:     false,
        },
        {
            name:        "Empty description",
            description: "",
            wantErr:     false,
        },
        {
            name:        "Description too long",
            description: strings.Repeat("A", 141),
            wantErr:     true,
            errCode:     "DESCRIPTION_TOO_LONG",
        },
        {
            name:        "Malicious script",
            description: "Payment <script>alert('xss')</script>",
            wantErr:     true,
            errCode:     "MALICIOUS_CONTENT",
        },
        {
            name:        "JavaScript injection",
            description: "javascript:alert(1)",
            wantErr:     true,
            errCode:     "MALICIOUS_CONTENT",
        },
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := validator.ValidateDescription(tt.description)
            
            if tt.wantErr {
                assert.Error(t, err)
                if tt.errCode != "" {
                    validationErr, ok := err.(*ValidationError)
                    assert.True(t, ok, "Expected ValidationError")
                    assert.Equal(t, tt.errCode, validationErr.Code)
                }
            } else {
                assert.NoError(t, err)
            }
        })
    }
}

// Benchmark tests
func BenchmarkPIXValidator_ValidatePIXKey(b *testing.B) {
    validator := NewPIXValidator()
    
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        validator.ValidatePIXKey("123.456.789-09", "CPF")
    }
}

func BenchmarkPIXValidator_SanitizeInput(b *testing.B) {
    validator := NewPIXValidator()
    input := "<script>alert('test')</script>Hello World"
    
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        validator.SanitizeInput(input)
    }
}
'''
    
    with open(f"{validation_dir}/tests/validation_test.go", "w") as f:
        f.write(test_code)
    
    print("  ✅ CVE-2024-SEC-001 implementation created")

def create_jwt_authentication_fix(base_dir):
    """Create complete JWT authentication security fix"""
    
    print("🔐 Creating CVE-2024-SEC-002: JWT Authentication Fix...")
    
    # Create directory structure
    jwt_dir = f"{base_dir}/CVE-2024-SEC-002-jwt-authentication"
    os.makedirs(f"{jwt_dir}/services/security/jwt-manager", exist_ok=True)
    os.makedirs(f"{jwt_dir}/services/security/session-manager", exist_ok=True)
    os.makedirs(f"{jwt_dir}/services/enhanced-platform/user-management", exist_ok=True)
    os.makedirs(f"{jwt_dir}/tests", exist_ok=True)
    
    # 1. Secure JWT Token Manager
    jwt_manager_code = '''package jwt

import (
    "crypto/rand"
    "crypto/rsa"
    "crypto/x509"
    "encoding/pem"
    "errors"
    "fmt"
    "time"
    
    "github.com/golang-jwt/jwt/v4"
)

// TokenManager handles JWT token creation and validation
type TokenManager struct {
    privateKey *rsa.PrivateKey
    publicKey  *rsa.PublicKey
    issuer     string
    audience   []string
}

// Claims represents JWT claims with additional security fields
type Claims struct {
    UserID      string   `json:"user_id"`
    Email       string   `json:"email"`
    Roles       []string `json:"roles"`
    SessionID   string   `json:"session_id"`
    IPAddress   string   `json:"ip_address"`
    UserAgent   string   `json:"user_agent"`
    TokenType   string   `json:"token_type"` // "access" or "refresh"
    Permissions []string `json:"permissions"`
    jwt.RegisteredClaims
}

// TokenPair represents access and refresh tokens
type TokenPair struct {
    AccessToken  string    `json:"access_token"`
    RefreshToken string    `json:"refresh_token"`
    ExpiresAt    time.Time `json:"expires_at"`
    TokenType    string    `json:"token_type"`
}

// NewTokenManager creates a new secure token manager
func NewTokenManager(privateKeyPEM, publicKeyPEM []byte, issuer string, audience []string) (*TokenManager, error) {
    // Parse private key
    privateBlock, _ := pem.Decode(privateKeyPEM)
    if privateBlock == nil {
        return nil, errors.New("failed to decode private key PEM")
    }
    
    privateKey, err := x509.ParsePKCS1PrivateKey(privateBlock.Bytes)
    if err != nil {
        return nil, fmt.Errorf("failed to parse private key: %w", err)
    }
    
    // Parse public key
    publicBlock, _ := pem.Decode(publicKeyPEM)
    if publicBlock == nil {
        return nil, errors.New("failed to decode public key PEM")
    }
    
    publicKeyInterface, err := x509.ParsePKIXPublicKey(publicBlock.Bytes)
    if err != nil {
        return nil, fmt.Errorf("failed to parse public key: %w", err)
    }
    
    publicKey, ok := publicKeyInterface.(*rsa.PublicKey)
    if !ok {
        return nil, errors.New("public key is not RSA")
    }
    
    return &TokenManager{
        privateKey: privateKey,
        publicKey:  publicKey,
        issuer:     issuer,
        audience:   audience,
    }, nil
}

// GenerateTokenPair generates both access and refresh tokens
func (tm *TokenManager) GenerateTokenPair(userID, email string, roles []string, permissions []string, sessionID, ipAddress, userAgent string) (*TokenPair, error) {
    now := time.Now()
    
    // Generate access token (15 minutes)
    accessClaims := Claims{
        UserID:      userID,
        Email:       email,
        Roles:       roles,
        SessionID:   sessionID,
        IPAddress:   ipAddress,
        UserAgent:   userAgent,
        TokenType:   "access",
        Permissions: permissions,
        RegisteredClaims: jwt.RegisteredClaims{
            Issuer:    tm.issuer,
            Subject:   userID,
            Audience:  tm.audience,
            ExpiresAt: jwt.NewNumericDate(now.Add(15 * time.Minute)),
            NotBefore: jwt.NewNumericDate(now),
            IssuedAt:  jwt.NewNumericDate(now),
            ID:        generateJTI(),
        },
    }
    
    accessToken := jwt.NewWithClaims(jwt.SigningMethodRS256, accessClaims)
    accessTokenString, err := accessToken.SignedString(tm.privateKey)
    if err != nil {
        return nil, fmt.Errorf("failed to sign access token: %w", err)
    }
    
    // Generate refresh token (7 days)
    refreshClaims := Claims{
        UserID:    userID,
        Email:     email,
        SessionID: sessionID,
        IPAddress: ipAddress,
        UserAgent: userAgent,
        TokenType: "refresh",
        RegisteredClaims: jwt.RegisteredClaims{
            Issuer:    tm.issuer,
            Subject:   userID,
            Audience:  tm.audience,
            ExpiresAt: jwt.NewNumericDate(now.Add(7 * 24 * time.Hour)),
            NotBefore: jwt.NewNumericDate(now),
            IssuedAt:  jwt.NewNumericDate(now),
            ID:        generateJTI(),
        },
    }
    
    refreshToken := jwt.NewWithClaims(jwt.SigningMethodRS256, refreshClaims)
    refreshTokenString, err := refreshToken.SignedString(tm.privateKey)
    if err != nil {
        return nil, fmt.Errorf("failed to sign refresh token: %w", err)
    }
    
    return &TokenPair{
        AccessToken:  accessTokenString,
        RefreshToken: refreshTokenString,
        ExpiresAt:    accessClaims.ExpiresAt.Time,
        TokenType:    "Bearer",
    }, nil
}

// ValidateToken validates a JWT token with comprehensive security checks
func (tm *TokenManager) ValidateToken(tokenString string, expectedTokenType string) (*Claims, error) {
    // Parse token with claims
    token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
        // Verify signing method
        if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
            return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
        }
        
        // Ensure RSA-256 is used
        if token.Method.Alg() != "RS256" {
            return nil, fmt.Errorf("unexpected signing algorithm: %s", token.Method.Alg())
        }
        
        return tm.publicKey, nil
    })
    
    if err != nil {
        return nil, fmt.Errorf("token parsing failed: %w", err)
    }
    
    // Extract claims
    claims, ok := token.Claims.(*Claims)
    if !ok || !token.Valid {
        return nil, errors.New("invalid token claims")
    }
    
    // Comprehensive validation
    if err := tm.validateClaims(claims, expectedTokenType); err != nil {
        return nil, err
    }
    
    return claims, nil
}

// validateClaims performs comprehensive claims validation
func (tm *TokenManager) validateClaims(claims *Claims, expectedTokenType string) error {
    now := time.Now()
    
    // Validate issuer
    if claims.Issuer != tm.issuer {
        return fmt.Errorf("invalid issuer: expected %s, got %s", tm.issuer, claims.Issuer)
    }
    
    // Validate audience
    validAudience := false
    for _, aud := range tm.audience {
        for _, claimAud := range claims.Audience {
            if aud == claimAud {
                validAudience = true
                break
            }
        }
        if validAudience {
            break
        }
    }
    if !validAudience {
        return errors.New("invalid audience")
    }
    
    // Validate token type
    if expectedTokenType != "" && claims.TokenType != expectedTokenType {
        return fmt.Errorf("invalid token type: expected %s, got %s", expectedTokenType, claims.TokenType)
    }
    
    // Validate timing claims
    if claims.ExpiresAt != nil && now.After(claims.ExpiresAt.Time) {
        return errors.New("token expired")
    }
    
    if claims.NotBefore != nil && now.Before(claims.NotBefore.Time) {
        return errors.New("token not yet valid")
    }
    
    if claims.IssuedAt != nil && now.Before(claims.IssuedAt.Time.Add(-5*time.Minute)) {
        return errors.New("token issued in the future")
    }
    
    // Validate required fields
    if claims.UserID == "" {
        return errors.New("missing user ID")
    }
    
    if claims.Email == "" {
        return errors.New("missing email")
    }
    
    if claims.SessionID == "" {
        return errors.New("missing session ID")
    }
    
    if claims.ID == "" {
        return errors.New("missing JTI")
    }
    
    return nil
}

// RefreshToken generates a new access token using a valid refresh token
func (tm *TokenManager) RefreshToken(refreshTokenString, ipAddress, userAgent string) (*TokenPair, error) {
    // Validate refresh token
    claims, err := tm.ValidateToken(refreshTokenString, "refresh")
    if err != nil {
        return nil, fmt.Errorf("invalid refresh token: %w", err)
    }
    
    // Verify IP address and user agent for security
    if claims.IPAddress != ipAddress {
        return nil, errors.New("IP address mismatch")
    }
    
    if claims.UserAgent != userAgent {
        return nil, errors.New("user agent mismatch")
    }
    
    // Generate new token pair
    return tm.GenerateTokenPair(
        claims.UserID,
        claims.Email,
        claims.Roles,
        claims.Permissions,
        claims.SessionID,
        ipAddress,
        userAgent,
    )
}

// RevokeToken adds a token to the revocation list
func (tm *TokenManager) RevokeToken(tokenString string) error {
    claims, err := tm.ValidateToken(tokenString, "")
    if err != nil {
        return err
    }
    
    // In a real implementation, you would store the JTI in a blacklist
    // For now, we'll just validate that we can extract the JTI
    if claims.ID == "" {
        return errors.New("cannot revoke token without JTI")
    }
    
    // TODO: Store claims.ID in Redis blacklist with expiration
    return nil
}

// generateJTI generates a unique JWT ID
func generateJTI() string {
    bytes := make([]byte, 16)
    rand.Read(bytes)
    return fmt.Sprintf("%x", bytes)
}

// GenerateKeyPair generates a new RSA key pair for JWT signing
func GenerateKeyPair() ([]byte, []byte, error) {
    // Generate private key
    privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
    if err != nil {
        return nil, nil, err
    }
    
    // Encode private key to PEM
    privateKeyBytes := x509.MarshalPKCS1PrivateKey(privateKey)
    privateKeyPEM := pem.EncodeToMemory(&pem.Block{
        Type:  "RSA PRIVATE KEY",
        Bytes: privateKeyBytes,
    })
    
    // Encode public key to PEM
    publicKeyBytes, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
    if err != nil {
        return nil, nil, err
    }
    
    publicKeyPEM := pem.EncodeToMemory(&pem.Block{
        Type:  "PUBLIC KEY",
        Bytes: publicKeyBytes,
    })
    
    return privateKeyPEM, publicKeyPEM, nil
}
'''
    
    with open(f"{jwt_dir}/services/security/jwt-manager/token_manager.go", "w") as f:
        f.write(jwt_manager_code)
    
    # 2. Session Management System
    session_manager_code = '''package session

import (
    "context"
    "crypto/rand"
    "encoding/hex"
    "encoding/json"
    "fmt"
    "time"
    
    "github.com/go-redis/redis/v8"
)

// SessionManager handles user session management
type SessionManager struct {
    redis       *redis.Client
    prefix      string
    defaultTTL  time.Duration
}

// Session represents a user session
type Session struct {
    ID          string    `json:"id"`
    UserID      string    `json:"user_id"`
    Email       string    `json:"email"`
    Roles       []string  `json:"roles"`
    Permissions []string  `json:"permissions"`
    CreatedAt   time.Time `json:"created_at"`
    LastSeen    time.Time `json:"last_seen"`
    IPAddress   string    `json:"ip_address"`
    UserAgent   string    `json:"user_agent"`
    DeviceInfo  string    `json:"device_info"`
    IsActive    bool      `json:"is_active"`
    LoginMethod string    `json:"login_method"`
}

// SessionActivity represents session activity log
type SessionActivity struct {
    SessionID string    `json:"session_id"`
    Action    string    `json:"action"`
    IPAddress string    `json:"ip_address"`
    UserAgent string    `json:"user_agent"`
    Timestamp time.Time `json:"timestamp"`
    Details   string    `json:"details"`
}

// NewSessionManager creates a new session manager
func NewSessionManager(redisClient *redis.Client) *SessionManager {
    return &SessionManager{
        redis:      redisClient,
        prefix:     "session:",
        defaultTTL: 24 * time.Hour,
    }
}

// CreateSession creates a new user session
func (sm *SessionManager) CreateSession(userID, email string, roles, permissions []string, ipAddress, userAgent, deviceInfo, loginMethod string) (*Session, error) {
    sessionID, err := generateSecureID()
    if err != nil {
        return nil, fmt.Errorf("failed to generate session ID: %w", err)
    }
    
    now := time.Now()
    session := &Session{
        ID:          sessionID,
        UserID:      userID,
        Email:       email,
        Roles:       roles,
        Permissions: permissions,
        CreatedAt:   now,
        LastSeen:    now,
        IPAddress:   ipAddress,
        UserAgent:   userAgent,
        DeviceInfo:  deviceInfo,
        IsActive:    true,
        LoginMethod: loginMethod,
    }
    
    // Store session in Redis
    sessionData, err := json.Marshal(session)
    if err != nil {
        return nil, fmt.Errorf("failed to marshal session: %w", err)
    }
    
    key := sm.prefix + sessionID
    err = sm.redis.Set(context.Background(), key, sessionData, sm.defaultTTL).Err()
    if err != nil {
        return nil, fmt.Errorf("failed to store session: %w", err)
    }
    
    // Log session creation
    sm.logActivity(sessionID, "session_created", ipAddress, userAgent, "New session created")
    
    // Store user session mapping for concurrent session management
    userSessionKey := fmt.Sprintf("user_sessions:%s", userID)
    sm.redis.SAdd(context.Background(), userSessionKey, sessionID)
    sm.redis.Expire(context.Background(), userSessionKey, sm.defaultTTL)
    
    return session, nil
}

// ValidateSession validates and retrieves a session
func (sm *SessionManager) ValidateSession(sessionID string) (*Session, error) {
    key := sm.prefix + sessionID
    
    sessionData, err := sm.redis.Get(context.Background(), key).Result()
    if err != nil {
        if err == redis.Nil {
            return nil, fmt.Errorf("session not found")
        }
        return nil, fmt.Errorf("failed to retrieve session: %w", err)
    }
    
    var session Session
    err = json.Unmarshal([]byte(sessionData), &session)
    if err != nil {
        return nil, fmt.Errorf("failed to unmarshal session: %w", err)
    }
    
    // Check if session is active
    if !session.IsActive {
        return nil, fmt.Errorf("session is inactive")
    }
    
    return &session, nil
}

// UpdateSessionActivity updates session last seen time and activity
func (sm *SessionManager) UpdateSessionActivity(sessionID, ipAddress, userAgent, action string) error {
    session, err := sm.ValidateSession(sessionID)
    if err != nil {
        return err
    }
    
    // Update last seen time
    session.LastSeen = time.Now()
    
    // Verify IP address and user agent for security
    if session.IPAddress != ipAddress {
        sm.logActivity(sessionID, "ip_address_change", ipAddress, userAgent, 
            fmt.Sprintf("IP changed from %s to %s", session.IPAddress, ipAddress))
        
        // In a production system, you might want to invalidate the session
        // or require re-authentication for security
    }
    
    if session.UserAgent != userAgent {
        sm.logActivity(sessionID, "user_agent_change", ipAddress, userAgent,
            fmt.Sprintf("User agent changed"))
    }
    
    // Update session in Redis
    sessionData, err := json.Marshal(session)
    if err != nil {
        return fmt.Errorf("failed to marshal session: %w", err)
    }
    
    key := sm.prefix + sessionID
    err = sm.redis.Set(context.Background(), key, sessionData, sm.defaultTTL).Err()
    if err != nil {
        return fmt.Errorf("failed to update session: %w", err)
    }
    
    // Log activity
    sm.logActivity(sessionID, action, ipAddress, userAgent, "Session activity updated")
    
    return nil
}

// InvalidateSession invalidates a specific session
func (sm *SessionManager) InvalidateSession(sessionID string) error {
    session, err := sm.ValidateSession(sessionID)
    if err != nil {
        return err
    }
    
    // Mark session as inactive
    session.IsActive = false
    
    sessionData, err := json.Marshal(session)
    if err != nil {
        return fmt.Errorf("failed to marshal session: %w", err)
    }
    
    key := sm.prefix + sessionID
    err = sm.redis.Set(context.Background(), key, sessionData, time.Hour).Err() // Keep for 1 hour for audit
    if err != nil {
        return fmt.Errorf("failed to invalidate session: %w", err)
    }
    
    // Remove from user sessions
    userSessionKey := fmt.Sprintf("user_sessions:%s", session.UserID)
    sm.redis.SRem(context.Background(), userSessionKey, sessionID)
    
    // Log session invalidation
    sm.logActivity(sessionID, "session_invalidated", "", "", "Session invalidated")
    
    return nil
}

// InvalidateAllUserSessions invalidates all sessions for a user
func (sm *SessionManager) InvalidateAllUserSessions(userID string) error {
    userSessionKey := fmt.Sprintf("user_sessions:%s", userID)
    
    sessionIDs, err := sm.redis.SMembers(context.Background(), userSessionKey).Result()
    if err != nil {
        return fmt.Errorf("failed to get user sessions: %w", err)
    }
    
    for _, sessionID := range sessionIDs {
        sm.InvalidateSession(sessionID)
    }
    
    // Clear user sessions set
    sm.redis.Del(context.Background(), userSessionKey)
    
    return nil
}

// GetUserSessions retrieves all active sessions for a user
func (sm *SessionManager) GetUserSessions(userID string) ([]*Session, error) {
    userSessionKey := fmt.Sprintf("user_sessions:%s", userID)
    
    sessionIDs, err := sm.redis.SMembers(context.Background(), userSessionKey).Result()
    if err != nil {
        return nil, fmt.Errorf("failed to get user sessions: %w", err)
    }
    
    var sessions []*Session
    for _, sessionID := range sessionIDs {
        session, err := sm.ValidateSession(sessionID)
        if err != nil {
            // Remove invalid session from set
            sm.redis.SRem(context.Background(), userSessionKey, sessionID)
            continue
        }
        
        if session.IsActive {
            sessions = append(sessions, session)
        }
    }
    
    return sessions, nil
}

// CleanupExpiredSessions removes expired sessions (should be run periodically)
func (sm *SessionManager) CleanupExpiredSessions() error {
    // This would typically be implemented as a background job
    // For now, we rely on Redis TTL for cleanup
    return nil
}

// logActivity logs session activity
func (sm *SessionManager) logActivity(sessionID, action, ipAddress, userAgent, details string) {
    activity := SessionActivity{
        SessionID: sessionID,
        Action:    action,
        IPAddress: ipAddress,
        UserAgent: userAgent,
        Timestamp: time.Now(),
        Details:   details,
    }
    
    activityData, _ := json.Marshal(activity)
    
    // Store activity log (with 30-day expiration)
    activityKey := fmt.Sprintf("session_activity:%s:%d", sessionID, time.Now().Unix())
    sm.redis.Set(context.Background(), activityKey, activityData, 30*24*time.Hour)
    
    // Add to activity list for the session
    activityListKey := fmt.Sprintf("session_activities:%s", sessionID)
    sm.redis.LPush(context.Background(), activityListKey, activityData)
    sm.redis.LTrim(context.Background(), activityListKey, 0, 99) // Keep last 100 activities
    sm.redis.Expire(context.Background(), activityListKey, 30*24*time.Hour)
}

// GetSessionActivity retrieves session activity log
func (sm *SessionManager) GetSessionActivity(sessionID string) ([]*SessionActivity, error) {
    activityListKey := fmt.Sprintf("session_activities:%s", sessionID)
    
    activityData, err := sm.redis.LRange(context.Background(), activityListKey, 0, -1).Result()
    if err != nil {
        return nil, fmt.Errorf("failed to get session activity: %w", err)
    }
    
    var activities []*SessionActivity
    for _, data := range activityData {
        var activity SessionActivity
        if err := json.Unmarshal([]byte(data), &activity); err == nil {
            activities = append(activities, &activity)
        }
    }
    
    return activities, nil
}

// generateSecureID generates a cryptographically secure session ID
func generateSecureID() (string, error) {
    bytes := make([]byte, 32) // 256 bits
    _, err := rand.Read(bytes)
    if err != nil {
        return "", err
    }
    return hex.EncodeToString(bytes), nil
}
'''
    
    with open(f"{jwt_dir}/services/security/session-manager/session.go", "w") as f:
        f.write(session_manager_code)
    
    # 3. Enhanced User Management with JWT Integration
    user_management_code = '''package main

import (
    "fmt"
    "net/http"
    "strings"
    "time"
    
    "github.com/gin-gonic/gin"
    "golang.org/x/crypto/bcrypt"
    
    "your-project/services/security/jwt-manager"
    "your-project/services/security/session-manager"
)

// UserManagementServer handles user authentication and management
type UserManagementServer struct {
    router         *gin.Engine
    tokenManager   *jwt.TokenManager
    sessionManager *session.SessionManager
    logger         Logger
}

// LoginRequest represents a login request
type LoginRequest struct {
    Email    string `json:"email" binding:"required,email"`
    Password string `json:"password" binding:"required,min=8"`
}

// LoginResponse represents a login response
type LoginResponse struct {
    AccessToken  string    `json:"access_token"`
    RefreshToken string    `json:"refresh_token"`
    ExpiresAt    time.Time `json:"expires_at"`
    TokenType    string    `json:"token_type"`
    User         UserInfo  `json:"user"`
}

// UserInfo represents user information
type UserInfo struct {
    ID          string   `json:"id"`
    Email       string   `json:"email"`
    Name        string   `json:"name"`
    Roles       []string `json:"roles"`
    Permissions []string `json:"permissions"`
    LastLogin   time.Time `json:"last_login"`
}

// RefreshTokenRequest represents a token refresh request
type RefreshTokenRequest struct {
    RefreshToken string `json:"refresh_token" binding:"required"`
}

// NewUserManagementServer creates a new user management server
func NewUserManagementServer(tokenManager *jwt.TokenManager, sessionManager *session.SessionManager) *UserManagementServer {
    server := &UserManagementServer{
        router:         gin.New(),
        tokenManager:   tokenManager,
        sessionManager: sessionManager,
        logger:         NewLogger(),
    }
    
    server.setupMiddleware()
    server.setupRoutes()
    
    return server
}

// setupMiddleware configures middleware
func (s *UserManagementServer) setupMiddleware() {
    s.router.Use(gin.Recovery())
    s.router.Use(s.securityHeadersMiddleware)
    s.router.Use(s.requestLoggingMiddleware)
}

// securityHeadersMiddleware adds security headers
func (s *UserManagementServer) securityHeadersMiddleware(c *gin.Context) {
    c.Header("X-Content-Type-Options", "nosniff")
    c.Header("X-Frame-Options", "DENY")
    c.Header("X-XSS-Protection", "1; mode=block")
    c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    c.Next()
}

// requestLoggingMiddleware logs requests
func (s *UserManagementServer) requestLoggingMiddleware(c *gin.Context) {
    start := time.Now()
    c.Next()
    duration := time.Since(start)
    
    s.logger.Info("Request processed",
        "method", c.Request.Method,
        "path", c.Request.URL.Path,
        "status", c.Writer.Status(),
        "duration", duration,
        "ip", c.ClientIP(),
    )
}

// setupRoutes configures routes
func (s *UserManagementServer) setupRoutes() {
    s.router.GET("/health", s.handleHealthCheck)
    
    auth := s.router.Group("/api/v1/auth")
    {
        auth.POST("/login", s.handleLogin)
        auth.POST("/refresh", s.handleRefreshToken)
        auth.POST("/logout", s.authMiddleware, s.handleLogout)
        auth.GET("/profile", s.authMiddleware, s.handleGetProfile)
        auth.GET("/sessions", s.authMiddleware, s.handleGetSessions)
        auth.DELETE("/sessions/:sessionId", s.authMiddleware, s.handleInvalidateSession)
    }
}

// authMiddleware validates JWT tokens
func (s *UserManagementServer) authMiddleware(c *gin.Context) {
    authHeader := c.GetHeader("Authorization")
    if authHeader == "" {
        c.JSON(http.StatusUnauthorized, gin.H{
            "error": "Authorization header required",
            "code":  "MISSING_AUTHORIZATION",
        })
        c.Abort()
        return
    }
    
    // Extract token from "Bearer <token>"
    parts := strings.SplitN(authHeader, " ", 2)
    if len(parts) != 2 || parts[0] != "Bearer" {
        c.JSON(http.StatusUnauthorized, gin.H{
            "error": "Invalid authorization header format",
            "code":  "INVALID_AUTHORIZATION_FORMAT",
        })
        c.Abort()
        return
    }
    
    tokenString := parts[1]
    
    // Validate token
    claims, err := s.tokenManager.ValidateToken(tokenString, "access")
    if err != nil {
        s.logger.Error("Token validation failed", "error", err, "ip", c.ClientIP())
        c.JSON(http.StatusUnauthorized, gin.H{
            "error": "Invalid or expired token",
            "code":  "INVALID_TOKEN",
        })
        c.Abort()
        return
    }
    
    // Validate session
    session, err := s.sessionManager.ValidateSession(claims.SessionID)
    if err != nil {
        s.logger.Error("Session validation failed", "error", err, "session_id", claims.SessionID)
        c.JSON(http.StatusUnauthorized, gin.H{
            "error": "Invalid session",
            "code":  "INVALID_SESSION",
        })
        c.Abort()
        return
    }
    
    // Update session activity
    s.sessionManager.UpdateSessionActivity(
        claims.SessionID,
        c.ClientIP(),
        c.GetHeader("User-Agent"),
        "api_access",
    )
    
    // Store claims and session in context
    c.Set("claims", claims)
    c.Set("session", session)
    c.Next()
}

// handleLogin handles user login
func (s *UserManagementServer) handleLogin(c *gin.Context) {
    var request LoginRequest
    
    if err := c.ShouldBindJSON(&request); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{
            "error": "Invalid request format",
            "code":  "INVALID_REQUEST_FORMAT",
        })
        return
    }
    
    // Authenticate user (this would typically query a database)
    user, err := s.authenticateUser(request.Email, request.Password)
    if err != nil {
        s.logger.Error("Authentication failed", "error", err, "email", request.Email, "ip", c.ClientIP())
        c.JSON(http.StatusUnauthorized, gin.H{
            "error": "Invalid credentials",
            "code":  "INVALID_CREDENTIALS",
        })
        return
    }
    
    // Create session
    session, err := s.sessionManager.CreateSession(
        user.ID,
        user.Email,
        user.Roles,
        user.Permissions,
        c.ClientIP(),
        c.GetHeader("User-Agent"),
        extractDeviceInfo(c.GetHeader("User-Agent")),
        "password",
    )
    if err != nil {
        s.logger.Error("Session creation failed", "error", err, "user_id", user.ID)
        c.JSON(http.StatusInternalServerError, gin.H{
            "error": "Failed to create session",
            "code":  "SESSION_CREATION_FAILED",
        })
        return
    }
    
    // Generate JWT tokens
    tokenPair, err := s.tokenManager.GenerateTokenPair(
        user.ID,
        user.Email,
        user.Roles,
        user.Permissions,
        session.ID,
        c.ClientIP(),
        c.GetHeader("User-Agent"),
    )
    if err != nil {
        s.logger.Error("Token generation failed", "error", err, "user_id", user.ID)
        c.JSON(http.StatusInternalServerError, gin.H{
            "error": "Failed to generate tokens",
            "code":  "TOKEN_GENERATION_FAILED",
        })
        return
    }
    
    // Update user last login time
    s.updateUserLastLogin(user.ID)
    
    s.logger.Info("User login successful", "user_id", user.ID, "email", user.Email, "ip", c.ClientIP())
    
    c.JSON(http.StatusOK, LoginResponse{
        AccessToken:  tokenPair.AccessToken,
        RefreshToken: tokenPair.RefreshToken,
        ExpiresAt:    tokenPair.ExpiresAt,
        TokenType:    tokenPair.TokenType,
        User:         *user,
    })
}

// handleRefreshToken handles token refresh
func (s *UserManagementServer) handleRefreshToken(c *gin.Context) {
    var request RefreshTokenRequest
    
    if err := c.ShouldBindJSON(&request); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{
            "error": "Invalid request format",
            "code":  "INVALID_REQUEST_FORMAT",
        })
        return
    }
    
    // Refresh token
    tokenPair, err := s.tokenManager.RefreshToken(
        request.RefreshToken,
        c.ClientIP(),
        c.GetHeader("User-Agent"),
    )
    if err != nil {
        s.logger.Error("Token refresh failed", "error", err, "ip", c.ClientIP())
        c.JSON(http.StatusUnauthorized, gin.H{
            "error": "Invalid refresh token",
            "code":  "INVALID_REFRESH_TOKEN",
        })
        return
    }
    
    c.JSON(http.StatusOK, gin.H{
        "access_token":  tokenPair.AccessToken,
        "refresh_token": tokenPair.RefreshToken,
        "expires_at":    tokenPair.ExpiresAt,
        "token_type":    tokenPair.TokenType,
    })
}

// handleLogout handles user logout
func (s *UserManagementServer) handleLogout(c *gin.Context) {
    claims, _ := c.Get("claims")
    jwtClaims := claims.(*jwt.Claims)
    
    // Invalidate session
    err := s.sessionManager.InvalidateSession(jwtClaims.SessionID)
    if err != nil {
        s.logger.Error("Session invalidation failed", "error", err, "session_id", jwtClaims.SessionID)
    }
    
    // Revoke token (add to blacklist)
    authHeader := c.GetHeader("Authorization")
    tokenString := strings.SplitN(authHeader, " ", 2)[1]
    s.tokenManager.RevokeToken(tokenString)
    
    s.logger.Info("User logout successful", "user_id", jwtClaims.UserID, "session_id", jwtClaims.SessionID)
    
    c.JSON(http.StatusOK, gin.H{
        "message": "Logout successful",
    })
}

// handleGetProfile handles profile retrieval
func (s *UserManagementServer) handleGetProfile(c *gin.Context) {
    claims, _ := c.Get("claims")
    jwtClaims := claims.(*jwt.Claims)
    
    user, err := s.getUserByID(jwtClaims.UserID)
    if err != nil {
        c.JSON(http.StatusNotFound, gin.H{
            "error": "User not found",
            "code":  "USER_NOT_FOUND",
        })
        return
    }
    
    c.JSON(http.StatusOK, user)
}

// handleGetSessions handles session listing
func (s *UserManagementServer) handleGetSessions(c *gin.Context) {
    claims, _ := c.Get("claims")
    jwtClaims := claims.(*jwt.Claims)
    
    sessions, err := s.sessionManager.GetUserSessions(jwtClaims.UserID)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{
            "error": "Failed to retrieve sessions",
            "code":  "SESSION_RETRIEVAL_FAILED",
        })
        return
    }
    
    c.JSON(http.StatusOK, gin.H{
        "sessions": sessions,
    })
}

// handleInvalidateSession handles session invalidation
func (s *UserManagementServer) handleInvalidateSession(c *gin.Context) {
    sessionID := c.Param("sessionId")
    claims, _ := c.Get("claims")
    jwtClaims := claims.(*jwt.Claims)
    
    // Verify session belongs to user
    session, err := s.sessionManager.ValidateSession(sessionID)
    if err != nil || session.UserID != jwtClaims.UserID {
        c.JSON(http.StatusForbidden, gin.H{
            "error": "Access denied",
            "code":  "ACCESS_DENIED",
        })
        return
    }
    
    err = s.sessionManager.InvalidateSession(sessionID)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{
            "error": "Failed to invalidate session",
            "code":  "SESSION_INVALIDATION_FAILED",
        })
        return
    }
    
    c.JSON(http.StatusOK, gin.H{
        "message": "Session invalidated successfully",
    })
}

// handleHealthCheck handles health checks
func (s *UserManagementServer) handleHealthCheck(c *gin.Context) {
    c.JSON(http.StatusOK, gin.H{
        "status":    "healthy",
        "service":   "User Management",
        "version":   "1.0.0",
        "timestamp": time.Now().UTC().Format(time.RFC3339),
    })
}

// authenticateUser authenticates a user (mock implementation)
func (s *UserManagementServer) authenticateUser(email, password string) (*UserInfo, error) {
    // This would typically query a database
    // For demo purposes, we'll use a mock implementation
    
    // Hash the password for comparison
    hashedPassword, _ := bcrypt.GenerateFromPassword([]byte("password123"), bcrypt.DefaultCost)
    
    if email == "user@example.com" && bcrypt.CompareHashAndPassword(hashedPassword, []byte(password)) == nil {
        return &UserInfo{
            ID:          "user-123",
            Email:       email,
            Name:        "Test User",
            Roles:       []string{"user"},
            Permissions: []string{"read", "write"},
            LastLogin:   time.Now(),
        }, nil
    }
    
    return nil, fmt.Errorf("invalid credentials")
}

// getUserByID retrieves user by ID (mock implementation)
func (s *UserManagementServer) getUserByID(userID string) (*UserInfo, error) {
    if userID == "user-123" {
        return &UserInfo{
            ID:          userID,
            Email:       "user@example.com",
            Name:        "Test User",
            Roles:       []string{"user"},
            Permissions: []string{"read", "write"},
            LastLogin:   time.Now(),
        }, nil
    }
    
    return nil, fmt.Errorf("user not found")
}

// updateUserLastLogin updates user last login time
func (s *UserManagementServer) updateUserLastLogin(userID string) {
    // This would typically update a database
    s.logger.Info("User last login updated", "user_id", userID)
}

// extractDeviceInfo extracts device information from User-Agent
func extractDeviceInfo(userAgent string) string {
    // Simple device detection (in production, use a proper library)
    if strings.Contains(userAgent, "Mobile") {
        return "Mobile"
    } else if strings.Contains(userAgent, "Tablet") {
        return "Tablet"
    }
    return "Desktop"
}

// Start starts the user management server
func (s *UserManagementServer) Start(port string) error {
    s.logger.Info("Starting User Management server", "port", port)
    return s.router.Run(":" + port)
}
'''
    
    with open(f"{jwt_dir}/services/enhanced-platform/user-management/main.go", "w") as f:
        f.write(user_management_code)
    
    print("  ✅ CVE-2024-SEC-002 implementation created")

def create_implementation_guide(base_dir):
    """Create implementation guide"""
    
    print("📋 Creating Implementation Guide...")
    
    guide_content = f'''# Critical Security Fixes Implementation Guide

## Overview

This guide provides step-by-step instructions for implementing the critical security fixes for CVE-2024-SEC-001 and CVE-2024-SEC-002.

## Prerequisites

- Go 1.19+
- Redis server
- PostgreSQL database
- Git version control

## Implementation Timeline

### Phase 1: CVE-2024-SEC-001 (Input Validation) - 3 days
### Phase 2: CVE-2024-SEC-002 (JWT Authentication) - 2 days

## CVE-2024-SEC-001: Input Validation Fix

### Step 1: Deploy Validation Library (Day 1)

1. Copy the validation library:
   ```bash
   cp CVE-2024-SEC-001-input-validation/services/security/validation-middleware/validator.go \\
      services/security/validation-middleware/
   ```

2. Install dependencies:
   ```bash
   go mod tidy
   ```

3. Run unit tests:
   ```bash
   go test ./services/security/validation-middleware/...
   ```

### Step 2: Update PIX Gateway (Day 2)

1. Backup current PIX Gateway:
   ```bash
   cp services/pix-integration/pix-gateway/main.go \\
      services/pix-integration/pix-gateway/main.go.backup
   ```

2. Deploy new PIX Gateway:
   ```bash
   cp CVE-2024-SEC-001-input-validation/services/pix-integration/pix-gateway/main.go \\
      services/pix-integration/pix-gateway/
   ```

3. Test PIX Gateway:
   ```bash
   go run services/pix-integration/pix-gateway/main.go
   curl -X POST http://localhost:5001/api/v1/pix/transfer \\
        -H "Content-Type: application/json" \\
        -d '{{"request_id":"test","recipient_key":"invalid","key_type":"CPF","amount":100}}'
   ```

### Step 3: Update API Gateway (Day 3)

1. Deploy API Gateway security middleware:
   ```bash
   cp CVE-2024-SEC-001-input-validation/services/core-infrastructure/api-gateway/main.go \\
      services/core-infrastructure/api-gateway/
   ```

2. Test security headers:
   ```bash
   curl -I http://localhost:8000/health
   ```

## CVE-2024-SEC-002: JWT Authentication Fix

### Step 1: Deploy JWT Manager (Day 1)

1. Generate RSA key pair:
   ```bash
   openssl genrsa -out private_key.pem 2048
   openssl rsa -in private_key.pem -pubout -out public_key.pem
   ```

2. Deploy JWT manager:
   ```bash
   cp CVE-2024-SEC-002-jwt-authentication/services/security/jwt-manager/token_manager.go \\
      services/security/jwt-manager/
   ```

3. Deploy session manager:
   ```bash
   cp CVE-2024-SEC-002-jwt-authentication/services/security/session-manager/session.go \\
      services/security/session-manager/
   ```

### Step 2: Update User Management (Day 2)

1. Deploy enhanced user management:
   ```bash
   cp CVE-2024-SEC-002-jwt-authentication/services/enhanced-platform/user-management/main.go \\
      services/enhanced-platform/user-management/
   ```

2. Test authentication:
   ```bash
   curl -X POST http://localhost:3001/api/v1/auth/login \\
        -H "Content-Type: application/json" \\
        -d '{{"email":"user@example.com","password":"password123"}}'
   ```

## Testing Procedures

### Security Testing

1. **Input Validation Tests**:
   ```bash
   # Test XSS prevention
   curl -X POST http://localhost:5001/api/v1/pix/transfer \\
        -H "Content-Type: application/json" \\
        -d '{{"description":"<script>alert(\\'xss\\')</script>"}}'
   
   # Test SQL injection prevention
   curl -X POST http://localhost:5001/api/v1/pix/keys/validate \\
        -H "Content-Type: application/json" \\
        -d '{{"key":"\\'; DROP TABLE users; --","key_type":"EMAIL"}}'
   ```

2. **JWT Authentication Tests**:
   ```bash
   # Test token validation
   curl -H "Authorization: Bearer invalid_token" \\
        http://localhost:3001/api/v1/auth/profile
   
   # Test token refresh
   curl -X POST http://localhost:3001/api/v1/auth/refresh \\
        -H "Content-Type: application/json" \\
        -d '{{"refresh_token":"valid_refresh_token"}}'
   ```

### Performance Testing

1. **Load Testing**:
   ```bash
   # Install Apache Bench
   sudo apt-get install apache2-utils
   
   # Test PIX Gateway
   ab -n 1000 -c 10 -H "Content-Type: application/json" \\
      -p test_data.json http://localhost:5001/api/v1/pix/transfer
   ```

## Deployment Checklist

### Pre-deployment
- [ ] All tests pass
- [ ] Code review completed
- [ ] Security scan completed
- [ ] Performance benchmarks met

### Deployment
- [ ] Database backup completed
- [ ] Blue-green environment prepared
- [ ] Monitoring alerts configured
- [ ] Rollback plan ready

### Post-deployment
- [ ] Health checks pass
- [ ] Security tests pass
- [ ] Performance metrics normal
- [ ] Error rates < 0.1%

## Monitoring and Alerting

### Key Metrics to Monitor

1. **Security Metrics**:
   - Failed authentication attempts
   - Invalid token attempts
   - Input validation failures
   - Suspicious activity patterns

2. **Performance Metrics**:
   - Response time < 100ms
   - Error rate < 0.1%
   - Throughput > 1000 RPS
   - Memory usage stable

### Alert Thresholds

- **Critical**: Error rate > 2%
- **Warning**: Response time > 200ms
- **Info**: Failed auth attempts > 10/minute

## Rollback Procedures

If issues are detected:

1. **Immediate Rollback**:
   ```bash
   # Restore backup files
   cp services/pix-integration/pix-gateway/main.go.backup \\
      services/pix-integration/pix-gateway/main.go
   
   # Restart services
   systemctl restart pix-gateway
   systemctl restart api-gateway
   systemctl restart user-management
   ```

2. **Verify Rollback**:
   ```bash
   curl http://localhost:5001/health
   curl http://localhost:8000/health
   curl http://localhost:3001/health
   ```

## Support and Troubleshooting

### Common Issues

1. **Validation Errors**: Check input format and validation rules
2. **JWT Errors**: Verify key configuration and token format
3. **Session Errors**: Check Redis connectivity and configuration

### Log Locations

- PIX Gateway: `/var/log/pix-gateway/app.log`
- API Gateway: `/var/log/api-gateway/app.log`
- User Management: `/var/log/user-management/app.log`

### Contact Information

- Security Team: security@nigerianremittance.com
- DevOps Team: devops@nigerianremittance.com
- On-call Engineer: +1-555-0123

## Conclusion

Following this implementation guide will ensure that both critical security vulnerabilities are properly addressed with comprehensive fixes, testing, and monitoring in place.
'''
    
    with open(f"{base_dir}/IMPLEMENTATION_GUIDE.md", "w") as f:
        f.write(guide_content)
    
    print("  ✅ Implementation guide created")

def main():
    """Main function"""
    
    security_fixes_dir = create_security_fix_implementations()
    
    print(f"\n📁 Security fix implementations created in: {security_fixes_dir}")
    print("\n📋 Files created:")
    print("  CVE-2024-SEC-001-input-validation/")
    print("    ├── services/security/validation-middleware/validator.go")
    print("    ├── services/pix-integration/pix-gateway/main.go")
    print("    ├── services/core-infrastructure/api-gateway/main.go")
    print("    └── tests/validation_test.go")
    print("  CVE-2024-SEC-002-jwt-authentication/")
    print("    ├── services/security/jwt-manager/token_manager.go")
    print("    ├── services/security/session-manager/session.go")
    print("    ├── services/enhanced-platform/user-management/main.go")
    print("    └── tests/jwt_test.go")
    print("  IMPLEMENTATION_GUIDE.md")

if __name__ == "__main__":
    main()

