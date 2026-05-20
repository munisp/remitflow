package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/jackc/pgx/v4/pgxpool"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/google/uuid"
)

// VideoStorageService handles video storage and file management
type VideoStorageService struct {
	router              *gin.Engine
	redis               *redis.Client
	dbPool              *pgxpool.Pool
	minioClient         *minio.Client
	encryptionKey       []byte
	storageBucket       string
	compressionEnabled  bool
	retentionPolicies   map[string]time.Duration
	metrics             *VideoStorageMetrics
	mu                  sync.RWMutex
	
	// Prometheus metrics
	uploadsTotal        *prometheus.CounterVec
	downloadTotal       *prometheus.CounterVec
	storageSize         *prometheus.GaugeVec
	compressionRatio    *prometheus.GaugeVec
	operationDuration   *prometheus.HistogramVec
	activeStreams       prometheus.Gauge
}

type VideoStorageMetrics struct {
	TotalUploads        int64
	TotalDownloads      int64
	TotalStorageSize    int64
	CompressedSize      int64
	AverageFileSize     int64
	ActiveStreams       int64
	FailedOperations    int64
}

type VideoFile struct {
	ID              string                 `json:"id"`
	OriginalName    string                 `json:"original_name"`
	StoragePath     string                 `json:"storage_path"`
	FileSize        int64                  `json:"file_size"`
	CompressedSize  int64                  `json:"compressed_size"`
	MimeType        string                 `json:"mime_type"`
	Duration        float64                `json:"duration"`
	Resolution      string                 `json:"resolution"`
	Bitrate         int64                  `json:"bitrate"`
	Codec           string                 `json:"codec"`
	Encrypted       bool                   `json:"encrypted"`
	Compressed      bool                   `json:"compressed"`
	Checksum        string                 `json:"checksum"`
	Metadata        map[string]interface{} `json:"metadata"`
	UploadedBy      string                 `json:"uploaded_by"`
	SessionID       string                 `json:"session_id"`
	KYCRequestID    string                 `json:"kyc_request_id"`
	RetentionPolicy string                 `json:"retention_policy"`
	ExpiresAt       *time.Time             `json:"expires_at"`
	CreatedAt       time.Time              `json:"created_at"`
	UpdatedAt       time.Time              `json:"updated_at"`
}

type UploadRequest struct {
	SessionID       string                 `json:"session_id"`
	KYCRequestID    string                 `json:"kyc_request_id"`
	OriginalName    string                 `json:"original_name"`
	MimeType        string                 `json:"mime_type"`
	Metadata        map[string]interface{} `json:"metadata"`
	RetentionPolicy string                 `json:"retention_policy"`
	Encrypt         bool                   `json:"encrypt"`
	Compress        bool                   `json:"compress"`
}

type UploadResponse struct {
	Success         bool                   `json:"success"`
	FileID          string                 `json:"file_id"`
	StoragePath     string                 `json:"storage_path"`
	FileSize        int64                  `json:"file_size"`
	CompressedSize  int64                  `json:"compressed_size"`
	CompressionRatio float64               `json:"compression_ratio"`
	Checksum        string                 `json:"checksum"`
	UploadTime      float64                `json:"upload_time_ms"`
	Metadata        map[string]interface{} `json:"metadata"`
	Error           string                 `json:"error,omitempty"`
}

type DownloadRequest struct {
	FileID          string `json:"file_id"`
	SessionID       string `json:"session_id"`
	AccessToken     string `json:"access_token"`
	DownloadFormat  string `json:"download_format"`
	Quality         string `json:"quality"`
}

type StreamingRequest struct {
	FileID          string `json:"file_id"`
	SessionID       string `json:"session_id"`
	StartTime       float64 `json:"start_time"`
	EndTime         float64 `json:"end_time"`
	Quality         string `json:"quality"`
}

type CompressionConfig struct {
	Enabled         bool    `json:"enabled"`
	Quality         int     `json:"quality"`
	MaxBitrate      int64   `json:"max_bitrate"`
	TargetSize      int64   `json:"target_size"`
	PreserveQuality bool    `json:"preserve_quality"`
}

