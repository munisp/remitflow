package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/jackc/pgx/v4/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"gocv.io/x/gocv"
)

// FaceDetectionService handles face detection and recognition operations
type FaceDetectionService struct {
	router              *gin.Engine
	redis               *redis.Client
	dbPool              *pgxpool.Pool
	faceClassifier      gocv.CascadeClassifier
	eyeClassifier       gocv.CascadeClassifier
	smileClassifier     gocv.CascadeClassifier
	profileClassifier   gocv.CascadeClassifier
	faceRecognizer      gocv.FaceRecognizer
	processingQueue     chan *FaceDetectionRequest
	workers             int
	metrics             *FaceDetectionMetrics
	mu                  sync.RWMutex
	
	// Prometheus metrics
	detectionsTotal     *prometheus.CounterVec
	detectionDuration   *prometheus.HistogramVec
	recognitionAccuracy *prometheus.GaugeVec
	queueDepth          prometheus.Gauge
	activeWorkers       prometheus.Gauge
}

type FaceDetectionMetrics struct {
	TotalDetections     int64
	SuccessfulDetections int64
	FailedDetections    int64
	AverageConfidence   float64
	ProcessingTime      time.Duration
	QueueDepth          int64
	ActiveWorkers       int64
}

type FaceDetectionRequest struct {
	ID              string                 `json:"id"`
	ImageData       string                 `json:"image_data"`
	ImageFormat     string                 `json:"image_format"`
	DetectionType   string                 `json:"detection_type"`
	Options         map[string]interface{} `json:"options"`
	ResponseChannel chan *FaceDetectionResponse
	Timestamp       time.Time
}

type FaceDetectionResponse struct {
	ID              string           `json:"id"`
	Success         bool             `json:"success"`
	Faces           []DetectedFace   `json:"faces"`
	ProcessingTime  float64          `json:"processing_time_ms"`
	ImageWidth      int              `json:"image_width"`
	ImageHeight     int              `json:"image_height"`
	Confidence      float64          `json:"confidence"`
	QualityScore    float64          `json:"quality_score"`
	Error           string           `json:"error,omitempty"`
	Metadata        map[string]interface{} `json:"metadata"`
	Timestamp       time.Time        `json:"timestamp"`
}

type DetectedFace struct {
	X               int                    `json:"x"`
	Y               int                    `json:"y"`
	Width           int                    `json:"width"`
	Height          int                    `json:"height"`
	Confidence      float64                `json:"confidence"`
	Landmarks       []FaceLandmark         `json:"landmarks"`
	Attributes      map[string]interface{} `json:"attributes"`
	QualityMetrics  FaceQualityMetrics     `json:"quality_metrics"`
	Encoding        []float64              `json:"encoding,omitempty"`
}

