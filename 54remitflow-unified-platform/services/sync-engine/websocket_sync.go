// Package sync provides WebSocket-based real-time bi-directional synchronization
package sync

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// WebSocket message types
const (
	MsgTypeSync       = "sync"
	MsgTypeAck        = "ack"
	MsgTypeNack       = "nack"
	MsgTypePing       = "ping"
	MsgTypePong       = "pong"
	MsgTypeSubscribe  = "subscribe"
	MsgTypeUnsubscribe = "unsubscribe"
	MsgTypeEvent      = "event"
	MsgTypeConflict   = "conflict"
	MsgTypeResolution = "resolution"
)

// WebSocketMessage represents a message sent over WebSocket
type WebSocketMessage struct {
	Type      string                 `json:"type"`
	ID        string                 `json:"id"`
	Timestamp time.Time              `json:"timestamp"`
	NodeID    string                 `json:"node_id"`
	Payload   interface{}            `json:"payload,omitempty"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// SyncPayload represents sync data
type SyncPayload struct {
	EntityID   string                 `json:"entity_id"`
	EntityType string                 `json:"entity_type"`
	Operation  string                 `json:"operation"`
	Data       interface{}            `json:"data"`
	Clock      map[string]uint64      `json:"clock,omitempty"`
	Deltas     []*Delta               `json:"deltas,omitempty"`
	Sequence   uint64                 `json:"sequence"`
}

// WebSocketClient represents a connected client
type WebSocketClient struct {
	ID            string
	NodeID        string
	Conn          *websocket.Conn
	Send          chan []byte
	Subscriptions map[string]bool
	LastPing      time.Time
	LastPong      time.Time
	mu            sync.RWMutex
}

// WebSocketHub manages all WebSocket connections
type WebSocketHub struct {
	mu            sync.RWMutex
	clients       map[string]*WebSocketClient
	broadcast     chan []byte
	register      chan *WebSocketClient
	unregister    chan *WebSocketClient
	subscriptions map[string]map[string]bool // topic -> clientIDs
	handlers      map[string]MessageHandler
	metrics       *SyncMetrics
	nodeID        string
}

// MessageHandler handles incoming messages
type MessageHandler func(*WebSocketClient, *WebSocketMessage) error

// NewWebSocketHub creates a new WebSocket hub
func NewWebSocketHub(nodeID string, metrics *SyncMetrics) *WebSocketHub {
	return &WebSocketHub{
		clients:       make(map[string]*WebSocketClient),
		broadcast:     make(chan []byte, 256),
		register:      make(chan *WebSocketClient),
		unregister:    make(chan *WebSocketClient),
		subscriptions: make(map[string]map[string]bool),
		handlers:      make(map[string]MessageHandler),
		metrics:       metrics,
		nodeID:        nodeID,
	}
}

// Run starts the hub
func (h *WebSocketHub) Run(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client.ID] = client
			h.mu.Unlock()
			log.Printf("[WS] Client registered: %s (node: %s)", client.ID, client.NodeID)
			if h.metrics != nil {
				h.metrics.SetActiveConnections(float64(len(h.clients)))
			}
		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.ID]; ok {
				delete(h.clients, client.ID)
				close(client.Send)
				// Remove from subscriptions
				for topic := range client.Subscriptions {
					if h.subscriptions[topic] != nil {
						delete(h.subscriptions[topic], client.ID)
					}
				}
			}
			h.mu.Unlock()
			log.Printf("[WS] Client unregistered: %s", client.ID)
			if h.metrics != nil {
				h.metrics.SetActiveConnections(float64(len(h.clients)))
			}
		case message := <-h.broadcast:
			h.mu.RLock()
			for _, client := range h.clients {
				select {
				case client.Send <- message:
				default:
					close(client.Send)
					delete(h.clients, client.ID)
				}
			}
			h.mu.RUnlock()
		case <-ticker.C:
			h.checkConnections()
		}
	}
}

// checkConnections checks for stale connections
func (h *WebSocketHub) checkConnections() {
	h.mu.Lock()
	defer h.mu.Unlock()

	now := time.Now()
	for id, client := range h.clients {
		if now.Sub(client.LastPong) > 60*time.Second {
			log.Printf("[WS] Closing stale connection: %s", id)
			close(client.Send)
			delete(h.clients, id)
		}
	}
}

// RegisterHandler registers a message handler
func (h *WebSocketHub) RegisterHandler(msgType string, handler MessageHandler) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.handlers[msgType] = handler
}

// Subscribe subscribes a client to a topic
func (h *WebSocketHub) Subscribe(clientID, topic string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.subscriptions[topic] == nil {
		h.subscriptions[topic] = make(map[string]bool)
	}
	h.subscriptions[topic][clientID] = true

	if client, ok := h.clients[clientID]; ok {
		client.mu.Lock()
		client.Subscriptions[topic] = true
		client.mu.Unlock()
	}
}

// Unsubscribe unsubscribes a client from a topic
func (h *WebSocketHub) Unsubscribe(clientID, topic string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.subscriptions[topic] != nil {
		delete(h.subscriptions[topic], clientID)
	}

	if client, ok := h.clients[clientID]; ok {
		client.mu.Lock()
		delete(client.Subscriptions, topic)
		client.mu.Unlock()
	}
}

// PublishToTopic publishes a message to all subscribers of a topic
func (h *WebSocketHub) PublishToTopic(topic string, msg *WebSocketMessage) {
	h.mu.RLock()
	subscribers := h.subscriptions[topic]
	h.mu.RUnlock()

	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[WS] Failed to marshal message: %v", err)
		return
	}

	h.mu.RLock()
	for clientID := range subscribers {
		if client, ok := h.clients[clientID]; ok {
			select {
			case client.Send <- data:
			default:
				// Client buffer full, skip
			}
		}
	}
	h.mu.RUnlock()
}

// Broadcast broadcasts a message to all clients
func (h *WebSocketHub) Broadcast(msg *WebSocketMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[WS] Failed to marshal message: %v", err)
		return
	}
	h.broadcast <- data
}

// SendToClient sends a message to a specific client
func (h *WebSocketHub) SendToClient(clientID string, msg *WebSocketMessage) error {
	h.mu.RLock()
	client, ok := h.clients[clientID]
	h.mu.RUnlock()

	if !ok {
		return fmt.Errorf("client not found: %s", clientID)
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	select {
	case client.Send <- data:
		return nil
	default:
		return fmt.Errorf("client buffer full: %s", clientID)
	}
}

// GetConnectedClients returns list of connected client IDs
func (h *WebSocketHub) GetConnectedClients() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()

	clients := make([]string, 0, len(h.clients))
	for id := range h.clients {
		clients = append(clients, id)
	}
	return clients
}

// WebSocketServer handles WebSocket connections
type WebSocketServer struct {
	hub      *WebSocketHub
	upgrader websocket.Upgrader
	nodeID   string
}

// NewWebSocketServer creates a new WebSocket server
func NewWebSocketServer(hub *WebSocketHub, nodeID string) *WebSocketServer {
	return &WebSocketServer{
		hub:    hub,
		nodeID: nodeID,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins (configure for production)
			},
		},
	}
}

// HandleConnection handles a new WebSocket connection
func (s *WebSocketServer) HandleConnection(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WS] Upgrade failed: %v", err)
		return
	}

	clientID := r.URL.Query().Get("client_id")
	if clientID == "" {
		clientID = fmt.Sprintf("client-%d", time.Now().UnixNano())
	}

	nodeID := r.URL.Query().Get("node_id")
	if nodeID == "" {
		nodeID = "unknown"
	}

	client := &WebSocketClient{
		ID:            clientID,
		NodeID:        nodeID,
		Conn:          conn,
		Send:          make(chan []byte, 256),
		Subscriptions: make(map[string]bool),
		LastPing:      time.Now(),
		LastPong:      time.Now(),
	}

	s.hub.register <- client

	go s.writePump(client)
	go s.readPump(client)
}

// readPump reads messages from the WebSocket connection
func (s *WebSocketServer) readPump(client *WebSocketClient) {
	defer func() {
		s.hub.unregister <- client
		client.Conn.Close()
	}()

	client.Conn.SetReadLimit(512 * 1024) // 512KB max message size
	client.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	client.Conn.SetPongHandler(func(string) error {
		client.mu.Lock()
		client.LastPong = time.Now()
		client.mu.Unlock()
		client.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := client.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[WS] Read error: %v", err)
			}
			break
		}

		var msg WebSocketMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("[WS] Invalid message: %v", err)
			continue
		}

		s.handleMessage(client, &msg)
	}
}

// writePump writes messages to the WebSocket connection
func (s *WebSocketServer) writePump(client *WebSocketClient) {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		client.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-client.Send:
			client.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				client.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := client.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Batch pending messages
			n := len(client.Send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-client.Send)
			}

			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			client.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := client.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
			client.mu.Lock()
			client.LastPing = time.Now()
			client.mu.Unlock()
		}
	}
}

// handleMessage handles incoming messages
func (s *WebSocketServer) handleMessage(client *WebSocketClient, msg *WebSocketMessage) {
	switch msg.Type {
	case MsgTypePing:
		s.handlePing(client, msg)
	case MsgTypeSubscribe:
		s.handleSubscribe(client, msg)
	case MsgTypeUnsubscribe:
		s.handleUnsubscribe(client, msg)
	case MsgTypeSync:
		s.handleSync(client, msg)
	case MsgTypeAck:
		s.handleAck(client, msg)
	default:
		// Check for registered handlers
		s.hub.mu.RLock()
		handler, ok := s.hub.handlers[msg.Type]
		s.hub.mu.RUnlock()

		if ok {
			if err := handler(client, msg); err != nil {
				log.Printf("[WS] Handler error: %v", err)
			}
		} else {
			log.Printf("[WS] Unknown message type: %s", msg.Type)
		}
	}
}

func (s *WebSocketServer) handlePing(client *WebSocketClient, msg *WebSocketMessage) {
	response := &WebSocketMessage{
		Type:      MsgTypePong,
		ID:        msg.ID,
		Timestamp: time.Now(),
		NodeID:    s.nodeID,
	}
	s.hub.SendToClient(client.ID, response)
}

func (s *WebSocketServer) handleSubscribe(client *WebSocketClient, msg *WebSocketMessage) {
	if payload, ok := msg.Payload.(map[string]interface{}); ok {
		if topic, ok := payload["topic"].(string); ok {
			s.hub.Subscribe(client.ID, topic)
			log.Printf("[WS] Client %s subscribed to %s", client.ID, topic)
		}
	}
}

func (s *WebSocketServer) handleUnsubscribe(client *WebSocketClient, msg *WebSocketMessage) {
	if payload, ok := msg.Payload.(map[string]interface{}); ok {
		if topic, ok := payload["topic"].(string); ok {
			s.hub.Unsubscribe(client.ID, topic)
			log.Printf("[WS] Client %s unsubscribed from %s", client.ID, topic)
		}
	}
}

func (s *WebSocketServer) handleSync(client *WebSocketClient, msg *WebSocketMessage) {
	// Process sync message
	log.Printf("[WS] Received sync from %s: %s", client.ID, msg.ID)

	// Send acknowledgment
	ack := &WebSocketMessage{
		Type:      MsgTypeAck,
		ID:        msg.ID,
		Timestamp: time.Now(),
		NodeID:    s.nodeID,
	}
	s.hub.SendToClient(client.ID, ack)
}

func (s *WebSocketServer) handleAck(client *WebSocketClient, msg *WebSocketMessage) {
	log.Printf("[WS] Received ack from %s for message %s", client.ID, msg.ID)
}

// BiDirectionalSync manages bi-directional sync over WebSocket
type BiDirectionalSync struct {
	hub           *WebSocketHub
	nodeID        string
	pendingAcks   map[string]chan bool
	mu            sync.RWMutex
	syncManager   *SyncManager
	deltaManager  *DeltaSyncManager
	priorityQueue *SyncPriorityQueue
	metrics       *SyncMetrics
}

// NewBiDirectionalSync creates a new bi-directional sync manager
func NewBiDirectionalSync(
	hub *WebSocketHub,
	nodeID string,
	syncManager *SyncManager,
	deltaManager *DeltaSyncManager,
	priorityQueue *SyncPriorityQueue,
	metrics *SyncMetrics,
) *BiDirectionalSync {
	return &BiDirectionalSync{
		hub:           hub,
		nodeID:        nodeID,
		pendingAcks:   make(map[string]chan bool),
		syncManager:   syncManager,
		deltaManager:  deltaManager,
		priorityQueue: priorityQueue,
		metrics:       metrics,
	}
}

// SyncEntity syncs an entity to all connected clients
func (bds *BiDirectionalSync) SyncEntity(entityID, entityType, operation string, data interface{}) error {
	// Create sync event
	event := bds.syncManager.CreateEvent(operation, entityID, data, map[string]interface{}{
		"entity_type": entityType,
	})

	// Create message
	msg := &WebSocketMessage{
		Type:      MsgTypeSync,
		ID:        event.ID,
		Timestamp: time.Now(),
		NodeID:    bds.nodeID,
		Payload: &SyncPayload{
			EntityID:   entityID,
			EntityType: entityType,
			Operation:  operation,
			Data:       data,
			Clock:      event.Clock,
			Sequence:   0,
		},
	}

	// Create ack channel
	bds.mu.Lock()
	ackCh := make(chan bool, 1)
	bds.pendingAcks[event.ID] = ackCh
	bds.mu.Unlock()

	// Broadcast to all clients
	bds.hub.Broadcast(msg)

	// Record metrics
	if bds.metrics != nil {
		bds.metrics.RecordSyncOperation(bds.nodeID, "outbound", "sent", entityType)
	}

	return nil
}

// SyncEntityToTopic syncs an entity to subscribers of a topic
func (bds *BiDirectionalSync) SyncEntityToTopic(topic, entityID, entityType, operation string, data interface{}) error {
	event := bds.syncManager.CreateEvent(operation, entityID, data, map[string]interface{}{
		"entity_type": entityType,
		"topic":       topic,
	})

	msg := &WebSocketMessage{
		Type:      MsgTypeSync,
		ID:        event.ID,
		Timestamp: time.Now(),
		NodeID:    bds.nodeID,
		Payload: &SyncPayload{
			EntityID:   entityID,
			EntityType: entityType,
			Operation:  operation,
			Data:       data,
			Clock:      event.Clock,
		},
	}

	bds.hub.PublishToTopic(topic, msg)
	return nil
}

// SyncDeltas syncs deltas for an entity
func (bds *BiDirectionalSync) SyncDeltas(entityID, entityType string) error {
	deltaSet := bds.deltaManager.GetSyncPayload(entityID)
	if deltaSet == nil {
		return nil
	}

	msg := &WebSocketMessage{
		Type:      MsgTypeSync,
		ID:        fmt.Sprintf("delta-%s-%d", entityID, deltaSet.Sequence),
		Timestamp: time.Now(),
		NodeID:    bds.nodeID,
		Payload: &SyncPayload{
			EntityID:   entityID,
			EntityType: entityType,
			Operation:  "delta",
			Deltas:     deltaSet.Deltas,
			Sequence:   deltaSet.Sequence,
		},
	}

	bds.hub.Broadcast(msg)

	if bds.metrics != nil {
		bds.metrics.RecordDelta(bds.nodeID, "sent")
	}

	return nil
}

// HandleIncomingSync handles incoming sync messages
func (bds *BiDirectionalSync) HandleIncomingSync(client *WebSocketClient, msg *WebSocketMessage) error {
	payload, ok := msg.Payload.(*SyncPayload)
	if !ok {
		// Try to convert from map
		if payloadMap, ok := msg.Payload.(map[string]interface{}); ok {
			payload = &SyncPayload{}
			if v, ok := payloadMap["entity_id"].(string); ok {
				payload.EntityID = v
			}
			if v, ok := payloadMap["entity_type"].(string); ok {
				payload.EntityType = v
			}
			if v, ok := payloadMap["operation"].(string); ok {
				payload.Operation = v
			}
			payload.Data = payloadMap["data"]
		} else {
			return fmt.Errorf("invalid payload")
		}
	}

	// Process based on operation
	switch payload.Operation {
	case "delta":
		// Apply deltas
		log.Printf("[SYNC] Received deltas for %s from %s", payload.EntityID, client.NodeID)
	default:
		// Full sync
		log.Printf("[SYNC] Received sync for %s from %s", payload.EntityID, client.NodeID)
	}

	// Record metrics
	if bds.metrics != nil {
		bds.metrics.RecordSyncOperation(bds.nodeID, "inbound", "received", payload.EntityType)
	}

	// Send ack
	ack := &WebSocketMessage{
		Type:      MsgTypeAck,
		ID:        msg.ID,
		Timestamp: time.Now(),
		NodeID:    bds.nodeID,
	}
	return bds.hub.SendToClient(client.ID, ack)
}

// HandleAck handles acknowledgment messages
func (bds *BiDirectionalSync) HandleAck(client *WebSocketClient, msg *WebSocketMessage) error {
	bds.mu.Lock()
	if ch, ok := bds.pendingAcks[msg.ID]; ok {
		ch <- true
		delete(bds.pendingAcks, msg.ID)
	}
	bds.mu.Unlock()
	return nil
}

// SSEServer provides Server-Sent Events for one-way sync
type SSEServer struct {
	mu      sync.RWMutex
	clients map[string]chan []byte
	nodeID  string
}

// NewSSEServer creates a new SSE server
func NewSSEServer(nodeID string) *SSEServer {
	return &SSEServer{
		clients: make(map[string]chan []byte),
		nodeID:  nodeID,
	}
}

// HandleSSE handles SSE connections
func (s *SSEServer) HandleSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	clientID := r.URL.Query().Get("client_id")
	if clientID == "" {
		clientID = fmt.Sprintf("sse-%d", time.Now().UnixNano())
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	messageChan := make(chan []byte, 100)

	s.mu.Lock()
	s.clients[clientID] = messageChan
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.clients, clientID)
		close(messageChan)
		s.mu.Unlock()
	}()

	// Send initial connection event
	fmt.Fprintf(w, "event: connected\ndata: {\"client_id\":\"%s\"}\n\n", clientID)
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case msg := <-messageChan:
			fmt.Fprintf(w, "event: sync\ndata: %s\n\n", msg)
			flusher.Flush()
		}
	}
}

// Broadcast sends a message to all SSE clients
func (s *SSEServer) Broadcast(data interface{}) {
	msg, err := json.Marshal(data)
	if err != nil {
		return
	}

	s.mu.RLock()
	for _, ch := range s.clients {
		select {
		case ch <- msg:
		default:
			// Client buffer full, skip
		}
	}
	s.mu.RUnlock()
}

// SendToClient sends a message to a specific SSE client
func (s *SSEServer) SendToClient(clientID string, data interface{}) error {
	msg, err := json.Marshal(data)
	if err != nil {
		return err
	}

	s.mu.RLock()
	ch, ok := s.clients[clientID]
	s.mu.RUnlock()

	if !ok {
		return fmt.Errorf("client not found: %s", clientID)
	}

	select {
	case ch <- msg:
		return nil
	default:
		return fmt.Errorf("client buffer full: %s", clientID)
	}
}
