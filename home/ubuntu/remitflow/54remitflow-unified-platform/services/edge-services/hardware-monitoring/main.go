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

// Hardware Monitoring and Environmental Adaptation System for Edge Banking Devices
// Handles challenging African deployment environments with comprehensive sensor integration,
// thermal management, vibration detection, dust protection, and adaptive system responses.

// HardwareMonitor manages all hardware monitoring and environmental adaptation
type HardwareMonitor struct {
	db                    *sql.DB
	config                *HardwareConfig
	metrics               *HardwareMetrics
	mu                    sync.RWMutex
	ctx                   context.Context
	cancel                context.CancelFunc
	shutdownChan          chan os.Signal
	sensors               map[string]*Sensor
	thermalManager        *ThermalManager
	vibrationDetector     *VibrationDetector
	environmentalMonitor  *EnvironmentalMonitor
	dustProtectionSystem  *DustProtectionSystem
	adaptationEngine      *AdaptationEngine
	alertManager          *AlertManager
	maintenanceScheduler  *MaintenanceScheduler
}

// Sensor represents a hardware sensor
type Sensor struct {
	ID              string                 `json:"id" db:"id"`
	Name            string                 `json:"name" db:"name"`
	Type            string                 `json:"type" db:"type"` // temperature, humidity, pressure, accelerometer, gyroscope, etc.
	Location        string                 `json:"location" db:"location"` // cpu, gpu, ambient, case, etc.
	Unit            string                 `json:"unit" db:"unit"`
	MinValue        float64                `json:"min_value" db:"min_value"`
	MaxValue        float64                `json:"max_value" db:"max_value"`
	CurrentValue    float64                `json:"current_value" db:"current_value"`
	PreviousValue   float64                `json:"previous_value" db:"previous_value"`
	Threshold       SensorThreshold        `json:"threshold" db:"threshold"`
	Status          string                 `json:"status" db:"status"` // normal, warning, critical, error
	Calibration     SensorCalibration      `json:"calibration" db:"calibration"`
	Metadata        map[string]interface{} `json:"metadata" db:"metadata"`
	Enabled         bool                   `json:"enabled" db:"enabled"`
	LastReading     time.Time              `json:"last_reading" db:"last_reading"`
	CreatedAt       time.Time              `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time              `json:"updated_at" db:"updated_at"`
}

// SensorThreshold defines alert thresholds for sensors
type SensorThreshold struct {
	WarningLow   float64 `json:"warning_low"`
	WarningHigh  float64 `json:"warning_high"`
	CriticalLow  float64 `json:"critical_low"`
	CriticalHigh float64 `json:"critical_high"`
}

// SensorCalibration holds calibration data for sensors
type SensorCalibration struct {
	Offset       float64   `json:"offset"`
	Scale        float64   `json:"scale"`
	LastCalibrated time.Time `json:"last_calibrated"`
	CalibrationData map[string]float64 `json:"calibration_data"`
}

// EnvironmentalConditions represents current environmental conditions
type EnvironmentalConditions struct {
	ID                string    `json:"id" db:"id"`
	Temperature       float64   `json:"temperature" db:"temperature"` // Celsius
	Humidity          float64   `json:"humidity" db:"humidity"` // %
	Pressure          float64   `json:"pressure" db:"pressure"` // hPa
	AirQuality        float64   `json:"air_quality" db:"air_quality"` // AQI
	DustLevel         float64   `json:"dust_level" db:"dust_level"` // µg/m³
	Vibration         float64   `json:"vibration" db:"vibration"` // g-force
	Noise             float64   `json:"noise" db:"noise"` // dB
	LightLevel        float64   `json:"light_level" db:"light_level"` // lux
	UVIndex           float64   `json:"uv_index" db:"uv_index"`
	WindSpeed         float64   `json:"wind_speed" db:"wind_speed"` // m/s
	Rainfall          float64   `json:"rainfall" db:"rainfall"` // mm/h
	Location          string    `json:"location" db:"location"`
	Timestamp         time.Time `json:"timestamp" db:"timestamp"`
}

// ThermalProfile represents thermal management settings
type ThermalProfile struct {
	ID                  string    `json:"id" db:"id"`
	Name                string    `json:"name" db:"name"`
	MaxCPUTemp          float64   `json:"max_cpu_temp" db:"max_cpu_temp"`
	MaxGPUTemp          float64   `json:"max_gpu_temp" db:"max_gpu_temp"`
	MaxAmbientTemp      float64   `json:"max_ambient_temp" db:"max_ambient_temp"`
	FanCurve            []FanPoint `json:"fan_curve" db:"fan_curve"`
	ThrottleTemp        float64   `json:"throttle_temp" db:"throttle_temp"`
	ShutdownTemp        float64   `json:"shutdown_temp" db:"shutdown_temp"`
	CoolingStrategy     string    `json:"cooling_strategy" db:"cooling_strategy"` // passive, active, aggressive
	PowerLimitStrategy  string    `json:"power_limit_strategy" db:"power_limit_strategy"`
	Active              bool      `json:"active" db:"active"`
	CreatedAt           time.Time `json:"created_at" db:"created_at"`
	UpdatedAt           time.Time `json:"updated_at" db:"updated_at"`
}

// FanPoint represents a point on the fan curve
type FanPoint struct {
	Temperature float64 `json:"temperature"`
	FanSpeed    int     `json:"fan_speed"` // 0-100%
}

// VibrationEvent represents a vibration detection event
type VibrationEvent struct {
	ID          string                 `json:"id" db:"id"`
	Type        string                 `json:"type" db:"type"` // shock, continuous, periodic
	Magnitude   float64                `json:"magnitude" db:"magnitude"` // g-force
	Duration    int                    `json:"duration" db:"duration"` // milliseconds
	Frequency   float64                `json:"frequency" db:"frequency"` // Hz
	Direction   string                 `json:"direction" db:"direction"` // x, y, z, combined
	Source      string                 `json:"source" db:"source"` // transport, operation, external
	Severity    string                 `json:"severity" db:"severity"` // low, medium, high, critical
	Actions     []string               `json:"actions" db:"actions"`
	Metadata    map[string]interface{} `json:"metadata" db:"metadata"`
	Resolved    bool                   `json:"resolved" db:"resolved"`
	ResolvedAt  *time.Time             `json:"resolved_at" db:"resolved_at"`
	CreatedAt   time.Time              `json:"created_at" db:"created_at"`
}

// MaintenanceTask represents a maintenance task
type MaintenanceTask struct {
	ID              string                 `json:"id" db:"id"`
	Name            string                 `json:"name" db:"name"`
	Type            string                 `json:"type" db:"type"` // preventive, corrective, predictive
	Priority        string                 `json:"priority" db:"priority"` // low, medium, high, critical
	Component       string                 `json:"component" db:"component"`
	Description     string                 `json:"description" db:"description"`
	Instructions    []string               `json:"instructions" db:"instructions"`
	EstimatedTime   int                    `json:"estimated_time" db:"estimated_time"` // minutes
	RequiredTools   []string               `json:"required_tools" db:"required_tools"`
	RequiredParts   []string               `json:"required_parts" db:"required_parts"`
	Status          string                 `json:"status" db:"status"` // pending, in_progress, completed, cancelled
	ScheduledAt     time.Time              `json:"scheduled_at" db:"scheduled_at"`
	CompletedAt     *time.Time             `json:"completed_at" db:"completed_at"`
	Metadata        map[string]interface{} `json:"metadata" db:"metadata"`
	CreatedAt       time.Time              `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time              `json:"updated_at" db:"updated_at"`
}

