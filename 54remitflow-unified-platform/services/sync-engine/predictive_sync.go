// Package sync provides predictive sync with ML capabilities
// Predicts sync conflicts, optimizes timing, and pre-fetches data
package sync

import (
	"context"
	"math"
	"sort"
	"sync"
	"time"
)

// PredictiveConfig configures predictive sync behavior
type PredictiveConfig struct {
	Enabled              bool          `json:"enabled"`
	ConflictThreshold    float64       `json:"conflict_threshold"`    // Probability threshold for conflict warning
	PrefetchThreshold    float64       `json:"prefetch_threshold"`    // Probability threshold for prefetch
	ModelUpdateInterval  time.Duration `json:"model_update_interval"` // How often to update models
	HistoryWindow        time.Duration `json:"history_window"`        // How much history to consider
	MaxPrefetchItems     int           `json:"max_prefetch_items"`    // Max items to prefetch
}

// DefaultPredictiveConfig returns default predictive configuration
func DefaultPredictiveConfig() *PredictiveConfig {
	return &PredictiveConfig{
		Enabled:             true,
		ConflictThreshold:   0.7,
		PrefetchThreshold:   0.6,
		ModelUpdateInterval: 1 * time.Hour,
		HistoryWindow:       7 * 24 * time.Hour,
		MaxPrefetchItems:    100,
	}
}

// SyncPattern represents a sync pattern for an entity
type SyncPattern struct {
	EntityID       string        `json:"entity_id"`
	EntityType     string        `json:"entity_type"`
	AgentID        string        `json:"agent_id"`
	AvgSyncInterval time.Duration `json:"avg_sync_interval"`
	LastSyncTime   time.Time     `json:"last_sync_time"`
	SyncCount      int           `json:"sync_count"`
	ConflictCount  int           `json:"conflict_count"`
	FailureCount   int           `json:"failure_count"`
	PeakHours      []int         `json:"peak_hours"` // Hours with most activity
	DayOfWeekPattern []float64   `json:"day_of_week_pattern"` // Activity by day of week
}

// ConflictPrediction represents a conflict prediction
type ConflictPrediction struct {
	EntityID      string    `json:"entity_id"`
	EntityType    string    `json:"entity_type"`
	Probability   float64   `json:"probability"`
	PredictedAt   time.Time `json:"predicted_at"`
	Factors       []string  `json:"factors"`
	Recommendation string   `json:"recommendation"`
}

// PrefetchRecommendation represents a prefetch recommendation
type PrefetchRecommendation struct {
	EntityID    string    `json:"entity_id"`
	EntityType  string    `json:"entity_type"`
	Priority    float64   `json:"priority"`
	Reason      string    `json:"reason"`
	PredictedAt time.Time `json:"predicted_at"`
}

// SyncTimingOptimization represents optimal sync timing
type SyncTimingOptimization struct {
	AgentID           string        `json:"agent_id"`
	OptimalSyncTime   time.Time     `json:"optimal_sync_time"`
	OptimalInterval   time.Duration `json:"optimal_interval"`
	NetworkQuality    string        `json:"network_quality"`
	BatteryOptimal    bool          `json:"battery_optimal"`
	Confidence        float64       `json:"confidence"`
}

// PredictiveEngine provides ML-based predictions for sync
type PredictiveEngine struct {
	mu              sync.RWMutex
	config          *PredictiveConfig
	patterns        map[string]*SyncPattern // entityID -> pattern
	agentPatterns   map[string][]*SyncPattern // agentID -> patterns
	conflictHistory []ConflictEvent
	syncHistory     []SyncEvent
	models          *PredictiveModels
	metrics         *SyncMetrics
	stopCh          chan struct{}
	wg              sync.WaitGroup
}

// ConflictEvent represents a historical conflict
type ConflictEvent struct {
	EntityID   string    `json:"entity_id"`
	EntityType string    `json:"entity_type"`
	AgentID    string    `json:"agent_id"`
	Timestamp  time.Time `json:"timestamp"`
	Resolution string    `json:"resolution"`
	Duration   time.Duration `json:"duration"`
}

// PredictiveModels contains the ML models
type PredictiveModels struct {
	conflictModel    *ConflictPredictionModel
	timingModel      *TimingOptimizationModel
	prefetchModel    *PrefetchModel
}

