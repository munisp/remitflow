package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Customer represents a customer in the banking network
type Customer struct {
	ID                uuid.UUID      `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	CustomerNumber    string         `json:"customer_number" gorm:"uniqueIndex;not null"`
	FirstName         string         `json:"first_name" gorm:"not null"`
	LastName          string         `json:"last_name" gorm:"not null"`
	MiddleName        string         `json:"middle_name"`
	DateOfBirth       time.Time      `json:"date_of_birth" gorm:"not null"`
	Gender            Gender         `json:"gender"`
	Email             string         `json:"email" gorm:"uniqueIndex"`
	PhoneNumber       string         `json:"phone_number" gorm:"uniqueIndex;not null"`
	AlternatePhone    string         `json:"alternate_phone"`
	NationalID        string         `json:"national_id" gorm:"uniqueIndex;not null"`
	PassportNumber    string         `json:"passport_number" gorm:"uniqueIndex"`
	Address           Address        `json:"address" gorm:"embedded"`
	EmergencyContact  EmergencyContact `json:"emergency_contact" gorm:"embedded"`
	Occupation        string         `json:"occupation"`
	EmployerName      string         `json:"employer_name"`
	MonthlyIncome     float64        `json:"monthly_income"`
	SourceOfIncome    string         `json:"source_of_income"`
	CustomerType      CustomerType   `json:"customer_type" gorm:"default:'individual'"`
	Status            CustomerStatus `json:"status" gorm:"default:'pending'"`
	RiskRating        RiskRating     `json:"risk_rating" gorm:"default:'medium'"`
	KYCStatus         KYCStatus      `json:"kyc_status" gorm:"default:'pending'"`
	KYCCompletedAt    *time.Time     `json:"kyc_completed_at"`
	OnboardedBy       uuid.UUID      `json:"onboarded_by" gorm:"not null"`
	AssignedAgent     *uuid.UUID     `json:"assigned_agent"`
	PreferredLanguage string         `json:"preferred_language" gorm:"default:'en'"`
	MarketingConsent  bool           `json:"marketing_consent" gorm:"default:false"`
	DataConsent       bool           `json:"data_consent" gorm:"default:true"`
	LastLoginAt       *time.Time     `json:"last_login_at"`
	IsActive          bool           `json:"is_active" gorm:"default:true"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
	DeletedAt         *time.Time     `json:"deleted_at" gorm:"index"`
}

// Gender represents customer gender
type Gender string

const (
	GenderMale   Gender = "male"
	GenderFemale Gender = "female"
	GenderOther  Gender = "other"
)

// CustomerType represents the type of customer
type CustomerType string

const (
	CustomerTypeIndividual CustomerType = "individual"
	CustomerTypeBusiness   CustomerType = "business"
	CustomerTypeCorporate  CustomerType = "corporate"
)

// CustomerStatus represents the status of a customer
type CustomerStatus string

const (
	CustomerStatusPending   CustomerStatus = "pending"
	CustomerStatusActive    CustomerStatus = "active"
	CustomerStatusSuspended CustomerStatus = "suspended"
	CustomerStatusInactive  CustomerStatus = "inactive"
	CustomerStatusBlocked   CustomerStatus = "blocked"
	CustomerStatusClosed    CustomerStatus = "closed"
)

// RiskRating represents the risk rating of a customer
type RiskRating string

const (
	RiskRatingLow      RiskRating = "low"
	RiskRatingMedium   RiskRating = "medium"
	RiskRatingHigh     RiskRating = "high"
	RiskRatingCritical RiskRating = "critical"
)

// KYCStatus represents the KYC verification status
type KYCStatus string

const (
	KYCStatusPending   KYCStatus = "pending"
	KYCStatusInReview  KYCStatus = "in_review"
	KYCStatusApproved  KYCStatus = "approved"
	KYCStatusRejected  KYCStatus = "rejected"
	KYCStatusExpired   KYCStatus = "expired"
)

