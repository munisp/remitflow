package memorymanager

import (
    "context"
    "fmt"
    "runtime"
    "runtime/debug"
    "sync"
    "time"
)

// MemoryManager manages memory usage and garbage collection
type MemoryManager struct {
    config          MemoryConfig
    stats           MemoryStats
    statsMutex      sync.RWMutex
    gcTicker        *time.Ticker
    monitorTicker   *time.Ticker
    ctx             context.Context
    cancel          context.CancelFunc
    alertHandlers   []AlertHandler
    alertMutex      sync.RWMutex
}

// MemoryConfig holds memory management configuration
type MemoryConfig struct {
    MaxHeapSize        uint64        // Maximum heap size in bytes
    GCTargetPercent    int           // GC target percentage
    GCInterval         time.Duration // Forced GC interval
    MonitorInterval    time.Duration // Memory monitoring interval
    AlertThreshold     float64       // Alert threshold (0.0-1.0)
    EnableAutoGC       bool          // Enable automatic GC tuning
    EnableMemoryLimit  bool          // Enable memory limit enforcement
}

// MemoryStats holds memory statistics
type MemoryStats struct {
    HeapAlloc      uint64    // Bytes allocated on heap
    HeapSys        uint64    // Bytes obtained from system
    HeapIdle       uint64    // Bytes in idle spans
    HeapInuse      uint64    // Bytes in in-use spans
    HeapReleased   uint64    // Bytes released to OS
    HeapObjects    uint64    // Number of allocated objects
    StackInuse     uint64    // Bytes in stack spans
    StackSys       uint64    // Bytes obtained from system for stack
    MSpanInuse     uint64    // Bytes in mspan structures
    MSpanSys       uint64    // Bytes obtained from system for mspan
    MCacheInuse    uint64    // Bytes in mcache structures
    MCacheSys      uint64    // Bytes obtained from system for mcache
    GCSys          uint64    // Bytes used for GC metadata
    OtherSys       uint64    // Other system bytes
    NextGC         uint64    // Next GC target heap size
    LastGC         time.Time // Time of last GC
    NumGC          uint32    // Number of GC cycles
    GCCPUFraction  float64   // Fraction of CPU time used by GC
    LastUpdate     time.Time // Last stats update time
}

// AlertHandler handles memory alerts
type AlertHandler func(alert MemoryAlert)

// MemoryAlert represents a memory alert
type MemoryAlert struct {
    Type        AlertType
    Message     string
    Severity    AlertSeverity
    Timestamp   time.Time
    Stats       MemoryStats
    Threshold   float64
    CurrentUsage float64
}

// AlertType represents the type of memory alert
type AlertType int

const (
    AlertTypeHighUsage AlertType = iota
    AlertTypeMemoryLeak
    AlertTypeGCPressure
    AlertTypeOOM
)

// AlertSeverity represents the severity of an alert
type AlertSeverity int

const (
    AlertSeverityInfo AlertSeverity = iota
    AlertSeverityWarning
    AlertSeverityError
    AlertSeverityCritical
)

// NewMemoryManager creates a new memory manager
func NewMemoryManager(config MemoryConfig) *MemoryManager {
    // Set defaults
    if config.GCTargetPercent == 0 {
        config.GCTargetPercent = 100
    }
    if config.GCInterval == 0 {
        config.GCInterval = 2 * time.Minute
    }
    if config.MonitorInterval == 0 {
        config.MonitorInterval = 10 * time.Second
    }
    if config.AlertThreshold == 0 {
        config.AlertThreshold = 0.8 // 80%
    }
    
    ctx, cancel := context.WithCancel(context.Background())
    
    mm := &MemoryManager{
        config: config,
        ctx:    ctx,
        cancel: cancel,
    }
    
    // Configure GC
    debug.SetGCPercent(config.GCTargetPercent)
    
    // Set memory limit if enabled
    if config.EnableMemoryLimit && config.MaxHeapSize > 0 {
        debug.SetMemoryLimit(int64(config.MaxHeapSize))
    }
    
    // Start monitoring
    mm.startMonitoring()
    
    return mm
}

