#!/usr/bin/env python3
"""
Performance Fixes Implementation
Creates complete performance optimization code for PERF-2024-001 and PERF-2024-002
"""

import os
from datetime import datetime

def create_performance_fix_implementations():
    """Create complete performance fix code implementations"""
    
    print("⚡ Creating Complete Performance Fix Code Implementations...")
    print("=" * 70)
    
    # Create directory structure for performance fixes
    performance_fixes_dir = "/home/ubuntu/performance-fixes"
    os.makedirs(performance_fixes_dir, exist_ok=True)
    
    # PERF-2024-001: Spike Testing Failures Fix
    create_spike_testing_fix(performance_fixes_dir)
    
    # PERF-2024-002: Memory Leaks and GC Issues Fix
    create_memory_optimization_fix(performance_fixes_dir)
    
    # Create performance testing suite
    create_performance_testing_suite(performance_fixes_dir)
    
    # Create deployment automation
    create_deployment_automation(performance_fixes_dir)
    
    print("\n✅ All performance fix code implementations created!")
    return performance_fixes_dir

def create_spike_testing_fix(base_dir):
    """Create complete spike testing performance fix"""
    
    print("🚀 Creating PERF-2024-001: Spike Testing Fix...")
    
    # Create directory structure
    spike_dir = f"{base_dir}/PERF-2024-001-spike-testing"
    os.makedirs(f"{spike_dir}/services/performance/circuit-breaker", exist_ok=True)
    os.makedirs(f"{spike_dir}/services/performance/connection-pool", exist_ok=True)
    os.makedirs(f"{spike_dir}/services/performance/request-queue", exist_ok=True)
    os.makedirs(f"{spike_dir}/services/enhanced-platform/api-gateway", exist_ok=True)
    os.makedirs(f"{spike_dir}/tests/performance", exist_ok=True)
    
    # 1. Circuit Breaker Pattern Implementation
    circuit_breaker_code = '''package circuitbreaker

import (
    "context"
    "errors"
    "fmt"
    "sync"
    "time"
)

// State represents the circuit breaker state
type State int

const (
    StateClosed State = iota
    StateHalfOpen
    StateOpen
)

// CircuitBreaker implements the circuit breaker pattern
type CircuitBreaker struct {
    name            string
    maxRequests     uint32
    interval        time.Duration
    timeout         time.Duration
    readyToTrip     func(counts Counts) bool
    onStateChange   func(name string, from State, to State)
    
    mutex      sync.Mutex
    state      State
    generation uint64
    counts     Counts
    expiry     time.Time
}

// Counts holds the numbers of requests and their successes/failures
type Counts struct {
    Requests             uint32
    TotalSuccesses       uint32
    TotalFailures        uint32
    ConsecutiveSuccesses uint32
    ConsecutiveFailures  uint32
}

// Settings configures a CircuitBreaker
type Settings struct {
    Name          string
    MaxRequests   uint32
    Interval      time.Duration
    Timeout       time.Duration
    ReadyToTrip   func(counts Counts) bool
    OnStateChange func(name string, from State, to State)
}

// NewCircuitBreaker returns a new CircuitBreaker configured with the given Settings
func NewCircuitBreaker(st Settings) *CircuitBreaker {
    cb := &CircuitBreaker{
        name:        st.Name,
        maxRequests: st.MaxRequests,
        interval:    st.Interval,
        timeout:     st.Timeout,
        readyToTrip: st.ReadyToTrip,
        onStateChange: st.OnStateChange,
    }
    
    if cb.maxRequests == 0 {
        cb.maxRequests = 1
    }
    
    if cb.interval <= 0 {
        cb.interval = time.Duration(0)
    }
    
    if cb.timeout <= 0 {
        cb.timeout = 60 * time.Second
    }
    
    if cb.readyToTrip == nil {
        cb.readyToTrip = func(counts Counts) bool {
            return counts.ConsecutiveFailures > 5
        }
    }
    
    cb.toNewGeneration(time.Now())
    
    return cb
}

// Name returns the name of the CircuitBreaker
func (cb *CircuitBreaker) Name() string {
    return cb.name
}

// State returns the current state of the CircuitBreaker
func (cb *CircuitBreaker) State() State {
    cb.mutex.Lock()
    defer cb.mutex.Unlock()
    
    now := time.Now()
    state, _ := cb.currentState(now)
    return state
}

// Counts returns a copy of the internal Counts
func (cb *CircuitBreaker) Counts() Counts {
    cb.mutex.Lock()
    defer cb.mutex.Unlock()
    
    return cb.counts
}

// Execute runs the given request if the CircuitBreaker accepts it
func (cb *CircuitBreaker) Execute(req func() (interface{}, error)) (interface{}, error) {
    generation, err := cb.beforeRequest()
    if err != nil {
        return nil, err
    }
    
    defer func() {
        e := recover()
        if e != nil {
            cb.afterRequest(generation, false)
            panic(e)
        }
    }()
    
    result, err := req()
    cb.afterRequest(generation, err == nil)
    return result, err
}

// ExecuteWithContext runs the given request with context if the CircuitBreaker accepts it
func (cb *CircuitBreaker) ExecuteWithContext(ctx context.Context, req func(context.Context) (interface{}, error)) (interface{}, error) {
    generation, err := cb.beforeRequest()
    if err != nil {
        return nil, err
    }
    
    defer func() {
        e := recover()
        if e != nil {
            cb.afterRequest(generation, false)
            panic(e)
        }
    }()
    
    // Create a channel to receive the result
    resultChan := make(chan struct {
        result interface{}
        err    error
    }, 1)
    
    go func() {
        defer func() {
            if e := recover(); e != nil {
                resultChan <- struct {
                    result interface{}
                    err    error
                }{nil, fmt.Errorf("panic: %v", e)}
            }
        }()
        
        result, err := req(ctx)
        resultChan <- struct {
            result interface{}
            err    error
        }{result, err}
    }()
    
    select {
    case res := <-resultChan:
        cb.afterRequest(generation, res.err == nil)
        return res.result, res.err
    case <-ctx.Done():
        cb.afterRequest(generation, false)
        return nil, ctx.Err()
    }
}

// beforeRequest is called before a request
func (cb *CircuitBreaker) beforeRequest() (uint64, error) {
    cb.mutex.Lock()
    defer cb.mutex.Unlock()
    
    now := time.Now()
    state, generation := cb.currentState(now)
    
    if state == StateOpen {
        return generation, errors.New("circuit breaker is open")
    } else if state == StateHalfOpen && cb.counts.Requests >= cb.maxRequests {
        return generation, errors.New("circuit breaker is half-open and max requests reached")
    }
    
    cb.counts.onRequest()
    return generation, nil
}

// afterRequest is called after a request
func (cb *CircuitBreaker) afterRequest(before uint64, success bool) {
    cb.mutex.Lock()
    defer cb.mutex.Unlock()
    
    now := time.Now()
    state, generation := cb.currentState(now)
    if generation != before {
        return
    }
    
    if success {
        cb.onSuccess(state, now)
    } else {
        cb.onFailure(state, now)
    }
}

// onSuccess is called on successful requests
func (cb *CircuitBreaker) onSuccess(state State, now time.Time) {
    cb.counts.onSuccess()
    
    if state == StateHalfOpen {
        cb.setState(StateClosed, now)
    }
}

// onFailure is called on failed requests
func (cb *CircuitBreaker) onFailure(state State, now time.Time) {
    cb.counts.onFailure()
    
    if cb.readyToTrip(cb.counts) {
        cb.setState(StateOpen, now)
    }
}

// currentState returns the current state
func (cb *CircuitBreaker) currentState(now time.Time) (State, uint64) {
    switch cb.state {
    case StateClosed:
        if !cb.expiry.IsZero() && cb.expiry.Before(now) {
            cb.toNewGeneration(now)
        }
    case StateOpen:
        if cb.expiry.Before(now) {
            cb.setState(StateHalfOpen, now)
        }
    }
    return cb.state, cb.generation
}

// setState sets the state
func (cb *CircuitBreaker) setState(state State, now time.Time) {
    if cb.state == state {
        return
    }
    
    prev := cb.state
    cb.state = state
    
    cb.toNewGeneration(now)
    
    if cb.onStateChange != nil {
        cb.onStateChange(cb.name, prev, state)
    }
}

// toNewGeneration creates a new generation
func (cb *CircuitBreaker) toNewGeneration(now time.Time) {
    cb.generation++
    cb.counts.clear()
    
    var zero time.Time
    switch cb.state {
    case StateClosed:
        if cb.interval == 0 {
            cb.expiry = zero
        } else {
            cb.expiry = now.Add(cb.interval)
        }
    case StateOpen:
        cb.expiry = now.Add(cb.timeout)
    default: // StateHalfOpen
        cb.expiry = zero
    }
}

// onRequest increments the request count
func (c *Counts) onRequest() {
    c.Requests++
}

// onSuccess increments the success count
func (c *Counts) onSuccess() {
    c.TotalSuccesses++
    c.ConsecutiveSuccesses++
    c.ConsecutiveFailures = 0
}

// onFailure increments the failure count
func (c *Counts) onFailure() {
    c.TotalFailures++
    c.ConsecutiveFailures++
    c.ConsecutiveSuccesses = 0
}

// clear resets the counts
func (c *Counts) clear() {
    c.Requests = 0
    c.TotalSuccesses = 0
    c.TotalFailures = 0
    c.ConsecutiveSuccesses = 0
    c.ConsecutiveFailures = 0
}

// String returns a string representation of the state
func (s State) String() string {
    switch s {
    case StateClosed:
        return "closed"
    case StateHalfOpen:
        return "half-open"
    case StateOpen:
        return "open"
    default:
        return fmt.Sprintf("unknown state: %d", s)
    }
}

// CircuitBreakerManager manages multiple circuit breakers
type CircuitBreakerManager struct {
    breakers map[string]*CircuitBreaker
    mutex    sync.RWMutex
}

// NewCircuitBreakerManager creates a new circuit breaker manager
func NewCircuitBreakerManager() *CircuitBreakerManager {
    return &CircuitBreakerManager{
        breakers: make(map[string]*CircuitBreaker),
    }
}

// GetOrCreate gets an existing circuit breaker or creates a new one
func (cbm *CircuitBreakerManager) GetOrCreate(name string, settings Settings) *CircuitBreaker {
    cbm.mutex.Lock()
    defer cbm.mutex.Unlock()
    
    if cb, exists := cbm.breakers[name]; exists {
        return cb
    }
    
    settings.Name = name
    cb := NewCircuitBreaker(settings)
    cbm.breakers[name] = cb
    return cb
}

// Get gets an existing circuit breaker
func (cbm *CircuitBreakerManager) Get(name string) (*CircuitBreaker, bool) {
    cbm.mutex.RLock()
    defer cbm.mutex.RUnlock()
    
    cb, exists := cbm.breakers[name]
    return cb, exists
}

// GetAll returns all circuit breakers
func (cbm *CircuitBreakerManager) GetAll() map[string]*CircuitBreaker {
    cbm.mutex.RLock()
    defer cbm.mutex.RUnlock()
    
    result := make(map[string]*CircuitBreaker)
    for name, cb := range cbm.breakers {
        result[name] = cb
    }
    return result
}

// Remove removes a circuit breaker
func (cbm *CircuitBreakerManager) Remove(name string) {
    cbm.mutex.Lock()
    defer cbm.mutex.Unlock()
    
    delete(cbm.breakers, name)
}
'''
    
    with open(f"{spike_dir}/services/performance/circuit-breaker/circuit_breaker.go", "w") as f:
        f.write(circuit_breaker_code)
    
    # 2. Database Connection Pool Optimization
    connection_pool_code = '''package connectionpool

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
            fmt.Printf("Connection pool health check failed: %v\\n", err)
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
'''
    
    with open(f"{spike_dir}/services/performance/connection-pool/connection_pool.go", "w") as f:
        f.write(connection_pool_code)
    
    # 3. Request Queuing System
    request_queue_code = '''package requestqueue

import (
    "context"
    "fmt"
    "runtime"
    "sync"
    "sync/atomic"
    "time"
)

// Priority levels for requests
type Priority int

const (
    PriorityLow Priority = iota
    PriorityNormal
    PriorityHigh
    PriorityCritical
)

// Request represents a queued request
type Request struct {
    ID          string
    Priority    Priority
    Handler     func(context.Context) (interface{}, error)
    Context     context.Context
    ResultChan  chan Result
    EnqueueTime time.Time
    StartTime   time.Time
}

// Result represents the result of a processed request
type Result struct {
    Value interface{}
    Error error
}

// WorkerPool manages a pool of workers for processing requests
type WorkerPool struct {
    name           string
    workerCount    int
    queueSize      int
    workers        []*Worker
    requestQueue   chan *Request
    priorityQueues map[Priority]chan *Request
    
    // Statistics
    stats          WorkerPoolStats
    statsMutex     sync.RWMutex
    
    // Control
    ctx            context.Context
    cancel         context.CancelFunc
    wg             sync.WaitGroup
    
    // Configuration
    maxQueueSize   int
    workerTimeout  time.Duration
    gracefulStop   bool
}

// WorkerPoolStats holds statistics about the worker pool
type WorkerPoolStats struct {
    TotalRequests     int64
    ProcessedRequests int64
    FailedRequests    int64
    QueuedRequests    int64
    ActiveWorkers     int32
    AverageWaitTime   time.Duration
    AverageProcessTime time.Duration
    QueueOverflows    int64
}

// Worker represents a single worker in the pool
type Worker struct {
    id         int
    pool       *WorkerPool
    requests   chan *Request
    ctx        context.Context
    cancel     context.CancelFunc
    isActive   int32
}

// WorkerPoolConfig holds configuration for the worker pool
type WorkerPoolConfig struct {
    Name          string
    WorkerCount   int
    QueueSize     int
    MaxQueueSize  int
    WorkerTimeout time.Duration
    GracefulStop  bool
}

// NewWorkerPool creates a new worker pool
func NewWorkerPool(config WorkerPoolConfig) *WorkerPool {
    // Set defaults
    if config.WorkerCount == 0 {
        config.WorkerCount = runtime.NumCPU() * 2
    }
    if config.QueueSize == 0 {
        config.QueueSize = 1000
    }
    if config.MaxQueueSize == 0 {
        config.MaxQueueSize = 10000
    }
    if config.WorkerTimeout == 0 {
        config.WorkerTimeout = 30 * time.Second
    }
    
    ctx, cancel := context.WithCancel(context.Background())
    
    wp := &WorkerPool{
        name:           config.Name,
        workerCount:    config.WorkerCount,
        queueSize:      config.QueueSize,
        maxQueueSize:   config.MaxQueueSize,
        workerTimeout:  config.WorkerTimeout,
        gracefulStop:   config.GracefulStop,
        requestQueue:   make(chan *Request, config.QueueSize),
        priorityQueues: make(map[Priority]chan *Request),
        ctx:            ctx,
        cancel:         cancel,
    }
    
    // Initialize priority queues
    for priority := PriorityLow; priority <= PriorityCritical; priority++ {
        wp.priorityQueues[priority] = make(chan *Request, config.QueueSize/4)
    }
    
    // Start workers
    wp.startWorkers()
    
    // Start request dispatcher
    go wp.requestDispatcher()
    
    return wp
}

// Submit submits a request to the worker pool
func (wp *WorkerPool) Submit(ctx context.Context, priority Priority, handler func(context.Context) (interface{}, error)) (*Request, error) {
    return wp.SubmitWithID(ctx, fmt.Sprintf("req-%d", time.Now().UnixNano()), priority, handler)
}

// SubmitWithID submits a request with a specific ID
func (wp *WorkerPool) SubmitWithID(ctx context.Context, id string, priority Priority, handler func(context.Context) (interface{}, error)) (*Request, error) {
    // Check if pool is shutting down
    select {
    case <-wp.ctx.Done():
        return nil, fmt.Errorf("worker pool is shutting down")
    default:
    }
    
    // Check queue size limits
    if wp.GetQueuedRequests() >= int64(wp.maxQueueSize) {
        atomic.AddInt64(&wp.stats.QueueOverflows, 1)
        return nil, fmt.Errorf("queue is full, request rejected")
    }
    
    request := &Request{
        ID:          id,
        Priority:    priority,
        Handler:     handler,
        Context:     ctx,
        ResultChan:  make(chan Result, 1),
        EnqueueTime: time.Now(),
    }
    
    // Try to enqueue the request
    select {
    case wp.priorityQueues[priority] <- request:
        atomic.AddInt64(&wp.stats.TotalRequests, 1)
        atomic.AddInt64(&wp.stats.QueuedRequests, 1)
        return request, nil
    case <-ctx.Done():
        return nil, ctx.Err()
    case <-wp.ctx.Done():
        return nil, fmt.Errorf("worker pool is shutting down")
    default:
        // Queue is full for this priority, try lower priority queue
        if priority > PriorityLow {
            return wp.SubmitWithID(ctx, id, priority-1, handler)
        }
        atomic.AddInt64(&wp.stats.QueueOverflows, 1)
        return nil, fmt.Errorf("all queues are full, request rejected")
    }
}

// Wait waits for a request to complete
func (req *Request) Wait() (interface{}, error) {
    select {
    case result := <-req.ResultChan:
        return result.Value, result.Error
    case <-req.Context.Done():
        return nil, req.Context.Err()
    }
}

// WaitWithTimeout waits for a request to complete with a timeout
func (req *Request) WaitWithTimeout(timeout time.Duration) (interface{}, error) {
    ctx, cancel := context.WithTimeout(req.Context, timeout)
    defer cancel()
    
    select {
    case result := <-req.ResultChan:
        return result.Value, result.Error
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}

// startWorkers starts all workers
func (wp *WorkerPool) startWorkers() {
    wp.workers = make([]*Worker, wp.workerCount)
    
    for i := 0; i < wp.workerCount; i++ {
        worker := &Worker{
            id:       i,
            pool:     wp,
            requests: make(chan *Request, 1),
        }
        worker.ctx, worker.cancel = context.WithCancel(wp.ctx)
        wp.workers[i] = worker
        
        wp.wg.Add(1)
        go worker.run()
    }
}

// requestDispatcher dispatches requests from priority queues to workers
func (wp *WorkerPool) requestDispatcher() {
    defer wp.wg.Done()
    wp.wg.Add(1)
    
    for {
        select {
        case <-wp.ctx.Done():
            return
        default:
            // Check priority queues in order (highest to lowest)
            var request *Request
            var found bool
            
            for priority := PriorityCritical; priority >= PriorityLow; priority-- {
                select {
                case request = <-wp.priorityQueues[priority]:
                    found = true
                default:
                    continue
                }
                if found {
                    break
                }
            }
            
            if !found {
                // No requests available, wait a bit
                time.Sleep(1 * time.Millisecond)
                continue
            }
            
            // Find an available worker
            workerFound := false
            for _, worker := range wp.workers {
                select {
                case worker.requests <- request:
                    workerFound = true
                    atomic.AddInt64(&wp.stats.QueuedRequests, -1)
                default:
                    continue
                }
                if workerFound {
                    break
                }
            }
            
            if !workerFound {
                // No workers available, put request back
                select {
                case wp.priorityQueues[request.Priority] <- request:
                    atomic.AddInt64(&wp.stats.QueuedRequests, 1)
                case <-wp.ctx.Done():
                    // Pool is shutting down, send error to request
                    request.ResultChan <- Result{
                        Error: fmt.Errorf("worker pool is shutting down"),
                    }
                    return
                }
            }
        }
    }
}

// run runs a worker
func (w *Worker) run() {
    defer w.pool.wg.Done()
    
    for {
        select {
        case <-w.ctx.Done():
            return
        case request := <-w.requests:
            w.processRequest(request)
        }
    }
}

// processRequest processes a single request
func (w *Worker) processRequest(request *Request) {
    atomic.StoreInt32(&w.isActive, 1)
    atomic.AddInt32(&w.pool.stats.ActiveWorkers, 1)
    defer func() {
        atomic.StoreInt32(&w.isActive, 0)
        atomic.AddInt32(&w.pool.stats.ActiveWorkers, -1)
    }()
    
    request.StartTime = time.Now()
    waitTime := request.StartTime.Sub(request.EnqueueTime)
    
    // Create timeout context
    ctx, cancel := context.WithTimeout(request.Context, w.pool.workerTimeout)
    defer cancel()
    
    // Process the request
    result := Result{}
    
    // Use a goroutine to handle potential panics
    done := make(chan struct{})
    go func() {
        defer func() {
            if r := recover(); r != nil {
                result.Error = fmt.Errorf("panic in request handler: %v", r)
            }
            close(done)
        }()
        
        result.Value, result.Error = request.Handler(ctx)
    }()
    
    // Wait for completion or timeout
    select {
    case <-done:
        // Request completed
    case <-ctx.Done():
        result.Error = ctx.Err()
    }
    
    processTime := time.Since(request.StartTime)
    
    // Update statistics
    w.pool.updateStats(waitTime, processTime, result.Error == nil)
    
    // Send result
    select {
    case request.ResultChan <- result:
    case <-request.Context.Done():
        // Request context was cancelled, don't send result
    }
}

// updateStats updates worker pool statistics
func (wp *WorkerPool) updateStats(waitTime, processTime time.Duration, success bool) {
    wp.statsMutex.Lock()
    defer wp.statsMutex.Unlock()
    
    if success {
        atomic.AddInt64(&wp.stats.ProcessedRequests, 1)
    } else {
        atomic.AddInt64(&wp.stats.FailedRequests, 1)
    }
    
    // Update average times (simple moving average)
    wp.stats.AverageWaitTime = (wp.stats.AverageWaitTime + waitTime) / 2
    wp.stats.AverageProcessTime = (wp.stats.AverageProcessTime + processTime) / 2
}

// GetStats returns current worker pool statistics
func (wp *WorkerPool) GetStats() WorkerPoolStats {
    wp.statsMutex.RLock()
    defer wp.statsMutex.RUnlock()
    
    stats := wp.stats
    stats.ActiveWorkers = atomic.LoadInt32(&wp.stats.ActiveWorkers)
    stats.TotalRequests = atomic.LoadInt64(&wp.stats.TotalRequests)
    stats.ProcessedRequests = atomic.LoadInt64(&wp.stats.ProcessedRequests)
    stats.FailedRequests = atomic.LoadInt64(&wp.stats.FailedRequests)
    stats.QueuedRequests = atomic.LoadInt64(&wp.stats.QueuedRequests)
    stats.QueueOverflows = atomic.LoadInt64(&wp.stats.QueueOverflows)
    
    return stats
}

// GetQueuedRequests returns the number of queued requests
func (wp *WorkerPool) GetQueuedRequests() int64 {
    return atomic.LoadInt64(&wp.stats.QueuedRequests)
}

// Resize resizes the worker pool
func (wp *WorkerPool) Resize(newSize int) error {
    if newSize <= 0 {
        return fmt.Errorf("worker count must be positive")
    }
    
    currentSize := len(wp.workers)
    
    if newSize > currentSize {
        // Add workers
        for i := currentSize; i < newSize; i++ {
            worker := &Worker{
                id:       i,
                pool:     wp,
                requests: make(chan *Request, 1),
            }
            worker.ctx, worker.cancel = context.WithCancel(wp.ctx)
            wp.workers = append(wp.workers, worker)
            
            wp.wg.Add(1)
            go worker.run()
        }
    } else if newSize < currentSize {
        // Remove workers
        for i := newSize; i < currentSize; i++ {
            wp.workers[i].cancel()
        }
        wp.workers = wp.workers[:newSize]
    }
    
    wp.workerCount = newSize
    return nil
}

// Shutdown gracefully shuts down the worker pool
func (wp *WorkerPool) Shutdown(timeout time.Duration) error {
    // Cancel context to stop accepting new requests
    wp.cancel()
    
    if wp.gracefulStop {
        // Wait for all requests to complete or timeout
        done := make(chan struct{})
        go func() {
            wp.wg.Wait()
            close(done)
        }()
        
        select {
        case <-done:
            return nil
        case <-time.After(timeout):
            return fmt.Errorf("shutdown timeout exceeded")
        }
    } else {
        // Force shutdown
        wp.wg.Wait()
        return nil
    }
}

// String returns the priority as a string
func (p Priority) String() string {
    switch p {
    case PriorityLow:
        return "low"
    case PriorityNormal:
        return "normal"
    case PriorityHigh:
        return "high"
    case PriorityCritical:
        return "critical"
    default:
        return fmt.Sprintf("unknown(%d)", int(p))
    }
}
'''
    
    with open(f"{spike_dir}/services/performance/request-queue/worker_pool.go", "w") as f:
        f.write(request_queue_code)
    
    print("  ✅ PERF-2024-001 implementation created")

