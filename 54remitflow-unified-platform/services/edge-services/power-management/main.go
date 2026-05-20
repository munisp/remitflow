package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
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
)

// Advanced Power Management System for Edge Banking Devices
// Handles unstable power conditions, battery management, UPS integration,
// solar power optimization, and graceful degradation strategies

// PowerSource represents different power sources
type PowerSource struct {
	ID          string    `json:"id" db:"id"`
	Type        string    `json:"type" db:"type"` // mains, battery, ups, solar, generator
	Status      string    `json:"status" db:"status"` // active, standby, failed, maintenance
	Capacity    float64   `json:"capacity" db:"capacity"` // Total capacity in Wh
	Current     float64   `json:"current" db:"current"` // Current charge/output in Wh
	Voltage     float64   `json:"voltage" db:"voltage"` // Voltage in V
	Current_A   float64   `json:"current_a" db:"current_a"` // Current in A
	Temperature float64   `json:"temperature" db:"temperature"` // Temperature in C
	Efficiency  float64   `json:"efficiency" db:"efficiency"` // Efficiency percentage
	Priority    int       `json:"priority" db:"priority"` // 1-10, higher is preferred
	Health      float64   `json:"health" db:"health"` // Health percentage
	CycleCount  int       `json:"cycle_count" db:"cycle_count"` // Battery cycles
	LastMaint   time.Time `json:"last_maintenance" db:"last_maintenance"`
	NextMaint   time.Time `json:"next_maintenance" db:"next_maintenance"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
}

// PowerEvent represents power-related events
type PowerEvent struct {
	ID          string                 `json:"id" db:"id"`
	Type        string                 `json:"type" db:"type"` // power_loss, power_restored, battery_low, ups_activated, etc.
	Severity    string                 `json:"severity" db:"severity"` // critical, warning, info
	Source      string                 `json:"source" db:"source"` // Source ID that triggered event
	Description string                 `json:"description" db:"description"`
	Metadata    map[string]interface{} `json:"metadata" db:"metadata"`
	Actions     []string               `json:"actions" db:"actions"` // Actions taken
	Resolved    bool                   `json:"resolved" db:"resolved"`
	ResolvedAt  *time.Time             `json:"resolved_at" db:"resolved_at"`
	CreatedAt   time.Time              `json:"created_at" db:"created_at"`
}

// PowerProfile represents power consumption profiles for different operational modes
type PowerProfile struct {
	ID              string    `json:"id" db:"id"`
	Name            string    `json:"name" db:"name"`
	Mode            string    `json:"mode" db:"mode"` // normal, power_save, emergency, maintenance
	CPULimit        float64   `json:"cpu_limit" db:"cpu_limit"` // CPU usage limit %
	MemoryLimit     float64   `json:"memory_limit" db:"memory_limit"` // Memory limit %
	NetworkLimit    float64   `json:"network_limit" db:"network_limit"` // Network bandwidth limit
	DisplayBright   float64   `json:"display_brightness" db:"display_brightness"` // Display brightness %
	SyncInterval    int       `json:"sync_interval" db:"sync_interval"` // Sync interval in seconds
	BackupInterval  int       `json:"backup_interval" db:"backup_interval"` // Backup interval in seconds
	ServicesPaused  []string  `json:"services_paused" db:"services_paused"` // Services to pause
	EstimatedPower  float64   `json:"estimated_power" db:"estimated_power"` // Estimated power consumption in W
	MaxDuration     int       `json:"max_duration" db:"max_duration"` // Max duration in minutes
	TriggerLevel    float64   `json:"trigger_level" db:"trigger_level"` // Battery level to trigger this profile
	Active          bool      `json:"active" db:"active"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time `json:"updated_at" db:"updated_at"`
}

// PowerManager manages all power-related operations
type PowerManager struct {
	db                *sql.DB
	config            *PowerConfig
	metrics           *PowerMetrics
	mu                sync.RWMutex
	ctx               context.Context
	cancel            context.CancelFunc
	shutdownChan      chan os.Signal
	powerSources      map[string]*PowerSource
	currentProfile    *PowerProfile
	profiles          map[string]*PowerProfile
	eventHandlers     map[string][]PowerEventHandler
	solarController   *SolarController
	upsController     *UPSController
	batteryController *BatteryController
	loadBalancer      *LoadBalancer
	predictionEngine  *PowerPredictionEngine
}

// PowerConfig holds configuration for power management
type PowerConfig struct {
	MonitorInterval      time.Duration `json:"monitor_interval"`
	CriticalBatteryLevel float64       `json:"critical_battery_level"`
	LowBatteryLevel      float64       `json:"low_battery_level"`
	ShutdownTimeout      time.Duration `json:"shutdown_timeout"`
	UPSEnabled           bool          `json:"ups_enabled"`
	SolarEnabled         bool          `json:"solar_enabled"`
	BatteryEnabled       bool          `json:"battery_enabled"`
	GeneratorEnabled     bool          `json:"generator_enabled"`
	AutoSwitching        bool          `json:"auto_switching"`
	LoadBalancing        bool          `json:"load_balancing"`
	PredictiveMode       bool          `json:"predictive_mode"`
	DatabasePath         string        `json:"database_path"`
}

// PowerMetrics provides Prometheus metrics for power management
type PowerMetrics struct {
	BatteryLevel        prometheus.Gauge
	PowerConsumption    prometheus.Gauge
	PowerGeneration     prometheus.Gauge
	UPSStatus           prometheus.Gauge
	SolarGeneration     prometheus.Gauge
	PowerEvents         prometheus.Counter
	PowerSwitches       prometheus.Counter
	EfficiencyRatio     prometheus.Gauge
	TemperatureReading  prometheus.Gauge
	MaintenanceAlerts   prometheus.Counter
	PredictionAccuracy  prometheus.Histogram
}

// PowerEventHandler defines the interface for power event handlers
type PowerEventHandler func(*PowerEvent) error

// SolarController manages solar power systems
type SolarController struct {
	panels          []SolarPanel
	inverter        *Inverter
	batteryCharger  *BatteryCharger
	weatherMonitor  *WeatherMonitor
	mpptController  *MPPTController
	mu              sync.RWMutex
}

// SolarPanel represents a solar panel
type SolarPanel struct {
	ID           string  `json:"id"`
	Capacity     float64 `json:"capacity"` // Watts
	Efficiency   float64 `json:"efficiency"` // Percentage
	Temperature  float64 `json:"temperature"`
	Irradiance   float64 `json:"irradiance"` // W/m²
	Output       float64 `json:"output"` // Current output in W
	Degradation  float64 `json:"degradation"` // Annual degradation %
	Age          int     `json:"age"` // Age in years
	Orientation  float64 `json:"orientation"` // Degrees from south
	Tilt         float64 `json:"tilt"` // Tilt angle in degrees
	Shading      float64 `json:"shading"` // Shading factor 0-1
}

// Inverter manages DC to AC conversion
type Inverter struct {
	ID         string  `json:"id"`
	Capacity   float64 `json:"capacity"` // VA rating
	Efficiency float64 `json:"efficiency"`
	InputV     float64 `json:"input_voltage"`
	OutputV    float64 `json:"output_voltage"`
	Frequency  float64 `json:"frequency"`
	Load       float64 `json:"load"` // Current load %
	Status     string  `json:"status"`
}

// BatteryCharger manages battery charging
type BatteryCharger struct {
	ID           string  `json:"id"`
	Type         string  `json:"type"` // pwm, mppt
	Capacity     float64 `json:"capacity"` // Amp rating
	Efficiency   float64 `json:"efficiency"`
	ChargeCurrent float64 `json:"charge_current"`
	ChargeVoltage float64 `json:"charge_voltage"`
	Stage        string  `json:"stage"` // bulk, absorption, float
	Status       string  `json:"status"`
}

