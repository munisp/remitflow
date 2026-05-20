package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/mux"
	"github.com/rs/cors"
)

type User struct {
	ID       string    `json:"id"`
	Username string    `json:"username"`
	Email    string    `json:"email"`
	Role     string    `json:"role"`
	Status   string    `json:"status"`
	Created  time.Time `json:"created"`
}

type UserService struct {
	users map[string]User
}

func NewUserService() *UserService {
	return &UserService{
		users: make(map[string]User),
	}
}

func (us *UserService) CreateUser(w http.ResponseWriter, r *http.Request) {
	var user User
	if err := json.NewDecoder(r.Body).Decode(&user); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	user.ID = fmt.Sprintf("user_%d", time.Now().Unix())
	user.Created = time.Now()
	user.Status = "active"

	us.users[user.ID] = user

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

func (us *UserService) GetUser(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	userID := vars["id"]

	user, exists := us.users[userID]
	if !exists {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

func (us *UserService) ListUsers(w http.ResponseWriter, r *http.Request) {
	users := make([]User, 0, len(us.users))
	for _, user := range us.users {
		users = append(users, user)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(users)
}

func (us *UserService) UpdateUser(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	userID := vars["id"]

	existingUser, exists := us.users[userID]
	if !exists {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	var updateData User
	if err := json.NewDecoder(r.Body).Decode(&updateData); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Update fields
	if updateData.Username != "" {
		existingUser.Username = updateData.Username
	}
	if updateData.Email != "" {
		existingUser.Email = updateData.Email
	}
	if updateData.Role != "" {
		existingUser.Role = updateData.Role
	}
	if updateData.Status != "" {
		existingUser.Status = updateData.Status
	}

	us.users[userID] = existingUser

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(existingUser)
}

func (us *UserService) DeleteUser(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	userID := vars["id"]

	if _, exists := us.users[userID]; !exists {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	delete(us.users, userID)
	w.WriteHeader(http.StatusNoContent)
}

func (us *UserService) HealthCheck(w http.ResponseWriter, r *http.Request) {
	health := map[string]interface{}{
		"status":    "healthy",
		"service":   "user-management",
		"timestamp": time.Now(),
		"users":     len(us.users),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(health)
}

func main() {
	userService := NewUserService()

	r := mux.NewRouter()

	// API routes
	api := r.PathPrefix("/api/v1").Subrouter()
	api.HandleFunc("/users", userService.CreateUser).Methods("POST")
	api.HandleFunc("/users", userService.ListUsers).Methods("GET")
	api.HandleFunc("/users/{id}", userService.GetUser).Methods("GET")
	api.HandleFunc("/users/{id}", userService.UpdateUser).Methods("PUT")
	api.HandleFunc("/users/{id}", userService.DeleteUser).Methods("DELETE")

	// Health check
	r.HandleFunc("/health", userService.HealthCheck).Methods("GET")

	// CORS
	c := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"*"},
	})

	handler := c.Handler(r)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8082"
	}

	log.Printf("User Management Service starting on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, handler))
}
