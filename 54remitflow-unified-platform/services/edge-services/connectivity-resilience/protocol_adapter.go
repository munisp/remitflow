package main

import (
	"bytes"
	"compress/gzip"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"
)

// ProtocolAdapter manages adaptive protocol selection and optimization
type ProtocolAdapter struct {
	cm                *ConnectivityManager
	protocols         map[string]*Protocol
	adaptationRules   []*AdaptationRule
	compressionEngine *CompressionEngine
	encryptionEngine  *EncryptionEngine
	mu                sync.RWMutex
}

// Protocol represents a communication protocol
type Protocol struct {
	Name            string                 `json:"name"`
	Type            string                 `json:"type"` // http, https, websocket, tcp, udp, mqtt, coap
	Port            int                    `json:"port"`
	Encryption      bool                   `json:"encryption"`
	Compression     bool                   `json:"compression"`
	Reliability     string                 `json:"reliability"` // high, medium, low
	Overhead        float64                `json:"overhead"` // Protocol overhead percentage
	MinBandwidth    int                    `json:"min_bandwidth"` // Minimum bandwidth required (Kbps)
	MaxLatency      int                    `json:"max_latency"` // Maximum acceptable latency (ms)
	BatteryImpact   string                 `json:"battery_impact"` // high, medium, low
	Config          map[string]interface{} `json:"config"`
	Enabled         bool                   `json:"enabled"`
	Priority        int                    `json:"priority"`
}

// AdaptationRule defines when to switch protocols
type AdaptationRule struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	Conditions  []AdaptationCondition  `json:"conditions"`
	Action      AdaptationAction       `json:"action"`
	Priority    int                    `json:"priority"`
	Enabled     bool                   `json:"enabled"`
}

// AdaptationCondition defines a condition for protocol adaptation
type AdaptationCondition struct {
	Parameter string      `json:"parameter"` // latency, bandwidth, packet_loss, battery_level, etc.
	Operator  string      `json:"operator"`  // gt, lt, eq, gte, lte
	Value     interface{} `json:"value"`
	Duration  int         `json:"duration"` // Condition must be true for this duration (seconds)
}

// AdaptationAction defines the action to take when conditions are met
type AdaptationAction struct {
	Type       string                 `json:"type"` // switch_protocol, enable_compression, adjust_timeout
	Protocol   string                 `json:"protocol,omitempty"`
	Parameters map[string]interface{} `json:"parameters,omitempty"`
}

// CompressionEngine handles data compression for bandwidth optimization
type CompressionEngine struct {
	algorithms map[string]CompressionAlgorithm
	stats      CompressionStats
	mu         sync.RWMutex
}

// CompressionAlgorithm represents a compression algorithm
type CompressionAlgorithm struct {
	Name           string  `json:"name"`
	CompressionRatio float64 `json:"compression_ratio"` // Average compression ratio
	CPUCost        int     `json:"cpu_cost"` // CPU cost (1-10)
	MemoryCost     int     `json:"memory_cost"` // Memory cost (1-10)
	Enabled        bool    `json:"enabled"`
}

// CompressionStats tracks compression statistics
type CompressionStats struct {
	TotalBytesIn       int64   `json:"total_bytes_in"`
	TotalBytesOut      int64   `json:"total_bytes_out"`
	CompressionRatio   float64 `json:"compression_ratio"`
	BandwidthSaved     int64   `json:"bandwidth_saved"`
	CompressionTime    int64   `json:"compression_time_ms"`
	DecompressionTime  int64   `json:"decompression_time_ms"`
}

// EncryptionEngine handles data encryption for security
type EncryptionEngine struct {
	algorithms map[string]EncryptionAlgorithm
	mu         sync.RWMutex
}

// EncryptionAlgorithm represents an encryption algorithm
type EncryptionAlgorithm struct {
	Name       string `json:"name"`
	KeySize    int    `json:"key_size"`
	CPUCost    int    `json:"cpu_cost"` // CPU cost (1-10)
	Security   int    `json:"security"` // Security level (1-10)
	Enabled    bool   `json:"enabled"`
}

// HTTPClient represents an adaptive HTTP client
type HTTPClient struct {
	client          *http.Client
	compressionType string
	timeout         time.Duration
	retryCount      int
	retryDelay      time.Duration
}

