package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/nats-io/nats.go"
	"github.com/go-redis/redis/v8"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type POSManagementServer struct {
	db              *gorm.DB
	redis           *redis.Client
	nats            *nats.Conn
	terminals       map[string]*TerminalConnection
	terminalsMutex  sync.RWMutex
	updateQueue     chan *UpdateMessage
	commandQueue    chan *CommandMessage
	statusQueue     chan *StatusMessage
	upgrader        websocket.Upgrader
	tlsConfig       *tls.Config
	securityManager *SecurityManager
}

type TerminalConnection struct {
	ID              string
	Conn            *websocket.Conn
	LastSeen        time.Time
	Status          string
	Version         string
	Location        *Location
	Performance     *PerformanceMetrics
	Configuration   map[string]interface{}
	SendChannel     chan []byte
	IsAuthenticated bool
	Certificate     string
	mutex           sync.RWMutex
}

type Location struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Accuracy  float64 `json:"accuracy"`
	Timestamp time.Time `json:"timestamp"`
}

type PerformanceMetrics struct {
	CPUUsage        float64 `json:"cpu_usage"`
	MemoryUsage     float64 `json:"memory_usage"`
	DiskUsage       float64 `json:"disk_usage"`
	NetworkLatency  float64 `json:"network_latency"`
	TransactionRate float64 `json:"transaction_rate"`
	ErrorRate       float64 `json:"error_rate"`
	Uptime          int64   `json:"uptime"`
	LastUpdated     time.Time `json:"last_updated"`
}

type UpdateMessage struct {
	ID          string                 `json:"id"`
	TerminalID  string                 `json:"terminal_id"`
	Type        string                 `json:"type"`
	Payload     map[string]interface{} `json:"payload"`
	Version     string                 `json:"version"`
	Priority    int                    `json:"priority"`
	Timestamp   time.Time              `json:"timestamp"`
	Signature   string                 `json:"signature"`
	Encrypted   bool                   `json:"encrypted"`
}

type CommandMessage struct {
	ID         string                 `json:"id"`
	TerminalID string                 `json:"terminal_id"`
	Command    string                 `json:"command"`
	Parameters map[string]interface{} `json:"parameters"`
	Timeout    int                    `json:"timeout"`
	Timestamp  time.Time              `json:"timestamp"`
	Signature  string                 `json:"signature"`
}

type StatusMessage struct {
	TerminalID    string                 `json:"terminal_id"`
	Status        string                 `json:"status"`
	Health        map[string]interface{} `json:"health"`
	Performance   *PerformanceMetrics    `json:"performance"`
	Location      *Location              `json:"location"`
	Timestamp     time.Time              `json:"timestamp"`
	Configuration map[string]interface{} `json:"configuration"`
}

type SecurityManager struct {
	certificates map[string]string
	apiKeys      map[string]string
	permissions  map[string][]string
	signingKey   string
	mutex        sync.RWMutex
}

func NewPOSManagementServer() *POSManagementServer {
	server := &POSManagementServer{
		terminals:    make(map[string]*TerminalConnection),
		updateQueue:  make(chan *UpdateMessage, 1000),
		commandQueue: make(chan *CommandMessage, 1000),
		statusQueue:  make(chan *StatusMessage, 1000),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Implement proper origin checking in production
			},
		},
		securityManager: &SecurityManager{
			certificates: make(map[string]string),
			apiKeys:      make(map[string]string),
			permissions:  make(map[string][]string),
			signingKey:   os.Getenv("POS_SIGNING_KEY"),
		},
	}

	server.initializeDatabase()
	server.initializeRedis()
	server.initializeNATS()
	server.initializeTLS()
	server.startWorkers()

	return server
}

func (s *POSManagementServer) initializeDatabase() {
	dsn := os.Getenv("POS_DATABASE_URL")
	if dsn == "" {
		dsn = "host=localhost user=postgres dbname=pos_management port=5432 sslmode=disable"
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Printf("Failed to connect to database: %v", err)
		// Use SQLite as fallback
		db, err = gorm.Open(postgres.Open("file:pos_management.db"), &gorm.Config{})
		if err != nil {
			log.Fatalf("Failed to connect to fallback database: %v", err)
		}
	}
	s.db = db

	// Auto-migrate schemas
	s.db.AutoMigrate(&Terminal{}, &UpdateLog{}, &CommandLog{}, &StatusLog{})
}