type FaceLandmark struct {
	Type string  `json:"type"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
}

type FaceQualityMetrics struct {
	Sharpness       float64 `json:"sharpness"`
	Brightness      float64 `json:"brightness"`
	Contrast        float64 `json:"contrast"`
	Symmetry        float64 `json:"symmetry"`
	FrontalPose     float64 `json:"frontal_pose"`
	EyeOpenness     float64 `json:"eye_openness"`
	MouthOpenness   float64 `json:"mouth_openness"`
	OverallQuality  float64 `json:"overall_quality"`
}

type FaceRecognitionRequest struct {
	ID              string                 `json:"id"`
	FaceEncoding1   []float64              `json:"face_encoding_1"`
	FaceEncoding2   []float64              `json:"face_encoding_2"`
	Threshold       float64                `json:"threshold"`
	Options         map[string]interface{} `json:"options"`
}

type FaceRecognitionResponse struct {
	ID              string    `json:"id"`
	Success         bool      `json:"success"`
	Match           bool      `json:"match"`
	Similarity      float64   `json:"similarity"`
	Distance        float64   `json:"distance"`
	Confidence      float64   `json:"confidence"`
	ProcessingTime  float64   `json:"processing_time_ms"`
	Error           string    `json:"error,omitempty"`
	Timestamp       time.Time `json:"timestamp"`
}

func NewFaceDetectionService() *FaceDetectionService {
	service := &FaceDetectionService{
		workers:         4,
		processingQueue: make(chan *FaceDetectionRequest, 1000),
		metrics:         &FaceDetectionMetrics{},
	}
	
	service.initializeMetrics()
	service.initializeClassifiers()
	service.initializeDatabase()
	service.initializeRedis()
	service.initializeRouter()
	service.startWorkers()
	
	return service
}

func (s *FaceDetectionService) initializeMetrics() {
	s.detectionsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "face_detections_total",
			Help: "Total number of face detection requests",
		},
		[]string{"type", "status"},
	)
	
	s.detectionDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "face_detection_duration_seconds",
			Help:    "Duration of face detection operations",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"type"},
	)
	
	s.recognitionAccuracy = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "face_recognition_accuracy",
			Help: "Face recognition accuracy percentage",
		},
		[]string{"model"},
	)
	
	s.queueDepth = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "face_detection_queue_depth",
			Help: "Number of requests in processing queue",
		},
	)
	
	s.activeWorkers = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "face_detection_active_workers",
			Help: "Number of active worker goroutines",
		},
	)
	
	prometheus.MustRegister(s.detectionsTotal, s.detectionDuration, s.recognitionAccuracy, s.queueDepth, s.activeWorkers)
}

func (s *FaceDetectionService) initializeClassifiers() {
	// Initialize OpenCV classifiers
	var err error
	
	// Load Haar cascade classifiers
	s.faceClassifier = gocv.NewCascadeClassifier()
	if !s.faceClassifier.Load("data/haarcascade_frontalface_alt.xml") {
		log.Println("Warning: Could not load face classifier, using default detection")
	}
	
	s.eyeClassifier = gocv.NewCascadeClassifier()
	if !s.eyeClassifier.Load("data/haarcascade_eye.xml") {
		log.Println("Warning: Could not load eye classifier")
	}
	
	s.smileClassifier = gocv.NewCascadeClassifier()
	if !s.smileClassifier.Load("data/haarcascade_smile.xml") {
		log.Println("Warning: Could not load smile classifier")
	}
	
	s.profileClassifier = gocv.NewCascadeClassifier()
	if !s.profileClassifier.Load("data/haarcascade_profileface.xml") {
		log.Println("Warning: Could not load profile classifier")
	}
	
	// Initialize face recognizer
	s.faceRecognizer = gocv.NewLBPHFaceRecognizer()
	if err != nil {
		log.Printf("Warning: Could not initialize face recognizer: %v", err)
	}
	
	log.Println("Face detection classifiers initialized")
}

func (s *FaceDetectionService) initializeDatabase() {
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
	
	// Create tables for face detection data
	createTablesSQL := `
		CREATE TABLE IF NOT EXISTS face_detections (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			request_id VARCHAR(255) NOT NULL,
			image_hash VARCHAR(255),
			faces_detected INTEGER DEFAULT 0,
			confidence DECIMAL(5,4),
			quality_score DECIMAL(5,4),
			processing_time_ms INTEGER,
			metadata JSONB,
			created_at TIMESTAMP DEFAULT NOW(),
			updated_at TIMESTAMP DEFAULT NOW()
		);
		
		CREATE TABLE IF NOT EXISTS face_encodings (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			detection_id UUID REFERENCES face_detections(id),
			face_index INTEGER,
			encoding DECIMAL[],
			landmarks JSONB,
			quality_metrics JSONB,
			created_at TIMESTAMP DEFAULT NOW()
		);
		
		CREATE INDEX IF NOT EXISTS idx_face_detections_request_id ON face_detections(request_id);
		CREATE INDEX IF NOT EXISTS idx_face_detections_created_at ON face_detections(created_at);
		CREATE INDEX IF NOT EXISTS idx_face_encodings_detection_id ON face_encodings(detection_id);
	`
	
	_, err = s.dbPool.Exec(context.Background(), createTablesSQL)
	if err != nil {
		log.Printf("Warning: Could not create database tables: %v", err)
	}
	
	log.Println("Database initialized for face detection service")
}

func (s *FaceDetectionService) initializeRedis() {
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
		log.Println("Redis connection established for face detection service")
	}
}

func (s *FaceDetectionService) initializeRouter() {
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
	
	// Face detection endpoints
	s.router.POST("/detect", s.detectFaces)
	s.router.POST("/recognize", s.recognizeFaces)
	s.router.POST("/compare", s.compareFaces)
	s.router.GET("/detection/:id", s.getDetectionResult)
	
	// Quality assessment endpoints
	s.router.POST("/quality", s.assessFaceQuality)
	s.router.POST("/landmarks", s.detectLandmarks)
	
	// Batch processing endpoints
	s.router.POST("/batch/detect", s.batchDetectFaces)
	s.router.POST("/batch/recognize", s.batchRecognizeFaces)
	
	// Management endpoints
	s.router.GET("/stats", s.getServiceStats)
	s.router.POST("/train", s.trainRecognizer)
}

func (s *FaceDetectionService) startWorkers() {
	for i := 0; i < s.workers; i++ {
		go s.worker(i)
	}
	s.activeWorkers.Set(float64(s.workers))
	log.Printf("Started %d face detection workers", s.workers)
}

func (s *FaceDetectionService) worker(id int) {
	log.Printf("Face detection worker %d started", id)
	
	for request := range s.processingQueue {
		s.processDetectionRequest(request)
		s.queueDepth.Dec()
	}
}

func (s *FaceDetectionService) processDetectionRequest(request *FaceDetectionRequest) {
	startTime := time.Now()
	
	response := &FaceDetectionResponse{
		ID:        request.ID,
		Success:   false,
		Timestamp: time.Now(),
	}
	
	defer func() {
		response.ProcessingTime = float64(time.Since(startTime).Nanoseconds()) / 1e6
		request.ResponseChannel <- response
		close(request.ResponseChannel)
	}()
	
	// Decode image data
	imageData, err := base64.StdEncoding.DecodeString(request.ImageData)
	if err != nil {
		response.Error = fmt.Sprintf("Failed to decode image data: %v", err)
		s.detectionsTotal.WithLabelValues(request.DetectionType, "error").Inc()
		return
	}
	
	// Load image
	img, format, err := image.Decode(bytes.NewReader(imageData))
	if err != nil {
		response.Error = fmt.Sprintf("Failed to decode image: %v", err)
		s.detectionsTotal.WithLabelValues(request.DetectionType, "error").Inc()
		return
	}
	
	response.ImageWidth = img.Bounds().Dx()
	response.ImageHeight = img.Bounds().Dy()
	
	// Convert to OpenCV Mat
	mat, err := s.imageToMat(img)
	if err != nil {
		response.Error = fmt.Sprintf("Failed to convert image to Mat: %v", err)
		s.detectionsTotal.WithLabelValues(request.DetectionType, "error").Inc()
		return
	}
	defer mat.Close()
	
	// Perform face detection
	faces := s.detectFacesInMat(mat, request.DetectionType)
	
	// Process detected faces
	for i, faceRect := range faces {
		face := s.processFace(mat, faceRect, i)
		response.Faces = append(response.Faces, face)
	}
	
	// Calculate overall confidence and quality
	if len(response.Faces) > 0 {
		totalConfidence := 0.0
		totalQuality := 0.0
		for _, face := range response.Faces {
			totalConfidence += face.Confidence
			totalQuality += face.QualityMetrics.OverallQuality
		}
		response.Confidence = totalConfidence / float64(len(response.Faces))
		response.QualityScore = totalQuality / float64(len(response.Faces))
	}
	
	response.Success = true
	response.Metadata = map[string]interface{}{
		"format":          format,
		"detection_type":  request.DetectionType,
		"faces_detected":  len(response.Faces),
		"processing_node": os.Getenv("HOSTNAME"),
	}
	
	// Store results
	s.storeDetectionResult(response)
	
	// Update metrics
	s.detectionsTotal.WithLabelValues(request.DetectionType, "success").Inc()
	s.detectionDuration.WithLabelValues(request.DetectionType).Observe(response.ProcessingTime / 1000.0)
	
	s.mu.Lock()
	s.metrics.TotalDetections++
	s.metrics.SuccessfulDetections++
	s.metrics.AverageConfidence = (s.metrics.AverageConfidence*float64(s.metrics.SuccessfulDetections-1) + response.Confidence) / float64(s.metrics.SuccessfulDetections)
	s.mu.Unlock()
}

func (s *FaceDetectionService) imageToMat(img image.Image) (gocv.Mat, error) {
	// Convert image to RGBA
	bounds := img.Bounds()
	rgba := image.NewRGBA(bounds)
	
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			rgba.Set(x, y, img.At(x, y))
		}
	}
	
	// Create OpenCV Mat from RGBA data
	mat, err := gocv.NewMatFromBytes(bounds.Dy(), bounds.Dx(), gocv.MatTypeCV8UC4, rgba.Pix)
	if err != nil {
		return gocv.NewMat(), err
	}
	
	// Convert to BGR for OpenCV processing
	bgrMat := gocv.NewMat()
	gocv.CvtColor(mat, &bgrMat, gocv.ColorRGBAToBGR)
	mat.Close()
	
	return bgrMat, nil
}

func (s *FaceDetectionService) detectFacesInMat(mat gocv.Mat, detectionType string) []image.Rectangle {
	var faces []image.Rectangle
	
	// Convert to grayscale for detection
	gray := gocv.NewMat()
	defer gray.Close()
	gocv.CvtColor(mat, &gray, gocv.ColorBGRToGray)
	
	switch detectionType {
	case "frontal":
		if !s.faceClassifier.Empty() {
			faces = s.faceClassifier.DetectMultiScale(gray)
		}
	case "profile":
		if !s.profileClassifier.Empty() {
			faces = s.profileClassifier.DetectMultiScale(gray)
		}
	case "comprehensive":
		// Detect both frontal and profile faces
		if !s.faceClassifier.Empty() {
			frontalFaces := s.faceClassifier.DetectMultiScale(gray)
			faces = append(faces, frontalFaces...)
		}
		if !s.profileClassifier.Empty() {
			profileFaces := s.profileClassifier.DetectMultiScale(gray)
			faces = append(faces, profileFaces...)
		}
	default:
		// Default to frontal detection
		if !s.faceClassifier.Empty() {
			faces = s.faceClassifier.DetectMultiScale(gray)
		}
	}
	
	// Remove duplicate detections
	faces = s.removeDuplicateFaces(faces)
	
	return faces
}

func (s *FaceDetectionService) removeDuplicateFaces(faces []image.Rectangle) []image.Rectangle {
	if len(faces) <= 1 {
		return faces
	}
	
	var uniqueFaces []image.Rectangle
	
	for _, face1 := range faces {
		isDuplicate := false
		for _, face2 := range uniqueFaces {
			// Calculate overlap
			overlap := s.calculateOverlap(face1, face2)
			if overlap > 0.5 { // 50% overlap threshold
				isDuplicate = true
				break
			}
		}
		if !isDuplicate {
			uniqueFaces = append(uniqueFaces, face1)
		}
	}
	
	return uniqueFaces
}

func (s *FaceDetectionService) calculateOverlap(rect1, rect2 image.Rectangle) float64 {
	// Calculate intersection
	x1 := math.Max(float64(rect1.Min.X), float64(rect2.Min.X))
	y1 := math.Max(float64(rect1.Min.Y), float64(rect2.Min.Y))
	x2 := math.Min(float64(rect1.Max.X), float64(rect2.Max.X))
	y2 := math.Min(float64(rect1.Max.Y), float64(rect2.Max.Y))
	
	if x2 <= x1 || y2 <= y1 {
		return 0.0
	}
	
	intersection := (x2 - x1) * (y2 - y1)
	area1 := float64(rect1.Dx() * rect1.Dy())
	area2 := float64(rect2.Dx() * rect2.Dy())
	union := area1 + area2 - intersection
	
	return intersection / union
}

func (s *FaceDetectionService) processFace(mat gocv.Mat, faceRect image.Rectangle, index int) DetectedFace {
	face := DetectedFace{
		X:          faceRect.Min.X,
		Y:          faceRect.Min.Y,
		Width:      faceRect.Dx(),
		Height:     faceRect.Dy(),
		Confidence: 0.85, // Default confidence for Haar cascades
		Attributes: make(map[string]interface{}),
	}
	
	// Extract face region
	faceROI := mat.Region(faceRect)
	defer faceROI.Close()
	
	// Detect landmarks
	face.Landmarks = s.detectFaceLandmarks(faceROI, faceRect)
	
	// Calculate quality metrics
	face.QualityMetrics = s.calculateFaceQuality(faceROI)
	
	// Detect facial attributes
	face.Attributes = s.detectFacialAttributes(faceROI)
	
	// Generate face encoding for recognition
	face.Encoding = s.generateFaceEncoding(faceROI)
	
	return face
}

func (s *FaceDetectionService) detectFaceLandmarks(faceROI gocv.Mat, faceRect image.Rectangle) []FaceLandmark {
	var landmarks []FaceLandmark
	
	// Convert to grayscale
	gray := gocv.NewMat()
	defer gray.Close()
	gocv.CvtColor(faceROI, &gray, gocv.ColorBGRToGray)
	
	// Detect eyes
	if !s.eyeClassifier.Empty() {
		eyes := s.eyeClassifier.DetectMultiScale(gray)
		for i, eye := range eyes {
			eyeType := "left_eye"
			if i == 1 {
				eyeType = "right_eye"
			}
			landmarks = append(landmarks, FaceLandmark{
				Type: eyeType,
				X:    float64(faceRect.Min.X + eye.Min.X + eye.Dx()/2),
				Y:    float64(faceRect.Min.Y + eye.Min.Y + eye.Dy()/2),
			})
		}
	}
	
	// Estimate nose position (center of face, slightly below eyes)
	landmarks = append(landmarks, FaceLandmark{
		Type: "nose",
		X:    float64(faceRect.Min.X + faceRect.Dx()/2),
		Y:    float64(faceRect.Min.Y + int(float64(faceRect.Dy())*0.6)),
	})
	
	// Detect smile/mouth
	if !s.smileClassifier.Empty() {
		smiles := s.smileClassifier.DetectMultiScale(gray)
		if len(smiles) > 0 {
			mouth := smiles[0]
			landmarks = append(landmarks, FaceLandmark{
				Type: "mouth",
				X:    float64(faceRect.Min.X + mouth.Min.X + mouth.Dx()/2),
				Y:    float64(faceRect.Min.Y + mouth.Min.Y + mouth.Dy()/2),
			})
		} else {
			// Estimate mouth position
			landmarks = append(landmarks, FaceLandmark{
				Type: "mouth",
				X:    float64(faceRect.Min.X + faceRect.Dx()/2),
				Y:    float64(faceRect.Min.Y + int(float64(faceRect.Dy())*0.8)),
			})
		}
	}
	
	return landmarks
}

func (s *FaceDetectionService) calculateFaceQuality(faceROI gocv.Mat) FaceQualityMetrics {
	// Convert to grayscale for analysis
	gray := gocv.NewMat()
	defer gray.Close()
	gocv.CvtColor(faceROI, &gray, gocv.ColorBGRToGray)
	
	// Calculate sharpness using Laplacian variance
	laplacian := gocv.NewMat()
	defer laplacian.Close()
	gocv.Laplacian(gray, &laplacian, gocv.MatTypeCV64F, 1, 1, 0, gocv.BorderDefault)
	
	mean, stddev := gocv.MeanStdDev(laplacian, gocv.NewMat())
	sharpness := stddev.GetDoubleAt(0, 0) * stddev.GetDoubleAt(0, 0)
	
	// Calculate brightness
	meanBrightness, _ := gocv.MeanStdDev(gray, gocv.NewMat())
	brightness := meanBrightness.GetDoubleAt(0, 0) / 255.0
	
	// Calculate contrast
	_, contrastStddev := gocv.MeanStdDev(gray, gocv.NewMat())
	contrast := contrastStddev.GetDoubleAt(0, 0) / 255.0
	
	// Normalize sharpness (typical range 0-1000, normalize to 0-1)
	normalizedSharpness := math.Min(sharpness/1000.0, 1.0)
	
	// Calculate overall quality
	overallQuality := (normalizedSharpness*0.4 + brightness*0.3 + contrast*0.3)
	
	return FaceQualityMetrics{
		Sharpness:      normalizedSharpness,
		Brightness:     brightness,
		Contrast:       contrast,
		Symmetry:       0.8, // Placeholder - would need more complex analysis
		FrontalPose:    0.9, // Placeholder - would need pose estimation
		EyeOpenness:    0.9, // Placeholder - would need eye state detection
		MouthOpenness:  0.1, // Placeholder - would need mouth state detection
		OverallQuality: overallQuality,
	}
}

func (s *FaceDetectionService) detectFacialAttributes(faceROI gocv.Mat) map[string]interface{} {
	attributes := make(map[string]interface{})
	
	// Convert to grayscale
	gray := gocv.NewMat()
	defer gray.Close()
	gocv.CvtColor(faceROI, &gray, gocv.ColorBGRToGray)
	
	// Detect smile
	if !s.smileClassifier.Empty() {
		smiles := s.smileClassifier.DetectMultiScale(gray)
		attributes["smiling"] = len(smiles) > 0
		attributes["smile_confidence"] = float64(len(smiles)) * 0.8
	}
	
	// Detect eyes
	if !s.eyeClassifier.Empty() {
		eyes := s.eyeClassifier.DetectMultiScale(gray)
		attributes["eyes_detected"] = len(eyes)
		attributes["eyes_open"] = len(eyes) >= 2
	}
	
	// Estimate age and gender (placeholder - would need trained models)
	attributes["estimated_age"] = "adult"
	attributes["estimated_gender"] = "unknown"
	
	// Calculate face orientation
	attributes["face_angle"] = 0.0 // Placeholder - would need pose estimation
	
	return attributes
}

func (s *FaceDetectionService) generateFaceEncoding(faceROI gocv.Mat) []float64 {
	// Resize face to standard size for encoding
	resized := gocv.NewMat()
	defer resized.Close()
	gocv.Resize(faceROI, &resized, image.Pt(128, 128), 0, 0, gocv.InterpolationLinear)
	
	// Convert to grayscale
	gray := gocv.NewMat()
	defer gray.Close()
	gocv.CvtColor(resized, &gray, gocv.ColorBGRToGray)
	
	// Generate simple encoding based on image statistics
	// In production, use a trained deep learning model
	encoding := make([]float64, 128)
	
	// Calculate histogram features
	hist := gocv.NewMat()
	defer hist.Close()
	
	mask := gocv.NewMat()
	defer mask.Close()
	
	gocv.CalcHist([]gocv.Mat{gray}, []int{0}, mask, &hist, []int{32}, []float64{0, 256}, false)
	
	// Normalize and use as part of encoding
	for i := 0; i < 32 && i < len(encoding); i++ {
		encoding[i] = hist.GetFloatAt(i, 0) / 1000.0
	}
	
	// Add statistical features
	mean, stddev := gocv.MeanStdDev(gray, gocv.NewMat())
	if len(encoding) > 32 {
		encoding[32] = mean.GetDoubleAt(0, 0) / 255.0
		encoding[33] = stddev.GetDoubleAt(0, 0) / 255.0
	}
	
	// Fill remaining with normalized pixel values (simplified)
	for i := 34; i < len(encoding); i++ {
		row := (i - 34) / 16
		col := (i - 34) % 16
		if row < gray.Rows() && col < gray.Cols() {
			encoding[i] = float64(gray.GetUCharAt(row*8, col*8)) / 255.0
		}
	}
	
	return encoding
}

func (s *FaceDetectionService) storeDetectionResult(response *FaceDetectionResponse) {
	if s.dbPool == nil {
		return
	}
	
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	
	// Store main detection record
	var detectionID string
	err := s.dbPool.QueryRow(ctx, `
		INSERT INTO face_detections (request_id, faces_detected, confidence, quality_score, processing_time_ms, metadata)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, response.ID, len(response.Faces), response.Confidence, response.QualityScore, response.ProcessingTime, response.Metadata).Scan(&detectionID)
	
	if err != nil {
		log.Printf("Error storing detection result: %v", err)
		return
	}
	
	// Store face encodings
	for i, face := range response.Faces {
		_, err := s.dbPool.Exec(ctx, `
			INSERT INTO face_encodings (detection_id, face_index, encoding, landmarks, quality_metrics)
			VALUES ($1, $2, $3, $4, $5)
		`, detectionID, i, face.Encoding, face.Landmarks, face.QualityMetrics)
		
		if err != nil {
			log.Printf("Error storing face encoding: %v", err)
		}
	}
}

