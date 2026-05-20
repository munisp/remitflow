// Package sync provides dynamic rate limiting for sync operations
// Implements per-agent limits, backpressure, and fair queuing
package sync

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// RateLimitConfig configures rate limiting behavior
type RateLimitConfig struct {
	DefaultRPS         float64       `json:"default_rps"`          // Default requests per second
	BurstSize          int           `json:"burst_size"`           // Max burst size
	WindowSize         time.Duration `json:"window_size"`          // Sliding window size
	BackpressureThreshold float64    `json:"backpressure_threshold"` // Queue fill ratio to trigger backpressure
	AdaptiveEnabled    bool          `json:"adaptive_enabled"`     // Enable adaptive rate limiting
	FairQueuingEnabled bool          `json:"fair_queuing_enabled"` // Enable fair queuing
}

// DefaultRateLimitConfig returns default rate limit configuration
func DefaultRateLimitConfig() *RateLimitConfig {
	return &RateLimitConfig{
		DefaultRPS:            100,
		BurstSize:             50,
		WindowSize:            time.Second,
		BackpressureThreshold: 0.8,
		AdaptiveEnabled:       true,
		FairQueuingEnabled:    true,
	}
}

// TokenBucket implements token bucket rate limiting
type TokenBucket struct {
	mu           sync.Mutex
	tokens       float64
	maxTokens    float64
	refillRate   float64 // tokens per second
	lastRefill   time.Time
}

// NewTokenBucket creates a new token bucket
func NewTokenBucket(maxTokens float64, refillRate float64) *TokenBucket {
	return &TokenBucket{
		tokens:     maxTokens,
		maxTokens:  maxTokens,
		refillRate: refillRate,
		lastRefill: time.Now(),
	}
}

// Allow checks if a request is allowed
func (tb *TokenBucket) Allow() bool {
	return tb.AllowN(1)
}

// AllowN checks if n requests are allowed
func (tb *TokenBucket) AllowN(n int) bool {
	tb.mu.Lock()
	defer tb.mu.Unlock()

	tb.refill()

	if tb.tokens >= float64(n) {
		tb.tokens -= float64(n)
		return true
	}

	return false
}

// Wait waits until a request is allowed
func (tb *TokenBucket) Wait(ctx context.Context) error {
	return tb.WaitN(ctx, 1)
}

// WaitN waits until n requests are allowed
func (tb *TokenBucket) WaitN(ctx context.Context, n int) error {
	for {
		if tb.AllowN(n) {
			return nil
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(10 * time.Millisecond):
			// Retry
		}
	}
}

// Tokens returns the current number of tokens
func (tb *TokenBucket) Tokens() float64 {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	tb.refill()
	return tb.tokens
}

// SetRate sets the refill rate
func (tb *TokenBucket) SetRate(rate float64) {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	tb.refillRate = rate
}

func (tb *TokenBucket) refill() {
	now := time.Now()
	elapsed := now.Sub(tb.lastRefill).Seconds()
	tb.tokens += elapsed * tb.refillRate
	if tb.tokens > tb.maxTokens {
		tb.tokens = tb.maxTokens
	}
	tb.lastRefill = now
}

// SlidingWindowCounter implements sliding window rate limiting
type SlidingWindowCounter struct {
	mu         sync.Mutex
	windowSize time.Duration
	limit      int
	windows    map[int64]int
}

// NewSlidingWindowCounter creates a new sliding window counter
func NewSlidingWindowCounter(windowSize time.Duration, limit int) *SlidingWindowCounter {
	return &SlidingWindowCounter{
		windowSize: windowSize,
		limit:      limit,
		windows:    make(map[int64]int),
	}
}

// Allow checks if a request is allowed
func (swc *SlidingWindowCounter) Allow() bool {
	swc.mu.Lock()
	defer swc.mu.Unlock()

	now := time.Now()
	currentWindow := now.UnixNano() / int64(swc.windowSize)
	previousWindow := currentWindow - 1

	// Clean old windows
	for w := range swc.windows {
		if w < previousWindow {
			delete(swc.windows, w)
		}
	}

	// Calculate weighted count
	currentCount := swc.windows[currentWindow]
	previousCount := swc.windows[previousWindow]

	// Weight based on position in current window
	elapsed := float64(now.UnixNano()%int64(swc.windowSize)) / float64(swc.windowSize)
	weightedCount := float64(previousCount)*(1-elapsed) + float64(currentCount)

	if int(weightedCount) >= swc.limit {
		return false
	}

	swc.windows[currentWindow]++
	return true
}

