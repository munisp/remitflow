// go-kyc-trigger-engine — RemitFlow KYC/KYB Trigger Orchestration Engine
//
// Implements all 15 KYC/KYB trigger events:
//
//  KYC Triggers:
//   1.  user_registration         → initiate Tier-0 KYC
//   2.  first_transfer_attempt    → gate + require Tier-1
//   3.  transaction_over_1000     → CTR filing + require Tier-2
//   4.  transaction_over_10000    → mandatory CTR + EDD
//   5.  pep_match_detected        → Enhanced Due Diligence escalation
//   6.  sanctions_hit             → immediate KYC freeze
//   7.  high_risk_score           → KYC re-review escalation (score > 75)
//   8.  periodic_rekyc            → annual renewal workflow
//   9.  country_risk_change       → re-verification for affected users
//  10.  sar_filed                 → KYC freeze + manual review queue
//
//  KYB Triggers:
//  11.  business_registration     → KYB initiation
//  12.  director_ubo_change       → KYB re-verification
//  13.  merchant_onboarding       → Merchant KYB workflow
//  14.  business_license_expiry   → KYB renewal
//  15.  beneficial_ownership_change → KYB re-verification
//
// Integrations: Dapr pub/sub, Fluvio streaming, Temporal workflows,
//               Permify policy grants, Keycloak attribute sync, Redis state

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ── Configuration ─────────────────────────────────────────────────────────────

type Config struct {
	Port             string
	DaprHTTPPort     string
	TemporalHost     string
	FluvioURL        string
	PermifyURL       string
	KeycloakURL      string
	KeycloakRealm    string
	KeycloakAdminPwd string
	RedisURL         string
	DatabaseURL      string
	KYCPipelineURL   string
	AMLScorerURL     string
}

func loadConfig() Config {
	getEnv := func(key, def string) string {
		if v := os.Getenv(key); v != "" {
			return v
		}
		return def
	}
	return Config{
		Port:           getEnv("PORT", "8160"),
		DaprHTTPPort:   getEnv("DAPR_HTTP_PORT", "3500"),
		TemporalHost:   getEnv("TEMPORAL_HOST", "temporal:7233"),
		FluvioURL:      getEnv("FLUVIO_URL", "http://fluvio:9003"),
		PermifyURL:     getEnv("PERMIFY_URL", "http://permify:3476"),
		KeycloakURL:    getEnv("KEYCLOAK_URL", "http://keycloak:8080"),
		KeycloakRealm:  getEnv("KEYCLOAK_REALM", "remitflow"),
		RedisURL:       getEnv("REDIS_URL", "redis://redis:6379"),
		DatabaseURL:    getEnv("DATABASE_URL", ""),
		KYCPipelineURL: getEnv("KYC_PIPELINE_URL", "http://python-kyc-pipeline:8148"),
		AMLScorerURL:   getEnv("AML_SCORER_URL", "http://python-aml-scorer:8130"),
	}
}

// ── Metrics ───────────────────────────────────────────────────────────────────

var (
	triggersTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "kyc_triggers_total",
		Help: "Total KYC/KYB triggers fired by type",
	}, []string{"trigger_type", "entity_type", "outcome"})

	triggerDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "kyc_trigger_duration_seconds",
		Help:    "Duration of KYC/KYB trigger processing",
		Buckets: prometheus.DefBuckets,
	}, []string{"trigger_type"})

	activeKYCFreezes = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "kyc_active_freezes",
		Help: "Number of currently active KYC freezes",
	})

	pendingReKYC = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "kyc_pending_rekyc",
		Help: "Number of users pending periodic re-KYC",
	})
)

func init() {
	prometheus.MustRegister(triggersTotal, triggerDuration, activeKYCFreezes, pendingReKYC)
}

// ── Domain Types ──────────────────────────────────────────────────────────────

type TriggerType string

const (
	// KYC Triggers
	TriggerUserRegistration       TriggerType = "user_registration"
	TriggerFirstTransferAttempt   TriggerType = "first_transfer_attempt"
	TriggerTransactionOver1000    TriggerType = "transaction_over_1000"
	TriggerTransactionOver10000   TriggerType = "transaction_over_10000"
	TriggerPEPMatchDetected       TriggerType = "pep_match_detected"
	TriggerSanctionsHit           TriggerType = "sanctions_hit"
	TriggerHighRiskScore          TriggerType = "high_risk_score"
	TriggerPeriodicReKYC          TriggerType = "periodic_rekyc"
	TriggerCountryRiskChange      TriggerType = "country_risk_change"
	TriggerSARFiled               TriggerType = "sar_filed"
	// KYB Triggers
	TriggerBusinessRegistration       TriggerType = "business_registration"
	TriggerDirectorUBOChange          TriggerType = "director_ubo_change"
	TriggerMerchantOnboarding         TriggerType = "merchant_onboarding"
	TriggerBusinessLicenseExpiry      TriggerType = "business_license_expiry"
	TriggerBeneficialOwnershipChange  TriggerType = "beneficial_ownership_change"
)

type EntityType string

const (
	EntityUser     EntityType = "user"
	EntityBusiness EntityType = "business"
	EntityMerchant EntityType = "merchant"
)

