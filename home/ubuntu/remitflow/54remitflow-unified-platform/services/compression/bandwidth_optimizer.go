package main

import (
	"bytes"
	"compress/gzip"
	"compress/zlib"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/klauspost/compress/zstd"
	"github.com/pierrec/lz4/v4"
)

// NetworkCondition represents network quality levels
type NetworkCondition string

const (
	NetworkExcellent NetworkCondition = "excellent" // 4G/WiFi - > 10 Mbps
	NetworkGood      NetworkCondition = "good"      // 3G - 1-10 Mbps
	NetworkPoor      NetworkCondition = "poor"      // 2G - 64-256 kbps
	NetworkVeryPoor  NetworkCondition = "very_poor" // Edge - < 64 kbps
)

// CompressionMethod represents different compression algorithms
type CompressionMethod string

const (
	CompressionNone CompressionMethod = "none"
	CompressionGzip CompressionMethod = "gzip"
	CompressionZlib CompressionMethod = "zlib"
	CompressionLZ4  CompressionMethod = "lz4"
	CompressionZstd CompressionMethod = "zstd"
)

// BandwidthProfile contains network characteristics
type BandwidthProfile struct {
	BandwidthKbps float64           `json:"bandwidth_kbps"`
	LatencyMs     float64           `json:"latency_ms"`
	PacketLoss    float64           `json:"packet_loss"`
	Condition     NetworkCondition  `json:"condition"`
	Timestamp     time.Time         `json:"timestamp"`
}

// CompressionConfig contains compression settings
type CompressionConfig struct {
	Method           CompressionMethod `json:"method"`
	Level            int               `json:"level"`
	ChunkSize        int               `json:"chunk_size"`
	MaxPayloadKB     int               `json:"max_payload_kb"`
	EnableStreaming  bool              `json:"enable_streaming"`
	EnableBatching   bool              `json:"enable_batching"`
	BatchSize        int               `json:"batch_size"`
	RetryAttempts    int               `json:"retry_attempts"`
	TimeoutSeconds   int               `json:"timeout_seconds"`
}

// CompressionResult contains compression operation results
type CompressionResult struct {
	Success          bool              `json:"success"`
	OriginalSize     int               `json:"original_size"`
	CompressedSize   int               `json:"compressed_size"`
	CompressionRatio float64           `json:"compression_ratio"`
	ProcessingTime   float64           `json:"processing_time"`
	Method           CompressionMethod `json:"method"`
	ErrorMessage     string            `json:"error_message,omitempty"`
}

// DataChunk represents a chunk of data for streaming
type DataChunk struct {
	ID       string `json:"id"`
	Index    int    `json:"index"`
	Total    int    `json:"total"`
	Data     []byte `json:"data"`
	Checksum string `json:"checksum"`
}

// BandwidthOptimizer manages bandwidth optimization
type BandwidthOptimizer struct {
	profiles      map[string]*BandwidthProfile
	configs       map[NetworkCondition]*CompressionConfig
	compressors   map[CompressionMethod]Compressor
	mutex         sync.RWMutex
	metrics       *OptimizationMetrics
}

// Compressor interface for different compression methods
type Compressor interface {
	Compress(data []byte, level int) ([]byte, error)
	Decompress(data []byte) ([]byte, error)
	GetName() CompressionMethod
}

// GzipCompressor implements gzip compression
type GzipCompressor struct{}

func (g *GzipCompressor) Compress(data []byte, level int) ([]byte, error) {
	var buf bytes.Buffer
	writer, err := gzip.NewWriterLevel(&buf, level)
	if err != nil {
		return nil, err
	}
	
	_, err = writer.Write(data)
	if err != nil {
		return nil, err
	}
	
	err = writer.Close()
	if err != nil {
		return nil, err
	}
	
	return buf.Bytes(), nil
}

func (g *GzipCompressor) Decompress(data []byte) ([]byte, error) {
	reader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	
	return io.ReadAll(reader)
}

