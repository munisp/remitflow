// Package sync provides compression for low-bandwidth environments
// Supports multiple compression algorithms optimized for different scenarios
package sync

import (
	"bytes"
	"compress/gzip"
	"compress/zlib"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/klauspost/compress/zstd"
	"github.com/pierrec/lz4/v4"
)

// CompressionAlgorithm defines supported compression algorithms
type CompressionAlgorithm string

const (
	CompressionNone  CompressionAlgorithm = "none"
	CompressionGzip  CompressionAlgorithm = "gzip"
	CompressionZlib  CompressionAlgorithm = "zlib"
	CompressionLZ4   CompressionAlgorithm = "lz4"
	CompressionZstd  CompressionAlgorithm = "zstd"
	CompressionAuto  CompressionAlgorithm = "auto" // Auto-select based on data
)

// CompressionLevel defines compression levels
type CompressionLevel int

const (
	CompressionFastest CompressionLevel = 1
	CompressionDefault CompressionLevel = 5
	CompressionBest    CompressionLevel = 9
)

// CompressedData represents compressed data with metadata
type CompressedData struct {
	Algorithm      CompressionAlgorithm `json:"algorithm"`
	OriginalSize   int                  `json:"original_size"`
	CompressedSize int                  `json:"compressed_size"`
	Checksum       uint32               `json:"checksum"`
	Data           []byte               `json:"data"`
	Timestamp      time.Time            `json:"timestamp"`
}

// CompressionStats tracks compression statistics
type CompressionStats struct {
	mu                sync.RWMutex
	TotalCompressed   uint64             `json:"total_compressed"`
	TotalDecompressed uint64             `json:"total_decompressed"`
	BytesSaved        uint64             `json:"bytes_saved"`
	AvgRatio          float64            `json:"avg_ratio"`
	ByAlgorithm       map[string]uint64  `json:"by_algorithm"`
	CompressionTime   time.Duration      `json:"compression_time"`
	DecompressionTime time.Duration      `json:"decompression_time"`
}

// NewCompressionStats creates new compression stats
func NewCompressionStats() *CompressionStats {
	return &CompressionStats{
		ByAlgorithm: make(map[string]uint64),
	}
}

// Compressor provides compression/decompression functionality
type Compressor struct {
	mu          sync.RWMutex
	algorithm   CompressionAlgorithm
	level       CompressionLevel
	stats       *CompressionStats
	zstdEncoder *zstd.Encoder
	zstdDecoder *zstd.Decoder
	bufferPool  sync.Pool
}

// NewCompressor creates a new compressor
func NewCompressor(algorithm CompressionAlgorithm, level CompressionLevel) *Compressor {
	c := &Compressor{
		algorithm: algorithm,
		level:     level,
		stats:     NewCompressionStats(),
		bufferPool: sync.Pool{
			New: func() interface{} {
				return new(bytes.Buffer)
			},
		},
	}

	// Initialize zstd encoder/decoder
	var err error
	c.zstdEncoder, err = zstd.NewWriter(nil, zstd.WithEncoderLevel(zstd.EncoderLevel(level)))
	if err != nil {
		c.zstdEncoder = nil
	}
	c.zstdDecoder, err = zstd.NewReader(nil)
	if err != nil {
		c.zstdDecoder = nil
	}

	return c
}