type RetentionPolicy struct {
	Name            string        `json:"name"`
	Duration        time.Duration `json:"duration"`
	AutoDelete      bool          `json:"auto_delete"`
	ArchiveAfter    time.Duration `json:"archive_after"`
	NotifyBefore    time.Duration `json:"notify_before"`
}

func NewVideoStorageService() *VideoStorageService {
	service := &VideoStorageService{
		storageBucket:      "video-kyc-storage",
		compressionEnabled: true,
		retentionPolicies: map[string]time.Duration{
			"standard":   30 * 24 * time.Hour,  // 30 days
			"extended":   90 * 24 * time.Hour,  // 90 days
			"permanent":  0,                    // No expiration
			"temporary":  24 * time.Hour,       // 24 hours
		},
		metrics: &VideoStorageMetrics{},
	}
	
	service.initializeEncryption()
	service.initializeMetrics()
	service.initializeStorage()
	service.initializeDatabase()
	service.initializeRedis()
	service.initializeRouter()
	
	// Start background tasks
	go service.startRetentionManager()
	go service.startMetricsCollector()
	
	return service
}

func (s *VideoStorageService) initializeEncryption() {
	// Generate or load encryption key
	keyStr := os.Getenv("VIDEO_ENCRYPTION_KEY")
	if keyStr == "" {
		// Generate a new key for development
		key := make([]byte, 32)
		rand.Read(key)
		s.encryptionKey = key
		log.Println("Warning: Using generated encryption key. Set VIDEO_ENCRYPTION_KEY in production.")
	} else {
		key, err := hex.DecodeString(keyStr)
		if err != nil || len(key) != 32 {
			log.Fatal("Invalid encryption key. Must be 32 bytes hex-encoded.")
		}
		s.encryptionKey = key
	}
}

func (s *VideoStorageService) initializeMetrics() {
	s.uploadsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "video_uploads_total",
			Help: "Total number of video uploads",
		},
		[]string{"status", "type"},
	)
	
	s.downloadTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "video_downloads_total",
			Help: "Total number of video downloads",
		},
		[]string{"status", "type"},
	)
	
	s.storageSize = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "video_storage_size_bytes",
			Help: "Total storage size in bytes",
		},
		[]string{"type"},
	)
	
	s.compressionRatio = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "video_compression_ratio",
			Help: "Video compression ratio",
		},
		[]string{"quality"},
	)
	
	s.operationDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "video_operation_duration_seconds",
			Help:    "Duration of video operations",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"operation"},
	)
	
	s.activeStreams = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "video_active_streams",
			Help: "Number of active video streams",
		},
	)
	
	prometheus.MustRegister(s.uploadsTotal, s.downloadTotal, s.storageSize, 
		s.compressionRatio, s.operationDuration, s.activeStreams)
}

func (s *VideoStorageService) initializeStorage() {
	// Initialize MinIO client
	endpoint := os.Getenv("MINIO_ENDPOINT")
	if endpoint == "" {
		endpoint = "localhost:9000"
	}
	
	accessKey := os.Getenv("MINIO_ACCESS_KEY")
	if accessKey == "" {
		accessKey = "minioadmin"
	}
	
	secretKey := os.Getenv("MINIO_SECRET_KEY")
	if secretKey == "" {
		secretKey = "minioadmin"
	}
	
	useSSL := os.Getenv("MINIO_USE_SSL") == "true"
	
	var err error
	s.minioClient, err = minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	
	if err != nil {
		log.Printf("Warning: Could not initialize MinIO client: %v", err)
		return
	}
	
	// Create bucket if it doesn't exist
	ctx := context.Background()
	exists, err := s.minioClient.BucketExists(ctx, s.storageBucket)
	if err != nil {
		log.Printf("Warning: Could not check bucket existence: %v", err)
		return
	}
	
	if !exists {
		err = s.minioClient.MakeBucket(ctx, s.storageBucket, minio.MakeBucketOptions{})
		if err != nil {
			log.Printf("Warning: Could not create bucket: %v", err)
			return
		}
	}
	
	log.Println("MinIO storage initialized successfully")
}

