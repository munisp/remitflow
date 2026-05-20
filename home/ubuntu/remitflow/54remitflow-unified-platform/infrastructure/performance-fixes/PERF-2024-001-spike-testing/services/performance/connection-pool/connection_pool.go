package connectionpool

import (
    "context"
    "database/sql"
    "fmt"
    "sync"
    "time"
    
    _ "github.com/lib/pq"
)

// ConnectionPool manages database connections with optimization
type ConnectionPool struct {
    db                *sql.DB
    maxOpenConns      int
    maxIdleConns      int
    connMaxLifetime   time.Duration
    connMaxIdleTime   time.Duration
    healthCheckQuery  string
    healthCheckPeriod time.Duration
    
    mutex       sync.RWMutex
    stats       PoolStats
    isHealthy   bool
    lastCheck   time.Time
}

// PoolStats holds connection pool statistics
type PoolStats struct {
    OpenConnections     int
    InUseConnections    int
    IdleConnections     int
    WaitCount           int64
    WaitDuration        time.Duration
    MaxIdleClosed       int64
    MaxLifetimeClosed   int64
    MaxOpenConnections  int
    MaxIdleConnections  int
}

// PoolConfig holds connection pool configuration
type PoolConfig struct {
    DatabaseURL       string
    MaxOpenConns      int
    MaxIdleConns      int
    ConnMaxLifetime   time.Duration
    ConnMaxIdleTime   time.Duration
    HealthCheckQuery  string
    HealthCheckPeriod time.Duration
}

// NewConnectionPool creates a new optimized connection pool
func NewConnectionPool(config PoolConfig) (*ConnectionPool, error) {
    db, err := sql.Open("postgres", config.DatabaseURL)
    if err != nil {
        return nil, fmt.Errorf("failed to open database: %w", err)
    }
    
    // Set default values if not provided
    if config.MaxOpenConns == 0 {
        config.MaxOpenConns = 100 // Increased from default 25
    }
    if config.MaxIdleConns == 0 {
        config.MaxIdleConns = 25 // Increased from default 2
    }
    if config.ConnMaxLifetime == 0 {
        config.ConnMaxLifetime = 5 * time.Minute
    }
    if config.ConnMaxIdleTime == 0 {
        config.ConnMaxIdleTime = 5 * time.Minute
    }
    if config.HealthCheckQuery == "" {
        config.HealthCheckQuery = "SELECT 1"
    }
    if config.HealthCheckPeriod == 0 {
        config.HealthCheckPeriod = 30 * time.Second
    }
    
    // Configure connection pool
    db.SetMaxOpenConns(config.MaxOpenConns)
    db.SetMaxIdleConns(config.MaxIdleConns)
    db.SetConnMaxLifetime(config.ConnMaxLifetime)
    db.SetConnMaxIdleTime(config.ConnMaxIdleTime)
    
    pool := &ConnectionPool{
        db:                db,
        maxOpenConns:      config.MaxOpenConns,
        maxIdleConns:      config.MaxIdleConns,
        connMaxLifetime:   config.ConnMaxLifetime,
        connMaxIdleTime:   config.ConnMaxIdleTime,
        healthCheckQuery:  config.HealthCheckQuery,
        healthCheckPeriod: config.HealthCheckPeriod,
        isHealthy:         true,
    }
    
    // Start health check routine
    go pool.healthCheckRoutine()
    
    // Initial health check
    if err := pool.healthCheck(); err != nil {
        return nil, fmt.Errorf("initial health check failed: %w", err)
    }
    
    return pool, nil
}

// GetDB returns the underlying database connection
func (cp *ConnectionPool) GetDB() *sql.DB {
    return cp.db
}

// Query executes a query with connection pool optimization
func (cp *ConnectionPool) Query(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error) {
    if !cp.IsHealthy() {
        return nil, fmt.Errorf("connection pool is unhealthy")
    }
    
    start := time.Now()
    rows, err := cp.db.QueryContext(ctx, query, args...)
    
    // Update statistics
    cp.updateStats(time.Since(start), err == nil)
    
    return rows, err
}

// QueryRow executes a query that returns a single row
func (cp *ConnectionPool) QueryRow(ctx context.Context, query string, args ...interface{}) *sql.Row {
    start := time.Now()
    row := cp.db.QueryRowContext(ctx, query, args...)
    
    // Update statistics
    cp.updateStats(time.Since(start), true)
    
    return row
}

// Exec executes a query without returning rows
func (cp *ConnectionPool) Exec(ctx context.Context, query string, args ...interface{}) (sql.Result, error) {
    if !cp.IsHealthy() {
        return nil, fmt.Errorf("connection pool is unhealthy")
    }
    
    start := time.Now()
    result, err := cp.db.ExecContext(ctx, query, args...)
    
    // Update statistics
    cp.updateStats(time.Since(start), err == nil)
    
    return result, err
}

// Begin starts a transaction
func (cp *ConnectionPool) Begin(ctx context.Context) (*sql.Tx, error) {
    if !cp.IsHealthy() {
        return nil, fmt.Errorf("connection pool is unhealthy")
    }
    
    return cp.db.BeginTx(ctx, nil)
}

// BeginTx starts a transaction with options
func (cp *ConnectionPool) BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error) {
    if !cp.IsHealthy() {
        return nil, fmt.Errorf("connection pool is unhealthy")
    }
    
    return cp.db.BeginTx(ctx, opts)
}