// WebSocketClient represents an adaptive WebSocket client
type WebSocketClient struct {
	url             string
	compressionType string
	pingInterval    time.Duration
	pongTimeout     time.Duration
}

// MQTTClient represents an adaptive MQTT client
type MQTTClient struct {
	broker          string
	clientID        string
	keepAlive       int
	cleanSession    bool
	qos             byte
	compressionType string
}

// NewProtocolAdapter creates a new protocol adapter
func NewProtocolAdapter(cm *ConnectivityManager) *ProtocolAdapter {
	pa := &ProtocolAdapter{
		cm:                cm,
		protocols:         make(map[string]*Protocol),
		adaptationRules:   []*AdaptationRule{},
		compressionEngine: NewCompressionEngine(),
		encryptionEngine:  NewEncryptionEngine(),
	}

	pa.initializeProtocols()
	pa.initializeAdaptationRules()

	return pa
}

// initializeProtocols sets up default protocols
func (pa *ProtocolAdapter) initializeProtocols() {
	protocols := []*Protocol{
		{
			Name:         "HTTP",
			Type:         "http",
			Port:         80,
			Encryption:   false,
			Compression:  true,
			Reliability:  "medium",
			Overhead:     5.0,
			MinBandwidth: 10,
			MaxLatency:   1000,
			BatteryImpact: "low",
			Enabled:      true,
			Priority:     5,
			Config: map[string]interface{}{
				"timeout":     30,
				"keep_alive":  true,
				"max_retries": 3,
			},
		},
		{
			Name:         "HTTPS",
			Type:         "https",
			Port:         443,
			Encryption:   true,
			Compression:  true,
			Reliability:  "high",
			Overhead:     8.0,
			MinBandwidth: 20,
			MaxLatency:   1500,
			BatteryImpact: "medium",
			Enabled:      true,
			Priority:     8,
			Config: map[string]interface{}{
				"timeout":     30,
				"keep_alive":  true,
				"max_retries": 3,
				"tls_version": "1.3",
			},
		},
		{
			Name:         "WebSocket",
			Type:         "websocket",
			Port:         80,
			Encryption:   false,
			Compression:  true,
			Reliability:  "high",
			Overhead:     3.0,
			MinBandwidth: 5,
			MaxLatency:   500,
			BatteryImpact: "medium",
			Enabled:      true,
			Priority:     7,
			Config: map[string]interface{}{
				"ping_interval": 30,
				"pong_timeout":  10,
				"compression":   true,
			},
		},
		{
			Name:         "MQTT",
			Type:         "mqtt",
			Port:         1883,
			Encryption:   false,
			Compression:  true,
			Reliability:  "high",
			Overhead:     2.0,
			MinBandwidth: 1,
			MaxLatency:   2000,
			BatteryImpact: "low",
			Enabled:      true,
			Priority:     9,
			Config: map[string]interface{}{
				"keep_alive":     60,
				"clean_session":  true,
				"qos":           1,
				"compression":   true,
			},
		},
		{
			Name:         "CoAP",
			Type:         "coap",
			Port:         5683,
			Encryption:   false,
			Compression:  true,
			Reliability:  "medium",
			Overhead:     1.0,
			MinBandwidth: 1,
			MaxLatency:   3000,
			BatteryImpact: "very_low",
			Enabled:      true,
			Priority:     6,
			Config: map[string]interface{}{
				"confirmable":   true,
				"max_retries":   4,
				"ack_timeout":   2,
				"compression":   true,
			},
		},
	}

	for _, protocol := range protocols {
		pa.protocols[protocol.Name] = protocol
	}
}