// Address represents customer address
type Address struct {
	Street     string `json:"street"`
	City       string `json:"city"`
	State      string `json:"state"`
	Country    string `json:"country"`
	PostalCode string `json:"postal_code"`
	Latitude   float64 `json:"latitude"`
	Longitude  float64 `json:"longitude"`
}

// EmergencyContact represents emergency contact information
type EmergencyContact struct {
	Name         string `json:"name"`
	Relationship string `json:"relationship"`
	PhoneNumber  string `json:"phone_number"`
	Email        string `json:"email"`
}

// CustomerAccount represents customer account information
type CustomerAccount struct {
	ID             uuid.UUID     `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	CustomerID     uuid.UUID     `json:"customer_id" gorm:"not null;index"`
	AccountNumber  string        `json:"account_number" gorm:"uniqueIndex;not null"`
	AccountType    AccountType   `json:"account_type" gorm:"not null"`
	Currency       string        `json:"currency" gorm:"default:'USD'"`
	Balance        float64       `json:"balance" gorm:"default:0"`
	AvailableBalance float64     `json:"available_balance" gorm:"default:0"`
	Status         AccountStatus `json:"status" gorm:"default:'active'"`
	OpenedDate     time.Time     `json:"opened_date" gorm:"not null"`
	ClosedDate     *time.Time    `json:"closed_date"`
	CreatedAt      time.Time     `json:"created_at"`
	UpdatedAt      time.Time     `json:"updated_at"`
}

// AccountType represents the type of account
type AccountType string

const (
	AccountTypeSavings AccountType = "savings"
	AccountTypeCurrent AccountType = "current"
	AccountTypeWallet  AccountType = "wallet"
)

// AccountStatus represents the status of an account
type AccountStatus string

const (
	AccountStatusActive    AccountStatus = "active"
	AccountStatusSuspended AccountStatus = "suspended"
	AccountStatusFrozen    AccountStatus = "frozen"
	AccountStatusClosed    AccountStatus = "closed"
)

// CustomerDocument represents customer documents
type CustomerDocument struct {
	ID           uuid.UUID    `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	CustomerID   uuid.UUID    `json:"customer_id" gorm:"not null;index"`
	DocumentType DocumentType `json:"document_type" gorm:"not null"`
	DocumentNumber string     `json:"document_number" gorm:"not null"`
	IssuedDate   time.Time    `json:"issued_date"`
	ExpiryDate   *time.Time   `json:"expiry_date"`
	IssuingAuthority string   `json:"issuing_authority"`
	FilePath     string       `json:"file_path"`
	FileHash     string       `json:"file_hash"`
	Status       DocumentStatus `json:"status" gorm:"default:'pending'"`
	VerifiedBy   *uuid.UUID   `json:"verified_by"`
	VerifiedAt   *time.Time   `json:"verified_at"`
	CreatedAt    time.Time    `json:"created_at"`
	UpdatedAt    time.Time    `json:"updated_at"`
}

// DocumentType represents the type of document
type DocumentType string

const (
	DocumentTypeNationalID     DocumentType = "national_id"
	DocumentTypePassport       DocumentType = "passport"
	DocumentTypeDriversLicense DocumentType = "drivers_license"
	DocumentTypeUtilityBill    DocumentType = "utility_bill"
	DocumentTypeBankStatement  DocumentType = "bank_statement"
	DocumentTypeProofOfIncome  DocumentType = "proof_of_income"
	DocumentTypePhoto          DocumentType = "photo"
)

// DocumentStatus represents the status of a document
type DocumentStatus string

const (
	DocumentStatusPending  DocumentStatus = "pending"
	DocumentStatusVerified DocumentStatus = "verified"
	DocumentStatusRejected DocumentStatus = "rejected"
	DocumentStatusExpired  DocumentStatus = "expired"
)

