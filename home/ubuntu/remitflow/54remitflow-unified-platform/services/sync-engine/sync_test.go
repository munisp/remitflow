// Package sync provides comprehensive tests for the sync engine
package sync

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"
)

// ============================================================================
// Vector Clock Tests
// ============================================================================

func TestVectorClock_Increment(t *testing.T) {
	vc := NewVectorClock("node1")
	
	vc.Increment()
	if vc.GetLocal() != 1 {
		t.Errorf("Expected 1, got %d", vc.GetLocal())
	}
	
	vc.Increment()
	if vc.GetLocal() != 2 {
		t.Errorf("Expected 2, got %d", vc.GetLocal())
	}
}

func TestVectorClock_Merge(t *testing.T) {
	vc1 := NewVectorClock("node1")
	vc2 := NewVectorClock("node2")
	
	vc1.Increment()
	vc1.Increment()
	vc2.Increment()
	
	vc1.Merge(vc2)
	
	if vc1.Get("node1") != 2 {
		t.Errorf("Expected node1=2, got %d", vc1.Get("node1"))
	}
	if vc1.Get("node2") != 1 {
		t.Errorf("Expected node2=1, got %d", vc1.Get("node2"))
	}
}

func TestVectorClock_Compare(t *testing.T) {
	tests := []struct {
		name     string
		setup    func() (*VectorClock, *VectorClock)
		expected int
	}{
		{
			name: "vc1 happened before vc2",
			setup: func() (*VectorClock, *VectorClock) {
				vc1 := NewVectorClock("node1")
				vc2 := NewVectorClock("node1")
				vc1.Increment()
				vc2.Increment()
				vc2.Increment()
				return vc1, vc2
			},
			expected: -1,
		},
		{
			name: "vc1 happened after vc2",
			setup: func() (*VectorClock, *VectorClock) {
				vc1 := NewVectorClock("node1")
				vc2 := NewVectorClock("node1")
				vc1.Increment()
				vc1.Increment()
				vc2.Increment()
				return vc1, vc2
			},
			expected: 1,
		},
		{
			name: "concurrent",
			setup: func() (*VectorClock, *VectorClock) {
				vc1 := NewVectorClock("node1")
				vc2 := NewVectorClock("node2")
				vc1.Increment()
				vc2.Increment()
				return vc1, vc2
			},
			expected: 0,
		},
	}
	
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			vc1, vc2 := tt.setup()
			result := vc1.Compare(vc2)
			if result != tt.expected {
				t.Errorf("Expected %d, got %d", tt.expected, result)
			}
		})
	}
}

func TestVectorClock_Concurrent(t *testing.T) {
	vc := NewVectorClock("node1")
	var wg sync.WaitGroup
	
	// Concurrent increments
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			vc.Increment()
		}()
	}
	
	wg.Wait()
	
	if vc.GetLocal() != 100 {
		t.Errorf("Expected 100, got %d", vc.GetLocal())
	}
}

// ============================================================================
// CRDT Tests
// ============================================================================

func TestGCounter(t *testing.T) {
	gc := NewGCounter("node1")
	
	gc.Increment(5)
	gc.Increment(3)
	
	if gc.Value() != 8 {
		t.Errorf("Expected 8, got %d", gc.Value())
	}
}

func TestGCounter_Merge(t *testing.T) {
	gc1 := NewGCounter("node1")
	gc2 := NewGCounter("node2")
	
	gc1.Increment(5)
	gc2.Increment(3)
	
	gc1.Merge(gc2)
	
	if gc1.Value() != 8 {
		t.Errorf("Expected 8, got %d", gc1.Value())
	}
}

func TestPNCounter(t *testing.T) {
	pn := NewPNCounter("node1")
	
	pn.Increment(10)
	pn.Decrement(3)
	
	if pn.Value() != 7 {
		t.Errorf("Expected 7, got %d", pn.Value())
	}
}

func TestPNCounter_Merge(t *testing.T) {
	pn1 := NewPNCounter("node1")
	pn2 := NewPNCounter("node2")
	
	pn1.Increment(10)
	pn2.Decrement(3)
	
	pn1.Merge(pn2)
	
	if pn1.Value() != 7 {
		t.Errorf("Expected 7, got %d", pn1.Value())
	}
}

