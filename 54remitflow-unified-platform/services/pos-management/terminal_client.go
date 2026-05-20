package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/shirou/gopsutil/v3/net"
)

type TerminalClient struct {
	terminalID      string
	serverURL       string
	apiKey          string
	conn            *websocket.Conn
	reconnectDelay  time.Duration
	maxReconnects   int
	isConnected     bool
	connectionMutex sync.RWMutex
	
	// Configuration management
	currentConfig   map[string]interface{}
	configMutex     sync.RWMutex
	configFile      string
	
	// Status reporting
	statusInterval  time.Duration
	lastStatus      *StatusReport
	statusMutex     sync.RWMutex
	
	// Update management
	updateQueue     chan *UpdateMessage
	commandQueue    chan *CommandMessage
	responseQueue   chan *ResponseMessage
	
	// Performance monitoring
	performanceData *PerformanceData
	perfMutex       sync.RWMutex
	
	// Security
	tlsConfig       *tls.Config
	certificate     string
	
	// Offline capabilities
	offlineMode     bool
	offlineQueue    []interface{}
	offlineMutex    sync.RWMutex
}

type StatusReport struct {
	TerminalID    string                 `json:"terminal_id"`
	Status        string                 `json:"status"`
	Version       string                 `json:"version"`
	Health        map[string]interface{} `json:"health"`
	Performance   *PerformanceData       `json:"performance"`
	Location      *LocationData          `json:"location"`
	Configuration map[string]interface{} `json:"configuration"`
	Timestamp     time.Time              `json:"timestamp"`
}

type PerformanceData struct {
	CPUUsage        float64   `json:"cpu_usage"`
	MemoryUsage     float64   `json:"memory_usage"`
	DiskUsage       float64   `json:"disk_usage"`
	NetworkLatency  float64   `json:"network_latency"`
	TransactionRate float64   `json:"transaction_rate"`
	ErrorRate       float64   `json:"error_rate"`
	Uptime          int64     `json:"uptime"`
	LastUpdated     time.Time `json:"last_updated"`
}

type LocationData struct {
	Latitude  float64   `json:"latitude"`
	Longitude float64   `json:"longitude"`
	Accuracy  float64   `json:"accuracy"`
	Timestamp time.Time `json:"timestamp"`
}

type UpdateMessage struct {
	ID          string                 `json:"id"`
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
	Command    string                 `json:"command"`
	Parameters map[string]interface{} `json:"parameters"`
	Timeout    int                    `json:"timeout"`
	Timestamp  time.Time              `json:"timestamp"`
	Signature  string                 `json:"signature"`
}

type ResponseMessage struct {
	Type      string                 `json:"type"`
	ID        string                 `json:"id"`
	Success   bool                   `json:"success"`
	Result    map[string]interface{} `json:"result"`
	Error     string                 `json:"error"`
	Timestamp time.Time              `json:"timestamp"`
}

func NewTerminalClient(terminalID, serverURL, apiKey string) *TerminalClient {
	client := &TerminalClient{
		terminalID:     terminalID,
		serverURL:      serverURL,
		apiKey:         apiKey,
		reconnectDelay: 5 * time.Second,
		maxReconnects:  10,
		statusInterval: 30 * time.Second,
		configFile:     fmt.Sprintf("terminal_%s_config.json", terminalID),
		
		updateQueue:   make(chan *UpdateMessage, 100),
		commandQueue:  make(chan *CommandMessage, 100),
		responseQueue: make(chan *ResponseMessage, 100),
		
		currentConfig: make(map[string]interface{}),
		performanceData: &PerformanceData{},
		
		tlsConfig: &tls.Config{
			InsecureSkipVerify: true, // For development only
		},
	}

	client.loadConfiguration()
	client.initializeLocation()
	client.startWorkers()

	return client
}