// NewPredictiveEngine creates a new predictive engine
func NewPredictiveEngine(config *PredictiveConfig, metrics *SyncMetrics) *PredictiveEngine {
	if config == nil {
		config = DefaultPredictiveConfig()
	}

	pe := &PredictiveEngine{
		config:          config,
		patterns:        make(map[string]*SyncPattern),
		agentPatterns:   make(map[string][]*SyncPattern),
		conflictHistory: make([]ConflictEvent, 0),
		syncHistory:     make([]SyncEvent, 0),
		models: &PredictiveModels{
			conflictModel: NewConflictPredictionModel(),
			timingModel:   NewTimingOptimizationModel(),
			prefetchModel: NewPrefetchModel(),
		},
		metrics: metrics,
		stopCh:  make(chan struct{}),
	}

	return pe
}

// Start starts the predictive engine
func (pe *PredictiveEngine) Start(ctx context.Context) {
	pe.wg.Add(1)
	go pe.modelUpdateLoop(ctx)
}

// Stop stops the predictive engine
func (pe *PredictiveEngine) Stop() {
	close(pe.stopCh)
	pe.wg.Wait()
}

// RecordSync records a sync event for pattern learning
func (pe *PredictiveEngine) RecordSync(event *SyncEvent) {
	pe.mu.Lock()
	defer pe.mu.Unlock()

	// Add to history
	pe.syncHistory = append(pe.syncHistory, *event)

	// Trim old history
	cutoff := time.Now().Add(-pe.config.HistoryWindow)
	for len(pe.syncHistory) > 0 && pe.syncHistory[0].Timestamp.Before(cutoff) {
		pe.syncHistory = pe.syncHistory[1:]
	}

	// Update pattern
	pattern := pe.getOrCreatePattern(event.EntityID, event.Type, event.NodeID)
	pattern.SyncCount++
	if pattern.LastSyncTime.IsZero() {
		pattern.AvgSyncInterval = 0
	} else {
		interval := event.Timestamp.Sub(pattern.LastSyncTime)
		if pattern.AvgSyncInterval == 0 {
			pattern.AvgSyncInterval = interval
		} else {
			// Exponential moving average
			pattern.AvgSyncInterval = time.Duration(
				float64(pattern.AvgSyncInterval)*0.8 + float64(interval)*0.2,
			)
		}
	}
	pattern.LastSyncTime = event.Timestamp

	// Update peak hours
	hour := event.Timestamp.Hour()
	pe.updatePeakHours(pattern, hour)

	// Update day of week pattern
	dayOfWeek := int(event.Timestamp.Weekday())
	pe.updateDayOfWeekPattern(pattern, dayOfWeek)
}

// RecordConflict records a conflict event
func (pe *PredictiveEngine) RecordConflict(event *ConflictEvent) {
	pe.mu.Lock()
	defer pe.mu.Unlock()

	pe.conflictHistory = append(pe.conflictHistory, *event)

	// Trim old history
	cutoff := time.Now().Add(-pe.config.HistoryWindow)
	for len(pe.conflictHistory) > 0 && pe.conflictHistory[0].Timestamp.Before(cutoff) {
		pe.conflictHistory = pe.conflictHistory[1:]
	}

	// Update pattern
	if pattern, ok := pe.patterns[event.EntityID]; ok {
		pattern.ConflictCount++
	}
}

// PredictConflict predicts the probability of a conflict
func (pe *PredictiveEngine) PredictConflict(entityID, entityType, agentID string) *ConflictPrediction {
	pe.mu.RLock()
	defer pe.mu.RUnlock()

	pattern := pe.patterns[entityID]
	if pattern == nil {
		return &ConflictPrediction{
			EntityID:    entityID,
			EntityType:  entityType,
			Probability: 0.1, // Low default probability
			PredictedAt: time.Now(),
			Factors:     []string{"no_history"},
		}
	}

	// Calculate conflict probability using model
	features := pe.extractConflictFeatures(pattern, agentID)
	probability := pe.models.conflictModel.Predict(features)

	factors := make([]string, 0)
	recommendation := "proceed_normally"

	if pattern.ConflictCount > 0 {
		conflictRate := float64(pattern.ConflictCount) / float64(pattern.SyncCount)
		if conflictRate > 0.1 {
			factors = append(factors, "high_conflict_history")
		}
	}

	// Check if multiple agents are syncing
	if len(pe.agentPatterns[agentID]) > 1 {
		factors = append(factors, "multi_agent_access")
		probability *= 1.5
	}

	// Check sync frequency
	if pattern.AvgSyncInterval < 1*time.Minute {
		factors = append(factors, "high_sync_frequency")
		probability *= 1.3
	}

	// Clamp probability
	if probability > 1.0 {
		probability = 1.0
	}

	if probability > pe.config.ConflictThreshold {
		recommendation = "use_optimistic_locking"
	}

	return &ConflictPrediction{
		EntityID:       entityID,
		EntityType:     entityType,
		Probability:    probability,
		PredictedAt:    time.Now(),
		Factors:        factors,
		Recommendation: recommendation,
	}
}