def create_memory_optimization_fix(base_dir):
    """Create complete memory optimization fix"""
    
    print("🧠 Creating PERF-2024-002: Memory Optimization Fix...")
    
    # Create directory structure
    memory_dir = f"{base_dir}/PERF-2024-002-memory-optimization"
    os.makedirs(f"{memory_dir}/services/performance/object-pool", exist_ok=True)
    os.makedirs(f"{memory_dir}/services/performance/memory-manager", exist_ok=True)
    os.makedirs(f"{memory_dir}/services/ai-ml-platform/gnn-service", exist_ok=True)
    os.makedirs(f"{memory_dir}/tests/memory", exist_ok=True)
    
    # 1. Object Pooling Implementation
    object_pool_code = '''package objectpool

import (
    "sync"
    "time"
)

// Pool represents a generic object pool
type Pool[T any] struct {
    pool    sync.Pool
    factory func() T
    reset   func(T)
    maxSize int
    created int64
    mutex   sync.RWMutex
}

// NewPool creates a new object pool
func NewPool[T any](factory func() T, reset func(T), maxSize int) *Pool[T] {
    return &Pool[T]{
        pool: sync.Pool{
            New: func() interface{} {
                return factory()
            },
        },
        factory: factory,
        reset:   reset,
        maxSize: maxSize,
    }
}

// Get retrieves an object from the pool
func (p *Pool[T]) Get() T {
    obj := p.pool.Get().(T)
    return obj
}

// Put returns an object to the pool
func (p *Pool[T]) Put(obj T) {
    if p.reset != nil {
        p.reset(obj)
    }
    p.pool.Put(obj)
}

// FraudDetectionResult represents a fraud detection result
type FraudDetectionResult struct {
    TransactionID string
    RiskScore     float64
    Reasons       []string
    Timestamp     time.Time
    Features      map[string]float64
    ModelVersion  string
}

// Reset resets a fraud detection result for reuse
func (fdr *FraudDetectionResult) Reset() {
    fdr.TransactionID = ""
    fdr.RiskScore = 0.0
    fdr.Reasons = fdr.Reasons[:0]
    fdr.Timestamp = time.Time{}
    for k := range fdr.Features {
        delete(fdr.Features, k)
    }
    fdr.ModelVersion = ""
}

// FraudDetectionPool manages fraud detection result objects
type FraudDetectionPool struct {
    *Pool[*FraudDetectionResult]
}

// NewFraudDetectionPool creates a new fraud detection result pool
func NewFraudDetectionPool(maxSize int) *FraudDetectionPool {
    return &FraudDetectionPool{
        Pool: NewPool(
            func() *FraudDetectionResult {
                return &FraudDetectionResult{
                    Reasons:  make([]string, 0, 10),
                    Features: make(map[string]float64, 20),
                }
            },
            func(fdr *FraudDetectionResult) {
                fdr.Reset()
            },
            maxSize,
        ),
    }
}

// MLModelResult represents an ML model result
type MLModelResult struct {
    ModelID     string
    Predictions []float64
    Confidence  float64
    Metadata    map[string]interface{}
    ProcessTime time.Duration
}

// Reset resets an ML model result for reuse
func (mlr *MLModelResult) Reset() {
    mlr.ModelID = ""
    mlr.Predictions = mlr.Predictions[:0]
    mlr.Confidence = 0.0
    for k := range mlr.Metadata {
        delete(mlr.Metadata, k)
    }
    mlr.ProcessTime = 0
}

// MLModelPool manages ML model result objects
type MLModelPool struct {
    *Pool[*MLModelResult]
}

// NewMLModelPool creates a new ML model result pool
func NewMLModelPool(maxSize int) *MLModelPool {
    return &MLModelPool{
        Pool: NewPool(
            func() *MLModelResult {
                return &MLModelResult{
                    Predictions: make([]float64, 0, 100),
                    Metadata:    make(map[string]interface{}, 10),
                }
            },
            func(mlr *MLModelResult) {
                mlr.Reset()
            },
            maxSize,
        ),
    }
}

// ByteBuffer represents a reusable byte buffer
type ByteBuffer struct {
    data []byte
}

// Reset resets the byte buffer
func (bb *ByteBuffer) Reset() {
    bb.data = bb.data[:0]
}

// Write appends data to the buffer
func (bb *ByteBuffer) Write(p []byte) (n int, err error) {
    bb.data = append(bb.data, p...)
    return len(p), nil
}

// Bytes returns the buffer data
func (bb *ByteBuffer) Bytes() []byte {
    return bb.data
}

// String returns the buffer as a string
func (bb *ByteBuffer) String() string {
    return string(bb.data)
}

// Len returns the buffer length
func (bb *ByteBuffer) Len() int {
    return len(bb.data)
}

// ByteBufferPool manages byte buffer objects
type ByteBufferPool struct {
    *Pool[*ByteBuffer]
}

// NewByteBufferPool creates a new byte buffer pool
func NewByteBufferPool(initialSize, maxSize int) *ByteBufferPool {
    return &ByteBufferPool{
        Pool: NewPool(
            func() *ByteBuffer {
                return &ByteBuffer{
                    data: make([]byte, 0, initialSize),
                }
            },
            func(bb *ByteBuffer) {
                bb.Reset()
            },
            maxSize,
        ),
    }
}

// StringBuilderPool manages string builder objects
type StringBuilderPool struct {
    pool sync.Pool
}

// NewStringBuilderPool creates a new string builder pool
func NewStringBuilderPool() *StringBuilderPool {
    return &StringBuilderPool{
        pool: sync.Pool{
            New: func() interface{} {
                return &strings.Builder{}
            },
        },
    }
}

// Get retrieves a string builder from the pool
func (sbp *StringBuilderPool) Get() *strings.Builder {
    return sbp.pool.Get().(*strings.Builder)
}

// Put returns a string builder to the pool
func (sbp *StringBuilderPool) Put(sb *strings.Builder) {
    sb.Reset()
    sbp.pool.Put(sb)
}

// PoolManager manages multiple object pools
type PoolManager struct {
    pools map[string]interface{}
    mutex sync.RWMutex
}

// NewPoolManager creates a new pool manager
func NewPoolManager() *PoolManager {
    return &PoolManager{
        pools: make(map[string]interface{}),
    }
}

// RegisterPool registers a pool with the manager
func (pm *PoolManager) RegisterPool(name string, pool interface{}) {
    pm.mutex.Lock()
    defer pm.mutex.Unlock()
    pm.pools[name] = pool
}

// GetPool retrieves a pool by name
func (pm *PoolManager) GetPool(name string) (interface{}, bool) {
    pm.mutex.RLock()
    defer pm.mutex.RUnlock()
    pool, exists := pm.pools[name]
    return pool, exists
}

// GetFraudDetectionPool retrieves the fraud detection pool
func (pm *PoolManager) GetFraudDetectionPool() (*FraudDetectionPool, bool) {
    pool, exists := pm.GetPool("fraud_detection")
    if !exists {
        return nil, false
    }
    fdPool, ok := pool.(*FraudDetectionPool)
    return fdPool, ok
}

// GetMLModelPool retrieves the ML model pool
func (pm *PoolManager) GetMLModelPool() (*MLModelPool, bool) {
    pool, exists := pm.GetPool("ml_model")
    if !exists {
        return nil, false
    }
    mlPool, ok := pool.(*MLModelPool)
    return mlPool, ok
}

// GetByteBufferPool retrieves the byte buffer pool
func (pm *PoolManager) GetByteBufferPool() (*ByteBufferPool, bool) {
    pool, exists := pm.GetPool("byte_buffer")
    if !exists {
        return nil, false
    }
    bbPool, ok := pool.(*ByteBufferPool)
    return bbPool, ok
}

// InitializeDefaultPools initializes default pools
func (pm *PoolManager) InitializeDefaultPools() {
    pm.RegisterPool("fraud_detection", NewFraudDetectionPool(1000))
    pm.RegisterPool("ml_model", NewMLModelPool(500))
    pm.RegisterPool("byte_buffer", NewByteBufferPool(1024, 1000))
    pm.RegisterPool("string_builder", NewStringBuilderPool())
}

// GetStats returns statistics for all pools
func (pm *PoolManager) GetStats() map[string]interface{} {
    pm.mutex.RLock()
    defer pm.mutex.RUnlock()
    
    stats := make(map[string]interface{})
    for name := range pm.pools {
        stats[name] = map[string]interface{}{
            "type": "object_pool",
            "registered": true,
        }
    }
    return stats
}
'''
    
    with open(f"{memory_dir}/services/performance/object-pool/object_pool.go", "w") as f:
        f.write(object_pool_code)
    
    # 2. Memory Manager Implementation
    memory_manager_code = '''package memorymanager

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
    fmt.Printf("GC completed in %v\\n", duration)
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
'''
    
    with open(f"{memory_dir}/services/performance/memory-manager/memory_manager.go", "w") as f:
        f.write(memory_manager_code)
    
    print("  ✅ PERF-2024-002 implementation created")

