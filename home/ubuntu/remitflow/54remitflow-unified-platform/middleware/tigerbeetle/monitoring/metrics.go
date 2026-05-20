package monitoring

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// Transfer metrics
	TransfersTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "tigerbeetle_transfers_total",
			Help: "Total number of transfers",
		},
		[]string{"status"},
	)
	
	TransferLatency = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "tigerbeetle_transfer_latency_seconds",
			Help:    "Transfer latency in seconds",
			Buckets: prometheus.ExponentialBuckets(0.0001, 2, 15),
		},
		[]string{"operation"},
	)
	
	// Account metrics
	AccountsTotal = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "tigerbeetle_accounts_total",
			Help: "Total number of accounts",
		},
	)
	
	// Cluster metrics
	ClusterHealth = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "tigerbeetle_cluster_health",
			Help: "Cluster health status (1=healthy, 0=unhealthy)",
		},
	)
	
	NodeUp = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "tigerbeetle_node_up",
			Help: "Node availability (1=up, 0=down)",
		},
		[]string{"node_id"},
	)
	
	// Performance metrics
	ThroughputTPS = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "tigerbeetle_throughput_tps",
			Help: "Throughput in transactions per second",
		},
	)
	
	BalanceTotal = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "tigerbeetle_balance_total",
			Help: "Total balance by currency",
		},
		[]string{"currency"},
	)
	
	// Error metrics
	ErrorRate = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "tigerbeetle_errors_total",
			Help: "Total errors",
		},
		[]string{"error_type"},
	)
	
	// Resource metrics
	MemoryUsage = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "tigerbeetle_memory_usage_bytes",
			Help: "Memory usage in bytes",
		},
	)
	
	CPUUsage = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "tigerbeetle_cpu_usage_percent",
			Help: "CPU usage percentage",
		},
	)
)
