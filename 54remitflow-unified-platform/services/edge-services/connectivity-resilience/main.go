package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	_ "github.com/mattn/go-psycopg2"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
)

// Intelligent Connectivity Management System for Edge Banking Devices
// Handles unstable network conditions, multi-network failover, bandwidth optimization,
// adaptive protocols, and intelligent routing for challenging African infrastructure.

// NetworkInterface represents a network interface
type NetworkInterface struct {
	ID              string    `json:"id" db:"id"`
	Name            string    `json:"name" db:"name"`
	Type            string    `json:"type" db:"type"` // ethernet, wifi, cellular, satellite, mesh
	Status          string    `json:"status" db:"status"` // up, down, connecting, disconnecting, standby
	Priority        int       `json:"priority" db:"priority"` // 1-10, lower is preferred
	IPAddress       string    `json:"ip_address" db:"ip_address"`
	MACAddress      string    `json:"mac_address" db:"mac_address"`
	Gateway         string    `json:"gateway" db:"gateway"`
	DNS             []string  `json:"dns" db:"dns"`
	Speed           int       `json:"speed" db:"speed"` // Mbps
	SignalStrength  int       `json:"signal_strength" db:"signal_strength"` // dBm for WiFi/Cellular
	Latency         int       `json:"latency" db:"latency"` // ms
	Jitter          int       `json:"jitter" db:"jitter"` // ms
	PacketLoss      float64   `json:"packet_loss" db:"packet_loss"` // %
	QualityScore    float64   `json:"quality_score" db:"quality_score"` // 0-100
	DataUsage       int64     `json:"data_usage" db:"data_usage"` // bytes
	DataLimit       int64     `json:"data_limit" db:"data_limit"` // bytes
	CostPerMB       float64   `json:"cost_per_mb" db:"cost_per_mb"`
	Enabled         bool      `json:"enabled" db:"enabled"`
	LastCheck       time.Time `json:"last_check" db:"last_check"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time `json:"updated_at" db:"updated_at"`
}

// ConnectivityEvent represents connectivity-related events
type ConnectivityEvent struct {
	ID          string                 `json:"id" db:"id"`
	Type        string                 `json:"type" db:"type"` // connection_lost, connection_restored, high_latency, etc.
	Severity    string                 `json:"severity" db:"severity"` // critical, warning, info
	InterfaceID string                 `json:"interface_id" db:"interface_id"`
	Description string                 `json:"description" db:"description"`
	Metadata    map[string]interface{} `json:"metadata" db:"metadata"`
	Actions     []string               `json:"actions" db:"actions"`
	Resolved    bool                   `json:"resolved" db:"resolved"`
	ResolvedAt  *time.Time             `json:"resolved_at" db:"resolved_at"`
	CreatedAt   time.Time              `json:"created_at" db:"created_at"`
}

// ConnectivityProfile represents connectivity settings for different scenarios
type ConnectivityProfile struct {
	ID              string   `json:"id" db:"id"`
	Name            string   `json:"name" db:"name"`
	Mode            string   `json:"mode" db:"mode"` // normal, low_bandwidth, offline, emergency
	Primary         string   `json:"primary" db:"primary"` // Interface type
	Secondary       string   `json:"secondary" db:"secondary"`
	Tertiary        string   `json:"tertiary" db:"tertiary"`
	FailoverPolicy  string   `json:"failover_policy" db:"failover_policy"` // priority, quality, cost
	LoadBalancing   bool     `json:"load_balancing" db:"load_balancing"`
	BandwidthLimit  int      `json:"bandwidth_limit" db:"bandwidth_limit"` // Mbps
	Compression     bool     `json:"compression" db:"compression"`
	AdaptiveProto   bool     `json:"adaptive_protocol" db:"adaptive_protocol"`
	ServicesPaused  []string `json:"services_paused" db:"services_paused"`
	Active          bool     `json:"active" db:"active"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time `json:"updated_at" db:"updated_at"`
}

// ConnectivityManager manages all connectivity-related operations
type ConnectivityManager struct {
	db                *sql.DB
	config            *ConnectivityConfig
	metrics           *ConnectivityMetrics
	mu                sync.RWMutex
	ctx               context.Context
	cancel            context.CancelFunc
	shutdownChan      chan os.Signal
	interfaces        map[string]*NetworkInterface
	currentProfile    *ConnectivityProfile
	profiles          map[string]*ConnectivityProfile
	eventHandlers     map[string][]ConnectivityEventHandler
	qualityMonitor    *QualityMonitor
	router            *IntelligentRouter
	protocolAdapter   *ProtocolAdapter
	compressionEngine *CompressionEngine
	firewall          *Firewall
}

