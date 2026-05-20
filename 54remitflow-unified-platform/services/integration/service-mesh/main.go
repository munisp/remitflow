package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// ServiceMesh manages service-to-service communication
type ServiceMesh struct {
	DB          *gorm.DB
	RedisClient *redis.Client
	Router      *gin.Engine
	Services    map[string]*ServiceNode
	mutex       sync.RWMutex
}

// ServiceNode represents a service in the mesh
type ServiceNode struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Address     string    `json:"address"`
	Port        int       `json:"port"`
	Status      string    `json:"status"`
	Version     string    `json:"version"`
	Metadata    map[string]string `json:"metadata"`
	LastSeen    time.Time `json:"last_seen"`
	Connections []string  `json:"connections"`
}

// ServiceRegistry stores service registration data
type ServiceRegistry struct {
	ID          uint   `gorm:"primaryKey"`
	ServiceID   string `gorm:"unique;not null"`
	ServiceName string `gorm:"not null"`
	Address     string `gorm:"not null"`
	Port        int    `gorm:"not null"`
	Status      string `gorm:"not null"`
	Version     string
	Metadata    string // JSON
	LastSeen    time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// ServiceConnection tracks service-to-service connections
type ServiceConnection struct {
	ID            uint   `gorm:"primaryKey"`
	SourceService string `gorm:"not null"`
	TargetService string `gorm:"not null"`
	ConnectionType string `gorm:"not null"` // http, grpc, websocket
	Status        string `gorm:"not null"`
	Latency       int64  // milliseconds
	RequestCount  int64
	ErrorCount    int64
	LastUsed      time.Time
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// CircuitBreaker manages circuit breaker state for services
type CircuitBreaker struct {
	ID              uint   `gorm:"primaryKey"`
	ServiceName     string `gorm:"unique;not null"`
	State           string `gorm:"not null"` // closed, open, half-open
	FailureCount    int
	SuccessCount    int
	LastFailure     time.Time
	LastSuccess     time.Time
	NextRetryTime   time.Time
	FailureThreshold int `gorm:"default:5"`
	TimeoutDuration  int `gorm:"default:30"` // seconds
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// LoadBalancer manages load balancing for services
type LoadBalancer struct {
	ID          uint   `gorm:"primaryKey"`
	ServiceName string `gorm:"unique;not null"`
	Algorithm   string `gorm:"not null"` // round_robin, least_connections, weighted
	Instances   string // JSON array of instances
	CurrentIndex int
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func main() {
	mesh := &ServiceMesh{
		Services: make(map[string]*ServiceNode),
	}

	// Initialize database
	if err := mesh.initDatabase(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}

	// Initialize Redis
	if err := mesh.initRedis(); err != nil {
		log.Fatal("Failed to initialize Redis:", err)
	}

	// Initialize router
	mesh.initRouter()

	// Start service discovery
	go mesh.startServiceDiscovery()

	// Start health monitoring
	go mesh.startHealthMonitoring()

	// Start circuit breaker monitoring
	go mesh.startCircuitBreakerMonitoring()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8201"
	}

	log.Printf("🕸️ Service Mesh starting on port %s", port)
	
	if err := mesh.Router.Run(":" + port); err != nil {
		log.Fatal("Failed to start Service Mesh:", err)
	}
}

func (sm *ServiceMesh) initDatabase() error {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "host=localhost user=postgres password=postgres dbname=remittance port=5432 sslmode=disable"
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		return err
	}

	sm.DB = db

	// Auto-migrate schemas
	return db.AutoMigrate(&ServiceRegistry{}, &ServiceConnection{}, &CircuitBreaker{}, &LoadBalancer{})
}

func (sm *ServiceMesh) initRedis() error {
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "localhost:6379"
	}

	sm.RedisClient = redis.NewClient(&redis.Options{
		Addr: redisURL,
		DB:   1, // Use different DB from API Gateway
	})

	// Test connection
	ctx := context.Background()
	_, err := sm.RedisClient.Ping(ctx).Result()
	return err
}

func (sm *ServiceMesh) initRouter() {
	gin.SetMode(gin.ReleaseMode)
	sm.Router = gin.New()

	// Middleware
	sm.Router.Use(gin.Logger())
	sm.Router.Use(gin.Recovery())
	sm.Router.Use(sm.corsMiddleware())

	// Health check
	sm.Router.GET("/health", sm.healthCheck)

	// Service registration endpoints
	sm.Router.POST("/api/services/register", sm.registerService)
	sm.Router.DELETE("/api/services/:id", sm.deregisterService)
	sm.Router.GET("/api/services", sm.listServices)
	sm.Router.GET("/api/services/:name", sm.getService)

	// Service discovery endpoints
	sm.Router.GET("/api/discover/:name", sm.discoverService)
	sm.Router.GET("/api/mesh/topology", sm.getMeshTopology)

	// Connection management
	sm.Router.GET("/api/connections", sm.listConnections)
	sm.Router.POST("/api/connections", sm.createConnection)
	sm.Router.GET("/api/connections/:source/:target", sm.getConnection)

	// Circuit breaker endpoints
	sm.Router.GET("/api/circuit-breakers", sm.listCircuitBreakers)
	sm.Router.POST("/api/circuit-breakers/:service/reset", sm.resetCircuitBreaker)
	sm.Router.GET("/api/circuit-breakers/:service", sm.getCircuitBreaker)

	// Load balancer endpoints
	sm.Router.GET("/api/load-balancers", sm.listLoadBalancers)
	sm.Router.POST("/api/load-balancers", sm.createLoadBalancer)
	sm.Router.GET("/api/load-balancers/:service", sm.getLoadBalancer)
	sm.Router.GET("/api/load-balancers/:service/next", sm.getNextInstance)

	// Metrics endpoints
	sm.Router.GET("/api/metrics/mesh", sm.getMeshMetrics)
	sm.Router.GET("/api/metrics/connections", sm.getConnectionMetrics)
}

func (sm *ServiceMesh) corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

func (sm *ServiceMesh) healthCheck(c *gin.Context) {
	sm.mutex.RLock()
	serviceCount := len(sm.Services)
	sm.mutex.RUnlock()

	c.JSON(http.StatusOK, gin.H{
		"status": "healthy",
		"service": "service-mesh",
		"version": "v1.0.0",
		"timestamp": time.Now().ISO8601(),
		"registered_services": serviceCount,
	})
}

func (sm *ServiceMesh) registerService(c *gin.Context) {
	var node ServiceNode
	if err := c.ShouldBindJSON(&node); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Generate ID if not provided
	if node.ID == "" {
		node.ID = fmt.Sprintf("%s-%d", node.Name, time.Now().Unix())
	}

	node.LastSeen = time.Now()
	node.Status = "healthy"

	// Store in memory
	sm.mutex.Lock()
	sm.Services[node.ID] = &node
	sm.mutex.Unlock()

	// Store in database
	metadataJSON, _ := json.Marshal(node.Metadata)
	registry := ServiceRegistry{
		ServiceID:   node.ID,
		ServiceName: node.Name,
		Address:     node.Address,
		Port:        node.Port,
		Status:      node.Status,
		Version:     node.Version,
		Metadata:    string(metadataJSON),
		LastSeen:    node.LastSeen,
	}

	sm.DB.Create(&registry)

	// Initialize circuit breaker
	sm.DB.FirstOrCreate(&CircuitBreaker{
		ServiceName: node.Name,
		State:       "closed",
	}, CircuitBreaker{ServiceName: node.Name})

	log.Printf("📝 Service registered: %s (%s:%d)", node.Name, node.Address, node.Port)

	c.JSON(http.StatusCreated, node)
}

func (sm *ServiceMesh) deregisterService(c *gin.Context) {
	serviceID := c.Param("id")

	sm.mutex.Lock()
	delete(sm.Services, serviceID)
	sm.mutex.Unlock()

	sm.DB.Delete(&ServiceRegistry{}, "service_id = ?", serviceID)

	c.JSON(http.StatusOK, gin.H{"message": "Service deregistered"})
}

func (sm *ServiceMesh) listServices(c *gin.Context) {
	sm.mutex.RLock()
	services := make([]*ServiceNode, 0, len(sm.Services))
	for _, service := range sm.Services {
		services = append(services, service)
	}
	sm.mutex.RUnlock()

	c.JSON(http.StatusOK, gin.H{
		"services": services,
		"count": len(services),
	})
}

func (sm *ServiceMesh) getService(c *gin.Context) {
	serviceName := c.Param("name")

	sm.mutex.RLock()
	var foundService *ServiceNode
	for _, service := range sm.Services {
		if service.Name == serviceName {
			foundService = service
			break
		}
	}
	sm.mutex.RUnlock()

	if foundService != nil {
		c.JSON(http.StatusOK, foundService)
	} else {
		c.JSON(http.StatusNotFound, gin.H{"error": "Service not found"})
	}
}

func (sm *ServiceMesh) discoverService(c *gin.Context) {
	serviceName := c.Param("name")

	sm.mutex.RLock()
	var instances []*ServiceNode
	for _, service := range sm.Services {
		if service.Name == serviceName && service.Status == "healthy" {
			instances = append(instances, service)
		}
	}
	sm.mutex.RUnlock()

	if len(instances) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "No healthy instances found"})
		return
	}

	// Return load-balanced instance
	instance := sm.selectInstance(serviceName, instances)

	c.JSON(http.StatusOK, gin.H{
		"service": serviceName,
		"instance": instance,
		"total_instances": len(instances),
	})
}