// WeatherMonitor provides weather data for solar optimization
type WeatherMonitor struct {
	Temperature float64 `json:"temperature"`
	Humidity    float64 `json:"humidity"`
	Pressure    float64 `json:"pressure"`
	WindSpeed   float64 `json:"wind_speed"`
	CloudCover  float64 `json:"cloud_cover"`
	Irradiance  float64 `json:"irradiance"`
	Forecast    []WeatherForecast `json:"forecast"`
}

// WeatherForecast represents weather forecast data
type WeatherForecast struct {
	Time        time.Time `json:"time"`
	Temperature float64   `json:"temperature"`
	CloudCover  float64   `json:"cloud_cover"`
	Irradiance  float64   `json:"irradiance"`
	Probability float64   `json:"probability"`
}

// MPPTController manages Maximum Power Point Tracking
type MPPTController struct {
	ID              string  `json:"id"`
	Algorithm       string  `json:"algorithm"` // perturb_observe, incremental_conductance
	TrackingEff     float64 `json:"tracking_efficiency"`
	SweepInterval   int     `json:"sweep_interval"` // seconds
	VoltageStep     float64 `json:"voltage_step"`
	CurrentMPP      float64 `json:"current_mpp"` // Current maximum power point
	OptimalVoltage  float64 `json:"optimal_voltage"`
	OptimalCurrent  float64 `json:"optimal_current"`
	Status          string  `json:"status"`
}

// UPSController manages UPS systems
type UPSController struct {
	units       []UPSUnit
	switchover  time.Duration
	testSchedule map[string]time.Time
	mu          sync.RWMutex
}

// UPSUnit represents a UPS unit
type UPSUnit struct {
	ID            string    `json:"id"`
	Model         string    `json:"model"`
	Capacity      float64   `json:"capacity"` // VA rating
	BatteryLevel  float64   `json:"battery_level"`
	Load          float64   `json:"load"` // Current load %
	Runtime       int       `json:"runtime"` // Estimated runtime in minutes
	InputVoltage  float64   `json:"input_voltage"`
	OutputVoltage float64   `json:"output_voltage"`
	Frequency     float64   `json:"frequency"`
	Status        string    `json:"status"` // online, on_battery, charging, fault
	LastTest      time.Time `json:"last_test"`
	NextTest      time.Time `json:"next_test"`
	Alarms        []string  `json:"alarms"`
}

// BatteryController manages battery systems
type BatteryController struct {
	banks           []BatteryBank
	balancer        *BatteryBalancer
	thermalManager  *ThermalManager
	safetyMonitor   *SafetyMonitor
	mu              sync.RWMutex
}

// BatteryBank represents a battery bank
type BatteryBank struct {
	ID           string    `json:"id"`
	Type         string    `json:"type"` // lithium, lead_acid, gel, agm
	Cells        int       `json:"cells"`
	Capacity     float64   `json:"capacity"` // Ah
	Voltage      float64   `json:"voltage"`
	Current      float64   `json:"current"`
	SOC          float64   `json:"soc"` // State of charge %
	SOH          float64   `json:"soh"` // State of health %
	Temperature  float64   `json:"temperature"`
	CycleCount   int       `json:"cycle_count"`
	ChargeCycles int       `json:"charge_cycles"`
	Status       string    `json:"status"`
	LastBalance  time.Time `json:"last_balance"`
	NextBalance  time.Time `json:"next_balance"`
}

// BatteryBalancer manages cell balancing
type BatteryBalancer struct {
	ID           string    `json:"id"`
	Type         string    `json:"type"` // passive, active
	Enabled      bool      `json:"enabled"`
	Threshold    float64   `json:"threshold"` // Voltage difference threshold
	BalanceCurrent float64 `json:"balance_current"`
	Status       string    `json:"status"`
}

// ThermalManager manages battery temperature
type ThermalManager struct {
	Sensors     []TemperatureSensor `json:"sensors"`
	Fans        []CoolingFan        `json:"fans"`
	Heaters     []Heater            `json:"heaters"`
	TargetTemp  float64             `json:"target_temperature"`
	MaxTemp     float64             `json:"max_temperature"`
	MinTemp     float64             `json:"min_temperature"`
	Status      string              `json:"status"`
}

// TemperatureSensor represents a temperature sensor
type TemperatureSensor struct {
	ID          string  `json:"id"`
	Location    string  `json:"location"`
	Temperature float64 `json:"temperature"`
	Status      string  `json:"status"`
}

// CoolingFan represents a cooling fan
type CoolingFan struct {
	ID       string  `json:"id"`
	Speed    float64 `json:"speed"` // RPM
	Power    float64 `json:"power"` // Watts
	Status   string  `json:"status"`
}

// Heater represents a heater
type Heater struct {
	ID     string  `json:"id"`
	Power  float64 `json:"power"` // Watts
	Status string  `json:"status"`
}

// SafetyMonitor monitors battery safety parameters
type SafetyMonitor struct {
	OverVoltageProtection  bool    `json:"overvoltage_protection"`
	UnderVoltageProtection bool    `json:"undervoltage_protection"`
	OverCurrentProtection  bool    `json:"overcurrent_protection"`
	OverTempProtection     bool    `json:"overtemp_protection"`
	ShortCircuitProtection bool    `json:"shortcircuit_protection"`
	MaxVoltage             float64 `json:"max_voltage"`
	MinVoltage             float64 `json:"min_voltage"`
	MaxCurrent             float64 `json:"max_current"`
	MaxTemperature         float64 `json:"max_temperature"`
	Status                 string  `json:"status"`
	Alarms                 []string `json:"alarms"`
}

// LoadBalancer manages power distribution
type LoadBalancer struct {
	loads       []Load
	priorities  map[string]int
	scheduler   *LoadScheduler
	mu          sync.RWMutex
}

// Load represents an electrical load
type Load struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Power       float64 `json:"power"` // Watts
	Priority    int     `json:"priority"` // 1-10
	Essential   bool    `json:"essential"`
	Schedulable bool    `json:"schedulable"`
	Status      string  `json:"status"` // on, off, scheduled
	Schedule    []LoadSchedule `json:"schedule"`
}

// LoadSchedule represents a load schedule
type LoadSchedule struct {
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
	Days      []string  `json:"days"` // monday, tuesday, etc.
	Power     float64   `json:"power"`
	Enabled   bool      `json:"enabled"`
}

// LoadScheduler manages load scheduling
type LoadScheduler struct {
	schedules   map[string][]LoadSchedule
	predictions map[string]float64 // Load ID -> predicted power
	mu          sync.RWMutex
}

// PowerPredictionEngine predicts power consumption and generation
type PowerPredictionEngine struct {
	historicalData  []PowerDataPoint
	weatherData     []WeatherDataPoint
	models          map[string]PredictionModel
	accuracy        map[string]float64
	mu              sync.RWMutex
}

// PowerDataPoint represents historical power data
type PowerDataPoint struct {
	Timestamp   time.Time `json:"timestamp"`
	Consumption float64   `json:"consumption"`
	Generation  float64   `json:"generation"`
	BatterySOC  float64   `json:"battery_soc"`
	Temperature float64   `json:"temperature"`
	Load        float64   `json:"load"`
}

// WeatherDataPoint represents weather data
type WeatherDataPoint struct {
	Timestamp   time.Time `json:"timestamp"`
	Temperature float64   `json:"temperature"`
	Humidity    float64   `json:"humidity"`
	Irradiance  float64   `json:"irradiance"`
	CloudCover  float64   `json:"cloud_cover"`
	WindSpeed   float64   `json:"wind_speed"`
}

// PredictionModel represents a prediction model
type PredictionModel struct {
	ID          string                 `json:"id"`
	Type        string                 `json:"type"` // linear, polynomial, neural_network
	Parameters  map[string]interface{} `json:"parameters"`
	Accuracy    float64                `json:"accuracy"`
	LastTrained time.Time              `json:"last_trained"`
	Enabled     bool                   `json:"enabled"`
}