func TestLWWRegister(t *testing.T) {
	r := NewLWWRegister("node1")
	
	r.Set("value1")
	time.Sleep(10 * time.Millisecond)
	r.Set("value2")
	
	if r.Get() != "value2" {
		t.Errorf("Expected value2, got %v", r.Get())
	}
}

func TestLWWRegister_Merge(t *testing.T) {
	r1 := NewLWWRegister("node1")
	r2 := NewLWWRegister("node2")
	
	r1.Set("value1")
	time.Sleep(10 * time.Millisecond)
	r2.Set("value2")
	
	r1.Merge(r2)
	
	if r1.Get() != "value2" {
		t.Errorf("Expected value2, got %v", r1.Get())
	}
}

func TestGSet(t *testing.T) {
	gs := NewGSet()
	
	gs.Add("a")
	gs.Add("b")
	gs.Add("a") // Duplicate
	
	if !gs.Contains("a") || !gs.Contains("b") {
		t.Error("Set should contain a and b")
	}
	
	if len(gs.Elements()) != 2 {
		t.Errorf("Expected 2 elements, got %d", len(gs.Elements()))
	}
}

func TestTwoPSet(t *testing.T) {
	tps := NewTwoPSet()
	
	tps.Add("a")
	tps.Add("b")
	tps.Remove("a")
	
	if tps.Contains("a") {
		t.Error("Set should not contain a")
	}
	if !tps.Contains("b") {
		t.Error("Set should contain b")
	}
}

func TestORSet(t *testing.T) {
	os := NewORSet("node1")
	
	os.Add("a")
	os.Add("b")
	os.Remove("a")
	os.Add("a") // Re-add after remove
	
	if !os.Contains("a") {
		t.Error("OR-Set should contain a after re-add")
	}
}

func TestLWWMap(t *testing.T) {
	m := NewLWWMap("node1")
	
	m.Set("key1", "value1")
	m.Set("key2", "value2")
	m.Delete("key1")
	
	if _, ok := m.Get("key1"); ok {
		t.Error("key1 should be deleted")
	}
	
	if v, ok := m.Get("key2"); !ok || v != "value2" {
		t.Error("key2 should have value2")
	}
}

// ============================================================================
// Delta Sync Tests
// ============================================================================

func TestDeltaTracker_ComputeDelta(t *testing.T) {
	dt := NewDeltaTracker("node1")
	
	oldState := map[string]interface{}{
		"name":  "John",
		"age":   30,
		"email": "john@example.com",
	}
	
	newState := map[string]interface{}{
		"name":  "John",
		"age":   31, // Changed
		"phone": "123456", // Added
		// email removed
	}
	
	deltas := dt.ComputeDelta("entity1", oldState, newState)
	
	if len(deltas) != 3 {
		t.Errorf("Expected 3 deltas, got %d", len(deltas))
	}
	
	// Verify delta operations
	ops := make(map[string]DeltaOperation)
	for _, d := range deltas {
		ops[d.Path] = d.Operation
	}
	
	if ops["age"] != DeltaOpSet {
		t.Error("age should be set operation")
	}
	if ops["phone"] != DeltaOpSet {
		t.Error("phone should be set operation")
	}
	if ops["email"] != DeltaOpDelete {
		t.Error("email should be delete operation")
	}
}

func TestDeltaTracker_ApplyDeltas(t *testing.T) {
	dt := NewDeltaTracker("node1")
	
	state := map[string]interface{}{
		"name": "John",
		"age":  30,
	}
	
	deltas := []*Delta{
		{Path: "age", Operation: DeltaOpSet, Value: 31},
		{Path: "phone", Operation: DeltaOpSet, Value: "123456"},
	}
	
	newState, err := dt.ApplyDeltas(state, deltas)
	if err != nil {
		t.Fatalf("ApplyDeltas failed: %v", err)
	}
	
	if newState["age"] != 31 {
		t.Errorf("Expected age=31, got %v", newState["age"])
	}
	if newState["phone"] != "123456" {
		t.Errorf("Expected phone=123456, got %v", newState["phone"])
	}
}