func (sm *ServiceMesh) selectInstance(serviceName string, instances []*ServiceNode) *ServiceNode {
	if len(instances) == 1 {
		return instances[0]
	}

	// Get load balancer configuration
	var lb LoadBalancer
	if err := sm.DB.First(&lb, "service_name = ?", serviceName).Error; err != nil {
		// Default to round robin
		return instances[0]
	}

	switch lb.Algorithm {
	case "round_robin":
		return sm.roundRobinSelect(serviceName, instances)
	case "least_connections":
		return sm.leastConnectionsSelect(instances)
	case "weighted":
		return sm.weightedSelect(instances)
	default:
		return instances[0]
	}
}

func (sm *ServiceMesh) roundRobinSelect(serviceName string, instances []*ServiceNode) *ServiceNode {
	var lb LoadBalancer
	sm.DB.First(&lb, "service_name = ?", serviceName)

	index := lb.CurrentIndex % len(instances)
	lb.CurrentIndex = (lb.CurrentIndex + 1) % len(instances)
	sm.DB.Save(&lb)

	return instances[index]
}

func (sm *ServiceMesh) leastConnectionsSelect(instances []*ServiceNode) *ServiceNode {
	// Simplified: return first instance
	// In real implementation, track active connections
	return instances[0]
}

func (sm *ServiceMesh) weightedSelect(instances []*ServiceNode) *ServiceNode {
	// Simplified: return first instance
	// In real implementation, use weights from metadata
	return instances[0]
}