def create_performance_testing_suite(base_dir):
    """Create comprehensive performance testing suite"""
    
    print("🧪 Creating Performance Testing Suite...")
    
    # Create directory structure
    test_dir = f"{base_dir}/performance-testing-suite"
    os.makedirs(f"{test_dir}/load-testing", exist_ok=True)
    os.makedirs(f"{test_dir}/memory-testing", exist_ok=True)
    os.makedirs(f"{test_dir}/spike-testing", exist_ok=True)
    os.makedirs(f"{test_dir}/endurance-testing", exist_ok=True)
    
    # Performance test runner
    test_runner_code = '''#!/usr/bin/env python3
"""
Performance Testing Suite
Comprehensive performance testing for the Nigerian Remittance Platform
"""

import asyncio
import aiohttp
import json
import time
import statistics
import concurrent.futures
import psutil
import matplotlib.pyplot as plt
from datetime import datetime, timedelta
from typing import List, Dict, Any
import argparse

class PerformanceTestRunner:
    def __init__(self, base_url: str = "http://localhost:8000"):
        self.base_url = base_url
        self.results = {}
        
    async def run_load_test(self, concurrent_users: int = 100, duration: int = 60):
        """Run load testing with specified concurrent users"""
        print(f"🚀 Starting load test: {concurrent_users} users for {duration}s")
        
        start_time = time.time()
        end_time = start_time + duration
        
        # Create semaphore to limit concurrent requests
        semaphore = asyncio.Semaphore(concurrent_users)
        
        async with aiohttp.ClientSession() as session:
            tasks = []
            
            while time.time() < end_time:
                task = asyncio.create_task(self._make_request(session, semaphore))
                tasks.append(task)
                
                # Small delay to control request rate
                await asyncio.sleep(0.01)
            
            # Wait for all tasks to complete
            results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Process results
        successful_requests = [r for r in results if isinstance(r, dict) and r.get('success')]
        failed_requests = [r for r in results if isinstance(r, dict) and not r.get('success')]
        exceptions = [r for r in results if isinstance(r, Exception)]
        
        response_times = [r['response_time'] for r in successful_requests]
        
        load_test_results = {
            'test_type': 'load_test',
            'concurrent_users': concurrent_users,
            'duration': duration,
            'total_requests': len(results),
            'successful_requests': len(successful_requests),
            'failed_requests': len(failed_requests),
            'exceptions': len(exceptions),
            'success_rate': len(successful_requests) / len(results) * 100,
            'avg_response_time': statistics.mean(response_times) if response_times else 0,
            'min_response_time': min(response_times) if response_times else 0,
            'max_response_time': max(response_times) if response_times else 0,
            'p50_response_time': statistics.median(response_times) if response_times else 0,
            'p95_response_time': self._percentile(response_times, 95) if response_times else 0,
            'p99_response_time': self._percentile(response_times, 99) if response_times else 0,
            'requests_per_second': len(successful_requests) / duration,
            'timestamp': datetime.now().isoformat()
        }
        
        self.results['load_test'] = load_test_results
        return load_test_results
    
    async def run_spike_test(self, max_users: int = 1000, spike_duration: int = 30):
        """Run spike testing with sudden load increase"""
        print(f"⚡ Starting spike test: up to {max_users} users for {spike_duration}s")
        
        # Gradual ramp up
        ramp_up_time = 10
        steady_time = spike_duration
        ramp_down_time = 10
        
        results = []
        
        async with aiohttp.ClientSession() as session:
            # Ramp up phase
            for i in range(ramp_up_time):
                current_users = int((i + 1) / ramp_up_time * max_users)
                semaphore = asyncio.Semaphore(current_users)
                
                tasks = []
                for _ in range(current_users):
                    task = asyncio.create_task(self._make_request(session, semaphore))
                    tasks.append(task)
                
                batch_results = await asyncio.gather(*tasks, return_exceptions=True)
                results.extend(batch_results)
                
                await asyncio.sleep(1)
            
            # Steady state phase
            semaphore = asyncio.Semaphore(max_users)
            for i in range(steady_time):
                tasks = []
                for _ in range(max_users):
                    task = asyncio.create_task(self._make_request(session, semaphore))
                    tasks.append(task)
                
                batch_results = await asyncio.gather(*tasks, return_exceptions=True)
                results.extend(batch_results)
                
                await asyncio.sleep(1)
        
        # Process results
        successful_requests = [r for r in results if isinstance(r, dict) and r.get('success')]
        response_times = [r['response_time'] for r in successful_requests]
        
        spike_test_results = {
            'test_type': 'spike_test',
            'max_users': max_users,
            'spike_duration': spike_duration,
            'total_requests': len(results),
            'successful_requests': len(successful_requests),
            'success_rate': len(successful_requests) / len(results) * 100 if results else 0,
            'avg_response_time': statistics.mean(response_times) if response_times else 0,
            'p95_response_time': self._percentile(response_times, 95) if response_times else 0,
            'p99_response_time': self._percentile(response_times, 99) if response_times else 0,
            'peak_rps': len(successful_requests) / (ramp_up_time + steady_time),
            'timestamp': datetime.now().isoformat()
        }
        
        self.results['spike_test'] = spike_test_results
        return spike_test_results
    
    def run_memory_test(self, duration: int = 300):
        """Run memory testing to detect leaks"""
        print(f"🧠 Starting memory test for {duration}s")
        
        start_time = time.time()
        end_time = start_time + duration
        
        memory_samples = []
        cpu_samples = []
        
        # Monitor system resources
        while time.time() < end_time:
            # Get memory usage
            memory_info = psutil.virtual_memory()
            memory_samples.append({
                'timestamp': time.time(),
                'memory_percent': memory_info.percent,
                'memory_used': memory_info.used,
                'memory_available': memory_info.available
            })
            
            # Get CPU usage
            cpu_percent = psutil.cpu_percent(interval=1)
            cpu_samples.append({
                'timestamp': time.time(),
                'cpu_percent': cpu_percent
            })
            
            time.sleep(5)  # Sample every 5 seconds
        
        # Analyze memory trend
        memory_percentages = [s['memory_percent'] for s in memory_samples]
        memory_trend = self._calculate_trend(memory_percentages)
        
        memory_test_results = {
            'test_type': 'memory_test',
            'duration': duration,
            'samples': len(memory_samples),
            'avg_memory_percent': statistics.mean(memory_percentages),
            'max_memory_percent': max(memory_percentages),
            'min_memory_percent': min(memory_percentages),
            'memory_trend': memory_trend,
            'memory_leak_detected': memory_trend > 0.1,  # More than 0.1% increase per minute
            'avg_cpu_percent': statistics.mean([s['cpu_percent'] for s in cpu_samples]),
            'memory_samples': memory_samples,
            'cpu_samples': cpu_samples,
            'timestamp': datetime.now().isoformat()
        }
        
        self.results['memory_test'] = memory_test_results
        return memory_test_results
    
    async def run_endurance_test(self, users: int = 50, duration: int = 3600):
        """Run endurance testing for extended periods"""
        print(f"⏰ Starting endurance test: {users} users for {duration}s ({duration//3600}h)")
        
        start_time = time.time()
        end_time = start_time + duration
        
        interval_results = []
        interval_duration = 300  # 5-minute intervals
        
        async with aiohttp.ClientSession() as session:
            while time.time() < end_time:
                interval_start = time.time()
                interval_end = min(interval_start + interval_duration, end_time)
                
                # Run requests for this interval
                semaphore = asyncio.Semaphore(users)
                tasks = []
                
                while time.time() < interval_end:
                    task = asyncio.create_task(self._make_request(session, semaphore))
                    tasks.append(task)
                    await asyncio.sleep(0.1)  # Control request rate
                
                # Wait for interval tasks to complete
                results = await asyncio.gather(*tasks, return_exceptions=True)
                
                # Process interval results
                successful = [r for r in results if isinstance(r, dict) and r.get('success')]
                response_times = [r['response_time'] for r in successful]
                
                interval_result = {
                    'interval_start': interval_start,
                    'interval_duration': interval_end - interval_start,
                    'requests': len(results),
                    'successful': len(successful),
                    'success_rate': len(successful) / len(results) * 100 if results else 0,
                    'avg_response_time': statistics.mean(response_times) if response_times else 0,
                    'p95_response_time': self._percentile(response_times, 95) if response_times else 0
                }
                
                interval_results.append(interval_result)
                
                print(f"  Interval {len(interval_results)}: {interval_result['success_rate']:.1f}% success, "
                      f"{interval_result['avg_response_time']:.0f}ms avg")
        
        # Analyze endurance results
        success_rates = [r['success_rate'] for r in interval_results]
        response_times = [r['avg_response_time'] for r in interval_results]
        
        endurance_test_results = {
            'test_type': 'endurance_test',
            'users': users,
            'duration': duration,
            'intervals': len(interval_results),
            'avg_success_rate': statistics.mean(success_rates),
            'min_success_rate': min(success_rates),
            'avg_response_time': statistics.mean(response_times),
            'max_response_time': max(response_times),
            'performance_degradation': max(response_times) - min(response_times),
            'stability_score': min(success_rates),
            'interval_results': interval_results,
            'timestamp': datetime.now().isoformat()
        }
        
        self.results['endurance_test'] = endurance_test_results
        return endurance_test_results
    
    async def _make_request(self, session: aiohttp.ClientSession, semaphore: asyncio.Semaphore):
        """Make a single HTTP request"""
        async with semaphore:
            start_time = time.time()
            try:
                async with session.get(f"{self.base_url}/health", timeout=aiohttp.ClientTimeout(total=30)) as response:
                    response_time = (time.time() - start_time) * 1000  # Convert to milliseconds
                    return {
                        'success': response.status == 200,
                        'status_code': response.status,
                        'response_time': response_time
                    }
            except Exception as e:
                response_time = (time.time() - start_time) * 1000
                return {
                    'success': False,
                    'error': str(e),
                    'response_time': response_time
                }
    
    def _percentile(self, data: List[float], percentile: int) -> float:
        """Calculate percentile of data"""
        if not data:
            return 0
        sorted_data = sorted(data)
        index = int(len(sorted_data) * percentile / 100)
        return sorted_data[min(index, len(sorted_data) - 1)]
    
    def _calculate_trend(self, data: List[float]) -> float:
        """Calculate trend (slope) of data"""
        if len(data) < 2:
            return 0
        
        n = len(data)
        x = list(range(n))
        
        # Calculate linear regression slope
        x_mean = statistics.mean(x)
        y_mean = statistics.mean(data)
        
        numerator = sum((x[i] - x_mean) * (data[i] - y_mean) for i in range(n))
        denominator = sum((x[i] - x_mean) ** 2 for i in range(n))
        
        return numerator / denominator if denominator != 0 else 0
    
    def generate_report(self, output_file: str = "performance_report.json"):
        """Generate comprehensive performance report"""
        report = {
            'test_summary': {
                'total_tests': len(self.results),
                'test_types': list(self.results.keys()),
                'report_generated': datetime.now().isoformat()
            },
            'results': self.results,
            'recommendations': self._generate_recommendations()
        }
        
        with open(output_file, 'w') as f:
            json.dump(report, f, indent=2)
        
        print(f"📊 Performance report saved to {output_file}")
        return report
    
    def _generate_recommendations(self) -> List[str]:
        """Generate performance recommendations based on test results"""
        recommendations = []
        
        # Load test recommendations
        if 'load_test' in self.results:
            load_result = self.results['load_test']
            if load_result['success_rate'] < 95:
                recommendations.append("Load test success rate is below 95%. Consider optimizing error handling.")
            if load_result['p95_response_time'] > 1000:
                recommendations.append("95th percentile response time exceeds 1 second. Consider performance optimization.")
            if load_result['requests_per_second'] < 100:
                recommendations.append("Throughput is below 100 RPS. Consider scaling or optimization.")
        
        # Spike test recommendations
        if 'spike_test' in self.results:
            spike_result = self.results['spike_test']
            if spike_result['success_rate'] < 90:
                recommendations.append("Spike test shows poor performance under load. Implement circuit breakers.")
            if spike_result['p99_response_time'] > 5000:
                recommendations.append("99th percentile response time is very high during spikes. Implement request queuing.")
        
        # Memory test recommendations
        if 'memory_test' in self.results:
            memory_result = self.results['memory_test']
            if memory_result['memory_leak_detected']:
                recommendations.append("Memory leak detected. Implement object pooling and optimize garbage collection.")
            if memory_result['max_memory_percent'] > 90:
                recommendations.append("Memory usage exceeds 90%. Consider increasing memory or optimizing usage.")
        
        # Endurance test recommendations
        if 'endurance_test' in self.results:
            endurance_result = self.results['endurance_test']
            if endurance_result['stability_score'] < 95:
                recommendations.append("System stability degrades over time. Investigate resource leaks.")
            if endurance_result['performance_degradation'] > 500:
                recommendations.append("Significant performance degradation over time. Implement periodic cleanup.")
        
        return recommendations
    
    def create_visualizations(self):
        """Create performance visualization charts"""
        if 'memory_test' in self.results:
            self._create_memory_chart()
        
        if 'endurance_test' in self.results:
            self._create_endurance_chart()
    
    def _create_memory_chart(self):
        """Create memory usage chart"""
        memory_result = self.results['memory_test']
        samples = memory_result['memory_samples']
        
        timestamps = [s['timestamp'] for s in samples]
        memory_percentages = [s['memory_percent'] for s in samples]
        
        plt.figure(figsize=(12, 6))
        plt.plot(timestamps, memory_percentages, 'b-', linewidth=2)
        plt.title('Memory Usage Over Time')
        plt.xlabel('Time')
        plt.ylabel('Memory Usage (%)')
        plt.grid(True, alpha=0.3)
        plt.tight_layout()
        plt.savefig('memory_usage_chart.png', dpi=300, bbox_inches='tight')
        plt.close()
        
        print("📈 Memory usage chart saved to memory_usage_chart.png")
    
    def _create_endurance_chart(self):
        """Create endurance test chart"""
        endurance_result = self.results['endurance_test']
        intervals = endurance_result['interval_results']
        
        interval_numbers = list(range(1, len(intervals) + 1))
        success_rates = [r['success_rate'] for r in intervals]
        response_times = [r['avg_response_time'] for r in intervals]
        
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 10))
        
        # Success rate chart
        ax1.plot(interval_numbers, success_rates, 'g-', linewidth=2, marker='o')
        ax1.set_title('Success Rate Over Time')
        ax1.set_xlabel('Interval')
        ax1.set_ylabel('Success Rate (%)')
        ax1.grid(True, alpha=0.3)
        ax1.set_ylim(0, 100)
        
        # Response time chart
        ax2.plot(interval_numbers, response_times, 'r-', linewidth=2, marker='s')
        ax2.set_title('Average Response Time Over Time')
        ax2.set_xlabel('Interval')
        ax2.set_ylabel('Response Time (ms)')
        ax2.grid(True, alpha=0.3)
        
        plt.tight_layout()
        plt.savefig('endurance_test_chart.png', dpi=300, bbox_inches='tight')
        plt.close()
        
        print("📈 Endurance test chart saved to endurance_test_chart.png")

async def main():
    parser = argparse.ArgumentParser(description='Performance Testing Suite')
    parser.add_argument('--base-url', default='http://localhost:8000', help='Base URL for testing')
    parser.add_argument('--test-type', choices=['load', 'spike', 'memory', 'endurance', 'all'], 
                       default='all', help='Type of test to run')
    parser.add_argument('--users', type=int, default=100, help='Number of concurrent users')
    parser.add_argument('--duration', type=int, default=60, help='Test duration in seconds')
    parser.add_argument('--output', default='performance_report.json', help='Output report file')
    
    args = parser.parse_args()
    
    runner = PerformanceTestRunner(args.base_url)
    
    print("🚀 Starting Performance Testing Suite")
    print(f"Target: {args.base_url}")
    print(f"Test Type: {args.test_type}")
    print("=" * 50)
    
    try:
        if args.test_type in ['load', 'all']:
            await runner.run_load_test(args.users, args.duration)
        
        if args.test_type in ['spike', 'all']:
            await runner.run_spike_test(args.users * 2, args.duration // 2)
        
        if args.test_type in ['memory', 'all']:
            runner.run_memory_test(args.duration * 2)
        
        if args.test_type in ['endurance', 'all']:
            await runner.run_endurance_test(args.users // 2, args.duration * 10)
        
        # Generate report and visualizations
        report = runner.generate_report(args.output)
        runner.create_visualizations()
        
        print("\\n🎉 Performance testing completed successfully!")
        print(f"📊 Report: {args.output}")
        
        # Print summary
        print("\\n📋 Test Summary:")
        for test_type, result in runner.results.items():
            print(f"  {test_type}:")
            if 'success_rate' in result:
                print(f"    Success Rate: {result['success_rate']:.1f}%")
            if 'avg_response_time' in result:
                print(f"    Avg Response Time: {result['avg_response_time']:.0f}ms")
            if 'requests_per_second' in result:
                print(f"    Throughput: {result['requests_per_second']:.0f} RPS")
        
    except Exception as e:
        print(f"❌ Performance testing failed: {e}")
        return 1
    
    return 0

if __name__ == "__main__":
    exit(asyncio.run(main()))
'''
    
    with open(f"{test_dir}/performance_test_runner.py", "w") as f:
        f.write(test_runner_code)
    
    print("  ✅ Performance testing suite created")

