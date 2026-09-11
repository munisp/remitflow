// Command healthprobe is the health endpoint for the shared-middleware image.
// It links the middleware library (middleware.LoadConfig) so a broken library
// build fails the image build — there is deliberately no stub fallback (F9).
package main

import (
	"encoding/json"
	"net/http"
	"os"
	"time"

	middleware "github.com/remitflow/shared-middleware"
)

func main() {
	cfg := middleware.LoadConfig(getEnv("SERVICE_NAME", "shared-middleware"))

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"status":  "ok",
			"service": cfg.ServiceName,
			"time":    time.Now().UTC().Format(time.RFC3339),
		})
	})

	addr := getEnv("HEALTH_ADDR", ":8100")
	if err := http.ListenAndServe(addr, mux); err != nil {
		os.Exit(1)
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
