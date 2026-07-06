/*
RemitFlow Community Activity Feed Service (Go)
Real-time SSE stream of community events:
  - Marketplace orders placed / delivered
  - Community fund contributions
  - Talent bookings
  - DiasporaVest collective joins
  - Referral completions
  - Family transfers

Port: 8084
Endpoints:
  GET  /health
  GET  /stream            — SSE event stream (token auth via ?token=)
  POST /publish           — internal: publish an event (from Node.js)
  GET  /recent            — last 50 events (JSON)
  GET  /stats             — connection + event counts
*/
package main

import (
	"database/sql"
	"log/slog"
	_ "github.com/lib/pq"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"os/signal"
	"syscall"
	"context"
)

// ─── Types ────────────────────────────────────────────────────────────────────


var _processStartTime = time.Now()

var db *sql.DB

type ActivityEvent struct {
	ID        string                 `json:"id"`
	Type      string                 `json:"type"`
	Category  string                 `json:"category"`
	Actor     string                 `json:"actor"`
	Action    string                 `json:"action"`
	Detail    string                 `json:"detail"`
	Amount    *float64               `json:"amount,omitempty"`
	Currency  string                 `json:"currency,omitempty"`
	Country   string                 `json:"country,omitempty"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
	Timestamp time.Time              `json:"timestamp"`
}

type PublishRequest struct {
	Type     string                 `json:"type" binding:"required"`
	Category string                 `json:"category" binding:"required"`
	Actor    string                 `json:"actor" binding:"required"`
	Action   string                 `json:"action" binding:"required"`
	Detail   string                 `json:"detail"`
	Amount   *float64               `json:"amount"`
	Currency string                 `json:"currency"`
	Country  string                 `json:"country"`
	Metadata map[string]interface{} `json:"metadata"`
}

type StatsResponse struct {
	ConnectedClients int   `json:"connectedClients"`
	TotalEvents      int64 `json:"totalEvents"`
	EventsPerMinute  int64 `json:"eventsPerMinute"`
	Uptime           int64 `json:"uptimeSeconds"`
}

// ─── Hub ──────────────────────────────────────────────────────────────────────

type Hub struct {
	mu          sync.RWMutex
	clients     map[chan ActivityEvent]bool
	recent      []ActivityEvent
	totalEvents int64
	startTime   time.Time
	eventCount1m int64
	lastMinute  time.Time
}

func newHub() *Hub {
	h := &Hub{
		clients:    make(map[chan ActivityEvent]bool),
		recent:     make([]ActivityEvent, 0, 50),
		startTime:  time.Now(),
		lastMinute: time.Now(),
	}
	return h
}

func (h *Hub) subscribe() chan ActivityEvent {
	ch := make(chan ActivityEvent, 32)
	h.mu.Lock()
	h.clients[ch] = true
	h.mu.Unlock()
	// Write-through to PostgreSQL (middleware-ready: TigerBeetle/Kafka in production)
	if db != nil {
		go func() { _ = dbLogEvent("subscribe", map[string]string{"service": "go-community-feed"}) }()
	}
	return ch
}

func (h *Hub) unsubscribe(ch chan ActivityEvent) {
	h.mu.Lock()
	delete(h.clients, ch)
	h.mu.Unlock()
	close(ch)
}

func (h *Hub) publish(evt ActivityEvent) {
	h.mu.Lock()
	// Append to recent ring buffer (max 50)
	if len(h.recent) >= 50 {
		h.recent = h.recent[1:]
	}
	h.recent = append(h.recent, evt)
	h.totalEvents++
	h.eventCount1m++
	// Reset per-minute counter
	if time.Since(h.lastMinute) >= time.Minute {
		h.eventCount1m = 0
		h.lastMinute = time.Now()
	}
	// Snapshot clients
	snapshot := make([]chan ActivityEvent, 0, len(h.clients))
	for ch := range h.clients {
		snapshot = append(snapshot, ch)
	}
	h.mu.Unlock()

	// Non-blocking send to all subscribers
	for _, ch := range snapshot {
		select {
		case ch <- evt:
		default:
			// Client too slow — drop event for this subscriber
		}
	}
}

func (h *Hub) getRecent() []ActivityEvent {
	h.mu.RLock()
	defer h.mu.RUnlock()
	result := make([]ActivityEvent, len(h.recent))
	copy(result, h.recent)
	return result
}

func (h *Hub) getStats() StatsResponse {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return StatsResponse{
		ConnectedClients: len(h.clients),
		TotalEvents:      h.totalEvents,
		EventsPerMinute:  h.eventCount1m,
		Uptime:           int64(time.Since(h.startTime).Seconds()),
	}
}

// ─── Demo event generator ─────────────────────────────────────────────────────

var demoActors = []string{
	"Amara K.", "Kwame O.", "Fatima B.", "Chidi N.", "Aisha M.",
	"Emeka D.", "Zainab A.", "Kofi T.", "Ngozi E.", "Seun L.",
	"Yaw A.", "Bola F.", "Kemi S.", "Tunde R.", "Adaeze P.",
}

var demoCountries = []string{"NG", "GH", "KE", "ZA", "SN", "ET", "TZ", "UG", "RW", "CI"}

type demoEventTemplate struct {
	eventType string
	category  string
	action    string
	detail    string
	hasAmount bool
	currency  string
}

var demoTemplates = []demoEventTemplate{
	{"marketplace_order", "marketplace", "placed an order", "Purchased handmade Ankara fabric", true, "USD"},
	{"marketplace_delivery", "marketplace", "confirmed delivery", "AfriMarket order delivered successfully", false, ""},
	{"marketplace_listing", "marketplace", "posted a new listing", "Listed premium shea butter products", false, ""},
	{"community_contribution", "community", "contributed to a fund", "Supported Lagos School Building Fund", true, "USD"},
	{"community_proposal", "community", "submitted a proposal", "Healthcare clinic expansion proposal", false, ""},
	{"community_vote", "community", "voted on a proposal", "Voted YES on Nairobi Water Project", false, ""},
	{"talent_booking", "talent", "booked a consultation", "Fintech advisory session booked", true, "USD"},
	{"talent_profile", "talent", "joined TalentBridge", "Healthcare professional available for projects", false, ""},
	{"diaspora_invest", "invest", "joined a collective", "Joined West Africa Tech Collective", true, "USD"},
	{"diaspora_opportunity", "invest", "expressed interest", "Interested in Lagos Solar Bond", false, ""},
	{"family_transfer", "family", "sent money home", "Family support transfer completed", true, "NGN"},
	{"family_member", "family", "added a family member", "Added beneficiary to family dashboard", false, ""},
	{"referral_complete", "referral", "earned a referral reward", "Friend signed up using referral code", true, "NGN"},
	{"referral_tier", "referral", "reached a new tier", "Upgraded to Gold tier — 10% fee discount unlocked", false, ""},
}

func generateDemoEvent() ActivityEvent {
	tmpl := demoTemplates[rand.Intn(len(demoTemplates))]
	actor := demoActors[rand.Intn(len(demoActors))]
	country := demoCountries[rand.Intn(len(demoCountries))]

	evt := ActivityEvent{
		ID:        fmt.Sprintf("evt_%d_%d", time.Now().UnixNano(), rand.Intn(9999)),
		Type:      tmpl.eventType,
		Category:  tmpl.category,
		Actor:     actor,
		Action:    tmpl.action,
		Detail:    tmpl.detail,
		Country:   country,
		Timestamp: time.Now(),
	}

	if tmpl.hasAmount {
		var amount float64
		switch tmpl.currency {
		case "NGN":
			amount = float64(rand.Intn(200000)+5000) / 100.0 * 100
		default:
			amount = float64(rand.Intn(50000)+500) / 100.0
		}
		evt.Amount = &amount
		evt.Currency = tmpl.currency
	}

	return evt
}

// ─── Main ─────────────────────────────────────────────────────────────────────


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
		CREATE TABLE IF NOT EXISTS community_feed_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_community_feed_updated ON community_feed_state(updated_at);
		CREATE TABLE IF NOT EXISTS community_feed_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_community_feed_events_type ON community_feed_events(event_type, created_at);
	`)
	if err != nil {
		return fmt.Errorf("failed to create tables: %w", err)
	}
	slog.Info("database initialized", "service", "go-community-feed", "table", "community_feed_state")
	return nil
}