func (s *POSManagementServer) initializeRedis() {
	s.redis = redis.NewClient(&redis.Options{
		Addr:     "localhost:6379",
		Password: "",
		DB:       0,
	})

	ctx := context.Background()
	_, err := s.redis.Ping(ctx).Result()
	if err != nil {
		log.Printf("Redis connection failed: %v", err)
	}
}

func (s *POSManagementServer) initializeNATS() {
	nc, err := nats.Connect("nats://localhost:4222")
	if err != nil {
		log.Printf("NATS connection failed: %v", err)
		return
	}
	s.nats = nc

	// Subscribe to terminal events
	s.nats.Subscribe("terminal.status", s.handleNATSStatus)
	s.nats.Subscribe("terminal.update.response", s.handleNATSUpdateResponse)
	s.nats.Subscribe("terminal.command.response", s.handleNATSCommandResponse)
}

func (s *POSManagementServer) initializeTLS() {
	cert, err := tls.LoadX509KeyPair("server.crt", "server.key")
	if err != nil {
		log.Printf("Failed to load TLS certificates: %v", err)
		// Generate self-signed certificate for development
		s.generateSelfSignedCert()
		return
	}

	s.tlsConfig = &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS13,
	}
}

func (s *POSManagementServer) generateSelfSignedCert() {
	// Implementation for self-signed certificate generation
	log.Println("Using self-signed certificate for development")
}

func (s *POSManagementServer) startWorkers() {
	// Update distribution worker
	go s.updateDistributionWorker()
	
	// Command execution worker
	go s.commandExecutionWorker()
	
	// Status processing worker
	go s.statusProcessingWorker()
	
	// Health monitoring worker
	go s.healthMonitoringWorker()
	
	// Cleanup worker
	go s.cleanupWorker()
}

func (s *POSManagementServer) updateDistributionWorker() {
	for update := range s.updateQueue {
		s.distributeUpdate(update)
	}
}

func (s *POSManagementServer) commandExecutionWorker() {
	for command := range s.commandQueue {
		s.executeCommand(command)
	}
}

func (s *POSManagementServer) statusProcessingWorker() {
	for status := range s.statusQueue {
		s.processStatus(status)
	}
}

func (s *POSManagementServer) healthMonitoringWorker() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		s.monitorTerminalHealth()
	}
}

func (s *POSManagementServer) cleanupWorker() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		s.cleanupDisconnectedTerminals()
	}
}

func (s *POSManagementServer) handleWebSocket(c *gin.Context) {
	terminalID := c.Query("terminal_id")
	if terminalID == "" {
		c.JSON(400, gin.H{"error": "terminal_id required"})
		return
	}

	// Authenticate terminal
	if !s.authenticateTerminal(c.Request, terminalID) {
		c.JSON(401, gin.H{"error": "authentication failed"})
		return
	}

	conn, err := s.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	terminal := &TerminalConnection{
		ID:              terminalID,
		Conn:            conn,
		LastSeen:        time.Now(),
		Status:          "connected",
		SendChannel:     make(chan []byte, 100),
		IsAuthenticated: true,
		Configuration:   make(map[string]interface{}),
	}

	s.terminalsMutex.Lock()
	s.terminals[terminalID] = terminal
	s.terminalsMutex.Unlock()

	// Start goroutines for this terminal
	go s.handleTerminalMessages(terminal)
	go s.handleTerminalSender(terminal)

	log.Printf("Terminal %s connected", terminalID)
}

func (s *POSManagementServer) authenticateTerminal(r *http.Request, terminalID string) bool {
	apiKey := r.Header.Get("X-API-Key")
	if apiKey == "" {
		return false
	}

	s.securityManager.mutex.RLock()
	validKey, exists := s.securityManager.apiKeys[terminalID]
	s.securityManager.mutex.RUnlock()

	if !exists || validKey != apiKey {
		return false
	}

	return true
}

func (s *POSManagementServer) handleTerminalMessages(terminal *TerminalConnection) {
	defer func() {
		terminal.Conn.Close()
		s.terminalsMutex.Lock()
		delete(s.terminals, terminal.ID)
		s.terminalsMutex.Unlock()
		log.Printf("Terminal %s disconnected", terminal.ID)
	}()

	for {
		_, message, err := terminal.Conn.ReadMessage()
		if err != nil {
			log.Printf("Error reading message from terminal %s: %v", terminal.ID, err)
			break
		}

		var msg map[string]interface{}
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("Error unmarshaling message from terminal %s: %v", terminal.ID, err)
			continue
		}

		s.processTerminalMessage(terminal, msg)
	}
}