func (s *VideoStorageService) initializeDatabase() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:password@localhost:5432/remittance?sslmode=disable"
	}
	
	var err error
	s.dbPool, err = pgxpool.Connect(context.Background(), dbURL)
	if err != nil {
		log.Printf("Warning: Could not connect to database: %v", err)
		return
	}
	
	// Create tables
	createTablesSQL := `
		CREATE TABLE IF NOT EXISTS video_files (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			original_name VARCHAR(255) NOT NULL,
			storage_path VARCHAR(500) NOT NULL,
			file_size BIGINT NOT NULL,
			compressed_size BIGINT DEFAULT 0,
			mime_type VARCHAR(100),
			duration DECIMAL(10,3),
			resolution VARCHAR(20),
			bitrate BIGINT,
			codec VARCHAR(50),
			encrypted BOOLEAN DEFAULT FALSE,
			compressed BOOLEAN DEFAULT FALSE,
			checksum VARCHAR(64),
			metadata JSONB,
			uploaded_by VARCHAR(255),
			session_id VARCHAR(255),
			kyc_request_id VARCHAR(255),
			retention_policy VARCHAR(50) DEFAULT 'standard',
			expires_at TIMESTAMP,
			created_at TIMESTAMP DEFAULT NOW(),
			updated_at TIMESTAMP DEFAULT NOW()
		);
		
		CREATE TABLE IF NOT EXISTS video_access_logs (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			file_id UUID REFERENCES video_files(id),
			access_type VARCHAR(20),
			accessed_by VARCHAR(255),
			session_id VARCHAR(255),
			ip_address INET,
			user_agent TEXT,
			bytes_transferred BIGINT,
			duration_ms INTEGER,
			success BOOLEAN,
			error_message TEXT,
			created_at TIMESTAMP DEFAULT NOW()
		);
		
		CREATE INDEX IF NOT EXISTS idx_video_files_session_id ON video_files(session_id);
		CREATE INDEX IF NOT EXISTS idx_video_files_kyc_request_id ON video_files(kyc_request_id);
		CREATE INDEX IF NOT EXISTS idx_video_files_expires_at ON video_files(expires_at);
		CREATE INDEX IF NOT EXISTS idx_video_access_logs_file_id ON video_access_logs(file_id);
		CREATE INDEX IF NOT EXISTS idx_video_access_logs_created_at ON video_access_logs(created_at);
	`
	
	_, err = s.dbPool.Exec(context.Background(), createTablesSQL)
	if err != nil {
		log.Printf("Warning: Could not create database tables: %v", err)
	}
	
	log.Println("Database initialized for video storage service")
}

func (s *VideoStorageService) initializeRedis() {
	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}
	
	s.redis = redis.NewClient(&redis.Options{
		Addr:     redisAddr,
		Password: os.Getenv("REDIS_PASSWORD"),
		DB:       0,
	})
	
	// Test Redis connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	
	_, err := s.redis.Ping(ctx).Result()
	if err != nil {
		log.Printf("Warning: Could not connect to Redis: %v", err)
	} else {
		log.Println("Redis connection established for video storage service")
	}
}

func (s *VideoStorageService) initializeRouter() {
	s.router = gin.New()
	s.router.Use(gin.Logger())
	s.router.Use(gin.Recovery())
	
	// CORS configuration
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"*"}
	s.router.Use(cors.New(config))
	
	// Health check endpoint
	s.router.GET("/health", s.healthCheck)
	s.router.GET("/metrics", gin.WrapH(promhttp.Handler()))
	
	// Upload endpoints
	s.router.POST("/upload", s.uploadVideo)
	s.router.POST("/upload/multipart", s.uploadVideoMultipart)
	s.router.POST("/upload/chunk", s.uploadChunk)
	s.router.POST("/upload/complete", s.completeChunkedUpload)
	
	// Download endpoints
	s.router.GET("/download/:file_id", s.downloadVideo)
	s.router.GET("/stream/:file_id", s.streamVideo)
	s.router.GET("/thumbnail/:file_id", s.getThumbnail)
	
	// File management endpoints
	s.router.GET("/file/:file_id", s.getFileInfo)
	s.router.PUT("/file/:file_id", s.updateFileInfo)
	s.router.DELETE("/file/:file_id", s.deleteFile)
	s.router.GET("/files", s.listFiles)
	
	// Processing endpoints
	s.router.POST("/compress/:file_id", s.compressVideo)
	s.router.POST("/convert/:file_id", s.convertVideo)
	s.router.POST("/extract/frames/:file_id", s.extractFrames)
	
	// Security endpoints
	s.router.POST("/encrypt/:file_id", s.encryptFile)
	s.router.POST("/decrypt/:file_id", s.decryptFile)
	s.router.GET("/access-token/:file_id", s.generateAccessToken)
	
	// Management endpoints
	s.router.GET("/stats", s.getStorageStats)
	s.router.POST("/cleanup", s.cleanupExpiredFiles)
	s.router.GET("/retention-policies", s.getRetentionPolicies)
}

