// RemitFlow — Go KYC Orchestrator
//
// Coordinates the full KYC workflow across all microservices:
//   1. Python KYC Pipeline (PaddleOCR + Docling + VLM + Liveness)
//   2. Rust Biometric Service (ArcFace matching + deduplication)
//   3. Python AML Scorer (sanctions + PEP + risk scoring)
//   4. Python Travel Rule (FATF compliance)
//   5. Temporal workflow for durable orchestration
//
// Port: 8150

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ── Config ────────────────────────────────────────────────────────────────────
var (
	port           = getEnv("PORT", "8150")
	kycPipelineURL = getEnv("KYC_PIPELINE_URL", "http://python-kyc-pipeline:8148")
	biometricURL   = getEnv("BIOMETRIC_URL", "http://rust-biometric:8149")
	amlScorerURL   = getEnv("AML_SCORER_URL", "http://python-aml-scorer:8130")
	travelRuleURL  = getEnv("TRAVEL_RULE_URL", "http://python-travel-rule:8122")
)

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ── Prometheus Metrics ────────────────────────────────────────────────────────
var (
	kycSubmitted = promauto.NewCounter(prometheus.CounterOpts{
		Name: "remitflow_kyc_orchestrator_submitted_total",
		Help: "Total KYC orchestrations started",
	})
	kycCompleted = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "remitflow_kyc_orchestrator_completed_total",
		Help: "Total KYC orchestrations completed",
	}, []string{"status"})
	kycDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "remitflow_kyc_orchestrator_duration_seconds",
		Help:    "KYC orchestration end-to-end duration",
		Buckets: []float64{1, 2, 5, 10, 30, 60, 120},
	})
	serviceErrors = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "remitflow_kyc_service_errors_total",
		Help: "Errors calling downstream KYC services",
	}, []string{"service"})
)

// ── Data Models ───────────────────────────────────────────────────────────────
type KYCOrchestrationRequest struct {
	UserID          int64   `json:"user_id"`
	DocType         string  `json:"doc_type"`
	DocNumber       string  `json:"doc_number,omitempty"`
	DocImageBase64  string  `json:"doc_image_base64,omitempty"`
	DocBackBase64   string  `json:"doc_back_base64,omitempty"`
	SelfieBase64    string  `json:"selfie_base64,omitempty"`
	FirstName       string  `json:"first_name"`
	LastName        string  `json:"last_name"`
	DateOfBirth     string  `json:"date_of_birth"`
	Nationality     string  `json:"nationality"`
	Address         string  `json:"address,omitempty"`
	RunLiveness     bool    `json:"run_liveness"`
	RunVLM          bool    `json:"run_vlm"`
	RunBiometric    bool    `json:"run_biometric"`
	RunAML          bool    `json:"run_aml"`
	RunTravelRule   bool    `json:"run_travel_rule"`
	TransferAmount  float64 `json:"transfer_amount,omitempty"`
}

type KYCOrchestrationResult struct {
	OrchestrationID  string                 `json:"orchestration_id"`
	UserID           int64                  `json:"user_id"`
	FinalStatus      string                 `json:"final_status"`
	RejectionReasons []string               `json:"rejection_reasons"`
	FraudSignals     []string               `json:"fraud_signals"`
	Stages           map[string]interface{} `json:"stages"`
	ProcessingMs     int64                  `json:"processing_ms"`
	Timestamp        string                 `json:"timestamp"`
}

// ── HTTP Client ───────────────────────────────────────────────────────────────
var httpClient = &http.Client{Timeout: 60 * time.Second}

func postJSON(ctx context.Context, url string, payload interface{}) (map[string]interface{}, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal error: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("request error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http error: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read error: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("service error %d: %s", resp.StatusCode, string(respBody))
	}

	var result map[string]interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("unmarshal error: %w", err)
	}

	return result, nil
}