// Compress compresses data using the configured algorithm
func (c *Compressor) Compress(data []byte) (*CompressedData, error) {
	if len(data) == 0 {
		return &CompressedData{
			Algorithm:      CompressionNone,
			OriginalSize:   0,
			CompressedSize: 0,
			Data:           data,
			Timestamp:      time.Now(),
		}, nil
	}

	start := time.Now()
	algorithm := c.algorithm

	// Auto-select algorithm based on data size
	if algorithm == CompressionAuto {
		algorithm = c.selectAlgorithm(data)
	}

	var compressed []byte
	var err error

	switch algorithm {
	case CompressionNone:
		compressed = data
	case CompressionGzip:
		compressed, err = c.compressGzip(data)
	case CompressionZlib:
		compressed, err = c.compressZlib(data)
	case CompressionLZ4:
		compressed, err = c.compressLZ4(data)
	case CompressionZstd:
		compressed, err = c.compressZstd(data)
	default:
		return nil, fmt.Errorf("unsupported algorithm: %s", algorithm)
	}

	if err != nil {
		return nil, err
	}

	// If compression didn't help, use original
	if len(compressed) >= len(data) && algorithm != CompressionNone {
		compressed = data
		algorithm = CompressionNone
	}

	result := &CompressedData{
		Algorithm:      algorithm,
		OriginalSize:   len(data),
		CompressedSize: len(compressed),
		Checksum:       crc32Checksum(data),
		Data:           compressed,
		Timestamp:      time.Now(),
	}

	// Update stats
	c.stats.mu.Lock()
	c.stats.TotalCompressed++
	c.stats.BytesSaved += uint64(len(data) - len(compressed))
	c.stats.ByAlgorithm[string(algorithm)]++
	c.stats.CompressionTime += time.Since(start)
	// Update rolling average ratio
	ratio := float64(len(compressed)) / float64(len(data))
	total := float64(c.stats.TotalCompressed)
	c.stats.AvgRatio = (c.stats.AvgRatio*(total-1) + ratio) / total
	c.stats.mu.Unlock()

	return result, nil
}

// Decompress decompresses data
func (c *Compressor) Decompress(cd *CompressedData) ([]byte, error) {
	if cd.Algorithm == CompressionNone {
		return cd.Data, nil
	}

	start := time.Now()
	var decompressed []byte
	var err error

	switch cd.Algorithm {
	case CompressionGzip:
		decompressed, err = c.decompressGzip(cd.Data)
	case CompressionZlib:
		decompressed, err = c.decompressZlib(cd.Data)
	case CompressionLZ4:
		decompressed, err = c.decompressLZ4(cd.Data, cd.OriginalSize)
	case CompressionZstd:
		decompressed, err = c.decompressZstd(cd.Data)
	default:
		return nil, fmt.Errorf("unsupported algorithm: %s", cd.Algorithm)
	}

	if err != nil {
		return nil, err
	}

	// Verify checksum
	if crc32Checksum(decompressed) != cd.Checksum {
		return nil, fmt.Errorf("checksum mismatch")
	}

	// Update stats
	c.stats.mu.Lock()
	c.stats.TotalDecompressed++
	c.stats.DecompressionTime += time.Since(start)
	c.stats.mu.Unlock()

	return decompressed, nil
}

// Algorithm-specific compression methods

func (c *Compressor) compressGzip(data []byte) ([]byte, error) {
	buf := c.bufferPool.Get().(*bytes.Buffer)
	buf.Reset()
	defer c.bufferPool.Put(buf)

	w, err := gzip.NewWriterLevel(buf, int(c.level))
	if err != nil {
		return nil, err
	}

	if _, err := w.Write(data); err != nil {
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}

	result := make([]byte, buf.Len())
	copy(result, buf.Bytes())
	return result, nil
}

func (c *Compressor) decompressGzip(data []byte) ([]byte, error) {
	r, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer r.Close()

	return io.ReadAll(r)
}

func (c *Compressor) compressZlib(data []byte) ([]byte, error) {
	buf := c.bufferPool.Get().(*bytes.Buffer)
	buf.Reset()
	defer c.bufferPool.Put(buf)

	w, err := zlib.NewWriterLevel(buf, int(c.level))
	if err != nil {
		return nil, err
	}

	if _, err := w.Write(data); err != nil {
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}

	result := make([]byte, buf.Len())
	copy(result, buf.Bytes())
	return result, nil
}

func (c *Compressor) decompressZlib(data []byte) ([]byte, error) {
	r, err := zlib.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer r.Close()

	return io.ReadAll(r)
}

func (c *Compressor) compressLZ4(data []byte) ([]byte, error) {
	buf := make([]byte, lz4.CompressBlockBound(len(data)))
	
	var ht [1 << 16]int
	n, err := lz4.CompressBlock(data, buf, ht[:])
	if err != nil {
		return nil, err
	}
	if n == 0 {
		// Data is incompressible
		return data, nil
	}

	return buf[:n], nil
}

func (c *Compressor) decompressLZ4(data []byte, originalSize int) ([]byte, error) {
	buf := make([]byte, originalSize)
	n, err := lz4.UncompressBlock(data, buf)
	if err != nil {
		return nil, err
	}
	return buf[:n], nil
}