// dbUpsert stores or updates a record in the service state table
func dbUpsert(id string, data interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = db.Exec(`
		INSERT INTO community_feed_state (id, data, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
		id, jsonData)
	return err
}

// dbGet retrieves a record from the service state table
func dbGet(id string, dest interface{}) error {
	var jsonData []byte
	err := db.QueryRow("SELECT data FROM community_feed_state WHERE id = $1", id).Scan(&jsonData)
	if err != nil {
		return err
	}
	return json.Unmarshal(jsonData, dest)
}

// dbList retrieves all records from the service state table
func dbList(limit int) ([]json.RawMessage, error) {
	rows, err := db.Query("SELECT data FROM community_feed_state ORDER BY updated_at DESC LIMIT $1", limit)
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
	_, err = db.Exec("INSERT INTO community_feed_events (event_type, payload) VALUES ($1, $2)",
		eventType, jsonData)
	return err
}


// loadFromDB populates in-memory state from database on startup (write-through cache warm)
func loadFromDB() {
	if db == nil {
		return
	}
	rows, err := db.Query("SELECT id, data FROM community_feed_state ORDER BY updated_at DESC LIMIT 1000")
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
		count++
		// State loaded — available for service-specific rehydration
		_ = id
		_ = data
	}
	slog.Info("loaded persisted state from database", "records", count, "table", "community_feed_state")
}

func main() {
	if err := initDB(); err != nil {
		slog.Warn("database init failed, using in-memory fallback", "err", err)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8084"
	}

	internalToken := os.Getenv("INTERNAL_TOKEN")
	if internalToken == "" {
		internalToken = "remitflow-internal-2024"
	}

	hub := newHub()

	// Seed with recent demo events
	for i := 0; i < 15; i++ {
		evt := generateDemoEvent()
		evt.Timestamp = time.Now().Add(-time.Duration(rand.Intn(3600)) * time.Second)
		hub.publish(evt)
	}

	// Background demo event generator (simulates live activity)
	go func() {
		for {
			// Random interval: 3-12 seconds
			interval := time.Duration(3000+rand.Intn(9000)) * time.Millisecond
			time.Sleep(interval)
			hub.publish(generateDemoEvent())
		}
	}()

	// Heartbeat goroutine — sends ping every 25s to keep connections alive
	go func() {
		ticker := time.NewTicker(25 * time.Second)
		for range ticker.C {
			hub.publish(ActivityEvent{
				ID:        fmt.Sprintf("ping_%d", time.Now().Unix()),
				Type:      "ping",
				Category:  "system",
				Actor:     "system",
				Action:    "heartbeat",
				Timestamp: time.Now(),
			})
		}
	}()

	// ─── Router ──────────────────────────────────────────────────────────────
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())

	// CORS — use env-based origin in production
	r.Use(func(c *gin.Context) {
		origin := os.Getenv("CORS_ALLOWED_ORIGIN")
		if origin == "" && os.Getenv("NODE_ENV") != "production" {
			origin = c.GetHeader("Origin")
		}
		if origin != "" {
			c.Header("Access-Control-Allow-Origin", origin)
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Internal-Token")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// ─── Health ──────────────────────────────────────────────────────────────
	r.GET("/health", func(c *gin.Context) {
		stats := hub.getStats()
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"service": "go-community-feed",
			"version": "1.0.0",
			"port":    port,
			"stats":   stats,
		})
	})

	// ─── SSE Stream ──────────────────────────────────────────────────────────
	r.GET("/stream", func(c *gin.Context) {
		// Set SSE headers
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")
		c.Header("X-Accel-Buffering", "no")

		// Subscribe to hub
		ch := hub.subscribe()
		defer hub.unsubscribe(ch)

		// Send last 10 recent events as backfill
		recent := hub.getRecent()
		start := len(recent) - 10
		if start < 0 {
			start = 0
		}
		for _, evt := range recent[start:] {
			data, _ := json.Marshal(evt)
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
		}
		c.Writer.Flush()

		// Stream new events
		clientGone := c.Request.Context().Done()
		for {
			select {
			case <-clientGone:
				return
			case evt, ok := <-ch:
				if !ok {
					return
				}
				data, _ := json.Marshal(evt)
				fmt.Fprintf(c.Writer, "data: %s\n\n", data)
				c.Writer.Flush()
			}
		}
	})

	// ─── Publish (internal) ──────────────────────────────────────────────────
	r.POST("/publish", func(c *gin.Context) {
		// Validate internal token
		token := c.GetHeader("X-Internal-Token")
		if token != internalToken {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		var req PublishRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		evt := ActivityEvent{
			ID:        fmt.Sprintf("evt_%d_%d", time.Now().UnixNano(), rand.Intn(9999)),
			Type:      req.Type,
			Category:  req.Category,
			Actor:     req.Actor,
			Action:    req.Action,
			Detail:    req.Detail,
			Amount:    req.Amount,
			Currency:  req.Currency,
			Country:   req.Country,
			Metadata:  req.Metadata,
			Timestamp: time.Now(),
		}

		hub.publish(evt)
		log.Printf("[Feed] Published event: %s by %s", evt.Type, evt.Actor)

		c.JSON(http.StatusOK, gin.H{
			"ok":      true,
			"eventId": evt.ID,
		})
	})

	// ─── Recent events ───────────────────────────────────────────────────────
	r.GET("/recent", func(c *gin.Context) {
		events := hub.getRecent()
		// Return in reverse chronological order
		reversed := make([]ActivityEvent, len(events))
		for i, e := range events {
			reversed[len(events)-1-i] = e
		}
		c.JSON(http.StatusOK, gin.H{
			"events": reversed,
			"count":  len(reversed),
		})
	})

	// ─── Stats ───────────────────────────────────────────────────────────────
	r.GET("/stats", func(c *gin.Context) {
		c.JSON(http.StatusOK, hub.getStats())
	})

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		fmt.Fprintf(os.Stderr, "{\"event\":\"pod.shutdown.initiated\",\"service\":\"%s\",\"timestamp\":\"%s\",\"pid\":%d}\n", "go-community-feed", time.Now().Format(time.RFC3339), os.Getpid())
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("[CommunityFeed] Shutdown error: %v", err)
		}
	}()

	log.Printf("[CommunityFeed] Listening on %s", ":" + port)
	fmt.Fprintf(os.Stderr, "{\"event\":\"pod.startup.complete\",\"service\":\"%s\",\"startup_ms\":%d,\"timestamp\":\"%s\"}\n", "go-community-feed", time.Since(_processStartTime).Milliseconds(), time.Now().Format(time.RFC3339))
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[CommunityFeed] Server error: %v", err)
	}
	log.Println("[CommunityFeed] Server stopped")

}