func (s *VideoStorageService) startRetentionManager() {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()
	
	for {
		select {
		case <-ticker.C:
			s.cleanupExpiredFiles()
		}
	}
}

func (s *VideoStorageService) startMetricsCollector() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	
	for {
		select {
		case <-ticker.C:
			s.updateStorageMetrics()
		}
	}
}

func (s *VideoStorageService) updateStorageMetrics() {
	if s.dbPool == nil {
		return
	}
	
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	
	// Get storage statistics
	var totalSize, compressedSize int64
	var fileCount int
	
	err := s.dbPool.QueryRow(ctx, `
		SELECT 
			COUNT(*) as file_count,
			COALESCE(SUM(file_size), 0) as total_size,
			COALESCE(SUM(compressed_size), 0) as compressed_size
		FROM video_files 
		WHERE expires_at IS NULL OR expires_at > NOW()
	`).Scan(&fileCount, &totalSize, &compressedSize)
	
	if err != nil {
		log.Printf("Error updating storage metrics: %v", err)
		return
	}
	
	s.storageSize.WithLabelValues("total").Set(float64(totalSize))
	s.storageSize.WithLabelValues("compressed").Set(float64(compressedSize))
	
	if totalSize > 0 {
		compressionRatio := float64(compressedSize) / float64(totalSize)
		s.compressionRatio.WithLabelValues("overall").Set(compressionRatio)
	}
	
	s.mu.Lock()
	s.metrics.TotalStorageSize = totalSize
	s.metrics.CompressedSize = compressedSize
	if fileCount > 0 {
		s.metrics.AverageFileSize = totalSize / int64(fileCount)
	}
	s.mu.Unlock()
}

// HTTP Handlers

func (s *VideoStorageService) healthCheck(c *gin.Context) {
	status := gin.H{
		"status":    "healthy",
		"timestamp": time.Now(),
		"service":   "video-storage",
		"version":   "1.0.0",
	}
	
	// Check dependencies
	if s.dbPool != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := s.dbPool.Ping(ctx); err != nil {
			status["database"] = "unhealthy"
			status["status"] = "degraded"
		} else {
			status["database"] = "healthy"
		}
	}
	
	if s.redis != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if _, err := s.redis.Ping(ctx).Result(); err != nil {
			status["redis"] = "unhealthy"
			status["status"] = "degraded"
		} else {
			status["redis"] = "healthy"
		}
	}
	
	if s.minioClient != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if _, err := s.minioClient.BucketExists(ctx, s.storageBucket); err != nil {
			status["storage"] = "unhealthy"
			status["status"] = "degraded"
		} else {
			status["storage"] = "healthy"
		}
	}
	
	c.JSON(http.StatusOK, status)
}

func (s *VideoStorageService) uploadVideo(c *gin.Context) {
	startTime := time.Now()
	
	// Parse upload request
	var uploadReq UploadRequest
	if err := c.ShouldBindJSON(&uploadReq); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format", "details": err.Error()})
		return
	}
	
	// Get video data from request body
	videoData, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read video data"})
		return
	}
	
	if len(videoData) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Empty video data"})
		return
	}
	
	// Process upload
	response := s.processVideoUpload(videoData, uploadReq)
	response.UploadTime = float64(time.Since(startTime).Nanoseconds()) / 1e6
	
	// Update metrics
	status := "success"
	if !response.Success {
		status = "error"
	}
	s.uploadsTotal.WithLabelValues(status, "direct").Inc()
	s.operationDuration.WithLabelValues("upload").Observe(response.UploadTime / 1000.0)
	
	if response.Success {
		c.JSON(http.StatusOK, response)
	} else {
		c.JSON(http.StatusInternalServerError, response)
	}
}

