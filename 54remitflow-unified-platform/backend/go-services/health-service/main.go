package main

import (
    "fmt"
    "log"
    "net/http"
)

func main() {
    fmt.Println("health-service starting...")
    
    http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
        w.Write([]byte(`{"status": "healthy", "service": "health-service"}`))
    })
    
    log.Println("health-service listening on :8080")
    log.Fatal(http.ListenAndServe(":8080", nil))
}