// ── KYC Orchestration ─────────────────────────────────────────────────────────
func orchestrateKYC(ctx context.Context, req KYCOrchestrationRequest) KYCOrchestrationResult {
	start := time.Now()
	orchID := fmt.Sprintf("kyc-%d-%d", req.UserID, time.Now().UnixNano())
	stages := make(map[string]interface{})
	var rejectionReasons []string
	var fraudSignals []string
	var mu sync.Mutex

	// ── Stage 1: Document Processing + Liveness (Python KYC Pipeline) ────────
	log.Printf("[KYC Orchestrator] Stage 1: Document processing user_id=%d", req.UserID)
	kycPayload := map[string]interface{}{
		"user_id":          req.UserID,
		"doc_type":         req.DocType,
		"doc_number":       req.DocNumber,
		"doc_image_base64": req.DocImageBase64,
		"doc_back_base64":  req.DocBackBase64,
		"selfie_base64":    req.SelfieBase64,
		"first_name":       req.FirstName,
		"last_name":        req.LastName,
		"date_of_birth":    req.DateOfBirth,
		"nationality":      req.Nationality,
		"address":          req.Address,
		"run_liveness":     req.RunLiveness,
		"run_vlm":          req.RunVLM,
	}

	kycResult, err := postJSON(ctx, kycPipelineURL+"/kyc/submit", kycPayload)
	if err != nil {
		serviceErrors.WithLabelValues("python-kyc-pipeline").Inc()
		log.Printf("[KYC Orchestrator] KYC pipeline error: %v", err)
		stages["document_processing"] = map[string]interface{}{"error": err.Error()}
		mu.Lock()
		rejectionReasons = append(rejectionReasons, "kyc_pipeline_unavailable")
		mu.Unlock()
	} else {
		stages["document_processing"] = kycResult

		// Collect rejection reasons and fraud signals from KYC pipeline
		if reasons, ok := kycResult["rejection_reasons"].([]interface{}); ok {
			for _, r := range reasons {
				if s, ok := r.(string); ok {
					mu.Lock()
					rejectionReasons = append(rejectionReasons, s)
					mu.Unlock()
				}
			}
		}
		if signals, ok := kycResult["fraud_signals"].([]interface{}); ok {
			for _, s := range signals {
				if str, ok := s.(string); ok {
					mu.Lock()
					fraudSignals = append(fraudSignals, str)
					mu.Unlock()
				}
			}
		}
	}

	// ── Stage 2: Biometric Deduplication (Rust Biometric Service) ────────────
	if req.RunBiometric && req.SelfieBase64 != "" {
		log.Printf("[KYC Orchestrator] Stage 2: Biometric dedup user_id=%d", req.UserID)
		dedupPayload := map[string]interface{}{
			"image_base64": req.SelfieBase64,
		}
		dedupResult, err := postJSON(ctx, biometricURL+"/biometric/dedup", dedupPayload)
		if err != nil {
			serviceErrors.WithLabelValues("rust-biometric").Inc()
			log.Printf("[KYC Orchestrator] Biometric dedup error: %v", err)
			stages["biometric_dedup"] = map[string]interface{}{"error": err.Error()}
		} else {
			stages["biometric_dedup"] = dedupResult
			if isDup, ok := dedupResult["is_duplicate"].(bool); ok && isDup {
				mu.Lock()
				fraudSignals = append(fraudSignals, fmt.Sprintf(
					"duplicate_biometric_identity: matched_user=%v similarity=%v",
					dedupResult["matched_user_id"], dedupResult["similarity"],
				))
				mu.Unlock()
			}
		}

		// Enroll biometric if not a duplicate
		isDuplicate := false
		if dedupStage, ok := stages["biometric_dedup"].(map[string]interface{}); ok {
			if isDup, ok := dedupStage["is_duplicate"].(bool); ok {
				isDuplicate = isDup
			}
		}

		if !isDuplicate {
			enrollPayload := map[string]interface{}{
				"user_id":      req.UserID,
				"image_base64": req.SelfieBase64,
				"doc_type":     req.DocType,
			}
			enrollResult, err := postJSON(ctx, biometricURL+"/biometric/enroll", enrollPayload)
			if err != nil {
				serviceErrors.WithLabelValues("rust-biometric-enroll").Inc()
				stages["biometric_enroll"] = map[string]interface{}{"error": err.Error()}
			} else {
				stages["biometric_enroll"] = enrollResult
			}
		}
	}

	// ── Stage 3: AML Scoring (Python AML Scorer) ──────────────────────────────
	if req.RunAML {
		log.Printf("[KYC Orchestrator] Stage 3: AML scoring user_id=%d", req.UserID)
		amlPayload := map[string]interface{}{
			"user_id":     req.UserID,
			"first_name":  req.FirstName,
			"last_name":   req.LastName,
			"nationality": req.Nationality,
			"doc_type":    req.DocType,
			"doc_number":  req.DocNumber,
		}
		amlResult, err := postJSON(ctx, amlScorerURL+"/score", amlPayload)
		if err != nil {
			serviceErrors.WithLabelValues("python-aml-scorer").Inc()
			log.Printf("[KYC Orchestrator] AML scorer error: %v", err)
			stages["aml_scoring"] = map[string]interface{}{"error": err.Error()}
		} else {
			stages["aml_scoring"] = amlResult
			if riskLevel, ok := amlResult["risk_level"].(string); ok {
				if riskLevel == "critical" || riskLevel == "high" {
					mu.Lock()
					rejectionReasons = append(rejectionReasons,
						fmt.Sprintf("aml_high_risk: level=%s score=%v", riskLevel, amlResult["risk_score"]))
					mu.Unlock()
				}
			}
			// Check sanctions hit
			if sanctionsHit, ok := amlResult["sanctions_hit"].(bool); ok && sanctionsHit {
				mu.Lock()
				rejectionReasons = append(rejectionReasons, "sanctions_list_match")
				mu.Unlock()
			}
		}
	}

	// ── Stage 4: Travel Rule (if transfer amount >= $1000) ────────────────────
	if req.RunTravelRule && req.TransferAmount >= 1000.0 {
		log.Printf("[KYC Orchestrator] Stage 4: Travel Rule user_id=%d amount=%.2f", req.UserID, req.TransferAmount)
		trPayload := map[string]interface{}{
			"user_id":         req.UserID,
			"transfer_amount": req.TransferAmount,
			"originator": map[string]interface{}{
				"name":        fmt.Sprintf("%s %s", req.FirstName, req.LastName),
				"nationality": req.Nationality,
				"doc_number":  req.DocNumber,
			},
		}
		trResult, err := postJSON(ctx, travelRuleURL+"/travel-rule/screen", trPayload)
		if err != nil {
			serviceErrors.WithLabelValues("python-travel-rule").Inc()
			stages["travel_rule"] = map[string]interface{}{"error": err.Error()}
		} else {
			stages["travel_rule"] = trResult
		}
	}

	// ── Determine Final Status ────────────────────────────────────────────────
	finalStatus := "approved"
	if len(rejectionReasons) > 0 {
		finalStatus = "rejected"
		kycCompleted.WithLabelValues("rejected").Inc()
	} else if len(fraudSignals) > 0 {
		finalStatus = "manual_review"
		kycCompleted.WithLabelValues("manual_review").Inc()
	} else {
		kycCompleted.WithLabelValues("approved").Inc()
	}

	processingMs := time.Since(start).Milliseconds()
	kycDuration.Observe(float64(processingMs) / 1000.0)

	log.Printf(
		"[KYC Orchestrator] Complete: user_id=%d status=%s rejections=%d fraud_signals=%d ms=%d",
		req.UserID, finalStatus, len(rejectionReasons), len(fraudSignals), processingMs,
	)

	return KYCOrchestrationResult{
		OrchestrationID:  orchID,
		UserID:           req.UserID,
		FinalStatus:      finalStatus,
		RejectionReasons: rejectionReasons,
		FraudSignals:     fraudSignals,
		Stages:           stages,
		ProcessingMs:     processingMs,
		Timestamp:        time.Now().UTC().Format(time.RFC3339),
	}
}