// startMonitoring starts memory monitoring routines
func (mm *MemoryManager) startMonitoring() {
    // Start memory monitoring
    mm.monitorTicker = time.NewTicker(mm.config.MonitorInterval)
    go mm.monitorRoutine()
    
    // Start GC routine if auto GC is enabled
    if mm.config.EnableAutoGC {
        mm.gcTicker = time.NewTicker(mm.config.GCInterval)
        go mm.gcRoutine()
    }
}

// monitorRoutine monitors memory usage
func (mm *MemoryManager) monitorRoutine() {
    for {
        select {
        case <-mm.ctx.Done():
            return
        case <-mm.monitorTicker.C:
            mm.updateStats()
            mm.checkAlerts()
        }
    }
}

// gcRoutine performs periodic garbage collection
func (mm *MemoryManager) gcRoutine() {
    for {
        select {
        case <-mm.ctx.Done():
            return
        case <-mm.gcTicker.C:
            mm.performGC()
        }
    }
}

// updateStats updates memory statistics
func (mm *MemoryManager) updateStats() {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    
    mm.statsMutex.Lock()
    defer mm.statsMutex.Unlock()
    
    mm.stats = MemoryStats{
        HeapAlloc:     m.HeapAlloc,
        HeapSys:       m.HeapSys,
        HeapIdle:      m.HeapIdle,
        HeapInuse:     m.HeapInuse,
        HeapReleased:  m.HeapReleased,
        HeapObjects:   m.HeapObjects,
        StackInuse:    m.StackInuse,
        StackSys:      m.StackSys,
        MSpanInuse:    m.MSpanInuse,
        MSpanSys:      m.MSpanSys,
        MCacheInuse:   m.MCacheInuse,
        MCacheSys:     m.MCacheSys,
        GCSys:         m.GCSys,
        OtherSys:      m.OtherSys,
        NextGC:        m.NextGC,
        LastGC:        time.Unix(0, int64(m.LastGC)),
        NumGC:         m.NumGC,
        GCCPUFraction: m.GCCPUFraction,
        LastUpdate:    time.Now(),
    }
}

// checkAlerts checks for memory alerts
func (mm *MemoryManager) checkAlerts() {
    stats := mm.GetStats()
    
    // Check heap usage
    if mm.config.MaxHeapSize > 0 {
        usage := float64(stats.HeapAlloc) / float64(mm.config.MaxHeapSize)
        if usage > mm.config.AlertThreshold {
            alert := MemoryAlert{
                Type:         AlertTypeHighUsage,
                Message:      fmt.Sprintf("High memory usage: %.2f%%", usage*100),
                Severity:     mm.getSeverity(usage),
                Timestamp:    time.Now(),
                Stats:        stats,
                Threshold:    mm.config.AlertThreshold,
                CurrentUsage: usage,
            }
            mm.sendAlert(alert)
        }
    }
    
    // Check for potential memory leaks
    if stats.HeapObjects > 1000000 { // More than 1M objects
        alert := MemoryAlert{
            Type:      AlertTypeMemoryLeak,
            Message:   fmt.Sprintf("High object count: %d", stats.HeapObjects),
            Severity:  AlertSeverityWarning,
            Timestamp: time.Now(),
            Stats:     stats,
        }
        mm.sendAlert(alert)
    }
    
    // Check GC pressure
    if stats.GCCPUFraction > 0.1 { // More than 10% CPU time in GC
        alert := MemoryAlert{
            Type:      AlertTypeGCPressure,
            Message:   fmt.Sprintf("High GC pressure: %.2f%% CPU", stats.GCCPUFraction*100),
            Severity:  AlertSeverityWarning,
            Timestamp: time.Now(),
            Stats:     stats,
        }
        mm.sendAlert(alert)
    }
}

// getSeverity determines alert severity based on usage
func (mm *MemoryManager) getSeverity(usage float64) AlertSeverity {
    if usage > 0.95 {
        return AlertSeverityCritical
    } else if usage > 0.9 {
        return AlertSeverityError
    } else if usage > 0.8 {
        return AlertSeverityWarning
    }
    return AlertSeverityInfo
}