func TestDeltaCompressor(t *testing.T) {
	dc := NewDeltaCompressor()
	
	deltas := []*Delta{
		{Path: "counter", Operation: DeltaOpIncr, Value: 5.0, Timestamp: time.Now()},
		{Path: "counter", Operation: DeltaOpIncr, Value: 3.0, Timestamp: time.Now()},
		{Path: "name", Operation: DeltaOpSet, Value: "John", Timestamp: time.Now()},
		{Path: "name", Operation: DeltaOpSet, Value: "Jane", Timestamp: time.Now()},
	}
	
	compressed := dc.CompressDeltas(deltas)
	
	if len(compressed) != 2 {
		t.Errorf("Expected 2 compressed deltas, got %d", len(compressed))
	}
}

// ============================================================================
// Priority Queue Tests
// ============================================================================

func TestSyncPriorityQueue_Enqueue(t *testing.T) {
	pq := NewSyncPriorityQueue(100)
	
	err := pq.Enqueue(&SyncItem{
		ID:       "item1",
		Priority: PriorityNormal,
	})
	if err != nil {
		t.Fatalf("Enqueue failed: %v", err)
	}
	
	if pq.Size() != 1 {
		t.Errorf("Expected size 1, got %d", pq.Size())
	}
}

func TestSyncPriorityQueue_PriorityOrder(t *testing.T) {
	pq := NewSyncPriorityQueue(100)
	
	pq.Enqueue(&SyncItem{ID: "low", Priority: PriorityLow})
	pq.Enqueue(&SyncItem{ID: "critical", Priority: PriorityCritical})
	pq.Enqueue(&SyncItem{ID: "normal", Priority: PriorityNormal})
	
	// Should dequeue in priority order
	item := pq.Dequeue()
	if item.ID != "critical" {
		t.Errorf("Expected critical, got %s", item.ID)
	}
	
	item = pq.Dequeue()
	if item.ID != "normal" {
		t.Errorf("Expected normal, got %s", item.ID)
	}
	
	item = pq.Dequeue()
	if item.ID != "low" {
		t.Errorf("Expected low, got %s", item.ID)
	}
}

func TestSyncPriorityQueue_MaxSize(t *testing.T) {
	pq := NewSyncPriorityQueue(2)
	
	pq.Enqueue(&SyncItem{ID: "item1", Priority: PriorityNormal})
	pq.Enqueue(&SyncItem{ID: "item2", Priority: PriorityNormal})
	
	// Third item should fail or evict lowest priority
	err := pq.Enqueue(&SyncItem{ID: "item3", Priority: PriorityCritical})
	if err != nil {
		// Queue is full and couldn't make room
		if pq.Size() != 2 {
			t.Errorf("Expected size 2, got %d", pq.Size())
		}
	}
}

func TestPriorityClassifier(t *testing.T) {
	pc := NewPriorityClassifier()
	
	tests := []struct {
		entityType string
		operation  string
		expected   SyncPriority
	}{
		{"transaction", "create", PriorityCritical},
		{"cash_in", "create", PriorityCritical},
		{"customer", "update", PriorityNormal},
		{"analytics", "create", PriorityBackground},
	}
	
	for _, tt := range tests {
		t.Run(tt.entityType, func(t *testing.T) {
			priority := pc.Classify(tt.entityType, tt.operation)
			if priority != tt.expected {
				t.Errorf("Expected %v, got %v", tt.expected, priority)
			}
		})
	}
}

// ============================================================================
// Compression Tests
// ============================================================================

func TestCompressor_GzipRoundtrip(t *testing.T) {
	c := NewCompressor(CompressionGzip, CompressionDefault)
	defer c.Close()
	
	original := []byte("Hello, World! This is a test message for compression.")
	
	compressed, err := c.Compress(original)
	if err != nil {
		t.Fatalf("Compress failed: %v", err)
	}
	
	decompressed, err := c.Decompress(compressed)
	if err != nil {
		t.Fatalf("Decompress failed: %v", err)
	}
	
	if string(decompressed) != string(original) {
		t.Error("Decompressed data doesn't match original")
	}
}