func (c *Compressor) compressZstd(data []byte) ([]byte, error) {
	if c.zstdEncoder == nil {
		return nil, fmt.Errorf("zstd encoder not initialized")
	}
	return c.zstdEncoder.EncodeAll(data, nil), nil
}

func (c *Compressor) decompressZstd(data []byte) ([]byte, error) {
	if c.zstdDecoder == nil {
		return nil, fmt.Errorf("zstd decoder not initialized")
	}
	return c.zstdDecoder.DecodeAll(data, nil)
}

// selectAlgorithm selects the best algorithm based on data characteristics
func (c *Compressor) selectAlgorithm(data []byte) CompressionAlgorithm {
	size := len(data)

	// For very small data, don't compress
	if size < 100 {
		return CompressionNone
	}

	// For small data, use LZ4 (fast)
	if size < 1024 {
		return CompressionLZ4
	}

	// For medium data, use zstd (good balance)
	if size < 100*1024 {
		return CompressionZstd
	}

	// For large data, use gzip (better ratio)
	return CompressionGzip
}

// GetStats returns compression statistics
func (c *Compressor) GetStats() *CompressionStats {
	c.stats.mu.RLock()
	defer c.stats.mu.RUnlock()

	return &CompressionStats{
		TotalCompressed:   c.stats.TotalCompressed,
		TotalDecompressed: c.stats.TotalDecompressed,
		BytesSaved:        c.stats.BytesSaved,
		AvgRatio:          c.stats.AvgRatio,
		ByAlgorithm:       c.stats.ByAlgorithm,
		CompressionTime:   c.stats.CompressionTime,
		DecompressionTime: c.stats.DecompressionTime,
	}
}

// Close closes the compressor and releases resources
func (c *Compressor) Close() {
	if c.zstdEncoder != nil {
		c.zstdEncoder.Close()
	}
	if c.zstdDecoder != nil {
		c.zstdDecoder.Close()
	}
}

// SyncCompressor wraps compression for sync operations
type SyncCompressor struct {
	compressor     *Compressor
	minSizeToCompress int
	metrics        *SyncMetrics
}

// NewSyncCompressor creates a new sync compressor
func NewSyncCompressor(algorithm CompressionAlgorithm, level CompressionLevel, metrics *SyncMetrics) *SyncCompressor {
	return &SyncCompressor{
		compressor:        NewCompressor(algorithm, level),
		minSizeToCompress: 256, // Don't compress data smaller than 256 bytes
		metrics:           metrics,
	}
}

// CompressSyncPayload compresses a sync payload
func (sc *SyncCompressor) CompressSyncPayload(payload interface{}) (*CompressedData, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	// Skip compression for small payloads
	if len(data) < sc.minSizeToCompress {
		return &CompressedData{
			Algorithm:      CompressionNone,
			OriginalSize:   len(data),
			CompressedSize: len(data),
			Data:           data,
			Timestamp:      time.Now(),
		}, nil
	}

	compressed, err := sc.compressor.Compress(data)
	if err != nil {
		return nil, err
	}

	// Record metrics
	if sc.metrics != nil {
		sc.metrics.RecordSyncBytes(
			"local",
			"outbound",
			float64(compressed.CompressedSize),
			compressed.Algorithm != CompressionNone,
		)
	}

	return compressed, nil
}

// DecompressSyncPayload decompresses a sync payload
func (sc *SyncCompressor) DecompressSyncPayload(cd *CompressedData, target interface{}) error {
	data, err := sc.compressor.Decompress(cd)
	if err != nil {
		return err
	}

	return json.Unmarshal(data, target)
}

// GetStats returns compression statistics
func (sc *SyncCompressor) GetStats() *CompressionStats {
	return sc.compressor.GetStats()
}

// Close closes the sync compressor
func (sc *SyncCompressor) Close() {
	sc.compressor.Close()
}

// AdaptiveCompressor adapts compression based on network conditions
type AdaptiveCompressor struct {
	mu              sync.RWMutex
	compressor      *Compressor
	networkQuality  NetworkQuality
	lastAdjustment  time.Time
	adjustInterval  time.Duration
	metrics         *SyncMetrics
}

