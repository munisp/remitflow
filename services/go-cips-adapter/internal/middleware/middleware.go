// Package middleware — HTTP middleware for CIPS adapter
package middleware

import (
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

// ─── Logger ────────────────────────────────────────────────────────────────────
func Logger() gin.HandlerFunc {
	return gin.LoggerWithFormatter(func(param gin.LogFormatterParams) string {
		return "[CIPS] " + param.TimeStamp.Format(time.RFC3339) +
			" | " + param.Method +
			" " + param.Path +
			" | " + param.ClientIP +
			" | " + param.Latency.String() +
			" | " + http.StatusText(param.StatusCode) + "\n"
	})
}

// ─── CORS ──────────────────────────────────────────────────────────────────────
func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", os.Getenv("ALLOWED_ORIGIN"))
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key, X-Request-ID")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// ─── Request ID ────────────────────────────────────────────────────────────────
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		reqID := c.GetHeader("X-Request-ID")
		if reqID == "" {
			reqID = "cips-" + time.Now().Format("20060102150405")
		}
		c.Set("request_id", reqID)
		c.Header("X-Request-ID", reqID)
		c.Next()
	}
}

// ─── API Key Auth ──────────────────────────────────────────────────────────────
func APIKeyAuth() gin.HandlerFunc {
	apiKey := os.Getenv("CIPS_INTERNAL_API_KEY")
	if apiKey == "" {
		apiKey = "cips-internal-dev-key-001"
	}
	return func(c *gin.Context) {
		key := c.GetHeader("X-API-Key")
		if key == "" {
			key = c.Query("api_key")
		}
		if key != apiKey {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid or missing API key",
				"code":  "UNAUTHORIZED",
			})
			return
		}
		c.Next()
	}
}

// ─── Rate Limiter (per-IP, 100 req/min) ───────────────────────────────────────
type ipLimiter struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

var (
	limiters = make(map[string]*ipLimiter)
	limMu    sync.Mutex
)

func getLimiter(ip string) *rate.Limiter {
	limMu.Lock()
	defer limMu.Unlock()
	if l, ok := limiters[ip]; ok {
		l.lastSeen = time.Now()
		return l.limiter
	}
	l := &ipLimiter{
		limiter:  rate.NewLimiter(rate.Every(time.Minute/100), 20),
		lastSeen: time.Now(),
	}
	limiters[ip] = l
	// Cleanup old entries
	go func() {
		time.Sleep(5 * time.Minute)
		limMu.Lock()
		for k, v := range limiters {
			if time.Since(v.lastSeen) > 5*time.Minute {
				delete(limiters, k)
			}
		}
		limMu.Unlock()
	}()
	return l.limiter
}

func RateLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		limiter := getLimiter(c.ClientIP())
		if !limiter.Allow() {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "Rate limit exceeded. Max 100 requests/minute.",
				"code":  "RATE_LIMITED",
			})
			return
		}
		c.Next()
	}
}