// HTTP Handlers

func (s *FaceDetectionService) healthCheck(c *gin.Context) {
	status := gin.H{
		"status":    "healthy",
		"timestamp": time.Now(),
		"service":   "face-detection",
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
	
	status["queue_depth"] = len(s.processingQueue)
	status["active_workers"] = s.workers
	
	c.JSON(http.StatusOK, status)
}

func (s *FaceDetectionService) detectFaces(c *gin.Context) {
	var request FaceDetectionRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format", "details": err.Error()})
		return
	}
	
	// Generate request ID if not provided
	if request.ID == "" {
		request.ID = fmt.Sprintf("detect_%d", time.Now().UnixNano())
	}
	
	// Set default detection type
	if request.DetectionType == "" {
		request.DetectionType = "frontal"
	}
	
	request.Timestamp = time.Now()
	request.ResponseChannel = make(chan *FaceDetectionResponse, 1)
	
	// Check queue capacity
	if len(s.processingQueue) >= cap(s.processingQueue) {
		c.JSON(http.StatusTooManyRequests, gin.H{
			"error": "Processing queue is full",
			"queue_depth": len(s.processingQueue),
			"queue_capacity": cap(s.processingQueue),
		})
		return
	}
	
	// Add to processing queue
	s.processingQueue <- &request
	s.queueDepth.Inc()
	
	// Wait for response with timeout
	select {
	case response := <-request.ResponseChannel:
		if response.Success {
			c.JSON(http.StatusOK, response)
		} else {
			c.JSON(http.StatusInternalServerError, response)
		}
	case <-time.After(30 * time.Second):
		c.JSON(http.StatusRequestTimeout, gin.H{
			"error": "Request timeout",
			"request_id": request.ID,
		})
	}
}

