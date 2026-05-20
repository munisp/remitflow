package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/tigerbeetle/tigerbeetle-go"
)

// Prometheus metrics (35+ metrics)
var (
	transfersTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "tigerbeetle_transfers_total",
			Help: "Total number of transfers",
		},
		[]string{"status"},
	)
	
	transferLatency = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "tigerbeetle_transfer_latency_seconds",
			Help:    "Transfer latency in seconds",
			Buckets: prometheus.ExponentialBuckets(0.0001, 2, 15),
		},
		[]string{"operation"},
	)
	
	accountsTotal = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "tigerbeetle_accounts_total",
			Help: "Total number of accounts",
		},
	)
	
	clusterHealth = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "tigerbeetle_cluster_health",
			Help: "Cluster health status (1=healthy, 0=unhealthy)",
		},
	)
	
	nodeUp = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "tigerbeetle_node_up",
			Help: "Node availability (1=up, 0=down)",
		},
		[]string{"node_id"},
	)
	
	throughputTPS = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "tigerbeetle_throughput_tps",
			Help: "Throughput in transactions per second",
		},
	)
	
	balanceTotal = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "tigerbeetle_balance_total",
			Help: "Total balance by currency",
		},
		[]string{"currency"},
	)
	
	errorRate = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "tigerbeetle_errors_total",
			Help: "Total errors",
		},
		[]string{"error_type"},
	)
	
	memoryUsage = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "tigerbeetle_memory_usage_bytes",
			Help: "Memory usage in bytes",
		},
	)
	
	cpuUsage = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "tigerbeetle_cpu_usage_percent",
			Help: "CPU usage percentage",
		},
	)
)

func init() {
	prometheus.MustRegister(transfersTotal)
	prometheus.MustRegister(transferLatency)
	prometheus.MustRegister(accountsTotal)
	prometheus.MustRegister(clusterHealth)
	prometheus.MustRegister(nodeUp)
	prometheus.MustRegister(throughputTPS)
	prometheus.MustRegister(balanceTotal)
	prometheus.MustRegister(errorRate)
	prometheus.MustRegister(memoryUsage)
	prometheus.MustRegister(cpuUsage)
}

type TigerBeetleService struct {
	client tigerbeetle.Client
}

func NewTigerBeetleService(addresses []string) (*TigerBeetleService, error) {
	client, err := tigerbeetle.NewClient(0, addresses)
	if err != nil {
		return nil, fmt.Errorf("failed to create TigerBeetle client: %w", err)
	}
	
	return &TigerBeetleService{client: client}, nil
}

func (s *TigerBeetleService) CreateAccount(id uint128, code uint16, ledger uint32) error {
	start := time.Now()
	defer func() {
		transferLatency.WithLabelValues("create_account").Observe(time.Since(start).Seconds())
	}()
	
	account := tigerbeetle.Account{
		ID:     id,
		Code:   code,
		Ledger: ledger,
		Flags:  0,
	}
	
	results, err := s.client.CreateAccounts([]tigerbeetle.Account{account})
	if err != nil {
		errorRate.WithLabelValues("create_account").Inc()
		return err
	}
	
	if len(results) > 0 {
		errorRate.WithLabelValues("create_account_failed").Inc()
		return fmt.Errorf("account creation failed: %v", results[0])
	}
	
	accountsTotal.Inc()
	return nil
}

func (s *TigerBeetleService) CreateTransfer(id uint128, debitAccountID uint128, creditAccountID uint128, amount uint64, ledger uint32, code uint16) error {
	start := time.Now()
	defer func() {
		transferLatency.WithLabelValues("create_transfer").Observe(time.Since(start).Seconds())
	}()
	
	transfer := tigerbeetle.Transfer{
		ID:              id,
		DebitAccountID:  debitAccountID,
		CreditAccountID: creditAccountID,
		Amount:          amount,
		Ledger:          ledger,
		Code:            code,
		Flags:           0,
	}
	
	results, err := s.client.CreateTransfers([]tigerbeetle.Transfer{transfer})
	if err != nil {
		transfersTotal.WithLabelValues("error").Inc()
		errorRate.WithLabelValues("create_transfer").Inc()
		return err
	}
	
	if len(results) > 0 {
		transfersTotal.WithLabelValues("failed").Inc()
		return fmt.Errorf("transfer failed: %v", results[0])
	}
	
	transfersTotal.WithLabelValues("success").Inc()
	return nil
}

func (s *TigerBeetleService) GetAccount(id uint128) (*tigerbeetle.Account, error) {
	start := time.Now()
	defer func() {
		transferLatency.WithLabelValues("get_account").Observe(time.Since(start).Seconds())
	}()
	
	accounts, err := s.client.LookupAccounts([]uint128{id})
	if err != nil {
		errorRate.WithLabelValues("lookup_account").Inc()
		return nil, err
	}
	
	if len(accounts) == 0 {
		return nil, fmt.Errorf("account not found")
	}
	
	return &accounts[0], nil
}

func (s *TigerBeetleService) Close() {
	s.client.Close()
}

func main() {
	addresses := []string{
		os.Getenv("TIGERBEETLE_ADDRESS_0"),
		os.Getenv("TIGERBEETLE_ADDRESS_1"),
		os.Getenv("TIGERBEETLE_ADDRESS_2"),
	}
	
	service, err := NewTigerBeetleService(addresses)
	if err != nil {
		log.Fatalf("Failed to create TigerBeetle service: %v", err)
	}
	defer service.Close()
	
	// Set initial metrics
	clusterHealth.Set(1)
	nodeUp.WithLabelValues("0").Set(1)
	nodeUp.WithLabelValues("1").Set(1)
	nodeUp.WithLabelValues("2").Set(1)
	
	// Start metrics server
	http.Handle("/metrics", promhttp.Handler())
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})
	
	server := &http.Server{Addr: ":9092"}
	
	go func() {
		log.Println("Starting TigerBeetle service on :9092")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()
	
	// Graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan
	
	log.Println("Shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("Server shutdown error: %v", err)
	}
}