func NewPowerConfig() *PowerConfig {
	return &PowerConfig{
		MonitorInterval:      5 * time.Second,
		CriticalBatteryLevel: 10.0,
		LowBatteryLevel:      20.0,
		ShutdownTimeout:      30 * time.Second,
		UPSEnabled:           true,
		SolarEnabled:         true,
		BatteryEnabled:       true,
		GeneratorEnabled:     false,
		AutoSwitching:        true,
		LoadBalancing:        true,
		PredictiveMode:       true,
		DatabasePath:         "./power_management.db",
	}
}

func NewPowerMetrics() *PowerMetrics {
	return &PowerMetrics{
		BatteryLevel: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "power_battery_level_percent",
			Help: "Current battery level percentage",
		}),
		PowerConsumption: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "power_consumption_watts",
			Help: "Current power consumption in watts",
		}),
		PowerGeneration: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "power_generation_watts",
			Help: "Current power generation in watts",
		}),
		UPSStatus: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "power_ups_status",
			Help: "UPS status (1=online, 0=offline)",
		}),
		SolarGeneration: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "power_solar_generation_watts",
			Help: "Current solar power generation in watts",
		}),
		PowerEvents: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "power_events_total",
			Help: "Total number of power events",
		}),
		PowerSwitches: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "power_switches_total",
			Help: "Total number of power source switches",
		}),
		EfficiencyRatio: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "power_efficiency_ratio",
			Help: "Power system efficiency ratio",
		}),
		TemperatureReading: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "power_temperature_celsius",
			Help: "Power system temperature in Celsius",
		}),
		MaintenanceAlerts: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "power_maintenance_alerts_total",
			Help: "Total number of maintenance alerts",
		}),
		PredictionAccuracy: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name: "power_prediction_accuracy",
			Help: "Power prediction accuracy",
		}),
	}
}

func NewPowerManager(config *PowerConfig) (*PowerManager, error) {
	ctx, cancel := context.WithCancel(context.Background())

	pm := &PowerManager{
		config:            config,
		metrics:           NewPowerMetrics(),
		ctx:               ctx,
		cancel:            cancel,
		shutdownChan:      make(chan os.Signal, 1),
		powerSources:      make(map[string]*PowerSource),
		profiles:          make(map[string]*PowerProfile),
		eventHandlers:     make(map[string][]PowerEventHandler),
		solarController:   NewSolarController(),
		upsController:     NewUPSController(),
		batteryController: NewBatteryController(),
		loadBalancer:      NewLoadBalancer(),
		predictionEngine:  NewPowerPredictionEngine(),
	}

	// Initialize database
	if err := pm.initDatabase(); err != nil {
		return nil, fmt.Errorf("failed to initialize database: %v", err)
	}

	// Register Prometheus metrics
	prometheus.MustRegister(
		pm.metrics.BatteryLevel,
		pm.metrics.PowerConsumption,
		pm.metrics.PowerGeneration,
		pm.metrics.UPSStatus,
		pm.metrics.SolarGeneration,
		pm.metrics.PowerEvents,
		pm.metrics.PowerSwitches,
		pm.metrics.EfficiencyRatio,
		pm.metrics.TemperatureReading,
		pm.metrics.MaintenanceAlerts,
		pm.metrics.PredictionAccuracy,
	)

	// Initialize default power profiles
	pm.initDefaultProfiles()

	// Register default event handlers
	pm.registerDefaultEventHandlers()

	// Start background services
	go pm.monitorPower()
	go pm.manageSolar()
	go pm.manageUPS()
	go pm.manageBatteries()
	go pm.balanceLoads()
	go pm.predictPower()

	// Handle graceful shutdown
	signal.Notify(pm.shutdownChan, syscall.SIGINT, syscall.SIGTERM)
	go pm.handleShutdown()

	return pm, nil
}

func (pm *PowerManager) initDatabase() error {
	var err error
	pm.db, err = sql.Open("psycopg2", pm.config.DatabasePath+"?_journal_mode=WAL&_synchronous=FULL&_foreign_keys=ON")
	if err != nil {
		return err
	}

	schema := `
	CREATE TABLE IF NOT EXISTS power_sources (
		id TEXT PRIMARY KEY,
		type TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'standby',
		capacity REAL NOT NULL DEFAULT 0,
		current REAL NOT NULL DEFAULT 0,
		voltage REAL NOT NULL DEFAULT 0,
		current_a REAL NOT NULL DEFAULT 0,
		temperature REAL NOT NULL DEFAULT 0,
		efficiency REAL NOT NULL DEFAULT 0,
		priority INTEGER NOT NULL DEFAULT 5,
		health REAL NOT NULL DEFAULT 100,
		cycle_count INTEGER NOT NULL DEFAULT 0,
		last_maintenance DATETIME,
		next_maintenance DATETIME,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS power_events (
		id TEXT PRIMARY KEY,
		type TEXT NOT NULL,
		severity TEXT NOT NULL,
		source TEXT NOT NULL,
		description TEXT NOT NULL,
		metadata TEXT,
		actions TEXT,
		resolved BOOLEAN NOT NULL DEFAULT FALSE,
		resolved_at DATETIME,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS power_profiles (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		mode TEXT NOT NULL,
		cpu_limit REAL NOT NULL DEFAULT 100,
		memory_limit REAL NOT NULL DEFAULT 100,
		network_limit REAL NOT NULL DEFAULT 100,
		display_brightness REAL NOT NULL DEFAULT 100,
		sync_interval INTEGER NOT NULL DEFAULT 30,
		backup_interval INTEGER NOT NULL DEFAULT 300,
		services_paused TEXT,
		estimated_power REAL NOT NULL DEFAULT 0,
		max_duration INTEGER NOT NULL DEFAULT 0,
		trigger_level REAL NOT NULL DEFAULT 0,
		active BOOLEAN NOT NULL DEFAULT FALSE,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS power_readings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		source_id TEXT NOT NULL,
		timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		voltage REAL NOT NULL,
		current REAL NOT NULL,
		power REAL NOT NULL,
		temperature REAL NOT NULL,
		efficiency REAL NOT NULL,
		FOREIGN KEY (source_id) REFERENCES power_sources(id)
	);

	CREATE TABLE IF NOT EXISTS solar_data (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		irradiance REAL NOT NULL DEFAULT 0,
		panel_temp REAL NOT NULL DEFAULT 0,
		ambient_temp REAL NOT NULL DEFAULT 0,
		generation REAL NOT NULL DEFAULT 0,
		efficiency REAL NOT NULL DEFAULT 0
	);

	CREATE TABLE IF NOT EXISTS weather_data (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		temperature REAL NOT NULL DEFAULT 0,
		humidity REAL NOT NULL DEFAULT 0,
		pressure REAL NOT NULL DEFAULT 0,
		wind_speed REAL NOT NULL DEFAULT 0,
		cloud_cover REAL NOT NULL DEFAULT 0,
		irradiance REAL NOT NULL DEFAULT 0
	);

	-- Indexes for performance
	CREATE INDEX IF NOT EXISTS idx_power_sources_type ON power_sources(type);
	CREATE INDEX IF NOT EXISTS idx_power_sources_status ON power_sources(status);
	CREATE INDEX IF NOT EXISTS idx_power_events_type ON power_events(type);
	CREATE INDEX IF NOT EXISTS idx_power_events_severity ON power_events(severity);
	CREATE INDEX IF NOT EXISTS idx_power_readings_source ON power_readings(source_id);
	CREATE INDEX IF NOT EXISTS idx_power_readings_timestamp ON power_readings(timestamp);
	CREATE INDEX IF NOT EXISTS idx_solar_data_timestamp ON solar_data(timestamp);
	CREATE INDEX IF NOT EXISTS idx_weather_data_timestamp ON weather_data(timestamp);

	-- Triggers for updated_at
	CREATE TRIGGER IF NOT EXISTS update_power_sources_timestamp 
		AFTER UPDATE ON power_sources
		BEGIN
			UPDATE power_sources SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
		END;

	CREATE TRIGGER IF NOT EXISTS update_power_profiles_timestamp 
		AFTER UPDATE ON power_profiles
		BEGIN
			UPDATE power_profiles SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
		END;
	`

	_, err = pm.db.Exec(schema)
	return err
}

