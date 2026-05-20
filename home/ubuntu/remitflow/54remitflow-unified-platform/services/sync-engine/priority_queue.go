// Package sync provides a priority queue for sync operations
// Critical transactions are synced first
package sync

import (
	"container/heap"
	"sync"
	"time"
)

// SyncPriority defines the priority levels for sync operations
type SyncPriority int

const (
	PriorityCritical   SyncPriority = 0 // Financial transactions, security events
	PriorityHigh       SyncPriority = 1 // User-initiated actions
	PriorityNormal     SyncPriority = 2 // Regular data sync
	PriorityLow        SyncPriority = 3 // Background sync, analytics
	PriorityBackground SyncPriority = 4 // Non-essential data
)

// String returns the string representation of priority
func (p SyncPriority) String() string {
	switch p {
	case PriorityCritical:
		return "critical"
	case PriorityHigh:
		return "high"
	case PriorityNormal:
		return "normal"
	case PriorityLow:
		return "low"
	case PriorityBackground:
		return "background"
	default:
		return "unknown"
	}
}

// SyncItem represents an item in the sync queue
type SyncItem struct {
	ID           string                 `json:"id"`
	EntityID     string                 `json:"entity_id"`
	EntityType   string                 `json:"entity_type"`
	Operation    string                 `json:"operation"` // create, update, delete
	Priority     SyncPriority           `json:"priority"`
	Data         interface{}            `json:"data"`
	Metadata     map[string]interface{} `json:"metadata"`
	CreatedAt    time.Time              `json:"created_at"`
	ScheduledAt  time.Time              `json:"scheduled_at"`
	RetryCount   int                    `json:"retry_count"`
	MaxRetries   int                    `json:"max_retries"`
	LastError    string                 `json:"last_error,omitempty"`
	Deadline     time.Time              `json:"deadline,omitempty"`
	Dependencies []string               `json:"dependencies,omitempty"` // IDs of items that must sync first
	
	// Internal fields
	index int // Index in the heap
}

// PriorityQueue implements a priority queue for sync items
type PriorityQueue []*SyncItem

func (pq PriorityQueue) Len() int { return len(pq) }

func (pq PriorityQueue) Less(i, j int) bool {
	// First compare by priority (lower is higher priority)
	if pq[i].Priority != pq[j].Priority {
		return pq[i].Priority < pq[j].Priority
	}
	// Then by scheduled time (earlier is higher priority)
	if !pq[i].ScheduledAt.Equal(pq[j].ScheduledAt) {
		return pq[i].ScheduledAt.Before(pq[j].ScheduledAt)
	}
	// Then by creation time (earlier is higher priority)
	return pq[i].CreatedAt.Before(pq[j].CreatedAt)
}

func (pq PriorityQueue) Swap(i, j int) {
	pq[i], pq[j] = pq[j], pq[i]
	pq[i].index = i
	pq[j].index = j
}

func (pq *PriorityQueue) Push(x interface{}) {
	n := len(*pq)
	item := x.(*SyncItem)
	item.index = n
	*pq = append(*pq, item)
}

func (pq *PriorityQueue) Pop() interface{} {
	old := *pq
	n := len(old)
	item := old[n-1]
	old[n-1] = nil  // avoid memory leak
	item.index = -1 // for safety
	*pq = old[0 : n-1]
	return item
}

// SyncPriorityQueue is a thread-safe priority queue for sync operations
type SyncPriorityQueue struct {
	mu           sync.RWMutex
	queue        PriorityQueue
	itemsByID    map[string]*SyncItem
	completed    map[string]bool // Track completed items for dependency resolution
	maxSize      int
	stats        *QueueStats
}

// QueueStats tracks queue statistics
type QueueStats struct {
	mu              sync.RWMutex
	TotalEnqueued   uint64            `json:"total_enqueued"`
	TotalDequeued   uint64            `json:"total_dequeued"`
	TotalCompleted  uint64            `json:"total_completed"`
	TotalFailed     uint64            `json:"total_failed"`
	TotalRetried    uint64            `json:"total_retried"`
	ByPriority      map[string]uint64 `json:"by_priority"`
	AvgWaitTime     time.Duration     `json:"avg_wait_time"`
	MaxWaitTime     time.Duration     `json:"max_wait_time"`
}

