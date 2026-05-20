// Package sync provides multi-region sync support
// Handles geo-distributed synchronization with region-aware routing
package sync

import (
	"context"
	"fmt"
	"math"
	"sort"
	"sync"
	"time"
)

// Region represents a geographic region
type Region struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Endpoint    string    `json:"endpoint"`
	Latitude    float64   `json:"latitude"`
	Longitude   float64   `json:"longitude"`
	Priority    int       `json:"priority"`
	Active      bool      `json:"active"`
	Healthy     bool      `json:"healthy"`
	LastHealthCheck time.Time `json:"last_health_check"`
	AvgLatency  time.Duration `json:"avg_latency"`
	Capacity    int       `json:"capacity"`
	CurrentLoad int       `json:"current_load"`
}

// RegionConfig configures multi-region behavior
type RegionConfig struct {
	PrimaryRegion       string        `json:"primary_region"`
	FailoverEnabled     bool          `json:"failover_enabled"`
	HealthCheckInterval time.Duration `json:"health_check_interval"`
	LatencyThreshold    time.Duration `json:"latency_threshold"`
	MaxRetries          int           `json:"max_retries"`
	ReplicationMode     string        `json:"replication_mode"` // sync, async, semi-sync
	ConflictPolicy      string        `json:"conflict_policy"`  // lww, primary_wins, merge
}

// DefaultRegionConfig returns default region configuration
func DefaultRegionConfig() *RegionConfig {
	return &RegionConfig{
		FailoverEnabled:     true,
		HealthCheckInterval: 30 * time.Second,
		LatencyThreshold:    500 * time.Millisecond,
		MaxRetries:          3,
		ReplicationMode:     "async",
		ConflictPolicy:      "lww",
	}
}

// RegionManager manages multi-region sync
type RegionManager struct {
	mu              sync.RWMutex
	config          *RegionConfig
	regions         map[string]*Region
	localRegion     string
	primaryRegion   string
	healthChecker   *RegionHealthChecker
	router          *RegionRouter
	replicator      *RegionReplicator
	metrics         *SyncMetrics
	stopCh          chan struct{}
}

// NewRegionManager creates a new region manager
func NewRegionManager(localRegion string, config *RegionConfig, metrics *SyncMetrics) *RegionManager {
	if config == nil {
		config = DefaultRegionConfig()
	}

	rm := &RegionManager{
		config:        config,
		regions:       make(map[string]*Region),
		localRegion:   localRegion,
		primaryRegion: config.PrimaryRegion,
		metrics:       metrics,
		stopCh:        make(chan struct{}),
	}

	rm.healthChecker = NewRegionHealthChecker(rm, config.HealthCheckInterval)
	rm.router = NewRegionRouter(rm)
	rm.replicator = NewRegionReplicator(rm, config.ReplicationMode)

	return rm
}

// RegisterRegion registers a region
func (rm *RegionManager) RegisterRegion(region *Region) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	region.Active = true
	region.Healthy = true
	region.LastHealthCheck = time.Now()
	rm.regions[region.ID] = region
}

// GetRegion returns a region by ID
func (rm *RegionManager) GetRegion(id string) (*Region, bool) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	region, ok := rm.regions[id]
	return region, ok
}

// GetLocalRegion returns the local region
func (rm *RegionManager) GetLocalRegion() (*Region, bool) {
	return rm.GetRegion(rm.localRegion)
}

// GetPrimaryRegion returns the primary region
func (rm *RegionManager) GetPrimaryRegion() (*Region, bool) {
	return rm.GetRegion(rm.primaryRegion)
}

// GetHealthyRegions returns all healthy regions
func (rm *RegionManager) GetHealthyRegions() []*Region {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	healthy := make([]*Region, 0)
	for _, region := range rm.regions {
		if region.Active && region.Healthy {
			healthy = append(healthy, region)
		}
	}
	return healthy
}

// SetRegionHealth sets the health status of a region
func (rm *RegionManager) SetRegionHealth(id string, healthy bool, latency time.Duration) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	if region, ok := rm.regions[id]; ok {
		region.Healthy = healthy
		region.LastHealthCheck = time.Now()
		region.AvgLatency = latency
	}
}

// Start starts the region manager
func (rm *RegionManager) Start(ctx context.Context) {
	go rm.healthChecker.Start(ctx)
}

// Stop stops the region manager
func (rm *RegionManager) Stop() {
	close(rm.stopCh)
	rm.healthChecker.Stop()
}