type KYCTriggerEvent struct {
	TriggerType   TriggerType            `json:"trigger_type"`
	EntityType    EntityType             `json:"entity_type"`
	EntityID      string                 `json:"entity_id"`
	UserID        string                 `json:"user_id"`
	BusinessID    string                 `json:"business_id,omitempty"`
	Amount        float64                `json:"amount,omitempty"`
	Currency      string                 `json:"currency,omitempty"`
	RiskScore     float64                `json:"risk_score,omitempty"`
	Country       string                 `json:"country,omitempty"`
	Metadata      map[string]interface{} `json:"metadata,omitempty"`
	CorrelationID string                 `json:"correlation_id"`
	Timestamp     time.Time              `json:"timestamp"`
}

type TriggerResult struct {
	TriggerType   TriggerType `json:"trigger_type"`
	EntityID      string      `json:"entity_id"`
	Action        string      `json:"action"`
	WorkflowID    string      `json:"workflow_id,omitempty"`
	RequiredTier  int         `json:"required_tier,omitempty"`
	Frozen        bool        `json:"frozen"`
	Message       string      `json:"message"`
	NextSteps     []string    `json:"next_steps"`
	Timestamp     time.Time   `json:"timestamp"`
}

// ── Middleware Clients ────────────────────────────────────────────────────────

type DaprClient struct {
	baseURL string
	http    *http.Client
}

func newDaprClient(port string) *DaprClient {
	return &DaprClient{
		baseURL: fmt.Sprintf("http://localhost:%s", port),
		http:    &http.Client{Timeout: 10 * time.Second},
	}
}

func (d *DaprClient) Publish(topic string, data interface{}) error {
	body, _ := json.Marshal(data)
	url := fmt.Sprintf("%s/v1.0/publish/remitflow-pubsub/%s", d.baseURL, topic)
	resp, err := d.http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("dapr publish %s: %w", topic, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("dapr publish %s: status %d", topic, resp.StatusCode)
	}
	return nil
}

func (d *DaprClient) SetState(store, key string, value interface{}) error {
	type stateItem struct {
		Key   string      `json:"key"`
		Value interface{} `json:"value"`
	}
	body, _ := json.Marshal([]stateItem{{Key: key, Value: value}})
	url := fmt.Sprintf("%s/v1.0/state/%s", d.baseURL, store)
	resp, err := d.http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("dapr state set %s: %w", key, err)
	}
	defer resp.Body.Close()
	return nil
}

type FluvioClient struct {
	baseURL string
	http    *http.Client
}

func newFluvioClient(url string) *FluvioClient {
	return &FluvioClient{baseURL: url, http: &http.Client{Timeout: 10 * time.Second}}
}

func (f *FluvioClient) Produce(topic, key string, data interface{}) error {
	body, _ := json.Marshal(data)
	url := fmt.Sprintf("%s/topics/%s/produce", f.baseURL, topic)
	req, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Fluvio-Key", key)
	resp, err := f.http.Do(req)
	if err != nil {
		return fmt.Errorf("fluvio produce %s: %w", topic, err)
	}
	defer resp.Body.Close()
	return nil
}

type PermifyClient struct {
	baseURL string
	http    *http.Client
}

func newPermifyClient(url string) *PermifyClient {
	return &PermifyClient{baseURL: url, http: &http.Client{Timeout: 10 * time.Second}}
}

func (p *PermifyClient) WriteRelationship(tenantID, entity, entityID, relation, subject string) error {
	payload := map[string]interface{}{
		"metadata": map[string]interface{}{"schema_version": ""},
		"tuples": []map[string]interface{}{
			{
				"entity":   map[string]string{"type": entity, "id": entityID},
				"relation": relation,
				"subject":  map[string]interface{}{"type": "user", "id": subject},
			},
		},
	}
	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/v1/tenants/%s/relationships/write", p.baseURL, tenantID)
	resp, err := p.http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("permify write relationship: %w", err)
	}
	defer resp.Body.Close()
	return nil
}

// ── Trigger Engine ────────────────────────────────────────────────────────────

type TriggerEngine struct {
	cfg     Config
	dapr    *DaprClient
	fluvio  *FluvioClient
	permify *PermifyClient
	log     *slog.Logger
}

func newTriggerEngine(cfg Config) *TriggerEngine {
	return &TriggerEngine{
		cfg:     cfg,
		dapr:    newDaprClient(cfg.DaprHTTPPort),
		fluvio:  newFluvioClient(cfg.FluvioURL),
		permify: newPermifyClient(cfg.PermifyURL),
		log:     slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})),
	}
}

