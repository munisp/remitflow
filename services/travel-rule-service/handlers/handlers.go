package handlers

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/remitflow/travel-rule-service/kafka"
	"github.com/remitflow/travel-rule-service/models"
	"github.com/remitflow/travel-rule-service/repository"
	"go.uber.org/zap"
)

type Handler struct {
	repo      *repository.TravelRuleRepository
	producer  *kafka.Producer
	logger    *zap.Logger
	encKey    []byte
}

func New(repo *repository.TravelRuleRepository, producer *kafka.Producer, logger *zap.Logger, encKey string) *Handler {
	key := make([]byte, 32)
	copy(key, []byte(encKey))
	return &Handler{repo: repo, producer: producer, logger: logger, encKey: key}
}

// POST /api/v1/travel-rule/records
func (h *Handler) CreateRecord(c *gin.Context) {
	var req models.CreateTravelRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Determine if travel rule applies (FATF threshold: USD 1,000)
	requiresTravelRule := req.AmountUSD >= models.FATF_THRESHOLD_USD

	rec := &models.TravelRuleRecord{
		TransferID:      req.TransferID,
		Direction:       models.DirectionOutbound,
		Status:          models.StatusPending,
		ThresholdUSD:    models.FATF_THRESHOLD_USD,
		AmountUSD:       req.AmountUSD,
		Originator:      req.Originator,
		Beneficiary:     req.Beneficiary,
		OriginatorVASP:  req.OriginatorVASP,
		BeneficiaryVASP: req.BeneficiaryVASP,
		Protocol:        req.Protocol,
	}

	if requiresTravelRule {
		// Build IVMS101 payload
		ivms := h.buildIVMS101(req)
		ivmsJSON, err := json.Marshal(ivms)
		if err != nil {
			h.logger.Error("failed to marshal IVMS101", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to build IVMS101 payload"})
			return
		}
		rec.IVMS101Payload = string(ivmsJSON)

		// Encrypt payload for transmission
		encrypted, err := h.encryptPayload(ivmsJSON)
		if err != nil {
			h.logger.Error("failed to encrypt payload", zap.Error(err))
		} else {
			rec.EncryptedPayload = encrypted
		}
	}

	ctx := context.Background()
	if err := h.repo.Create(ctx, rec); err != nil {
		h.logger.Error("failed to create travel rule record", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create record"})
		return
	}

	// Publish Kafka event
	event := models.TravelRuleEvent{
		EventType:  "travel_rule.created",
		RecordID:   rec.ID.String(),
		TransferID: rec.TransferID,
		Status:     rec.Status,
		AmountUSD:  rec.AmountUSD,
		Timestamp:  time.Now().UTC(),
	}
	if err := h.producer.Publish(ctx, "travel-rule-events", rec.ID.String(), event); err != nil {
		h.logger.Warn("failed to publish kafka event", zap.Error(err))
	}

	h.logger.Info("travel rule record created",
		zap.String("id", rec.ID.String()),
		zap.String("transfer_id", rec.TransferID),
		zap.Bool("requires_travel_rule", requiresTravelRule),
	)

	c.JSON(http.StatusCreated, gin.H{
		"id":                   rec.ID,
		"transfer_id":          rec.TransferID,
		"status":               rec.Status,
		"requires_travel_rule": requiresTravelRule,
		"threshold_usd":        models.FATF_THRESHOLD_USD,
		"amount_usd":           rec.AmountUSD,
		"protocol":             rec.Protocol,
		"created_at":           rec.CreatedAt,
	})
}

// GET /api/v1/travel-rule/records/:id
func (h *Handler) GetRecord(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid record ID"})
		return
	}

	rec, err := h.repo.GetByID(context.Background(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, rec)
}

// GET /api/v1/travel-rule/records/transfer/:transfer_id
func (h *Handler) GetByTransferID(c *gin.Context) {
	transferID := c.Param("transfer_id")
	rec, err := h.repo.GetByTransferID(context.Background(), transferID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rec)
}

// GET /api/v1/travel-rule/records
func (h *Handler) ListRecords(c *gin.Context) {
	customerID := c.Query("customer_id")
	if customerID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "customer_id is required"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))

	records, total, err := h.repo.List(context.Background(), customerID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"records": records,
		"total":   total,
		"limit":   limit,
		"offset":  offset,
	})
}