// HardwareConfig holds configuration for hardware monitoring
type HardwareConfig struct {
	MonitorInterval         time.Duration `json:"monitor_interval"`
	SensorReadInterval      time.Duration `json:"sensor_read_interval"`
	ThermalCheckInterval    time.Duration `json:"thermal_check_interval"`
	VibrationSensitivity    float64       `json:"vibration_sensitivity"`
	DustCheckInterval       time.Duration `json:"dust_check_interval"`
	MaintenanceCheckInterval time.Duration `json:"maintenance_check_interval"`
	DatabasePath            string        `json:"database_path"`
	SensorConfigPath        string        `json:"sensor_config_path"`
	LogLevel                string        `json:"log_level"`
}

// HardwareMetrics provides Prometheus metrics for hardware monitoring
type HardwareMetrics struct {
	Temperature         *prometheus.GaugeVec
	Humidity            *prometheus.GaugeVec
	Pressure            *prometheus.GaugeVec
	Vibration           *prometheus.GaugeVec
	DustLevel           *prometheus.GaugeVec
	FanSpeed            *prometheus.GaugeVec
	PowerConsumption    *prometheus.GaugeVec
	ComponentHealth     *prometheus.GaugeVec
	MaintenanceAlerts   *prometheus.CounterVec
	EnvironmentalAlerts *prometheus.CounterVec
	SystemUptime        prometheus.Gauge
}

// ThermalManager handles thermal management and cooling
type ThermalManager struct {
	hm              *HardwareMonitor
	currentProfile  *ThermalProfile
	profiles        map[string]*ThermalProfile
	fanControllers  map[string]*FanController
	coolingActions  []CoolingAction
}

// FanController controls cooling fans
type FanController struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Type        string `json:"type"` // case, cpu, gpu, auxiliary
	MinSpeed    int    `json:"min_speed"` // RPM
	MaxSpeed    int    `json:"max_speed"` // RPM
	CurrentSpeed int   `json:"current_speed"` // RPM
	TargetSpeed int    `json:"target_speed"` // RPM
	PWMChannel  int    `json:"pwm_channel"`
	Enabled     bool   `json:"enabled"`
}

// CoolingAction represents a cooling action
type CoolingAction struct {
	Type        string                 `json:"type"` // fan_speed, cpu_throttle, gpu_throttle, shutdown
	Parameters  map[string]interface{} `json:"parameters"`
	Condition   string                 `json:"condition"`
	Priority    int                    `json:"priority"`
	Enabled     bool                   `json:"enabled"`
}

// VibrationDetector detects and analyzes vibrations
type VibrationDetector struct {
	hm                *HardwareMonitor
	accelerometer     *Sensor
	gyroscope         *Sensor
	sensitivity       float64
	shockThreshold    float64
	continuousThreshold float64
	periodicThreshold float64
	analysisWindow    time.Duration
	eventHistory      []*VibrationEvent
}

// EnvironmentalMonitor monitors environmental conditions
type EnvironmentalMonitor struct {
	hm                *HardwareMonitor
	weatherStation    *WeatherStation
	airQualitySensor  *Sensor
	dustSensor        *Sensor
	noiseSensor       *Sensor
	lightSensor       *Sensor
	uvSensor          *Sensor
	conditions        *EnvironmentalConditions
}

// WeatherStation represents an integrated weather station
type WeatherStation struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Location        string    `json:"location"`
	Latitude        float64   `json:"latitude"`
	Longitude       float64   `json:"longitude"`
	Altitude        float64   `json:"altitude"`
	LastUpdate      time.Time `json:"last_update"`
	Status          string    `json:"status"`
	Sensors         map[string]*Sensor `json:"sensors"`
}

// DustProtectionSystem manages dust protection and filtration
type DustProtectionSystem struct {
	hm              *HardwareMonitor
	filters         map[string]*DustFilter
	cleaningSystem  *CleaningSystem
	sealingSystem   *SealingSystem
	monitoringSystem *DustMonitoringSystem
}

// DustFilter represents a dust filter
type DustFilter struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Type            string    `json:"type"` // hepa, electrostatic, mechanical
	Location        string    `json:"location"`
	Efficiency      float64   `json:"efficiency"` // %
	Capacity        float64   `json:"capacity"` // g
	CurrentLoad     float64   `json:"current_load"` // g
	Status          string    `json:"status"` // clean, dirty, clogged, needs_replacement
	LastCleaned     time.Time `json:"last_cleaned"`
	LastReplaced    time.Time `json:"last_replaced"`
	ReplacementDue  time.Time `json:"replacement_due"`
}

// CleaningSystem manages automated cleaning
type CleaningSystem struct {
	Type            string    `json:"type"` // compressed_air, vacuum, ultrasonic
	Status          string    `json:"status"`
	LastCleaning    time.Time `json:"last_cleaning"`
	NextCleaning    time.Time `json:"next_cleaning"`
	CleaningCycles  int       `json:"cleaning_cycles"`
	Enabled         bool      `json:"enabled"`
}

// SealingSystem manages enclosure sealing
type SealingSystem struct {
	IPRating        string    `json:"ip_rating"` // IP65, IP67, etc.
	SealStatus      string    `json:"seal_status"`
	PressureTest    float64   `json:"pressure_test"` // Pa
	LastInspection  time.Time `json:"last_inspection"`
	NextInspection  time.Time `json:"next_inspection"`
}

// DustMonitoringSystem monitors dust levels
type DustMonitoringSystem struct {
	PM1Sensor       *Sensor   `json:"pm1_sensor"`
	PM25Sensor      *Sensor   `json:"pm25_sensor"`
	PM10Sensor      *Sensor   `json:"pm10_sensor"`
	LastReading     time.Time `json:"last_reading"`
	AlertThreshold  float64   `json:"alert_threshold"`
}

// AdaptationEngine manages system adaptations based on environmental conditions
type AdaptationEngine struct {
	hm              *HardwareMonitor
	adaptationRules []*AdaptationRule
	currentMode     string
	modes           map[string]*OperationMode
}

// AdaptationRule defines when and how to adapt system behavior
type AdaptationRule struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	Conditions  []AdaptationCondition  `json:"conditions"`
	Actions     []AdaptationAction     `json:"actions"`
	Priority    int                    `json:"priority"`
	Enabled     bool                   `json:"enabled"`
}

// AdaptationCondition defines a condition for system adaptation
type AdaptationCondition struct {
	Parameter string      `json:"parameter"` // temperature, humidity, vibration, etc.
	Operator  string      `json:"operator"`  // gt, lt, eq, gte, lte
	Value     interface{} `json:"value"`
	Duration  int         `json:"duration"` // Condition must be true for this duration (seconds)
}

// AdaptationAction defines an action to take when conditions are met
type AdaptationAction struct {
	Type       string                 `json:"type"` // thermal_profile, power_mode, service_pause, etc.
	Parameters map[string]interface{} `json:"parameters"`
}

// OperationMode represents a system operation mode
type OperationMode struct {
	ID              string                 `json:"id"`
	Name            string                 `json:"name"`
	Description     string                 `json:"description"`
	ThermalProfile  string                 `json:"thermal_profile"`
	PowerProfile    string                 `json:"power_profile"`
	ServiceConfig   map[string]interface{} `json:"service_config"`
	Constraints     map[string]interface{} `json:"constraints"`
	Active          bool                   `json:"active"`
}

// AlertManager manages hardware and environmental alerts
type AlertManager struct {
	hm          *HardwareMonitor
	alerts      map[string]*Alert
	channels    map[string]AlertChannel
	rules       []*AlertRule
}

// Alert represents a hardware or environmental alert
type Alert struct {
	ID          string                 `json:"id"`
	Type        string                 `json:"type"`
	Severity    string                 `json:"severity"`
	Component   string                 `json:"component"`
	Message     string                 `json:"message"`
	Details     map[string]interface{} `json:"details"`
	Actions     []string               `json:"actions"`
	Status      string                 `json:"status"` // active, acknowledged, resolved
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
	ResolvedAt  *time.Time             `json:"resolved_at"`
}