// CustomerActivity represents customer activity log
type CustomerActivity struct {
	ID           uuid.UUID    `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	CustomerID   uuid.UUID    `json:"customer_id" gorm:"not null;index"`
	ActivityType ActivityType `json:"activity_type" gorm:"not null"`
	Description  string       `json:"description" gorm:"not null"`
	IPAddress    string       `json:"ip_address"`
	UserAgent    string       `json:"user_agent"`
	Location     Location     `json:"location" gorm:"embedded"`
	Metadata     JSON         `json:"metadata" gorm:"type:jsonb"`
	CreatedAt    time.Time    `json:"created_at"`
}

// ActivityType represents the type of customer activity
type ActivityType string

const (
	ActivityTypeLogin        ActivityType = "login"
	ActivityTypeLogout       ActivityType = "logout"
	ActivityTypeTransaction  ActivityType = "transaction"
	ActivityTypeProfileUpdate ActivityType = "profile_update"
	ActivityTypePasswordChange ActivityType = "password_change"
	ActivityTypeDocumentUpload ActivityType = "document_upload"
	ActivityTypeAccountOpen  ActivityType = "account_open"
	ActivityTypeAccountClose ActivityType = "account_close"
)

// Location represents geographical location
type Location struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Country   string  `json:"country"`
	City      string  `json:"city"`
}

// JSON type for JSONB fields
type JSON map[string]interface{}

// Request/Response types
type CreateCustomerRequest struct {
	FirstName         string           `json:"first_name" binding:"required"`
	LastName          string           `json:"last_name" binding:"required"`
	MiddleName        string           `json:"middle_name"`
	DateOfBirth       time.Time        `json:"date_of_birth" binding:"required"`
	Gender            Gender           `json:"gender"`
	Email             string           `json:"email" binding:"email"`
	PhoneNumber       string           `json:"phone_number" binding:"required"`
	AlternatePhone    string           `json:"alternate_phone"`
	NationalID        string           `json:"national_id" binding:"required"`
	PassportNumber    string           `json:"passport_number"`
	Address           Address          `json:"address" binding:"required"`
	EmergencyContact  EmergencyContact `json:"emergency_contact"`
	Occupation        string           `json:"occupation"`
	EmployerName      string           `json:"employer_name"`
	MonthlyIncome     float64          `json:"monthly_income"`
	SourceOfIncome    string           `json:"source_of_income"`
	CustomerType      CustomerType     `json:"customer_type"`
	AssignedAgent     *uuid.UUID       `json:"assigned_agent"`
	PreferredLanguage string           `json:"preferred_language"`
	MarketingConsent  bool             `json:"marketing_consent"`
	DataConsent       bool             `json:"data_consent"`
}

type UpdateCustomerRequest struct {
	FirstName         string           `json:"first_name"`
	LastName          string           `json:"last_name"`
	MiddleName        string           `json:"middle_name"`
	Email             string           `json:"email"`
	PhoneNumber       string           `json:"phone_number"`
	AlternatePhone    string           `json:"alternate_phone"`
	Address           *Address         `json:"address"`
	EmergencyContact  *EmergencyContact `json:"emergency_contact"`
	Occupation        string           `json:"occupation"`
	EmployerName      string           `json:"employer_name"`
	MonthlyIncome     *float64         `json:"monthly_income"`
	SourceOfIncome    string           `json:"source_of_income"`
	Status            CustomerStatus   `json:"status"`
	RiskRating        RiskRating       `json:"risk_rating"`
	AssignedAgent     *uuid.UUID       `json:"assigned_agent"`
	PreferredLanguage string           `json:"preferred_language"`
	MarketingConsent  *bool            `json:"marketing_consent"`
	DataConsent       *bool            `json:"data_consent"`
	IsActive          *bool            `json:"is_active"`
}

type CreateAccountRequest struct {
	CustomerID  uuid.UUID   `json:"customer_id" binding:"required"`
	AccountType AccountType `json:"account_type" binding:"required"`
	Currency    string      `json:"currency"`
}

type CreateDocumentRequest struct {
	CustomerID       uuid.UUID    `json:"customer_id" binding:"required"`
	DocumentType     DocumentType `json:"document_type" binding:"required"`
	DocumentNumber   string       `json:"document_number" binding:"required"`
	IssuedDate       time.Time    `json:"issued_date"`
	ExpiryDate       *time.Time   `json:"expiry_date"`
	IssuingAuthority string       `json:"issuing_authority"`
	FilePath         string       `json:"file_path" binding:"required"`
	FileHash         string       `json:"file_hash"`
}

// CustomerService handles customer-related operations
type CustomerService struct {
	db *gorm.DB
}

// NewCustomerService creates a new customer service
func NewCustomerService(db *gorm.DB) *CustomerService {
	return &CustomerService{db: db}
}

// CreateCustomer creates a new customer
func (s *CustomerService) CreateCustomer(req CreateCustomerRequest, onboardedBy uuid.UUID) (*Customer, error) {
	// Generate unique customer number
	customerNumber := generateCustomerNumber()

	customer := &Customer{
		CustomerNumber:    customerNumber,
		FirstName:         req.FirstName,
		LastName:          req.LastName,
		MiddleName:        req.MiddleName,
		DateOfBirth:       req.DateOfBirth,
		Gender:            req.Gender,
		Email:             req.Email,
		PhoneNumber:       req.PhoneNumber,
		AlternatePhone:    req.AlternatePhone,
		NationalID:        req.NationalID,
		PassportNumber:    req.PassportNumber,
		Address:           req.Address,
		EmergencyContact:  req.EmergencyContact,
		Occupation:        req.Occupation,
		EmployerName:      req.EmployerName,
		MonthlyIncome:     req.MonthlyIncome,
		SourceOfIncome:    req.SourceOfIncome,
		CustomerType:      req.CustomerType,
		Status:            CustomerStatusPending,
		RiskRating:        RiskRatingMedium,
		KYCStatus:         KYCStatusPending,
		OnboardedBy:       onboardedBy,
		AssignedAgent:     req.AssignedAgent,
		PreferredLanguage: req.PreferredLanguage,
		MarketingConsent:  req.MarketingConsent,
		DataConsent:       req.DataConsent,
	}

	// Set default values
	if customer.CustomerType == "" {
		customer.CustomerType = CustomerTypeIndividual
	}
	if customer.PreferredLanguage == "" {
		customer.PreferredLanguage = "en"
	}

	// Calculate initial risk rating
	s.calculateRiskRating(customer)

	if err := s.db.Create(customer).Error; err != nil {
		return nil, fmt.Errorf("failed to create customer: %w", err)
	}

	// Log customer creation activity
	s.logActivity(customer.ID, ActivityTypeProfileUpdate, "Customer profile created", "", "", Location{})

	return customer, nil
}

// GetCustomer retrieves a customer by ID
func (s *CustomerService) GetCustomer(id uuid.UUID) (*Customer, error) {
	var customer Customer
	if err := s.db.First(&customer, "id = ?", id).Error; err != nil {
		return nil, fmt.Errorf("failed to get customer: %w", err)
	}
	return &customer, nil
}

// GetCustomerByNumber retrieves a customer by customer number
func (s *CustomerService) GetCustomerByNumber(customerNumber string) (*Customer, error) {
	var customer Customer
	if err := s.db.First(&customer, "customer_number = ?", customerNumber).Error; err != nil {
		return nil, fmt.Errorf("failed to get customer by number: %w", err)
	}
	return &customer, nil
}

// UpdateCustomer updates a customer
func (s *CustomerService) UpdateCustomer(id uuid.UUID, req UpdateCustomerRequest) (*Customer, error) {
	var customer Customer
	if err := s.db.First(&customer, "id = ?", id).Error; err != nil {
		return nil, fmt.Errorf("failed to find customer: %w", err)
	}

	// Update fields if provided
	if req.FirstName != "" {
		customer.FirstName = req.FirstName
	}
	if req.LastName != "" {
		customer.LastName = req.LastName
	}
	if req.MiddleName != "" {
		customer.MiddleName = req.MiddleName
	}
	if req.Email != "" {
		customer.Email = req.Email
	}
	if req.PhoneNumber != "" {
		customer.PhoneNumber = req.PhoneNumber
	}
	if req.AlternatePhone != "" {
		customer.AlternatePhone = req.AlternatePhone
	}
	if req.Address != nil {
		customer.Address = *req.Address
	}
	if req.EmergencyContact != nil {
		customer.EmergencyContact = *req.EmergencyContact
	}
	if req.Occupation != "" {
		customer.Occupation = req.Occupation
	}
	if req.EmployerName != "" {
		customer.EmployerName = req.EmployerName
	}
	if req.MonthlyIncome != nil {
		customer.MonthlyIncome = *req.MonthlyIncome
	}
	if req.SourceOfIncome != "" {
		customer.SourceOfIncome = req.SourceOfIncome
	}
	if req.Status != "" {
		customer.Status = req.Status
	}
	if req.RiskRating != "" {
		customer.RiskRating = req.RiskRating
	}
	if req.AssignedAgent != nil {
		customer.AssignedAgent = req.AssignedAgent
	}
	if req.PreferredLanguage != "" {
		customer.PreferredLanguage = req.PreferredLanguage
	}
	if req.MarketingConsent != nil {
		customer.MarketingConsent = *req.MarketingConsent
	}
	if req.DataConsent != nil {
		customer.DataConsent = *req.DataConsent
	}
	if req.IsActive != nil {
		customer.IsActive = *req.IsActive
	}

	if err := s.db.Save(&customer).Error; err != nil {
		return nil, fmt.Errorf("failed to update customer: %w", err)
	}

	// Log customer update activity
	s.logActivity(customer.ID, ActivityTypeProfileUpdate, "Customer profile updated", "", "", Location{})

	return &customer, nil
}

// ListCustomers retrieves a list of customers with pagination and filters
func (s *CustomerService) ListCustomers(page, limit int, status CustomerStatus, customerType CustomerType, assignedAgent *uuid.UUID) ([]Customer, int64, error) {
	var customers []Customer
	var total int64

	query := s.db.Model(&Customer{})

	// Apply filters
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if customerType != "" {
		query = query.Where("customer_type = ?", customerType)
	}
	if assignedAgent != nil {
		query = query.Where("assigned_agent = ?", *assignedAgent)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count customers: %w", err)
	}

	offset := (page - 1) * limit
	if err := query.Offset(offset).Limit(limit).Find(&customers).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to list customers: %w", err)
	}

	return customers, total, nil
}

// CreateAccount creates a new account for a customer
func (s *CustomerService) CreateAccount(req CreateAccountRequest) (*CustomerAccount, error) {
	// Verify customer exists
	var customer Customer
	if err := s.db.First(&customer, "id = ?", req.CustomerID).Error; err != nil {
		return nil, fmt.Errorf("customer not found: %w", err)
	}

	// Generate unique account number
	accountNumber := generateAccountNumber(req.AccountType)

	// Set default currency
	if req.Currency == "" {
		req.Currency = "USD"
	}

	account := &CustomerAccount{
		CustomerID:       req.CustomerID,
		AccountNumber:    accountNumber,
		AccountType:      req.AccountType,
		Currency:         req.Currency,
		Balance:          0,
		AvailableBalance: 0,
		Status:           AccountStatusActive,
		OpenedDate:       time.Now(),
	}

	if err := s.db.Create(account).Error; err != nil {
		return nil, fmt.Errorf("failed to create account: %w", err)
	}

	// Log account creation activity
	s.logActivity(req.CustomerID, ActivityTypeAccountOpen, fmt.Sprintf("Account %s opened", accountNumber), "", "", Location{})

	return account, nil
}

// GetCustomerAccounts retrieves all accounts for a customer
func (s *CustomerService) GetCustomerAccounts(customerID uuid.UUID) ([]CustomerAccount, error) {
	var accounts []CustomerAccount
	if err := s.db.Where("customer_id = ?", customerID).Find(&accounts).Error; err != nil {
		return nil, fmt.Errorf("failed to get customer accounts: %w", err)
	}
	return accounts, nil
}

// CreateDocument creates a new document for a customer
func (s *CustomerService) CreateDocument(req CreateDocumentRequest) (*CustomerDocument, error) {
	// Verify customer exists
	var customer Customer
	if err := s.db.First(&customer, "id = ?", req.CustomerID).Error; err != nil {
		return nil, fmt.Errorf("customer not found: %w", err)
	}

	document := &CustomerDocument{
		CustomerID:       req.CustomerID,
		DocumentType:     req.DocumentType,
		DocumentNumber:   req.DocumentNumber,
		IssuedDate:       req.IssuedDate,
		ExpiryDate:       req.ExpiryDate,
		IssuingAuthority: req.IssuingAuthority,
		FilePath:         req.FilePath,
		FileHash:         req.FileHash,
		Status:           DocumentStatusPending,
	}

	if err := s.db.Create(document).Error; err != nil {
		return nil, fmt.Errorf("failed to create document: %w", err)
	}

	// Log document upload activity
	s.logActivity(req.CustomerID, ActivityTypeDocumentUpload, fmt.Sprintf("Document %s uploaded", req.DocumentType), "", "", Location{})

	return document, nil
}

// GetCustomerDocuments retrieves all documents for a customer
func (s *CustomerService) GetCustomerDocuments(customerID uuid.UUID) ([]CustomerDocument, error) {
	var documents []CustomerDocument
	if err := s.db.Where("customer_id = ?", customerID).Find(&documents).Error; err != nil {
		return nil, fmt.Errorf("failed to get customer documents: %w", err)
	}
	return documents, nil
}

// UpdateKYCStatus updates the KYC status of a customer
func (s *CustomerService) UpdateKYCStatus(id uuid.UUID, status KYCStatus) error {
	updates := map[string]interface{}{
		"kyc_status": status,
	}

	if status == KYCStatusApproved {
		updates["kyc_completed_at"] = time.Now()
		updates["status"] = CustomerStatusActive
	}

	if err := s.db.Model(&Customer{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		return fmt.Errorf("failed to update KYC status: %w", err)
	}

	return nil
}

// GetCustomerActivities retrieves customer activities
func (s *CustomerService) GetCustomerActivities(customerID uuid.UUID, limit int) ([]CustomerActivity, error) {
	var activities []CustomerActivity
	if err := s.db.Where("customer_id = ?", customerID).Order("created_at DESC").Limit(limit).Find(&activities).Error; err != nil {
		return nil, fmt.Errorf("failed to get customer activities: %w", err)
	}
	return activities, nil
}

// calculateRiskRating calculates the risk rating for a customer
func (s *CustomerService) calculateRiskRating(customer *Customer) {
	riskScore := 0

	// Age-based risk
	age := time.Now().Year() - customer.DateOfBirth.Year()
	if age < 18 || age > 65 {
		riskScore += 10
	}

	// Income-based risk
	if customer.MonthlyIncome > 100000 {
		riskScore += 15
	} else if customer.MonthlyIncome < 1000 {
		riskScore += 10
	}

	// Occupation-based risk
	highRiskOccupations := []string{"politician", "arms_dealer", "casino_owner"}
	for _, occupation := range highRiskOccupations {
		if customer.Occupation == occupation {
			riskScore += 20
			break
		}
	}

	// Determine risk rating
	if riskScore >= 30 {
		customer.RiskRating = RiskRatingHigh
	} else if riskScore >= 15 {
		customer.RiskRating = RiskRatingMedium
	} else {
		customer.RiskRating = RiskRatingLow
	}
}

// logActivity logs customer activity
func (s *CustomerService) logActivity(customerID uuid.UUID, activityType ActivityType, description, ipAddress, userAgent string, location Location) {
	activity := CustomerActivity{
		CustomerID:   customerID,
		ActivityType: activityType,
		Description:  description,
		IPAddress:    ipAddress,
		UserAgent:    userAgent,
		Location:     location,
	}
	s.db.Create(&activity)
}

// Helper functions
func generateCustomerNumber() string {
	return fmt.Sprintf("CUST%d", time.Now().Unix())
}

func generateAccountNumber(accountType AccountType) string {
	prefix := "ACC"
	switch accountType {
	case AccountTypeSavings:
		prefix = "SAV"
	case AccountTypeCurrent:
		prefix = "CUR"
	case AccountTypeWallet:
		prefix = "WAL"
	}
	return fmt.Sprintf("%s%d", prefix, time.Now().Unix())
}

// Metrics
var (
	customerCreatedTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "customer_created_total",
			Help: "Total number of customers created",
		},
		[]string{"customer_type", "status"},
	)

	customerUpdatedTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "customer_updated_total",
			Help: "Total number of customers updated",
		},
		[]string{"field"},
	)

	accountCreatedTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "account_created_total",
			Help: "Total number of accounts created",
		},
		[]string{"account_type", "currency"},
	)

	customerRequestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "customer_request_duration_seconds",
			Help: "Duration of customer requests",
		},
		[]string{"method", "endpoint"},
	)
)

func init() {
	prometheus.MustRegister(customerCreatedTotal)
	prometheus.MustRegister(customerUpdatedTotal)
	prometheus.MustRegister(accountCreatedTotal)
	prometheus.MustRegister(customerRequestDuration)
}

// HTTP Handlers
type CustomerHandler struct {
	service *CustomerService
}

func NewCustomerHandler(service *CustomerService) *CustomerHandler {
	return &CustomerHandler{service: service}
}

func (h *CustomerHandler) CreateCustomer(c *gin.Context) {
	timer := prometheus.NewTimer(customerRequestDuration.WithLabelValues("POST", "/customers"))
	defer timer.ObserveDuration()

	var req CreateCustomerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get onboarded_by from JWT token (simplified for demo)
	onboardedBy := uuid.New()

	customer, err := h.service.CreateCustomer(req, onboardedBy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	customerCreatedTotal.WithLabelValues(string(customer.CustomerType), string(customer.Status)).Inc()

	c.JSON(http.StatusCreated, customer)
}

func (h *CustomerHandler) GetCustomer(c *gin.Context) {
	timer := prometheus.NewTimer(customerRequestDuration.WithLabelValues("GET", "/customers/:id"))
	defer timer.ObserveDuration()

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid customer ID"})
		return
	}

	customer, err := h.service.GetCustomer(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "customer not found"})
		return
	}

	c.JSON(http.StatusOK, customer)
}

func (h *CustomerHandler) UpdateCustomer(c *gin.Context) {
	timer := prometheus.NewTimer(customerRequestDuration.WithLabelValues("PUT", "/customers/:id"))
	defer timer.ObserveDuration()

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid customer ID"})
		return
	}

	var req UpdateCustomerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	customer, err := h.service.UpdateCustomer(id, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	customerUpdatedTotal.WithLabelValues("general").Inc()

	c.JSON(http.StatusOK, customer)
}

func (h *CustomerHandler) ListCustomers(c *gin.Context) {
	timer := prometheus.NewTimer(customerRequestDuration.WithLabelValues("GET", "/customers"))
	defer timer.ObserveDuration()

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	status := CustomerStatus(c.Query("status"))
	customerType := CustomerType(c.Query("customer_type"))

	var assignedAgent *uuid.UUID
	if assignedAgentStr := c.Query("assigned_agent"); assignedAgentStr != "" {
		if id, err := uuid.Parse(assignedAgentStr); err == nil {
			assignedAgent = &id
		}
	}

	customers, total, err := h.service.ListCustomers(page, limit, status, customerType, assignedAgent)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"customers": customers,
		"total":     total,
		"page":      page,
		"limit":     limit,
	})
}

func (h *CustomerHandler) CreateAccount(c *gin.Context) {
	timer := prometheus.NewTimer(customerRequestDuration.WithLabelValues("POST", "/accounts"))
	defer timer.ObserveDuration()

	var req CreateAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	account, err := h.service.CreateAccount(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	accountCreatedTotal.WithLabelValues(string(account.AccountType), account.Currency).Inc()

	c.JSON(http.StatusCreated, account)
}

func (h *CustomerHandler) GetCustomerAccounts(c *gin.Context) {
	timer := prometheus.NewTimer(customerRequestDuration.WithLabelValues("GET", "/customers/:id/accounts"))
	defer timer.ObserveDuration()

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid customer ID"})
		return
	}

	accounts, err := h.service.GetCustomerAccounts(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"accounts": accounts})
}

func (h *CustomerHandler) CreateDocument(c *gin.Context) {
	timer := prometheus.NewTimer(customerRequestDuration.WithLabelValues("POST", "/documents"))
	defer timer.ObserveDuration()

	var req CreateDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	document, err := h.service.CreateDocument(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, document)
}

func (h *CustomerHandler) GetCustomerDocuments(c *gin.Context) {
	timer := prometheus.NewTimer(customerRequestDuration.WithLabelValues("GET", "/customers/:id/documents"))
	defer timer.ObserveDuration()

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid customer ID"})
		return
	}

	documents, err := h.service.GetCustomerDocuments(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"documents": documents})
}

func (h *CustomerHandler) UpdateKYCStatus(c *gin.Context) {
	timer := prometheus.NewTimer(customerRequestDuration.WithLabelValues("PUT", "/customers/:id/kyc"))
	defer timer.ObserveDuration()

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid customer ID"})
		return
	}

	var req struct {
		Status KYCStatus `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.UpdateKYCStatus(id, req.Status); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	customerUpdatedTotal.WithLabelValues("kyc_status").Inc()

	c.JSON(http.StatusOK, gin.H{"message": "KYC status updated successfully"})
}

