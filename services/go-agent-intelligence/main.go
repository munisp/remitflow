// Package main implements the Agent Intelligence Service.
// Provides demand heatmaps, dynamic float allocation, performance scoring,
// and agent-to-agent float rebalancing via real-time analytics.
// Port: 8130
package main

import (
	"database/sql"
	_ "github.com/lib/pq"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"sync"
	"syscall"
	"time"
)


var db *sql.DB

type AgentMetrics struct {
	AgentID       string  `json:"agentId"`
	TxCount       int     `json:"txCount"`
	TotalVolume   float64 `json:"totalVolume"`
	AvgTxSize     float64 `json:"avgTxSize"`
	PeakHour      int     `json:"peakHour"`
	ErrorRate     float64 `json:"errorRate"`
	CashInVolume  float64 `json:"cashInVolume"`
	CashOutVolume float64 `json:"cashOutVolume"`
}

type DemandHeatmap struct {
	AgentID   string  `json:"agentId"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Intensity string  `json:"intensity"` // low, medium, high, critical
	Volume24h float64 `json:"volume24h"`
	TxCount   int     `json:"txCount24h"`
}

type FloatRecommendation struct {
	AgentID           string  `json:"agentId"`
	CurrentFloat      float64 `json:"currentFloat"`
	RecommendedFloat  float64 `json:"recommendedFloat"`
	AvgDailyVolume    float64 `json:"avgDailyVolume"`
	PeakDayMultiplier float64 `json:"peakDayMultiplier"`
	BufferPercent     float64 `json:"bufferPercent"`
	Action            string  `json:"action"` // increase, decrease, maintain
}

type PerformanceScore struct {
	AgentID        string  `json:"agentId"`
	VolumeScore    float64 `json:"volumeScore"`
	ActivityScore  float64 `json:"activityScore"`
	ErrorScore     float64 `json:"errorScore"`
	CustomerScore  float64 `json:"customerScore"`
	OverallScore   float64 `json:"overallScore"`
	Tier           string  `json:"tier"` // bronze, silver, gold, platinum
	Rank           int     `json:"rank"`
}

type FloatTransferRequest struct {
	FromAgentID string  `json:"fromAgentId"`
	ToAgentID   string  `json:"toAgentId"`
	Amount      float64 `json:"amount"`
	Currency    string  `json:"currency"`
	Reason      string  `json:"reason"`
}

type FloatTransferResponse struct {
	TransferID string  `json:"transferId"`
	Status     string  `json:"status"`
	Amount     float64 `json:"amount"`
	Currency   string  `json:"currency"`
	FromAgent  string  `json:"fromAgent"`
	ToAgent    string  `json:"toAgent"`
	ApprovedAt string  `json:"approvedAt,omitempty"`
}

type AgentIntelligenceService struct {
	mu      sync.RWMutex
	metrics map[string]*AgentMetrics
	logger  *slog.Logger
}

func NewAgentIntelligenceService() *AgentIntelligenceService {
	return &AgentIntelligenceService{
		metrics: make(map[string]*AgentMetrics),
		logger:  slog.New(slog.NewJSONHandler(os.Stdout, nil)),
	}
}

func (s *AgentIntelligenceService) ComputeHeatmap() []DemandHeatmap {
	var heatmap []DemandHeatmap
	if db != nil {
		rows, err := db.Query("SELECT data FROM agent_intelligence_state WHERE id LIKE 'metrics:%' ORDER BY updated_at DESC LIMIT 100")
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var raw []byte
				if err := rows.Scan(&raw); err != nil {
					continue
				}
				var m AgentMetrics
				if err := json.Unmarshal(raw, &m); err != nil {
					continue
				}
				intensity := "low"
				if m.TxCount > 100 {
					intensity = "critical"
				} else if m.TxCount > 50 {
					intensity = "high"
				} else if m.TxCount > 20 {
					intensity = "medium"
				}
				heatmap = append(heatmap, DemandHeatmap{
					AgentID:   m.AgentID,
					Intensity: intensity,
					Volume24h: m.TotalVolume,
					TxCount:   m.TxCount,
				})
			}
			if len(heatmap) > 0 {
				return heatmap
			}
		}
	}
	// Fallback to in-memory
	s.mu.RLock()
	defer s.mu.RUnlock()
	for id, m := range s.metrics {
		intensity := "low"
		if m.TxCount > 100 {
			intensity = "critical"
		} else if m.TxCount > 50 {
			intensity = "high"
		} else if m.TxCount > 20 {
			intensity = "medium"
		}
		heatmap = append(heatmap, DemandHeatmap{
			AgentID:   id,
			Intensity: intensity,
			Volume24h: m.TotalVolume,
			TxCount:   m.TxCount,
		})
	}
	return heatmap
}

func (s *AgentIntelligenceService) ComputeFloatRecommendation(agentID string) FloatRecommendation {
	// DB-primary read (middleware-ready: swap to TigerBeetle in production)
	if db != nil {
		var m AgentMetrics
		if err := dbGet("metrics:"+agentID, &m); err == nil {
			avgDaily := m.TotalVolume / 7
			buffer := 1.3
			recommended := math.Ceil(avgDaily * buffer)
			action := "maintain"
			if recommended > m.TotalVolume*0.15 {
				action = "increase"
			} else if recommended < m.TotalVolume*0.08 {
				action = "decrease"
			}
			return FloatRecommendation{
				AgentID: agentID, RecommendedFloat: recommended,
				AvgDailyVolume: avgDaily, PeakDayMultiplier: 1.5,
				BufferPercent: 30, Action: action,
			}
		}
	}
	// Fallback to in-memory
	s.mu.RLock()
	defer s.mu.RUnlock()
	m, ok := s.metrics[agentID]
	if !ok {
		return FloatRecommendation{AgentID: agentID, Action: "maintain"}
	}
	avgDaily := m.TotalVolume / 7
	buffer := 1.3
	recommended := math.Ceil(avgDaily * buffer)
	action := "maintain"
	if recommended > m.TotalVolume*0.15 {
		action = "increase"
	} else if recommended < m.TotalVolume*0.08 {
		action = "decrease"
	}
	return FloatRecommendation{
		AgentID: agentID, RecommendedFloat: recommended,
		AvgDailyVolume: avgDaily, PeakDayMultiplier: 1.5,
		BufferPercent: 30, Action: action,
	}
}

func (s *AgentIntelligenceService) ComputePerformanceScores() []PerformanceScore {
	var scores []PerformanceScore
	if db != nil {
		rows, err := db.Query("SELECT data FROM agent_intelligence_state WHERE id LIKE 'metrics:%' ORDER BY updated_at DESC LIMIT 200")
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var raw []byte
				if err := rows.Scan(&raw); err != nil {
					continue
				}
				var m AgentMetrics
				if err := json.Unmarshal(raw, &m); err != nil {
					continue
				}
				volumeScore := math.Min(10, m.TotalVolume/1000000*2)
				activityScore := math.Min(10, float64(m.TxCount)/150*10)
				errorScore := 10 - math.Min(10, m.ErrorRate*100)
				customerScore := 8.0
				overall := (volumeScore + activityScore + errorScore + customerScore) / 4
				tier := "bronze"
				if overall > 8 {
					tier = "platinum"
				} else if overall > 6 {
					tier = "gold"
				} else if overall > 4 {
					tier = "silver"
				}
				scores = append(scores, PerformanceScore{
					AgentID: m.AgentID, VolumeScore: volumeScore, ActivityScore: activityScore,
					ErrorScore: errorScore, CustomerScore: customerScore,
					OverallScore: overall, Tier: tier,
				})
			}
			if len(scores) > 0 {
				sort.Slice(scores, func(i, j int) bool { return scores[i].OverallScore > scores[j].OverallScore })
				for i := range scores {
					scores[i].Rank = i + 1
				}
				return scores
			}
		}
	}
	// Fallback to in-memory
	s.mu.RLock()
	defer s.mu.RUnlock()
	for id, m := range s.metrics {
		volumeScore := math.Min(10, m.TotalVolume/1000000*2)
		activityScore := math.Min(10, float64(m.TxCount)/150*10)
		errorScore := 10 - math.Min(10, m.ErrorRate*100)
		customerScore := 8.0
		overall := (volumeScore + activityScore + errorScore + customerScore) / 4
		tier := "bronze"
		if overall > 8 {
			tier = "platinum"
		} else if overall > 6 {
			tier = "gold"
		} else if overall > 4 {
			tier = "silver"
		}
		scores = append(scores, PerformanceScore{
			AgentID: id, VolumeScore: volumeScore, ActivityScore: activityScore,
			ErrorScore: errorScore, CustomerScore: customerScore,
			OverallScore: overall, Tier: tier,
		})
	}
	sort.Slice(scores, func(i, j int) bool { return scores[i].OverallScore > scores[j].OverallScore })
	for i := range scores {
		scores[i].Rank = i + 1
	}
	return scores
}

func (s *AgentIntelligenceService) RecordTransaction(agentID string, amount float64) {
	s.mu.Lock()
	m, ok := s.metrics[agentID]
	if !ok {
		m = &AgentMetrics{AgentID: agentID}
		s.metrics[agentID] = m
	}
	m.TxCount++
	m.TotalVolume += amount
	if m.TxCount > 0 {
		m.AvgTxSize = m.TotalVolume / float64(m.TxCount)
	}
	metricsCopy := *m
	s.mu.Unlock()

	// Write-through to PostgreSQL (middleware-ready: swap to TigerBeetle/Kafka in production)
	if db != nil {
		go func() {
			_ = dbUpsert("metrics:"+agentID, metricsCopy)
			_ = dbLogEvent("transaction.recorded", map[string]interface{}{
				"agentId": agentID, "amount": amount, "txCount": metricsCopy.TxCount,
			})
		}()
	}
}


func initDB() error {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgresql://remitflow:remitflow123@localhost:5432/remitflow"
	}
	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err = db.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}
	// Create table if not exists
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS agent_intelligence_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_agent_intelligence_updated ON agent_intelligence_state(updated_at);
		CREATE TABLE IF NOT EXISTS agent_intelligence_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_agent_intelligence_events_type ON agent_intelligence_events(event_type, created_at);
	`)
	if err != nil {
		return fmt.Errorf("failed to create tables: %w", err)
	}
	slog.Info("database initialized", "service", "go-agent-intelligence", "table", "agent_intelligence_state")
	return nil
}