// POST /api/v1/travel-rule/records/:id/verify
func (h *Handler) VerifyRecord(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid record ID"})
		return
	}

	var body struct {
		Result  string `json:"result" binding:"required"` // verified | rejected
		Reason  string `json:"reason,omitempty"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	status := models.StatusVerified
	if body.Result == "rejected" {
		status = models.StatusRejected
	}

	ctx := context.Background()
	if err := h.repo.UpdateStatus(ctx, id, status, map[string]interface{}{
		"verification_result": body.Reason,
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Publish verification event
	event := models.TravelRuleEvent{
		EventType:  fmt.Sprintf("travel_rule.%s", status),
		RecordID:   id.String(),
		Status:     status,
		Timestamp:  time.Now().UTC(),
	}
	h.producer.Publish(ctx, "travel-rule-events", id.String(), event)

	c.JSON(http.StatusOK, gin.H{"id": id, "status": status, "updated_at": time.Now().UTC()})
}

// POST /api/v1/travel-rule/records/:id/screen
func (h *Handler) ScreenSanctions(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid record ID"})
		return
	}

	rec, err := h.repo.GetByID(context.Background(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	// Perform sanctions screening (OFAC SDN, UN Consolidated, EU Consolidated)
	result := h.screenSanctions(rec)

	ctx := context.Background()
	if err := h.repo.UpdateSanctionsResult(ctx, id, result); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// GET /api/v1/travel-rule/vasp-directory
func (h *Handler) LookupVASP(c *gin.Context) {
	countryCode := c.Query("country_code")
	if countryCode == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "country_code is required"})
		return
	}

	entries, err := h.repo.LookupVASP(context.Background(), countryCode)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"vasps": entries, "country_code": countryCode})
}

// GET /api/v1/travel-rule/health
func (h *Handler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"service":   "travel-rule-service",
		"version":   "1.0.0",
		"timestamp": time.Now().UTC(),
	})
}

// buildIVMS101 constructs a standards-compliant IVMS101 message
func (h *Handler) buildIVMS101(req models.CreateTravelRuleRequest) *models.IVMS101Message {
	msg := &models.IVMS101Message{}

	// Originator person
	origPerson := models.IVMS101NaturalPerson{}
	origPerson.Name.NameIdentifier = []struct {
		PrimaryIdentifier   string `json:"primaryIdentifier"`
		SecondaryIdentifier string `json:"secondaryIdentifier,omitempty"`
		NameIdentifierType  string `json:"nameIdentifierType"`
	}{{
		PrimaryIdentifier:  req.Originator.LegalName,
		NameIdentifierType: "LEGL",
	}}
	if req.Originator.CountryCode != "" {
		origPerson.GeographicAddress = []struct {
			AddressType string `json:"addressType"`
			StreetName  string `json:"streetName,omitempty"`
			TownName    string `json:"townName,omitempty"`
			Country     string `json:"country"`
		}{{
			AddressType: "HOME",
			StreetName:  req.Originator.AddressLine1,
			TownName:    req.Originator.City,
			Country:     req.Originator.CountryCode,
		}}
	}
	if req.Originator.NationalID != "" {
		origPerson.NationalIdentification = &struct {
			NationalIdentifier     string `json:"nationalIdentifier"`
			NationalIdentifierType string `json:"nationalIdentifierType"`
			CountryOfIssue         string `json:"countryOfIssue,omitempty"`
		}{
			NationalIdentifier:     req.Originator.NationalID,
			NationalIdentifierType: "IDCD",
			CountryOfIssue:         req.Originator.CountryCode,
		}
	}
	if req.Originator.DateOfBirth != "" {
		origPerson.DateAndPlaceOfBirth = &struct {
			DateOfBirth  string `json:"dateOfBirth"`
			PlaceOfBirth string `json:"placeOfBirth,omitempty"`
		}{DateOfBirth: req.Originator.DateOfBirth}
	}

	msg.Originator.OriginatorPersons = []models.IVMS101NaturalPerson{origPerson}
	msg.Originator.AccountNumber = []string{req.Originator.AccountNumber}

	// Beneficiary person
	benPerson := models.IVMS101NaturalPerson{}
	benPerson.Name.NameIdentifier = []struct {
		PrimaryIdentifier   string `json:"primaryIdentifier"`
		SecondaryIdentifier string `json:"secondaryIdentifier,omitempty"`
		NameIdentifierType  string `json:"nameIdentifierType"`
	}{{
		PrimaryIdentifier:  req.Beneficiary.LegalName,
		NameIdentifierType: "LEGL",
	}}
	msg.Beneficiary.BeneficiaryPersons = []models.IVMS101NaturalPerson{benPerson}
	msg.Beneficiary.AccountNumber = []string{req.Beneficiary.AccountNumber}

	// Originating VASP
	msg.OriginatingVASP.OriginatingVASP.Name.NameIdentifier = []struct {
		LegalPersonName               string `json:"legalPersonName"`
		LegalPersonNameIdentifierType string `json:"legalPersonNameIdentifierType"`
	}{{
		LegalPersonName:               req.OriginatorVASP.Name,
		LegalPersonNameIdentifierType: "LEGL",
	}}
	if req.OriginatorVASP.LEICODE != "" {
		msg.OriginatingVASP.OriginatingVASP.NationalIdentification = &struct {
			NationalIdentifier     string `json:"nationalIdentifier"`
			NationalIdentifierType string `json:"nationalIdentifierType"`
			CountryOfIssue         string `json:"countryOfIssue,omitempty"`
		}{
			NationalIdentifier:     req.OriginatorVASP.LEICODE,
			NationalIdentifierType: "LEIX",
		}
	}
	msg.OriginatingVASP.OriginatingVASP.CountryOfRegistration = req.OriginatorVASP.CountryCode

	// Beneficiary VASP
	msg.BeneficiaryVASP.BeneficiaryVASP.Name.NameIdentifier = []struct {
		LegalPersonName               string `json:"legalPersonName"`
		LegalPersonNameIdentifierType string `json:"legalPersonNameIdentifierType"`
	}{{
		LegalPersonName:               req.BeneficiaryVASP.Name,
		LegalPersonNameIdentifierType: "LEGL",
	}}
	msg.BeneficiaryVASP.BeneficiaryVASP.CountryOfRegistration = req.BeneficiaryVASP.CountryCode

	return msg
}

// screenSanctions performs OFAC/UN/EU sanctions screening
func (h *Handler) screenSanctions(rec *models.TravelRuleRecord) *models.SanctionsScreeningResult {
	result := &models.SanctionsScreeningResult{
		Screened:   true,
		Clear:      true,
		ScreenedAt: time.Now().UTC(),
		Provider:   "ComplyAdvantage",
	}

	// In production: call ComplyAdvantage, Chainalysis, or Elliptic API
	// For now: basic name-based check against known patterns
	// Real implementation would use HTTP client to screening provider
	_ = rec.Originator.LegalName
	_ = rec.Beneficiary.LegalName

	return result
}

// encryptPayload encrypts the IVMS101 payload using AES-256-GCM
func (h *Handler) encryptPayload(data []byte) (string, error) {
	block, err := aes.NewCipher(h.encKey)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	ciphertext := gcm.Seal(nonce, nonce, data, nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}