// NewSyncPriorityQueue creates a new sync priority queue
func NewSyncPriorityQueue(maxSize int) *SyncPriorityQueue {
	pq := &SyncPriorityQueue{
		queue:     make(PriorityQueue, 0),
		itemsByID: make(map[string]*SyncItem),
		completed: make(map[string]bool),
		maxSize:   maxSize,
		stats: &QueueStats{
			ByPriority: make(map[string]uint64),
		},
	}
	heap.Init(&pq.queue)
	return pq
}

// Enqueue adds an item to the queue
func (spq *SyncPriorityQueue) Enqueue(item *SyncItem) error {
	spq.mu.Lock()
	defer spq.mu.Unlock()
	
	// Check if queue is full
	if spq.maxSize > 0 && len(spq.queue) >= spq.maxSize {
		// Try to make room by removing lowest priority items
		if !spq.makeRoom(item.Priority) {
			return ErrQueueFull
		}
	}
	
	// Check for duplicate
	if _, exists := spq.itemsByID[item.ID]; exists {
		return ErrDuplicateItem
	}
	
	// Set defaults
	if item.CreatedAt.IsZero() {
		item.CreatedAt = time.Now()
	}
	if item.ScheduledAt.IsZero() {
		item.ScheduledAt = time.Now()
	}
	if item.MaxRetries == 0 {
		item.MaxRetries = 3
	}
	
	// Add to queue
	heap.Push(&spq.queue, item)
	spq.itemsByID[item.ID] = item
	
	// Update stats
	spq.stats.mu.Lock()
	spq.stats.TotalEnqueued++
	spq.stats.ByPriority[item.Priority.String()]++
	spq.stats.mu.Unlock()
	
	return nil
}

// Dequeue removes and returns the highest priority item
func (spq *SyncPriorityQueue) Dequeue() *SyncItem {
	spq.mu.Lock()
	defer spq.mu.Unlock()
	
	for len(spq.queue) > 0 {
		item := heap.Pop(&spq.queue).(*SyncItem)
		delete(spq.itemsByID, item.ID)
		
		// Check if scheduled time has arrived
		if item.ScheduledAt.After(time.Now()) {
			// Re-queue for later
			heap.Push(&spq.queue, item)
			spq.itemsByID[item.ID] = item
			continue
		}
		
		// Check dependencies
		if !spq.dependenciesMet(item) {
			// Re-queue for later
			item.ScheduledAt = time.Now().Add(100 * time.Millisecond)
			heap.Push(&spq.queue, item)
			spq.itemsByID[item.ID] = item
			continue
		}
		
		// Update stats
		spq.stats.mu.Lock()
		spq.stats.TotalDequeued++
		waitTime := time.Since(item.CreatedAt)
		if waitTime > spq.stats.MaxWaitTime {
			spq.stats.MaxWaitTime = waitTime
		}
		// Update rolling average
		total := float64(spq.stats.TotalDequeued)
		spq.stats.AvgWaitTime = time.Duration(
			(float64(spq.stats.AvgWaitTime)*(total-1) + float64(waitTime)) / total,
		)
		spq.stats.mu.Unlock()
		
		return item
	}
	
	return nil
}

// Peek returns the highest priority item without removing it
func (spq *SyncPriorityQueue) Peek() *SyncItem {
	spq.mu.RLock()
	defer spq.mu.RUnlock()
	
	if len(spq.queue) == 0 {
		return nil
	}
	return spq.queue[0]
}

// MarkCompleted marks an item as completed
func (spq *SyncPriorityQueue) MarkCompleted(id string) {
	spq.mu.Lock()
	defer spq.mu.Unlock()
	
	spq.completed[id] = true
	
	spq.stats.mu.Lock()
	spq.stats.TotalCompleted++
	spq.stats.mu.Unlock()
}