// GetPrefetchRecommendations returns entities to prefetch before going offline
func (pe *PredictiveEngine) GetPrefetchRecommendations(agentID string, limit int) []*PrefetchRecommendation {
	pe.mu.RLock()
	defer pe.mu.RUnlock()

	if limit <= 0 {
		limit = pe.config.MaxPrefetchItems
	}

	recommendations := make([]*PrefetchRecommendation, 0)

	// Get agent's patterns
	patterns := pe.agentPatterns[agentID]
	if len(patterns) == 0 {
		return recommendations
	}

	// Score each entity for prefetch priority
	type scoredEntity struct {
		pattern  *SyncPattern
		priority float64
		reason   string
	}

	scored := make([]scoredEntity, 0)

	for _, pattern := range patterns {
		priority := pe.calculatePrefetchPriority(pattern)
		reason := pe.getPrefetchReason(pattern)

		if priority >= pe.config.PrefetchThreshold {
			scored = append(scored, scoredEntity{
				pattern:  pattern,
				priority: priority,
				reason:   reason,
			})
		}
	}

	// Sort by priority
	sort.Slice(scored, func(i, j int) bool {
		return scored[i].priority > scored[j].priority
	})

	// Take top N
	for i := 0; i < len(scored) && i < limit; i++ {
		recommendations = append(recommendations, &PrefetchRecommendation{
			EntityID:    scored[i].pattern.EntityID,
			EntityType:  scored[i].pattern.EntityType,
			Priority:    scored[i].priority,
			Reason:      scored[i].reason,
			PredictedAt: time.Now(),
		})
	}

	return recommendations
}

// OptimizeSyncTiming returns optimal sync timing for an agent
func (pe *PredictiveEngine) OptimizeSyncTiming(agentID string) *SyncTimingOptimization {
	pe.mu.RLock()
	defer pe.mu.RUnlock()

	patterns := pe.agentPatterns[agentID]
	if len(patterns) == 0 {
		return &SyncTimingOptimization{
			AgentID:         agentID,
			OptimalSyncTime: time.Now().Add(30 * time.Second),
			OptimalInterval: 30 * time.Second,
			NetworkQuality:  "unknown",
			BatteryOptimal:  true,
			Confidence:      0.5,
		}
	}

	// Analyze patterns to find optimal timing
	features := pe.extractTimingFeatures(patterns)
	optimalHour := pe.models.timingModel.PredictOptimalHour(features)
	optimalInterval := pe.models.timingModel.PredictOptimalInterval(features)

	// Calculate next optimal sync time
	now := time.Now()
	optimalTime := time.Date(
		now.Year(), now.Month(), now.Day(),
		optimalHour, 0, 0, 0, now.Location(),
	)
	if optimalTime.Before(now) {
		optimalTime = optimalTime.Add(24 * time.Hour)
	}

	return &SyncTimingOptimization{
		AgentID:         agentID,
		OptimalSyncTime: optimalTime,
		OptimalInterval: optimalInterval,
		NetworkQuality:  "good", // Would be determined by network monitoring
		BatteryOptimal:  true,
		Confidence:      0.8,
	}
}

// Helper methods

func (pe *PredictiveEngine) getOrCreatePattern(entityID, entityType, agentID string) *SyncPattern {
	pattern, ok := pe.patterns[entityID]
	if !ok {
		pattern = &SyncPattern{
			EntityID:         entityID,
			EntityType:       entityType,
			AgentID:          agentID,
			PeakHours:        make([]int, 0),
			DayOfWeekPattern: make([]float64, 7),
		}
		pe.patterns[entityID] = pattern

		// Add to agent patterns
		if _, ok := pe.agentPatterns[agentID]; !ok {
			pe.agentPatterns[agentID] = make([]*SyncPattern, 0)
		}
		pe.agentPatterns[agentID] = append(pe.agentPatterns[agentID], pattern)
	}
	return pattern
}