func (s *VideoStorageService) uploadVideoMultipart(c *gin.Context) {
	startTime := time.Now()
	
	// Parse multipart form
	err := c.Request.ParseMultipartForm(100 << 20) // 100 MB max
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to parse multipart form"})
		return
	}
	
	// Get file from form
	file, header, err := c.Request.FormFile("video")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No video file in request"})
		return
	}
	defer file.Close()
	
	// Read file data
	videoData, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read video file"})
		return
	}
	
	// Create upload request from form data
	uploadReq := UploadRequest{
		SessionID:       c.Request.FormValue("session_id"),
		KYCRequestID:    c.Request.FormValue("kyc_request_id"),
		OriginalName:    header.Filename,
		MimeType:        header.Header.Get("Content-Type"),
		RetentionPolicy: c.Request.FormValue("retention_policy"),
		Encrypt:         c.Request.FormValue("encrypt") == "true",
		Compress:        c.Request.FormValue("compress") == "true",
		Metadata:        make(map[string]interface{}),
	}
	
	// Parse metadata if provided
	if metadataStr := c.Request.FormValue("metadata"); metadataStr != "" {
		json.Unmarshal([]byte(metadataStr), &uploadReq.Metadata)
	}
	
	// Process upload
	response := s.processVideoUpload(videoData, uploadReq)
	response.UploadTime = float64(time.Since(startTime).Nanoseconds()) / 1e6
	
	// Update metrics
	status := "success"
	if !response.Success {
		status = "error"
	}
	s.uploadsTotal.WithLabelValues(status, "multipart").Inc()
	s.operationDuration.WithLabelValues("upload").Observe(response.UploadTime / 1000.0)
	
	if response.Success {
		c.JSON(http.StatusOK, response)
	} else {
		c.JSON(http.StatusInternalServerError, response)
	}
}

func (s *VideoStorageService) processVideoUpload(videoData []byte, uploadReq UploadRequest) UploadResponse {
	response := UploadResponse{
		Success: false,
	}
	
	// Generate file ID
	fileID := uuid.New().String()
	
	// Calculate checksum
	hash := sha256.Sum256(videoData)
	checksum := hex.EncodeToString(hash[:])
	
	// Set default values
	if uploadReq.RetentionPolicy == "" {
		uploadReq.RetentionPolicy = "standard"
	}
	
	if uploadReq.MimeType == "" {
		uploadReq.MimeType = "video/mp4"
	}
	
	// Compress video if requested
	processedData := videoData
	var compressedSize int64
	
	if uploadReq.Compress && s.compressionEnabled {
		compressed, err := s.compressVideoData(videoData)
		if err != nil {
			log.Printf("Video compression failed: %v", err)
		} else {
			processedData = compressed
			compressedSize = int64(len(compressed))
		}
	}
	
	// Encrypt video if requested
	if uploadReq.Encrypt {
		encrypted, err := s.encryptData(processedData)
		if err != nil {
			response.Error = fmt.Sprintf("Encryption failed: %v", err)
			return response
		}
		processedData = encrypted
	}
	
	// Generate storage path
	storagePath := s.generateStoragePath(fileID, uploadReq.OriginalName)
	
	// Upload to storage
	if s.minioClient != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		
		reader := bytes.NewReader(processedData)
		_, err := s.minioClient.PutObject(ctx, s.storageBucket, storagePath, reader, 
			int64(len(processedData)), minio.PutObjectOptions{
				ContentType: uploadReq.MimeType,
			})
		
		if err != nil {
			response.Error = fmt.Sprintf("Storage upload failed: %v", err)
			return response
		}
	}
	
	// Calculate expiration time
	var expiresAt *time.Time
	if duration, exists := s.retentionPolicies[uploadReq.RetentionPolicy]; exists && duration > 0 {
		expiry := time.Now().Add(duration)
		expiresAt = &expiry
	}
	
	// Store file metadata in database
	videoFile := VideoFile{
		ID:              fileID,
		OriginalName:    uploadReq.OriginalName,
		StoragePath:     storagePath,
		FileSize:        int64(len(videoData)),
		CompressedSize:  compressedSize,
		MimeType:        uploadReq.MimeType,
		Encrypted:       uploadReq.Encrypt,
		Compressed:      uploadReq.Compress,
		Checksum:        checksum,
		Metadata:        uploadReq.Metadata,
		SessionID:       uploadReq.SessionID,
		KYCRequestID:    uploadReq.KYCRequestID,
		RetentionPolicy: uploadReq.RetentionPolicy,
		ExpiresAt:       expiresAt,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}
	
	err := s.storeFileMetadata(videoFile)
	if err != nil {
		response.Error = fmt.Sprintf("Failed to store metadata: %v", err)
		return response
	}
	
	// Calculate compression ratio
	var compressionRatio float64
	if compressedSize > 0 {
		compressionRatio = float64(compressedSize) / float64(len(videoData))
	}
	
	// Prepare response
	response.Success = true
	response.FileID = fileID
	response.StoragePath = storagePath
	response.FileSize = int64(len(videoData))
	response.CompressedSize = compressedSize
	response.CompressionRatio = compressionRatio
	response.Checksum = checksum
	response.Metadata = uploadReq.Metadata
	
	// Update metrics
	s.mu.Lock()
	s.metrics.TotalUploads++
	s.metrics.TotalStorageSize += int64(len(videoData))
	if compressedSize > 0 {
		s.metrics.CompressedSize += compressedSize
	}
	s.mu.Unlock()
	
	return response
}