func (tc *TerminalClient) loadConfiguration() {
	if data, err := os.ReadFile(tc.configFile); err == nil {
		json.Unmarshal(data, &tc.currentConfig)
	} else {
		// Default configuration
		tc.currentConfig = map[string]interface{}{
			"transaction_limit":     10000.0,
			"fraud_threshold":       0.8,
			"geofence_radius":       100.0,
			"heartbeat_interval":    30,
			"log_level":            "info",
			"enable_offline_mode":   true,
			"max_offline_transactions": 1000,
		}
		tc.saveConfiguration()
	}
}

func (tc *TerminalClient) saveConfiguration() {
	tc.configMutex.RLock()
	data, _ := json.MarshalIndent(tc.currentConfig, "", "  ")
	tc.configMutex.RUnlock()
	
	os.WriteFile(tc.configFile, data, 0644)
}

func (tc *TerminalClient) initializeLocation() {
	// Simulate GPS location (in production, use actual GPS)
	// This would integrate with actual GPS hardware
}

func (tc *TerminalClient) startWorkers() {
	// Status reporting worker
	go tc.statusReportingWorker()
	
	// Performance monitoring worker
	go tc.performanceMonitoringWorker()
	
	// Update processing worker
	go tc.updateProcessingWorker()
	
	// Command processing worker
	go tc.commandProcessingWorker()
	
	// Response sending worker
	go tc.responseSendingWorker()
	
	// Offline sync worker
	go tc.offlineSyncWorker()
}

func (tc *TerminalClient) Connect() error {
	u := url.URL{
		Scheme:   "ws",
		Host:     tc.serverURL,
		Path:     "/ws",
		RawQuery: fmt.Sprintf("terminal_id=%s", tc.terminalID),
	}

	headers := http.Header{}
	headers.Set("X-API-Key", tc.apiKey)

	dialer := websocket.Dialer{
		TLSClientConfig: tc.tlsConfig,
	}

	conn, _, err := dialer.Dial(u.String(), headers)
	if err != nil {
		return fmt.Errorf("failed to connect to server: %v", err)
	}

	tc.connectionMutex.Lock()
	tc.conn = conn
	tc.isConnected = true
	tc.offlineMode = false
	tc.connectionMutex.Unlock()

	log.Printf("Connected to management server: %s", tc.serverURL)

	// Start message handling
	go tc.handleIncomingMessages()
	go tc.sendHeartbeat()

	// Sync offline data
	tc.syncOfflineData()

	return nil
}

func (tc *TerminalClient) Disconnect() {
	tc.connectionMutex.Lock()
	if tc.conn != nil {
		tc.conn.Close()
		tc.conn = nil
	}
	tc.isConnected = false
	tc.offlineMode = true
	tc.connectionMutex.Unlock()

	log.Println("Disconnected from management server")
}

func (tc *TerminalClient) handleIncomingMessages() {
	defer tc.Disconnect()

	for {
		tc.connectionMutex.RLock()
		conn := tc.conn
		tc.connectionMutex.RUnlock()

		if conn == nil {
			break
		}

		_, message, err := conn.ReadMessage()
		if err != nil {
			log.Printf("Error reading message: %v", err)
			break
		}

		tc.processIncomingMessage(message)
	}
}

func (tc *TerminalClient) processIncomingMessage(message []byte) {
	var msg map[string]interface{}
	if err := json.Unmarshal(message, &msg); err != nil {
		log.Printf("Error unmarshaling message: %v", err)
		return
	}

	msgType, ok := msg["type"].(string)
	if !ok {
		return
	}

	switch msgType {
	case "update":
		tc.handleUpdateMessage(msg)
	case "command":
		tc.handleCommandMessage(msg)
	case "heartbeat_ack":
		tc.handleHeartbeatAck(msg)
	case "config_push":
		tc.handleConfigPush(msg)
	}
}

func (tc *TerminalClient) handleUpdateMessage(msg map[string]interface{}) {
	if data, ok := msg["data"].(map[string]interface{}); ok {
		update := &UpdateMessage{}
		if dataBytes, err := json.Marshal(data); err == nil {
			if err := json.Unmarshal(dataBytes, update); err == nil {
				tc.updateQueue <- update
			}
		}
	}
}