// initializeAdaptationRules sets up default adaptation rules
func (pa *ProtocolAdapter) initializeAdaptationRules() {
	rules := []*AdaptationRule{
		{
			ID:   "high_latency_fallback",
			Name: "Switch to MQTT on high latency",
			Conditions: []AdaptationCondition{
				{
					Parameter: "latency",
					Operator:  "gt",
					Value:     500,
					Duration:  30,
				},
			},
			Action: AdaptationAction{
				Type:     "switch_protocol",
				Protocol: "MQTT",
			},
			Priority: 8,
			Enabled:  true,
		},
		{
			ID:   "low_bandwidth_optimization",
			Name: "Enable compression on low bandwidth",
			Conditions: []AdaptationCondition{
				{
					Parameter: "bandwidth",
					Operator:  "lt",
					Value:     100,
					Duration:  10,
				},
			},
			Action: AdaptationAction{
				Type: "enable_compression",
				Parameters: map[string]interface{}{
					"algorithm": "gzip",
					"level":     6,
				},
			},
			Priority: 7,
			Enabled:  true,
		},
		{
			ID:   "high_packet_loss_reliable",
			Name: "Switch to reliable protocol on high packet loss",
			Conditions: []AdaptationCondition{
				{
					Parameter: "packet_loss",
					Operator:  "gt",
					Value:     5.0,
					Duration:  20,
				},
			},
			Action: AdaptationAction{
				Type:     "switch_protocol",
				Protocol: "HTTPS",
			},
			Priority: 9,
			Enabled:  true,
		},
		{
			ID:   "low_battery_efficient",
			Name: "Switch to efficient protocol on low battery",
			Conditions: []AdaptationCondition{
				{
					Parameter: "battery_level",
					Operator:  "lt",
					Value:     20,
					Duration:  5,
				},
			},
			Action: AdaptationAction{
				Type:     "switch_protocol",
				Protocol: "CoAP",
			},
			Priority: 6,
			Enabled:  true,
		},
	}

	pa.adaptationRules = rules
}

// SelectOptimalProtocol selects the best protocol based on current conditions
func (pa *ProtocolAdapter) SelectOptimalProtocol(conditions map[string]interface{}) *Protocol {
	pa.mu.RLock()
	defer pa.mu.RUnlock()

	// Check adaptation rules first
	for _, rule := range pa.adaptationRules {
		if !rule.Enabled {
			continue
		}

		if pa.evaluateRule(rule, conditions) {
			if protocol, exists := pa.protocols[rule.Action.Protocol]; exists && protocol.Enabled {
				log.Printf("Protocol adapted to %s due to rule: %s", protocol.Name, rule.Name)
				return protocol
			}
		}
	}

	// If no rule matches, select based on scoring
	return pa.selectBestProtocol(conditions)
}

// evaluateRule checks if a rule's conditions are met
func (pa *ProtocolAdapter) evaluateRule(rule *AdaptationRule, conditions map[string]interface{}) bool {
	for _, condition := range rule.Conditions {
		if !pa.evaluateCondition(condition, conditions) {
			return false
		}
	}
	return true
}

// evaluateCondition checks if a single condition is met
func (pa *ProtocolAdapter) evaluateCondition(condition AdaptationCondition, conditions map[string]interface{}) bool {
	value, exists := conditions[condition.Parameter]
	if !exists {
		return false
	}

	switch condition.Operator {
	case "gt":
		return pa.compareValues(value, condition.Value) > 0
	case "lt":
		return pa.compareValues(value, condition.Value) < 0
	case "eq":
		return pa.compareValues(value, condition.Value) == 0
	case "gte":
		return pa.compareValues(value, condition.Value) >= 0
	case "lte":
		return pa.compareValues(value, condition.Value) <= 0
	}

	return false
}

// compareValues compares two values
func (pa *ProtocolAdapter) compareValues(a, b interface{}) int {
	switch va := a.(type) {
	case int:
		if vb, ok := b.(int); ok {
			if va > vb {
				return 1
			} else if va < vb {
				return -1
			}
			return 0
		}
	case float64:
		if vb, ok := b.(float64); ok {
			if va > vb {
				return 1
			} else if va < vb {
				return -1
			}
			return 0
		}
	case string:
		if vb, ok := b.(string); ok {
			return strings.Compare(va, vb)
		}
	}
	return 0
}

// selectBestProtocol selects the best protocol based on scoring
func (pa *ProtocolAdapter) selectBestProtocol(conditions map[string]interface{}) *Protocol {
	var bestProtocol *Protocol
	bestScore := -1.0

	for _, protocol := range pa.protocols {
		if !protocol.Enabled {
			continue
		}

		score := pa.calculateProtocolScore(protocol, conditions)
		if score > bestScore {
			bestScore = score
			bestProtocol = protocol
		}
	}

	return bestProtocol
}

