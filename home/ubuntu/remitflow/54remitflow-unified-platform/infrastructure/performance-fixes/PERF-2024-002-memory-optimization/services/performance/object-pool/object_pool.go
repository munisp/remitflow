package objectpool

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