func (pm *PowerManager) initDefaultProfiles() {
	profiles := []*PowerProfile{
		{
			ID:              "normal",
			Name:            "Normal Operation",
			Mode:            "normal",
			CPULimit:        100,
			MemoryLimit:     100,
			NetworkLimit:    100,
			DisplayBright:   100,
			SyncInterval:    30,
			BackupInterval:  300,
			EstimatedPower:  50,
			MaxDuration:     0, // Unlimited
			TriggerLevel:    80,
			Active:          true,
		},
		{
			ID:              "power_save",
			Name:            "Power Save Mode",
			Mode:            "power_save",
			CPULimit:        70,
			MemoryLimit:     80,
			NetworkLimit:    50,
			DisplayBright:   50,
			SyncInterval:    60,
			BackupInterval:  600,
			ServicesPaused:  []string{"analytics", "reporting"},
			EstimatedPower:  30,
			MaxDuration:     240, // 4 hours
			TriggerLevel:    50,
			Active:          false,
		},
		{
			ID:              "emergency",
			Name:            "Emergency Mode",
			Mode:            "emergency",
			CPULimit:        40,
			MemoryLimit:     60,
			NetworkLimit:    20,
			DisplayBright:   20,
			SyncInterval:    300,
			BackupInterval:  1800,
			ServicesPaused:  []string{"analytics", "reporting", "monitoring", "ml-services"},
			EstimatedPower:  15,
			MaxDuration:     120, // 2 hours
			TriggerLevel:    20,
			Active:          false,
		},
		{
			ID:              "critical",
			Name:            "Critical Mode",
			Mode:            "critical",
			CPULimit:        20,
			MemoryLimit:     40,
			NetworkLimit:    10,
			DisplayBright:   10,
			SyncInterval:    600,
			BackupInterval:  3600,
			ServicesPaused:  []string{"analytics", "reporting", "monitoring", "ml-services", "notifications"},
			EstimatedPower:  8,
			MaxDuration:     60, // 1 hour
			TriggerLevel:    10,
			Active:          false,
		},
	}

	for _, profile := range profiles {
		pm.profiles[profile.ID] = profile
		pm.saveProfile(profile)
	}

	pm.currentProfile = profiles[0] // Start with normal mode
}