// sendAlert sends an alert to all handlers
func (mm *MemoryManager) sendAlert(alert MemoryAlert) {
    mm.alertMutex.RLock()
    defer mm.alertMutex.RUnlock()
    
    for _, handler := range mm.alertHandlers {
        go handler(alert)
    }
}

// performGC performs garbage collection with optimization
func (mm *MemoryManager) performGC() {
    start := time.Now()
    
    // Force GC
    runtime.GC()
    
    // Return memory to OS
    debug.FreeOSMemory()
    
    duration := time.Since(start)
    
    // Log GC performance (in production, use proper logging)
    fmt.Printf("GC completed in %v\n", duration)
}

// GetStats returns current memory statistics
func (mm *MemoryManager) GetStats() MemoryStats {
    mm.statsMutex.RLock()
    defer mm.statsMutex.RUnlock()
    return mm.stats
}

// AddAlertHandler adds an alert handler
func (mm *MemoryManager) AddAlertHandler(handler AlertHandler) {
    mm.alertMutex.Lock()
    defer mm.alertMutex.Unlock()
    mm.alertHandlers = append(mm.alertHandlers, handler)
}

// OptimizeForLowMemory optimizes settings for low memory environments
func (mm *MemoryManager) OptimizeForLowMemory() {
    debug.SetGCPercent(50) // More aggressive GC
    mm.config.GCInterval = 30 * time.Second
    mm.config.AlertThreshold = 0.7
    
    // Restart tickers with new intervals
    if mm.gcTicker != nil {
        mm.gcTicker.Stop()
        mm.gcTicker = time.NewTicker(mm.config.GCInterval)
    }
}

// OptimizeForHighThroughput optimizes settings for high throughput
func (mm *MemoryManager) OptimizeForHighThroughput() {
    debug.SetGCPercent(200) // Less aggressive GC
    mm.config.GCInterval = 5 * time.Minute
    mm.config.AlertThreshold = 0.9
    
    // Restart tickers with new intervals
    if mm.gcTicker != nil {
        mm.gcTicker.Stop()
        mm.gcTicker = time.NewTicker(mm.config.GCInterval)
    }
}

// ForceGC forces immediate garbage collection
func (mm *MemoryManager) ForceGC() {
    mm.performGC()
}

// GetMemoryUsagePercent returns memory usage as a percentage
func (mm *MemoryManager) GetMemoryUsagePercent() float64 {
    if mm.config.MaxHeapSize == 0 {
        return 0
    }
    
    stats := mm.GetStats()
    return float64(stats.HeapAlloc) / float64(mm.config.MaxHeapSize)
}

// IsMemoryPressure returns true if under memory pressure
func (mm *MemoryManager) IsMemoryPressure() bool {
    return mm.GetMemoryUsagePercent() > mm.config.AlertThreshold
}

// Shutdown shuts down the memory manager
func (mm *MemoryManager) Shutdown() {
    mm.cancel()
    
    if mm.monitorTicker != nil {
        mm.monitorTicker.Stop()
    }
    
    if mm.gcTicker != nil {
        mm.gcTicker.Stop()
    }
    
    // Final GC
    mm.performGC()
}

// String methods for enums
func (at AlertType) String() string {
    switch at {
    case AlertTypeHighUsage:
        return "high_usage"
    case AlertTypeMemoryLeak:
        return "memory_leak"
    case AlertTypeGCPressure:
        return "gc_pressure"
    case AlertTypeOOM:
        return "out_of_memory"
    default:
        return fmt.Sprintf("unknown(%d)", int(at))
    }
}

func (as AlertSeverity) String() string {
    switch as {
    case AlertSeverityInfo:
        return "info"
    case AlertSeverityWarning:
        return "warning"
    case AlertSeverityError:
        return "error"
    case AlertSeverityCritical:
        return "critical"
    default:
        return fmt.Sprintf("unknown(%d)", int(as))
    }
}