func (s *VideoStorageService) generateStoragePath(fileID, originalName string) string {
	// Generate hierarchical path: year/month/day/hour/fileID_originalName
	now := time.Now()
	ext := filepath.Ext(originalName)
	if ext == "" {
		ext = ".mp4"
	}
	
	return fmt.Sprintf("%d/%02d/%02d/%02d/%s%s",
		now.Year(), now.Month(), now.Day(), now.Hour(),
		fileID, ext)
}

func (s *VideoStorageService) compressVideoData(data []byte) ([]byte, error) {
	// Placeholder for video compression
	// In production, use FFmpeg or similar library
	// For now, return original data
	return data, nil
}

func (s *VideoStorageService) encryptData(data []byte) ([]byte, error) {
	block, err := aes.NewCipher(s.encryptionKey)
	if err != nil {
		return nil, err
	}
	
	// Generate random IV
	iv := make([]byte, aes.BlockSize)
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		return nil, err
	}
	
	// Encrypt data
	stream := cipher.NewCFBEncrypter(block, iv)
	encrypted := make([]byte, len(data))
	stream.XORKeyStream(encrypted, data)
	
	// Prepend IV to encrypted data
	result := append(iv, encrypted...)
	
	return result, nil
}

func (s *VideoStorageService) decryptData(data []byte) ([]byte, error) {
	if len(data) < aes.BlockSize {
		return nil, fmt.Errorf("encrypted data too short")
	}
	
	block, err := aes.NewCipher(s.encryptionKey)
	if err != nil {
		return nil, err
	}
	
	// Extract IV
	iv := data[:aes.BlockSize]
	encrypted := data[aes.BlockSize:]
	
	// Decrypt data
	stream := cipher.NewCFBDecrypter(block, iv)
	decrypted := make([]byte, len(encrypted))
	stream.XORKeyStream(decrypted, encrypted)
	
	return decrypted, nil
}

func (s *VideoStorageService) storeFileMetadata(file VideoFile) error {
	if s.dbPool == nil {
		return fmt.Errorf("database not available")
	}
	
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	
	_, err := s.dbPool.Exec(ctx, `
		INSERT INTO video_files 
		(id, original_name, storage_path, file_size, compressed_size, mime_type,
		 encrypted, compressed, checksum, metadata, session_id, kyc_request_id,
		 retention_policy, expires_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
	`, file.ID, file.OriginalName, file.StoragePath, file.FileSize, file.CompressedSize,
		file.MimeType, file.Encrypted, file.Compressed, file.Checksum, file.Metadata,
		file.SessionID, file.KYCRequestID, file.RetentionPolicy, file.ExpiresAt,
		file.CreatedAt, file.UpdatedAt)
	
	return err
}