// AlertChannel represents an alert delivery channel
type AlertChannel struct {
	ID      string                 `json:"id"`
	Type    string                 `json:"type"` // email, sms, webhook, local
	Config  map[string]interface{} `json:"config"`
	Enabled bool                   `json:"enabled"`
}

// AlertRule defines when to generate alerts
type AlertRule struct {
	ID         string                `json:"id"`
	Name       string                `json:"name"`
	Conditions []AdaptationCondition `json:"conditions"`
	Severity   string                `json:"severity"`
	Message    string                `json:"message"`
	Channels   []string              `json:"channels"`
	Enabled    bool                  `json:"enabled"`
}

// MaintenanceScheduler manages maintenance scheduling
type MaintenanceScheduler struct {
	hm              *HardwareMonitor
	tasks           map[string]*MaintenanceTask
	schedules       map[string]*MaintenanceSchedule
	predictiveRules []*PredictiveRule
}

// MaintenanceSchedule represents a maintenance schedule
type MaintenanceSchedule struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Type        string    `json:"type"` // time_based, usage_based, condition_based
	Interval    int       `json:"interval"` // hours, cycles, etc.
	Component   string    `json:"component"`
	TaskType    string    `json:"task_type"`
	LastRun     time.Time `json:"last_run"`
	NextRun     time.Time `json:"next_run"`
	Enabled     bool      `json:"enabled"`
}

// PredictiveRule defines predictive maintenance rules
type PredictiveRule struct {
	ID         string                `json:"id"`
	Name       string                `json:"name"`
	Component  string                `json:"component"`
	Conditions []AdaptationCondition `json:"conditions"`
	Prediction string                `json:"prediction"`
	Confidence float64               `json:"confidence"`
	Enabled    bool                  `json:"enabled"`
}

func NewHardwareConfig() *HardwareConfig {
	return &HardwareConfig{
		MonitorInterval:          30 * time.Second,
		SensorReadInterval:       5 * time.Second,
		ThermalCheckInterval:     10 * time.Second,
		VibrationSensitivity:     0.1, // g-force
		DustCheckInterval:        5 * time.Minute,
		MaintenanceCheckInterval: 1 * time.Hour,
		DatabasePath:             "./hardware_monitoring.db",
		SensorConfigPath:         "./sensors.json",
		LogLevel:                 "INFO",
	}
}

func NewHardwareMetrics() *HardwareMetrics {
	return &HardwareMetrics{
		Temperature: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "hardware_temperature_celsius",
			Help: "Hardware temperature in Celsius",
		}, []string{"component", "location"}),
		Humidity: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "hardware_humidity_percent",
			Help: "Humidity percentage",
		}, []string{"location"}),
		Pressure: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "hardware_pressure_hpa",
			Help: "Atmospheric pressure in hPa",
		}, []string{"location"}),
		Vibration: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "hardware_vibration_gforce",
			Help: "Vibration in g-force",
		}, []string{"direction"}),
		DustLevel: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "hardware_dust_level_ugm3",
			Help: "Dust level in µg/m³",
		}, []string{"type"}),
		FanSpeed: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "hardware_fan_speed_rpm",
			Help: "Fan speed in RPM",
		}, []string{"fan"}),
		PowerConsumption: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "hardware_power_consumption_watts",
			Help: "Power consumption in watts",
		}, []string{"component"}),
		ComponentHealth: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "hardware_component_health_score",
			Help: "Component health score (0-100)",
		}, []string{"component"}),
		MaintenanceAlerts: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "hardware_maintenance_alerts_total",
			Help: "Total number of maintenance alerts",
		}, []string{"type", "component"}),
		EnvironmentalAlerts: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "hardware_environmental_alerts_total",
			Help: "Total number of environmental alerts",
		}, []string{"type", "severity"}),
		SystemUptime: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "hardware_system_uptime_seconds",
			Help: "System uptime in seconds",
		}),
	}
}

func NewHardwareMonitor(config *HardwareConfig) (*HardwareMonitor, error) {
	ctx, cancel := context.WithCancel(context.Background())

	hm := &HardwareMonitor{
		config:       config,
		metrics:      NewHardwareMetrics(),
		ctx:          ctx,
		cancel:       cancel,
		shutdownChan: make(chan os.Signal, 1),
		sensors:      make(map[string]*Sensor),
	}

	// Initialize database
	if err := hm.initDatabase(); err != nil {
		return nil, fmt.Errorf("failed to initialize database: %v", err)
	}

	// Initialize components
	hm.thermalManager = NewThermalManager(hm)
	hm.vibrationDetector = NewVibrationDetector(hm)
	hm.environmentalMonitor = NewEnvironmentalMonitor(hm)
	hm.dustProtectionSystem = NewDustProtectionSystem(hm)
	hm.adaptationEngine = NewAdaptationEngine(hm)
	hm.alertManager = NewAlertManager(hm)
	hm.maintenanceScheduler = NewMaintenanceScheduler(hm)

	// Register Prometheus metrics
	prometheus.MustRegister(
		hm.metrics.Temperature,
		hm.metrics.Humidity,
		hm.metrics.Pressure,
		hm.metrics.Vibration,
		hm.metrics.DustLevel,
		hm.metrics.FanSpeed,
		hm.metrics.PowerConsumption,
		hm.metrics.ComponentHealth,
		hm.metrics.MaintenanceAlerts,
		hm.metrics.EnvironmentalAlerts,
		hm.metrics.SystemUptime,
	)

	// Initialize sensors
	hm.initializeSensors()

	// Start monitoring services
	go hm.monitorHardware()
	go hm.thermalManager.manageThermals()
	go hm.vibrationDetector.detectVibrations()
	go hm.environmentalMonitor.monitorEnvironment()
	go hm.dustProtectionSystem.manageDustProtection()
	go hm.adaptationEngine.performAdaptations()
	go hm.maintenanceScheduler.scheduleMaintenanceTasks()

	// Handle graceful shutdown
	signal.Notify(hm.shutdownChan, syscall.SIGINT, syscall.SIGTERM)
	go hm.handleShutdown()

	return hm, nil
}

