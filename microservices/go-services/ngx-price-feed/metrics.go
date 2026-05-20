package main

import (
	"net/http"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ─── Prometheus Metrics ───────────────────────────────────────────────────────

var (
	httpRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "ngx_http_requests_total",
		Help: "Total HTTP requests handled by NGX Price Feed",
	}, []string{"method", "path", "status"})

	httpRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "ngx_http_request_duration_seconds",
		Help:    "HTTP request duration in seconds",
		Buckets: prometheus.DefBuckets,
	}, []string{"method", "path"})

	pricesFetchTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "ngx_prices_fetch_total",
		Help: "Total NGX price fetch attempts",
	}, []string{"status"})

	pricesFetchDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "ngx_prices_fetch_duration_seconds",
		Help:    "Duration of NGX price fetch operations",
		Buckets: []float64{0.1, 0.5, 1, 2, 5, 10, 30},
	})

	activePriceSymbols = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "ngx_active_price_symbols",
		Help: "Number of active NGX stock symbols being tracked",
	})

	lastFetchTimestamp = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "ngx_last_fetch_timestamp_seconds",
		Help: "Unix timestamp of last successful price fetch",
	})
)

// MetricsMiddleware wraps an http.Handler to record Prometheus metrics
func MetricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		rw := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(rw, r)
		duration := time.Since(start).Seconds()
		status := strconv.Itoa(rw.statusCode)
		httpRequestsTotal.WithLabelValues(r.Method, r.URL.Path, status).Inc()
		httpRequestDuration.WithLabelValues(r.Method, r.URL.Path).Observe(duration)
	})
}

// MetricsHandler returns the Prometheus metrics HTTP handler
func MetricsHandler() http.Handler {
	return promhttp.Handler()
}

// responseWriter wraps http.ResponseWriter to capture status code
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}