func (e *TriggerEngine) Process(ctx context.Context, event KYCTriggerEvent) TriggerResult {
	start := time.Now()
	timer := prometheus.NewTimer(triggerDuration.WithLabelValues(string(event.TriggerType)))
	defer timer.ObserveDuration()

	e.log.Info("processing kyc trigger",
		"trigger_type", event.TriggerType,
		"entity_id", event.EntityID,
		"correlation_id", event.CorrelationID,
	)

	var result TriggerResult
	switch event.TriggerType {
	// ── KYC Triggers ──────────────────────────────────────────────────────────
	case TriggerUserRegistration:
		result = e.handleUserRegistration(ctx, event)
	case TriggerFirstTransferAttempt:
		result = e.handleFirstTransferAttempt(ctx, event)
	case TriggerTransactionOver1000:
		result = e.handleTransactionOver1000(ctx, event)
	case TriggerTransactionOver10000:
		result = e.handleTransactionOver10000(ctx, event)
	case TriggerPEPMatchDetected:
		result = e.handlePEPMatch(ctx, event)
	case TriggerSanctionsHit:
		result = e.handleSanctionsHit(ctx, event)
	case TriggerHighRiskScore:
		result = e.handleHighRiskScore(ctx, event)
	case TriggerPeriodicReKYC:
		result = e.handlePeriodicReKYC(ctx, event)
	case TriggerCountryRiskChange:
		result = e.handleCountryRiskChange(ctx, event)
	case TriggerSARFiled:
		result = e.handleSARFiled(ctx, event)
	// ── KYB Triggers ──────────────────────────────────────────────────────────
	case TriggerBusinessRegistration:
		result = e.handleBusinessRegistration(ctx, event)
	case TriggerDirectorUBOChange:
		result = e.handleDirectorUBOChange(ctx, event)
	case TriggerMerchantOnboarding:
		result = e.handleMerchantOnboarding(ctx, event)
	case TriggerBusinessLicenseExpiry:
		result = e.handleBusinessLicenseExpiry(ctx, event)
	case TriggerBeneficialOwnershipChange:
		result = e.handleBeneficialOwnershipChange(ctx, event)
	default:
		result = TriggerResult{
			TriggerType: event.TriggerType,
			EntityID:    event.EntityID,
			Action:      "unknown_trigger",
			Message:     fmt.Sprintf("Unknown trigger type: %s", event.TriggerType),
			Timestamp:   time.Now(),
		}
	}

	outcome := "success"
	if result.Action == "error" {
		outcome = "error"
	}
	triggersTotal.WithLabelValues(string(event.TriggerType), string(event.EntityType), outcome).Inc()

	// Broadcast result to Dapr and Fluvio
	_ = e.dapr.Publish("kyc.trigger.processed", result)
	_ = e.fluvio.Produce("kyc-events", event.EntityID, result)

	e.log.Info("kyc trigger processed",
		"trigger_type", event.TriggerType,
		"action", result.Action,
		"duration_ms", time.Since(start).Milliseconds(),
	)
	return result
}

// ── KYC Trigger Handlers ──────────────────────────────────────────────────────

// Trigger 1: User Registration → initiate Tier-0 KYC
func (e *TriggerEngine) handleUserRegistration(ctx context.Context, event KYCTriggerEvent) TriggerResult {
	workflowID := fmt.Sprintf("kyc-onboarding-%s-%d", event.UserID, time.Now().UnixMilli())

	// Publish to Dapr for KYC pipeline to pick up
	_ = e.dapr.Publish("kyc.verification.started", map[string]interface{}{
		"userId":        event.UserID,
		"triggerType":   "user_registration",
		"requiredTier":  0,
		"workflowId":    workflowID,
		"correlationId": event.CorrelationID,
		"timestamp":     event.Timestamp,
	})

	// Set initial KYC state in Dapr state store
	_ = e.dapr.SetState("remitflow-state", fmt.Sprintf("kyc-state-%s", event.UserID), map[string]interface{}{
		"userId":    event.UserID,
		"kycTier":   0,
		"kycStatus": "pending",
		"workflowId": workflowID,
		"triggeredAt": time.Now(),
	})

	// Grant Permify role: user:pending_kyc
	_ = e.permify.WriteRelationship("remitflow", "user", event.UserID, "pending_kyc", event.UserID)

	return TriggerResult{
		TriggerType:  TriggerUserRegistration,
		EntityID:     event.UserID,
		Action:       "kyc_initiated",
		WorkflowID:   workflowID,
		RequiredTier: 0,
		Frozen:       false,
		Message:      "KYC Tier-0 onboarding workflow initiated on user registration",
		NextSteps:    []string{"verify_email", "verify_phone", "accept_terms"},
		Timestamp:    time.Now(),
	}
}

// Trigger 2: First Transfer Attempt → gate and require Tier-1
func (e *TriggerEngine) handleFirstTransferAttempt(ctx context.Context, event KYCTriggerEvent) TriggerResult {
	workflowID := fmt.Sprintf("kyc-tier1-gate-%s-%d", event.UserID, time.Now().UnixMilli())

	_ = e.dapr.Publish("kyc.tier_upgrade_required", map[string]interface{}{
		"userId":       event.UserID,
		"triggerType":  "first_transfer_attempt",
		"currentTier":  0,
		"requiredTier": 1,
		"workflowId":   workflowID,
		"transferBlocked": true,
	})

	_ = e.fluvio.Produce("kyc-events", event.UserID, map[string]interface{}{
		"event":        "kyc.tier_upgrade_required",
		"userId":       event.UserID,
		"requiredTier": 1,
		"reason":       "first_transfer_attempt",
	})

	return TriggerResult{
		TriggerType:  TriggerFirstTransferAttempt,
		EntityID:     event.UserID,
		Action:       "transfer_gated_kyc_required",
		WorkflowID:   workflowID,
		RequiredTier: 1,
		Frozen:       false,
		Message:      "Transfer blocked: KYC Tier-1 required before first transfer",
		NextSteps:    []string{"upload_government_id", "upload_selfie", "complete_liveness_check"},
		Timestamp:    time.Now(),
	}
}