func (g *GzipCompressor) GetName() CompressionMethod {
	return CompressionGzip
}

// ZlibCompressor implements zlib compression
type ZlibCompressor struct{}

func (z *ZlibCompressor) Compress(data []byte, level int) ([]byte, error) {
	var buf bytes.Buffer
	writer, err := zlib.NewWriterLevel(&buf, level)
	if err != nil {
		return nil, err
	}
	
	_, err = writer.Write(data)
	if err != nil {
		return nil, err
	}
	
	err = writer.Close()
	if err != nil {
		return nil, err
	}
	
	return buf.Bytes(), nil
}

func (z *ZlibCompressor) Decompress(data []byte) ([]byte, error) {
	reader, err := zlib.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	
	return io.ReadAll(reader)
}

func (z *ZlibCompressor) GetName() CompressionMethod {
	return CompressionZlib
}

// LZ4Compressor implements LZ4 compression
type LZ4Compressor struct{}

func (l *LZ4Compressor) Compress(data []byte, level int) ([]byte, error) {
	var buf bytes.Buffer
	writer := lz4.NewWriter(&buf)
	
	_, err := writer.Write(data)
	if err != nil {
		return nil, err
	}
	
	err = writer.Close()
	if err != nil {
		return nil, err
	}
	
	return buf.Bytes(), nil
}

func (l *LZ4Compressor) Decompress(data []byte) ([]byte, error) {
	reader := lz4.NewReader(bytes.NewReader(data))
	return io.ReadAll(reader)
}

func (l *LZ4Compressor) GetName() CompressionMethod {
	return CompressionLZ4
}

// ZstdCompressor implements Zstandard compression
type ZstdCompressor struct {
	encoder *zstd.Encoder
	decoder *zstd.Decoder
}

func NewZstdCompressor() (*ZstdCompressor, error) {
	encoder, err := zstd.NewWriter(nil)
	if err != nil {
		return nil, err
	}
	
	decoder, err := zstd.NewReader(nil)
	if err != nil {
		return nil, err
	}
	
	return &ZstdCompressor{
		encoder: encoder,
		decoder: decoder,
	}, nil
}

func (z *ZstdCompressor) Compress(data []byte, level int) ([]byte, error) {
	return z.encoder.EncodeAll(data, make([]byte, 0, len(data))), nil
}

func (z *ZstdCompressor) Decompress(data []byte) ([]byte, error) {
	return z.decoder.DecodeAll(data, nil)
}

func (z *ZstdCompressor) GetName() CompressionMethod {
	return CompressionZstd
}

// OptimizationMetrics tracks performance metrics
type OptimizationMetrics struct {
	TotalRequests      int64   `json:"total_requests"`
	TotalBytesOriginal int64   `json:"total_bytes_original"`
	TotalBytesCompressed int64 `json:"total_bytes_compressed"`
	AverageCompressionRatio float64 `json:"average_compression_ratio"`
	AverageProcessingTime float64 `json:"average_processing_time"`
	ErrorCount         int64   `json:"error_count"`
	mutex              sync.RWMutex
}

func (m *OptimizationMetrics) UpdateMetrics(result *CompressionResult) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	
	m.TotalRequests++
	m.TotalBytesOriginal += int64(result.OriginalSize)
	m.TotalBytesCompressed += int64(result.CompressedSize)
	
	if !result.Success {
		m.ErrorCount++
	}
	
	// Update averages
	if m.TotalRequests > 0 {
		m.AverageCompressionRatio = float64(m.TotalBytesOriginal) / float64(m.TotalBytesCompressed)
		m.AverageProcessingTime = (m.AverageProcessingTime*float64(m.TotalRequests-1) + result.ProcessingTime) / float64(m.TotalRequests)
	}
}