// MarkFailed marks an item as failed and optionally requeues it
func (spq *SyncPriorityQueue) MarkFailed(id string, err error, requeue bool) {
	spq.mu.Lock()
	defer spq.mu.Unlock()
	
	item, exists := spq.itemsByID[id]
	if !exists {
		return
	}
	
	item.LastError = err.Error()
	item.RetryCount++
	
	if requeue && item.RetryCount < item.MaxRetries {
		// Exponential backoff
		backoff := time.Duration(1<<uint(item.RetryCount)) * time.Second
		item.ScheduledAt = time.Now().Add(backoff)
		
		// Lower priority for retries
		if item.Priority < PriorityBackground {
			item.Priority++
		}
		
		heap.Fix(&spq.queue, item.index)
		
		spq.stats.mu.Lock()
		spq.stats.TotalRetried++
		spq.stats.mu.Unlock()
	} else {
		// Remove from queue
		heap.Remove(&spq.queue, item.index)
		delete(spq.itemsByID, id)
		
		spq.stats.mu.Lock()
		spq.stats.TotalFailed++
		spq.stats.mu.Unlock()
	}
}

// UpdatePriority updates the priority of an item
func (spq *SyncPriorityQueue) UpdatePriority(id string, priority SyncPriority) bool {
	spq.mu.Lock()
	defer spq.mu.Unlock()
	
	item, exists := spq.itemsByID[id]
	if !exists {
		return false
	}
	
	item.Priority = priority
	heap.Fix(&spq.queue, item.index)
	return true
}

// Remove removes an item from the queue
func (spq *SyncPriorityQueue) Remove(id string) bool {
	spq.mu.Lock()
	defer spq.mu.Unlock()
	
	item, exists := spq.itemsByID[id]
	if !exists {
		return false
	}
	
	heap.Remove(&spq.queue, item.index)
	delete(spq.itemsByID, id)
	return true
}

// Size returns the current queue size
func (spq *SyncPriorityQueue) Size() int {
	spq.mu.RLock()
	defer spq.mu.RUnlock()
	return len(spq.queue)
}

// SizeByPriority returns the count of items by priority
func (spq *SyncPriorityQueue) SizeByPriority() map[SyncPriority]int {
	spq.mu.RLock()
	defer spq.mu.RUnlock()
	
	counts := make(map[SyncPriority]int)
	for _, item := range spq.queue {
		counts[item.Priority]++
	}
	return counts
}

// GetStats returns queue statistics
func (spq *SyncPriorityQueue) GetStats() *QueueStats {
	spq.stats.mu.RLock()
	defer spq.stats.mu.RUnlock()
	
	// Return a copy
	return &QueueStats{
		TotalEnqueued:  spq.stats.TotalEnqueued,
		TotalDequeued:  spq.stats.TotalDequeued,
		TotalCompleted: spq.stats.TotalCompleted,
		TotalFailed:    spq.stats.TotalFailed,
		TotalRetried:   spq.stats.TotalRetried,
		ByPriority:     spq.stats.ByPriority,
		AvgWaitTime:    spq.stats.AvgWaitTime,
		MaxWaitTime:    spq.stats.MaxWaitTime,
	}
}

// Clear removes all items from the queue
func (spq *SyncPriorityQueue) Clear() {
	spq.mu.Lock()
	defer spq.mu.Unlock()
	
	spq.queue = make(PriorityQueue, 0)
	spq.itemsByID = make(map[string]*SyncItem)
	heap.Init(&spq.queue)
}

// Helper methods

func (spq *SyncPriorityQueue) dependenciesMet(item *SyncItem) bool {
	for _, depID := range item.Dependencies {
		if !spq.completed[depID] {
			return false
		}
	}
	return true
}

func (spq *SyncPriorityQueue) makeRoom(minPriority SyncPriority) bool {
	// Find and remove lowest priority item
	var lowestIdx int = -1
	var lowestPriority SyncPriority = PriorityCritical
	
	for i, item := range spq.queue {
		if item.Priority > lowestPriority && item.Priority > minPriority {
			lowestIdx = i
			lowestPriority = item.Priority
		}
	}
	
	if lowestIdx >= 0 {
		item := spq.queue[lowestIdx]
		heap.Remove(&spq.queue, lowestIdx)
		delete(spq.itemsByID, item.ID)
		return true
	}
	
	return false
}

// Errors
var (
	ErrQueueFull     = &QueueError{Message: "queue is full"}
	ErrDuplicateItem = &QueueError{Message: "duplicate item"}
)

type QueueError struct {
	Message string
}

func (e *QueueError) Error() string {
	return e.Message
}

// PriorityClassifier classifies sync items by priority
type PriorityClassifier struct {
	rules []PriorityRule
}