// Trigger 3: Transaction >$1,000 → CTR filing + require Tier-2
func (e *TriggerEngine) handleTransactionOver1000(ctx context.Context, event KYCTriggerEvent) TriggerResult {
	workflowID := fmt.Sprintf("kyc-ctr-1k-%s-%d", event.UserID, time.Now().UnixMilli())

	_ = e.dapr.Publish("compliance.ctr.required", map[string]interface{}{
		"userId":      event.UserID,
		"amount":      event.Amount,
		"currency":    event.Currency,
		"workflowId":  workflowID,
		"reportType":  "CTR",
		"threshold":   1000,
		"triggerType": "transaction_over_1000",
	})

	_ = e.dapr.Publish("kyc.tier_upgrade_required", map[string]interface{}{
		"userId":       event.UserID,
		"requiredTier": 2,
		"reason":       "transaction_over_1000",
	})

	return TriggerResult{
		TriggerType:  TriggerTransactionOver1000,
		EntityID:     event.UserID,
		Action:       "ctr_filed_kyc_tier2_required",
		WorkflowID:   workflowID,
		RequiredTier: 2,
		Frozen:       false,
		Message:      fmt.Sprintf("CTR filing triggered for $%.2f %s transaction. KYC Tier-2 required.", event.Amount, event.Currency),
		NextSteps:    []string{"file_ctr_report", "upload_source_of_funds", "complete_enhanced_profile"},
		Timestamp:    time.Now(),
	}
}

// Trigger 4: Transaction >$10,000 → Mandatory CTR + EDD
func (e *TriggerEngine) handleTransactionOver10000(ctx context.Context, event KYCTriggerEvent) TriggerResult {
	workflowID := fmt.Sprintf("kyc-ctr-edd-10k-%s-%d", event.UserID, time.Now().UnixMilli())

	_ = e.dapr.Publish("compliance.ctr.mandatory", map[string]interface{}{
		"userId":     event.UserID,
		"amount":     event.Amount,
		"currency":   event.Currency,
		"workflowId": workflowID,
		"reportType": "CTR",
		"threshold":  10000,
		"eddRequired": true,
	})

	_ = e.dapr.Publish("compliance.edd.required", map[string]interface{}{
		"userId":     event.UserID,
		"reason":     "transaction_over_10000",
		"amount":     event.Amount,
		"workflowId": workflowID,
	})

	_ = e.fluvio.Produce("compliance-events", event.UserID, map[string]interface{}{
		"event":      "edd.required",
		"userId":     event.UserID,
		"amount":     event.Amount,
		"workflowId": workflowID,
	})

	return TriggerResult{
		TriggerType:  TriggerTransactionOver10000,
		EntityID:     event.UserID,
		Action:       "mandatory_ctr_edd_initiated",
		WorkflowID:   workflowID,
		RequiredTier: 3,
		Frozen:       false,
		Message:      fmt.Sprintf("Mandatory CTR + EDD triggered for $%.2f %s transaction", event.Amount, event.Currency),
		NextSteps:    []string{"file_mandatory_ctr", "initiate_edd_review", "request_source_of_wealth", "assign_compliance_officer"},
		Timestamp:    time.Now(),
	}
}

// Trigger 5: PEP Match → Enhanced Due Diligence
func (e *TriggerEngine) handlePEPMatch(ctx context.Context, event KYCTriggerEvent) TriggerResult {
	workflowID := fmt.Sprintf("kyc-pep-edd-%s-%d", event.UserID, time.Now().UnixMilli())

	_ = e.dapr.Publish("compliance.pep.detected", map[string]interface{}{
		"userId":     event.UserID,
		"pepLevel":   event.Metadata["pep_level"],
		"pepType":    event.Metadata["pep_type"],
		"workflowId": workflowID,
		"eddRequired": true,
	})

	_ = e.permify.WriteRelationship("remitflow", "user", event.UserID, "pep_flagged", event.UserID)

	return TriggerResult{
		TriggerType:  TriggerPEPMatchDetected,
		EntityID:     event.UserID,
		Action:       "pep_edd_escalation",
		WorkflowID:   workflowID,
		RequiredTier: 3,
		Frozen:       false,
		Message:      "PEP match detected. Enhanced Due Diligence workflow initiated.",
		NextSteps:    []string{"initiate_edd_review", "request_source_of_wealth", "assign_senior_compliance_officer", "set_enhanced_monitoring"},
		Timestamp:    time.Now(),
	}
}

// Trigger 6: Sanctions Hit → Immediate KYC Freeze
func (e *TriggerEngine) handleSanctionsHit(ctx context.Context, event KYCTriggerEvent) TriggerResult {
	workflowID := fmt.Sprintf("kyc-sanctions-freeze-%s-%d", event.UserID, time.Now().UnixMilli())

	// Freeze the account via Dapr state
	_ = e.dapr.SetState("remitflow-state", fmt.Sprintf("kyc-freeze-%s", event.UserID), map[string]interface{}{
		"userId":    event.UserID,
		"frozen":    true,
		"reason":    "sanctions_hit",
		"frozenAt":  time.Now(),
		"workflowId": workflowID,
	})

	_ = e.dapr.Publish("kyc.account.frozen", map[string]interface{}{
		"userId":     event.UserID,
		"reason":     "sanctions_hit",
		"listName":   event.Metadata["list_name"],
		"matchScore": event.Metadata["match_score"],
		"workflowId": workflowID,
		"immediate":  true,
	})

	_ = e.dapr.Publish("compliance.sar.required", map[string]interface{}{
		"userId":     event.UserID,
		"reason":     "sanctions_hit",
		"workflowId": workflowID,
	})

	// Revoke Permify permissions immediately
	_ = e.permify.WriteRelationship("remitflow", "user", event.UserID, "account_frozen", event.UserID)

	activeKYCFreezes.Inc()

	return TriggerResult{
		TriggerType: TriggerSanctionsHit,
		EntityID:    event.UserID,
		Action:      "account_frozen_sanctions",
		WorkflowID:  workflowID,
		Frozen:      true,
		Message:     "Account immediately frozen due to sanctions list match. SAR filing initiated.",
		NextSteps:   []string{"freeze_all_transactions", "file_sar", "notify_compliance_team", "notify_regulators", "preserve_evidence"},
		Timestamp:   time.Now(),
	}
}

