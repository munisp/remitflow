package main

import (
    "fmt"
    "log"
    "net/http"
)

func main() {
    fmt.Println("config-service starting...")
    
    http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
        w.Write([]byte(`{"status": "healthy", "service": "config-service"}`))
    })
    
    log.Println("config-service listening on :8080")
    log.Fatal(http.ListenAndServe(":8080", nil))
}