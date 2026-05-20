// RemitFlow Dapr Sidecar Service (Go)
// Handles pub/sub, state management, and service invocation via Dapr
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
)

var (
	daprHTTPPort = getEnv("DAPR_HTTP_PORT", "3500")
	appPort      = getEnv("APP_PORT", ":8097")
	appID        = getEnv("APP_ID", "remitflow-dapr")
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// DaprEvent represents an incoming pub/sub event from Dapr
type DaprEvent struct {
	DataContentType string          `json:"datacontenttype"`
	Data            json.RawMessage `json:"data"`
	ID              string          `json:"id"`
	Source          string          `json:"source"`
	SpecVersion     string          `json:"specversion"`
	Topic           string          `json:"topic"`
	Type            string          `json:"type"`
}

// publishEvent publishes an event to a Dapr topic
func publishEvent(ctx context.Context, pubsubName, topic string, data any) error {
	body, err := json.Marshal(data)
	if err != nil {
		return err
	}
	url := fmt.Sprintf("http://localhost:%s/v1.0/publish/%s/%s", daprHTTPPort, pubsubName, topic)
	req, _ := http.NewRequestWithContext(ctx, "POST", url, nil)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

// Subscription handlers
func transferCreatedHandler(w http.ResponseWriter, r *http.Request) {
	var event DaprEvent
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	log.Printf("[Dapr] transfer.created event: %s", string(event.Data))
	// Trigger downstream: AML check, FX rate lock, compliance screening
	publishEvent(r.Context(), "remitflow-pubsub", "aml.check.requested", event.Data)
	publishEvent(r.Context(), "remitflow-pubsub", "fx.rate.lock.requested", event.Data)
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "SUCCESS"})
}

func payoutCompletedHandler(w http.ResponseWriter, r *http.Request) {
	var event DaprEvent
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	log.Printf("[Dapr] payout.completed event: %s", string(event.Data))
	// Trigger partner earnings calculation and notification
	publishEvent(r.Context(), "remitflow-pubsub", "partner.earnings.calculate", event.Data)
	publishEvent(r.Context(), "remitflow-pubsub", "notification.send", event.Data)
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "SUCCESS"})
}

func kycApprovedHandler(w http.ResponseWriter, r *http.Request) {
	var event DaprEvent
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	log.Printf("[Dapr] kyc.approved event: %s", string(event.Data))
	publishEvent(r.Context(), "remitflow-pubsub", "user.limits.upgrade", event.Data)
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "SUCCESS"})
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":    "healthy",
		"service":   appID,
		"daprPort":  daprHTTPPort,
		"timestamp": time.Now().Unix(),
	})
}

// Dapr subscription configuration endpoint
func subscriptionsHandler(w http.ResponseWriter, r *http.Request) {
	subscriptions := []map[string]any{
		{"pubsubname": "remitflow-pubsub", "topic": "transfer.created", "route": "/events/transfer-created"},
		{"pubsubname": "remitflow-pubsub", "topic": "payout.completed", "route": "/events/payout-completed"},
		{"pubsubname": "remitflow-pubsub", "topic": "kyc.approved", "route": "/events/kyc-approved"},
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(subscriptions)
}

func main() {
	log.Printf("[Dapr Service] Starting %s on %s", appID, appPort)
	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/dapr/subscribe", subscriptionsHandler)
	mux.HandleFunc("/events/transfer-created", transferCreatedHandler)
	mux.HandleFunc("/events/payout-completed", payoutCompletedHandler)
	mux.HandleFunc("/events/kyc-approved", kycApprovedHandler)
	log.Fatal(http.ListenAndServe(appPort, mux))
}