func (s *VideoStorageService) downloadVideo(c *gin.Context) {
	fileID := c.Param("file_id")
	
	// Get file metadata
	file, err := s.getFileMetadata(fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}
	
	// Check if file has expired
	if file.ExpiresAt != nil && time.Now().After(*file.ExpiresAt) {
		c.JSON(http.StatusGone, gin.H{"error": "File has expired"})
		return
	}
	
	// Download from storage
	if s.minioClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Storage service unavailable"})
		return
	}
	
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	
	object, err := s.minioClient.GetObject(ctx, s.storageBucket, file.StoragePath, minio.GetObjectOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve file"})
		return
	}
	defer object.Close()
	
	// Read file data
	data, err := io.ReadAll(object)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read file"})
		return
	}
	
	// Decrypt if necessary
	if file.Encrypted {
		decrypted, err := s.decryptData(data)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to decrypt file"})
			return
		}
		data = decrypted
	}
	
	// Log access
	s.logFileAccess(file.ID, "download", c.ClientIP(), c.GetHeader("User-Agent"), int64(len(data)), true, "")
	
	// Update metrics
	s.downloadTotal.WithLabelValues("success", "download").Inc()
	s.mu.Lock()
	s.metrics.TotalDownloads++
	s.mu.Unlock()
	
	// Set response headers
	c.Header("Content-Type", file.MimeType)
	c.Header("Content-Length", strconv.Itoa(len(data)))
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", file.OriginalName))
	
	// Send file data
	c.Data(http.StatusOK, file.MimeType, data)
}

func (s *VideoStorageService) getFileMetadata(fileID string) (*VideoFile, error) {
	if s.dbPool == nil {
		return nil, fmt.Errorf("database not available")
	}
	
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	
	var file VideoFile
	var metadataJSON []byte
	
	err := s.dbPool.QueryRow(ctx, `
		SELECT id, original_name, storage_path, file_size, compressed_size, mime_type,
		       duration, resolution, bitrate, codec, encrypted, compressed, checksum,
		       metadata, uploaded_by, session_id, kyc_request_id, retention_policy,
		       expires_at, created_at, updated_at
		FROM video_files
		WHERE id = $1
	`, fileID).Scan(
		&file.ID, &file.OriginalName, &file.StoragePath, &file.FileSize, &file.CompressedSize,
		&file.MimeType, &file.Duration, &file.Resolution, &file.Bitrate, &file.Codec,
		&file.Encrypted, &file.Compressed, &file.Checksum, &metadataJSON, &file.UploadedBy,
		&file.SessionID, &file.KYCRequestID, &file.RetentionPolicy, &file.ExpiresAt,
		&file.CreatedAt, &file.UpdatedAt,
	)
	
	if err != nil {
		return nil, err
	}
	
	// Parse metadata JSON
	if len(metadataJSON) > 0 {
		json.Unmarshal(metadataJSON, &file.Metadata)
	}
	
	return &file, nil
}