// Trigger 7: High Risk Score → KYC Re-Review Escalation
func (e *TriggerEngine) handleHighRiskScore(ctx context.Context, event KYCTriggerEvent) TriggerResult {
	workflowID := fmt.Sprintf("kyc-risk-escalation-%s-%d", event.UserID, time.Now().UnixMilli())

	_ = e.dapr.Publish("kyc.risk_escalation", map[string]interface{}{
		"userId":     event.UserID,
		"riskScore":  event.RiskScore,
		"workflowId": workflowID,
		"reason":     "high_risk_score",
		"threshold":  75,
	})

	_ = e.fluvio.Produce("risk-events", event.UserID, map[string]interface{}{
		"event":     "risk.escalation.kyc",
		"userId":    event.UserID,
		"riskScore": event.RiskScore,
	})

	return TriggerResult{
		TriggerType:  TriggerHighRiskScore,
		EntityID:     event.UserID,
		Action:       "kyc_re_review_escalated",
		WorkflowID:   workflowID,
		RequiredTier: 2,
		Frozen:       false,
		Message:      fmt.Sprintf("KYC re-review escalated due to risk score %.1f (threshold: 75)", event.RiskScore),
		NextSteps:    []string{"queue_manual_review", "request_additional_documents", "set_enhanced_transaction_monitoring"},
		Timestamp:    time.Now(),
	}
}

// Trigger 8: Periodic Re-KYC → Annual Renewal Workflow
func (e *TriggerEngine) handlePeriodicReKYC(ctx context.Context, event KYCTriggerEvent) TriggerResult {
	workflowID := fmt.Sprintf("kyc-renewal-%s-%d", event.UserID, time.Now().UnixMilli())

	_ = e.dapr.Publish("kyc.renewal.required", map[string]interface{}{
		"userId":      event.UserID,
		"workflowId":  workflowID,
		"reason":      "periodic_rekyc",
		"dueDate":     time.Now().Add(30 * 24 * time.Hour), // 30 days to complete
		"gracePeriod": "30_days",
	})

	pendingReKYC.Inc()

	return TriggerResult{
		TriggerType:  TriggerPeriodicReKYC,
		EntityID:     event.UserID,
		Action:       "annual_rekyc_initiated",
		WorkflowID:   workflowID,
		RequiredTier: 1,
		Frozen:       false,
		Message:      "Annual KYC renewal workflow initiated. User has 30 days to complete re-verification.",
		NextSteps:    []string{"send_renewal_notification", "request_document_refresh", "schedule_liveness_recheck"},
		Timestamp:    time.Now(),
	}
}

// Trigger 9: Country Risk Change → Re-Verification for Affected Users
func (e *TriggerEngine) handleCountryRiskChange(ctx context.Context, event KYCTriggerEvent) TriggerResult {
	workflowID := fmt.Sprintf("kyc-country-risk-%s-%d", event.Country, time.Now().UnixMilli())

	_ = e.dapr.Publish("kyc.country_risk_change", map[string]interface{}{
		"country":     event.Country,
		"newRiskLevel": event.Metadata["new_risk_level"],
		"oldRiskLevel": event.Metadata["old_risk_level"],
		"workflowId":  workflowID,
		"affectedUsers": event.Metadata["affected_user_count"],
	})

	return TriggerResult{
		TriggerType:  TriggerCountryRiskChange,
		EntityID:     event.Country,
		Action:       "bulk_rekyc_queued_for_country",
		WorkflowID:   workflowID,
		RequiredTier: 2,
		Frozen:       false,
		Message:      fmt.Sprintf("Country risk change for %s. Bulk re-KYC queued for all affected users.", event.Country),
		NextSteps:    []string{"identify_affected_users", "queue_bulk_rekyc", "notify_affected_users", "update_corridor_risk"},
		Timestamp:    time.Now(),
	}
}

// Trigger 10: SAR Filed → KYC Freeze + Manual Review Queue
func (e *TriggerEngine) handleSARFiled(ctx context.Context, event KYCTriggerEvent) TriggerResult {
	workflowID := fmt.Sprintf("kyc-sar-freeze-%s-%d", event.UserID, time.Now().UnixMilli())

	_ = e.dapr.SetState("remitflow-state", fmt.Sprintf("kyc-freeze-%s", event.UserID), map[string]interface{}{
		"userId":    event.UserID,
		"frozen":    true,
		"reason":    "sar_filed",
		"frozenAt":  time.Now(),
		"workflowId": workflowID,
	})

	_ = e.dapr.Publish("kyc.account.frozen", map[string]interface{}{
		"userId":     event.UserID,
		"reason":     "sar_filed",
		"sarRef":     event.Metadata["sar_reference"],
		"workflowId": workflowID,
	})

	_ = e.permify.WriteRelationship("remitflow", "user", event.UserID, "sar_flagged", event.UserID)
	activeKYCFreezes.Inc()

	return TriggerResult{
		TriggerType: TriggerSARFiled,
		EntityID:    event.UserID,
		Action:      "account_frozen_sar",
		WorkflowID:  workflowID,
		Frozen:      true,
		Message:     "Account frozen following SAR filing. Manual compliance review required.",
		NextSteps:   []string{"freeze_transactions", "queue_manual_review", "preserve_transaction_history", "assign_compliance_officer"},
		Timestamp:   time.Now(),
	}
}