func (pm *PowerManager) saveProfile(profile *PowerProfile) error {
	servicesPausedJSON, _ := json.Marshal(profile.ServicesPaused)
	
	_, err := pm.db.Exec(`
		INSERT OR REPLACE INTO power_profiles (id, name, mode, cpu_limit, memory_limit,
			network_limit, display_brightness, sync_interval, backup_interval,
			services_paused, estimated_power, max_duration, trigger_level, active)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, profile.ID, profile.Name, profile.Mode, profile.CPULimit, profile.MemoryLimit,
		profile.NetworkLimit, profile.DisplayBright, profile.SyncInterval,
		profile.BackupInterval, string(servicesPausedJSON), profile.EstimatedPower,
		profile.MaxDuration, profile.TriggerLevel, profile.Active)
	
	return err
}

func (pm *PowerManager) registerDefaultEventHandlers() {
	// Battery low event handler
	pm.RegisterEventHandler("battery_low", func(event *PowerEvent) error {
		log.Printf("Battery low event: %s", event.Description)
		return pm.switchToPowerSaveMode()
	})

	// Critical battery event handler
	pm.RegisterEventHandler("battery_critical", func(event *PowerEvent) error {
		log.Printf("Critical battery event: %s", event.Description)
		return pm.switchToEmergencyMode()
	})

	// Power loss event handler
	pm.RegisterEventHandler("power_loss", func(event *PowerEvent) error {
		log.Printf("Power loss event: %s", event.Description)
		return pm.handlePowerLoss()
	})

	// Power restored event handler
	pm.RegisterEventHandler("power_restored", func(event *PowerEvent) error {
		log.Printf("Power restored event: %s", event.Description)
		return pm.handlePowerRestored()
	})

	// UPS activated event handler
	pm.RegisterEventHandler("ups_activated", func(event *PowerEvent) error {
		log.Printf("UPS activated event: %s", event.Description)
		return pm.handleUPSActivated()
	})

	// Solar generation event handler
	pm.RegisterEventHandler("solar_generation", func(event *PowerEvent) error {
		log.Printf("Solar generation event: %s", event.Description)
		return pm.optimizeSolarGeneration()
	})
}

// RegisterEventHandler registers a handler for a specific event type
func (pm *PowerManager) RegisterEventHandler(eventType string, handler PowerEventHandler) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	
	if handlers, exists := pm.eventHandlers[eventType]; exists {
		pm.eventHandlers[eventType] = append(handlers, handler)
	} else {
		pm.eventHandlers[eventType] = []PowerEventHandler{handler}
	}
}

// CreatePowerEvent creates and processes a power event
func (pm *PowerManager) CreatePowerEvent(eventType, severity, source, description string, metadata map[string]interface{}) error {
	event := &PowerEvent{
		ID:          uuid.New().String(),
		Type:        eventType,
		Severity:    severity,
		Source:      source,
		Description: description,
		Metadata:    metadata,
		Actions:     []string{},
		Resolved:    false,
		CreatedAt:   time.Now(),
	}

	// Save to database
	metadataJSON, _ := json.Marshal(metadata)
	_, err := pm.db.Exec(`
		INSERT INTO power_events (id, type, severity, source, description, metadata, resolved, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, event.ID, event.Type, event.Severity, event.Source, event.Description,
		string(metadataJSON), event.Resolved, event.CreatedAt)
	if err != nil {
		return err
	}

	// Update metrics
	pm.metrics.PowerEvents.Inc()

	// Process event handlers
	pm.mu.RLock()
	handlers, exists := pm.eventHandlers[eventType]
	pm.mu.RUnlock()

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
	_, err = pm.db.Exec(`
		UPDATE power_events SET actions = ? WHERE id = ?
	`, string(actionsJSON), event.ID)

	return err
}

// monitorPower continuously monitors power sources and system status
func (pm *PowerManager) monitorPower() {
	ticker := time.NewTicker(pm.config.MonitorInterval)
	defer ticker.Stop()

	for {
		select {
		case <-pm.ctx.Done():
			return
		case <-ticker.C:
			pm.performPowerMonitoring()
		}
	}
}

func (pm *PowerManager) performPowerMonitoring() {
	// Monitor all power sources
	for _, source := range pm.powerSources {
		pm.monitorPowerSource(source)
	}

	// Check battery levels
	pm.checkBatteryLevels()

	// Update system metrics
	pm.updateMetrics()

	// Check for power profile changes
	pm.checkProfileTriggers()

	// Perform predictive analysis
	if pm.config.PredictiveMode {
		pm.performPredictiveAnalysis()
	}
}

func (pm *PowerManager) monitorPowerSource(source *PowerSource) {
	// Simulate power source monitoring
	// In real implementation, this would read from actual hardware
	
	// Update source readings
	pm.updatePowerSourceReadings(source)

	// Check for anomalies
	pm.checkPowerSourceHealth(source)

	// Save readings to database
	pm.savePowerReading(source)
}

func (pm *PowerManager) updatePowerSourceReadings(source *PowerSource) {
	switch source.Type {
	case "battery":
		pm.updateBatteryReadings(source)
	case "solar":
		pm.updateSolarReadings(source)
	case "ups":
		pm.updateUPSReadings(source)
	case "mains":
		pm.updateMainsReadings(source)
	case "generator":
		pm.updateGeneratorReadings(source)
	}
}

func (pm *PowerManager) updateBatteryReadings(source *PowerSource) {
	// Simulate battery readings
	// In real implementation, read from battery management system
	
	// Simulate discharge curve
	if source.Status == "active" {
		dischargeRate := 0.1 // 0.1% per monitoring cycle
		source.Current = math.Max(0, source.Current-dischargeRate)
	}

	// Update voltage based on charge level
	source.Voltage = 12.0 + (source.Current/100.0)*2.4 // 12V to 14.4V range

	// Simulate temperature
	source.Temperature = 25.0 + (source.Current/100.0)*10.0 // Higher temp when charged

	// Calculate efficiency
	source.Efficiency = math.Max(80, 95-(100-source.Current)*0.1)
}

func (pm *PowerManager) updateSolarReadings(source *PowerSource) {
	// Simulate solar readings based on time of day
	hour := time.Now().Hour()
	var irradiance float64
	
	if hour >= 6 && hour <= 18 {
		// Simulate solar curve
		peakHour := 12.0
		hourDiff := math.Abs(float64(hour) - peakHour)
		irradiance = math.Max(0, 1000*(1-hourDiff/6)) // Peak 1000 W/m² at noon
	}

	// Calculate generation based on irradiance and panel efficiency
	panelArea := 2.0 // m²
	panelEfficiency := 0.20 // 20%
	source.Current = irradiance * panelArea * panelEfficiency

	source.Voltage = 24.0 // Typical solar panel voltage
	source.Temperature = 25.0 + irradiance/50 // Panel heating
	source.Efficiency = panelEfficiency * 100
}

func (pm *PowerManager) updateUPSReadings(source *PowerSource) {
	// Simulate UPS readings
	if source.Status == "active" {
		// UPS is providing power, discharge battery
		dischargeRate := 2.0 // 2% per monitoring cycle when active
		source.Current = math.Max(0, source.Current-dischargeRate)
	} else if source.Status == "charging" {
		// UPS is charging
		chargeRate := 0.5 // 0.5% per monitoring cycle when charging
		source.Current = math.Min(100, source.Current+chargeRate)
	}

	source.Voltage = 230.0 // AC voltage
	source.Temperature = 30.0 + (100-source.Current)*0.1
	source.Efficiency = 90.0 // Typical UPS efficiency
}

func (pm *PowerManager) updateMainsReadings(source *PowerSource) {
	// Simulate mains power readings
	source.Voltage = 230.0 + (float64(time.Now().Second()%10)-5)*2 // Voltage fluctuation
	source.Current = 100.0 // Always available when connected
	source.Temperature = 25.0
	source.Efficiency = 100.0
}

func (pm *PowerManager) updateGeneratorReadings(source *PowerSource) {
	// Simulate generator readings
	if source.Status == "active" {
		source.Voltage = 230.0
		source.Current = 100.0 // Full capacity when running
		source.Temperature = 60.0 // Higher operating temperature
		source.Efficiency = 85.0 // Typical generator efficiency
	} else {
		source.Current = 0.0
		source.Temperature = 25.0
	}
}

func (pm *PowerManager) checkPowerSourceHealth(source *PowerSource) {
	// Check for health issues
	healthIssues := []string{}

	// Temperature checks
	if source.Temperature > 60.0 {
		healthIssues = append(healthIssues, "High temperature")
	}

	// Voltage checks
	expectedVoltage := pm.getExpectedVoltage(source.Type)
	if math.Abs(source.Voltage-expectedVoltage) > expectedVoltage*0.1 {
		healthIssues = append(healthIssues, "Voltage deviation")
	}

	// Efficiency checks
	if source.Efficiency < 70.0 {
		healthIssues = append(healthIssues, "Low efficiency")
	}

	// Update health score
	if len(healthIssues) == 0 {
		source.Health = math.Min(100, source.Health+0.1)
	} else {
		source.Health = math.Max(0, source.Health-float64(len(healthIssues)))
		
		// Create health event
		pm.CreatePowerEvent("health_warning", "warning", source.ID,
			fmt.Sprintf("Health issues detected: %v", healthIssues),
			map[string]interface{}{
				"issues": healthIssues,
				"health": source.Health,
			})
	}
}

func (pm *PowerManager) getExpectedVoltage(sourceType string) float64 {
	switch sourceType {
	case "battery":
		return 12.6 // Nominal 12V battery
	case "solar":
		return 24.0 // Typical solar panel
	case "ups":
		return 230.0 // AC voltage
	case "mains":
		return 230.0 // AC voltage
	case "generator":
		return 230.0 // AC voltage
	default:
		return 12.0
	}
}

func (pm *PowerManager) savePowerReading(source *PowerSource) {
	power := source.Voltage * source.Current_A
	
	_, err := pm.db.Exec(`
		INSERT INTO power_readings (source_id, voltage, current, power, temperature, efficiency)
		VALUES (?, ?, ?, ?, ?, ?)
	`, source.ID, source.Voltage, source.Current_A, power, source.Temperature, source.Efficiency)
	
	if err != nil {
		log.Printf("Failed to save power reading: %v", err)
	}
}

func (pm *PowerManager) checkBatteryLevels() {
	for _, source := range pm.powerSources {
		if source.Type == "battery" {
			if source.Current <= pm.config.CriticalBatteryLevel && source.Status == "active" {
				pm.CreatePowerEvent("battery_critical", "critical", source.ID,
					fmt.Sprintf("Battery level critical: %.1f%%", source.Current),
					map[string]interface{}{
						"level": source.Current,
						"threshold": pm.config.CriticalBatteryLevel,
					})
			} else if source.Current <= pm.config.LowBatteryLevel && source.Status == "active" {
				pm.CreatePowerEvent("battery_low", "warning", source.ID,
					fmt.Sprintf("Battery level low: %.1f%%", source.Current),
					map[string]interface{}{
						"level": source.Current,
						"threshold": pm.config.LowBatteryLevel,
					})
			}
		}
	}
}

func (pm *PowerManager) updateMetrics() {
	// Update battery level metric
	for _, source := range pm.powerSources {
		if source.Type == "battery" && source.Status == "active" {
			pm.metrics.BatteryLevel.Set(source.Current)
			break
		}
	}

	// Update power consumption and generation
	totalConsumption := pm.calculateTotalConsumption()
	totalGeneration := pm.calculateTotalGeneration()
	
	pm.metrics.PowerConsumption.Set(totalConsumption)
	pm.metrics.PowerGeneration.Set(totalGeneration)

	// Update efficiency ratio
	if totalConsumption > 0 {
		efficiency := totalGeneration / totalConsumption
		pm.metrics.EfficiencyRatio.Set(efficiency)
	}

	// Update UPS status
	upsOnline := pm.isUPSOnline()
	if upsOnline {
		pm.metrics.UPSStatus.Set(1)
	} else {
		pm.metrics.UPSStatus.Set(0)
	}

	// Update solar generation
	solarGeneration := pm.getSolarGeneration()
	pm.metrics.SolarGeneration.Set(solarGeneration)

	// Update temperature
	avgTemp := pm.getAverageTemperature()
	pm.metrics.TemperatureReading.Set(avgTemp)
}

func (pm *PowerManager) calculateTotalConsumption() float64 {
	// Simulate power consumption calculation
	baseConsumption := 50.0 // Base system consumption in watts
	
	// Add consumption based on current profile
	if pm.currentProfile != nil {
		profileConsumption := pm.currentProfile.EstimatedPower
		return baseConsumption * (pm.currentProfile.CPULimit / 100.0) + profileConsumption
	}
	
	return baseConsumption
}

func (pm *PowerManager) calculateTotalGeneration() float64 {
	totalGeneration := 0.0
	
	for _, source := range pm.powerSources {
		if source.Status == "active" {
			switch source.Type {
			case "solar":
				totalGeneration += source.Current
			case "generator":
				totalGeneration += source.Current * source.Voltage / 1000 // Convert to watts
			}
		}
	}
	
	return totalGeneration
}

func (pm *PowerManager) isUPSOnline() bool {
	for _, source := range pm.powerSources {
		if source.Type == "ups" && source.Status == "active" {
			return true
		}
	}
	return false
}

func (pm *PowerManager) getSolarGeneration() float64 {
	for _, source := range pm.powerSources {
		if source.Type == "solar" && source.Status == "active" {
			return source.Current
		}
	}
	return 0.0
}

func (pm *PowerManager) getAverageTemperature() float64 {
	totalTemp := 0.0
	count := 0
	
	for _, source := range pm.powerSources {
		totalTemp += source.Temperature
		count++
	}
	
	if count > 0 {
		return totalTemp / float64(count)
	}
	return 25.0 // Default temperature
}

func (pm *PowerManager) checkProfileTriggers() {
	// Get current battery level
	batteryLevel := pm.getCurrentBatteryLevel()
	
	// Check if we need to switch profiles
	for _, profile := range pm.profiles {
		if !profile.Active && batteryLevel <= profile.TriggerLevel {
			if pm.currentProfile == nil || profile.TriggerLevel < pm.currentProfile.TriggerLevel {
				pm.switchToProfile(profile)
				break
			}
		}
	}
}

func (pm *PowerManager) getCurrentBatteryLevel() float64 {
	for _, source := range pm.powerSources {
		if source.Type == "battery" && source.Status == "active" {
			return source.Current
		}
	}
	return 100.0 // Default if no battery found
}

func (pm *PowerManager) switchToProfile(profile *PowerProfile) error {
	log.Printf("Switching to power profile: %s", profile.Name)
	
	// Deactivate current profile
	if pm.currentProfile != nil {
		pm.currentProfile.Active = false
		pm.saveProfile(pm.currentProfile)
	}
	
	// Activate new profile
	profile.Active = true
	pm.currentProfile = profile
	pm.saveProfile(profile)
	
	// Apply profile settings
	return pm.applyProfile(profile)
}

func (pm *PowerManager) applyProfile(profile *PowerProfile) error {
	log.Printf("Applying power profile: %s", profile.Name)
	
	// Apply CPU limits
	if err := pm.applyCPULimit(profile.CPULimit); err != nil {
		log.Printf("Failed to apply CPU limit: %v", err)
	}
	
	// Apply memory limits
	if err := pm.applyMemoryLimit(profile.MemoryLimit); err != nil {
		log.Printf("Failed to apply memory limit: %v", err)
	}
	
	// Apply network limits
	if err := pm.applyNetworkLimit(profile.NetworkLimit); err != nil {
		log.Printf("Failed to apply network limit: %v", err)
	}
	
	// Apply display brightness
	if err := pm.applyDisplayBrightness(profile.DisplayBright); err != nil {
		log.Printf("Failed to apply display brightness: %v", err)
	}
	
	// Pause services if specified
	if len(profile.ServicesPaused) > 0 {
		if err := pm.pauseServices(profile.ServicesPaused); err != nil {
			log.Printf("Failed to pause services: %v", err)
		}
	}
	
	return nil
}

func (pm *PowerManager) applyCPULimit(limit float64) error {
	// Apply CPU frequency scaling
	cpuFreq := fmt.Sprintf("%.0f", limit)
	cmd := exec.Command("cpufreq-set", "-u", cpuFreq+"%")
	return cmd.Run()
}

func (pm *PowerManager) applyMemoryLimit(limit float64) error {
	// Apply memory limits using cgroups
	limitBytes := fmt.Sprintf("%.0f", limit*1024*1024*1024/100) // Convert to bytes
	cmd := exec.Command("echo", limitBytes, ">", "/sys/fs/cgroup/memory/memory.limit_in_bytes")
	return cmd.Run()
}

func (pm *PowerManager) applyNetworkLimit(limit float64) error {
	// Apply network bandwidth limits using tc
	bandwidth := fmt.Sprintf("%.0fmbit", limit)
	cmd := exec.Command("tc", "qdisc", "add", "dev", "eth0", "root", "tbf", "rate", bandwidth, "burst", "32kbit", "latency", "400ms")
	return cmd.Run()
}

func (pm *PowerManager) applyDisplayBrightness(brightness float64) error {
	// Apply display brightness
	brightnessValue := fmt.Sprintf("%.0f", brightness*255/100)
	cmd := exec.Command("echo", brightnessValue, ">", "/sys/class/backlight/backlight/brightness")
	return cmd.Run()
}

func (pm *PowerManager) pauseServices(services []string) error {
	for _, service := range services {
		cmd := exec.Command("systemctl", "stop", service)
		if err := cmd.Run(); err != nil {
			log.Printf("Failed to stop service %s: %v", service, err)
		}
	}
	return nil
}

func (pm *PowerManager) switchToPowerSaveMode() error {
	if profile, exists := pm.profiles["power_save"]; exists {
		return pm.switchToProfile(profile)
	}
	return fmt.Errorf("power save profile not found")
}

func (pm *PowerManager) switchToEmergencyMode() error {
	if profile, exists := pm.profiles["emergency"]; exists {
		return pm.switchToProfile(profile)
	}
	return fmt.Errorf("emergency profile not found")
}

func (pm *PowerManager) handlePowerLoss() error {
	log.Println("Handling power loss event")
	
	// Switch to UPS if available
	if pm.config.UPSEnabled {
		if err := pm.activateUPS(); err != nil {
			log.Printf("Failed to activate UPS: %v", err)
		}
	}
	
	// Switch to emergency mode
	return pm.switchToEmergencyMode()
}

func (pm *PowerManager) handlePowerRestored() error {
	log.Println("Handling power restored event")
	
	// Switch back to normal mode
	if profile, exists := pm.profiles["normal"]; exists {
		return pm.switchToProfile(profile)
	}
	
	return nil
}

func (pm *PowerManager) handleUPSActivated() error {
	log.Println("UPS activated, switching to power save mode")
	return pm.switchToPowerSaveMode()
}

func (pm *PowerManager) activateUPS() error {
	for _, source := range pm.powerSources {
		if source.Type == "ups" {
			source.Status = "active"
			pm.metrics.PowerSwitches.Inc()
			return nil
		}
	}
	return fmt.Errorf("no UPS available")
}

func (pm *PowerManager) optimizeSolarGeneration() error {
	log.Println("Optimizing solar generation")
	
	// This would implement MPPT optimization
	// For now, just log the event
	return nil
}

func (pm *PowerManager) performPredictiveAnalysis() {
	// Perform power prediction analysis
	// This would use machine learning models to predict power consumption and generation
	
	// For now, simulate prediction accuracy
	accuracy := 0.85 + (float64(time.Now().Second()%10))/100 // 85-95% accuracy
	pm.metrics.PredictionAccuracy.Observe(accuracy)
}

// Solar controller methods
func NewSolarController() *SolarController {
	return &SolarController{
		panels:         []SolarPanel{},
		inverter:       &Inverter{},
		batteryCharger: &BatteryCharger{},
		weatherMonitor: &WeatherMonitor{},
		mpptController: &MPPTController{},
	}
}

func (pm *PowerManager) manageSolar() {
	if !pm.config.SolarEnabled {
		return
	}
	
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case <-pm.ctx.Done():
			return
		case <-ticker.C:
			pm.optimizeSolarSystem()
		}
	}
}