// Route routes a sync request to the best region
func (rm *RegionManager) Route(ctx context.Context, entityType string, operation string) (*Region, error) {
	return rm.router.Route(ctx, entityType, operation)
}

// Replicate replicates data to other regions
func (rm *RegionManager) Replicate(ctx context.Context, data *SyncEvent) error {
	return rm.replicator.Replicate(ctx, data)
}

// RegionHealthChecker checks region health
type RegionHealthChecker struct {
	mu       sync.RWMutex
	manager  *RegionManager
	interval time.Duration
	stopCh   chan struct{}
}

// NewRegionHealthChecker creates a new health checker
func NewRegionHealthChecker(manager *RegionManager, interval time.Duration) *RegionHealthChecker {
	return &RegionHealthChecker{
		manager:  manager,
		interval: interval,
		stopCh:   make(chan struct{}),
	}
}

// Start starts health checking
func (hc *RegionHealthChecker) Start(ctx context.Context) {
	ticker := time.NewTicker(hc.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-hc.stopCh:
			return
		case <-ticker.C:
			hc.checkAll()
		}
	}
}

// Stop stops health checking
func (hc *RegionHealthChecker) Stop() {
	close(hc.stopCh)
}

func (hc *RegionHealthChecker) checkAll() {
	regions := hc.manager.GetHealthyRegions()
	for _, region := range regions {
		go hc.checkRegion(region)
	}
}

func (hc *RegionHealthChecker) checkRegion(region *Region) {
	start := time.Now()
	
	// In production, this would make an actual health check request
	// For now, simulate health check
	healthy := true
	latency := time.Since(start)

	hc.manager.SetRegionHealth(region.ID, healthy, latency)
}

// RegionRouter routes requests to regions
type RegionRouter struct {
	mu      sync.RWMutex
	manager *RegionManager
}

// NewRegionRouter creates a new region router
func NewRegionRouter(manager *RegionManager) *RegionRouter {
	return &RegionRouter{
		manager: manager,
	}
}

// Route routes a request to the best region
func (rr *RegionRouter) Route(ctx context.Context, entityType string, operation string) (*Region, error) {
	regions := rr.manager.GetHealthyRegions()
	if len(regions) == 0 {
		return nil, fmt.Errorf("no healthy regions available")
	}

	// For writes, prefer primary region
	if operation == "create" || operation == "update" || operation == "delete" {
		if primary, ok := rr.manager.GetPrimaryRegion(); ok && primary.Healthy {
			return primary, nil
		}
	}

	// For reads, prefer local region
	if local, ok := rr.manager.GetLocalRegion(); ok && local.Healthy {
		return local, nil
	}

	// Fall back to lowest latency region
	return rr.selectLowestLatency(regions), nil
}

func (rr *RegionRouter) selectLowestLatency(regions []*Region) *Region {
	if len(regions) == 0 {
		return nil
	}

	sort.Slice(regions, func(i, j int) bool {
		return regions[i].AvgLatency < regions[j].AvgLatency
	})

	return regions[0]
}

// RegionReplicator replicates data across regions
type RegionReplicator struct {
	mu      sync.RWMutex
	manager *RegionManager
	mode    string // sync, async, semi-sync
	pending []*ReplicationTask
}

// ReplicationTask represents a pending replication
type ReplicationTask struct {
	ID          string
	Data        *SyncEvent
	TargetRegion string
	CreatedAt   time.Time
	Attempts    int
	LastError   string
}

// NewRegionReplicator creates a new replicator
func NewRegionReplicator(manager *RegionManager, mode string) *RegionReplicator {
	return &RegionReplicator{
		manager: manager,
		mode:    mode,
		pending: make([]*ReplicationTask, 0),
	}
}

// Replicate replicates data to other regions
func (rr *RegionReplicator) Replicate(ctx context.Context, data *SyncEvent) error {
	regions := rr.manager.GetHealthyRegions()
	localRegion := rr.manager.localRegion

	switch rr.mode {
	case "sync":
		return rr.replicateSync(ctx, data, regions, localRegion)
	case "async":
		return rr.replicateAsync(ctx, data, regions, localRegion)
	case "semi-sync":
		return rr.replicateSemiSync(ctx, data, regions, localRegion)
	default:
		return rr.replicateAsync(ctx, data, regions, localRegion)
	}
}