func (s *POSManagementServer) handleTerminalSender(terminal *TerminalConnection) {
	for message := range terminal.SendChannel {
		if err := terminal.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
			log.Printf("Error sending message to terminal %s: %v", terminal.ID, err)
			break
		}
	}
}

func (s *POSManagementServer) processTerminalMessage(terminal *TerminalConnection, msg map[string]interface{}) {
	terminal.mutex.Lock()
	terminal.LastSeen = time.Now()
	terminal.mutex.Unlock()

	msgType, ok := msg["type"].(string)
	if !ok {
		return
	}

	switch msgType {
	case "status":
		s.handleStatusMessage(terminal, msg)
	case "heartbeat":
		s.handleHeartbeat(terminal, msg)
	case "update_response":
		s.handleUpdateResponse(terminal, msg)
	case "command_response":
		s.handleCommandResponse(terminal, msg)
	case "alert":
		s.handleAlert(terminal, msg)
	}
}

func (s *POSManagementServer) handleStatusMessage(terminal *TerminalConnection, msg map[string]interface{}) {
	if statusData, ok := msg["data"].(map[string]interface{}); ok {
		// Update terminal status
		terminal.mutex.Lock()
		if status, ok := statusData["status"].(string); ok {
			terminal.Status = status
		}
		if version, ok := statusData["version"].(string); ok {
			terminal.Version = version
		}
		if location, ok := statusData["location"].(map[string]interface{}); ok {
			terminal.Location = s.parseLocation(location)
		}
		if performance, ok := statusData["performance"].(map[string]interface{}); ok {
			terminal.Performance = s.parsePerformanceMetrics(performance)
		}
		terminal.mutex.Unlock()

		// Store in database
		s.storeStatusLog(terminal.ID, statusData)
	}
}

func (s *POSManagementServer) handleHeartbeat(terminal *TerminalConnection, msg map[string]interface{}) {
	response := map[string]interface{}{
		"type":      "heartbeat_ack",
		"timestamp": time.Now().Unix(),
		"server_time": time.Now().Format(time.RFC3339),
	}

	s.sendToTerminal(terminal.ID, response)
}

func (s *POSManagementServer) handleUpdateResponse(terminal *TerminalConnection, msg map[string]interface{}) {
	if data, ok := msg["data"].(map[string]interface{}); ok {
		updateID, _ := data["update_id"].(string)
		success, _ := data["success"].(bool)
		errorMsg, _ := data["error"].(string)

		s.logUpdateResponse(terminal.ID, updateID, success, errorMsg)
	}
}

func (s *POSManagementServer) handleCommandResponse(terminal *TerminalConnection, msg map[string]interface{}) {
	if data, ok := msg["data"].(map[string]interface{}); ok {
		commandID, _ := data["command_id"].(string)
		result, _ := data["result"].(map[string]interface{})
		success, _ := data["success"].(bool)
		errorMsg, _ := data["error"].(string)

		s.logCommandResponse(terminal.ID, commandID, result, success, errorMsg)
	}
}

func (s *POSManagementServer) handleAlert(terminal *TerminalConnection, msg map[string]interface{}) {
	if data, ok := msg["data"].(map[string]interface{}); ok {
		alertType, _ := data["alert_type"].(string)
		severity, _ := data["severity"].(string)
		message, _ := data["message"].(string)

		s.processAlert(terminal.ID, alertType, severity, message)
	}
}

func (s *POSManagementServer) distributeUpdate(update *UpdateMessage) {
	if update.TerminalID == "all" {
		// Broadcast to all terminals
		s.terminalsMutex.RLock()
		for _, terminal := range s.terminals {
			s.sendUpdateToTerminal(terminal, update)
		}
		s.terminalsMutex.RUnlock()
	} else {
		// Send to specific terminal
		s.terminalsMutex.RLock()
		if terminal, exists := s.terminals[update.TerminalID]; exists {
			s.sendUpdateToTerminal(terminal, update)
		}
		s.terminalsMutex.RUnlock()
	}

	// Log update distribution
	s.logUpdateDistribution(update)
}

func (s *POSManagementServer) sendUpdateToTerminal(terminal *TerminalConnection, update *UpdateMessage) {
	message := map[string]interface{}{
		"type": "update",
		"data": update,
	}

	messageBytes, err := json.Marshal(message)
	if err != nil {
		log.Printf("Error marshaling update message: %v", err)
		return
	}

	select {
	case terminal.SendChannel <- messageBytes:
		// Message sent successfully
	default:
		log.Printf("Terminal %s send channel full, dropping update", terminal.ID)
	}
}