func (pm *PowerManager) optimizeSolarSystem() {
	// Optimize solar panel orientation and MPPT settings
	// This would interface with actual solar hardware
	log.Println("Optimizing solar system")
}

// UPS controller methods
func NewUPSController() *UPSController {
	return &UPSController{
		units:        []UPSUnit{},
		switchover:   time.Millisecond * 10, // 10ms switchover time
		testSchedule: make(map[string]time.Time),
	}
}

func (pm *PowerManager) manageUPS() {
	if !pm.config.UPSEnabled {
		return
	}
	
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case <-pm.ctx.Done():
			return
		case <-ticker.C:
			pm.monitorUPS()
		}
	}
}

func (pm *PowerManager) monitorUPS() {
	// Monitor UPS units and perform scheduled tests
	log.Println("Monitoring UPS systems")
}

// Battery controller methods
func NewBatteryController() *BatteryController {
	return &BatteryController{
		banks:          []BatteryBank{},
		balancer:       &BatteryBalancer{},
		thermalManager: &ThermalManager{},
		safetyMonitor:  &SafetyMonitor{},
	}
}

func (pm *PowerManager) manageBatteries() {
	if !pm.config.BatteryEnabled {
		return
	}
	
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case <-pm.ctx.Done():
			return
		case <-ticker.C:
			pm.monitorBatteries()
		}
	}
}