func (s *VideoStorageService) logFileAccess(fileID, accessType, ipAddress, userAgent string, 
	bytesTransferred int64, success bool, errorMessage string) {
	if s.dbPool == nil {
		return
	}
	
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		
		_, err := s.dbPool.Exec(ctx, `
			INSERT INTO video_access_logs 
			(file_id, access_type, ip_address, user_agent, bytes_transferred, success, error_message)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, fileID, accessType, ipAddress, userAgent, bytesTransferred, success, errorMessage)
		
		if err != nil {
			log.Printf("Error logging file access: %v", err)
		}
	}()
}

// Additional handler methods would be implemented here...
// (streamVideo, getThumbnail, getFileInfo, updateFileInfo, deleteFile, etc.)

func (s *VideoStorageService) streamVideo(c *gin.Context) {
	// Implementation for video streaming
	c.JSON(http.StatusOK, gin.H{"message": "Video streaming endpoint - implementation in progress"})
}

func (s *VideoStorageService) getThumbnail(c *gin.Context) {
	// Implementation for thumbnail generation
	c.JSON(http.StatusOK, gin.H{"message": "Thumbnail endpoint - implementation in progress"})
}

func (s *VideoStorageService) getFileInfo(c *gin.Context) {
	fileID := c.Param("file_id")
	
	file, err := s.getFileMetadata(fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}
	
	c.JSON(http.StatusOK, file)
}

func (s *VideoStorageService) updateFileInfo(c *gin.Context) {
	// Implementation for updating file metadata
	c.JSON(http.StatusOK, gin.H{"message": "Update file info endpoint - implementation in progress"})
}

func (s *VideoStorageService) deleteFile(c *gin.Context) {
	// Implementation for file deletion
	c.JSON(http.StatusOK, gin.H{"message": "Delete file endpoint - implementation in progress"})
}

func (s *VideoStorageService) listFiles(c *gin.Context) {
	// Implementation for listing files
	c.JSON(http.StatusOK, gin.H{"message": "List files endpoint - implementation in progress"})
}

func (s *VideoStorageService) compressVideo(c *gin.Context) {
	// Implementation for video compression
	c.JSON(http.StatusOK, gin.H{"message": "Compress video endpoint - implementation in progress"})
}

func (s *VideoStorageService) convertVideo(c *gin.Context) {
	// Implementation for video conversion
	c.JSON(http.StatusOK, gin.H{"message": "Convert video endpoint - implementation in progress"})
}

func (s *VideoStorageService) extractFrames(c *gin.Context) {
	// Implementation for frame extraction
	c.JSON(http.StatusOK, gin.H{"message": "Extract frames endpoint - implementation in progress"})
}

func (s *VideoStorageService) encryptFile(c *gin.Context) {
	// Implementation for file encryption
	c.JSON(http.StatusOK, gin.H{"message": "Encrypt file endpoint - implementation in progress"})
}

func (s *VideoStorageService) decryptFile(c *gin.Context) {
	// Implementation for file decryption
	c.JSON(http.StatusOK, gin.H{"message": "Decrypt file endpoint - implementation in progress"})
}

func (s *VideoStorageService) generateAccessToken(c *gin.Context) {
	// Implementation for access token generation
	c.JSON(http.StatusOK, gin.H{"message": "Generate access token endpoint - implementation in progress"})
}

func (s *VideoStorageService) getStorageStats(c *gin.Context) {
	s.mu.RLock()
	stats := *s.metrics
	s.mu.RUnlock()
	
	c.JSON(http.StatusOK, gin.H{
		"stats": stats,
		"timestamp": time.Now(),
		"retention_policies": s.retentionPolicies,
	})
}

func (s *VideoStorageService) cleanupExpiredFiles() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Implementation for cleaning up expired files
		c.JSON(http.StatusOK, gin.H{"message": "Cleanup expired files endpoint - implementation in progress"})
	}
}

func (s *VideoStorageService) getRetentionPolicies(c *gin.Context) {
	policies := make([]RetentionPolicy, 0, len(s.retentionPolicies))
	
	for name, duration := range s.retentionPolicies {
		policy := RetentionPolicy{
			Name:         name,
			Duration:     duration,
			AutoDelete:   true,
			ArchiveAfter: duration / 2,
			NotifyBefore: 24 * time.Hour,
		}
		policies = append(policies, policy)
	}
	
	c.JSON(http.StatusOK, gin.H{"policies": policies})
}

// Additional methods for chunked upload, streaming, etc. would be implemented here...

func (s *VideoStorageService) uploadChunk(c *gin.Context) {
	// Implementation for chunked upload
	c.JSON(http.StatusOK, gin.H{"message": "Upload chunk endpoint - implementation in progress"})
}

func (s *VideoStorageService) completeChunkedUpload(c *gin.Context) {
	// Implementation for completing chunked upload
	c.JSON(http.StatusOK, gin.H{"message": "Complete chunked upload endpoint - implementation in progress"})
}

func (s *VideoStorageService) Start(port string) error {
	if port == "" {
		port = "8086"
	}
	
	log.Printf("Starting Video Storage Service on port %s", port)
	return s.router.Run("0.0.0.0:" + port)
}

func main() {
	service := NewVideoStorageService()
	
	port := os.Getenv("PORT")
	if port == "" {
		port = "8086"
	}
	
	log.Fatal(service.Start(port))
}