func (m *OptimizationMetrics) GetMetrics() *OptimizationMetrics {
	m.mutex.RLock()
	defer m.mutex.RUnlock()
	
	return &OptimizationMetrics{
		TotalRequests:           m.TotalRequests,
		TotalBytesOriginal:      m.TotalBytesOriginal,
		TotalBytesCompressed:    m.TotalBytesCompressed,
		AverageCompressionRatio: m.AverageCompressionRatio,
		AverageProcessingTime:   m.AverageProcessingTime,
		ErrorCount:              m.ErrorCount,
	}
}

// NewBandwidthOptimizer creates a new bandwidth optimizer
func NewBandwidthOptimizer() (*BandwidthOptimizer, error) {
	zstdCompressor, err := NewZstdCompressor()
	if err != nil {
		return nil, err
	}
	
	optimizer := &BandwidthOptimizer{
		profiles: make(map[string]*BandwidthProfile),
		configs:  make(map[NetworkCondition]*CompressionConfig),
		compressors: map[CompressionMethod]Compressor{
			CompressionGzip: &GzipCompressor{},
			CompressionZlib: &ZlibCompressor{},
			CompressionLZ4:  &LZ4Compressor{},
			CompressionZstd: zstdCompressor,
		},
		metrics: &OptimizationMetrics{},
	}
	
	// Initialize default configurations
	optimizer.initializeConfigs()
	
	return optimizer, nil
}

func (bo *BandwidthOptimizer) initializeConfigs() {
	bo.configs[NetworkExcellent] = &CompressionConfig{
		Method:          CompressionGzip,
		Level:           6,
		ChunkSize:       1024 * 1024, // 1MB
		MaxPayloadKB:    10240,        // 10MB
		EnableStreaming: false,
		EnableBatching:  true,
		BatchSize:       10,
		RetryAttempts:   3,
		TimeoutSeconds:  30,
	}
	
	bo.configs[NetworkGood] = &CompressionConfig{
		Method:          CompressionGzip,
		Level:           7,
		ChunkSize:       512 * 1024, // 512KB
		MaxPayloadKB:    5120,       // 5MB
		EnableStreaming: true,
		EnableBatching:  true,
		BatchSize:       5,
		RetryAttempts:   3,
		TimeoutSeconds:  45,
	}
	
	bo.configs[NetworkPoor] = &CompressionConfig{
		Method:          CompressionZstd,
		Level:           9,
		ChunkSize:       64 * 1024, // 64KB
		MaxPayloadKB:    1024,      // 1MB
		EnableStreaming: true,
		EnableBatching:  true,
		BatchSize:       2,
		RetryAttempts:   5,
		TimeoutSeconds:  60,
	}
	
	bo.configs[NetworkVeryPoor] = &CompressionConfig{
		Method:          CompressionZstd,
		Level:           11,
		ChunkSize:       16 * 1024, // 16KB
		MaxPayloadKB:    256,       // 256KB
		EnableStreaming: true,
		EnableBatching:  false,
		BatchSize:       1,
		RetryAttempts:   10,
		TimeoutSeconds:  120,
	}
}

// AnalyzeNetworkCondition determines network condition from metrics
func (bo *BandwidthOptimizer) AnalyzeNetworkCondition(bandwidthKbps, latencyMs, packetLoss float64) NetworkCondition {
	if bandwidthKbps >= 10000 && latencyMs < 50 && packetLoss < 0.01 {
		return NetworkExcellent
	} else if bandwidthKbps >= 1000 && latencyMs < 100 && packetLoss < 0.02 {
		return NetworkGood
	} else if bandwidthKbps >= 256 && latencyMs < 300 && packetLoss < 0.05 {
		return NetworkPoor
	} else {
		return NetworkVeryPoor
	}
}

// UpdateBandwidthProfile updates the bandwidth profile for a client
func (bo *BandwidthOptimizer) UpdateBandwidthProfile(clientID string, profile *BandwidthProfile) {
	bo.mutex.Lock()
	defer bo.mutex.Unlock()
	
	profile.Timestamp = time.Now()
	bo.profiles[clientID] = profile
}