// ConnectivityConfig holds configuration for connectivity management
type ConnectivityConfig struct {
	MonitorInterval      time.Duration `json:"monitor_interval"`
	PingTimeout          time.Duration `json:"ping_timeout"`
	PingCount            int           `json:"ping_count"`
	PingTarget           string        `json:"ping_target"`
	HighLatencyThreshold int           `json:"high_latency_threshold"`
	HighJitterThreshold  int           `json:"high_jitter_threshold"`
	HighPacketLossThreshold float64    `json:"high_packet_loss_threshold"`
	AutoFailover         bool          `json:"auto_failover"`
	AutoReconnect        bool          `json:"auto_reconnect"`
	DatabasePath         string        `json:"database_path"`
}

// ConnectivityMetrics provides Prometheus metrics for connectivity management
type ConnectivityMetrics struct {
	Latency         *prometheus.GaugeVec
	Jitter          *prometheus.GaugeVec
	PacketLoss      *prometheus.GaugeVec
	QualityScore    *prometheus.GaugeVec
	DataUsage       *prometheus.CounterVec
	ConnectionStatus *prometheus.GaugeVec
	FailoverEvents  *prometheus.CounterVec
	ReconnectEvents *prometheus.CounterVec
	BandwidthUsage  *prometheus.GaugeVec
}

// ConnectivityEventHandler defines the interface for connectivity event handlers
type ConnectivityEventHandler func(*ConnectivityEvent) error

// QualityMonitor assesses the quality of network connections
type QualityMonitor struct {
	cm *ConnectivityManager
}

// IntelligentRouter manages routing decisions based on connection quality and cost
type IntelligentRouter struct {
	cm *ConnectivityManager
}

// ProtocolAdapter adapts communication protocols based on network conditions
type ProtocolAdapter struct {
	cm *ConnectivityManager
}

// CompressionEngine manages data compression to optimize bandwidth usage
type CompressionEngine struct {
	cm *ConnectivityManager
}

// Firewall manages network security and access control
type Firewall struct {
	cm *ConnectivityManager
}

func NewConnectivityConfig() *ConnectivityConfig {
	return &ConnectivityConfig{
		MonitorInterval:      15 * time.Second,
		PingTimeout:          2 * time.Second,
		PingCount:            5,
		PingTarget:           "8.8.8.8",
		HighLatencyThreshold: 200, // ms
		HighJitterThreshold:  50,  // ms
		HighPacketLossThreshold: 5.0, // %
		AutoFailover:         true,
		AutoReconnect:        true,
		DatabasePath:         "./connectivity_management.db",
	}
}

func NewConnectivityMetrics() *ConnectivityMetrics {
	return &ConnectivityMetrics{
		Latency: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "connectivity_latency_ms",
			Help: "Network latency in milliseconds",
		}, []string{"interface"}),
		Jitter: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "connectivity_jitter_ms",
			Help: "Network jitter in milliseconds",
		}, []string{"interface"}),
		PacketLoss: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "connectivity_packet_loss_percent",
			Help: "Network packet loss percentage",
		}, []string{"interface"}),
		QualityScore: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "connectivity_quality_score",
			Help: "Network quality score (0-100)",
		}, []string{"interface"}),
		DataUsage: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "connectivity_data_usage_bytes_total",
			Help: "Total data usage in bytes",
		}, []string{"interface"}),
		ConnectionStatus: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "connectivity_connection_status",
			Help: "Connection status (1=up, 0=down)",
		}, []string{"interface"}),
		FailoverEvents: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "connectivity_failover_events_total",
			Help: "Total number of failover events",
		}, []string{"interface"}),
		ReconnectEvents: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "connectivity_reconnect_events_total",
			Help: "Total number of reconnect events",
		}, []string{"interface"}),
		BandwidthUsage: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "connectivity_bandwidth_usage_mbps",
			Help: "Current bandwidth usage in Mbps",
		}, []string{"interface"}),
	}
}