// dbUpsert stores or updates a record in the service state table
func dbUpsert(id string, data interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = db.Exec(`
		INSERT INTO agent_intelligence_state (id, data, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
		id, jsonData)
	return err
}

// dbGet retrieves a record from the service state table
func dbGet(id string, dest interface{}) error {
	var jsonData []byte
	err := db.QueryRow("SELECT data FROM agent_intelligence_state WHERE id = $1", id).Scan(&jsonData)
	if err != nil {
		return err
	}
	return json.Unmarshal(jsonData, dest)
}

// dbList retrieves all records from the service state table
func dbList(limit int) ([]json.RawMessage, error) {
	rows, err := db.Query("SELECT data FROM agent_intelligence_state ORDER BY updated_at DESC LIMIT $1", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var results []json.RawMessage
	for rows.Next() {
		var data json.RawMessage
		if err := rows.Scan(&data); err != nil {
			return nil, err
		}
		results = append(results, data)
	}
	return results, rows.Err()
}

// dbLogEvent stores an event in the events table
func dbLogEvent(eventType string, payload interface{}) error {
	jsonData, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = db.Exec("INSERT INTO agent_intelligence_events (event_type, payload) VALUES ($1, $2)",
		eventType, jsonData)
	return err
}


// loadFromDB populates in-memory state from database on startup (write-through cache warm)
func loadFromDB(svc *AgentIntelligenceService) {
	if db == nil {
		return
	}
	rows, err := db.Query("SELECT id, data FROM agent_intelligence_state WHERE id LIKE 'metrics:%'")
	if err != nil {
		slog.Warn("failed to load state from DB", "err", err)
		return
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var id string
		var data []byte
		if err := rows.Scan(&id, &data); err != nil {
			continue
		}
		var m AgentMetrics
		if err := json.Unmarshal(data, &m); err != nil {
			continue
		}
		// Strip "metrics:" prefix to get agentID
		agentID := id[8:]
		m.AgentID = agentID
		svc.mu.Lock()
		svc.metrics[agentID] = &m
		svc.mu.Unlock()
		count++
	}
	slog.Info("loaded persisted state from database", "records", count)
}

func main() {
	port := envOrDefault("PORT", "8130")

	svc := NewAgentIntelligenceService()

	if err := initDB(); err != nil {
		slog.Warn("database init failed, using in-memory fallback", "err", err)
	} else {
		slog.Info("database connected", "service", "go-agent-intelligence")
		loadFromDB(svc)
	}
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "agent-intelligence"})
	})

	mux.HandleFunc("/heatmap", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(svc.ComputeHeatmap())
	})

	mux.HandleFunc("/float-recommendation", func(w http.ResponseWriter, r *http.Request) {
		agentID := r.URL.Query().Get("agentId")
		if agentID == "" {
			http.Error(w, "agentId required", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(svc.ComputeFloatRecommendation(agentID))
	})

	mux.HandleFunc("/performance-scores", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(svc.ComputePerformanceScores())
	})

	mux.HandleFunc("/float-transfer", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req FloatTransferRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		resp := FloatTransferResponse{
			TransferID: fmt.Sprintf("FLT-%d", time.Now().UnixMilli()),
			Status:     "pending_approval",
			Amount:     req.Amount,
			Currency:   req.Currency,
			FromAgent:  req.FromAgentID,
			ToAgent:    req.ToAgentID,
		}
		// Persist transfer to DB (middleware-ready: in production this goes to TigerBeetle ledger)
		if db != nil {
			_ = dbUpsert("float-transfer:"+resp.TransferID, resp)
			_ = dbLogEvent("float_transfer.created", resp)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(resp)
	})

	mux.HandleFunc("/record-transaction", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			AgentID string  `json:"agentId"`
			Amount  float64 `json:"amount"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		svc.RecordTransaction(req.AgentID, req.Amount)
		w.WriteHeader(http.StatusNoContent)
	})

	srv := &http.Server{Addr: ":" + port, Handler: mux}
	go func() {
		svc.logger.Info("agent-intelligence service starting", "port", port)
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			svc.logger.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	
	// Periodic full state persistence to PostgreSQL (belt-and-suspenders with write-through)
	// In production, this would also publish to Kafka for downstream analytics
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			if db == nil {
				continue
			}
			svc.mu.RLock()
			for id, m := range svc.metrics {
				_ = dbUpsert("metrics:"+id, m)
			}
			svc.mu.RUnlock()
			_ = dbLogEvent("state_snapshot", map[string]interface{}{"metricsCount": len(svc.metrics)})
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
	svc.logger.Info("agent-intelligence service stopped")
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