func (s *FaceDetectionService) recognizeFaces(c *gin.Context) {
	var request FaceRecognitionRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format", "details": err.Error()})
		return
	}
	
	startTime := time.Now()
	
	response := FaceRecognitionResponse{
		ID:        request.ID,
		Success:   false,
		Timestamp: time.Now(),
	}
	
	// Validate encodings
	if len(request.FaceEncoding1) == 0 || len(request.FaceEncoding2) == 0 {
		response.Error = "Face encodings cannot be empty"
		c.JSON(http.StatusBadRequest, response)
		return
	}
	
	if len(request.FaceEncoding1) != len(request.FaceEncoding2) {
		response.Error = "Face encodings must have the same length"
		c.JSON(http.StatusBadRequest, response)
		return
	}
	
	// Calculate similarity using cosine similarity
	similarity := s.calculateCosineSimilarity(request.FaceEncoding1, request.FaceEncoding2)
	distance := 1.0 - similarity
	
	// Set default threshold if not provided
	threshold := request.Threshold
	if threshold == 0 {
		threshold = 0.6
	}
	
	response.Success = true
	response.Similarity = similarity
	response.Distance = distance
	response.Match = similarity >= threshold
	response.Confidence = similarity
	response.ProcessingTime = float64(time.Since(startTime).Nanoseconds()) / 1e6
	
	c.JSON(http.StatusOK, response)
}