func NewConnectivityManager(config *ConnectivityConfig) (*ConnectivityManager, error) {
	ctx, cancel := context.WithCancel(context.Background())

	cm := &ConnectivityManager{
		config:            config,
		metrics:           NewConnectivityMetrics(),
		ctx:               ctx,
		cancel:            cancel,
		shutdownChan:      make(chan os.Signal, 1),
		interfaces:        make(map[string]*NetworkInterface),
		profiles:          make(map[string]*ConnectivityProfile),
		eventHandlers:     make(map[string][]ConnectivityEventHandler),
	}

	cm.qualityMonitor = &QualityMonitor{cm: cm}
	cm.router = &IntelligentRouter{cm: cm}
	cm.protocolAdapter = &ProtocolAdapter{cm: cm}
	cm.compressionEngine = &CompressionEngine{cm: cm}
	cm.firewall = &Firewall{cm: cm}

	// Initialize database
	if err := cm.initDatabase(); err != nil {
		return nil, fmt.Errorf("failed to initialize database: %v", err)
	}

	// Register Prometheus metrics
	prometheus.MustRegister(
		cm.metrics.Latency,
		cm.metrics.Jitter,
		cm.metrics.PacketLoss,
		cm.metrics.QualityScore,
		cm.metrics.DataUsage,
		cm.metrics.ConnectionStatus,
		cm.metrics.FailoverEvents,
		cm.metrics.ReconnectEvents,
		cm.metrics.BandwidthUsage,
	)

	// Initialize default connectivity profiles
	cm.initDefaultProfiles()

	// Register default event handlers
	cm.registerDefaultEventHandlers()

	// Start background services
	go cm.monitorConnectivity()

	// Handle graceful shutdown
	signal.Notify(cm.shutdownChan, syscall.SIGINT, syscall.SIGTERM)
	go cm.handleShutdown()

	return cm, nil
}

func (cm *ConnectivityManager) initDatabase() error {
	var err error
	cm.db, err = sql.Open("psycopg2", cm.config.DatabasePath+"?_journal_mode=WAL&_synchronous=FULL&_foreign_keys=ON")
	if err != nil {
		return err
	}

	schema := `
	CREATE TABLE IF NOT EXISTS network_interfaces (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'down',
		priority INTEGER NOT NULL DEFAULT 5,
		ip_address TEXT,
		mac_address TEXT,
		gateway TEXT,
		dns TEXT,
		speed INTEGER NOT NULL DEFAULT 0,
		signal_strength INTEGER NOT NULL DEFAULT 0,
		latency INTEGER NOT NULL DEFAULT 0,
		jitter INTEGER NOT NULL DEFAULT 0,
		packet_loss REAL NOT NULL DEFAULT 0,
		quality_score REAL NOT NULL DEFAULT 0,
		data_usage INTEGER NOT NULL DEFAULT 0,
		data_limit INTEGER NOT NULL DEFAULT 0,
		cost_per_mb REAL NOT NULL DEFAULT 0,
		enabled BOOLEAN NOT NULL DEFAULT TRUE,
		last_check DATETIME,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS connectivity_events (
		id TEXT PRIMARY KEY,
		type TEXT NOT NULL,
		severity TEXT NOT NULL,
		interface_id TEXT NOT NULL,
		description TEXT NOT NULL,
		metadata TEXT,
		actions TEXT,
		resolved BOOLEAN NOT NULL DEFAULT FALSE,
		resolved_at DATETIME,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS connectivity_profiles (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		mode TEXT NOT NULL,
		primary_iface TEXT NOT NULL,
		secondary_iface TEXT,
		tertiary_iface TEXT,
		failover_policy TEXT NOT NULL DEFAULT 'priority',
		load_balancing BOOLEAN NOT NULL DEFAULT FALSE,
		bandwidth_limit INTEGER NOT NULL DEFAULT 0,
		compression BOOLEAN NOT NULL DEFAULT FALSE,
		adaptive_protocol BOOLEAN NOT NULL DEFAULT FALSE,
		services_paused TEXT,
		active BOOLEAN NOT NULL DEFAULT FALSE,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	-- Indexes for performance
	CREATE INDEX IF NOT EXISTS idx_network_interfaces_type ON network_interfaces(type);
	CREATE INDEX IF NOT EXISTS idx_network_interfaces_status ON network_interfaces(status);
	CREATE INDEX IF NOT EXISTS idx_connectivity_events_type ON connectivity_events(type);
	CREATE INDEX IF NOT EXISTS idx_connectivity_events_severity ON connectivity_events(severity);

	-- Triggers for updated_at
	CREATE TRIGGER IF NOT EXISTS update_network_interfaces_timestamp 
		AFTER UPDATE ON network_interfaces
		BEGIN
			UPDATE network_interfaces SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
		END;

	CREATE TRIGGER IF NOT EXISTS update_connectivity_profiles_timestamp 
		AFTER UPDATE ON connectivity_profiles
		BEGIN
			UPDATE connectivity_profiles SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
		END;
	`

	_, err = cm.db.Exec(schema)
	return err
}

