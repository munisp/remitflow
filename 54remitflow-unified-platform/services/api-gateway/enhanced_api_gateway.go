package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/mux"
	"github.com/rs/cors"
)

// Response structures
type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Message string      `json:"message,omitempty"`
	Error   string      `json:"error,omitempty"`
}

type DashboardStats struct {
	TotalAgents      int     `json:"total_agents"`
	TotalCustomers   int     `json:"total_customers"`
	TotalTransactions int    `json:"total_transactions"`
	SystemHealth     float64 `json:"system_health"`
	ActiveAgents     int     `json:"active_agents"`
	Balance          float64 `json:"balance"`
	Commission       float64 `json:"commission"`
	CustomersCount   int     `json:"customers_count"`
	Rating           float64 `json:"rating"`
}

type FraudAlert struct {
	ID          int       `json:"id"`
	Type        string    `json:"type"`
	Severity    string    `json:"severity"`
	Description string    `json:"description"`
	Amount      float64   `json:"amount"`
	Customer    string    `json:"customer"`
	Timestamp   time.Time `json:"timestamp"`
	Status      string    `json:"status"`
}

type CreditApplication struct {
	ID              int     `json:"id"`
	CustomerName    string  `json:"customer_name"`
	ApplicationDate string  `json:"application_date"`
	RequestedAmount float64 `json:"requested_amount"`
	CreditScore     int     `json:"credit_score"`
	RiskLevel       string  `json:"risk_level"`
	Status          string  `json:"status"`
	Decision        string  `json:"decision"`
}

type SystemHealth struct {
	OverallHealth float64 `json:"overall_health"`
	CPUUsage      float64 `json:"cpu_usage"`
	MemoryUsage   float64 `json:"memory_usage"`
	DiskUsage     float64 `json:"disk_usage"`
	NetworkLatency float64 `json:"network_latency"`
	Uptime        string  `json:"uptime"`
	ActiveConnections int  `json:"active_connections"`
	RequestsPerSecond int  `json:"requests_per_second"`
}

type Service struct {
	Name         string `json:"name"`
	Status       string `json:"status"`
	Uptime       string `json:"uptime"`
	ResponseTime string `json:"response_time"`
	Instances    int    `json:"instances"`
}

type Transaction struct {
	ID        int       `json:"id"`
	Type      string    `json:"type"`
	Amount    float64   `json:"amount"`
	Customer  string    `json:"customer"`
	Status    string    `json:"status"`
	Timestamp time.Time `json:"timestamp"`
}

type Customer struct {
	ID        int     `json:"id"`
	Name      string  `json:"name"`
	Phone     string  `json:"phone"`
	Email     string  `json:"email"`
	KYCStatus string  `json:"kyc_status"`
	Balance   float64 `json:"balance"`
}

type Notification struct {
	ID        int       `json:"id"`
	Title     string    `json:"title"`
	Message   string    `json:"message"`
	Type      string    `json:"type"`
	Read      bool      `json:"read"`
	Timestamp time.Time `json:"timestamp"`
}