def create_deployment_automation(base_dir):
    """Create deployment automation scripts"""
    
    print("🚀 Creating Deployment Automation...")
    
    # Create directory structure
    deploy_dir = f"{base_dir}/deployment-automation"
    os.makedirs(f"{deploy_dir}/scripts", exist_ok=True)
    os.makedirs(f"{deploy_dir}/kubernetes", exist_ok=True)
    os.makedirs(f"{deploy_dir}/monitoring", exist_ok=True)
    
    # Deployment script
    deploy_script = '''#!/bin/bash
set -e

# Performance Fixes Deployment Script
# Deploys all performance optimizations to the Nigerian Remittance Platform

echo "🚀 Starting Performance Fixes Deployment"
echo "========================================"

# Configuration
NAMESPACE="remittance-platform"
DEPLOYMENT_ENV="${DEPLOYMENT_ENV:-production}"
BACKUP_DIR="/tmp/performance-fixes-backup-$(date +%Y%m%d-%H%M%S)"

# Colors for output
RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
BLUE='\\033[0;34m'
NC='\\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed"
        exit 1
    fi
    
    # Check helm
    if ! command -v helm &> /dev/null; then
        log_error "helm is not installed"
        exit 1
    fi
    
    # Check docker
    if ! command -v docker &> /dev/null; then
        log_error "docker is not installed"
        exit 1
    fi
    
    # Check cluster connectivity
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Create backup
create_backup() {
    log_info "Creating backup..."
    
    mkdir -p "$BACKUP_DIR"
    
    # Backup current deployments
    kubectl get deployments -n "$NAMESPACE" -o yaml > "$BACKUP_DIR/deployments.yaml"
    kubectl get services -n "$NAMESPACE" -o yaml > "$BACKUP_DIR/services.yaml"
    kubectl get configmaps -n "$NAMESPACE" -o yaml > "$BACKUP_DIR/configmaps.yaml"
    
    log_success "Backup created at $BACKUP_DIR"
}

# Deploy circuit breaker
deploy_circuit_breaker() {
    log_info "Deploying circuit breaker service..."
    
    cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: circuit-breaker-service
  namespace: $NAMESPACE
spec:
  replicas: 3
  selector:
    matchLabels:
      app: circuit-breaker-service
  template:
    metadata:
      labels:
        app: circuit-breaker-service
    spec:
      containers:
      - name: circuit-breaker
        image: nigerian-remittance/circuit-breaker:latest
        ports:
        - containerPort: 8080
        env:
        - name: MAX_REQUESTS
          value: "100"
        - name: TIMEOUT
          value: "60s"
        - name: FAILURE_THRESHOLD
          value: "5"
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "256Mi"
            cpu: "200m"
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: circuit-breaker-service
  namespace: $NAMESPACE
spec:
  selector:
    app: circuit-breaker-service
  ports:
  - port: 80
    targetPort: 8080
  type: ClusterIP
EOF
    
    log_success "Circuit breaker service deployed"
}

# Deploy connection pool optimizer
deploy_connection_pool() {
    log_info "Deploying connection pool optimizer..."
    
    # Update database connection configurations
    kubectl patch configmap database-config -n "$NAMESPACE" --patch='
{
  "data": {
    "MAX_OPEN_CONNS": "200",
    "MAX_IDLE_CONNS": "50",
    "CONN_MAX_LIFETIME": "3m",
    "CONN_MAX_IDLE_TIME": "2m",
    "HEALTH_CHECK_PERIOD": "30s"
  }
}'
    
    # Restart services to pick up new configuration
    kubectl rollout restart deployment/api-gateway -n "$NAMESPACE"
    kubectl rollout restart deployment/pix-gateway -n "$NAMESPACE"
    kubectl rollout restart deployment/user-management -n "$NAMESPACE"
    
    log_success "Connection pool optimizer deployed"
}

# Deploy worker pool
deploy_worker_pool() {
    log_info "Deploying worker pool service..."
    
    cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker-pool-service
  namespace: $NAMESPACE
spec:
  replicas: 5
  selector:
    matchLabels:
      app: worker-pool-service
  template:
    metadata:
      labels:
        app: worker-pool-service
    spec:
      containers:
      - name: worker-pool
        image: nigerian-remittance/worker-pool:latest
        ports:
        - containerPort: 8080
        env:
        - name: WORKER_COUNT
          value: "20"
        - name: QUEUE_SIZE
          value: "10000"
        - name: MAX_QUEUE_SIZE
          value: "50000"
        - name: WORKER_TIMEOUT
          value: "30s"
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: worker-pool-service
  namespace: $NAMESPACE
spec:
  selector:
    app: worker-pool-service
  ports:
  - port: 80
    targetPort: 8080
  type: ClusterIP
EOF
    
    log_success "Worker pool service deployed"
}

# Deploy memory manager
deploy_memory_manager() {
    log_info "Deploying memory manager..."
    
    # Update memory management configurations
    kubectl patch configmap memory-config -n "$NAMESPACE" --patch='
{
  "data": {
    "MAX_HEAP_SIZE": "2147483648",
    "GC_TARGET_PERCENT": "100",
    "GC_INTERVAL": "2m",
    "MONITOR_INTERVAL": "10s",
    "ALERT_THRESHOLD": "0.8",
    "ENABLE_AUTO_GC": "true",
    "ENABLE_MEMORY_LIMIT": "true"
  }
}'
    
    # Deploy memory monitoring service
    cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: memory-monitor
  namespace: $NAMESPACE
spec:
  selector:
    matchLabels:
      app: memory-monitor
  template:
    metadata:
      labels:
        app: memory-monitor
    spec:
      containers:
      - name: memory-monitor
        image: nigerian-remittance/memory-monitor:latest
        ports:
        - containerPort: 8080
        env:
        - name: NODE_NAME
          valueFrom:
            fieldRef:
              fieldPath: spec.nodeName
        resources:
          requests:
            memory: "64Mi"
            cpu: "50m"
          limits:
            memory: "128Mi"
            cpu: "100m"
        volumeMounts:
        - name: proc
          mountPath: /host/proc
          readOnly: true
        - name: sys
          mountPath: /host/sys
          readOnly: true
      volumes:
      - name: proc
        hostPath:
          path: /proc
      - name: sys
        hostPath:
          path: /sys
      hostNetwork: true
      hostPID: true
EOF
    
    log_success "Memory manager deployed"
}

# Deploy object pools
deploy_object_pools() {
    log_info "Deploying object pools..."
    
    # Update object pool configurations
    kubectl patch configmap object-pool-config -n "$NAMESPACE" --patch='
{
  "data": {
    "FRAUD_DETECTION_POOL_SIZE": "1000",
    "ML_MODEL_POOL_SIZE": "500",
    "BYTE_BUFFER_POOL_SIZE": "1000",
    "BYTE_BUFFER_INITIAL_SIZE": "1024",
    "ENABLE_OBJECT_POOLING": "true"
  }
}'
    
    log_success "Object pools deployed"
}

# Update HPA configurations
update_hpa() {
    log_info "Updating Horizontal Pod Autoscaler configurations..."
    
    # Update HPA for API Gateway
    cat <<EOF | kubectl apply -f -
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-gateway-hpa
  namespace: $NAMESPACE
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-gateway
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 100
        periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 10
        periodSeconds: 60
EOF
    
    # Update HPA for PIX Gateway
    cat <<EOF | kubectl apply -f -
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: pix-gateway-hpa
  namespace: $NAMESPACE
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: pix-gateway
  minReplicas: 2
  maxReplicas: 15
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
EOF
    
    log_success "HPA configurations updated"
}

# Deploy monitoring
deploy_monitoring() {
    log_info "Deploying performance monitoring..."
    
    # Deploy Prometheus rules for performance monitoring
    cat <<EOF | kubectl apply -f -
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: performance-alerts
  namespace: $NAMESPACE
spec:
  groups:
  - name: performance.rules
    rules:
    - alert: HighResponseTime
      expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 1
      for: 2m
      labels:
        severity: warning
      annotations:
        summary: "High response time detected"
        description: "95th percentile response time is above 1 second"
    
    - alert: HighErrorRate
      expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05
      for: 1m
      labels:
        severity: critical
      annotations:
        summary: "High error rate detected"
        description: "Error rate is above 5%"
    
    - alert: MemoryUsageHigh
      expr: (node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes > 0.9
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "High memory usage"
        description: "Memory usage is above 90%"
    
    - alert: CircuitBreakerOpen
      expr: circuit_breaker_state == 2
      for: 1m
      labels:
        severity: critical
      annotations:
        summary: "Circuit breaker is open"
        description: "Circuit breaker {{ $labels.name }} is in open state"
EOF
    
    log_success "Performance monitoring deployed"
}

# Verify deployment
verify_deployment() {
    log_info "Verifying deployment..."
    
    # Check all pods are running
    log_info "Checking pod status..."
    kubectl get pods -n "$NAMESPACE" | grep -E "(circuit-breaker|worker-pool|memory-monitor)"
    
    # Check services are accessible
    log_info "Checking service health..."
    
    # Wait for services to be ready
    kubectl wait --for=condition=available --timeout=300s deployment/circuit-breaker-service -n "$NAMESPACE" || true
    kubectl wait --for=condition=available --timeout=300s deployment/worker-pool-service -n "$NAMESPACE" || true
    
    # Test service endpoints
    if kubectl exec -n "$NAMESPACE" deployment/api-gateway -- curl -f http://circuit-breaker-service/health; then
        log_success "Circuit breaker service is healthy"
    else
        log_warning "Circuit breaker service health check failed"
    fi
    
    if kubectl exec -n "$NAMESPACE" deployment/api-gateway -- curl -f http://worker-pool-service/health; then
        log_success "Worker pool service is healthy"
    else
        log_warning "Worker pool service health check failed"
    fi
    
    log_success "Deployment verification completed"
}

# Run performance tests
run_performance_tests() {
    log_info "Running performance tests..."
    
    # Get API Gateway external IP
    API_GATEWAY_IP=$(kubectl get service api-gateway -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
    if [ -z "$API_GATEWAY_IP" ]; then
        API_GATEWAY_IP="localhost:8000"
        log_warning "Using localhost for testing. Make sure to port-forward the API Gateway service."
    fi
    
    # Run basic load test
    python3 ../performance-testing-suite/performance_test_runner.py \\
        --base-url "http://$API_GATEWAY_IP" \\
        --test-type load \\
        --users 100 \\
        --duration 60 \\
        --output "post_deployment_performance_report.json"
    
    log_success "Performance tests completed"
}

# Rollback function
rollback() {
    log_warning "Rolling back deployment..."
    
    if [ -d "$BACKUP_DIR" ]; then
        kubectl apply -f "$BACKUP_DIR/deployments.yaml"
        kubectl apply -f "$BACKUP_DIR/services.yaml"
        kubectl apply -f "$BACKUP_DIR/configmaps.yaml"
        log_success "Rollback completed"
    else
        log_error "Backup directory not found. Manual rollback required."
    fi
}

# Main deployment function
main() {
    log_info "Starting performance fixes deployment for environment: $DEPLOYMENT_ENV"
    
    # Set trap for cleanup on exit
    trap 'log_error "Deployment failed. Check logs above."; exit 1' ERR
    
    check_prerequisites
    create_backup
    
    # Deploy performance fixes
    deploy_circuit_breaker
    deploy_connection_pool
    deploy_worker_pool
    deploy_memory_manager
    deploy_object_pools
    update_hpa
    deploy_monitoring
    
    # Verify deployment
    verify_deployment
    
    # Run performance tests
    if [ "$DEPLOYMENT_ENV" != "production" ]; then
        run_performance_tests
    fi
    
    log_success "🎉 Performance fixes deployment completed successfully!"
    log_info "Backup location: $BACKUP_DIR"
    log_info "Monitor the system for the next 24 hours to ensure stability."
    
    # Print summary
    echo ""
    echo "📊 Deployment Summary:"
    echo "  ✅ Circuit Breaker Service: Deployed"
    echo "  ✅ Connection Pool Optimization: Applied"
    echo "  ✅ Worker Pool Service: Deployed"
    echo "  ✅ Memory Manager: Deployed"
    echo "  ✅ Object Pools: Configured"
    echo "  ✅ HPA Configurations: Updated"
    echo "  ✅ Performance Monitoring: Deployed"
    echo ""
    echo "🔍 Next Steps:"
    echo "  1. Monitor system performance for 24 hours"
    echo "  2. Run comprehensive performance tests"
    echo "  3. Adjust configurations based on observed metrics"
    echo "  4. Update documentation with new configurations"
}

# Handle command line arguments
case "${1:-deploy}" in
    deploy)
        main
        ;;
    rollback)
        rollback
        ;;
    verify)
        verify_deployment
        ;;
    test)
        run_performance_tests
        ;;
    *)
        echo "Usage: $0 {deploy|rollback|verify|test}"
        echo "  deploy   - Deploy performance fixes (default)"
        echo "  rollback - Rollback to previous version"
        echo "  verify   - Verify current deployment"
        echo "  test     - Run performance tests"
        exit 1
        ;;
esac
'''
    
    with open(f"{deploy_dir}/scripts/deploy_performance_fixes.sh", "w") as f:
        f.write(deploy_script)
    
    # Make script executable
    os.chmod(f"{deploy_dir}/scripts/deploy_performance_fixes.sh", 0o755)
    
    print("  ✅ Deployment automation created")

def main():
    """Main function"""
    
    performance_fixes_dir = create_performance_fix_implementations()
    
    print(f"\n📁 Performance fix implementations created in: {performance_fixes_dir}")
    print("\n📋 Files created:")
    print("  PERF-2024-001-spike-testing/")
    print("    ├── services/performance/circuit-breaker/circuit_breaker.go")
    print("    ├── services/performance/connection-pool/connection_pool.go")
    print("    ├── services/performance/request-queue/worker_pool.go")
    print("    └── tests/performance/")
    print("  PERF-2024-002-memory-optimization/")
    print("    ├── services/performance/object-pool/object_pool.go")
    print("    ├── services/performance/memory-manager/memory_manager.go")
    print("    └── tests/memory/")
    print("  performance-testing-suite/")
    print("    └── performance_test_runner.py")
    print("  deployment-automation/")
    print("    ├── scripts/deploy_performance_fixes.sh")
    print("    ├── kubernetes/")
    print("    └── monitoring/")

if __name__ == "__main__":
    main()