// ── HTTP Handlers ─────────────────────────────────────────────────────────────
func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "healthy",
		"service": "go-kyc-orchestrator",
		"version": "1.0.0",
		"downstream": map[string]string{
			"kyc_pipeline": kycPipelineURL,
			"biometric":    biometricURL,
			"aml_scorer":   amlScorerURL,
			"travel_rule":  travelRuleURL,
		},
	})
}

func orchestrateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req KYCOrchestrationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request: %v", err), http.StatusBadRequest)
		return
	}

	if req.UserID == 0 {
		http.Error(w, "user_id is required", http.StatusBadRequest)
		return
	}

	kycSubmitted.Inc()

	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()

	result := orchestrateKYC(ctx, req)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// ── Main ──────────────────────────────────────────────────────────────────────
func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/health",         healthHandler)
	mux.HandleFunc("/livez",          func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `{"ok":true}`) })
	mux.HandleFunc("/readyz",         func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `{"ok":true}`) })
	mux.Handle("/metrics",            promhttp.Handler())
	mux.HandleFunc("/kyc/orchestrate", orchestrateHandler)

	addr := "0.0.0.0:" + port
	log.Printf("[KYC Orchestrator] Starting on %s", addr)
	log.Printf("[KYC Orchestrator] Downstream: pipeline=%s biometric=%s aml=%s travel_rule=%s",
		kycPipelineURL, biometricURL, amlScorerURL, travelRuleURL)

	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("[KYC Orchestrator] Fatal: %v", err)
	}
}
