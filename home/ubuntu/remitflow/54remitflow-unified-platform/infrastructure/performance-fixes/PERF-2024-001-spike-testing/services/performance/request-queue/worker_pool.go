package requestqueue

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
