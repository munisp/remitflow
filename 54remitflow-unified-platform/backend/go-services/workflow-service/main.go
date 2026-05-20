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

type WorkflowStep struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	Status      string                 `json:"status"`
	Input       map[string]interface{} `json:"input"`
	Output      map[string]interface{} `json:"output"`
	ExecutedAt  *time.Time             `json:"executed_at"`
	CompletedAt *time.Time             `json:"completed_at"`
}

type Workflow struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Status      string         `json:"status"`
	Steps       []WorkflowStep `json:"steps"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	CompletedAt *time.Time     `json:"completed_at"`
}

type WorkflowService struct {
	workflows map[string]Workflow
}

func NewWorkflowService() *WorkflowService {
	return &WorkflowService{
		workflows: make(map[string]Workflow),
	}
}

func (ws *WorkflowService) CreateWorkflow(w http.ResponseWriter, r *http.Request) {
	var workflow Workflow
	if err := json.NewDecoder(r.Body).Decode(&workflow); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	workflow.ID = fmt.Sprintf("workflow_%d", time.Now().Unix())
	workflow.Status = "created"
	workflow.CreatedAt = time.Now()
	workflow.UpdatedAt = time.Now()

	// Initialize steps if not provided
	if workflow.Steps == nil {
		workflow.Steps = []WorkflowStep{}
	}

	ws.workflows[workflow.ID] = workflow

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(workflow)
}

func (ws *WorkflowService) GetWorkflow(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	workflowID := vars["id"]

	workflow, exists := ws.workflows[workflowID]
	if !exists {
		http.Error(w, "Workflow not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(workflow)
}

func (ws *WorkflowService) ListWorkflows(w http.ResponseWriter, r *http.Request) {
	workflows := make([]Workflow, 0, len(ws.workflows))
	for _, workflow := range ws.workflows {
		workflows = append(workflows, workflow)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(workflows)
}

func (ws *WorkflowService) ExecuteWorkflow(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	workflowID := vars["id"]

	workflow, exists := ws.workflows[workflowID]
	if !exists {
		http.Error(w, "Workflow not found", http.StatusNotFound)
		return
	}

	// Update workflow status
	workflow.Status = "running"
	workflow.UpdatedAt = time.Now()

	// Execute steps (simplified simulation)
	for i := range workflow.Steps {
		now := time.Now()
		workflow.Steps[i].Status = "completed"
		workflow.Steps[i].ExecutedAt = &now
		workflow.Steps[i].CompletedAt = &now
		workflow.Steps[i].Output = map[string]interface{}{
			"result": "success",
			"message": fmt.Sprintf("Step %s completed successfully", workflow.Steps[i].Name),
		}
	}

	// Mark workflow as completed
	now := time.Now()
	workflow.Status = "completed"
	workflow.CompletedAt = &now
	workflow.UpdatedAt = now

	ws.workflows[workflowID] = workflow

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(workflow)
}

func (ws *WorkflowService) UpdateWorkflow(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	workflowID := vars["id"]

	existingWorkflow, exists := ws.workflows[workflowID]
	if !exists {
		http.Error(w, "Workflow not found", http.StatusNotFound)
		return
	}

	var updateData Workflow
	if err := json.NewDecoder(r.Body).Decode(&updateData); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Update fields
	if updateData.Name != "" {
		existingWorkflow.Name = updateData.Name
	}
	if updateData.Description != "" {
		existingWorkflow.Description = updateData.Description
	}
	if updateData.Status != "" {
		existingWorkflow.Status = updateData.Status
	}
	if updateData.Steps != nil {
		existingWorkflow.Steps = updateData.Steps
	}

	existingWorkflow.UpdatedAt = time.Now()
	ws.workflows[workflowID] = existingWorkflow

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(existingWorkflow)
}

func (ws *WorkflowService) DeleteWorkflow(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	workflowID := vars["id"]

	if _, exists := ws.workflows[workflowID]; !exists {
		http.Error(w, "Workflow not found", http.StatusNotFound)
		return
	}

	delete(ws.workflows, workflowID)
	w.WriteHeader(http.StatusNoContent)
}

func (ws *WorkflowService) HealthCheck(w http.ResponseWriter, r *http.Request) {
	health := map[string]interface{}{
		"status":    "healthy",
		"service":   "workflow-service",
		"timestamp": time.Now(),
		"workflows": len(ws.workflows),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(health)
}

func main() {
	workflowService := NewWorkflowService()

	r := mux.NewRouter()

	// API routes
	api := r.PathPrefix("/api/v1").Subrouter()
	api.HandleFunc("/workflows", workflowService.CreateWorkflow).Methods("POST")
	api.HandleFunc("/workflows", workflowService.ListWorkflows).Methods("GET")
	api.HandleFunc("/workflows/{id}", workflowService.GetWorkflow).Methods("GET")
	api.HandleFunc("/workflows/{id}", workflowService.UpdateWorkflow).Methods("PUT")
	api.HandleFunc("/workflows/{id}", workflowService.DeleteWorkflow).Methods("DELETE")
	api.HandleFunc("/workflows/{id}/execute", workflowService.ExecuteWorkflow).Methods("POST")

	// Health check
	r.HandleFunc("/health", workflowService.HealthCheck).Methods("GET")

	// CORS
	c := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"*"},
	})

	handler := c.Handler(r)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8083"
	}

	log.Printf("Workflow Service starting on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, handler))
}