func (s *POSManagementServer) executeCommand(command *CommandMessage) {
	s.terminalsMutex.RLock()
	terminal, exists := s.terminals[command.TerminalID]
	s.terminalsMutex.RUnlock()

	if !exists {
		log.Printf("Terminal %s not connected for command execution", command.TerminalID)
		return
	}

	message := map[string]interface{}{
		"type": "command",
		"data": command,
	}

	messageBytes, err := json.Marshal(message)
	if err != nil {
		log.Printf("Error marshaling command message: %v", err)
		return
	}

	select {
	case terminal.SendChannel <- messageBytes:
		s.logCommandExecution(command)
	default:
		log.Printf("Terminal %s send channel full, dropping command", command.TerminalID)
	}
}

func (s *POSManagementServer) processStatus(status *StatusMessage) {
	// Update terminal status in memory and database
	s.terminalsMutex.RLock()
	if terminal, exists := s.terminals[status.TerminalID]; exists {
		terminal.mutex.Lock()
		terminal.Status = status.Status
		terminal.Performance = status.Performance
		terminal.Location = status.Location
		terminal.LastSeen = time.Now()
		terminal.mutex.Unlock()
	}
	s.terminalsMutex.RUnlock()

	// Store in database
	s.storeStatusLog(status.TerminalID, map[string]interface{}{
		"status":      status.Status,
		"health":      status.Health,
		"performance": status.Performance,
		"location":    status.Location,
	})
}

func (s *POSManagementServer) monitorTerminalHealth() {
	s.terminalsMutex.RLock()
	defer s.terminalsMutex.RUnlock()

	for terminalID, terminal := range s.terminals {
		terminal.mutex.RLock()
		lastSeen := terminal.LastSeen
		terminal.mutex.RUnlock()

		if time.Since(lastSeen) > 2*time.Minute {
			log.Printf("Terminal %s appears to be offline (last seen: %v)", terminalID, lastSeen)
			s.handleTerminalOffline(terminalID)
		}
	}
}

func (s *POSManagementServer) cleanupDisconnectedTerminals() {
	s.terminalsMutex.Lock()
	defer s.terminalsMutex.Unlock()

	for terminalID, terminal := range s.terminals {
		terminal.mutex.RLock()
		lastSeen := terminal.LastSeen
		terminal.mutex.RUnlock()

		if time.Since(lastSeen) > 10*time.Minute {
			log.Printf("Cleaning up disconnected terminal %s", terminalID)
			terminal.Conn.Close()
			delete(s.terminals, terminalID)
		}
	}
}

func (s *POSManagementServer) sendToTerminal(terminalID string, message map[string]interface{}) {
	s.terminalsMutex.RLock()
	terminal, exists := s.terminals[terminalID]
	s.terminalsMutex.RUnlock()

	if !exists {
		return
	}

	messageBytes, err := json.Marshal(message)
	if err != nil {
		return
	}

	select {
	case terminal.SendChannel <- messageBytes:
		// Message sent successfully
	default:
		// Channel full, drop message
	}
}

// API Endpoints
func (s *POSManagementServer) getTerminals(c *gin.Context) {
	s.terminalsMutex.RLock()
	terminals := make([]map[string]interface{}, 0, len(s.terminals))
	for _, terminal := range s.terminals {
		terminal.mutex.RLock()
		terminalData := map[string]interface{}{
			"id":           terminal.ID,
			"status":       terminal.Status,
			"version":      terminal.Version,
			"last_seen":    terminal.LastSeen,
			"location":     terminal.Location,
			"performance":  terminal.Performance,
			"configuration": terminal.Configuration,
		}
		terminal.mutex.RUnlock()
		terminals = append(terminals, terminalData)
	}
	s.terminalsMutex.RUnlock()

	c.JSON(200, gin.H{
		"terminals": terminals,
		"count":     len(terminals),
		"timestamp": time.Now(),
	})
}

func (s *POSManagementServer) getTerminal(c *gin.Context) {
	terminalID := c.Param("id")
	
	s.terminalsMutex.RLock()
	terminal, exists := s.terminals[terminalID]
	s.terminalsMutex.RUnlock()

	if !exists {
		c.JSON(404, gin.H{"error": "terminal not found"})
		return
	}

	terminal.mutex.RLock()
	terminalData := map[string]interface{}{
		"id":           terminal.ID,
		"status":       terminal.Status,
		"version":      terminal.Version,
		"last_seen":    terminal.LastSeen,
		"location":     terminal.Location,
		"performance":  terminal.Performance,
		"configuration": terminal.Configuration,
		"is_authenticated": terminal.IsAuthenticated,
	}
	terminal.mutex.RUnlock()

	c.JSON(200, terminalData)
}