func (cm *ConnectivityManager) initDefaultProfiles() {
	profiles := []*ConnectivityProfile{
		{
			ID:             "normal",
			Name:           "Normal Operation",
			Mode:           "normal",
			Primary:        "ethernet",
			Secondary:      "wifi",
			Tertiary:       "cellular",
			FailoverPolicy: "priority",
			LoadBalancing:  false,
			BandwidthLimit: 0, // Unlimited
			Compression:    false,
			AdaptiveProto:  true,
			Active:         true,
		},
		{
			ID:             "low_bandwidth",
			Name:           "Low Bandwidth Mode",
			Mode:           "low_bandwidth",
			Primary:        "cellular",
			Secondary:      "satellite",
			FailoverPolicy: "quality",
			LoadBalancing:  false,
			BandwidthLimit: 1, // 1 Mbps
			Compression:    true,
			AdaptiveProto:  true,
			ServicesPaused: []string{"analytics", "reporting"},
			Active:         false,
		},
		{
			ID:             "offline",
			Name:           "Offline Mode",
			Mode:           "offline",
			Primary:        "none",
			FailoverPolicy: "none",
			LoadBalancing:  false,
			BandwidthLimit: 0,
			Compression:    false,
			AdaptiveProto:  false,
			ServicesPaused: []string{"all"},
			Active:         false,
		},
	}

	for _, profile := range profiles {
		cm.profiles[profile.ID] = profile
		cm.saveProfile(profile)
	}

	cm.currentProfile = profiles[0] // Start with normal mode
}

