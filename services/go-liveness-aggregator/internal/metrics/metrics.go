// Package metrics exposes Prometheus counters and gauges for the aggregator.
package metrics

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	// EventsReceived counts total Kafka messages fetched.
	EventsReceived = promauto.NewCounter(prometheus.CounterOpts{
		Name: "liveness_aggregator_events_received_total",
		Help: "Total number of liveness result events received from Kafka.",
	})

	// EventsProcessed counts successfully processed events.
	EventsProcessed = promauto.NewCounter(prometheus.CounterOpts{
		Name: "liveness_aggregator_events_processed_total",
		Help: "Total number of liveness result events successfully processed.",
	})

	// EventsFailed counts events that failed after all retries.
	EventsFailed = promauto.NewCounter(prometheus.CounterOpts{
		Name: "liveness_aggregator_events_failed_total",
		Help: "Total number of liveness result events that failed processing.",
	})

	// LivenessPassRate is a gauge tracking the rolling pass rate (0–1).
	LivenessPassRate = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "liveness_aggregator_pass_rate",
		Help: "Rolling liveness pass rate across all corridors (0–1).",
	})

	// DeepfakeDetectionRate is a gauge tracking the rolling deepfake detection rate.
	DeepfakeDetectionRate = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "liveness_aggregator_deepfake_rate",
		Help: "Rolling deepfake detection rate across all corridors (0–1).",
	})
)

// Handler returns an HTTP handler that serves Prometheus metrics.
func Handler() http.Handler {
	return promhttp.Handler()
}