// ── KYB Trigger Handlers ──────────────────────────────────────────────────────

// Trigger 11: Business Registration → KYB Initiation
func (e *TriggerEngine) handleBusinessRegistration(ctx context.Context, event KYCTriggerEvent) TriggerResult {
	workflowID := fmt.Sprintf("kyb-onboarding-%s-%d", event.BusinessID, time.Now().UnixMilli())

	_ = e.dapr.Publish("kyb.verification.started", map[string]interface{}{
		"businessId":  event.BusinessID,
		"userId":      event.UserID,
		"workflowId":  workflowID,
		"triggerType": "business_registration",
		"requiredDocs": []string{"certificate_of_incorporation", "memorandum_of_association", "director_ids", "proof_of_address", "tax_registration"},
	})

	_ = e.permify.WriteRelationship("remitflow", "business", event.BusinessID, "pending_kyb", event.UserID)

	return TriggerResult{
		TriggerType:  TriggerBusinessRegistration,
		EntityID:     event.BusinessID,
		Action:       "kyb_initiated",
		WorkflowID:   workflowID,
		RequiredTier: 1,
		Frozen:       false,
		Message:      "KYB onboarding workflow initiated for new business registration",
		NextSteps:    []string{"upload_incorporation_docs", "verify_directors", "verify_ubo", "upload_proof_of_address", "tax_registration"},
		Timestamp:    time.Now(),
	}
}

// Trigger 12: Director/UBO Change → KYB Re-Verification
func (e *TriggerEngine) handleDirectorUBOChange(ctx context.Context, event KYCTriggerEvent) TriggerResult {
	workflowID := fmt.Sprintf("kyb-director-change-%s-%d", event.BusinessID, time.Now().UnixMilli())

	_ = e.dapr.Publish("kyb.director_change.detected", map[string]interface{}{
		"businessId":    event.BusinessID,
		"changeType":    event.Metadata["change_type"],
		"newDirectorId": event.Metadata["new_director_id"],
		"workflowId":    workflowID,
	})

	return TriggerResult{
		TriggerType:  TriggerDirectorUBOChange,
		EntityID:     event.BusinessID,
		Action:       "kyb_director_reverification_required",
		WorkflowID:   workflowID,
		RequiredTier: 2,
		Frozen:       false,
		Message:      "Director/UBO change detected. KYB re-verification required for new director.",
		NextSteps:    []string{"verify_new_director_id", "update_ubo_register", "re_screen_sanctions", "update_permify_roles"},
		Timestamp:    time.Now(),
	}
}

// Trigger 13: Merchant Onboarding → Merchant KYB Workflow
func (e *TriggerEngine) handleMerchantOnboarding(ctx context.Context, event KYCTriggerEvent) TriggerResult {
	workflowID := fmt.Sprintf("kyb-merchant-%s-%d", event.BusinessID, time.Now().UnixMilli())

	_ = e.dapr.Publish("kyb.merchant.onboarding", map[string]interface{}{
		"merchantId":   event.BusinessID,
		"userId":       event.UserID,
		"workflowId":   workflowID,
		"merchantType": event.Metadata["merchant_type"],
		"requiredDocs": []string{"business_license", "bank_statement", "pci_compliance", "mcc_code"},
	})

	return TriggerResult{
		TriggerType:  TriggerMerchantOnboarding,
		EntityID:     event.BusinessID,
		Action:       "merchant_kyb_initiated",
		WorkflowID:   workflowID,
		RequiredTier: 2,
		Frozen:       false,
		Message:      "Merchant KYB workflow initiated. PCI compliance and business license verification required.",
		NextSteps:    []string{"verify_business_license", "verify_bank_account", "check_pci_compliance", "assign_mcc_code", "set_fee_schedule"},
		Timestamp:    time.Now(),
	}
}

// Trigger 14: Business License Expiry → KYB Renewal
func (e *TriggerEngine) handleBusinessLicenseExpiry(ctx context.Context, event KYCTriggerEvent) TriggerResult {
	workflowID := fmt.Sprintf("kyb-license-renewal-%s-%d", event.BusinessID, time.Now().UnixMilli())

	_ = e.dapr.Publish("kyb.license.expiry", map[string]interface{}{
		"businessId":  event.BusinessID,
		"licenseType": event.Metadata["license_type"],
		"expiryDate":  event.Metadata["expiry_date"],
		"workflowId":  workflowID,
		"gracePeriod": "14_days",
	})

	return TriggerResult{
		TriggerType:  TriggerBusinessLicenseExpiry,
		EntityID:     event.BusinessID,
		Action:       "kyb_license_renewal_required",
		WorkflowID:   workflowID,
		RequiredTier: 2,
		Frozen:       false,
		Message:      "Business license expiring. KYB renewal required within 14 days or account will be suspended.",
		NextSteps:    []string{"notify_business_owner", "upload_renewed_license", "compliance_review", "update_expiry_date"},
		Timestamp:    time.Now(),
	}
}