func (s *POSManagementServer) pushUpdate(c *gin.Context) {
	var update UpdateMessage
	if err := c.ShouldBindJSON(&update); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	update.ID = s.generateID()
	update.Timestamp = time.Now()
	update.Signature = s.signMessage(update)

	s.updateQueue <- &update

	c.JSON(200, gin.H{
		"update_id": update.ID,
		"status":    "queued",
		"timestamp": update.Timestamp,
	})
}

func (s *POSManagementServer) executeRemoteCommand(c *gin.Context) {
	var command CommandMessage
	if err := c.ShouldBindJSON(&command); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	command.ID = s.generateID()
	command.Timestamp = time.Now()
	command.Signature = s.signMessage(command)

	s.commandQueue <- &command

	c.JSON(200, gin.H{
		"command_id": command.ID,
		"status":     "queued",
		"timestamp":  command.Timestamp,
	})
}

// Helper functions
func (s *POSManagementServer) parseLocation(data map[string]interface{}) *Location {
	location := &Location{
		Timestamp: time.Now(),
	}

	if lat, ok := data["latitude"].(float64); ok {
		location.Latitude = lat
	}
	if lng, ok := data["longitude"].(float64); ok {
		location.Longitude = lng
	}
	if acc, ok := data["accuracy"].(float64); ok {
		location.Accuracy = acc
	}

	return location
}

func (s *POSManagementServer) parsePerformanceMetrics(data map[string]interface{}) *PerformanceMetrics {
	metrics := &PerformanceMetrics{
		LastUpdated: time.Now(),
	}

	if cpu, ok := data["cpu_usage"].(float64); ok {
		metrics.CPUUsage = cpu
	}
	if mem, ok := data["memory_usage"].(float64); ok {
		metrics.MemoryUsage = mem
	}
	if disk, ok := data["disk_usage"].(float64); ok {
		metrics.DiskUsage = disk
	}
	if latency, ok := data["network_latency"].(float64); ok {
		metrics.NetworkLatency = latency
	}
	if txnRate, ok := data["transaction_rate"].(float64); ok {
		metrics.TransactionRate = txnRate
	}
	if errRate, ok := data["error_rate"].(float64); ok {
		metrics.ErrorRate = errRate
	}
	if uptime, ok := data["uptime"].(float64); ok {
		metrics.Uptime = int64(uptime)
	}

	return metrics
}

func (s *POSManagementServer) generateID() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return fmt.Sprintf("%x", bytes)
}

func (s *POSManagementServer) signMessage(message interface{}) string {
	data, err := json.Marshal(message)
	if err != nil {
		log.Printf("Error marshaling message for signing: %v", err)
		return ""
	}
	h := hmac.New(sha256.New, []byte(s.securityManager.signingKey))
	h.Write(data)
	return fmt.Sprintf("%x", h.Sum(nil))
}