func (hm *HardwareMonitor) initDatabase() error {
	var err error
	hm.db, err = sql.Open("psycopg2", hm.config.DatabasePath+"?_journal_mode=WAL&_synchronous=FULL&_foreign_keys=ON")
	if err != nil {
		return err
	}

	schema := `
	CREATE TABLE IF NOT EXISTS sensors (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		location TEXT NOT NULL,
		unit TEXT NOT NULL,
		min_value REAL NOT NULL,
		max_value REAL NOT NULL,
		current_value REAL NOT NULL DEFAULT 0,
		previous_value REAL NOT NULL DEFAULT 0,
		threshold TEXT,
		status TEXT NOT NULL DEFAULT 'normal',
		calibration TEXT,
		metadata TEXT,
		enabled BOOLEAN NOT NULL DEFAULT TRUE,
		last_reading DATETIME,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS environmental_conditions (
		id TEXT PRIMARY KEY,
		temperature REAL NOT NULL,
		humidity REAL NOT NULL,
		pressure REAL NOT NULL,
		air_quality REAL NOT NULL DEFAULT 0,
		dust_level REAL NOT NULL DEFAULT 0,
		vibration REAL NOT NULL DEFAULT 0,
		noise REAL NOT NULL DEFAULT 0,
		light_level REAL NOT NULL DEFAULT 0,
		uv_index REAL NOT NULL DEFAULT 0,
		wind_speed REAL NOT NULL DEFAULT 0,
		rainfall REAL NOT NULL DEFAULT 0,
		location TEXT NOT NULL,
		timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS thermal_profiles (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		max_cpu_temp REAL NOT NULL,
		max_gpu_temp REAL NOT NULL,
		max_ambient_temp REAL NOT NULL,
		fan_curve TEXT,
		throttle_temp REAL NOT NULL,
		shutdown_temp REAL NOT NULL,
		cooling_strategy TEXT NOT NULL,
		power_limit_strategy TEXT NOT NULL,
		active BOOLEAN NOT NULL DEFAULT FALSE,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS vibration_events (
		id TEXT PRIMARY KEY,
		type TEXT NOT NULL,
		magnitude REAL NOT NULL,
		duration INTEGER NOT NULL,
		frequency REAL NOT NULL,
		direction TEXT NOT NULL,
		source TEXT NOT NULL,
		severity TEXT NOT NULL,
		actions TEXT,
		metadata TEXT,
		resolved BOOLEAN NOT NULL DEFAULT FALSE,
		resolved_at DATETIME,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS maintenance_tasks (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		priority TEXT NOT NULL,
		component TEXT NOT NULL,
		description TEXT NOT NULL,
		instructions TEXT,
		estimated_time INTEGER NOT NULL,
		required_tools TEXT,
		required_parts TEXT,
		status TEXT NOT NULL DEFAULT 'pending',
		scheduled_at DATETIME NOT NULL,
		completed_at DATETIME,
		metadata TEXT,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	-- Indexes for performance
	CREATE INDEX IF NOT EXISTS idx_sensors_type ON sensors(type);
	CREATE INDEX IF NOT EXISTS idx_sensors_location ON sensors(location);
	CREATE INDEX IF NOT EXISTS idx_environmental_conditions_timestamp ON environmental_conditions(timestamp);
	CREATE INDEX IF NOT EXISTS idx_vibration_events_type ON vibration_events(type);
	CREATE INDEX IF NOT EXISTS idx_maintenance_tasks_status ON maintenance_tasks(status);

	-- Triggers for updated_at
	CREATE TRIGGER IF NOT EXISTS update_sensors_timestamp 
		AFTER UPDATE ON sensors
		BEGIN
			UPDATE sensors SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
		END;

	CREATE TRIGGER IF NOT EXISTS update_thermal_profiles_timestamp 
		AFTER UPDATE ON thermal_profiles
		BEGIN
			UPDATE thermal_profiles SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
		END;

	CREATE TRIGGER IF NOT EXISTS update_maintenance_tasks_timestamp 
		AFTER UPDATE ON maintenance_tasks
		BEGIN
			UPDATE maintenance_tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
		END;
	`

	_, err = hm.db.Exec(schema)
	return err
}

func (hm *HardwareMonitor) initializeSensors() {
	// Initialize default sensors
	sensors := []*Sensor{
		{
			ID:       "cpu_temp",
			Name:     "CPU Temperature",
			Type:     "temperature",
			Location: "cpu",
			Unit:     "°C",
			MinValue: -40,
			MaxValue: 100,
			Threshold: SensorThreshold{
				WarningLow:   0,
				WarningHigh:  70,
				CriticalLow:  -10,
				CriticalHigh: 85,
			},
			Enabled:   true,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		},
		{
			ID:       "gpu_temp",
			Name:     "GPU Temperature",
			Type:     "temperature",
			Location: "gpu",
			Unit:     "°C",
			MinValue: -40,
			MaxValue: 120,
			Threshold: SensorThreshold{
				WarningLow:   0,
				WarningHigh:  80,
				CriticalLow:  -10,
				CriticalHigh: 95,
			},
			Enabled:   true,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		},
		{
			ID:       "ambient_temp",
			Name:     "Ambient Temperature",
			Type:     "temperature",
			Location: "ambient",
			Unit:     "°C",
			MinValue: -40,
			MaxValue: 80,
			Threshold: SensorThreshold{
				WarningLow:   -5,
				WarningHigh:  45,
				CriticalLow:  -20,
				CriticalHigh: 60,
			},
			Enabled:   true,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		},
		{
			ID:       "humidity",
			Name:     "Humidity",
			Type:     "humidity",
			Location: "ambient",
			Unit:     "%",
			MinValue: 0,
			MaxValue: 100,
			Threshold: SensorThreshold{
				WarningLow:   20,
				WarningHigh:  80,
				CriticalLow:  10,
				CriticalHigh: 95,
			},
			Enabled:   true,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		},
		{
			ID:       "accelerometer_x",
			Name:     "Accelerometer X-axis",
			Type:     "accelerometer",
			Location: "case",
			Unit:     "g",
			MinValue: -16,
			MaxValue: 16,
			Threshold: SensorThreshold{
				WarningLow:   -2,
				WarningHigh:  2,
				CriticalLow:  -5,
				CriticalHigh: 5,
			},
			Enabled:   true,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		},
		{
			ID:       "dust_pm25",
			Name:     "PM2.5 Dust Sensor",
			Type:     "dust",
			Location: "intake",
			Unit:     "µg/m³",
			MinValue: 0,
			MaxValue: 1000,
			Threshold: SensorThreshold{
				WarningLow:   0,
				WarningHigh:  35,
				CriticalLow:  0,
				CriticalHigh: 75,
			},
			Enabled:   true,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		},
	}

	for _, sensor := range sensors {
		hm.sensors[sensor.ID] = sensor
		hm.saveSensor(sensor)
	}
}

