package main

import (
	"context"
	"fmt"

	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"workflow-orchestrator/internal/api"
	"workflow-orchestrator/internal/engine"
	"workflow-orchestrator/internal/middleware"
	"workflow-orchestrator/internal/repository"
	"workflow-orchestrator/pkg/config"
	"workflow-orchestrator/pkg/logger"
	_ "workflow-orchestrator/pkg/metrics"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
	// Initialize logger
	logger.Init()
	defer logger.Logger.Sync()

	log := logger.Logger

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		log.Fatal("Failed to load configuration", logger.Error(err))
	}

	// Initialize PostgreSQL repository
	repo, err := repository.NewPostgresRepository(cfg.Database)
	if err != nil {
		log.Fatal("Failed to initialize repository", logger.Error(err))
	}
	defer repo.Close()

	// Initialize Redis client
	redisClient, err := middleware.NewRedisClient(cfg.Redis)
	if err != nil {
		log.Fatal("Failed to initialize Redis", logger.Error(err))
	}
	defer redisClient.Close()

	// Initialize Fluvio client
	fluvioClient, err := middleware.NewFluvioClient(cfg.Fluvio)
	if err != nil {
		log.Warn("Failed to initialize Fluvio (continuing without it)", logger.Error(err))
		fluvioClient = nil
	}

	// Initialize Kafka client
	kafkaClient, err := middleware.NewKafkaClient(cfg.Kafka)
	if err != nil {
		log.Warn("Failed to initialize Kafka (continuing without it)", logger.Error(err))
		kafkaClient = nil
	}

	// Initialize workflow engine components
	stateManager := engine.NewStateManager(repo, redisClient)
	stepExecutor := engine.NewStepExecutor(cfg.Executor.MaxRetries)
	executor := engine.NewExecutor(
		repo,
		stateManager,
		stepExecutor,
		fluvioClient,
		kafkaClient,
		redisClient,
		cfg.Executor.MaxConcurrent,
	)

	// Initialize workflow registry
	registry := engine.NewRegistry()
	registry.RegisterWorkflows()

	// Start worker pool
	workerPool := engine.NewWorkerPool(cfg.Executor.Workers, executor)
	workerPool.Start(context.Background())
	defer workerPool.Stop()

	// Initialize API handlers
	handlers := api.NewHandlers(executor, registry, repo)

	// Setup HTTP router
	router := api.NewRouter(handlers)

	// Metrics endpoint
	http.Handle("/metrics", promhttp.Handler())

	// API endpoints
	http.Handle("/", router)

	// Create HTTP server
	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Server.Port),
		Handler:      http.DefaultServeMux,
		ReadTimeout:  time.Duration(cfg.Server.ReadTimeout) * time.Second,
		WriteTimeout: time.Duration(cfg.Server.WriteTimeout) * time.Second,
	}

	// Start server in goroutine
	go func() {
		log.Info("Starting workflow orchestrator",
			logger.Int("port", cfg.Server.Port),
			logger.Int("workers", cfg.Executor.Workers),
			logger.Int("max_concurrent", cfg.Executor.MaxConcurrent),
		)

		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal("Server failed", logger.Error(err))
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info("Shutting down server...")

	// Graceful shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Error("Server forced to shutdown", logger.Error(err))
	}

	log.Info("Server exited")
}