func TestCompressor_LZ4Roundtrip(t *testing.T) {
	c := NewCompressor(CompressionLZ4, CompressionDefault)
	defer c.Close()
	
	original := []byte("Hello, World! This is a test message for LZ4 compression. " +
		"Adding more text to make it compressible.")
	
	compressed, err := c.Compress(original)
	if err != nil {
		t.Fatalf("Compress failed: %v", err)
	}
	
	decompressed, err := c.Decompress(compressed)
	if err != nil {
		t.Fatalf("Decompress failed: %v", err)
	}
	
	if string(decompressed) != string(original) {
		t.Error("Decompressed data doesn't match original")
	}
}

func TestAdaptiveCompressor(t *testing.T) {
	ac := NewAdaptiveCompressor(nil)
	
	// Test network quality adaptation
	ac.SetNetworkQuality(NetworkExcellent)
	if ac.GetNetworkQuality() != NetworkExcellent {
		t.Error("Network quality not set correctly")
	}
	
	ac.SetNetworkQuality(NetworkPoor)
	if ac.GetNetworkQuality() != NetworkPoor {
		t.Error("Network quality not set correctly")
	}
}

func TestBandwidthEstimator(t *testing.T) {
	be := NewBandwidthEstimator()
	
	// Simulate transfers
	be.RecordTransfer(1000000, 1*time.Second) // 1 MB/s
	be.RecordTransfer(1000000, 1*time.Second)
	
	bps := be.GetBandwidth()
	if bps < 900000 || bps > 1100000 {
		t.Errorf("Expected ~1MB/s, got %f", bps)
	}
	
	quality := be.GetNetworkQuality()
	if quality != NetworkExcellent {
		t.Errorf("Expected NetworkExcellent, got %v", quality)
	}
}

// ============================================================================
// Extended Offline Tests
// ============================================================================

func TestOfflineManager_QueueTransaction(t *testing.T) {
	config := DefaultOfflineConfig()
	om := NewOfflineManager("node1", "/tmp/test-offline", config, nil)
	
	txn := &OfflineTransaction{
		Type:       "cash_in",
		Amount:     1000,
		Currency:   "NGN",
		AgentID:    "agent1",
		CustomerID: "customer1",
	}
	
	err := om.QueueTransaction(txn)
	if err != nil {
		t.Fatalf("QueueTransaction failed: %v", err)
	}
	
	state := om.GetState()
	if state.PendingCount != 1 {
		t.Errorf("Expected 1 pending, got %d", state.PendingCount)
	}
}

func TestOfflineManager_OfflineReceipt(t *testing.T) {
	config := DefaultOfflineConfig()
	om := NewOfflineManager("node1", "/tmp/test-offline", config, nil)
	
	txn := &OfflineTransaction{
		Type:       "cash_out",
		Amount:     500,
		Currency:   "NGN",
		AgentID:    "agent1",
		CustomerID: "customer1",
	}
	
	om.QueueTransaction(txn)
	
	if txn.OfflineReceipt == "" {
		t.Error("Offline receipt should be generated")
	}
	
	if txn.OfflineReceipt[:4] != "OFF-" {
		t.Error("Offline receipt should start with OFF-")
	}
}

func TestOfflineManager_GoOfflineOnline(t *testing.T) {
	config := DefaultOfflineConfig()
	om := NewOfflineManager("node1", "/tmp/test-offline", config, nil)
	
	om.GoOffline()
	state := om.GetState()
	if !state.IsOffline {
		t.Error("Should be offline")
	}
	
	ctx := context.Background()
	om.GoOnline(ctx)
	state = om.GetState()
	if state.IsOffline {
		t.Error("Should be online")
	}
}

// ============================================================================
// Encryption Tests
// ============================================================================

func TestSyncEncryptor_EncryptDecrypt(t *testing.T) {
	encryptor, err := NewSyncEncryptor(nil, "device1")
	if err != nil {
		t.Fatalf("NewSyncEncryptor failed: %v", err)
	}
	
	plaintext := []byte("Hello, World! This is a secret message.")
	
	encrypted, err := encryptor.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}
	
	decrypted, err := encryptor.Decrypt(encrypted)
	if err != nil {
		t.Fatalf("Decrypt failed: %v", err)
	}
	
	if string(decrypted) != string(plaintext) {
		t.Error("Decrypted data doesn't match original")
	}
}