func (hm *HardwareMonitor) saveSensor(sensor *Sensor) error {
	thresholdJSON, _ := json.Marshal(sensor.Threshold)
	calibrationJSON, _ := json.Marshal(sensor.Calibration)
	metadataJSON, _ := json.Marshal(sensor.Metadata)

	_, err := hm.db.Exec(`
		INSERT OR REPLACE INTO sensors (id, name, type, location, unit, min_value, max_value, current_value, previous_value, threshold, status, calibration, metadata, enabled, last_reading)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, sensor.ID, sensor.Name, sensor.Type, sensor.Location, sensor.Unit, sensor.MinValue, sensor.MaxValue, sensor.CurrentValue, sensor.PreviousValue, string(thresholdJSON), sensor.Status, string(calibrationJSON), string(metadataJSON), sensor.Enabled, sensor.LastReading)

	return err
}

func (hm *HardwareMonitor) monitorHardware() {
	ticker := time.NewTicker(hm.config.MonitorInterval)
	defer ticker.Stop()

	startTime := time.Now()

	for {
		select {
		case <-hm.ctx.Done():
			return
		case <-ticker.C:
			hm.performHardwareMonitoring()
			hm.metrics.SystemUptime.Set(time.Since(startTime).Seconds())
		}
	}
}

func (hm *HardwareMonitor) performHardwareMonitoring() {
	hm.mu.Lock()
	defer hm.mu.Unlock()

	// Read all sensors
	for _, sensor := range hm.sensors {
		if sensor.Enabled {
			hm.readSensor(sensor)
		}
	}

	// Update metrics
	hm.updateMetrics()

	// Check for alerts
	hm.checkAlerts()
}

func (hm *HardwareMonitor) readSensor(sensor *Sensor) {
	var value float64
	var err error

	switch sensor.Type {
	case "temperature":
		value, err = hm.readTemperatureSensor(sensor)
	case "humidity":
		value, err = hm.readHumiditySensor(sensor)
	case "accelerometer":
		value, err = hm.readAccelerometerSensor(sensor)
	case "dust":
		value, err = hm.readDustSensor(sensor)
	default:
		value, err = hm.readGenericSensor(sensor)
	}

	if err != nil {
		log.Printf("Error reading sensor %s: %v", sensor.ID, err)
		sensor.Status = "error"
		return
	}

	// Update sensor values
	sensor.PreviousValue = sensor.CurrentValue
	sensor.CurrentValue = value
	sensor.LastReading = time.Now()

	// Check thresholds
	hm.checkSensorThresholds(sensor)

	// Save sensor data
	hm.saveSensor(sensor)
}

func (hm *HardwareMonitor) readTemperatureSensor(sensor *Sensor) (float64, error) {
	switch sensor.Location {
	case "cpu":
		return hm.readCPUTemperature()
	case "gpu":
		return hm.readGPUTemperature()
	case "ambient":
		return hm.readAmbientTemperature()
	default:
		return 0, fmt.Errorf("unknown temperature sensor location: %s", sensor.Location)
	}
}

func (hm *HardwareMonitor) readCPUTemperature() (float64, error) {
	// Read from /sys/class/thermal/thermal_zone*/temp
	cmd := exec.Command("cat", "/sys/class/thermal/thermal_zone0/temp")
	output, err := cmd.Output()
	if err != nil {
		// Fallback to sensors command
		cmd = exec.Command("sensors", "-u")
		output, err = cmd.Output()
		if err != nil {
			return 25.0, nil // Default safe temperature
		}
		
		// Parse sensors output for CPU temperature
		lines := strings.Split(string(output), "\n")
		for _, line := range lines {
			if strings.Contains(line, "temp1_input") {
				parts := strings.Fields(line)
				if len(parts) >= 2 {
					if temp, err := strconv.ParseFloat(parts[1], 64); err == nil {
						return temp, nil
					}
				}
			}
		}
		return 25.0, nil
	}

	// Parse thermal zone temperature (in millidegrees)
	tempStr := strings.TrimSpace(string(output))
	if tempMillidegrees, err := strconv.ParseFloat(tempStr, 64); err == nil {
		return tempMillidegrees / 1000.0, nil
	}

	return 25.0, nil // Default safe temperature
}

func (hm *HardwareMonitor) readGPUTemperature() (float64, error) {
	// Try nvidia-smi first
	cmd := exec.Command("nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits")
	output, err := cmd.Output()
	if err == nil {
		tempStr := strings.TrimSpace(string(output))
		if temp, err := strconv.ParseFloat(tempStr, 64); err == nil {
			return temp, nil
		}
	}

	// Fallback to sensors command
	cmd = exec.Command("sensors", "-u")
	output, err = cmd.Output()
	if err != nil {
		return 30.0, nil // Default safe temperature
	}

	// Parse for GPU temperature
	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		if strings.Contains(line, "temp1_input") && strings.Contains(strings.ToLower(line), "gpu") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				if temp, err := strconv.ParseFloat(parts[1], 64); err == nil {
					return temp, nil
				}
			}
		}
	}

	return 30.0, nil // Default safe temperature
}

func (hm *HardwareMonitor) readAmbientTemperature() (float64, error) {
	// Try to read from DHT22 or similar sensor
	// For simulation, use CPU temperature + offset
	cpuTemp, _ := hm.readCPUTemperature()
	ambientTemp := cpuTemp - 15.0 // Assume ambient is 15°C cooler than CPU
	
	// Add some realistic variation
	variation := math.Sin(float64(time.Now().Unix())/3600.0) * 5.0 // ±5°C variation over time
	ambientTemp += variation

	// Clamp to reasonable range
	if ambientTemp < -10 {
		ambientTemp = -10
	}
	if ambientTemp > 50 {
		ambientTemp = 50
	}

	return ambientTemp, nil
}

func (hm *HardwareMonitor) readHumiditySensor(sensor *Sensor) (float64, error) {
	// Simulate humidity reading based on temperature and time
	temp, _ := hm.readAmbientTemperature()
	
	// Base humidity calculation
	baseHumidity := 60.0 - (temp-20.0)*2.0 // Lower humidity at higher temperatures
	
	// Add daily variation
	hourOfDay := float64(time.Now().Hour())
	dailyVariation := math.Sin((hourOfDay-6.0)*math.Pi/12.0) * 15.0 // Peak at 6 PM
	
	humidity := baseHumidity + dailyVariation
	
	// Clamp to valid range
	if humidity < 0 {
		humidity = 0
	}
	if humidity > 100 {
		humidity = 100
	}

	return humidity, nil
}

func (hm *HardwareMonitor) readAccelerometerSensor(sensor *Sensor) (float64, error) {
	// Simulate accelerometer reading
	// In a real implementation, this would read from an actual accelerometer
	
	// Base vibration (very low)
	baseVibration := 0.01
	
	// Add random vibration
	randomVibration := (math.Sin(float64(time.Now().UnixNano())/1e9) + 1.0) * 0.05
	
	// Simulate occasional transport vibration
	if time.Now().Second()%30 == 0 {
		randomVibration += 0.5 // Transport vibration
	}

	return baseVibration + randomVibration, nil
}

func (hm *HardwareMonitor) readDustSensor(sensor *Sensor) (float64, error) {
	// Simulate dust sensor reading
	// Base dust level
	baseDust := 10.0 // µg/m³
	
	// Add variation based on time and conditions
	hourOfDay := float64(time.Now().Hour())
	if hourOfDay >= 6 && hourOfDay <= 18 {
		baseDust += 15.0 // Higher during day
	}
	
	// Add random variation
	variation := math.Sin(float64(time.Now().Unix())/300.0) * 5.0
	
	dustLevel := baseDust + variation
	
	// Clamp to valid range
	if dustLevel < 0 {
		dustLevel = 0
	}

	return dustLevel, nil
}

func (hm *HardwareMonitor) readGenericSensor(sensor *Sensor) (float64, error) {
	// Generic sensor reading with simulated data
	// In a real implementation, this would interface with actual hardware
	
	midpoint := (sensor.MinValue + sensor.MaxValue) / 2.0
	range_ := (sensor.MaxValue - sensor.MinValue) / 4.0
	
	// Generate value within normal range
	variation := math.Sin(float64(time.Now().Unix())/60.0) * range_
	value := midpoint + variation
	
	return value, nil
}

func (hm *HardwareMonitor) checkSensorThresholds(sensor *Sensor) {
	value := sensor.CurrentValue
	
	if value <= sensor.Threshold.CriticalLow || value >= sensor.Threshold.CriticalHigh {
		sensor.Status = "critical"
		hm.alertManager.createAlert("sensor_critical", "critical", sensor.ID, 
			fmt.Sprintf("Sensor %s critical: %.2f %s", sensor.Name, value, sensor.Unit), nil)
	} else if value <= sensor.Threshold.WarningLow || value >= sensor.Threshold.WarningHigh {
		sensor.Status = "warning"
		hm.alertManager.createAlert("sensor_warning", "warning", sensor.ID,
			fmt.Sprintf("Sensor %s warning: %.2f %s", sensor.Name, value, sensor.Unit), nil)
	} else {
		sensor.Status = "normal"
	}
}

func (hm *HardwareMonitor) updateMetrics() {
	for _, sensor := range hm.sensors {
		switch sensor.Type {
		case "temperature":
			hm.metrics.Temperature.WithLabelValues(sensor.Location, sensor.Location).Set(sensor.CurrentValue)
		case "humidity":
			hm.metrics.Humidity.WithLabelValues(sensor.Location).Set(sensor.CurrentValue)
		case "accelerometer":
			hm.metrics.Vibration.WithLabelValues(sensor.Location).Set(sensor.CurrentValue)
		case "dust":
			hm.metrics.DustLevel.WithLabelValues(sensor.Location).Set(sensor.CurrentValue)
		}
	}
}

func (hm *HardwareMonitor) checkAlerts() {
	// Check for system-wide alerts
	hm.alertManager.checkAlertRules()
}

// Component implementations

func NewThermalManager(hm *HardwareMonitor) *ThermalManager {
	tm := &ThermalManager{
		hm:             hm,
		profiles:       make(map[string]*ThermalProfile),
		fanControllers: make(map[string]*FanController),
	}

	tm.initializeThermalProfiles()
	tm.initializeFanControllers()
	tm.initializeCoolingActions()

	return tm
}

func (tm *ThermalManager) initializeThermalProfiles() {
	profiles := []*ThermalProfile{
		{
			ID:             "normal",
			Name:           "Normal Operation",
			MaxCPUTemp:     70.0,
			MaxGPUTemp:     80.0,
			MaxAmbientTemp: 40.0,
			FanCurve: []FanPoint{
				{Temperature: 30, FanSpeed: 20},
				{Temperature: 50, FanSpeed: 40},
				{Temperature: 70, FanSpeed: 80},
				{Temperature: 85, FanSpeed: 100},
			},
			ThrottleTemp:       75.0,
			ShutdownTemp:       90.0,
			CoolingStrategy:    "active",
			PowerLimitStrategy: "balanced",
			Active:             true,
			CreatedAt:          time.Now(),
			UpdatedAt:          time.Now(),
		},
		{
			ID:             "high_temp",
			Name:           "High Temperature Environment",
			MaxCPUTemp:     65.0,
			MaxGPUTemp:     75.0,
			MaxAmbientTemp: 50.0,
			FanCurve: []FanPoint{
				{Temperature: 25, FanSpeed: 30},
				{Temperature: 45, FanSpeed: 60},
				{Temperature: 65, FanSpeed: 90},
				{Temperature: 75, FanSpeed: 100},
			},
			ThrottleTemp:       70.0,
			ShutdownTemp:       85.0,
			CoolingStrategy:    "aggressive",
			PowerLimitStrategy: "conservative",
			Active:             false,
			CreatedAt:          time.Now(),
			UpdatedAt:          time.Now(),
		},
	}

	for _, profile := range profiles {
		tm.profiles[profile.ID] = profile
		tm.saveThermalProfile(profile)
	}

	tm.currentProfile = profiles[0]
}

func (tm *ThermalManager) saveThermalProfile(profile *ThermalProfile) error {
	fanCurveJSON, _ := json.Marshal(profile.FanCurve)

	_, err := tm.hm.db.Exec(`
		INSERT OR REPLACE INTO thermal_profiles (id, name, max_cpu_temp, max_gpu_temp, max_ambient_temp, fan_curve, throttle_temp, shutdown_temp, cooling_strategy, power_limit_strategy, active)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, profile.ID, profile.Name, profile.MaxCPUTemp, profile.MaxGPUTemp, profile.MaxAmbientTemp, string(fanCurveJSON), profile.ThrottleTemp, profile.ShutdownTemp, profile.CoolingStrategy, profile.PowerLimitStrategy, profile.Active)

	return err
}

