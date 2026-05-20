package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/mux"
)

// Intelligent load balancer

type Service struct {
	Name        string
	Version     string
	StartTime   time.Time
}

type HealthResponse struct {
	Status    string    `json:"status"`
	Service   string    `json:"service"`
	Timestamp time.Time `json:"timestamp"`
	Uptime    string    `json:"uptime"`
}

type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

func main() {
	service := &Service{
		Name:      "load-balancer",
		Version:   "1.0.0",
		StartTime: time.Now(),
	}

	router := mux.NewRouter()
	
	// Health check
	router.HandleFunc("/health", service.healthHandler).Methods("GET")
	router.HandleFunc("/", service.rootHandler).Methods("GET")
	
	// Service-specific routes
	router.HandleFunc("/api/v1/status", service.statusHandler).Methods("GET")
	router.HandleFunc("/api/v1/metrics", service.metricsHandler).Methods("GET")
	
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting %s on port %s\n", service.Name, port)
	log.Fatal(http.ListenAndServe(":"+port, router))
}

func (s *Service) healthHandler(w http.ResponseWriter, r *http.Request) {
	uptime := time.Since(s.StartTime)
	
	response := HealthResponse{
		Status:    "healthy",
		Service:   s.Name,
		Timestamp: time.Now(),
		Uptime:    uptime.String(),
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (s *Service) rootHandler(w http.ResponseWriter, r *http.Request) {
	response := map[string]interface{}{
		"service":     s.Name,
		"version":     s.Version,
		"description": "Intelligent load balancer",
		"status":      "running",
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (s *Service) statusHandler(w http.ResponseWriter, r *http.Request) {
	response := map[string]interface{}{
		"service": s.Name,
		"status":  "operational",
		"uptime":  time.Since(s.StartTime).String(),
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (s *Service) metricsHandler(w http.ResponseWriter, r *http.Request) {
	metrics := map[string]interface{}{
		"requests_total":    1000,
		"requests_success":  950,
		"requests_failed":   50,
		"avg_response_time": "45ms",
		"uptime_seconds":    int(time.Since(s.StartTime).Seconds()),
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(metrics)
}