func (pe *PredictiveEngine) updatePeakHours(pattern *SyncPattern, hour int) {
	// Track top 3 peak hours
	hourCounts := make(map[int]int)
	for _, h := range pattern.PeakHours {
		hourCounts[h]++
	}
	hourCounts[hour]++

	// Find top 3
	type hourCount struct {
		hour  int
		count int
	}
	counts := make([]hourCount, 0)
	for h, c := range hourCounts {
		counts = append(counts, hourCount{h, c})
	}
	sort.Slice(counts, func(i, j int) bool {
		return counts[i].count > counts[j].count
	})

	pattern.PeakHours = make([]int, 0)
	for i := 0; i < len(counts) && i < 3; i++ {
		pattern.PeakHours = append(pattern.PeakHours, counts[i].hour)
	}
}

func (pe *PredictiveEngine) updateDayOfWeekPattern(pattern *SyncPattern, dayOfWeek int) {
	// Exponential moving average for each day
	for i := range pattern.DayOfWeekPattern {
		if i == dayOfWeek {
			pattern.DayOfWeekPattern[i] = pattern.DayOfWeekPattern[i]*0.9 + 0.1
		} else {
			pattern.DayOfWeekPattern[i] = pattern.DayOfWeekPattern[i] * 0.99
		}
	}
}

func (pe *PredictiveEngine) extractConflictFeatures(pattern *SyncPattern, agentID string) []float64 {
	features := make([]float64, 0)

	// Conflict rate
	if pattern.SyncCount > 0 {
		features = append(features, float64(pattern.ConflictCount)/float64(pattern.SyncCount))
	} else {
		features = append(features, 0)
	}

	// Sync frequency (normalized)
	if pattern.AvgSyncInterval > 0 {
		features = append(features, 1.0/pattern.AvgSyncInterval.Seconds())
	} else {
		features = append(features, 0)
	}

	// Number of agents accessing this entity
	agentCount := 0
	for _, patterns := range pe.agentPatterns {
		for _, p := range patterns {
			if p.EntityID == pattern.EntityID {
				agentCount++
			}
		}
	}
	features = append(features, float64(agentCount))

	// Time since last sync (normalized)
	if !pattern.LastSyncTime.IsZero() {
		features = append(features, time.Since(pattern.LastSyncTime).Seconds()/3600)
	} else {
		features = append(features, 0)
	}

	return features
}

func (pe *PredictiveEngine) extractTimingFeatures(patterns []*SyncPattern) []float64 {
	features := make([]float64, 0)

	// Average sync interval
	var totalInterval time.Duration
	for _, p := range patterns {
		totalInterval += p.AvgSyncInterval
	}
	if len(patterns) > 0 {
		features = append(features, float64(totalInterval/time.Duration(len(patterns)))/3600)
	} else {
		features = append(features, 0)
	}

	// Peak hour distribution
	hourCounts := make([]float64, 24)
	for _, p := range patterns {
		for _, h := range p.PeakHours {
			hourCounts[h]++
		}
	}
	features = append(features, hourCounts...)

	return features
}

func (pe *PredictiveEngine) calculatePrefetchPriority(pattern *SyncPattern) float64 {
	priority := 0.5 // Base priority

	// Higher priority for frequently synced entities
	if pattern.SyncCount > 10 {
		priority += 0.2
	}

	// Higher priority for recently synced entities
	if !pattern.LastSyncTime.IsZero() && time.Since(pattern.LastSyncTime) < 1*time.Hour {
		priority += 0.2
	}

	// Lower priority for entities with high conflict rate
	if pattern.SyncCount > 0 {
		conflictRate := float64(pattern.ConflictCount) / float64(pattern.SyncCount)
		priority -= conflictRate * 0.3
	}

	// Clamp
	if priority < 0 {
		priority = 0
	}
	if priority > 1 {
		priority = 1
	}

	return priority
}

func (pe *PredictiveEngine) getPrefetchReason(pattern *SyncPattern) string {
	if pattern.SyncCount > 20 {
		return "frequently_accessed"
	}
	if !pattern.LastSyncTime.IsZero() && time.Since(pattern.LastSyncTime) < 30*time.Minute {
		return "recently_accessed"
	}
	return "predicted_access"
}