func (tm *ThermalManager) initializeFanControllers() {
	fans := []*FanController{
		{
			ID:          "cpu_fan",
			Name:        "CPU Fan",
			Type:        "cpu",
			MinSpeed:    500,
			MaxSpeed:    3000,
			CurrentSpeed: 1000,
			TargetSpeed: 1000,
			PWMChannel:  1,
			Enabled:     true,
		},
		{
			ID:          "case_fan_1",
			Name:        "Case Fan 1",
			Type:        "case",
			MinSpeed:    300,
			MaxSpeed:    1500,
			CurrentSpeed: 600,
			TargetSpeed: 600,
			PWMChannel:  2,
			Enabled:     true,
		},
	}

	for _, fan := range fans {
		tm.fanControllers[fan.ID] = fan
	}
}

func (tm *ThermalManager) initializeCoolingActions() {
	tm.coolingActions = []CoolingAction{
		{
			Type: "fan_speed",
			Parameters: map[string]interface{}{
				"increase_percentage": 20,
			},
			Condition: "temperature > warning_threshold",
			Priority:  1,
			Enabled:   true,
		},
		{
			Type: "cpu_throttle",
			Parameters: map[string]interface{}{
				"throttle_percentage": 10,
			},
			Condition: "cpu_temperature > throttle_threshold",
			Priority:  2,
			Enabled:   true,
		},
		{
			Type: "shutdown",
			Parameters: map[string]interface{}{
				"delay_seconds": 30,
			},
			Condition: "temperature > shutdown_threshold",
			Priority:  10,
			Enabled:   true,
		},
	}
}

func (tm *ThermalManager) manageThermals() {
	ticker := time.NewTicker(tm.hm.config.ThermalCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-tm.hm.ctx.Done():
			return
		case <-ticker.C:
			tm.performThermalManagement()
		}
	}
}

func (tm *ThermalManager) performThermalManagement() {
	// Get current temperatures
	cpuTemp := tm.hm.sensors["cpu_temp"].CurrentValue
	gpuTemp := tm.hm.sensors["gpu_temp"].CurrentValue
	ambientTemp := tm.hm.sensors["ambient_temp"].CurrentValue

	// Check if thermal profile needs to be changed
	tm.checkThermalProfileAdaptation(cpuTemp, gpuTemp, ambientTemp)

	// Update fan speeds based on current profile
	tm.updateFanSpeeds(cpuTemp, gpuTemp, ambientTemp)

	// Check for thermal throttling
	tm.checkThermalThrottling(cpuTemp, gpuTemp)

	// Check for emergency shutdown
	tm.checkEmergencyShutdown(cpuTemp, gpuTemp, ambientTemp)
}

func (tm *ThermalManager) checkThermalProfileAdaptation(cpuTemp, gpuTemp, ambientTemp float64) {
	maxTemp := math.Max(cpuTemp, math.Max(gpuTemp, ambientTemp))

	if maxTemp > 50.0 && tm.currentProfile.ID != "high_temp" {
		// Switch to high temperature profile
		if profile, exists := tm.profiles["high_temp"]; exists {
			tm.currentProfile = profile
			log.Println("Switched to high temperature thermal profile")
		}
	} else if maxTemp < 40.0 && tm.currentProfile.ID != "normal" {
		// Switch back to normal profile
		if profile, exists := tm.profiles["normal"]; exists {
			tm.currentProfile = profile
			log.Println("Switched to normal thermal profile")
		}
	}
}

func (tm *ThermalManager) updateFanSpeeds(cpuTemp, gpuTemp, ambientTemp float64) {
	maxTemp := math.Max(cpuTemp, gpuTemp)

	// Calculate target fan speed based on fan curve
	targetSpeed := tm.calculateFanSpeed(maxTemp)

	// Update all fan controllers
	for _, fan := range tm.fanControllers {
		if fan.Enabled {
			fan.TargetSpeed = targetSpeed
			tm.setFanSpeed(fan)
		}
	}
}

func (tm *ThermalManager) calculateFanSpeed(temperature float64) int {
	fanCurve := tm.currentProfile.FanCurve
	
	if len(fanCurve) == 0 {
		return 50 // Default 50% speed
	}

	// Find the appropriate fan speed based on temperature
	for i, point := range fanCurve {
		if temperature <= point.Temperature {
			if i == 0 {
				return point.FanSpeed
			}
			
			// Linear interpolation between points
			prevPoint := fanCurve[i-1]
			tempRange := point.Temperature - prevPoint.Temperature
			speedRange := point.FanSpeed - prevPoint.FanSpeed
			tempOffset := temperature - prevPoint.Temperature
			
			interpolatedSpeed := prevPoint.FanSpeed + int(float64(speedRange)*(tempOffset/tempRange))
			return interpolatedSpeed
		}
	}

	// Temperature is higher than the highest point in the curve
	return fanCurve[len(fanCurve)-1].FanSpeed
}

func (tm *ThermalManager) setFanSpeed(fan *FanController) {
	// In a real implementation, this would control actual fan hardware
	// For now, just update the current speed
	fan.CurrentSpeed = fan.TargetSpeed
	
	// Update metrics
	tm.hm.metrics.FanSpeed.WithLabelValues(fan.ID).Set(float64(fan.CurrentSpeed))
	
	log.Printf("Set fan %s speed to %d RPM", fan.Name, fan.CurrentSpeed)
}