func TestSyncEncryptor_JSONRoundtrip(t *testing.T) {
	encryptor, err := NewSyncEncryptor(nil, "device1")
	if err != nil {
		t.Fatalf("NewSyncEncryptor failed: %v", err)
	}
	
	original := map[string]interface{}{
		"name":   "John",
		"amount": 1000,
		"active": true,
	}
	
	encrypted, err := encryptor.EncryptJSON(original)
	if err != nil {
		t.Fatalf("EncryptJSON failed: %v", err)
	}
	
	var decrypted map[string]interface{}
	err = encryptor.DecryptJSON(encrypted, &decrypted)
	if err != nil {
		t.Fatalf("DecryptJSON failed: %v", err)
	}
	
	if decrypted["name"] != "John" {
		t.Error("Decrypted name doesn't match")
	}
}

func TestKeyExchange(t *testing.T) {
	ke1, err := NewKeyExchange()
	if err != nil {
		t.Fatalf("NewKeyExchange failed: %v", err)
	}
	
	ke2, err := NewKeyExchange()
	if err != nil {
		t.Fatalf("NewKeyExchange failed: %v", err)
	}
	
	// Exchange public keys
	pub1 := ke1.GetPublicKey()
	pub2 := ke2.GetPublicKey()
	
	// Derive shared keys
	shared1, err := ke1.DeriveSharedKey("device2", pub2)
	if err != nil {
		t.Fatalf("DeriveSharedKey failed: %v", err)
	}
	
	shared2, err := ke2.DeriveSharedKey("device1", pub1)
	if err != nil {
		t.Fatalf("DeriveSharedKey failed: %v", err)
	}
	
	// Shared keys should be equal
	if string(shared1) != string(shared2) {
		t.Error("Shared keys don't match")
	}
}

func TestDeviceAttestation(t *testing.T) {
	da := NewDeviceAttestation()
	
	info := &DeviceInfo{
		DeviceID:   "device1",
		DeviceType: "mobile",
		Platform:   "android",
	}
	
	err := da.RegisterDevice(info)
	if err != nil {
		t.Fatalf("RegisterDevice failed: %v", err)
	}
	
	// Device should not be trusted yet
	if da.IsTrusted("device1") {
		t.Error("Device should not be trusted before verification")
	}
	
	// Verify device
	token := make([]byte, 64)
	err = da.VerifyDevice("device1", token)
	if err != nil {
		t.Fatalf("VerifyDevice failed: %v", err)
	}
	
	// Device should now be trusted
	if !da.IsTrusted("device1") {
		t.Error("Device should be trusted after verification")
	}
}

// ============================================================================
// Integration Tests
// ============================================================================

func TestFullSyncFlow(t *testing.T) {
	// Create sync managers for two nodes
	sm1 := NewSyncManager("node1")
	sm2 := NewSyncManager("node2")
	
	// Node 1 creates an event
	event := sm1.CreateEvent("create", "entity1", map[string]interface{}{
		"name": "Test Entity",
	}, nil)
	
	// Node 2 receives the event
	_, err := sm2.ReceiveEvent(event)
	if err != nil {
		t.Fatalf("ReceiveEvent failed: %v", err)
	}
	
	// Verify clocks are merged
	clock1 := sm1.GetClock()
	clock2 := sm2.GetClock()
	
	if clock2["node1"] < clock1["node1"] {
		t.Error("Node 2 should have merged node 1's clock")
	}
}

func TestDeltaSyncFlow(t *testing.T) {
	dsm := NewDeltaSyncManager("node1")
	
	// Track an entity
	initialState := map[string]interface{}{
		"name":    "John",
		"balance": 1000.0,
	}
	dsm.TrackEntity("entity1", initialState)
	
	// Record changes
	dsm.RecordChange("entity1", "balance", DeltaOpSet, 1500.0, 1000.0)
	dsm.RecordChange("entity1", "name", DeltaOpSet, "Jane", "John")
	
	// Get sync payload
	payload := dsm.GetSyncPayload("entity1")
	if payload == nil {
		t.Fatal("Expected sync payload")
	}
	
	if len(payload.Deltas) != 2 {
		t.Errorf("Expected 2 deltas, got %d", len(payload.Deltas))
	}
}