func (s *FaceDetectionService) calculateCosineSimilarity(encoding1, encoding2 []float64) float64 {
	if len(encoding1) != len(encoding2) {
		return 0.0
	}
	
	var dotProduct, norm1, norm2 float64
	
	for i := 0; i < len(encoding1); i++ {
		dotProduct += encoding1[i] * encoding2[i]
		norm1 += encoding1[i] * encoding1[i]
		norm2 += encoding2[i] * encoding2[i]
	}
	
	if norm1 == 0 || norm2 == 0 {
		return 0.0
	}
	
	return dotProduct / (math.Sqrt(norm1) * math.Sqrt(norm2))
}

func (s *FaceDetectionService) compareFaces(c *gin.Context) {
	// Similar to recognizeFaces but with additional comparison metrics
	s.recognizeFaces(c)
}

func (s *FaceDetectionService) getDetectionResult(c *gin.Context) {
	requestID := c.Param("id")
	
	if s.dbPool == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Database not available"})
		return
	}
	
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	
	var result struct {
		ID             string                 `json:"id"`
		RequestID      string                 `json:"request_id"`
		FacesDetected  int                    `json:"faces_detected"`
		Confidence     float64                `json:"confidence"`
		QualityScore   float64                `json:"quality_score"`
		ProcessingTime float64                `json:"processing_time_ms"`
		Metadata       map[string]interface{} `json:"metadata"`
		CreatedAt      time.Time              `json:"created_at"`
	}
	
	err := s.dbPool.QueryRow(ctx, `
		SELECT id, request_id, faces_detected, confidence, quality_score, processing_time_ms, metadata, created_at
		FROM face_detections
		WHERE request_id = $1
		ORDER BY created_at DESC
		LIMIT 1
	`, requestID).Scan(&result.ID, &result.RequestID, &result.FacesDetected, &result.Confidence, &result.QualityScore, &result.ProcessingTime, &result.Metadata, &result.CreatedAt)
	
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Detection result not found"})
		return
	}
	
	c.JSON(http.StatusOK, result)
}