func (tm *ThermalManager) checkThermalThrottling(cpuTemp, gpuTemp float64) {
	if cpuTemp > tm.currentProfile.ThrottleTemp {
		log.Printf("CPU thermal throttling activated at %.1f°C", cpuTemp)
		// In a real implementation, this would throttle the CPU
	}
	
	if gpuTemp > tm.currentProfile.ThrottleTemp {
		log.Printf("GPU thermal throttling activated at %.1f°C", gpuTemp)
		// In a real implementation, this would throttle the GPU
	}
}

func (tm *ThermalManager) checkEmergencyShutdown(cpuTemp, gpuTemp, ambientTemp float64) {
	maxTemp := math.Max(cpuTemp, math.Max(gpuTemp, ambientTemp))
	
	if maxTemp > tm.currentProfile.ShutdownTemp {
		log.Printf("Emergency thermal shutdown triggered at %.1f°C", maxTemp)
		tm.hm.alertManager.createAlert("thermal_emergency", "critical", "system",
			fmt.Sprintf("Emergency thermal shutdown at %.1f°C", maxTemp), nil)
		
		// In a real implementation, this would initiate system shutdown
		// For now, just log the event
	}
}

// Additional component implementations would continue here...
// For brevity, I'll include the key methods for other components

func NewVibrationDetector(hm *HardwareMonitor) *VibrationDetector {
	return &VibrationDetector{
		hm:                  hm,
		sensitivity:         hm.config.VibrationSensitivity,
		shockThreshold:      2.0,  // g-force
		continuousThreshold: 0.5,  // g-force
		periodicThreshold:   1.0,  // g-force
		analysisWindow:      5 * time.Second,
		eventHistory:        []*VibrationEvent{},
	}
}

func (vd *VibrationDetector) detectVibrations() {
	ticker := time.NewTicker(100 * time.Millisecond) // 10Hz sampling
	defer ticker.Stop()

	for {
		select {
		case <-vd.hm.ctx.Done():
			return
		case <-ticker.C:
			vd.analyzeVibration()
		}
	}
}

func (vd *VibrationDetector) analyzeVibration() {
	// Get accelerometer readings
	accelX := vd.hm.sensors["accelerometer_x"].CurrentValue
	
	// Calculate magnitude
	magnitude := math.Abs(accelX)
	
	// Detect different types of vibration
	if magnitude > vd.shockThreshold {
		vd.handleShockEvent(magnitude)
	} else if magnitude > vd.continuousThreshold {
		vd.handleContinuousVibration(magnitude)
	}
}

func (vd *VibrationDetector) handleShockEvent(magnitude float64) {
	event := &VibrationEvent{
		ID:        uuid.New().String(),
		Type:      "shock",
		Magnitude: magnitude,
		Duration:  100, // milliseconds
		Direction: "x",
		Source:    "external",
		Severity:  vd.calculateSeverity(magnitude),
		Actions:   []string{"logged"},
		CreatedAt: time.Now(),
	}

	vd.saveVibrationEvent(event)
	log.Printf("Shock event detected: %.2f g-force", magnitude)
}

func (vd *VibrationDetector) handleContinuousVibration(magnitude float64) {
	// Log continuous vibration
	log.Printf("Continuous vibration: %.2f g-force", magnitude)
}

func (vd *VibrationDetector) calculateSeverity(magnitude float64) string {
	if magnitude > 5.0 {
		return "critical"
	} else if magnitude > 2.0 {
		return "high"
	} else if magnitude > 1.0 {
		return "medium"
	}
	return "low"
}

func (vd *VibrationDetector) saveVibrationEvent(event *VibrationEvent) error {
	actionsJSON, _ := json.Marshal(event.Actions)
	metadataJSON, _ := json.Marshal(event.Metadata)

	_, err := vd.hm.db.Exec(`
		INSERT INTO vibration_events (id, type, magnitude, duration, frequency, direction, source, severity, actions, metadata, resolved, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, event.ID, event.Type, event.Magnitude, event.Duration, event.Frequency, event.Direction, event.Source, event.Severity, string(actionsJSON), string(metadataJSON), event.Resolved, event.CreatedAt)

	return err
}

func NewEnvironmentalMonitor(hm *HardwareMonitor) *EnvironmentalMonitor {
	return &EnvironmentalMonitor{
		hm: hm,
		conditions: &EnvironmentalConditions{
			Location: "primary",
		},
	}
}

func (em *EnvironmentalMonitor) monitorEnvironment() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-em.hm.ctx.Done():
			return
		case <-ticker.C:
			em.updateEnvironmentalConditions()
		}
	}
}

func (em *EnvironmentalMonitor) updateEnvironmentalConditions() {
	em.conditions.ID = uuid.New().String()
	em.conditions.Temperature = em.hm.sensors["ambient_temp"].CurrentValue
	em.conditions.Humidity = em.hm.sensors["humidity"].CurrentValue
	em.conditions.DustLevel = em.hm.sensors["dust_pm25"].CurrentValue
	em.conditions.Vibration = em.hm.sensors["accelerometer_x"].CurrentValue
	em.conditions.Timestamp = time.Now()

	// Simulate other environmental readings
	em.conditions.Pressure = 1013.25 + math.Sin(float64(time.Now().Unix())/3600.0)*10.0
	em.conditions.AirQuality = 50 + math.Sin(float64(time.Now().Unix())/7200.0)*20.0
	em.conditions.Noise = 40 + math.Sin(float64(time.Now().Unix())/1800.0)*15.0
	em.conditions.LightLevel = math.Max(0, 500+math.Sin(float64(time.Now().Hour()-12)*math.Pi/12.0)*400)

	em.saveEnvironmentalConditions()
}

func (em *EnvironmentalMonitor) saveEnvironmentalConditions() error {
	_, err := em.hm.db.Exec(`
		INSERT INTO environmental_conditions (id, temperature, humidity, pressure, air_quality, dust_level, vibration, noise, light_level, uv_index, wind_speed, rainfall, location, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, em.conditions.ID, em.conditions.Temperature, em.conditions.Humidity, em.conditions.Pressure, em.conditions.AirQuality, em.conditions.DustLevel, em.conditions.Vibration, em.conditions.Noise, em.conditions.LightLevel, em.conditions.UVIndex, em.conditions.WindSpeed, em.conditions.Rainfall, em.conditions.Location, em.conditions.Timestamp)

	return err
}

func NewDustProtectionSystem(hm *HardwareMonitor) *DustProtectionSystem {
	return &DustProtectionSystem{
		hm:      hm,
		filters: make(map[string]*DustFilter),
	}
}

func (dps *DustProtectionSystem) manageDustProtection() {
	ticker := time.NewTicker(dps.hm.config.DustCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-dps.hm.ctx.Done():
			return
		case <-ticker.C:
			dps.checkDustLevels()
		}
	}
}

func (dps *DustProtectionSystem) checkDustLevels() {
	dustLevel := dps.hm.sensors["dust_pm25"].CurrentValue
	
	if dustLevel > 75.0 {
		log.Printf("High dust level detected: %.1f µg/m³", dustLevel)
		dps.hm.alertManager.createAlert("high_dust", "warning", "dust_sensor",
			fmt.Sprintf("High dust level: %.1f µg/m³", dustLevel), nil)
	}
}

func NewAdaptationEngine(hm *HardwareMonitor) *AdaptationEngine {
	return &AdaptationEngine{
		hm:          hm,
		currentMode: "normal",
		modes:       make(map[string]*OperationMode),
	}
}

func (ae *AdaptationEngine) performAdaptations() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ae.hm.ctx.Done():
			return
		case <-ticker.C:
			ae.checkAdaptationRules()
		}
	}
}

func (ae *AdaptationEngine) checkAdaptationRules() {
	// Check environmental conditions and adapt system behavior
	temp := ae.hm.sensors["ambient_temp"].CurrentValue
	humidity := ae.hm.sensors["humidity"].CurrentValue
	
	if temp > 45.0 || humidity > 85.0 {
		log.Println("Adapting to harsh environmental conditions")
		// In a real implementation, this would adjust system parameters
	}
}

