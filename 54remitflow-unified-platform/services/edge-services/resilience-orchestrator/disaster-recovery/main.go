
package main

import (
	"fmt"
	"net/http"
	"os"
	"time"

	"disaster-recovery/cache"
	"disaster-recovery/database"
	"disaster-recovery/handlers"
	"disaster-recovery/metrics"
	"disaster-recovery/middleware"
	"disaster-recovery/utils"

	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
	logger := utils.GetLogger()

	// Load environment variables
	if err := godotenv.Load(); err != nil {
		logger.Warn("Error loading .env file: %v", err)
	}

	// Initialize database
	database.InitDB()
	defer database.CloseDB()

	// Apply database schema
	database.ApplySchema("./sql/schema.sql")

	// Initialize Redis
	cache.InitRedis()
	defer cache.CloseRedis()

	// Initialize Prometheus metrics
	metrics.InitMetrics()

	// Initialize router
	r := mux.NewRouter()

	// Apply CORS middleware
	r.Use(middleware.CORSMiddleware)

	// Health check endpoint
	r.HandleFunc("/health", healthCheckHandler).Methods("GET")

	// Prometheus metrics endpoint
	r.Handle("/metrics", promhttp.Handler()).Methods("GET")

	// Disaster Recovery Plan Endpoints
	r.HandleFunc("/plans", handlers.CreatePlanHandler).Methods("POST")
	r.HandleFunc("/plans", handlers.ListPlansHandler).Methods("GET")
	r.HandleFunc("/plans/{id}", handlers.GetPlanHandler).Methods("GET")
	r.HandleFunc("/plans/{id}", handlers.UpdatePlanHandler).Methods("PUT")
	r.HandleFunc("/plans/{id}", handlers.DeletePlanHandler).Methods("DELETE")

	// Failover Execution Endpoints
	r.HandleFunc("/failovers", handlers.CreateFailoverExecutionHandler).Methods("POST")
	r.HandleFunc("/failovers", handlers.ListFailoverExecutionsHandler).Methods("GET")
	r.HandleFunc("/failovers/{id}", handlers.GetFailoverExecutionHandler).Methods("GET")
	r.HandleFunc("/failovers/{id}", handlers.UpdateFailoverExecutionHandler).Methods("PUT")
	r.HandleFunc("/failovers/{id}", handlers.DeleteFailoverExecutionHandler).Methods("DELETE")

	// Recovery Status Endpoints
	r.HandleFunc("/recovery-status/{plan_id}", handlers.GetRecoveryStatusHandler).Methods("GET")
	r.HandleFunc("/recovery-status/{plan_id}", handlers.UpdateRecoveryStatusHandler).Methods("PUT")

	// Service Endpoints
	r.HandleFunc("/services", handlers.CreateServiceHandler).Methods("POST")
	r.HandleFunc("/services", handlers.ListServicesHandler).Methods("GET")
	r.HandleFunc("/services/{id}", handlers.GetServiceHandler).Methods("GET")
	r.HandleFunc("/services/{id}", handlers.UpdateServiceHandler).Methods("PUT")
	r.HandleFunc("/services/{id}", handlers.DeleteServiceHandler).Methods("DELETE")

	// Incident Endpoints
	r.HandleFunc("/incidents", handlers.CreateIncidentHandler).Methods("POST")
	r.HandleFunc("/incidents", handlers.ListIncidentsHandler).Methods("GET")
	r.HandleFunc("/incidents/{id}", handlers.GetIncidentHandler).Methods("GET")
	r.HandleFunc("/incidents/{id}", handlers.UpdateIncidentHandler).Methods("PUT")
	r.HandleFunc("/incidents/{id}", handlers.DeleteIncidentHandler).Methods("DELETE")

	// Notification Endpoints
	r.HandleFunc("/notifications", handlers.CreateNotificationHandler).Methods("POST")
	r.HandleFunc("/notifications", handlers.ListNotificationsHandler).Methods("GET")
	r.HandleFunc("/notifications/{id}", handlers.GetNotificationHandler).Methods("GET")
	r.HandleFunc("/notifications/{id}", handlers.UpdateNotificationHandler).Methods("PUT")
	r.HandleFunc("/notifications/{id}", handlers.DeleteNotificationHandler).Methods("DELETE")

	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080" // Default port
	}

	serverAddr := fmt.Sprintf(":%s", port)
	logger.Info("Server starting on %s", serverAddr)
	http.Handle("/", r)
	logger.Fatal("Server failed to start: %v", http.ListenAndServe(serverAddr, nil))
}

func healthCheckHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, "Disaster Recovery Service is healthy! Current time: %s", time.Now().Format(time.RFC3339))
}