func (sm *ServiceMesh) getMeshTopology(c *gin.Context) {
	sm.mutex.RLock()
	services := make(map[string]*ServiceNode)
	for id, service := range sm.Services {
		services[id] = service
	}
	sm.mutex.RUnlock()

	var connections []ServiceConnection
	sm.DB.Find(&connections)

	topology := gin.H{
		"services": services,
		"connections": connections,
		"timestamp": time.Now().ISO8601(),
	}

	c.JSON(http.StatusOK, topology)
}

func (sm *ServiceMesh) listConnections(c *gin.Context) {
	var connections []ServiceConnection
	sm.DB.Find(&connections)

	c.JSON(http.StatusOK, gin.H{
		"connections": connections,
		"count": len(connections),
	})
}

func (sm *ServiceMesh) createConnection(c *gin.Context) {
	var connection ServiceConnection
	if err := c.ShouldBindJSON(&connection); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	connection.Status = "active"
	connection.LastUsed = time.Now()

	if err := sm.DB.Create(&connection).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, connection)
}

func (sm *ServiceMesh) getConnection(c *gin.Context) {
	source := c.Param("source")
	target := c.Param("target")

	var connection ServiceConnection
	if err := sm.DB.First(&connection, "source_service = ? AND target_service = ?", source, target).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Connection not found"})
		return
	}

	c.JSON(http.StatusOK, connection)
}