// Count returns the current weighted count
func (swc *SlidingWindowCounter) Count() int {
	swc.mu.Lock()
	defer swc.mu.Unlock()

	now := time.Now()
	currentWindow := now.UnixNano() / int64(swc.windowSize)
	previousWindow := currentWindow - 1

	currentCount := swc.windows[currentWindow]
	previousCount := swc.windows[previousWindow]

	elapsed := float64(now.UnixNano()%int64(swc.windowSize)) / float64(swc.windowSize)
	return int(float64(previousCount)*(1-elapsed) + float64(currentCount))
}

// AgentRateLimiter provides per-agent rate limiting
type AgentRateLimiter struct {
	mu           sync.RWMutex
	config       *RateLimitConfig
	buckets      map[string]*TokenBucket
	agentLimits  map[string]float64 // Custom limits per agent
	metrics      *SyncMetrics
}

// NewAgentRateLimiter creates a new agent rate limiter
func NewAgentRateLimiter(config *RateLimitConfig, metrics *SyncMetrics) *AgentRateLimiter {
	if config == nil {
		config = DefaultRateLimitConfig()
	}

	return &AgentRateLimiter{
		config:      config,
		buckets:     make(map[string]*TokenBucket),
		agentLimits: make(map[string]float64),
		metrics:     metrics,
	}
}

// Allow checks if a request from an agent is allowed
func (arl *AgentRateLimiter) Allow(agentID string) bool {
	bucket := arl.getBucket(agentID)
	allowed := bucket.Allow()

	if !allowed && arl.metrics != nil {
		arl.metrics.RecordRateLimited(agentID)
	}

	return allowed
}

// Wait waits until a request from an agent is allowed
func (arl *AgentRateLimiter) Wait(ctx context.Context, agentID string) error {
	bucket := arl.getBucket(agentID)
	return bucket.Wait(ctx)
}

// SetAgentLimit sets a custom limit for an agent
func (arl *AgentRateLimiter) SetAgentLimit(agentID string, rps float64) {
	arl.mu.Lock()
	defer arl.mu.Unlock()

	arl.agentLimits[agentID] = rps

	// Update existing bucket if present
	if bucket, ok := arl.buckets[agentID]; ok {
		bucket.SetRate(rps)
	}
}

// GetAgentLimit returns the limit for an agent
func (arl *AgentRateLimiter) GetAgentLimit(agentID string) float64 {
	arl.mu.RLock()
	defer arl.mu.RUnlock()

	if limit, ok := arl.agentLimits[agentID]; ok {
		return limit
	}
	return arl.config.DefaultRPS
}

func (arl *AgentRateLimiter) getBucket(agentID string) *TokenBucket {
	arl.mu.Lock()
	defer arl.mu.Unlock()

	if bucket, ok := arl.buckets[agentID]; ok {
		return bucket
	}

	// Create new bucket with agent-specific or default limit
	rps := arl.config.DefaultRPS
	if limit, ok := arl.agentLimits[agentID]; ok {
		rps = limit
	}

	bucket := NewTokenBucket(float64(arl.config.BurstSize), rps)
	arl.buckets[agentID] = bucket
	return bucket
}

// BackpressureController manages backpressure
type BackpressureController struct {
	mu              sync.RWMutex
	threshold       float64
	currentPressure float64
	maxQueueSize    int
	currentQueueSize int
	callbacks       []func(float64)
}

// NewBackpressureController creates a new backpressure controller
func NewBackpressureController(threshold float64, maxQueueSize int) *BackpressureController {
	return &BackpressureController{
		threshold:    threshold,
		maxQueueSize: maxQueueSize,
		callbacks:    make([]func(float64), 0),
	}
}

// UpdateQueueSize updates the current queue size
func (bc *BackpressureController) UpdateQueueSize(size int) {
	bc.mu.Lock()
	defer bc.mu.Unlock()

	bc.currentQueueSize = size
	bc.currentPressure = float64(size) / float64(bc.maxQueueSize)

	// Notify callbacks if threshold exceeded
	if bc.currentPressure >= bc.threshold {
		for _, callback := range bc.callbacks {
			go callback(bc.currentPressure)
		}
	}
}

// ShouldApplyBackpressure checks if backpressure should be applied
func (bc *BackpressureController) ShouldApplyBackpressure() bool {
	bc.mu.RLock()
	defer bc.mu.RUnlock()
	return bc.currentPressure >= bc.threshold
}