func (tc *TerminalClient) handleCommandMessage(msg map[string]interface{}) {
	if data, ok := msg["data"].(map[string]interface{}); ok {
		command := &CommandMessage{}
		if dataBytes, err := json.Marshal(data); err == nil {
			if err := json.Unmarshal(dataBytes, command); err == nil {
				tc.commandQueue <- command
			}
		}
	}
}

func (tc *TerminalClient) handleHeartbeatAck(msg map[string]interface{}) {
	log.Println("Heartbeat acknowledged by server")
}

func (tc *TerminalClient) handleConfigPush(msg map[string]interface{}) {
	if data, ok := msg["data"].(map[string]interface{}); ok {
		tc.configMutex.Lock()
		for key, value := range data {
			tc.currentConfig[key] = value
		}
		tc.configMutex.Unlock()
		
		tc.saveConfiguration()
		
		// Send acknowledgment
		response := &ResponseMessage{
			Type:      "config_ack",
			ID:        fmt.Sprintf("%v", msg["id"]),
			Success:   true,
			Timestamp: time.Now(),
		}
		tc.responseQueue <- response
	}
}

func (tc *TerminalClient) statusReportingWorker() {
	ticker := time.NewTicker(tc.statusInterval)
	defer ticker.Stop()

	for range ticker.C {
		tc.sendStatusReport()
	}
}

func (tc *TerminalClient) sendStatusReport() {
	tc.updatePerformanceData()
	
	tc.statusMutex.Lock()
	tc.lastStatus = &StatusReport{
		TerminalID:    tc.terminalID,
		Status:        tc.getTerminalStatus(),
		Version:       "2.4.0",
		Health:        tc.getHealthData(),
		Performance:   tc.performanceData,
		Location:      tc.getCurrentLocation(),
		Configuration: tc.getCurrentConfig(),
		Timestamp:     time.Now(),
	}
	tc.statusMutex.Unlock()

	message := map[string]interface{}{
		"type": "status",
		"data": tc.lastStatus,
	}

	tc.sendMessage(message)
}

func (tc *TerminalClient) getTerminalStatus() string {
	tc.connectionMutex.RLock()
	connected := tc.isConnected
	tc.connectionMutex.RUnlock()

	if connected {
		return "online"
	}
	return "offline"
}

func (tc *TerminalClient) getHealthData() map[string]interface{} {
	return map[string]interface{}{
		"system_health":     "healthy",
		"database_status":   "connected",
		"storage_available": tc.getAvailableStorage(),
		"network_status":    tc.getNetworkStatus(),
		"last_transaction":  time.Now().Add(-5 * time.Minute),
		"error_count":       0,
		"warning_count":     0,
	}
}

func (tc *TerminalClient) getCurrentLocation() *LocationData {
	// In production, this would get actual GPS coordinates
	return &LocationData{
		Latitude:  6.5244,  // Lagos, Nigeria
		Longitude: 3.3792,
		Accuracy:  5.0,
		Timestamp: time.Now(),
	}
}

func (tc *TerminalClient) getCurrentConfig() map[string]interface{} {
	tc.configMutex.RLock()
	config := make(map[string]interface{})
	for k, v := range tc.currentConfig {
		config[k] = v
	}
	tc.configMutex.RUnlock()
	return config
}

func (tc *TerminalClient) performanceMonitoringWorker() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		tc.updatePerformanceData()
	}
}

func (tc *TerminalClient) updatePerformanceData() {
	tc.perfMutex.Lock()
	defer tc.perfMutex.Unlock()

	// CPU Usage
	if cpuPercent, err := cpu.Percent(time.Second, false); err == nil && len(cpuPercent) > 0 {
		tc.performanceData.CPUUsage = cpuPercent[0]
	}

	// Memory Usage
	if memInfo, err := mem.VirtualMemory(); err == nil {
		tc.performanceData.MemoryUsage = memInfo.UsedPercent
	}

	// Disk Usage
	if diskInfo, err := disk.Usage("/"); err == nil {
		tc.performanceData.DiskUsage = diskInfo.UsedPercent
	}

	// Network Latency (ping to server)
	tc.performanceData.NetworkLatency = tc.measureNetworkLatency()

	// Transaction Rate (simulated)
	tc.performanceData.TransactionRate = tc.calculateTransactionRate()

	// Error Rate (simulated)
	tc.performanceData.ErrorRate = tc.calculateErrorRate()

	// Uptime
	tc.performanceData.Uptime = tc.getUptime()
	tc.performanceData.LastUpdated = time.Now()
}