// calculateProtocolScore calculates a score for a protocol based on conditions
func (pa *ProtocolAdapter) calculateProtocolScore(protocol *Protocol, conditions map[string]interface{}) float64 {
	score := float64(protocol.Priority) * 10 // Base score from priority

	// Adjust score based on conditions
	if latency, ok := conditions["latency"].(int); ok {
		if latency > protocol.MaxLatency {
			score -= 50 // Heavy penalty for exceeding max latency
		} else {
			// Bonus for protocols that handle latency well
			latencyRatio := float64(latency) / float64(protocol.MaxLatency)
			score += (1.0 - latencyRatio) * 20
		}
	}

	if bandwidth, ok := conditions["bandwidth"].(int); ok {
		if bandwidth < protocol.MinBandwidth {
			score -= 30 // Penalty for insufficient bandwidth
		} else {
			// Bonus for efficient protocols on low bandwidth
			if bandwidth < 100 && protocol.Overhead < 5.0 {
				score += 15
			}
		}
	}

	if batteryLevel, ok := conditions["battery_level"].(float64); ok {
		if batteryLevel < 20 {
			// Prefer low battery impact protocols
			switch protocol.BatteryImpact {
			case "very_low":
				score += 25
			case "low":
				score += 15
			case "medium":
				score -= 5
			case "high":
				score -= 20
			}
		}
	}

	if packetLoss, ok := conditions["packet_loss"].(float64); ok {
		if packetLoss > 5.0 {
			// Prefer reliable protocols
			switch protocol.Reliability {
			case "high":
				score += 20
			case "medium":
				score += 5
			case "low":
				score -= 15
			}
		}
	}

	return score
}