func (s *FaceDetectionService) assessFaceQuality(c *gin.Context) {
	// Implementation for standalone face quality assessment
	var request struct {
		ImageData   string `json:"image_data"`
		ImageFormat string `json:"image_format"`
	}
	
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}
	
	// Process similar to face detection but focus on quality metrics
	c.JSON(http.StatusOK, gin.H{"message": "Quality assessment endpoint - implementation in progress"})
}

func (s *FaceDetectionService) detectLandmarks(c *gin.Context) {
	// Implementation for standalone landmark detection
	c.JSON(http.StatusOK, gin.H{"message": "Landmark detection endpoint - implementation in progress"})
}

func (s *FaceDetectionService) batchDetectFaces(c *gin.Context) {
	// Implementation for batch face detection
	c.JSON(http.StatusOK, gin.H{"message": "Batch detection endpoint - implementation in progress"})
}

func (s *FaceDetectionService) batchRecognizeFaces(c *gin.Context) {
	// Implementation for batch face recognition
	c.JSON(http.StatusOK, gin.H{"message": "Batch recognition endpoint - implementation in progress"})
}

func (s *FaceDetectionService) getServiceStats(c *gin.Context) {
	s.mu.RLock()
	stats := *s.metrics
	s.mu.RUnlock()
	
	stats.QueueDepth = int64(len(s.processingQueue))
	stats.ActiveWorkers = int64(s.workers)
	
	c.JSON(http.StatusOK, gin.H{
		"stats": stats,
		"timestamp": time.Now(),
		"uptime": time.Since(time.Now()).String(),
	})
}

func (s *FaceDetectionService) trainRecognizer(c *gin.Context) {
	// Implementation for training face recognizer with new data
	c.JSON(http.StatusOK, gin.H{"message": "Training endpoint - implementation in progress"})
}

func (s *FaceDetectionService) Start(port string) error {
	if port == "" {
		port = "8080"
	}
	
	log.Printf("Starting Face Detection Service on port %s", port)
	return s.router.Run("0.0.0.0:" + port)
}

func main() {
	service := NewFaceDetectionService()
	
	port := os.Getenv("PORT")
	if port == "" {
		port = "8083"
	}
	
	log.Fatal(service.Start(port))
}