// PriorityRule defines a rule for classifying priority
type PriorityRule struct {
	EntityType string
	Operation  string
	Priority   SyncPriority
}

// NewPriorityClassifier creates a new priority classifier with default rules
func NewPriorityClassifier() *PriorityClassifier {
	return &PriorityClassifier{
		rules: []PriorityRule{
			// Critical - Financial transactions
			{EntityType: "transaction", Operation: "create", Priority: PriorityCritical},
			{EntityType: "transfer", Operation: "create", Priority: PriorityCritical},
			{EntityType: "payment", Operation: "create", Priority: PriorityCritical},
			{EntityType: "cash_in", Operation: "create", Priority: PriorityCritical},
			{EntityType: "cash_out", Operation: "create", Priority: PriorityCritical},
			{EntityType: "settlement", Operation: "create", Priority: PriorityCritical},
			
			// Critical - Security events
			{EntityType: "auth", Operation: "*", Priority: PriorityCritical},
			{EntityType: "security_event", Operation: "*", Priority: PriorityCritical},
			{EntityType: "fraud_alert", Operation: "*", Priority: PriorityCritical},
			
			// High - User actions
			{EntityType: "user", Operation: "update", Priority: PriorityHigh},
			{EntityType: "agent", Operation: "update", Priority: PriorityHigh},
			{EntityType: "kyc", Operation: "*", Priority: PriorityHigh},
			{EntityType: "notification", Operation: "create", Priority: PriorityHigh},
			
			// Normal - Regular data
			{EntityType: "customer", Operation: "*", Priority: PriorityNormal},
			{EntityType: "account", Operation: "*", Priority: PriorityNormal},
			{EntityType: "product", Operation: "*", Priority: PriorityNormal},
			
			// Low - Background data
			{EntityType: "log", Operation: "*", Priority: PriorityLow},
			{EntityType: "audit", Operation: "*", Priority: PriorityLow},
			{EntityType: "report", Operation: "*", Priority: PriorityLow},
			
			// Background - Analytics
			{EntityType: "analytics", Operation: "*", Priority: PriorityBackground},
			{EntityType: "metrics", Operation: "*", Priority: PriorityBackground},
			{EntityType: "telemetry", Operation: "*", Priority: PriorityBackground},
		},
	}
}

// Classify returns the priority for an entity type and operation
func (pc *PriorityClassifier) Classify(entityType, operation string) SyncPriority {
	for _, rule := range pc.rules {
		if rule.EntityType == entityType {
			if rule.Operation == "*" || rule.Operation == operation {
				return rule.Priority
			}
		}
	}
	return PriorityNormal // Default
}

// AddRule adds a custom priority rule
func (pc *PriorityClassifier) AddRule(entityType, operation string, priority SyncPriority) {
	pc.rules = append([]PriorityRule{{
		EntityType: entityType,
		Operation:  operation,
		Priority:   priority,
	}}, pc.rules...) // Prepend to take precedence
}

// SyncQueueWorker processes items from the priority queue
type SyncQueueWorker struct {
	queue      *SyncPriorityQueue
	handler    func(*SyncItem) error
	workers    int
	stopCh     chan struct{}
	wg         sync.WaitGroup
}

// NewSyncQueueWorker creates a new queue worker
func NewSyncQueueWorker(queue *SyncPriorityQueue, handler func(*SyncItem) error, workers int) *SyncQueueWorker {
	return &SyncQueueWorker{
		queue:   queue,
		handler: handler,
		workers: workers,
		stopCh:  make(chan struct{}),
	}
}

// Start starts the worker goroutines
func (w *SyncQueueWorker) Start() {
	for i := 0; i < w.workers; i++ {
		w.wg.Add(1)
		go w.worker(i)
	}
}

// Stop stops all workers
func (w *SyncQueueWorker) Stop() {
	close(w.stopCh)
	w.wg.Wait()
}

func (w *SyncQueueWorker) worker(id int) {
	defer w.wg.Done()
	
	for {
		select {
		case <-w.stopCh:
			return
		default:
			item := w.queue.Dequeue()
			if item == nil {
				time.Sleep(100 * time.Millisecond)
				continue
			}
			
			err := w.handler(item)
			if err != nil {
				w.queue.MarkFailed(item.ID, err, true)
			} else {
				w.queue.MarkCompleted(item.ID)
			}
		}
	}
}