func (cm *ConnectivityManager) saveProfile(profile *ConnectivityProfile) error {
	servicesPausedJSON, _ := json.Marshal(profile.ServicesPaused)
	
	_, err := cm.db.Exec(`
		INSERT OR REPLACE INTO connectivity_profiles (id, name, mode, primary_iface, secondary_iface, tertiary_iface, failover_policy, load_balancing, bandwidth_limit, compression, adaptive_protocol, services_paused, active)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, profile.ID, profile.Name, profile.Mode, profile.Primary, profile.Secondary, profile.Tertiary, profile.FailoverPolicy, profile.LoadBalancing, profile.BandwidthLimit, profile.Compression, profile.AdaptiveProto, string(servicesPausedJSON), profile.Active)
	
	return err
}

func (cm *ConnectivityManager) registerDefaultEventHandlers() {
	// Connection lost event handler
	cm.RegisterEventHandler("connection_lost", func(event *ConnectivityEvent) error {
		log.Printf("Connection lost event: %s", event.Description)
		return cm.handleConnectionLoss(event.InterfaceID)
	})

	// Connection restored event handler
	cm.RegisterEventHandler("connection_restored", func(event *ConnectivityEvent) error {
		log.Printf("Connection restored event: %s", event.Description)
		return cm.handleConnectionRestored(event.InterfaceID)
	})

	// High latency event handler
	cm.RegisterEventHandler("high_latency", func(event *ConnectivityEvent) error {
		log.Printf("High latency event: %s", event.Description)
		return cm.handleHighLatency(event.InterfaceID)
	})

	// High packet loss event handler
	cm.RegisterEventHandler("high_packet_loss", func(event *ConnectivityEvent) error {
		log.Printf("High packet loss event: %s", event.Description)
		return cm.handleHighPacketLoss(event.InterfaceID)
	})
}

// RegisterEventHandler registers a handler for a specific event type
func (cm *ConnectivityManager) RegisterEventHandler(eventType string, handler ConnectivityEventHandler) {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	
	if handlers, exists := cm.eventHandlers[eventType]; exists {
		cm.eventHandlers[eventType] = append(handlers, handler)
	} else {
		cm.eventHandlers[eventType] = []ConnectivityEventHandler{handler}
	}
}

// CreateConnectivityEvent creates and processes a connectivity event
func (cm *ConnectivityManager) CreateConnectivityEvent(eventType, severity, interfaceID, description string, metadata map[string]interface{}) error {
	event := &ConnectivityEvent{
		ID:          uuid.New().String(),
		Type:        eventType,
		Severity:    severity,
		InterfaceID: interfaceID,
		Description: description,
		Metadata:    metadata,
		Actions:     []string{},
		Resolved:    false,
		CreatedAt:   time.Now(),
	}

	// Save to database
	metadataJSON, _ := json.Marshal(metadata)
	_, err := cm.db.Exec(`
		INSERT INTO connectivity_events (id, type, severity, interface_id, description, metadata, resolved, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, event.ID, event.Type, event.Severity, event.InterfaceID, event.Description,
		string(metadataJSON), event.Resolved, event.CreatedAt)
	if err != nil {
		return err
	}

	// Update metrics
	switch eventType {
	case "connection_lost":
		cm.metrics.FailoverEvents.WithLabelValues(interfaceID).Inc()
	case "connection_restored":
		cm.metrics.ReconnectEvents.WithLabelValues(interfaceID).Inc()
	}

	// Process event handlers
	cm.mu.RLock()
	handlers, exists := cm.eventHandlers[eventType]
	cm.mu.RUnlock()

	if exists {
		for _, handler := range handlers {
			if err := handler(event); err != nil {
				log.Printf("Event handler error for %s: %v", eventType, err)
				event.Actions = append(event.Actions, fmt.Sprintf("Handler error: %v", err))
			} else {
				event.Actions = append(event.Actions, "Handler executed successfully")
			}
		}
	}

	// Update event with actions
	actionsJSON, _ := json.Marshal(event.Actions)
	_, err = cm.db.Exec(`
		UPDATE connectivity_events SET actions = ? WHERE id = ?
	`, string(actionsJSON), event.ID)

	return err
}

// monitorConnectivity continuously monitors network interfaces and quality
func (cm *ConnectivityManager) monitorConnectivity() {
	ticker := time.NewTicker(cm.config.MonitorInterval)
	defer ticker.Stop()

	for {
		select {
		case <-cm.ctx.Done():
			return
		case <-ticker.C:
			cm.performConnectivityMonitoring()
		}
	}
}

func (cm *ConnectivityManager) performConnectivityMonitoring() {
	// Discover and update network interfaces
	cm.discoverInterfaces()

	// Monitor all enabled interfaces
	for _, iface := range cm.interfaces {
		if iface.Enabled {
			go cm.monitorInterface(iface)
		}
	}

	// Perform intelligent routing
	cm.router.updateRoutes()
}

func (cm *ConnectivityManager) discoverInterfaces() {
	interfaces, err := net.Interfaces()
	if err != nil {
		log.Printf("Failed to discover network interfaces: %v", err)
		return
	}

	cm.mu.Lock()
	defer cm.mu.Unlock()

	for _, i := range interfaces {
		if _, exists := cm.interfaces[i.Name]; !exists {
			// New interface found
			newIface := &NetworkInterface{
				ID:         uuid.New().String(),
				Name:       i.Name,
				Type:       cm.getInterfaceType(i.Name),
				Status:     "down",
				Priority:   5,
				MACAddress: i.HardwareAddr.String(),
				Enabled:    true,
				CreatedAt:  time.Now(),
				UpdatedAt:  time.Now(),
			}
			cm.interfaces[i.Name] = newIface
			cm.saveInterface(newIface)
		}
	}
}

func (cm *ConnectivityManager) getInterfaceType(name string) string {
	if strings.HasPrefix(name, "eth") {
		return "ethernet"
	} else if strings.HasPrefix(name, "wlan") {
		return "wifi"
	} else if strings.HasPrefix(name, "wwan") || strings.HasPrefix(name, "ppp") {
		return "cellular"
	} else if strings.HasPrefix(name, "sat") {
		return "satellite"
	} else if strings.HasPrefix(name, "mesh") {
		return "mesh"
	}
	return "unknown"
}

func (cm *ConnectivityManager) saveInterface(iface *NetworkInterface) error {
	dnsJSON, _ := json.Marshal(iface.DNS)
	
	_, err := cm.db.Exec(`
		INSERT OR REPLACE INTO network_interfaces (id, name, type, status, priority, ip_address, mac_address, gateway, dns, speed, signal_strength, latency, jitter, packet_loss, quality_score, data_usage, data_limit, cost_per_mb, enabled, last_check)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, iface.ID, iface.Name, iface.Type, iface.Status, iface.Priority, iface.IPAddress, iface.MACAddress, iface.Gateway, string(dnsJSON), iface.Speed, iface.SignalStrength, iface.Latency, iface.Jitter, iface.PacketLoss, iface.QualityScore, iface.DataUsage, iface.DataLimit, iface.CostPerMB, iface.Enabled, iface.LastCheck)
	
	return err
}

func (cm *ConnectivityManager) monitorInterface(iface *NetworkInterface) {
	// Perform quality checks
	latency, jitter, packetLoss := cm.qualityMonitor.ping(iface.Name)

	cm.mu.Lock()
	defer cm.mu.Unlock()

	iface.Latency = latency
	iface.Jitter = jitter
	iface.PacketLoss = packetLoss
	iface.LastCheck = time.Now()

	// Update status
	if packetLoss == 100 {
		iface.Status = "down"
		cm.CreateConnectivityEvent("connection_lost", "critical", iface.ID, "Connection lost", nil)
	} else {
		iface.Status = "up"
		cm.CreateConnectivityEvent("connection_restored", "info", iface.ID, "Connection restored", nil)
	}

	// Calculate quality score
	iface.QualityScore = cm.qualityMonitor.calculateQualityScore(iface)

	// Update metrics
	cm.metrics.Latency.WithLabelValues(iface.Name).Set(float64(latency))
	cm.metrics.Jitter.WithLabelValues(iface.Name).Set(float64(jitter))
	cm.metrics.PacketLoss.WithLabelValues(iface.Name).Set(packetLoss)
	cm.metrics.QualityScore.WithLabelValues(iface.Name).Set(iface.QualityScore)
	if iface.Status == "up" {
		cm.metrics.ConnectionStatus.WithLabelValues(iface.Name).Set(1)
	} else {
		cm.metrics.ConnectionStatus.WithLabelValues(iface.Name).Set(0)
	}

	// Check for quality issues
	cm.checkQualityIssues(iface)

	// Save updated interface data
	cm.saveInterface(iface)
}

func (qm *QualityMonitor) ping(ifaceName string) (int, int, float64) {
	// Use system ping command for simplicity
	// In a real implementation, use a Go-native ICMP library
	
	cmd := exec.Command("ping", "-c", strconv.Itoa(qm.cm.config.PingCount), "-W", strconv.Itoa(int(qm.cm.config.PingTimeout.Seconds())), "-I", ifaceName, qm.cm.config.PingTarget)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return 9999, 9999, 100.0 // Assume 100% packet loss on error
	}

	// Parse ping output
	lines := strings.Split(string(output), "\n")
	var rtts []float64
	var packetLoss float64 = 100.0

	for _, line := range lines {
		if strings.Contains(line, "time=") {
			parts := strings.Split(line, "time=")
			if len(parts) > 1 {
				timeStr := strings.Split(parts[1], " ")[0]
				if t, err := strconv.ParseFloat(timeStr, 64); err == nil {
					rtts = append(rtts, t)
				}
			}
		} else if strings.Contains(line, "packet loss") {
			parts := strings.Split(line, ",")
			for _, part := range parts {
				if strings.Contains(part, "packet loss") {
					lossStr := strings.TrimSpace(strings.Split(part, "% packet loss")[0])
					if loss, err := strconv.ParseFloat(lossStr, 64); err == nil {
						packetLoss = loss
					}
				}
			}
		}
	}

	if len(rtts) == 0 {
		return 9999, 9999, packetLoss
	}

	// Calculate latency and jitter
	var sum, sumSq float64
	for _, rtt := range rtts {
		sum += rtt
		sumSq += rtt * rtt
	}
	avg := sum / float64(len(rtts))
	variance := sumSq/float64(len(rtts)) - avg*avg
	jitter := int(math.Sqrt(variance))

	return int(avg), jitter, packetLoss
}

func (qm *QualityMonitor) calculateQualityScore(iface *NetworkInterface) float64 {
	// Simple quality score calculation (0-100)
	latencyScore := math.Max(0, 100 - float64(iface.Latency)/5.0) // 100 at 0ms, 0 at 500ms
	jitterScore := math.Max(0, 100 - float64(iface.Jitter)/2.0) // 100 at 0ms, 0 at 200ms
	packetLossScore := math.Max(0, 100 - iface.PacketLoss*10) // 100 at 0%, 0 at 10%

	// Weighted average
	score := (latencyScore*0.4 + jitterScore*0.3 + packetLossScore*0.3)
	return math.Max(0, math.Min(100, score))
}

func (cm *ConnectivityManager) checkQualityIssues(iface *NetworkInterface) {
	if iface.Latency > cm.config.HighLatencyThreshold {
		cm.CreateConnectivityEvent("high_latency", "warning", iface.ID, "High latency detected", map[string]interface{}{"latency": iface.Latency})
	}
	if iface.Jitter > cm.config.HighJitterThreshold {
		cm.CreateConnectivityEvent("high_jitter", "warning", iface.ID, "High jitter detected", map[string]interface{}{"jitter": iface.Jitter})
	}
	if iface.PacketLoss > cm.config.HighPacketLossThreshold {
		cm.CreateConnectivityEvent("high_packet_loss", "warning", iface.ID, "High packet loss detected", map[string]interface{}{"packet_loss": iface.PacketLoss})
	}
}

func (cm *ConnectivityManager) handleConnectionLoss(interfaceID string) error {
	log.Printf("Handling connection loss for interface %s", interfaceID)
	
	if cm.config.AutoFailover {
		return cm.router.failover(interfaceID)
	}
	return nil
}

func (cm *ConnectivityManager) handleConnectionRestored(interfaceID string) error {
	log.Printf("Handling connection restored for interface %s", interfaceID)
	
	if cm.config.AutoFailover {
		return cm.router.failback(interfaceID)
	}
	return nil
}

func (cm *ConnectivityManager) handleHighLatency(interfaceID string) error {
	log.Printf("Handling high latency for interface %s", interfaceID)
	
	// Consider failing over if latency is consistently high
	// For now, just log the event
	return nil
}

func (cm *ConnectivityManager) handleHighPacketLoss(interfaceID string) error {
	log.Printf("Handling high packet loss for interface %s", interfaceID)
	
	if cm.config.AutoFailover {
		return cm.router.failover(interfaceID)
	}
	return nil
}

func (ir *IntelligentRouter) updateRoutes() {
	// Get all active interfaces
	ir.cm.mu.RLock()
	activeInterfaces := []*NetworkInterface{}
	for _, iface := range ir.cm.interfaces {
		if iface.Status == "up" && iface.Enabled {
			activeInterfaces = append(activeInterfaces, iface)
		}
	}
	ir.cm.mu.RUnlock()

	if len(activeInterfaces) == 0 {
		log.Println("No active network interfaces found")
		return
	}

	// Select best interface based on current profile
	bestIface := ir.selectBestInterface(activeInterfaces)
	if bestIface == nil {
		log.Println("Could not select a best interface")
		return
	}

	// Set as default route
	ir.setDefaultRoute(bestIface)
}

func (ir *IntelligentRouter) selectBestInterface(interfaces []*NetworkInterface) *NetworkInterface {
	if len(interfaces) == 0 {
		return nil
	}

	var bestIface *NetworkInterface
	bestScore := -1.0

	for _, iface := range interfaces {
		score := ir.calculateInterfaceScore(iface)
		if score > bestScore {
			bestScore = score
			bestIface = iface
		}
	}

	return bestIface
}

func (ir *IntelligentRouter) calculateInterfaceScore(iface *NetworkInterface) float64 {
	// Calculate score based on quality, priority, and cost
	qualityWeight := 0.6
	priorityWeight := 0.3
	costWeight := 0.1

	// Normalize priority (lower is better)
	priorityScore := 100 - float64(iface.Priority-1)*10

	// Normalize cost (lower is better)
	costScore := 100 - iface.CostPerMB*10

	score := iface.QualityScore*qualityWeight + priorityScore*priorityWeight + costScore*costWeight
	return score
}

func (ir *IntelligentRouter) setDefaultRoute(iface *NetworkInterface) {
	log.Printf("Setting default route to interface %s (%s)", iface.Name, iface.IPAddress)
	
	// Delete existing default route
	cmd := exec.Command("ip", "route", "del", "default")
	cmd.Run() // Ignore error if no default route exists

	// Add new default route
	cmd = exec.Command("ip", "route", "add", "default", "via", iface.Gateway, "dev", iface.Name)
	if err := cmd.Run(); err != nil {
		log.Printf("Failed to set default route: %v", err)
	}
}

func (ir *IntelligentRouter) failover(failedInterfaceID string) error {
	log.Printf("Performing failover for interface %s", failedInterfaceID)
	
	// Update routes to select a new best interface
	ir.updateRoutes()
	
	return nil
}

func (ir *IntelligentRouter) failback(restoredInterfaceID string) error {
	log.Printf("Performing failback for interface %s", restoredInterfaceID)
	
	// Update routes to potentially switch back to the restored interface
	ir.updateRoutes()
	
	return nil
}

// handleShutdown handles graceful shutdown
func (cm *ConnectivityManager) handleShutdown() {
	<-cm.shutdownChan
	log.Println("Connectivity manager shutdown signal received")

	// Cancel context to stop all goroutines
	cm.cancel()

	// Close database
	if cm.db != nil {
		cm.db.Close()
	}

	log.Println("Connectivity manager shutdown completed")
	os.Exit(0)
}

// REST API Handlers

func (cm *ConnectivityManager) setupRoutes() *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Logger())
	router.Use(gin.Recovery())

	// CORS configuration
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"*"}
	router.Use(cors.New(config))

	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":    "healthy",
			"timestamp": time.Now(),
		})
	})

	// Metrics endpoint
	router.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// API routes
	api := router.Group("/api/v1")
	{
		// Network interfaces
		api.GET("/connectivity/interfaces", cm.getInterfacesHandler)
		api.GET("/connectivity/interfaces/:id", cm.getInterfaceHandler)
		api.PUT("/connectivity/interfaces/:id", cm.updateInterfaceHandler)

		// Connectivity events
		api.GET("connectivity/events", cm.getConnectivityEventsHandler)

		// Connectivity profiles
		api.GET("/connectivity/profiles", cm.getProfilesHandler)
		api.PUT("/connectivity/profiles/:id", cm.updateProfileHandler)
		api.POST("/connectivity/profiles/:id/activate", cm.activateProfileHandler)

		// System status
		api.GET("/connectivity/status", cm.getStatusHandler)
	}

	return router
}

func (cm *ConnectivityManager) getInterfacesHandler(c *gin.Context) {
	cm.mu.RLock()
	interfaces := make([]*NetworkInterface, 0, len(cm.interfaces))
	for _, iface := range cm.interfaces {
		interfaces = append(interfaces, iface)
	}
	cm.mu.RUnlock()

	c.JSON(http.StatusOK, gin.H{"interfaces": interfaces})
}

func (cm *ConnectivityManager) getInterfaceHandler(c *gin.Context) {
	ifaceID := c.Param("id")
	
	cm.mu.RLock()
	iface, exists := cm.interfaces[ifaceID]
	cm.mu.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Interface not found"})
		return
	}

	c.JSON(http.StatusOK, iface)
}

func (cm *ConnectivityManager) updateInterfaceHandler(c *gin.Context) {
	ifaceID := c.Param("id")
	
	cm.mu.Lock()
	defer cm.mu.Unlock()

	iface, exists := cm.interfaces[ifaceID]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Interface not found"})
		return
	}

	if err := c.ShouldBindJSON(iface); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	iface.UpdatedAt = time.Now()
	cm.saveInterface(iface)

	c.JSON(http.StatusOK, iface)
}

func (cm *ConnectivityManager) getConnectivityEventsHandler(c *gin.Context) {
	limit := 50
	if l := c.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil {
			limit = parsed
		}
	}

	rows, err := cm.db.Query(`
		SELECT id, type, severity, interface_id, description, resolved, created_at
		FROM connectivity_events 
		ORDER BY created_at DESC 
		LIMIT ?
	`, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var events []map[string]interface{}
	for rows.Next() {
		var event map[string]interface{} = make(map[string]interface{})
		err := rows.Scan(
			&event["id"], &event["type"], &event["severity"],
			&event["interface_id"], &event["description"], &event["resolved"],
			&event["created_at"],
		)
		if err != nil {
			continue
		}
		events = append(events, event)
	}

	c.JSON(http.StatusOK, gin.H{"events": events})
}

func (cm *ConnectivityManager) getProfilesHandler(c *gin.Context) {
	cm.mu.RLock()
	profiles := make([]*ConnectivityProfile, 0, len(cm.profiles))
	for _, profile := range cm.profiles {
		profiles = append(profiles, profile)
	}
	cm.mu.RUnlock()

	c.JSON(http.StatusOK, gin.H{"profiles": profiles})
}

func (cm *ConnectivityManager) updateProfileHandler(c *gin.Context) {
	profileID := c.Param("id")
	
	cm.mu.Lock()
	defer cm.mu.Unlock()

	profile, exists := cm.profiles[profileID]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Profile not found"})
		return
	}

	if err := c.ShouldBindJSON(profile); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	profile.UpdatedAt = time.Now()
	cm.saveProfile(profile)

	c.JSON(http.StatusOK, profile)
}

func (cm *ConnectivityManager) activateProfileHandler(c *gin.Context) {
	profileID := c.Param("id")
	
	cm.mu.Lock()
	defer cm.mu.Unlock()

	profile, exists := cm.profiles[profileID]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Profile not found"})
		return
	}

	// Deactivate current profile
	if cm.currentProfile != nil {
		cm.currentProfile.Active = false
		cm.saveProfile(cm.currentProfile)
	}

	// Activate new profile
	profile.Active = true
	cm.currentProfile = profile
	cm.saveProfile(profile)

	c.JSON(http.StatusOK, gin.H{"message": "Profile activated successfully"})
}

func (cm *ConnectivityManager) getStatusHandler(c *gin.Context) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	activeInterfaces := []*NetworkInterface{}
	for _, iface := range cm.interfaces {
		if iface.Status == "up" {
			activeInterfaces = append(activeInterfaces, iface)
		}
	}

	status := gin.H{
		"active_interfaces": activeInterfaces,
		"current_profile":   cm.currentProfile,
		"timestamp":         time.Now(),
	}

	c.JSON(http.StatusOK, status)
}

func main() {
	log.Println("Starting Intelligent Connectivity Management System...")

	config := NewConnectivityConfig()
	
	// Load configuration from environment
	if dbPath := os.Getenv("CONNECTIVITY_DATABASE_PATH"); dbPath != "" {
		config.DatabasePath = dbPath
	}
	if monitorInterval := os.Getenv("CONNECTIVITY_MONITOR_INTERVAL"); monitorInterval != "" {
		if duration, err := time.ParseDuration(monitorInterval); err == nil {
			config.MonitorInterval = duration
		}
	}

	cm, err := NewConnectivityManager(config)
	if err != nil {
		log.Fatalf("Failed to create connectivity manager: %v", err)
	}

	// Discover initial interfaces
	cm.discoverInterfaces()

	router := cm.setupRoutes()
	
	port := os.Getenv("PORT")
	if port == "" {
		port = "8085"
	}

	log.Printf("Intelligent Connectivity Management System started on port %s", port)
	log.Printf("Database: %s", config.DatabasePath)
	log.Printf("Monitor Interval: %v", config.MonitorInterval)

	if err := router.Run("0.0.0.0:" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}


