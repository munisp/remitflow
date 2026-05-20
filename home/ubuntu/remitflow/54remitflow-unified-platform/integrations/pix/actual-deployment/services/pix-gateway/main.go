package main

import (
    "encoding/json"
    "fmt"
    "log"
    "net/http"
    "os"
    "time"
    
    "github.com/gorilla/mux"
    "github.com/gorilla/handlers"
)

type HealthResponse struct {
    Success bool        `json:"success"`
    Data    interface{} `json:"data"`
}

type ServiceInfo struct {
    Service     string    `json:"service"`
    Status      string    `json:"status"`
    Version     string    `json:"version"`
    Uptime      string    `json:"uptime"`
    Timestamp   time.Time `json:"timestamp"`
    BCBConnected bool     `json:"bcb_connected"`
}

type PIXPayment struct {
    ID           string  `json:"id"`
    Amount       float64 `json:"amount"`
    Currency     string  `json:"currency"`
    RecipientKey string  `json:"recipient_key"`
    Description  string  `json:"description"`
    Status       string  `json:"status"`
    CreatedAt    time.Time `json:"created_at"`
}

var startTime = time.Now()

func healthHandler(w http.ResponseWriter, r *http.Request) {
    uptime := time.Since(startTime)
    
    response := HealthResponse{
        Success: true,
        Data: ServiceInfo{
            Service:     "PIX Gateway",
            Status:      "healthy",
            Version:     "1.0.0",
            Uptime:      uptime.String(),
            Timestamp:   time.Now(),
            BCBConnected: true, // Simulated BCB connection
        },
    }
    
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(response)
}

func createPIXPaymentHandler(w http.ResponseWriter, r *http.Request) {
    var payment PIXPayment
    if err := json.NewDecoder(r.Body).Decode(&payment); err != nil {
        http.Error(w, "Invalid JSON", http.StatusBadRequest)
        return
    }
    
    // Simulate PIX payment processing
    payment.ID = fmt.Sprintf("PIX_%d", time.Now().Unix())
    payment.Status = "processing"
    payment.CreatedAt = time.Now()
    
    // Simulate processing time
    go func() {
        time.Sleep(2 * time.Second)
        payment.Status = "completed"
        log.Printf("PIX payment %s completed", payment.ID)
    }()
    
    response := HealthResponse{
        Success: true,
        Data:    payment,
    }
    
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(response)
}

func validatePIXKeyHandler(w http.ResponseWriter, r *http.Request) {
    vars := mux.Vars(r)
    pixKey := vars["key"]
    
    // Simulate PIX key validation
    isValid := len(pixKey) >= 11 && len(pixKey) <= 14
    keyType := "CPF"
    if len(pixKey) > 11 {
        keyType = "phone"
    }
    
    response := HealthResponse{
        Success: true,
        Data: map[string]interface{}{
            "key":      pixKey,
            "valid":    isValid,
            "key_type": keyType,
            "bank":     "Banco do Brasil",
            "owner":    "João Silva Santos",
        },
    }
    
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(response)
}

func main() {
    r := mux.NewRouter()
    
    // Health endpoint
    r.HandleFunc("/health", healthHandler).Methods("GET")
    
    // PIX endpoints
    r.HandleFunc("/api/v1/pix/payments", createPIXPaymentHandler).Methods("POST")
    r.HandleFunc("/api/v1/pix/keys/{key}/validate", validatePIXKeyHandler).Methods("GET")
    
    // CORS middleware
    corsHandler := handlers.CORS(
        handlers.AllowedOrigins([]string{"*"}),
        handlers.AllowedMethods([]string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}),
        handlers.AllowedHeaders([]string{"*"}),
    )(r)
    
    port := os.Getenv("PORT")
    if port == "" {
        port = "5001"
    }
    
    log.Printf("PIX Gateway starting on port %s", port)
    log.Fatal(http.ListenAndServe(":"+port, corsHandler))
}