// GetPressure returns the current pressure level
func (bc *BackpressureController) GetPressure() float64 {
	bc.mu.RLock()
	defer bc.mu.RUnlock()
	return bc.currentPressure
}

// OnBackpressure registers a callback for backpressure events
func (bc *BackpressureController) OnBackpressure(callback func(float64)) {
	bc.mu.Lock()
	defer bc.mu.Unlock()
	bc.callbacks = append(bc.callbacks, callback)
}

// FairQueue implements fair queuing across agents
type FairQueue struct {
	mu           sync.Mutex
	queues       map[string][]*SyncItem
	weights      map[string]float64
	currentIndex int
	agentOrder   []string
}

// NewFairQueue creates a new fair queue
func NewFairQueue() *FairQueue {
	return &FairQueue{
		queues:  make(map[string][]*SyncItem),
		weights: make(map[string]float64),
	}
}

// Enqueue adds an item to an agent's queue
func (fq *FairQueue) Enqueue(agentID string, item *SyncItem) {
	fq.mu.Lock()
	defer fq.mu.Unlock()

	if _, ok := fq.queues[agentID]; !ok {
		fq.queues[agentID] = make([]*SyncItem, 0)
		fq.agentOrder = append(fq.agentOrder, agentID)
		fq.weights[agentID] = 1.0 // Default weight
	}

	fq.queues[agentID] = append(fq.queues[agentID], item)
}

// Dequeue removes and returns the next item using weighted fair queuing
func (fq *FairQueue) Dequeue() *SyncItem {
	fq.mu.Lock()
	defer fq.mu.Unlock()

	if len(fq.agentOrder) == 0 {
		return nil
	}

	// Round-robin with weights
	attempts := 0
	for attempts < len(fq.agentOrder) {
		agentID := fq.agentOrder[fq.currentIndex]
		fq.currentIndex = (fq.currentIndex + 1) % len(fq.agentOrder)

		if queue, ok := fq.queues[agentID]; ok && len(queue) > 0 {
			item := queue[0]
			fq.queues[agentID] = queue[1:]

			// Remove agent from order if queue is empty
			if len(fq.queues[agentID]) == 0 {
				delete(fq.queues, agentID)
				fq.removeFromOrder(agentID)
			}

			return item
		}

		attempts++
	}

	return nil
}

// SetWeight sets the weight for an agent
func (fq *FairQueue) SetWeight(agentID string, weight float64) {
	fq.mu.Lock()
	defer fq.mu.Unlock()
	fq.weights[agentID] = weight
}

// Size returns the total queue size
func (fq *FairQueue) Size() int {
	fq.mu.Lock()
	defer fq.mu.Unlock()

	total := 0
	for _, queue := range fq.queues {
		total += len(queue)
	}
	return total
}

// AgentQueueSize returns the queue size for an agent
func (fq *FairQueue) AgentQueueSize(agentID string) int {
	fq.mu.Lock()
	defer fq.mu.Unlock()

	if queue, ok := fq.queues[agentID]; ok {
		return len(queue)
	}
	return 0
}

func (fq *FairQueue) removeFromOrder(agentID string) {
	for i, id := range fq.agentOrder {
		if id == agentID {
			fq.agentOrder = append(fq.agentOrder[:i], fq.agentOrder[i+1:]...)
			if fq.currentIndex >= len(fq.agentOrder) && len(fq.agentOrder) > 0 {
				fq.currentIndex = 0
			}
			break
		}
	}
}

// AdaptiveRateLimiter adapts rate limits based on system load
type AdaptiveRateLimiter struct {
	mu              sync.RWMutex
	baseLimiter     *AgentRateLimiter
	backpressure    *BackpressureController
	currentMultiplier float64
	minMultiplier   float64
	maxMultiplier   float64
	adjustInterval  time.Duration
	stopCh          chan struct{}
}

// NewAdaptiveRateLimiter creates a new adaptive rate limiter
func NewAdaptiveRateLimiter(config *RateLimitConfig, metrics *SyncMetrics) *AdaptiveRateLimiter {
	return &AdaptiveRateLimiter{
		baseLimiter:       NewAgentRateLimiter(config, metrics),
		backpressure:      NewBackpressureController(config.BackpressureThreshold, 10000),
		currentMultiplier: 1.0,
		minMultiplier:     0.1,
		maxMultiplier:     2.0,
		adjustInterval:    5 * time.Second,
		stopCh:            make(chan struct{}),
	}
}