// Handlers
func getDashboardStats(w http.ResponseWriter, r *http.Request) {
	stats := DashboardStats{
		TotalAgents:       1247,
		TotalCustomers:    45678,
		TotalTransactions: 234567,
		SystemHealth:      98.5,
		ActiveAgents:      1156,
		Balance:           125000,
		Commission:        15750,
		CustomersCount:    47,
		Rating:            4.8,
	}

	response := APIResponse{
		Success: true,
		Data:    stats,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func getFraudAlerts(w http.ResponseWriter, r *http.Request) {
	alerts := []FraudAlert{
		{
			ID:          1,
			Type:        "High Risk Transaction",
			Severity:    "high",
			Description: "Large cash withdrawal detected",
			Amount:      50000,
			Customer:    "John Doe",
			Timestamp:   time.Now(),
			Status:      "pending",
		},
		{
			ID:          2,
			Type:        "Suspicious Pattern",
			Severity:    "medium",
			Description: "Multiple small transactions",
			Amount:      5000,
			Customer:    "Jane Smith",
			Timestamp:   time.Now().Add(-time.Hour),
			Status:      "investigating",
		},
		{
			ID:          3,
			Type:        "Velocity Check",
			Severity:    "low",
			Description: "Rapid transaction sequence",
			Amount:      15000,
			Customer:    "Bob Johnson",
			Timestamp:   time.Now().Add(-2 * time.Hour),
			Status:      "resolved",
		},
	}

	response := APIResponse{
		Success: true,
		Data: map[string]interface{}{
			"alerts": alerts,
			"total":  len(alerts),
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func getCreditApplications(w http.ResponseWriter, r *http.Request) {
	applications := []CreditApplication{
		{
			ID:              1,
			CustomerName:    "John Doe",
			ApplicationDate: "2024-01-07",
			RequestedAmount: 50000,
			CreditScore:     720,
			RiskLevel:       "Low",
			Status:          "Approved",
			Decision:        "Auto-approved",
		},
		{
			ID:              2,
			CustomerName:    "Jane Smith",
			ApplicationDate: "2024-01-07",
			RequestedAmount: 25000,
			CreditScore:     580,
			RiskLevel:       "High",
			Status:          "Pending",
			Decision:        "Manual review",
		},
		{
			ID:              3,
			CustomerName:    "Bob Johnson",
			ApplicationDate: "2024-01-06",
			RequestedAmount: 75000,
			CreditScore:     650,
			RiskLevel:       "Medium",
			Status:          "Approved",
			Decision:        "Conditional approval",
		},
		{
			ID:              4,
			CustomerName:    "Alice Brown",
			ApplicationDate: "2024-01-06",
			RequestedAmount: 30000,
			CreditScore:     480,
			RiskLevel:       "High",
			Status:          "Rejected",
			Decision:        "Insufficient credit history",
		},
	}

	response := APIResponse{
		Success: true,
		Data: map[string]interface{}{
			"applications": applications,
			"total":        len(applications),
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func getSystemHealth(w http.ResponseWriter, r *http.Request) {
	health := SystemHealth{
		OverallHealth:     98.5,
		CPUUsage:          45.2,
		MemoryUsage:       67.8,
		DiskUsage:         34.1,
		NetworkLatency:    12.5,
		Uptime:            "15d 8h 23m",
		ActiveConnections: 1247,
		RequestsPerSecond: 156,
	}

	services := []Service{
		{Name: "API Gateway", Status: "healthy", Uptime: "99.9%", ResponseTime: "45ms", Instances: 3},
		{Name: "Auth Service", Status: "healthy", Uptime: "99.8%", ResponseTime: "23ms", Instances: 2},
		{Name: "Transaction Service", Status: "warning", Uptime: "98.5%", ResponseTime: "89ms", Instances: 4},
		{Name: "KYC Service", Status: "healthy", Uptime: "99.7%", ResponseTime: "67ms", Instances: 2},
		{Name: "Fraud Detection", Status: "healthy", Uptime: "99.9%", ResponseTime: "34ms", Instances: 3},
		{Name: "Database Cluster", Status: "healthy", Uptime: "99.9%", ResponseTime: "12ms", Instances: 5},
		{Name: "Message Queue", Status: "critical", Uptime: "95.2%", ResponseTime: "156ms", Instances: 2},
		{Name: "Cache Layer", Status: "healthy", Uptime: "99.6%", ResponseTime: "8ms", Instances: 3},
	}

	response := APIResponse{
		Success: true,
		Data: map[string]interface{}{
			"health":   health,
			"services": services,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func getTransactions(w http.ResponseWriter, r *http.Request) {
	// Parse query parameters
	pageStr := r.URL.Query().Get("page")
	limitStr := r.URL.Query().Get("limit")

	page := 1
	limit := 20

	if pageStr != "" {
		if p, err := strconv.Atoi(pageStr); err == nil {
			page = p
		}
	}

	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil {
			limit = l
		}
	}

	transactions := []Transaction{
		{
			ID:        1,
			Type:      "transfer",
			Amount:    2500,
			Customer:  "John Doe",
			Status:    "completed",
			Timestamp: time.Now(),
		},
		{
			ID:        2,
			Type:      "deposit",
			Amount:    1000,
			Customer:  "Jane Smith",
			Status:    "pending",
			Timestamp: time.Now().Add(-time.Hour),
		},
		{
			ID:        3,
			Type:      "withdrawal",
			Amount:    500,
			Customer:  "Bob Johnson",
			Status:    "completed",
			Timestamp: time.Now().Add(-2 * time.Hour),
		},
	}

	response := APIResponse{
		Success: true,
		Data: map[string]interface{}{
			"transactions": transactions,
			"total":        156,
			"page":         page,
			"limit":        limit,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func getCustomers(w http.ResponseWriter, r *http.Request) {
	// Parse query parameters
	pageStr := r.URL.Query().Get("page")
	limitStr := r.URL.Query().Get("limit")

	page := 1
	limit := 20

	if pageStr != "" {
		if p, err := strconv.Atoi(pageStr); err == nil {
			page = p
		}
	}

	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil {
			limit = l
		}
	}

	customers := []Customer{
		{
			ID:        1,
			Name:      "John Doe",
			Phone:     "+1234567890",
			Email:     "john@example.com",
			KYCStatus: "verified",
			Balance:   5000,
		},
		{
			ID:        2,
			Name:      "Jane Smith",
			Phone:     "+1234567891",
			Email:     "jane@example.com",
			KYCStatus: "pending",
			Balance:   2500,
		},
		{
			ID:        3,
			Name:      "Bob Johnson",
			Phone:     "+1234567892",
			Email:     "bob@example.com",
			KYCStatus: "verified",
			Balance:   7500,
		},
	}

	response := APIResponse{
		Success: true,
		Data: map[string]interface{}{
			"customers": customers,
			"total":     47,
			"page":      page,
			"limit":     limit,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func getNotifications(w http.ResponseWriter, r *http.Request) {
	notifications := []Notification{
		{
			ID:        1,
			Title:     "New Transaction",
			Message:   "You have received a new transaction",
			Type:      "transaction",
			Read:      false,
			Timestamp: time.Now(),
		},
		{
			ID:        2,
			Title:     "KYC Approved",
			Message:   "Customer KYC has been approved",
			Type:      "kyc",
			Read:      false,
			Timestamp: time.Now().Add(-30 * time.Minute),
		},
		{
			ID:        3,
			Title:     "System Alert",
			Message:   "High CPU usage detected",
			Type:      "system",
			Read:      true,
			Timestamp: time.Now().Add(-time.Hour),
		},
	}

	unreadCount := 0
	for _, notif := range notifications {
		if !notif.Read {
			unreadCount++
		}
	}

	response := APIResponse{
		Success: true,
		Data: map[string]interface{}{
			"notifications": notifications,
			"unread_count":  unreadCount,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func markNotificationAsRead(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	notificationID := vars["id"]

	// In a real implementation, you would update the database
	log.Printf("Marking notification %s as read", notificationID)

	response := APIResponse{
		Success: true,
		Message: "Notification marked as read",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func submitKYC(w http.ResponseWriter, r *http.Request) {
	var kycData map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&kycData); err != nil {
		response := APIResponse{
			Success: false,
			Error:   "Invalid JSON data",
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(response)
		return
	}

	// In a real implementation, you would process the KYC data
	kycID := fmt.Sprintf("kyc_%d", time.Now().Unix())

	response := APIResponse{
		Success: true,
		Message: "KYC submitted successfully",
		Data: map[string]interface{}{
			"kyc_id": kycID,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func uploadVideo(w http.ResponseWriter, r *http.Request) {
	// Parse multipart form
	err := r.ParseMultipartForm(32 << 20) // 32 MB max
	if err != nil {
		response := APIResponse{
			Success: false,
			Error:   "Failed to parse form data",
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(response)
		return
	}

	kycID := r.FormValue("kycId")
	file, header, err := r.FormFile("video")
	if err != nil {
		response := APIResponse{
			Success: false,
			Error:   "No video file provided",
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(response)
		return
	}
	defer file.Close()

	// In a real implementation, you would save the file and process it
	log.Printf("Received video upload for KYC %s, filename: %s", kycID, header.Filename)

	videoID := fmt.Sprintf("video_%d", time.Now().Unix())

	response := APIResponse{
		Success: true,
		Message: "Video uploaded successfully",
		Data: map[string]interface{}{
			"video_id": videoID,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func login(w http.ResponseWriter, r *http.Request) {
	var credentials map[string]string
	if err := json.NewDecoder(r.Body).Decode(&credentials); err != nil {
		response := APIResponse{
			Success: false,
			Error:   "Invalid JSON data",
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(response)
		return
	}

	username := credentials["username"]
	password := credentials["password"]

	// In a real implementation, you would validate credentials
	if username == "" || password == "" {
		response := APIResponse{
			Success: false,
			Error:   "Username and password are required",
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(response)
		return
	}

	// Mock successful login
	token := fmt.Sprintf("token_%d", time.Now().Unix())

	response := APIResponse{
		Success: true,
		Data: map[string]interface{}{
			"token": token,
			"user": map[string]interface{}{
				"id":       1,
				"username": username,
				"role":     "agent",
				"name":     "Demo Agent",
			},
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func main() {
	r := mux.NewRouter()

	// API routes
	api := r.PathPrefix("/api").Subrouter()

	// Authentication
	api.HandleFunc("/auth/login", login).Methods("POST")

	// Dashboard
	api.HandleFunc("/dashboard/stats", getDashboardStats).Methods("GET")

	// Transactions
	api.HandleFunc("/transactions", getTransactions).Methods("GET")

	// Customers
	api.HandleFunc("/customers", getCustomers).Methods("GET")

	// KYC
	api.HandleFunc("/kyc/submit", submitKYC).Methods("POST")
	api.HandleFunc("/kyc/upload-video", uploadVideo).Methods("POST")

	// Fraud Detection
	api.HandleFunc("/fraud/alerts", getFraudAlerts).Methods("GET")

	// Credit Scoring
	api.HandleFunc("/credit/applications", getCreditApplications).Methods("GET")

	// System Monitoring
	api.HandleFunc("/system/health", getSystemHealth).Methods("GET")

	// Notifications
	api.HandleFunc("/notifications", getNotifications).Methods("GET")
	api.HandleFunc("/notifications/{id}/read", markNotificationAsRead).Methods("PUT")

	// CORS middleware
	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
	})

	handler := c.Handler(r)

	fmt.Println("Enhanced API Gateway starting on :8080")
	log.Fatal(http.ListenAndServe("0.0.0.0:8080", handler))
}