func (h *CustomerHandler) GetCustomerActivities(c *gin.Context) {
	timer := prometheus.NewTimer(customerRequestDuration.WithLabelValues("GET", "/customers/:id/activities"))
	defer timer.ObserveDuration()

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid customer ID"})
		return
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))

	activities, err := h.service.GetCustomerActivities(id, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"activities": activities})
}

func setupRoutes(handler *CustomerHandler) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	// CORS middleware
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization")
		
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		
		c.Next()
	})

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy"})
	})

	// Metrics endpoint
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// API routes
	v1 := r.Group("/api/v1")
	{
		customers := v1.Group("/customers")
		{
			customers.POST("", handler.CreateCustomer)
			customers.GET("", handler.ListCustomers)
			customers.GET("/:id", handler.GetCustomer)
			customers.PUT("/:id", handler.UpdateCustomer)
			customers.PUT("/:id/kyc", handler.UpdateKYCStatus)
			customers.GET("/:id/accounts", handler.GetCustomerAccounts)
			customers.GET("/:id/documents", handler.GetCustomerDocuments)
			customers.GET("/:id/activities", handler.GetCustomerActivities)
		}

		v1.POST("/accounts", handler.CreateAccount)
		v1.POST("/documents", handler.CreateDocument)
	}

	return r
}

func main() {
	// Database connection
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://remittance:remittance@postgresql:5432/remittance?sslmode=disable"
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}

	// Auto migrate
	if err := db.AutoMigrate(&Customer{}, &CustomerAccount{}, &CustomerDocument{}, &CustomerActivity{}); err != nil {
		log.Fatal("Failed to migrate database:", err)
	}

	// Initialize service and handler
	service := NewCustomerService(db)
	handler := NewCustomerHandler(service)

	// Setup routes
	router := setupRoutes(handler)

	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:    "0.0.0.0:" + port,
		Handler: router,
	}

	// Graceful shutdown
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	log.Printf("Customer Management Service started on port %s", port)

	// Wait for interrupt signal to gracefully shutdown the server
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("Server forced to shutdown:", err)
	}

	log.Println("Server exited")
}