// Database models and logging functions
type Terminal struct {
	ID            string    `gorm:"primaryKey"`
	Status        string
	Version       string
	LastSeen      time.Time
	Configuration string // JSON
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type UpdateLog struct {
	ID         string `gorm:"primaryKey"`
	TerminalID string
	UpdateType string
	Payload    string // JSON
	Status     string
	CreatedAt  time.Time
}

type CommandLog struct {
	ID         string `gorm:"primaryKey"`
	TerminalID string
	Command    string
	Parameters string // JSON
	Result     string // JSON
	Status     string
	CreatedAt  time.Time
}

type StatusLog struct {
	ID         string `gorm:"primaryKey"`
	TerminalID string
	Status     string
	Health     string // JSON
	Performance string // JSON
	Location   string // JSON
	CreatedAt  time.Time
}

func (s *POSManagementServer) storeStatusLog(terminalID string, data map[string]interface{}) {
	dataJSON, _ := json.Marshal(data)
	
	statusLog := StatusLog{
		ID:         s.generateID(),
		TerminalID: terminalID,
		Status:     fmt.Sprintf("%v", data["status"]),
		Health:     string(dataJSON),
		CreatedAt:  time.Now(),
	}

	s.db.Create(&statusLog)
}

func (s *POSManagementServer) logUpdateDistribution(update *UpdateMessage) {
	payloadJSON, _ := json.Marshal(update.Payload)
	
	updateLog := UpdateLog{
		ID:         update.ID,
		TerminalID: update.TerminalID,
		UpdateType: update.Type,
		Payload:    string(payloadJSON),
		Status:     "distributed",
		CreatedAt:  time.Now(),
	}

	s.db.Create(&updateLog)
}

func (s *POSManagementServer) logUpdateResponse(terminalID, updateID string, success bool, errorMsg string) {
	status := "success"
	if !success {
		status = "failed"
	}

	s.db.Model(&UpdateLog{}).Where("id = ?", updateID).Updates(map[string]interface{}{
		"status": status,
	})
}

func (s *POSManagementServer) logCommandExecution(command *CommandMessage) {
	parametersJSON, _ := json.Marshal(command.Parameters)
	
	commandLog := CommandLog{
		ID:         command.ID,
		TerminalID: command.TerminalID,
		Command:    command.Command,
		Parameters: string(parametersJSON),
		Status:     "executed",
		CreatedAt:  time.Now(),
	}

	s.db.Create(&commandLog)
}

func (s *POSManagementServer) logCommandResponse(terminalID, commandID string, result map[string]interface{}, success bool, errorMsg string) {
	resultJSON, _ := json.Marshal(result)
	status := "success"
	if !success {
		status = "failed"
	}

	s.db.Model(&CommandLog{}).Where("id = ?", commandID).Updates(map[string]interface{}{
		"result": string(resultJSON),
		"status": status,
	})
}

func (s *POSManagementServer) processAlert(terminalID, alertType, severity, message string) {
	log.Printf("ALERT from %s [%s/%s]: %s", terminalID, alertType, severity, message)
	
	// Store alert in database
	alert := map[string]interface{}{
		"terminal_id": terminalID,
		"alert_type":  alertType,
		"severity":    severity,
		"message":     message,
		"timestamp":   time.Now(),
	}

	alertJSON, _ := json.Marshal(alert)
	s.redis.LPush(context.Background(), "alerts", alertJSON)
}

func (s *POSManagementServer) handleTerminalOffline(terminalID string) {
	log.Printf("Handling offline terminal: %s", terminalID)
	
	// Update terminal status
	s.db.Model(&Terminal{}).Where("id = ?", terminalID).Update("status", "offline")
	
	// Trigger alerts
	s.processAlert(terminalID, "connectivity", "high", "Terminal went offline")
}

// NATS message handlers
func (s *POSManagementServer) handleNATSStatus(msg *nats.Msg) {
	var status StatusMessage
	if err := json.Unmarshal(msg.Data, &status); err != nil {
		return
	}
	s.statusQueue <- &status
}

func (s *POSManagementServer) handleNATSUpdateResponse(msg *nats.Msg) {
	var response map[string]interface{}
	if err := json.Unmarshal(msg.Data, &response); err != nil {
		return
	}
	
	terminalID, _ := response["terminal_id"].(string)
	updateID, _ := response["update_id"].(string)
	success, _ := response["success"].(bool)
	errorMsg, _ := response["error"].(string)
	
	s.logUpdateResponse(terminalID, updateID, success, errorMsg)
}

func (s *POSManagementServer) handleNATSCommandResponse(msg *nats.Msg) {
	var response map[string]interface{}
	if err := json.Unmarshal(msg.Data, &response); err != nil {
		return
	}
	
	terminalID, _ := response["terminal_id"].(string)
	commandID, _ := response["command_id"].(string)
	result, _ := response["result"].(map[string]interface{})
	success, _ := response["success"].(bool)
	errorMsg, _ := response["error"].(string)
	
	s.logCommandResponse(terminalID, commandID, result, success, errorMsg)
}

func main() {
	server := NewPOSManagementServer()
	
	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	// WebSocket endpoint
	r.GET("/ws", server.handleWebSocket)

	// API endpoints
	api := r.Group("/api/v1")
	{
		api.GET("/terminals", server.getTerminals)
		api.GET("/terminals/:id", server.getTerminal)
		api.POST("/updates", server.pushUpdate)
		api.POST("/commands", server.executeRemoteCommand)
	}

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":    "healthy",
			"service":   "pos-management-server",
			"version":   "1.0.0",
			"timestamp": time.Now(),
			"terminals": len(server.terminals),
		})
	})

	log.Println("POS Management Server starting on :8095")
	log.Fatal(http.ListenAndServe(":8095", r))
}