// ============================================================================
// Chaos Tests
// ============================================================================

func TestConcurrentSyncOperations(t *testing.T) {
	pq := NewSyncPriorityQueue(1000)
	var wg sync.WaitGroup
	
	// Concurrent enqueues
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			pq.Enqueue(&SyncItem{
				ID:       string(rune(id)),
				Priority: SyncPriority(id % 5),
			})
		}(i)
	}
	
	// Concurrent dequeues
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			pq.Dequeue()
		}()
	}
	
	wg.Wait()
	
	// Should have ~50 items remaining
	if pq.Size() > 100 || pq.Size() < 0 {
		t.Errorf("Unexpected queue size: %d", pq.Size())
	}
}

func TestNetworkPartitionRecovery(t *testing.T) {
	config := DefaultOfflineConfig()
	om := NewOfflineManager("node1", "/tmp/test-partition", config, nil)
	
	// Simulate going offline
	om.GoOffline()
	
	// Queue transactions while offline
	for i := 0; i < 10; i++ {
		om.QueueTransaction(&OfflineTransaction{
			Type:       "transfer",
			Amount:     float64(100 * (i + 1)),
			Currency:   "NGN",
			AgentID:    "agent1",
			CustomerID: "customer1",
		})
	}
	
	state := om.GetState()
	if state.PendingCount != 10 {
		t.Errorf("Expected 10 pending, got %d", state.PendingCount)
	}
	
	// Simulate coming back online
	ctx := context.Background()
	om.GoOnline(ctx)
	
	// Verify state
	state = om.GetState()
	if state.IsOffline {
		t.Error("Should be online after recovery")
	}
}

// ============================================================================
// Benchmark Tests
// ============================================================================

func BenchmarkVectorClockIncrement(b *testing.B) {
	vc := NewVectorClock("node1")
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		vc.Increment()
	}
}

func BenchmarkGCounterIncrement(b *testing.B) {
	gc := NewGCounter("node1")
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		gc.Increment(1)
	}
}

func BenchmarkCompression(b *testing.B) {
	c := NewCompressor(CompressionGzip, CompressionDefault)
	defer c.Close()
	
	data := make([]byte, 10000)
	for i := range data {
		data[i] = byte(i % 256)
	}
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		c.Compress(data)
	}
}

func BenchmarkEncryption(b *testing.B) {
	encryptor, _ := NewSyncEncryptor(nil, "device1")
	data := make([]byte, 1000)
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		encryptor.Encrypt(data)
	}
}

func BenchmarkPriorityQueueEnqueue(b *testing.B) {
	pq := NewSyncPriorityQueue(b.N + 1000)
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		pq.Enqueue(&SyncItem{
			ID:       string(rune(i)),
			Priority: SyncPriority(i % 5),
		})
	}
}

// ============================================================================
// Serialization Tests
// ============================================================================

func TestVectorClockJSON(t *testing.T) {
	vc := NewVectorClock("node1")
	vc.Increment()
	vc.Increment()
	
	data, err := json.Marshal(vc)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	
	vc2 := NewVectorClock("node1")
	err = json.Unmarshal(data, vc2)
	if err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}
	
	if vc2.Get("node1") != 2 {
		t.Errorf("Expected 2, got %d", vc2.Get("node1"))
	}
}

func TestCompressedMessageSerialization(t *testing.T) {
	cd := &CompressedData{
		Algorithm:      CompressionGzip,
		OriginalSize:   1000,
		CompressedSize: 500,
		Checksum:       12345,
		Data:           []byte("compressed data"),
		Timestamp:      time.Now(),
	}
	
	serialized, err := SerializeCompressedMessage(cd)
	if err != nil {
		t.Fatalf("Serialize failed: %v", err)
	}
	
	deserialized, err := DeserializeCompressedMessage(serialized)
	if err != nil {
		t.Fatalf("Deserialize failed: %v", err)
	}
	
	if deserialized.Algorithm != cd.Algorithm {
		t.Error("Algorithm mismatch")
	}
	if deserialized.OriginalSize != cd.OriginalSize {
		t.Error("OriginalSize mismatch")
	}
}