// Prepare creates a prepared statement
func (cp *ConnectionPool) Prepare(ctx context.Context, query string) (*sql.Stmt, error) {
    if !cp.IsHealthy() {
        return nil, fmt.Errorf("connection pool is unhealthy")
    }
    
    return cp.db.PrepareContext(ctx, query)
}

// IsHealthy returns the health status of the connection pool
func (cp *ConnectionPool) IsHealthy() bool {
    cp.mutex.RLock()
    defer cp.mutex.RUnlock()
    return cp.isHealthy
}

// GetStats returns current connection pool statistics
func (cp *ConnectionPool) GetStats() PoolStats {
    cp.mutex.RLock()
    defer cp.mutex.RUnlock()
    
    dbStats := cp.db.Stats()
    
    return PoolStats{
        OpenConnections:     dbStats.OpenConnections,
        InUseConnections:    dbStats.InUse,
        IdleConnections:     dbStats.Idle,
        WaitCount:           dbStats.WaitCount,
        WaitDuration:        dbStats.WaitDuration,
        MaxIdleClosed:       dbStats.MaxIdleClosed,
        MaxLifetimeClosed:   dbStats.MaxLifetimeClosed,
        MaxOpenConnections:  cp.maxOpenConns,
        MaxIdleConnections:  cp.maxIdleConns,
    }
}

// Close closes the connection pool
func (cp *ConnectionPool) Close() error {
    return cp.db.Close()
}

// healthCheck performs a health check on the connection pool
func (cp *ConnectionPool) healthCheck() error {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    
    _, err := cp.db.ExecContext(ctx, cp.healthCheckQuery)
    
    cp.mutex.Lock()
    cp.isHealthy = (err == nil)
    cp.lastCheck = time.Now()
    cp.mutex.Unlock()
    
    return err
}

// healthCheckRoutine runs periodic health checks
func (cp *ConnectionPool) healthCheckRoutine() {
    ticker := time.NewTicker(cp.healthCheckPeriod)
    defer ticker.Stop()
    
    for range ticker.C {
        if err := cp.healthCheck(); err != nil {
            // Log health check failure (in production, use proper logging)
            fmt.Printf("Connection pool health check failed: %v\n", err)
        }
    }
}

// updateStats updates connection pool statistics
func (cp *ConnectionPool) updateStats(duration time.Duration, success bool) {
    cp.mutex.Lock()
    defer cp.mutex.Unlock()
    
    // Update internal statistics if needed
    // This is a placeholder for more detailed statistics tracking
}

// OptimizeForHighLoad optimizes the connection pool for high load scenarios
func (cp *ConnectionPool) OptimizeForHighLoad() {
    cp.mutex.Lock()
    defer cp.mutex.Unlock()
    
    // Increase connection limits for high load
    cp.db.SetMaxOpenConns(200)
    cp.db.SetMaxIdleConns(50)
    cp.db.SetConnMaxLifetime(3 * time.Minute)
    cp.db.SetConnMaxIdleTime(2 * time.Minute)
    
    cp.maxOpenConns = 200
    cp.maxIdleConns = 50
}

// OptimizeForNormalLoad optimizes the connection pool for normal load scenarios
func (cp *ConnectionPool) OptimizeForNormalLoad() {
    cp.mutex.Lock()
    defer cp.mutex.Unlock()
    
    // Reset to normal connection limits
    cp.db.SetMaxOpenConns(100)
    cp.db.SetMaxIdleConns(25)
    cp.db.SetConnMaxLifetime(5 * time.Minute)
    cp.db.SetConnMaxIdleTime(5 * time.Minute)
    
    cp.maxOpenConns = 100
    cp.maxIdleConns = 25
}

// ConnectionPoolManager manages multiple connection pools
type ConnectionPoolManager struct {
    pools map[string]*ConnectionPool
    mutex sync.RWMutex
}

// NewConnectionPoolManager creates a new connection pool manager
func NewConnectionPoolManager() *ConnectionPoolManager {
    return &ConnectionPoolManager{
        pools: make(map[string]*ConnectionPool),
    }
}

// AddPool adds a connection pool
func (cpm *ConnectionPoolManager) AddPool(name string, pool *ConnectionPool) {
    cpm.mutex.Lock()
    defer cpm.mutex.Unlock()
    cpm.pools[name] = pool
}

// GetPool gets a connection pool by name
func (cpm *ConnectionPoolManager) GetPool(name string) (*ConnectionPool, bool) {
    cpm.mutex.RLock()
    defer cpm.mutex.RUnlock()
    pool, exists := cpm.pools[name]
    return pool, exists
}

// GetAllPools returns all connection pools
func (cpm *ConnectionPoolManager) GetAllPools() map[string]*ConnectionPool {
    cpm.mutex.RLock()
    defer cpm.mutex.RUnlock()
    
    result := make(map[string]*ConnectionPool)
    for name, pool := range cpm.pools {
        result[name] = pool
    }
    return result
}

// CloseAll closes all connection pools
func (cpm *ConnectionPoolManager) CloseAll() error {
    cpm.mutex.Lock()
    defer cpm.mutex.Unlock()
    
    var lastErr error
    for _, pool := range cpm.pools {
        if err := pool.Close(); err != nil {
            lastErr = err
        }
    }
    
    cpm.pools = make(map[string]*ConnectionPool)
    return lastErr
}

// GetHealthStatus returns the health status of all pools
func (cpm *ConnectionPoolManager) GetHealthStatus() map[string]bool {
    cpm.mutex.RLock()
    defer cpm.mutex.RUnlock()
    
    status := make(map[string]bool)
    for name, pool := range cpm.pools {
        status[name] = pool.IsHealthy()
    }
    return status
}