// GetOptimalConfig returns optimal compression config for a client
func (bo *BandwidthOptimizer) GetOptimalConfig(clientID string) *CompressionConfig {
	bo.mutex.RLock()
	defer bo.mutex.RUnlock()
	
	profile, exists := bo.profiles[clientID]
	if !exists {
		// Default to good network condition
		return bo.configs[NetworkGood]
	}
	
	return bo.configs[profile.Condition]
}

// CompressData compresses data using optimal settings
func (bo *BandwidthOptimizer) CompressData(data []byte, config *CompressionConfig) *CompressionResult {
	startTime := time.Now()
	
	if config.Method == CompressionNone {
		return &CompressionResult{
			Success:          true,
			OriginalSize:     len(data),
			CompressedSize:   len(data),
			CompressionRatio: 1.0,
			ProcessingTime:   time.Since(startTime).Seconds(),
			Method:           CompressionNone,
		}
	}
	
	compressor, exists := bo.compressors[config.Method]
	if !exists {
		return &CompressionResult{
			Success:      false,
			OriginalSize: len(data),
			Method:       config.Method,
			ErrorMessage: fmt.Sprintf("Compressor not found: %s", config.Method),
		}
	}
	
	compressed, err := compressor.Compress(data, config.Level)
	if err != nil {
		return &CompressionResult{
			Success:        false,
			OriginalSize:   len(data),
			ProcessingTime: time.Since(startTime).Seconds(),
			Method:         config.Method,
			ErrorMessage:   err.Error(),
		}
	}
	
	result := &CompressionResult{
		Success:          true,
		OriginalSize:     len(data),
		CompressedSize:   len(compressed),
		CompressionRatio: float64(len(data)) / float64(len(compressed)),
		ProcessingTime:   time.Since(startTime).Seconds(),
		Method:           config.Method,
	}
	
	// Update metrics
	bo.metrics.UpdateMetrics(result)
	
	return result
}

// ChunkData splits data into chunks for streaming
func (bo *BandwidthOptimizer) ChunkData(data []byte, chunkSize int) []*DataChunk {
	var chunks []*DataChunk
	totalChunks := (len(data) + chunkSize - 1) / chunkSize
	
	for i := 0; i < len(data); i += chunkSize {
		end := i + chunkSize
		if end > len(data) {
			end = len(data)
		}
		
		chunk := &DataChunk{
			ID:    fmt.Sprintf("chunk_%d_%d", time.Now().Unix(), i/chunkSize),
			Index: i / chunkSize,
			Total: totalChunks,
			Data:  data[i:end],
		}
		
		chunks = append(chunks, chunk)
	}
	
	return chunks
}

// OptimizeForNetwork optimizes data for specific network conditions
func (bo *BandwidthOptimizer) OptimizeForNetwork(data []byte, condition NetworkCondition) (*CompressionResult, []*DataChunk) {
	config := bo.configs[condition]
	
	// Compress data
	result := bo.CompressData(data, config)
	if !result.Success {
		return result, nil
	}
	
	// Create chunks if streaming is enabled
	var chunks []*DataChunk
	if config.EnableStreaming {
		// For this example, we'll chunk the original data
		// In practice, you might chunk the compressed data
		chunks = bo.ChunkData(data, config.ChunkSize)
	}
	
	return result, chunks
}

// HTTP Handlers

func (bo *BandwidthOptimizer) setupRoutes() *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Logger())
	router.Use(gin.Recovery())
	
	// Enable CORS
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"*"}
	router.Use(cors.New(config))
	
	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":    "healthy",
			"timestamp": time.Now().Format(time.RFC3339),
			"service":   "bandwidth-optimizer",
			"version":   "1.0.0",
		})
	})
	
	// Analyze network condition
	router.POST("/analyze", bo.handleAnalyzeNetwork)
	
	// Compress data
	router.POST("/compress", bo.handleCompressData)
	
	// Optimize for network
	router.POST("/optimize", bo.handleOptimizeForNetwork)
	
	// Get metrics
	router.GET("/metrics", bo.handleGetMetrics)
	
	// Update bandwidth profile
	router.POST("/profile/:clientId", bo.handleUpdateProfile)
	
	// Get optimal config
	router.GET("/config/:clientId", bo.handleGetConfig)
	
	return router
}