func (rr *RegionReplicator) replicateSync(ctx context.Context, data *SyncEvent, regions []*Region, localRegion string) error {
	var wg sync.WaitGroup
	errors := make(chan error, len(regions))

	for _, region := range regions {
		if region.ID == localRegion {
			continue
		}

		wg.Add(1)
		go func(r *Region) {
			defer wg.Done()
			if err := rr.sendToRegion(ctx, data, r); err != nil {
				errors <- err
			}
		}(region)
	}

	wg.Wait()
	close(errors)

	// Return first error if any
	for err := range errors {
		return err
	}

	return nil
}

func (rr *RegionReplicator) replicateAsync(ctx context.Context, data *SyncEvent, regions []*Region, localRegion string) error {
	for _, region := range regions {
		if region.ID == localRegion {
			continue
		}

		task := &ReplicationTask{
			ID:           fmt.Sprintf("repl-%d", time.Now().UnixNano()),
			Data:         data,
			TargetRegion: region.ID,
			CreatedAt:    time.Now(),
		}

		rr.mu.Lock()
		rr.pending = append(rr.pending, task)
		rr.mu.Unlock()

		go rr.processTask(ctx, task)
	}

	return nil
}

func (rr *RegionReplicator) replicateSemiSync(ctx context.Context, data *SyncEvent, regions []*Region, localRegion string) error {
	// Wait for at least one replica to acknowledge
	done := make(chan bool, len(regions))

	for _, region := range regions {
		if region.ID == localRegion {
			continue
		}

		go func(r *Region) {
			if err := rr.sendToRegion(ctx, data, r); err == nil {
				done <- true
			}
		}(region)
	}

	// Wait for first success or timeout
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(5 * time.Second):
		return fmt.Errorf("semi-sync replication timeout")
	}
}

func (rr *RegionReplicator) sendToRegion(ctx context.Context, data *SyncEvent, region *Region) error {
	// In production, this would send data to the region's endpoint
	// For now, simulate sending
	return nil
}

func (rr *RegionReplicator) processTask(ctx context.Context, task *ReplicationTask) {
	region, ok := rr.manager.GetRegion(task.TargetRegion)
	if !ok {
		return
	}

	maxRetries := rr.manager.config.MaxRetries
	for task.Attempts < maxRetries {
		task.Attempts++
		if err := rr.sendToRegion(ctx, task.Data, region); err != nil {
			task.LastError = err.Error()
			time.Sleep(time.Duration(task.Attempts) * time.Second) // Exponential backoff
			continue
		}
		break
	}

	// Remove from pending
	rr.mu.Lock()
	for i, t := range rr.pending {
		if t.ID == task.ID {
			rr.pending = append(rr.pending[:i], rr.pending[i+1:]...)
			break
		}
	}
	rr.mu.Unlock()
}

// GeoLocation represents a geographic location
type GeoLocation struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

// DistanceCalculator calculates distances between locations
type DistanceCalculator struct{}

// NewDistanceCalculator creates a new distance calculator
func NewDistanceCalculator() *DistanceCalculator {
	return &DistanceCalculator{}
}