func (pe *PredictiveEngine) modelUpdateLoop(ctx context.Context) {
	defer pe.wg.Done()

	ticker := time.NewTicker(pe.config.ModelUpdateInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-pe.stopCh:
			return
		case <-ticker.C:
			pe.updateModels()
		}
	}
}

func (pe *PredictiveEngine) updateModels() {
	pe.mu.Lock()
	defer pe.mu.Unlock()

	// Update conflict model with recent history
	pe.models.conflictModel.Train(pe.conflictHistory)

	// Update timing model with sync history
	pe.models.timingModel.Train(pe.syncHistory)

	// Update prefetch model with patterns
	patterns := make([]*SyncPattern, 0)
	for _, p := range pe.patterns {
		patterns = append(patterns, p)
	}
	pe.models.prefetchModel.Train(patterns)
}

// ConflictPredictionModel predicts conflicts
type ConflictPredictionModel struct {
	weights []float64
}

// NewConflictPredictionModel creates a new conflict prediction model
func NewConflictPredictionModel() *ConflictPredictionModel {
	return &ConflictPredictionModel{
		weights: []float64{0.4, 0.2, 0.3, 0.1}, // Default weights
	}
}

// Predict predicts conflict probability
func (m *ConflictPredictionModel) Predict(features []float64) float64 {
	if len(features) == 0 {
		return 0.1
	}

	// Simple weighted sum (in production, use proper ML model)
	var sum float64
	for i, f := range features {
		if i < len(m.weights) {
			sum += f * m.weights[i]
		}
	}

	// Sigmoid activation
	return 1.0 / (1.0 + math.Exp(-sum))
}

// Train trains the model
func (m *ConflictPredictionModel) Train(history []ConflictEvent) {
	// In production, implement proper training
	// For now, adjust weights based on history
	if len(history) > 100 {
		m.weights[0] = 0.5 // Increase conflict rate weight
	}
}

// TimingOptimizationModel optimizes sync timing
type TimingOptimizationModel struct {
	hourWeights []float64
}

// NewTimingOptimizationModel creates a new timing optimization model
func NewTimingOptimizationModel() *TimingOptimizationModel {
	return &TimingOptimizationModel{
		hourWeights: make([]float64, 24),
	}
}

// PredictOptimalHour predicts the optimal hour for sync
func (m *TimingOptimizationModel) PredictOptimalHour(features []float64) int {
	// Find hour with highest weight
	maxWeight := 0.0
	optimalHour := 0

	for i, w := range m.hourWeights {
		if w > maxWeight {
			maxWeight = w
			optimalHour = i
		}
	}

	return optimalHour
}

// PredictOptimalInterval predicts the optimal sync interval
func (m *TimingOptimizationModel) PredictOptimalInterval(features []float64) time.Duration {
	if len(features) > 0 && features[0] > 0 {
		return time.Duration(features[0] * float64(time.Hour))
	}
	return 30 * time.Second
}

// Train trains the model
func (m *TimingOptimizationModel) Train(history []SyncEvent) {
	// Count syncs per hour
	for _, event := range history {
		hour := event.Timestamp.Hour()
		m.hourWeights[hour]++
	}

	// Normalize
	var total float64
	for _, w := range m.hourWeights {
		total += w
	}
	if total > 0 {
		for i := range m.hourWeights {
			m.hourWeights[i] /= total
		}
	}
}

// PrefetchModel predicts entities to prefetch
type PrefetchModel struct {
	entityScores map[string]float64
}

// NewPrefetchModel creates a new prefetch model
func NewPrefetchModel() *PrefetchModel {
	return &PrefetchModel{
		entityScores: make(map[string]float64),
	}
}

// Train trains the model
func (m *PrefetchModel) Train(patterns []*SyncPattern) {
	for _, p := range patterns {
		// Score based on sync frequency and recency
		score := float64(p.SyncCount) / 100.0
		if !p.LastSyncTime.IsZero() {
			recency := 1.0 / (1.0 + time.Since(p.LastSyncTime).Hours())
			score += recency
		}
		m.entityScores[p.EntityID] = score
	}
}

// GetScore returns the prefetch score for an entity
func (m *PrefetchModel) GetScore(entityID string) float64 {
	if score, ok := m.entityScores[entityID]; ok {
		return score
	}
	return 0
}