// CreateAdaptiveHTTPClient creates an HTTP client optimized for current conditions
func (pa *ProtocolAdapter) CreateAdaptiveHTTPClient(conditions map[string]interface{}) *HTTPClient {
	timeout := 30 * time.Second
	retryCount := 3
	retryDelay := 1 * time.Second
	compressionType := "none"

	// Adjust parameters based on conditions
	if latency, ok := conditions["latency"].(int); ok {
		if latency > 500 {
			timeout = 60 * time.Second
			retryCount = 5
			retryDelay = 2 * time.Second
		}
	}

	if bandwidth, ok := conditions["bandwidth"].(int); ok {
		if bandwidth < 100 {
			compressionType = "gzip"
		}
	}

	// Create TLS config
	tlsConfig := &tls.Config{
		InsecureSkipVerify: false,
		MinVersion:         tls.VersionTLS12,
	}

	// Create transport
	transport := &http.Transport{
		TLSClientConfig:       tlsConfig,
		DisableCompression:    compressionType == "none",
		MaxIdleConns:          10,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	client := &http.Client{
		Transport: transport,
		Timeout:   timeout,
	}

	return &HTTPClient{
		client:          client,
		compressionType: compressionType,
		timeout:         timeout,
		retryCount:      retryCount,
		retryDelay:      retryDelay,
	}
}

// SendRequest sends an HTTP request with adaptive features
func (hc *HTTPClient) SendRequest(method, url string, body []byte, headers map[string]string) (*http.Response, error) {
	var bodyReader io.Reader

	// Apply compression if enabled
	if hc.compressionType == "gzip" && body != nil {
		var buf bytes.Buffer
		gzWriter := gzip.NewWriter(&buf)
		gzWriter.Write(body)
		gzWriter.Close()
		bodyReader = &buf
		if headers == nil {
			headers = make(map[string]string)
		}
		headers["Content-Encoding"] = "gzip"
	} else if body != nil {
		bodyReader = bytes.NewReader(body)
	}

	var lastErr error
	for attempt := 0; attempt <= hc.retryCount; attempt++ {
		req, err := http.NewRequest(method, url, bodyReader)
		if err != nil {
			return nil, err
		}

		// Set headers
		for key, value := range headers {
			req.Header.Set(key, value)
		}

		// Set compression headers
		if hc.compressionType != "none" {
			req.Header.Set("Accept-Encoding", hc.compressionType)
		}

		resp, err := hc.client.Do(req)
		if err == nil {
			return resp, nil
		}

		lastErr = err
		if attempt < hc.retryCount {
			time.Sleep(hc.retryDelay * time.Duration(attempt+1))
		}
	}

	return nil, fmt.Errorf("request failed after %d attempts: %v", hc.retryCount+1, lastErr)
}

// NewCompressionEngine creates a new compression engine
func NewCompressionEngine() *CompressionEngine {
	ce := &CompressionEngine{
		algorithms: make(map[string]CompressionAlgorithm),
	}

	// Initialize compression algorithms
	algorithms := []CompressionAlgorithm{
		{
			Name:             "gzip",
			CompressionRatio: 0.3, // 70% compression
			CPUCost:          5,
			MemoryCost:       4,
			Enabled:          true,
		},
		{
			Name:             "deflate",
			CompressionRatio: 0.35, // 65% compression
			CPUCost:          4,
			MemoryCost:       3,
			Enabled:          true,
		},
		{
			Name:             "lz4",
			CompressionRatio: 0.5, // 50% compression
			CPUCost:          2,
			MemoryCost:       2,
			Enabled:          true,
		},
	}

	for _, alg := range algorithms {
		ce.algorithms[alg.Name] = alg
	}

	return ce
}

// Compress compresses data using the specified algorithm
func (ce *CompressionEngine) Compress(data []byte, algorithm string) ([]byte, error) {
	ce.mu.Lock()
	defer ce.mu.Unlock()

	startTime := time.Now()
	
	alg, exists := ce.algorithms[algorithm]
	if !exists || !alg.Enabled {
		return data, fmt.Errorf("compression algorithm %s not available", algorithm)
	}

	var compressed []byte
	var err error

	switch algorithm {
	case "gzip":
		compressed, err = ce.compressGzip(data)
	case "deflate":
		compressed, err = ce.compressDeflate(data)
	case "lz4":
		compressed, err = ce.compressLZ4(data)
	default:
		return data, fmt.Errorf("unsupported compression algorithm: %s", algorithm)
	}

	if err != nil {
		return data, err
	}

	// Update statistics
	compressionTime := time.Since(startTime).Milliseconds()
	ce.stats.TotalBytesIn += int64(len(data))
	ce.stats.TotalBytesOut += int64(len(compressed))
	ce.stats.CompressionTime += compressionTime
	ce.stats.BandwidthSaved += int64(len(data) - len(compressed))
	
	if ce.stats.TotalBytesIn > 0 {
		ce.stats.CompressionRatio = float64(ce.stats.TotalBytesOut) / float64(ce.stats.TotalBytesIn)
	}

	return compressed, nil
}

// compressGzip compresses data using gzip
func (ce *CompressionEngine) compressGzip(data []byte) ([]byte, error) {
	var buf bytes.Buffer
	gzWriter := gzip.NewWriter(&buf)
	
	_, err := gzWriter.Write(data)
	if err != nil {
		return nil, err
	}
	
	err = gzWriter.Close()
	if err != nil {
		return nil, err
	}
	
	return buf.Bytes(), nil
}

// compressDeflate compresses data using deflate (placeholder)
func (ce *CompressionEngine) compressDeflate(data []byte) ([]byte, error) {
	// For simplicity, use gzip compression
	// In a real implementation, use flate package
	return ce.compressGzip(data)
}

// compressLZ4 compresses data using LZ4 (placeholder)
func (ce *CompressionEngine) compressLZ4(data []byte) ([]byte, error) {
	// For simplicity, use gzip compression
	// In a real implementation, use LZ4 library
	return ce.compressGzip(data)
}

// Decompress decompresses data using the specified algorithm
func (ce *CompressionEngine) Decompress(data []byte, algorithm string) ([]byte, error) {
	ce.mu.Lock()
	defer ce.mu.Unlock()

	startTime := time.Now()
	
	alg, exists := ce.algorithms[algorithm]
	if !exists || !alg.Enabled {
		return data, fmt.Errorf("compression algorithm %s not available", algorithm)
	}

	var decompressed []byte
	var err error

	switch algorithm {
	case "gzip":
		decompressed, err = ce.decompressGzip(data)
	case "deflate":
		decompressed, err = ce.decompressDeflate(data)
	case "lz4":
		decompressed, err = ce.decompressLZ4(data)
	default:
		return data, fmt.Errorf("unsupported compression algorithm: %s", algorithm)
	}

	if err != nil {
		return data, err
	}

	// Update statistics
	decompressionTime := time.Since(startTime).Milliseconds()
	ce.stats.DecompressionTime += decompressionTime

	return decompressed, nil
}

// decompressGzip decompresses gzip data
func (ce *CompressionEngine) decompressGzip(data []byte) ([]byte, error) {
	reader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	return io.ReadAll(reader)
}

// decompressDeflate decompresses deflate data (placeholder)
func (ce *CompressionEngine) decompressDeflate(data []byte) ([]byte, error) {
	// For simplicity, use gzip decompression
	return ce.decompressGzip(data)
}

// decompressLZ4 decompresses LZ4 data (placeholder)
func (ce *CompressionEngine) decompressLZ4(data []byte) ([]byte, error) {
	// For simplicity, use gzip decompression
	return ce.decompressGzip(data)
}

// GetCompressionStats returns compression statistics
func (ce *CompressionEngine) GetCompressionStats() CompressionStats {
	ce.mu.RLock()
	defer ce.mu.RUnlock()
	return ce.stats
}

// NewEncryptionEngine creates a new encryption engine
func NewEncryptionEngine() *EncryptionEngine {
	ee := &EncryptionEngine{
		algorithms: make(map[string]EncryptionAlgorithm),
	}

	// Initialize encryption algorithms
	algorithms := []EncryptionAlgorithm{
		{
			Name:     "AES-256",
			KeySize:  256,
			CPUCost:  6,
			Security: 10,
			Enabled:  true,
		},
		{
			Name:     "AES-128",
			KeySize:  128,
			CPUCost:  4,
			Security: 8,
			Enabled:  true,
		},
		{
			Name:     "ChaCha20",
			KeySize:  256,
			CPUCost:  3,
			Security: 9,
			Enabled:  true,
		},
	}

	for _, alg := range algorithms {
		ee.algorithms[alg.Name] = alg
	}

	return ee
}

// SelectEncryptionAlgorithm selects the best encryption algorithm based on conditions
func (ee *EncryptionEngine) SelectEncryptionAlgorithm(conditions map[string]interface{}) string {
	ee.mu.RLock()
	defer ee.mu.RUnlock()

	// Default to AES-256
	bestAlgorithm := "AES-256"
	
	// If low battery or low CPU, prefer ChaCha20
	if batteryLevel, ok := conditions["battery_level"].(float64); ok {
		if batteryLevel < 20 {
			bestAlgorithm = "ChaCha20"
		}
	}

	// If very low bandwidth, prefer AES-128
	if bandwidth, ok := conditions["bandwidth"].(int); ok {
		if bandwidth < 50 {
			bestAlgorithm = "AES-128"
		}
	}

	return bestAlgorithm
}

// AdaptProtocols continuously adapts protocols based on network conditions
func (pa *ProtocolAdapter) AdaptProtocols() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-pa.cm.ctx.Done():
			return
		case <-ticker.C:
			pa.performProtocolAdaptation()
		}
	}
}