func (sm *ServiceMesh) listCircuitBreakers(c *gin.Context) {
	var breakers []CircuitBreaker
	sm.DB.Find(&breakers)

	c.JSON(http.StatusOK, gin.H{
		"circuit_breakers": breakers,
		"count": len(breakers),
	})
}

func (sm *ServiceMesh) resetCircuitBreaker(c *gin.Context) {
	serviceName := c.Param("service")

	var breaker CircuitBreaker
	if err := sm.DB.First(&breaker, "service_name = ?", serviceName).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Circuit breaker not found"})
		return
	}

	breaker.State = "closed"
	breaker.FailureCount = 0
	breaker.SuccessCount = 0
	breaker.LastFailure = time.Time{}
	breaker.NextRetryTime = time.Time{}

	sm.DB.Save(&breaker)

	c.JSON(http.StatusOK, gin.H{"message": "Circuit breaker reset"})
}

func (sm *ServiceMesh) getCircuitBreaker(c *gin.Context) {
	serviceName := c.Param("service")

	var breaker CircuitBreaker
	if err := sm.DB.First(&breaker, "service_name = ?", serviceName).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Circuit breaker not found"})
		return
	}

	c.JSON(http.StatusOK, breaker)
}

func (sm *ServiceMesh) listLoadBalancers(c *gin.Context) {
	var balancers []LoadBalancer
	sm.DB.Find(&balancers)

	c.JSON(http.StatusOK, gin.H{
		"load_balancers": balancers,
		"count": len(balancers),
	})
}

func (sm *ServiceMesh) createLoadBalancer(c *gin.Context) {
	var balancer LoadBalancer
	if err := c.ShouldBindJSON(&balancer); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := sm.DB.Create(&balancer).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, balancer)
}

func (sm *ServiceMesh) getLoadBalancer(c *gin.Context) {
	serviceName := c.Param("service")

	var balancer LoadBalancer
	if err := sm.DB.First(&balancer, "service_name = ?", serviceName).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Load balancer not found"})
		return
	}

	c.JSON(http.StatusOK, balancer)
}

func (sm *ServiceMesh) getNextInstance(c *gin.Context) {
	serviceName := c.Param("service")

	sm.mutex.RLock()
	var instances []*ServiceNode
	for _, service := range sm.Services {
		if service.Name == serviceName && service.Status == "healthy" {
			instances = append(instances, service)
		}
	}
	sm.mutex.RUnlock()

	if len(instances) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "No healthy instances found"})
		return
	}

	instance := sm.selectInstance(serviceName, instances)

	c.JSON(http.StatusOK, gin.H{
		"instance": instance,
		"algorithm": "round_robin",
	})
}

func (sm *ServiceMesh) getMeshMetrics(c *gin.Context) {
	sm.mutex.RLock()
	totalServices := len(sm.Services)
	healthyServices := 0
	for _, service := range sm.Services {
		if service.Status == "healthy" {
			healthyServices++
		}
	}
	sm.mutex.RUnlock()

	var totalConnections int64
	sm.DB.Model(&ServiceConnection{}).Count(&totalConnections)

	var activeBreakers int64
	sm.DB.Model(&CircuitBreaker{}).Where("state != ?", "closed").Count(&activeBreakers)

	metrics := gin.H{
		"total_services": totalServices,
		"healthy_services": healthyServices,
		"unhealthy_services": totalServices - healthyServices,
		"total_connections": totalConnections,
		"active_circuit_breakers": activeBreakers,
		"mesh_health": float64(healthyServices) / float64(totalServices) * 100,
		"timestamp": time.Now().ISO8601(),
	}

	c.JSON(http.StatusOK, metrics)
}