// NetworkQuality represents network quality levels
type NetworkQuality int

const (
	NetworkExcellent NetworkQuality = iota // 4G/WiFi - use minimal compression
	NetworkGood                            // 3G - use moderate compression
	NetworkPoor                            // 2G - use maximum compression
	NetworkOffline                         // No network
)

// NewAdaptiveCompressor creates a new adaptive compressor
func NewAdaptiveCompressor(metrics *SyncMetrics) *AdaptiveCompressor {
	return &AdaptiveCompressor{
		compressor:     NewCompressor(CompressionAuto, CompressionDefault),
		networkQuality: NetworkGood,
		adjustInterval: 30 * time.Second,
		metrics:        metrics,
	}
}

// SetNetworkQuality sets the current network quality
func (ac *AdaptiveCompressor) SetNetworkQuality(quality NetworkQuality) {
	ac.mu.Lock()
	defer ac.mu.Unlock()

	if ac.networkQuality == quality {
		return
	}

	ac.networkQuality = quality
	ac.lastAdjustment = time.Now()

	// Adjust compression settings based on network quality
	switch quality {
	case NetworkExcellent:
		ac.compressor = NewCompressor(CompressionLZ4, CompressionFastest)
	case NetworkGood:
		ac.compressor = NewCompressor(CompressionZstd, CompressionDefault)
	case NetworkPoor:
		ac.compressor = NewCompressor(CompressionGzip, CompressionBest)
	case NetworkOffline:
		ac.compressor = NewCompressor(CompressionNone, CompressionDefault)
	}
}

// Compress compresses data with adaptive settings
func (ac *AdaptiveCompressor) Compress(data []byte) (*CompressedData, error) {
	ac.mu.RLock()
	compressor := ac.compressor
	ac.mu.RUnlock()

	return compressor.Compress(data)
}

// Decompress decompresses data
func (ac *AdaptiveCompressor) Decompress(cd *CompressedData) ([]byte, error) {
	ac.mu.RLock()
	compressor := ac.compressor
	ac.mu.RUnlock()

	return compressor.Decompress(cd)
}

// GetNetworkQuality returns the current network quality
func (ac *AdaptiveCompressor) GetNetworkQuality() NetworkQuality {
	ac.mu.RLock()
	defer ac.mu.RUnlock()
	return ac.networkQuality
}

// GetStats returns compression statistics
func (ac *AdaptiveCompressor) GetStats() *CompressionStats {
	ac.mu.RLock()
	defer ac.mu.RUnlock()
	return ac.compressor.GetStats()
}

// BandwidthEstimator estimates available bandwidth
type BandwidthEstimator struct {
	mu           sync.RWMutex
	samples      []bandwidthSample
	maxSamples   int
	currentBps   float64
}

type bandwidthSample struct {
	bytes     int64
	duration  time.Duration
	timestamp time.Time
}

// NewBandwidthEstimator creates a new bandwidth estimator
func NewBandwidthEstimator() *BandwidthEstimator {
	return &BandwidthEstimator{
		samples:    make([]bandwidthSample, 0),
		maxSamples: 10,
	}
}

// RecordTransfer records a data transfer for bandwidth estimation
func (be *BandwidthEstimator) RecordTransfer(bytes int64, duration time.Duration) {
	be.mu.Lock()
	defer be.mu.Unlock()

	sample := bandwidthSample{
		bytes:     bytes,
		duration:  duration,
		timestamp: time.Now(),
	}

	be.samples = append(be.samples, sample)
	if len(be.samples) > be.maxSamples {
		be.samples = be.samples[1:]
	}

	// Calculate current bandwidth (bytes per second)
	var totalBytes int64
	var totalDuration time.Duration
	for _, s := range be.samples {
		totalBytes += s.bytes
		totalDuration += s.duration
	}

	if totalDuration > 0 {
		be.currentBps = float64(totalBytes) / totalDuration.Seconds()
	}
}

// GetBandwidth returns the estimated bandwidth in bytes per second
func (be *BandwidthEstimator) GetBandwidth() float64 {
	be.mu.RLock()
	defer be.mu.RUnlock()
	return be.currentBps
}