func (pm *PowerManager) monitorBatteries() {
	// Monitor battery health, temperature, and perform balancing
	log.Println("Monitoring battery systems")
}

// Load balancer methods
func NewLoadBalancer() *LoadBalancer {
	return &LoadBalancer{
		loads:      []Load{},
		priorities: make(map[string]int),
		scheduler:  &LoadScheduler{},
	}
}

func (pm *PowerManager) balanceLoads() {
	if !pm.config.LoadBalancing {
		return
	}
	
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case <-pm.ctx.Done():
			return
		case <-ticker.C:
			pm.optimizeLoadDistribution()
		}
	}
}

func (pm *PowerManager) optimizeLoadDistribution() {
	// Optimize power distribution based on priorities and available power
	log.Println("Optimizing load distribution")
}

// Prediction engine methods
func NewPowerPredictionEngine() *PowerPredictionEngine {
	return &PowerPredictionEngine{
		historicalData: []PowerDataPoint{},
		weatherData:    []WeatherDataPoint{},
		models:         make(map[string]PredictionModel),
		accuracy:       make(map[string]float64),
	}
}

func (pm *PowerManager) predictPower() {
	if !pm.config.PredictiveMode {
		return
	}
	
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	
	for {
		select {
		case <-pm.ctx.Done():
			return
		case <-ticker.C:
			pm.generatePowerPredictions()
		}
	}
}

func (pm *PowerManager) generatePowerPredictions() {
	// Generate power consumption and generation predictions
	log.Println("Generating power predictions")
}

// handleShutdown handles graceful shutdown
func (pm *PowerManager) handleShutdown() {
	<-pm.shutdownChan
	log.Println("Power manager shutdown signal received")

	// Cancel context to stop all goroutines
	pm.cancel()

	// Perform emergency shutdown procedures
	pm.performEmergencyShutdown()

	// Close database
	if pm.db != nil {
		pm.db.Close()
	}

	log.Println("Power manager shutdown completed")
	os.Exit(0)
}

func (pm *PowerManager) performEmergencyShutdown() {
	log.Println("Performing emergency shutdown procedures")
	
	// Save critical data
	pm.saveCriticalData()
	
	// Gracefully shutdown power sources
	pm.shutdownPowerSources()
	
	// Notify other systems
	pm.notifyShutdown()
}

func (pm *PowerManager) saveCriticalData() {
	// Save current power state and configuration
	log.Println("Saving critical power management data")
}

func (pm *PowerManager) shutdownPowerSources() {
	// Gracefully shutdown controllable power sources
	for _, source := range pm.powerSources {
		if source.Type == "generator" && source.Status == "active" {
			log.Printf("Shutting down generator: %s", source.ID)
			source.Status = "standby"
		}
	}
}

func (pm *PowerManager) notifyShutdown() {
	// Notify other systems about power manager shutdown
	log.Println("Notifying systems about power manager shutdown")
}

// REST API Handlers

func (pm *PowerManager) setupRoutes() *gin.Engine {
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
		// Power sources
		api.GET("/power/sources", pm.getPowerSourcesHandler)
		api.GET("/power/sources/:id", pm.getPowerSourceHandler)
		api.POST("/power/sources", pm.createPowerSourceHandler)
		api.PUT("/power/sources/:id", pm.updatePowerSourceHandler)

		// Power events
		api.GET("/power/events", pm.getPowerEventsHandler)
		api.POST("/power/events", pm.createPowerEventHandler)

		// Power profiles
		api.GET("/power/profiles", pm.getPowerProfilesHandler)
		api.GET("/power/profiles/:id", pm.getPowerProfileHandler)
		api.POST("/power/profiles", pm.createPowerProfileHandler)
		api.PUT("/power/profiles/:id", pm.updatePowerProfileHandler)
		api.POST("/power/profiles/:id/activate", pm.activateProfileHandler)

		// System status
		api.GET("/power/status", pm.getPowerStatusHandler)
		api.GET("/power/readings", pm.getPowerReadingsHandler)

		// Control operations
		api.POST("/power/emergency-shutdown", pm.emergencyShutdownHandler)
		api.POST("/power/switch-source", pm.switchPowerSourceHandler)
	}

	return router
}

func (pm *PowerManager) getPowerSourcesHandler(c *gin.Context) {
	pm.mu.RLock()
	sources := make([]*PowerSource, 0, len(pm.powerSources))
	for _, source := range pm.powerSources {
		sources = append(sources, source)
	}
	pm.mu.RUnlock()

	c.JSON(http.StatusOK, gin.H{"sources": sources})
}

func (pm *PowerManager) getPowerSourceHandler(c *gin.Context) {
	sourceID := c.Param("id")
	
	pm.mu.RLock()
	source, exists := pm.powerSources[sourceID]
	pm.mu.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Power source not found"})
		return
	}

	c.JSON(http.StatusOK, source)
}

func (pm *PowerManager) createPowerSourceHandler(c *gin.Context) {
	var source PowerSource
	if err := c.ShouldBindJSON(&source); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	source.ID = uuid.New().String()
	source.CreatedAt = time.Now()
	source.UpdatedAt = time.Now()

	pm.mu.Lock()
	pm.powerSources[source.ID] = &source
	pm.mu.Unlock()

	c.JSON(http.StatusCreated, source)
}

func (pm *PowerManager) updatePowerSourceHandler(c *gin.Context) {
	sourceID := c.Param("id")
	
	pm.mu.Lock()
	source, exists := pm.powerSources[sourceID]
	if !exists {
		pm.mu.Unlock()
		c.JSON(http.StatusNotFound, gin.H{"error": "Power source not found"})
		return
	}

	if err := c.ShouldBindJSON(source); err != nil {
		pm.mu.Unlock()
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	source.UpdatedAt = time.Now()
	pm.mu.Unlock()

	c.JSON(http.StatusOK, source)
}

func (pm *PowerManager) getPowerEventsHandler(c *gin.Context) {
	limit := 50
	if l := c.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil {
			limit = parsed
		}
	}

	rows, err := pm.db.Query(`
		SELECT id, type, severity, source, description, resolved, created_at
		FROM power_events 
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
			&event["source"], &event["description"], &event["resolved"],
			&event["created_at"],
		)
		if err != nil {
			continue
		}
		events = append(events, event)
	}

	c.JSON(http.StatusOK, gin.H{"events": events})
}

func (pm *PowerManager) createPowerEventHandler(c *gin.Context) {
	var req struct {
		Type        string                 `json:"type" binding:"required"`
		Severity    string                 `json:"severity" binding:"required"`
		Source      string                 `json:"source" binding:"required"`
		Description string                 `json:"description" binding:"required"`
		Metadata    map[string]interface{} `json:"metadata"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	err := pm.CreatePowerEvent(req.Type, req.Severity, req.Source, req.Description, req.Metadata)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Event created successfully"})
}

func (pm *PowerManager) getPowerProfilesHandler(c *gin.Context) {
	pm.mu.RLock()
	profiles := make([]*PowerProfile, 0, len(pm.profiles))
	for _, profile := range pm.profiles {
		profiles = append(profiles, profile)
	}
	pm.mu.RUnlock()

	c.JSON(http.StatusOK, gin.H{"profiles": profiles})
}

func (pm *PowerManager) getPowerProfileHandler(c *gin.Context) {
	profileID := c.Param("id")
	
	pm.mu.RLock()
	profile, exists := pm.profiles[profileID]
	pm.mu.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Power profile not found"})
		return
	}

	c.JSON(http.StatusOK, profile)
}