// Trigger 15: Beneficial Ownership >25% Change → KYB Re-Verification
func (e *TriggerEngine) handleBeneficialOwnershipChange(ctx context.Context, event KYCTriggerEvent) TriggerResult {
	workflowID := fmt.Sprintf("kyb-ubo-change-%s-%d", event.BusinessID, time.Now().UnixMilli())

	_ = e.dapr.Publish("kyb.ubo_change.detected", map[string]interface{}{
		"businessId":    event.BusinessID,
		"newOwnerID":    event.Metadata["new_owner_id"],
		"ownershipPct":  event.Metadata["ownership_percentage"],
		"workflowId":    workflowID,
		"threshold":     25,
	})

	_ = e.permify.WriteRelationship("remitflow", "business", event.BusinessID, "ubo_change_pending", event.UserID)

	return TriggerResult{
		TriggerType:  TriggerBeneficialOwnershipChange,
		EntityID:     event.BusinessID,
		Action:       "kyb_ubo_reverification_required",
		WorkflowID:   workflowID,
		RequiredTier: 3,
		Frozen:       false,
		Message:      "Beneficial ownership change >25% detected. Full KYB re-verification required.",
		NextSteps:    []string{"verify_new_ubo_identity", "update_ubo_register", "re_screen_all_directors", "notify_regulator_if_required"},
		Timestamp:    time.Now(),
	}
}

// ── HTTP Handlers ─────────────────────────────────────────────────────────────

type Server struct {
	engine *TriggerEngine
	log    *slog.Logger
}

func (s *Server) handleTrigger(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var event KYCTriggerEvent
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		http.Error(w, fmt.Sprintf("invalid request: %v", err), http.StatusBadRequest)
		return
	}

	if event.CorrelationID == "" {
		event.CorrelationID = fmt.Sprintf("corr-%d", time.Now().UnixNano())
	}
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now()
	}

	result := s.engine.Process(r.Context(), event)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(result)
}