func (sm *ServiceMesh) getConnectionMetrics(c *gin.Context) {
	var connections []ServiceConnection
	sm.DB.Find(&connections)

	connectionMetrics := make(map[string]interface{})
	for _, conn := range connections {
		key := fmt.Sprintf("%s->%s", conn.SourceService, conn.TargetService)
		connectionMetrics[key] = map[string]interface{}{
			"status": conn.Status,
			"latency": conn.Latency,
			"request_count": conn.RequestCount,
			"error_count": conn.ErrorCount,
			"error_rate": float64(conn.ErrorCount) / float64(conn.RequestCount) * 100,
			"last_used": conn.LastUsed,
		}
	}

	c.JSON(http.StatusOK, connectionMetrics)
}

func (sm *ServiceMesh) startServiceDiscovery() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			sm.updateServiceRegistry()
		}
	}
}

func (sm *ServiceMesh) updateServiceRegistry() {
	// Load services from database
	var registries []ServiceRegistry
	sm.DB.Find(&registries)

	sm.mutex.Lock()
	for _, registry := range registries {
		if service, exists := sm.Services[registry.ServiceID]; exists {
			service.LastSeen = registry.LastSeen
			service.Status = registry.Status
		} else {
			// Create new service node
			var metadata map[string]string
			json.Unmarshal([]byte(registry.Metadata), &metadata)

			sm.Services[registry.ServiceID] = &ServiceNode{
				ID:       registry.ServiceID,
				Name:     registry.ServiceName,
				Address:  registry.Address,
				Port:     registry.Port,
				Status:   registry.Status,
				Version:  registry.Version,
				Metadata: metadata,
				LastSeen: registry.LastSeen,
			}
		}
	}
	sm.mutex.Unlock()

	log.Printf("🔄 Service registry updated: %d services", len(registries))
}

func (sm *ServiceMesh) startHealthMonitoring() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			sm.checkServiceHealth()
		}
	}
}

func (sm *ServiceMesh) checkServiceHealth() {
	sm.mutex.RLock()
	services := make([]*ServiceNode, 0, len(sm.Services))
	for _, service := range sm.Services {
		services = append(services, service)
	}
	sm.mutex.RUnlock()

	for _, service := range services {
		go func(svc *ServiceNode) {
			healthURL := fmt.Sprintf("http://%s:%d/health", svc.Address, svc.Port)
			
			client := &http.Client{Timeout: 5 * time.Second}
			resp, err := client.Get(healthURL)
			
			sm.mutex.Lock()
			if err != nil || resp.StatusCode != http.StatusOK {
				svc.Status = "unhealthy"
			} else {
				svc.Status = "healthy"
			}
			svc.LastSeen = time.Now()
			sm.mutex.Unlock()

			// Update database
			sm.DB.Model(&ServiceRegistry{}).
				Where("service_id = ?", svc.ID).
				Updates(map[string]interface{}{
					"status": svc.Status,
					"last_seen": svc.LastSeen,
				})

			if resp != nil {
				resp.Body.Close()
			}
		}(service)
	}
}

func (sm *ServiceMesh) startCircuitBreakerMonitoring() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			sm.updateCircuitBreakers()
		}
	}
}

func (sm *ServiceMesh) updateCircuitBreakers() {
	var breakers []CircuitBreaker
	sm.DB.Find(&breakers)

	for _, breaker := range breakers {
		// Check if circuit breaker should change state
		if breaker.State == "open" && time.Now().After(breaker.NextRetryTime) {
			breaker.State = "half-open"
			sm.DB.Save(&breaker)
		}

		// Check failure threshold
		if breaker.State == "closed" && breaker.FailureCount >= breaker.FailureThreshold {
			breaker.State = "open"
			breaker.NextRetryTime = time.Now().Add(time.Duration(breaker.TimeoutDuration) * time.Second)
			sm.DB.Save(&breaker)
		}
	}
}