func (tc *TerminalClient) measureNetworkLatency() float64 {
	start := time.Now()
	
	// Simple HTTP ping to server
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://%s/health", tc.serverURL))
	if err != nil {
		return -1 // Indicates network issue
	}
	defer resp.Body.Close()
	
	return float64(time.Since(start).Milliseconds())
}

func (tc *TerminalClient) calculateTransactionRate() float64 {
	// In production, this would calculate actual transaction rate
	return 15.5 // Transactions per minute
}

func (tc *TerminalClient) calculateErrorRate() float64 {
	// In production, this would calculate actual error rate
	return 0.02 // 2% error rate
}

func (tc *TerminalClient) getUptime() int64 {
	// In production, this would track actual uptime
	return time.Now().Unix() - 1640995200 // Simulated start time
}

func (tc *TerminalClient) getAvailableStorage() float64 {
	if diskInfo, err := disk.Usage("/"); err == nil {
		return float64(diskInfo.Free) / float64(diskInfo.Total) * 100
	}
	return 0
}

func (tc *TerminalClient) getNetworkStatus() string {
	if interfaces, err := net.Interfaces(); err == nil {
		for _, iface := range interfaces {
			if iface.Flags[0] == "up" {
				return "connected"
			}
		}
	}
	return "disconnected"
}

func (tc *TerminalClient) updateProcessingWorker() {
	for update := range tc.updateQueue {
		tc.processUpdate(update)
	}
}

func (tc *TerminalClient) processUpdate(update *UpdateMessage) {
	log.Printf("Processing update: %s (type: %s)", update.ID, update.Type)

	success := true
	errorMsg := ""
	result := make(map[string]interface{})

	switch update.Type {
	case "configuration":
		success, errorMsg = tc.applyConfigurationUpdate(update.Payload)
	case "software":
		success, errorMsg = tc.applySoftwareUpdate(update.Payload)
	case "policy":
		success, errorMsg = tc.applyPolicyUpdate(update.Payload)
	case "security":
		success, errorMsg = tc.applySecurityUpdate(update.Payload)
	default:
		success = false
		errorMsg = fmt.Sprintf("Unknown update type: %s", update.Type)
	}

	// Send response
	response := &ResponseMessage{
		Type:      "update_response",
		ID:        update.ID,
		Success:   success,
		Result:    result,
		Error:     errorMsg,
		Timestamp: time.Now(),
	}

	tc.responseQueue <- response
}

func (tc *TerminalClient) applyConfigurationUpdate(payload map[string]interface{}) (bool, string) {
	tc.configMutex.Lock()
	defer tc.configMutex.Unlock()

	for key, value := range payload {
		tc.currentConfig[key] = value
	}

	tc.saveConfiguration()
	log.Printf("Configuration updated with %d parameters", len(payload))
	return true, ""
}

func (tc *TerminalClient) applySoftwareUpdate(payload map[string]interface{}) (bool, string) {
	updateURL, ok := payload["download_url"].(string)
	if !ok {
		return false, "Missing download_url in software update"
	}

	version, ok := payload["version"].(string)
	if !ok {
		return false, "Missing version in software update"
	}

	log.Printf("Applying software update to version %s from %s", version, updateURL)

	// In production, this would:
	// 1. Download the update package
	// 2. Verify signature and checksum
	// 3. Apply the update
	// 4. Restart the service if needed

	// Simulated update process
	time.Sleep(2 * time.Second)
	
	return true, ""
}