// Start starts the adaptive rate limiter
func (arl *AdaptiveRateLimiter) Start(ctx context.Context) {
	go arl.adjustLoop(ctx)
}

// Stop stops the adaptive rate limiter
func (arl *AdaptiveRateLimiter) Stop() {
	close(arl.stopCh)
}

// Allow checks if a request is allowed
func (arl *AdaptiveRateLimiter) Allow(agentID string) bool {
	return arl.baseLimiter.Allow(agentID)
}

// Wait waits until a request is allowed
func (arl *AdaptiveRateLimiter) Wait(ctx context.Context, agentID string) error {
	return arl.baseLimiter.Wait(ctx, agentID)
}

// UpdateLoad updates the current system load
func (arl *AdaptiveRateLimiter) UpdateLoad(queueSize int) {
	arl.backpressure.UpdateQueueSize(queueSize)
}

// GetMultiplier returns the current rate multiplier
func (arl *AdaptiveRateLimiter) GetMultiplier() float64 {
	arl.mu.RLock()
	defer arl.mu.RUnlock()
	return arl.currentMultiplier
}

func (arl *AdaptiveRateLimiter) adjustLoop(ctx context.Context) {
	ticker := time.NewTicker(arl.adjustInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-arl.stopCh:
			return
		case <-ticker.C:
			arl.adjust()
		}
	}
}

func (arl *AdaptiveRateLimiter) adjust() {
	arl.mu.Lock()
	defer arl.mu.Unlock()

	pressure := arl.backpressure.GetPressure()

	// Adjust multiplier based on pressure
	if pressure > 0.9 {
		// High pressure - reduce rate significantly
		arl.currentMultiplier *= 0.5
	} else if pressure > 0.7 {
		// Medium pressure - reduce rate slightly
		arl.currentMultiplier *= 0.8
	} else if pressure < 0.3 {
		// Low pressure - increase rate
		arl.currentMultiplier *= 1.2
	}

	// Clamp multiplier
	if arl.currentMultiplier < arl.minMultiplier {
		arl.currentMultiplier = arl.minMultiplier
	}
	if arl.currentMultiplier > arl.maxMultiplier {
		arl.currentMultiplier = arl.maxMultiplier
	}

	// Apply multiplier to all agent limits
	for agentID := range arl.baseLimiter.buckets {
		baseLimit := arl.baseLimiter.GetAgentLimit(agentID)
		arl.baseLimiter.buckets[agentID].SetRate(baseLimit * arl.currentMultiplier)
	}
}

// RateLimitMiddleware provides rate limiting middleware
type RateLimitMiddleware struct {
	limiter *AdaptiveRateLimiter
}

// NewRateLimitMiddleware creates a new rate limit middleware
func NewRateLimitMiddleware(limiter *AdaptiveRateLimiter) *RateLimitMiddleware {
	return &RateLimitMiddleware{limiter: limiter}
}

// Wrap wraps a sync handler with rate limiting
func (rlm *RateLimitMiddleware) Wrap(agentID string, handler func() error) error {
	if !rlm.limiter.Allow(agentID) {
		return ErrRateLimited
	}
	return handler()
}

// WrapWithWait wraps a sync handler with rate limiting and waiting
func (rlm *RateLimitMiddleware) WrapWithWait(ctx context.Context, agentID string, handler func() error) error {
	if err := rlm.limiter.Wait(ctx, agentID); err != nil {
		return err
	}
	return handler()
}

// Errors
var (
	ErrRateLimited = fmt.Errorf("rate limited")
)

// RateLimitStats provides rate limiting statistics
type RateLimitStats struct {
	TotalRequests    int64              `json:"total_requests"`
	AllowedRequests  int64              `json:"allowed_requests"`
	RejectedRequests int64              `json:"rejected_requests"`
	CurrentMultiplier float64           `json:"current_multiplier"`
	CurrentPressure  float64            `json:"current_pressure"`
	ByAgent          map[string]int64   `json:"by_agent"`
}

// GetStats returns rate limiting statistics
func (arl *AdaptiveRateLimiter) GetStats() *RateLimitStats {
	arl.mu.RLock()
	defer arl.mu.RUnlock()

	return &RateLimitStats{
		CurrentMultiplier: arl.currentMultiplier,
		CurrentPressure:   arl.backpressure.GetPressure(),
		ByAgent:           make(map[string]int64),
	}
}