// performProtocolAdaptation performs protocol adaptation based on current conditions
func (pa *ProtocolAdapter) performProtocolAdaptation() {
	// Get current network conditions
	conditions := pa.getCurrentConditions()

	// Select optimal protocol
	optimalProtocol := pa.SelectOptimalProtocol(conditions)
	if optimalProtocol != nil {
		log.Printf("Optimal protocol selected: %s", optimalProtocol.Name)
	}

	// Apply compression if needed
	if pa.shouldEnableCompression(conditions) {
		log.Println("Enabling compression due to network conditions")
	}
}

// getCurrentConditions gets current network conditions
func (pa *ProtocolAdapter) getCurrentConditions() map[string]interface{} {
	conditions := make(map[string]interface{})

	pa.cm.mu.RLock()
	defer pa.cm.mu.RUnlock()

	// Get conditions from active interfaces
	for _, iface := range pa.cm.interfaces {
		if iface.Status == "up" {
			conditions["latency"] = iface.Latency
			conditions["jitter"] = iface.Jitter
			conditions["packet_loss"] = iface.PacketLoss
			conditions["bandwidth"] = iface.Speed * 1000 // Convert to Kbps
			break // Use first active interface
		}
	}

	// Add battery level (simulated)
	conditions["battery_level"] = 75.0 // Would get from power management system

	return conditions
}

// shouldEnableCompression determines if compression should be enabled
func (pa *ProtocolAdapter) shouldEnableCompression(conditions map[string]interface{}) bool {
	if bandwidth, ok := conditions["bandwidth"].(int); ok {
		return bandwidth < 500 // Enable compression if bandwidth < 500 Kbps
	}
	return false
}