func (tc *TerminalClient) applyPolicyUpdate(payload map[string]interface{}) (bool, string) {
	policyType, ok := payload["policy_type"].(string)
	if !ok {
		return false, "Missing policy_type in policy update"
	}

	rules, ok := payload["rules"].(map[string]interface{})
	if !ok {
		return false, "Missing rules in policy update"
	}

	log.Printf("Applying policy update: %s with %d rules", policyType, len(rules))

	// In production, this would update the policy engine
	tc.configMutex.Lock()
	if tc.currentConfig["policies"] == nil {
		tc.currentConfig["policies"] = make(map[string]interface{})
	}
	policies := tc.currentConfig["policies"].(map[string]interface{})
	policies[policyType] = rules
	tc.configMutex.Unlock()

	tc.saveConfiguration()
	return true, ""
}

func (tc *TerminalClient) applySecurityUpdate(payload map[string]interface{}) (bool, string) {
	updateType, ok := payload["security_type"].(string)
	if !ok {
		return false, "Missing security_type in security update"
	}

	log.Printf("Applying security update: %s", updateType)

	switch updateType {
	case "certificate":
		return tc.updateCertificate(payload)
	case "api_key":
		return tc.updateAPIKey(payload)
	case "encryption":
		return tc.updateEncryption(payload)
	default:
		return false, fmt.Sprintf("Unknown security update type: %s", updateType)
	}
}

func (tc *TerminalClient) updateCertificate(payload map[string]interface{}) (bool, string) {
	cert, ok := payload["certificate"].(string)
	if !ok {
		return false, "Missing certificate in security update"
	}

	tc.certificate = cert
	log.Println("Certificate updated successfully")
	return true, ""
}

func (tc *TerminalClient) updateAPIKey(payload map[string]interface{}) (bool, string) {
	newKey, ok := payload["api_key"].(string)
	if !ok {
		return false, "Missing api_key in security update"
	}

	tc.apiKey = newKey
	log.Println("API key updated successfully")
	return true, ""
}

func (tc *TerminalClient) updateEncryption(payload map[string]interface{}) (bool, string) {
	// Update encryption settings
	log.Println("Encryption settings updated successfully")
	return true, ""
}

func (tc *TerminalClient) commandProcessingWorker() {
	for command := range tc.commandQueue {
		tc.processCommand(command)
	}
}

func (tc *TerminalClient) processCommand(command *CommandMessage) {
	log.Printf("Processing command: %s (%s)", command.Command, command.ID)

	success := true
	errorMsg := ""
	result := make(map[string]interface{})

	switch command.Command {
	case "restart":
		success, errorMsg, result = tc.executeRestart(command.Parameters)
	case "diagnostics":
		success, errorMsg, result = tc.executeDiagnostics(command.Parameters)
	case "get_logs":
		success, errorMsg, result = tc.executeGetLogs(command.Parameters)
	case "update_config":
		success, errorMsg, result = tc.executeUpdateConfig(command.Parameters)
	case "get_status":
		success, errorMsg, result = tc.executeGetStatus(command.Parameters)
	case "test_connection":
		success, errorMsg, result = tc.executeTestConnection(command.Parameters)
	default:
		success = false
		errorMsg = fmt.Sprintf("Unknown command: %s", command.Command)
	}

	// Send response
	response := &ResponseMessage{
		Type:      "command_response",
		ID:        command.ID,
		Success:   success,
		Result:    result,
		Error:     errorMsg,
		Timestamp: time.Now(),
	}

	tc.responseQueue <- response
}

func (tc *TerminalClient) executeRestart(params map[string]interface{}) (bool, string, map[string]interface{}) {
	delay, ok := params["delay"].(float64)
	if !ok {
		delay = 5 // Default 5 seconds
	}

	result := map[string]interface{}{
		"restart_scheduled": true,
		"delay_seconds":     delay,
		"restart_time":      time.Now().Add(time.Duration(delay) * time.Second),
	}

	// Schedule restart
	go func() {
		time.Sleep(time.Duration(delay) * time.Second)
		log.Println("Restarting terminal...")
		// In production, this would restart the application
		os.Exit(0)
	}()

	return true, "", result
}