// HaversineDistance calculates the distance between two points using Haversine formula
func (dc *DistanceCalculator) HaversineDistance(loc1, loc2 *GeoLocation) float64 {
	const earthRadius = 6371 // km

	lat1Rad := loc1.Latitude * math.Pi / 180
	lat2Rad := loc2.Latitude * math.Pi / 180
	deltaLat := (loc2.Latitude - loc1.Latitude) * math.Pi / 180
	deltaLon := (loc2.Longitude - loc1.Longitude) * math.Pi / 180

	a := math.Sin(deltaLat/2)*math.Sin(deltaLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*
			math.Sin(deltaLon/2)*math.Sin(deltaLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return earthRadius * c
}

// FindNearestRegion finds the nearest region to a location
func (dc *DistanceCalculator) FindNearestRegion(loc *GeoLocation, regions []*Region) *Region {
	if len(regions) == 0 {
		return nil
	}

	var nearest *Region
	minDistance := math.MaxFloat64

	for _, region := range regions {
		regionLoc := &GeoLocation{
			Latitude:  region.Latitude,
			Longitude: region.Longitude,
		}
		distance := dc.HaversineDistance(loc, regionLoc)
		if distance < minDistance {
			minDistance = distance
			nearest = region
		}
	}

	return nearest
}

// CrossRegionConflictResolver resolves conflicts across regions
type CrossRegionConflictResolver struct {
	mu     sync.RWMutex
	policy string
}

// NewCrossRegionConflictResolver creates a new conflict resolver
func NewCrossRegionConflictResolver(policy string) *CrossRegionConflictResolver {
	return &CrossRegionConflictResolver{
		policy: policy,
	}
}

// Resolve resolves a cross-region conflict
func (cr *CrossRegionConflictResolver) Resolve(local, remote *SyncEvent) (*SyncEvent, error) {
	switch cr.policy {
	case "lww":
		return cr.resolveLWW(local, remote)
	case "primary_wins":
		return cr.resolvePrimaryWins(local, remote)
	case "merge":
		return cr.resolveMerge(local, remote)
	default:
		return cr.resolveLWW(local, remote)
	}
}

func (cr *CrossRegionConflictResolver) resolveLWW(local, remote *SyncEvent) (*SyncEvent, error) {
	if local.Timestamp.After(remote.Timestamp) {
		return local, nil
	}
	return remote, nil
}

func (cr *CrossRegionConflictResolver) resolvePrimaryWins(local, remote *SyncEvent) (*SyncEvent, error) {
	// In production, check which event is from primary region
	// For now, prefer local
	return local, nil
}

func (cr *CrossRegionConflictResolver) resolveMerge(local, remote *SyncEvent) (*SyncEvent, error) {
	// Merge the payloads
	merged := &SyncEvent{
		ID:        local.ID,
		Type:      local.Type,
		EntityID:  local.EntityID,
		Timestamp: time.Now(),
		NodeID:    local.NodeID,
		Payload:   make(map[string]interface{}),
	}

	// Copy local payload
	if localPayload, ok := local.Payload.(map[string]interface{}); ok {
		for k, v := range localPayload {
			merged.Payload.(map[string]interface{})[k] = v
		}
	}

	// Merge remote payload (remote wins on conflicts)
	if remotePayload, ok := remote.Payload.(map[string]interface{}); ok {
		for k, v := range remotePayload {
			merged.Payload.(map[string]interface{})[k] = v
		}
	}

	return merged, nil
}

// RegionFailover handles region failover
type RegionFailover struct {
	mu            sync.RWMutex
	manager       *RegionManager
	failoverOrder []string
	currentPrimary string
}

// NewRegionFailover creates a new failover handler
func NewRegionFailover(manager *RegionManager, failoverOrder []string) *RegionFailover {
	return &RegionFailover{
		manager:        manager,
		failoverOrder:  failoverOrder,
		currentPrimary: manager.primaryRegion,
	}
}

// CheckAndFailover checks if failover is needed and performs it
func (rf *RegionFailover) CheckAndFailover() (*Region, error) {
	rf.mu.Lock()
	defer rf.mu.Unlock()

	// Check if current primary is healthy
	primary, ok := rf.manager.GetRegion(rf.currentPrimary)
	if ok && primary.Healthy {
		return primary, nil
	}

	// Find next healthy region in failover order
	for _, regionID := range rf.failoverOrder {
		if regionID == rf.currentPrimary {
			continue
		}

		region, ok := rf.manager.GetRegion(regionID)
		if ok && region.Healthy {
			rf.currentPrimary = regionID
			return region, nil
		}
	}

	return nil, fmt.Errorf("no healthy regions available for failover")
}

// GetCurrentPrimary returns the current primary region
func (rf *RegionFailover) GetCurrentPrimary() string {
	rf.mu.RLock()
	defer rf.mu.RUnlock()
	return rf.currentPrimary
}

// NigeriaRegions returns predefined Nigeria regions
func NigeriaRegions() []*Region {
	return []*Region{
		{
			ID:        "ng-lagos",
			Name:      "Lagos",
			Endpoint:  "https://lagos.sync.agentbanking.ng",
			Latitude:  6.5244,
			Longitude: 3.3792,
			Priority:  1,
		},
		{
			ID:        "ng-abuja",
			Name:      "Abuja",
			Endpoint:  "https://abuja.sync.agentbanking.ng",
			Latitude:  9.0765,
			Longitude: 7.3986,
			Priority:  2,
		},
		{
			ID:        "ng-kano",
			Name:      "Kano",
			Endpoint:  "https://kano.sync.agentbanking.ng",
			Latitude:  12.0022,
			Longitude: 8.5920,
			Priority:  3,
		},
		{
			ID:        "ng-portharcourt",
			Name:      "Port Harcourt",
			Endpoint:  "https://portharcourt.sync.agentbanking.ng",
			Latitude:  4.8156,
			Longitude: 7.0498,
			Priority:  4,
		},
		{
			ID:        "ng-ibadan",
			Name:      "Ibadan",
			Endpoint:  "https://ibadan.sync.agentbanking.ng",
			Latitude:  7.3775,
			Longitude: 3.9470,
			Priority:  5,
		},
	}
}