func (bo *BandwidthOptimizer) handleAnalyzeNetwork(c *gin.Context) {
	var request struct {
		BandwidthKbps float64 `json:"bandwidth_kbps"`
		LatencyMs     float64 `json:"latency_ms"`
		PacketLoss    float64 `json:"packet_loss"`
	}
	
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	condition := bo.AnalyzeNetworkCondition(request.BandwidthKbps, request.LatencyMs, request.PacketLoss)
	config := bo.configs[condition]
	
	c.JSON(http.StatusOK, gin.H{
		"network_condition": condition,
		"bandwidth_kbps":    request.BandwidthKbps,
		"latency_ms":        request.LatencyMs,
		"packet_loss":       request.PacketLoss,
		"optimal_config":    config,
		"timestamp":         time.Now().Format(time.RFC3339),
	})
}

func (bo *BandwidthOptimizer) handleCompressData(c *gin.Context) {
	var request struct {
		Data   string             `json:"data"`
		Config *CompressionConfig `json:"config,omitempty"`
	}
	
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	data := []byte(request.Data)
	
	config := request.Config
	if config == nil {
		config = bo.configs[NetworkGood] // Default config
	}
	
	result := bo.CompressData(data, config)
	
	c.JSON(http.StatusOK, result)
}

func (bo *BandwidthOptimizer) handleOptimizeForNetwork(c *gin.Context) {
	var request struct {
		Data      string           `json:"data"`
		Condition NetworkCondition `json:"network_condition"`
	}
	
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	data := []byte(request.Data)
	
	result, chunks := bo.OptimizeForNetwork(data, request.Condition)
	
	response := gin.H{
		"compression_result": result,
		"chunks_count":       len(chunks),
		"streaming_enabled":  len(chunks) > 0,
	}
	
	if len(chunks) > 0 {
		response["chunks"] = chunks
	}
	
	c.JSON(http.StatusOK, response)
}

func (bo *BandwidthOptimizer) handleGetMetrics(c *gin.Context) {
	metrics := bo.metrics.GetMetrics()
	c.JSON(http.StatusOK, metrics)
}

func (bo *BandwidthOptimizer) handleUpdateProfile(c *gin.Context) {
	clientID := c.Param("clientId")
	
	var profile BandwidthProfile
	if err := c.ShouldBindJSON(&profile); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	// Analyze network condition
	profile.Condition = bo.AnalyzeNetworkCondition(
		profile.BandwidthKbps,
		profile.LatencyMs,
		profile.PacketLoss,
	)
	
	bo.UpdateBandwidthProfile(clientID, &profile)
	
	c.JSON(http.StatusOK, gin.H{
		"success":   true,
		"client_id": clientID,
		"profile":   profile,
	})
}

func (bo *BandwidthOptimizer) handleGetConfig(c *gin.Context) {
	clientID := c.Param("clientId")
	
	config := bo.GetOptimalConfig(clientID)
	
	c.JSON(http.StatusOK, gin.H{
		"client_id": clientID,
		"config":    config,
	})
}

func main() {
	optimizer, err := NewBandwidthOptimizer()
	if err != nil {
		log.Fatalf("Failed to create bandwidth optimizer: %v", err)
	}
	
	router := optimizer.setupRoutes()
	
	port := "8092"
	if envPort := os.Getenv("PORT"); envPort != "" {
		port = envPort
	}
	
	log.Printf("Starting Bandwidth Optimizer on port %s", port)
	log.Fatal(router.Run(":" + port))
}