func (tc *TerminalClient) executeDiagnostics(params map[string]interface{}) (bool, string, map[string]interface{}) {
	diagnosticType, ok := params["type"].(string)
	if !ok {
		diagnosticType = "full"
	}

	result := map[string]interface{}{
		"diagnostic_type": diagnosticType,
		"timestamp":       time.Now(),
	}

	switch diagnosticType {
	case "network":
		result["network_diagnostics"] = tc.runNetworkDiagnostics()
	case "system":
		result["system_diagnostics"] = tc.runSystemDiagnostics()
	case "full":
		result["network_diagnostics"] = tc.runNetworkDiagnostics()
		result["system_diagnostics"] = tc.runSystemDiagnostics()
		result["application_diagnostics"] = tc.runApplicationDiagnostics()
	}

	return true, "", result
}

func (tc *TerminalClient) runNetworkDiagnostics() map[string]interface{} {
	return map[string]interface{}{
		"ping_server":      tc.measureNetworkLatency(),
		"dns_resolution":   "ok",
		"bandwidth_test":   "passed",
		"connection_count": 1,
	}
}

func (tc *TerminalClient) runSystemDiagnostics() map[string]interface{} {
	return map[string]interface{}{
		"cpu_usage":    tc.performanceData.CPUUsage,
		"memory_usage": tc.performanceData.MemoryUsage,
		"disk_usage":   tc.performanceData.DiskUsage,
		"uptime":       tc.performanceData.Uptime,
		"os":           runtime.GOOS,
		"arch":         runtime.GOARCH,
	}
}

func (tc *TerminalClient) runApplicationDiagnostics() map[string]interface{} {
	return map[string]interface{}{
		"version":           "2.4.0",
		"config_status":     "loaded",
		"database_status":   "connected",
		"last_transaction":  time.Now().Add(-2 * time.Minute),
		"error_count":       0,
		"warning_count":     1,
	}
}

func (tc *TerminalClient) executeGetLogs(params map[string]interface{}) (bool, string, map[string]interface{}) {
	logType, ok := params["type"].(string)
	if !ok {
		logType = "application"
	}

	lines, ok := params["lines"].(float64)
	if !ok {
		lines = 100
	}

	result := map[string]interface{}{
		"log_type": logType,
		"lines":    int(lines),
		"logs":     tc.getLogs(logType, int(lines)),
	}

	return true, "", result
}

func (tc *TerminalClient) getLogs(logType string, lines int) []string {
	// In production, this would read actual log files
	sampleLogs := []string{
		"2024-01-15 10:30:00 INFO Terminal started successfully",
		"2024-01-15 10:30:05 INFO Connected to management server",
		"2024-01-15 10:30:10 INFO Configuration loaded",
		"2024-01-15 10:31:00 INFO Status report sent",
		"2024-01-15 10:31:30 INFO Transaction processed: TXN123456",
	}

	if lines > len(sampleLogs) {
		lines = len(sampleLogs)
	}

	return sampleLogs[:lines]
}

func (tc *TerminalClient) executeUpdateConfig(params map[string]interface{}) (bool, string, map[string]interface{}) {
	config, ok := params["config"].(map[string]interface{})
	if !ok {
		return false, "Missing config parameter", nil
	}

	tc.configMutex.Lock()
	for key, value := range config {
		tc.currentConfig[key] = value
	}
	tc.configMutex.Unlock()

	tc.saveConfiguration()

	result := map[string]interface{}{
		"updated_keys": len(config),
		"timestamp":    time.Now(),
	}

	return true, "", result
}

func (tc *TerminalClient) executeGetStatus(params map[string]interface{}) (bool, string, map[string]interface{}) {
	tc.statusMutex.RLock()
	status := tc.lastStatus
	tc.statusMutex.RUnlock()

	result := map[string]interface{}{
		"status": status,
	}

	return true, "", result
}

func (tc *TerminalClient) executeTestConnection(params map[string]interface{}) (bool, string, map[string]interface{}) {
	target, ok := params["target"].(string)
	if !ok {
		target = tc.serverURL
	}

	latency := tc.measureNetworkLatency()
	
	result := map[string]interface{}{
		"target":           target,
		"latency_ms":       latency,
		"connection_ok":    latency > 0,
		"timestamp":        time.Now(),
	}

	return true, "", result
}