// GetNetworkQuality returns the estimated network quality
func (be *BandwidthEstimator) GetNetworkQuality() NetworkQuality {
	bps := be.GetBandwidth()

	// Thresholds (bytes per second)
	const (
		excellent = 1000000  // 1 MB/s (4G/WiFi)
		good      = 100000   // 100 KB/s (3G)
		poor      = 10000    // 10 KB/s (2G)
	)

	switch {
	case bps >= excellent:
		return NetworkExcellent
	case bps >= good:
		return NetworkGood
	case bps >= poor:
		return NetworkPoor
	default:
		return NetworkOffline
	}
}

// Helper functions

func crc32Checksum(data []byte) uint32 {
	// Simple CRC32 implementation
	var crc uint32 = 0xFFFFFFFF
	for _, b := range data {
		crc ^= uint32(b)
		for i := 0; i < 8; i++ {
			if crc&1 != 0 {
				crc = (crc >> 1) ^ 0xEDB88320
			} else {
				crc >>= 1
			}
		}
	}
	return ^crc
}

// CompressedSyncMessage represents a compressed sync message
type CompressedSyncMessage struct {
	Header     CompressedMessageHeader `json:"header"`
	Payload    []byte                  `json:"payload"`
}

// CompressedMessageHeader contains metadata about the compressed message
type CompressedMessageHeader struct {
	Version        uint8                `json:"version"`
	Algorithm      CompressionAlgorithm `json:"algorithm"`
	OriginalSize   uint32               `json:"original_size"`
	CompressedSize uint32               `json:"compressed_size"`
	Checksum       uint32               `json:"checksum"`
	Timestamp      int64                `json:"timestamp"`
}

// SerializeCompressedMessage serializes a compressed message for transmission
func SerializeCompressedMessage(cd *CompressedData) ([]byte, error) {
	msg := &CompressedSyncMessage{
		Header: CompressedMessageHeader{
			Version:        1,
			Algorithm:      cd.Algorithm,
			OriginalSize:   uint32(cd.OriginalSize),
			CompressedSize: uint32(cd.CompressedSize),
			Checksum:       cd.Checksum,
			Timestamp:      cd.Timestamp.Unix(),
		},
		Payload: cd.Data,
	}

	// Binary serialization for efficiency
	buf := new(bytes.Buffer)
	
	// Write header
	binary.Write(buf, binary.BigEndian, msg.Header.Version)
	binary.Write(buf, binary.BigEndian, uint8(len(msg.Header.Algorithm)))
	buf.WriteString(string(msg.Header.Algorithm))
	binary.Write(buf, binary.BigEndian, msg.Header.OriginalSize)
	binary.Write(buf, binary.BigEndian, msg.Header.CompressedSize)
	binary.Write(buf, binary.BigEndian, msg.Header.Checksum)
	binary.Write(buf, binary.BigEndian, msg.Header.Timestamp)
	
	// Write payload
	buf.Write(msg.Payload)

	return buf.Bytes(), nil
}

// DeserializeCompressedMessage deserializes a compressed message
func DeserializeCompressedMessage(data []byte) (*CompressedData, error) {
	if len(data) < 20 {
		return nil, fmt.Errorf("data too short")
	}

	buf := bytes.NewReader(data)

	var version uint8
	binary.Read(buf, binary.BigEndian, &version)

	var algLen uint8
	binary.Read(buf, binary.BigEndian, &algLen)

	algBytes := make([]byte, algLen)
	buf.Read(algBytes)
	algorithm := CompressionAlgorithm(algBytes)

	var originalSize, compressedSize, checksum uint32
	var timestamp int64
	binary.Read(buf, binary.BigEndian, &originalSize)
	binary.Read(buf, binary.BigEndian, &compressedSize)
	binary.Read(buf, binary.BigEndian, &checksum)
	binary.Read(buf, binary.BigEndian, &timestamp)

	payload := make([]byte, buf.Len())
	buf.Read(payload)

	return &CompressedData{
		Algorithm:      algorithm,
		OriginalSize:   int(originalSize),
		CompressedSize: int(compressedSize),
		Checksum:       checksum,
		Data:           payload,
		Timestamp:      time.Unix(timestamp, 0),
	}, nil
}