func NewAlertManager(hm *HardwareMonitor) *AlertManager {
	return &AlertManager{
		hm:       hm,
		alerts:   make(map[string]*Alert),
		channels: make(map[string]AlertChannel),
		rules:    []*AlertRule{},
	}
}

func (am *AlertManager) createAlert(alertType, severity, component, message string, details map[string]interface{}) {
	alert := &Alert{
		ID:        uuid.New().String(),
		Type:      alertType,
		Severity:  severity,
		Component: component,
		Message:   message,
		Details:   details,
		Status:    "active",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	am.alerts[alert.ID] = alert
	log.Printf("Alert created: %s - %s", alert.Severity, alert.Message)

	// Update metrics
	am.hm.metrics.EnvironmentalAlerts.WithLabelValues(alertType, severity).Inc()
}

func (am *AlertManager) checkAlertRules() {
	// Check alert rules and generate alerts as needed
	// This would contain the logic for evaluating alert conditions
}

func NewMaintenanceScheduler(hm *HardwareMonitor) *MaintenanceScheduler {
	return &MaintenanceScheduler{
		hm:    hm,
		tasks: make(map[string]*MaintenanceTask),
	}
}

func (ms *MaintenanceScheduler) scheduleMaintenanceTasks() {
	ticker := time.NewTicker(ms.hm.config.MaintenanceCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ms.hm.ctx.Done():
			return
		case <-ticker.C:
			ms.checkMaintenanceSchedule()
		}
	}
}

func (ms *MaintenanceScheduler) checkMaintenanceSchedule() {
	// Check for due maintenance tasks
	log.Println("Checking maintenance schedule")
}

// handleShutdown handles graceful shutdown
func (hm *HardwareMonitor) handleShutdown() {
	<-hm.shutdownChan
	log.Println("Hardware monitor shutdown signal received")

	// Cancel context to stop all goroutines
	hm.cancel()

	// Close database
	if hm.db != nil {
		hm.db.Close()
	}

	log.Println("Hardware monitor shutdown completed")
	os.Exit(0)
}

// REST API Handlers

func (hm *HardwareMonitor) setupRoutes() *gin.Engine {
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
		// Sensors
		api.GET("/hardware/sensors", hm.getSensorsHandler)
		api.GET("/hardware/sensors/:id", hm.getSensorHandler)

		// Environmental conditions
		api.GET("/hardware/environment", hm.getEnvironmentalConditionsHandler)

		// Thermal management
		api.GET("/hardware/thermal/profiles", hm.getThermalProfilesHandler)
		api.PUT("/hardware/thermal/profiles/:id", hm.updateThermalProfileHandler)

		// Vibration events
		api.GET("/hardware/vibration/events", hm.getVibrationEventsHandler)

		// Maintenance tasks
		api.GET("/hardware/maintenance/tasks", hm.getMaintenanceTasksHandler)

		// System status
		api.GET("/hardware/status", hm.getHardwareStatusHandler)
	}

	return router
}

func (hm *HardwareMonitor) getSensorsHandler(c *gin.Context) {
	hm.mu.RLock()
	sensors := make([]*Sensor, 0, len(hm.sensors))
	for _, sensor := range hm.sensors {
		sensors = append(sensors, sensor)
	}
	hm.mu.RUnlock()

	c.JSON(http.StatusOK, gin.H{"sensors": sensors})
}

func (hm *HardwareMonitor) getSensorHandler(c *gin.Context) {
	sensorID := c.Param("id")
	
	hm.mu.RLock()
	sensor, exists := hm.sensors[sensorID]
	hm.mu.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Sensor not found"})
		return
	}

	c.JSON(http.StatusOK, sensor)
}

func (hm *HardwareMonitor) getEnvironmentalConditionsHandler(c *gin.Context) {
	c.JSON(http.StatusOK, hm.environmentalMonitor.conditions)
}

func (hm *HardwareMonitor) getThermalProfilesHandler(c *gin.Context) {
	profiles := make([]*ThermalProfile, 0, len(hm.thermalManager.profiles))
	for _, profile := range hm.thermalManager.profiles {
		profiles = append(profiles, profile)
	}

	c.JSON(http.StatusOK, gin.H{"profiles": profiles})
}

func (hm *HardwareMonitor) updateThermalProfileHandler(c *gin.Context) {
	profileID := c.Param("id")
	
	profile, exists := hm.thermalManager.profiles[profileID]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Thermal profile not found"})
		return
	}

	if err := c.ShouldBindJSON(profile); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	profile.UpdatedAt = time.Now()
	hm.thermalManager.saveThermalProfile(profile)

	c.JSON(http.StatusOK, profile)
}

func (hm *HardwareMonitor) getVibrationEventsHandler(c *gin.Context) {
	limit := 50
	if l := c.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil {
			limit = parsed
		}
	}

	rows, err := hm.db.Query(`
		SELECT id, type, magnitude, duration, direction, severity, created_at
		FROM vibration_events 
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
			&event["id"], &event["type"], &event["magnitude"],
			&event["duration"], &event["direction"], &event["severity"],
			&event["created_at"],
		)
		if err != nil {
			continue
		}
		events = append(events, event)
	}

	c.JSON(http.StatusOK, gin.H{"events": events})
}

func (hm *HardwareMonitor) getMaintenanceTasksHandler(c *gin.Context) {
	rows, err := hm.db.Query(`
		SELECT id, name, type, priority, component, status, scheduled_at, created_at
		FROM maintenance_tasks 
		ORDER BY scheduled_at ASC
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var tasks []map[string]interface{}
	for rows.Next() {
		var task map[string]interface{} = make(map[string]interface{})
		err := rows.Scan(
			&task["id"], &task["name"], &task["type"], &task["priority"],
			&task["component"], &task["status"], &task["scheduled_at"],
			&task["created_at"],
		)
		if err != nil {
			continue
		}
		tasks = append(tasks, task)
	}

	c.JSON(http.StatusOK, gin.H{"tasks": tasks})
}

func (hm *HardwareMonitor) getHardwareStatusHandler(c *gin.Context) {
	status := gin.H{
		"sensors":              len(hm.sensors),
		"thermal_profile":      hm.thermalManager.currentProfile.Name,
		"environmental":        hm.environmentalMonitor.conditions,
		"active_alerts":        len(hm.alertManager.alerts),
		"system_uptime":        time.Since(time.Now().Add(-time.Duration(hm.metrics.SystemUptime.Get())*time.Second)),
		"timestamp":            time.Now(),
	}

	c.JSON(http.StatusOK, status)
}

func main() {
	log.Println("Starting Hardware Monitoring and Environmental Adaptation System...")

	config := NewHardwareConfig()
	
	// Load configuration from environment
	if dbPath := os.Getenv("HARDWARE_DATABASE_PATH"); dbPath != "" {
		config.DatabasePath = dbPath
	}
	if monitorInterval := os.Getenv("HARDWARE_MONITOR_INTERVAL"); monitorInterval != "" {
		if duration, err := time.ParseDuration(monitorInterval); err == nil {
			config.MonitorInterval = duration
		}
	}

	hm, err := NewHardwareMonitor(config)
	if err != nil {
		log.Fatalf("Failed to create hardware monitor: %v", err)
	}

	router := hm.setupRoutes()
	
	port := os.Getenv("PORT")
	if port == "" {
		port = "8086"
	}

	log.Printf("Hardware Monitoring and Environmental Adaptation System started on port %s", port)
	log.Printf("Database: %s", config.DatabasePath)
	log.Printf("Monitor Interval: %v", config.MonitorInterval)

	if err := router.Run("0.0.0.0:" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