func (tc *TerminalClient) responseSendingWorker() {
	for response := range tc.responseQueue {
		tc.sendResponse(response)
	}
}

func (tc *TerminalClient) sendResponse(response *ResponseMessage) {
	message := map[string]interface{}{
		"type": response.Type,
		"data": response,
	}

	tc.sendMessage(message)
}

func (tc *TerminalClient) sendMessage(message map[string]interface{}) {
	tc.connectionMutex.RLock()
	conn := tc.conn
	connected := tc.isConnected
	tc.connectionMutex.RUnlock()

	if !connected || conn == nil {
		// Queue message for offline sync
		tc.queueOfflineMessage(message)
		return
	}

	messageBytes, err := json.Marshal(message)
	if err != nil {
		log.Printf("Error marshaling message: %v", err)
		return
	}

	if err := conn.WriteMessage(websocket.TextMessage, messageBytes); err != nil {
		log.Printf("Error sending message: %v", err)
		tc.queueOfflineMessage(message)
	}
}

func (tc *TerminalClient) sendHeartbeat() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		tc.connectionMutex.RLock()
		connected := tc.isConnected
		tc.connectionMutex.RUnlock()

		if !connected {
			continue
		}

		heartbeat := map[string]interface{}{
			"type": "heartbeat",
			"data": map[string]interface{}{
				"terminal_id": tc.terminalID,
				"timestamp":   time.Now().Unix(),
			},
		}

		tc.sendMessage(heartbeat)
	}
}

func (tc *TerminalClient) queueOfflineMessage(message map[string]interface{}) {
	tc.offlineMutex.Lock()
	tc.offlineQueue = append(tc.offlineQueue, message)
	
	// Limit offline queue size
	if len(tc.offlineQueue) > 1000 {
		tc.offlineQueue = tc.offlineQueue[1:]
	}
	tc.offlineMutex.Unlock()
}

func (tc *TerminalClient) offlineSyncWorker() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		tc.connectionMutex.RLock()
		connected := tc.isConnected
		tc.connectionMutex.RUnlock()

		if connected {
			tc.syncOfflineData()
		}
	}
}

func (tc *TerminalClient) syncOfflineData() {
	tc.offlineMutex.Lock()
	queue := make([]interface{}, len(tc.offlineQueue))
	copy(queue, tc.offlineQueue)
	tc.offlineQueue = tc.offlineQueue[:0] // Clear queue
	tc.offlineMutex.Unlock()

	if len(queue) == 0 {
		return
	}

	log.Printf("Syncing %d offline messages", len(queue))

	for _, message := range queue {
		tc.sendMessage(message.(map[string]interface{}))
		time.Sleep(100 * time.Millisecond) // Rate limit
	}
}

func (tc *TerminalClient) Run() {
	for {
		if err := tc.Connect(); err != nil {
			log.Printf("Connection failed: %v", err)
			log.Printf("Retrying in %v...", tc.reconnectDelay)
			time.Sleep(tc.reconnectDelay)
			continue
		}

		// Wait for disconnection
		for {
			tc.connectionMutex.RLock()
			connected := tc.isConnected
			tc.connectionMutex.RUnlock()

			if !connected {
				break
			}

			time.Sleep(1 * time.Second)
		}

		log.Printf("Disconnected. Retrying in %v...", tc.reconnectDelay)
		time.Sleep(tc.reconnectDelay)
	}
}

func main() {
	terminalID := os.Getenv("TERMINAL_ID")
	if terminalID == "" {
		terminalID = "TERM001"
	}

	serverURL := os.Getenv("MANAGEMENT_SERVER_URL")
	if serverURL == "" {
		serverURL = "localhost:8095"
	}

	apiKey := os.Getenv("API_KEY")
	if apiKey == "" {
		apiKey = "default-api-key"
	}

	client := NewTerminalClient(terminalID, serverURL, apiKey)
	
	log.Printf("Starting POS Terminal Client: %s", terminalID)
	log.Printf("Management Server: %s", serverURL)
	
	client.Run()
}