func (pm *PowerManager) createPowerProfileHandler(c *gin.Context) {
	var profile PowerProfile
	if err := c.ShouldBindJSON(&profile); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	profile.ID = uuid.New().String()
	profile.CreatedAt = time.Now()
	profile.UpdatedAt = time.Now()

	pm.mu.Lock()
	pm.profiles[profile.ID] = &profile
	pm.mu.Unlock()

	pm.saveProfile(&profile)

	c.JSON(http.StatusCreated, profile)
}

func (pm *PowerManager) updatePowerProfileHandler(c *gin.Context) {
	profileID := c.Param("id")
	
	pm.mu.Lock()
	profile, exists := pm.profiles[profileID]
	if !exists {
		pm.mu.Unlock()
		c.JSON(http.StatusNotFound, gin.H{"error": "Power profile not found"})
		return
	}

	if err := c.ShouldBindJSON(profile); err != nil {
		pm.mu.Unlock()
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	profile.UpdatedAt = time.Now()
	pm.mu.Unlock()

	pm.saveProfile(profile)

	c.JSON(http.StatusOK, profile)
}

func (pm *PowerManager) activateProfileHandler(c *gin.Context) {
	profileID := c.Param("id")
	
	pm.mu.RLock()
	profile, exists := pm.profiles[profileID]
	pm.mu.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Power profile not found"})
		return
	}

	err := pm.switchToProfile(profile)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Profile activated successfully"})
}

func (pm *PowerManager) getPowerStatusHandler(c *gin.Context) {
	batteryLevel := pm.getCurrentBatteryLevel()
	totalConsumption := pm.calculateTotalConsumption()
	totalGeneration := pm.calculateTotalGeneration()
	
	status := gin.H{
		"battery_level":     batteryLevel,
		"power_consumption": totalConsumption,
		"power_generation":  totalGeneration,
		"current_profile":   pm.currentProfile,
		"ups_online":        pm.isUPSOnline(),
		"solar_generation":  pm.getSolarGeneration(),
		"average_temperature": pm.getAverageTemperature(),
		"efficiency_ratio":  totalGeneration / math.Max(totalConsumption, 1),
		"timestamp":         time.Now(),
	}

	c.JSON(http.StatusOK, status)
}

func (pm *PowerManager) getPowerReadingsHandler(c *gin.Context) {
	limit := 100
	if l := c.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil {
			limit = parsed
		}
	}

	sourceID := c.Query("source_id")
	
	query := `
		SELECT source_id, timestamp, voltage, current, power, temperature, efficiency
		FROM power_readings 
	`
	args := []interface{}{}
	
	if sourceID != "" {
		query += " WHERE source_id = ?"
		args = append(args, sourceID)
	}
	
	query += " ORDER BY timestamp DESC LIMIT ?"
	args = append(args, limit)

	rows, err := pm.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var readings []map[string]interface{}
	for rows.Next() {
		var reading map[string]interface{} = make(map[string]interface{})
		err := rows.Scan(
			&reading["source_id"], &reading["timestamp"], &reading["voltage"],
			&reading["current"], &reading["power"], &reading["temperature"],
			&reading["efficiency"],
		)
		if err != nil {
			continue
		}
		readings = append(readings, reading)
	}

	c.JSON(http.StatusOK, gin.H{"readings": readings})
}

func (pm *PowerManager) emergencyShutdownHandler(c *gin.Context) {
	log.Println("Emergency shutdown requested via API")
	
	go func() {
		time.Sleep(2 * time.Second) // Give time to respond
		pm.performEmergencyShutdown()
		os.Exit(0)
	}()

	c.JSON(http.StatusOK, gin.H{"message": "Emergency shutdown initiated"})
}

func (pm *PowerManager) switchPowerSourceHandler(c *gin.Context) {
	var req struct {
		SourceID string `json:"source_id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	pm.mu.Lock()
	source, exists := pm.powerSources[req.SourceID]
	if !exists {
		pm.mu.Unlock()
		c.JSON(http.StatusNotFound, gin.H{"error": "Power source not found"})
		return
	}

	// Deactivate current active sources of the same type
	for _, s := range pm.powerSources {
		if s.Type == source.Type && s.Status == "active" {
			s.Status = "standby"
		}
	}

	// Activate requested source
	source.Status = "active"
	pm.mu.Unlock()

	pm.metrics.PowerSwitches.Inc()

	c.JSON(http.StatusOK, gin.H{"message": "Power source switched successfully"})
}

func main() {
	log.Println("Starting Advanced Power Management System...")

	config := NewPowerConfig()
	
	// Load configuration from environment
	if dbPath := os.Getenv("POWER_DATABASE_PATH"); dbPath != "" {
		config.DatabasePath = dbPath
	}
	if monitorInterval := os.Getenv("POWER_MONITOR_INTERVAL"); monitorInterval != "" {
		if duration, err := time.ParseDuration(monitorInterval); err == nil {
			config.MonitorInterval = duration
		}
	}

	pm, err := NewPowerManager(config)
	if err != nil {
		log.Fatalf("Failed to create power manager: %v", err)
	}

	// Initialize some demo power sources
	demoBattery := &PowerSource{
		ID:          "battery-001",
		Type:        "battery",
		Status:      "active",
		Capacity:    100.0,
		Current:     85.0,
		Voltage:     12.6,
		Current_A:   10.0,
		Temperature: 25.0,
		Efficiency:  95.0,
		Priority:    8,
		Health:      98.0,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	demoSolar := &PowerSource{
		ID:          "solar-001",
		Type:        "solar",
		Status:      "active",
		Capacity:    500.0,
		Current:     300.0,
		Voltage:     24.0,
		Current_A:   12.5,
		Temperature: 35.0,
		Efficiency:  20.0,
		Priority:    9,
		Health:      100.0,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	demoUPS := &PowerSource{
		ID:          "ups-001",
		Type:        "ups",
		Status:      "standby",
		Capacity:    1000.0,
		Current:     100.0,
		Voltage:     230.0,
		Current_A:   4.3,
		Temperature: 30.0,
		Efficiency:  90.0,
		Priority:    7,
		Health:      95.0,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	pm.mu.Lock()
	pm.powerSources[demoBattery.ID] = demoBattery
	pm.powerSources[demoSolar.ID] = demoSolar
	pm.powerSources[demoUPS.ID] = demoUPS
	pm.mu.Unlock()

	router := pm.setupRoutes()
	
	port := os.Getenv("PORT")
	if port == "" {
		port = "8084"
	}

	log.Printf("Advanced Power Management System started on port %s", port)
	log.Printf("Database: %s", config.DatabasePath)
	log.Printf("Monitor Interval: %v", config.MonitorInterval)
	log.Printf("UPS Enabled: %v", config.UPSEnabled)
	log.Printf("Solar Enabled: %v", config.SolarEnabled)
	log.Printf("Battery Enabled: %v", config.BatteryEnabled)

	if err := router.Run("0.0.0.0:" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