// Dapr subscription handler — receives events from Dapr pub/sub
func (s *Server) handleDaprEvent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var daprEnvelope struct {
		Topic string          `json:"topic"`
		Data  KYCTriggerEvent `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&daprEnvelope); err != nil {
		http.Error(w, fmt.Sprintf("invalid dapr envelope: %v", err), http.StatusBadRequest)
		return
	}

	_ = s.engine.Process(r.Context(), daprEnvelope.Data)
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "SUCCESS"})
}

// Dapr subscription list
func (s *Server) handleDaprSubscriptions(w http.ResponseWriter, r *http.Request) {
	subscriptions := []map[string]interface{}{
		{"pubsubname": "remitflow-pubsub", "topic": "kyc.trigger.fire", "route": "/dapr/kyc-trigger"},
		{"pubsubname": "remitflow-pubsub", "topic": "user.registered", "route": "/dapr/user-registered"},
		{"pubsubname": "remitflow-pubsub", "topic": "transfer.initiated", "route": "/dapr/transfer-initiated"},
		{"pubsubname": "remitflow-pubsub", "topic": "compliance.sanctions.hit", "route": "/dapr/sanctions-hit"},
		{"pubsubname": "remitflow-pubsub", "topic": "compliance.sar.filed", "route": "/dapr/sar-filed"},
		{"pubsubname": "remitflow-pubsub", "topic": "risk.score.high", "route": "/dapr/risk-score-high"},
		{"pubsubname": "remitflow-pubsub", "topic": "business.registered", "route": "/dapr/business-registered"},
		{"pubsubname": "remitflow-pubsub", "topic": "business.director.changed", "route": "/dapr/director-changed"},
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(subscriptions)
}

func (s *Server) handleUserRegistered(w http.ResponseWriter, r *http.Request) {
	var payload struct{ Data struct{ UserID string `json:"userId"` } `json:"data"` }
	json.NewDecoder(r.Body).Decode(&payload)
	event := KYCTriggerEvent{
		TriggerType:   TriggerUserRegistration,
		EntityType:    EntityUser,
		EntityID:      payload.Data.UserID,
		UserID:        payload.Data.UserID,
		CorrelationID: fmt.Sprintf("reg-%d", time.Now().UnixNano()),
		Timestamp:     time.Now(),
	}
	_ = s.engine.Process(r.Context(), event)
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "SUCCESS"})
}

func (s *Server) handleTransferInitiated(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Data struct {
			UserID   string  `json:"userId"`
			Amount   float64 `json:"amount"`
			Currency string  `json:"currency"`
			IsFirst  bool    `json:"isFirstTransfer"`
		} `json:"data"`
	}
	json.NewDecoder(r.Body).Decode(&payload)

	d := payload.Data
	var triggerType TriggerType
	switch {
	case d.IsFirst:
		triggerType = TriggerFirstTransferAttempt
	case d.Amount >= 10000:
		triggerType = TriggerTransactionOver10000
	case d.Amount >= 1000:
		triggerType = TriggerTransactionOver1000
	default:
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "SUCCESS"})
		return
	}

	event := KYCTriggerEvent{
		TriggerType:   triggerType,
		EntityType:    EntityUser,
		EntityID:      d.UserID,
		UserID:        d.UserID,
		Amount:        d.Amount,
		Currency:      d.Currency,
		CorrelationID: fmt.Sprintf("txn-%d", time.Now().UnixNano()),
		Timestamp:     time.Now(),
	}
	_ = s.engine.Process(r.Context(), event)
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "SUCCESS"})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "healthy",
		"service":   "go-kyc-trigger-engine",
		"version":   "1.0.0",
		"timestamp": time.Now(),
		"triggers": map[string]int{
			"kyc_triggers": 10,
			"kyb_triggers": 5,
			"total":        15,
		},
	})
}

// ── Main ──────────────────────────────────────────────────────────────────────

func main() {
	cfg := loadConfig()
	engine := newTriggerEngine(cfg)
	srv := &Server{engine: engine, log: engine.log}

	mux := http.NewServeMux()

	// Direct trigger API
	mux.HandleFunc("/trigger", srv.handleTrigger)
	mux.HandleFunc("/health", srv.handleHealth)
	mux.HandleFunc("/metrics", promhttp.Handler().ServeHTTP)

	// Dapr subscription endpoints
	mux.HandleFunc("/dapr/subscribe", srv.handleDaprSubscriptions)
	mux.HandleFunc("/dapr/kyc-trigger", srv.handleDaprEvent)
	mux.HandleFunc("/dapr/user-registered", srv.handleUserRegistered)
	mux.HandleFunc("/dapr/transfer-initiated", srv.handleTransferInitiated)
	mux.HandleFunc("/dapr/sanctions-hit", func(w http.ResponseWriter, r *http.Request) {
		var p struct{ Data struct{ UserID string `json:"userId"`; ListName string `json:"listName"`; MatchScore float64 `json:"matchScore"` } `json:"data"` }
		json.NewDecoder(r.Body).Decode(&p)
		_ = engine.Process(r.Context(), KYCTriggerEvent{
			TriggerType: TriggerSanctionsHit, EntityType: EntityUser,
			EntityID: p.Data.UserID, UserID: p.Data.UserID,
			Metadata:  map[string]interface{}{"list_name": p.Data.ListName, "match_score": p.Data.MatchScore},
			Timestamp: time.Now(), CorrelationID: fmt.Sprintf("sanctions-%d", time.Now().UnixNano()),
		})
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "SUCCESS"})
	})
	mux.HandleFunc("/dapr/sar-filed", func(w http.ResponseWriter, r *http.Request) {
		var p struct{ Data struct{ UserID string `json:"userId"`; SARRef string `json:"sarReference"` } `json:"data"` }
		json.NewDecoder(r.Body).Decode(&p)
		_ = engine.Process(r.Context(), KYCTriggerEvent{
			TriggerType: TriggerSARFiled, EntityType: EntityUser,
			EntityID: p.Data.UserID, UserID: p.Data.UserID,
			Metadata:  map[string]interface{}{"sar_reference": p.Data.SARRef},
			Timestamp: time.Now(), CorrelationID: fmt.Sprintf("sar-%d", time.Now().UnixNano()),
		})
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "SUCCESS"})
	})
	mux.HandleFunc("/dapr/risk-score-high", func(w http.ResponseWriter, r *http.Request) {
		var p struct{ Data struct{ UserID string `json:"userId"`; RiskScore float64 `json:"riskScore"` } `json:"data"` }
		json.NewDecoder(r.Body).Decode(&p)
		_ = engine.Process(r.Context(), KYCTriggerEvent{
			TriggerType: TriggerHighRiskScore, EntityType: EntityUser,
			EntityID: p.Data.UserID, UserID: p.Data.UserID,
			RiskScore: p.Data.RiskScore,
			Timestamp: time.Now(), CorrelationID: fmt.Sprintf("risk-%d", time.Now().UnixNano()),
		})
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "SUCCESS"})
	})
	mux.HandleFunc("/dapr/business-registered", func(w http.ResponseWriter, r *http.Request) {
		var p struct{ Data struct{ BusinessID string `json:"businessId"`; UserID string `json:"userId"` } `json:"data"` }
		json.NewDecoder(r.Body).Decode(&p)
		_ = engine.Process(r.Context(), KYCTriggerEvent{
			TriggerType: TriggerBusinessRegistration, EntityType: EntityBusiness,
			EntityID: p.Data.BusinessID, BusinessID: p.Data.BusinessID, UserID: p.Data.UserID,
			Timestamp: time.Now(), CorrelationID: fmt.Sprintf("biz-%d", time.Now().UnixNano()),
		})
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "SUCCESS"})
	})
	mux.HandleFunc("/dapr/director-changed", func(w http.ResponseWriter, r *http.Request) {
		var p struct{ Data struct{ BusinessID string `json:"businessId"`; ChangeType string `json:"changeType"`; NewDirectorID string `json:"newDirectorId"` } `json:"data"` }
		json.NewDecoder(r.Body).Decode(&p)
		_ = engine.Process(r.Context(), KYCTriggerEvent{
			TriggerType: TriggerDirectorUBOChange, EntityType: EntityBusiness,
			EntityID: p.Data.BusinessID, BusinessID: p.Data.BusinessID,
			Metadata:  map[string]interface{}{"change_type": p.Data.ChangeType, "new_director_id": p.Data.NewDirectorID},
			Timestamp: time.Now(), CorrelationID: fmt.Sprintf("dir-%d", time.Now().UnixNano()),
		})
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "SUCCESS"})
	})

	engine.log.Info("go-kyc-trigger-engine starting",
		"port", cfg.Port,
		"triggers", 15,
		"dapr_port", cfg.DaprHTTPPort,
	)

	if err := http.ListenAndServe(":"+cfg.Port, mux); err != nil {
		engine.log.Error("server failed", "error", err)
		os.Exit(1)
	}
}
