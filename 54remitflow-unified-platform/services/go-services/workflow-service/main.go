package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
	_ "github.com/lib/pq"
)

// Workflow models
type Workflow struct {
	ID          int       `json:"id" db:"id"`
	Name        string    `json:"name" db:"name"`
	Description string    `json:"description" db:"description"`
	Category    string    `json:"category" db:"category"`
	Version     string    `json:"version" db:"version"`
	Definition  string    `json:"definition" db:"definition"`
	Status      string    `json:"status" db:"status"`
	IsActive    bool      `json:"is_active" db:"is_active"`
	CreatedBy   string    `json:"created_by" db:"created_by"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
}

type WorkflowExecution struct {
	ID           int       `json:"id" db:"id"`
	WorkflowID   int       `json:"workflow_id" db:"workflow_id"`
	ExecutionID  string    `json:"execution_id" db:"execution_id"`
	Status       string    `json:"status" db:"status"`
	Input        string    `json:"input" db:"input"`
	Output       string    `json:"output" db:"output"`
	CurrentStep  string    `json:"current_step" db:"current_step"`
	StepCount    int       `json:"step_count" db:"step_count"`
	CompletedSteps int     `json:"completed_steps" db:"completed_steps"`
	ErrorMessage string    `json:"error_message" db:"error_message"`
	StartedAt    time.Time `json:"started_at" db:"started_at"`
	CompletedAt  *time.Time `json:"completed_at" db:"completed_at"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
}

type WorkflowStep struct {
	ID           int       `json:"id" db:"id"`
	ExecutionID  string    `json:"execution_id" db:"execution_id"`
	StepName     string    `json:"step_name" db:"step_name"`
	StepType     string    `json:"step_type" db:"step_type"`
	Status       string    `json:"status" db:"status"`
	Input        string    `json:"input" db:"input"`
	Output       string    `json:"output" db:"output"`
	ErrorMessage string    `json:"error_message" db:"error_message"`
	Duration     int       `json:"duration" db:"duration"`
	StartedAt    time.Time `json:"started_at" db:"started_at"`
	CompletedAt  *time.Time `json:"completed_at" db:"completed_at"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
}

type WorkflowTemplate struct {
	ID          int       `json:"id" db:"id"`
	Name        string    `json:"name" db:"name"`
	Description string    `json:"description" db:"description"`
	Category    string    `json:"category" db:"category"`
	Template    string    `json:"template" db:"template"`
	Variables   string    `json:"variables" db:"variables"`
	IsPublic    bool      `json:"is_public" db:"is_public"`
	CreatedBy   string    `json:"created_by" db:"created_by"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
}

type WorkflowSchedule struct {
	ID         int       `json:"id" db:"id"`
	WorkflowID int       `json:"workflow_id" db:"workflow_id"`
	Name       string    `json:"name" db:"name"`
	CronExpr   string    `json:"cron_expr" db:"cron_expr"`
	Input      string    `json:"input" db:"input"`
	IsActive   bool      `json:"is_active" db:"is_active"`
	NextRun    *time.Time `json:"next_run" db:"next_run"`
	LastRun    *time.Time `json:"last_run" db:"last_run"`
	CreatedAt  time.Time `json:"created_at" db:"created_at"`
	UpdatedAt  time.Time `json:"updated_at" db:"updated_at"`
}

type WorkflowService struct {
	db *sql.DB
}

func NewWorkflowService(db *sql.DB) *WorkflowService {
	return &WorkflowService{db: db}
}

// Initialize database tables
func (s *WorkflowService) InitTables() error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS workflows (
			id SERIAL PRIMARY KEY,
			name VARCHAR(200) NOT NULL,
			description TEXT,
			category VARCHAR(100) NOT NULL,
			version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
			definition JSONB NOT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'draft',
			is_active BOOLEAN DEFAULT true,
			created_by VARCHAR(100) NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			INDEX idx_workflows_category (category),
			INDEX idx_workflows_status (status),
			INDEX idx_workflows_active (is_active)
		)`,
		`CREATE TABLE IF NOT EXISTS workflow_executions (
			id SERIAL PRIMARY KEY,
			workflow_id INTEGER NOT NULL,
			execution_id VARCHAR(50) UNIQUE NOT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'pending',
			input JSONB,
			output JSONB,
			current_step VARCHAR(100),
			step_count INTEGER DEFAULT 0,
			completed_steps INTEGER DEFAULT 0,
			error_message TEXT,
			started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			completed_at TIMESTAMP,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
			INDEX idx_workflow_executions_workflow (workflow_id),
			INDEX idx_workflow_executions_status (status),
			INDEX idx_workflow_executions_started (started_at)
		)`,
		`CREATE TABLE IF NOT EXISTS workflow_steps (
			id SERIAL PRIMARY KEY,
			execution_id VARCHAR(50) NOT NULL,
			step_name VARCHAR(100) NOT NULL,
			step_type VARCHAR(50) NOT NULL,
			status VARCHAR(20) NOT NULL DEFAULT 'pending',
			input JSONB,
			output JSONB,
			error_message TEXT,
			duration INTEGER DEFAULT 0,
			started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			completed_at TIMESTAMP,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (execution_id) REFERENCES workflow_executions(execution_id) ON DELETE CASCADE,
			INDEX idx_workflow_steps_execution (execution_id),
			INDEX idx_workflow_steps_status (status)
		)`,
		`CREATE TABLE IF NOT EXISTS workflow_templates (
			id SERIAL PRIMARY KEY,
			name VARCHAR(200) NOT NULL,
			description TEXT,
			category VARCHAR(100) NOT NULL,
			template JSONB NOT NULL,
			variables JSONB,
			is_public BOOLEAN DEFAULT false,
			created_by VARCHAR(100) NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			INDEX idx_workflow_templates_category (category),
			INDEX idx_workflow_templates_public (is_public)
		)`,
		`CREATE TABLE IF NOT EXISTS workflow_schedules (
			id SERIAL PRIMARY KEY,
			workflow_id INTEGER NOT NULL,
			name VARCHAR(200) NOT NULL,
			cron_expr VARCHAR(100) NOT NULL,
			input JSONB,
			is_active BOOLEAN DEFAULT true,
			next_run TIMESTAMP,
			last_run TIMESTAMP,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
			INDEX idx_workflow_schedules_workflow (workflow_id),
			INDEX idx_workflow_schedules_active (is_active),
			INDEX idx_workflow_schedules_next_run (next_run)
		)`,
	}

	for _, query := range queries {
		if _, err := s.db.Exec(query); err != nil {
			return fmt.Errorf("failed to create table: %v", err)
		}
	}

	// Insert default workflows and templates
	s.insertDefaultWorkflows()
	s.insertDefaultTemplates()

	return nil
}

func (s *WorkflowService) insertDefaultWorkflows() {
	workflows := []Workflow{
		{
			Name:        "Agent Onboarding Workflow",
			Description: "Complete workflow for onboarding new banking agents",
			Category:    "onboarding",
			Version:     "1.0.0",
			Definition: `{
				"steps": [
					{"name": "validate_documents", "type": "validation", "timeout": 300},
					{"name": "background_check", "type": "external_api", "timeout": 600},
					{"name": "create_account", "type": "database", "timeout": 60},
					{"name": "setup_permissions", "type": "authorization", "timeout": 120},
					{"name": "send_welcome_email", "type": "notification", "timeout": 30}
				],
				"error_handling": "retry_failed_steps",
				"max_retries": 3
			}`,
			Status:    "active",
			IsActive:  true,
			CreatedBy: "system",
		},
		{
			Name:        "Transaction Processing Workflow",
			Description: "Standard workflow for processing banking transactions",
			Category:    "transaction",
			Version:     "2.1.0",
			Definition: `{
				"steps": [
					{"name": "validate_transaction", "type": "validation", "timeout": 30},
					{"name": "fraud_check", "type": "ml_analysis", "timeout": 100},
					{"name": "balance_check", "type": "database", "timeout": 60},
					{"name": "process_payment", "type": "payment", "timeout": 180},
					{"name": "update_ledger", "type": "ledger", "timeout": 90},
					{"name": "send_confirmation", "type": "notification", "timeout": 30}
				],
				"error_handling": "rollback_on_failure",
				"max_retries": 2
			}`,
			Status:    "active",
			IsActive:  true,
			CreatedBy: "system",
		},
		{
			Name:        "Compliance Audit Workflow",
			Description: "Automated compliance audit and reporting workflow",
			Category:    "compliance",
			Version:     "1.2.0",
			Definition: `{
				"steps": [
					{"name": "collect_audit_data", "type": "data_collection", "timeout": 600},
					{"name": "analyze_compliance", "type": "analysis", "timeout": 300},
					{"name": "generate_report", "type": "report", "timeout": 180},
					{"name": "review_findings", "type": "manual_review", "timeout": 1800},
					{"name": "submit_report", "type": "submission", "timeout": 120}
				],
				"error_handling": "pause_on_failure",
				"max_retries": 1
			}`,
			Status:    "active",
			IsActive:  true,
			CreatedBy: "system",
		},
		{
			Name:        "Risk Assessment Workflow",
			Description: "Comprehensive risk assessment for agents and transactions",
			Category:    "risk",
			Version:     "1.0.0",
			Definition: `{
				"steps": [
					{"name": "collect_risk_data", "type": "data_collection", "timeout": 120},
					{"name": "ml_risk_analysis", "type": "ml_analysis", "timeout": 200},
					{"name": "rule_based_check", "type": "rule_engine", "timeout": 60},
					{"name": "calculate_risk_score", "type": "calculation", "timeout": 30},
					{"name": "update_risk_profile", "type": "database", "timeout": 90},
					{"name": "trigger_alerts", "type": "notification", "timeout": 60}
				],
				"error_handling": "continue_on_failure",
				"max_retries": 2
			}`,
			Status:    "active",
			IsActive:  true,
			CreatedBy: "system",
		},
	}

	for _, workflow := range workflows {
		query := `INSERT INTO workflows (name, description, category, version, definition, status, is_active, created_by)
				  VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`
		s.db.Exec(query, workflow.Name, workflow.Description, workflow.Category,
				  workflow.Version, workflow.Definition, workflow.Status,
				  workflow.IsActive, workflow.CreatedBy)
	}
}

func (s *WorkflowService) insertDefaultTemplates() {
	templates := []WorkflowTemplate{
		{
			Name:        "Basic Approval Workflow",
			Description: "Simple approval workflow template",
			Category:    "approval",
			Template: `{
				"steps": [
					{"name": "submit_request", "type": "input", "timeout": 60},
					{"name": "manager_review", "type": "manual_review", "timeout": 3600},
					{"name": "final_approval", "type": "approval", "timeout": 1800},
					{"name": "notify_result", "type": "notification", "timeout": 30}
				],
				"variables": ["request_type", "approver_email", "notification_template"]
			}`,
			Variables: `{
				"request_type": {"type": "string", "required": true},
				"approver_email": {"type": "email", "required": true},
				"notification_template": {"type": "string", "default": "standard"}
			}`,
			IsPublic:  true,
			CreatedBy: "system",
		},
		{
			Name:        "Data Processing Pipeline",
			Description: "Template for data processing workflows",
			Category:    "data",
			Template: `{
				"steps": [
					{"name": "extract_data", "type": "data_extraction", "timeout": 300},
					{"name": "transform_data", "type": "data_transformation", "timeout": 600},
					{"name": "validate_data", "type": "validation", "timeout": 180},
					{"name": "load_data", "type": "data_loading", "timeout": 300},
					{"name": "generate_summary", "type": "reporting", "timeout": 120}
				],
				"variables": ["source_system", "target_system", "transformation_rules"]
			}`,
			Variables: `{
				"source_system": {"type": "string", "required": true},
				"target_system": {"type": "string", "required": true},
				"transformation_rules": {"type": "json", "required": false}
			}`,
			IsPublic:  true,
			CreatedBy: "system",
		},
	}

	for _, template := range templates {
		query := `INSERT INTO workflow_templates (name, description, category, template, variables, is_public, created_by)
				  VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`
		s.db.Exec(query, template.Name, template.Description, template.Category,
				  template.Template, template.Variables, template.IsPublic, template.CreatedBy)
	}
}

// Workflow endpoints
func (s *WorkflowService) getWorkflows(c *gin.Context) {
	category := c.Query("category")
	status := c.Query("status")
	isActive := c.Query("is_active")

	query := `SELECT id, name, description, category, version, definition, status, 
			  is_active, created_by, created_at, updated_at 
			  FROM workflows WHERE 1=1`
	args := []interface{}{}
	argCount := 0

	if category != "" {
		argCount++
		query += fmt.Sprintf(" AND category = $%d", argCount)
		args = append(args, category)
	}

	if status != "" {
		argCount++
		query += fmt.Sprintf(" AND status = $%d", argCount)
		args = append(args, status)
	}

	if isActive != "" {
		argCount++
		query += fmt.Sprintf(" AND is_active = $%d", argCount)
		args = append(args, isActive == "true")
	}

	query += " ORDER BY name"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var workflows []Workflow
	for rows.Next() {
		var workflow Workflow
		err := rows.Scan(&workflow.ID, &workflow.Name, &workflow.Description,
						&workflow.Category, &workflow.Version, &workflow.Definition,
						&workflow.Status, &workflow.IsActive, &workflow.CreatedBy,
						&workflow.CreatedAt, &workflow.UpdatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		workflows = append(workflows, workflow)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": workflows,
		"count": len(workflows),
	})
}

func (s *WorkflowService) createWorkflow(c *gin.Context) {
	var workflow Workflow
	if err := c.ShouldBindJSON(&workflow); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	query := `INSERT INTO workflows (name, description, category, version, definition, 
			  status, is_active, created_by)
			  VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
			  RETURNING id, created_at, updated_at`
	
	err := s.db.QueryRow(query, workflow.Name, workflow.Description, workflow.Category,
						workflow.Version, workflow.Definition, workflow.Status,
						workflow.IsActive, workflow.CreatedBy).
						Scan(&workflow.ID, &workflow.CreatedAt, &workflow.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"status": "success",
		"data": workflow,
	})
}

func (s *WorkflowService) executeWorkflow(c *gin.Context) {
	id := c.Param("id")
	var executeData struct {
		Input map[string]interface{} `json:"input"`
	}

	if err := c.ShouldBindJSON(&executeData); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get workflow details
	var workflow Workflow
	query := `SELECT id, name, definition FROM workflows WHERE id = $1 AND is_active = true`
	err := s.db.QueryRow(query, id).Scan(&workflow.ID, &workflow.Name, &workflow.Definition)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "Workflow not found or inactive"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Create execution record
	executionID := fmt.Sprintf("exec_%d_%d", workflow.ID, time.Now().Unix())
	inputJSON, _ := json.Marshal(executeData.Input)

	// Parse workflow definition to get step count
	var definition map[string]interface{}
	json.Unmarshal([]byte(workflow.Definition), &definition)
	steps, _ := definition["steps"].([]interface{})
	stepCount := len(steps)

	execQuery := `INSERT INTO workflow_executions (workflow_id, execution_id, status, 
				  input, step_count, started_at)
				  VALUES ($1, $2, $3, $4, $5, $6) 
				  RETURNING id, created_at`
	
	var execution WorkflowExecution
	err = s.db.QueryRow(execQuery, workflow.ID, executionID, "running",
						string(inputJSON), stepCount, time.Now()).
						Scan(&execution.ID, &execution.CreatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Start workflow execution (simulate)
	go s.simulateWorkflowExecution(executionID, steps)

	execution.WorkflowID = workflow.ID
	execution.ExecutionID = executionID
	execution.Status = "running"
	execution.Input = string(inputJSON)
	execution.StepCount = stepCount
	execution.StartedAt = time.Now()

	c.JSON(http.StatusCreated, gin.H{
		"status": "success",
		"data": execution,
	})
}

func (s *WorkflowService) simulateWorkflowExecution(executionID string, steps []interface{}) {
	completedSteps := 0
	
	for i, stepInterface := range steps {
		step, ok := stepInterface.(map[string]interface{})
		if !ok {
			continue
		}

		stepName := step["name"].(string)
		stepType := step["type"].(string)
		timeout := 60 // default timeout

		if timeoutVal, exists := step["timeout"]; exists {
			if timeoutFloat, ok := timeoutVal.(float64); ok {
				timeout = int(timeoutFloat)
			}
		}

		// Create step record
		stepQuery := `INSERT INTO workflow_steps (execution_id, step_name, step_type, 
					  status, started_at)
					  VALUES ($1, $2, $3, $4, $5)`
		s.db.Exec(stepQuery, executionID, stepName, stepType, "running", time.Now())

		// Simulate step execution
		executionTime := time.Duration(timeout/10) * time.Second // Simulate faster execution
		time.Sleep(executionTime)

		// Update step as completed
		stepUpdateQuery := `UPDATE workflow_steps 
						   SET status = $1, completed_at = $2, duration = $3
						   WHERE execution_id = $4 AND step_name = $5`
		s.db.Exec(stepUpdateQuery, "completed", time.Now(), int(executionTime.Milliseconds()),
				  executionID, stepName)

		completedSteps++

		// Update execution progress
		execUpdateQuery := `UPDATE workflow_executions 
						   SET completed_steps = $1, current_step = $2, updated_at = $3
						   WHERE execution_id = $4`
		s.db.Exec(execUpdateQuery, completedSteps, stepName, time.Now(), executionID)
	}

	// Mark execution as completed
	finalUpdateQuery := `UPDATE workflow_executions 
						SET status = $1, completed_at = $2, updated_at = $3
						WHERE execution_id = $4`
	s.db.Exec(finalUpdateQuery, "completed", time.Now(), time.Now(), executionID)
}

// Workflow execution endpoints
func (s *WorkflowService) getWorkflowExecutions(c *gin.Context) {
	workflowID := c.Query("workflow_id")
	status := c.Query("status")
	limit := c.DefaultQuery("limit", "100")

	query := `SELECT id, workflow_id, execution_id, status, input, output, 
			  current_step, step_count, completed_steps, error_message,
			  started_at, completed_at, created_at, updated_at 
			  FROM workflow_executions WHERE 1=1`
	args := []interface{}{}
	argCount := 0

	if workflowID != "" {
		argCount++
		query += fmt.Sprintf(" AND workflow_id = $%d", argCount)
		args = append(args, workflowID)
	}

	if status != "" {
		argCount++
		query += fmt.Sprintf(" AND status = $%d", argCount)
		args = append(args, status)
	}

	argCount++
	query += fmt.Sprintf(" ORDER BY started_at DESC LIMIT $%d", argCount)
	args = append(args, limit)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var executions []WorkflowExecution
	for rows.Next() {
		var execution WorkflowExecution
		err := rows.Scan(&execution.ID, &execution.WorkflowID, &execution.ExecutionID,
						&execution.Status, &execution.Input, &execution.Output,
						&execution.CurrentStep, &execution.StepCount, &execution.CompletedSteps,
						&execution.ErrorMessage, &execution.StartedAt, &execution.CompletedAt,
						&execution.CreatedAt, &execution.UpdatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		executions = append(executions, execution)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": executions,
		"count": len(executions),
	})
}

func (s *WorkflowService) getWorkflowSteps(c *gin.Context) {
	executionID := c.Param("execution_id")

	query := `SELECT id, execution_id, step_name, step_type, status, input, output,
			  error_message, duration, started_at, completed_at, created_at 
			  FROM workflow_steps WHERE execution_id = $1 ORDER BY created_at`

	rows, err := s.db.Query(query, executionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var steps []WorkflowStep
	for rows.Next() {
		var step WorkflowStep
		err := rows.Scan(&step.ID, &step.ExecutionID, &step.StepName, &step.StepType,
						&step.Status, &step.Input, &step.Output, &step.ErrorMessage,
						&step.Duration, &step.StartedAt, &step.CompletedAt, &step.CreatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		steps = append(steps, step)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": steps,
		"count": len(steps),
	})
}

// Template endpoints
func (s *WorkflowService) getWorkflowTemplates(c *gin.Context) {
	category := c.Query("category")
	isPublic := c.Query("is_public")

	query := `SELECT id, name, description, category, template, variables, 
			  is_public, created_by, created_at, updated_at 
			  FROM workflow_templates WHERE 1=1`
	args := []interface{}{}
	argCount := 0

	if category != "" {
		argCount++
		query += fmt.Sprintf(" AND category = $%d", argCount)
		args = append(args, category)
	}

	if isPublic != "" {
		argCount++
		query += fmt.Sprintf(" AND is_public = $%d", argCount)
		args = append(args, isPublic == "true")
	}

	query += " ORDER BY name"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var templates []WorkflowTemplate
	for rows.Next() {
		var template WorkflowTemplate
		err := rows.Scan(&template.ID, &template.Name, &template.Description,
						&template.Category, &template.Template, &template.Variables,
						&template.IsPublic, &template.CreatedBy, &template.CreatedAt,
						&template.UpdatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		templates = append(templates, template)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": templates,
		"count": len(templates),
	})
}

// Dashboard summary endpoint
func (s *WorkflowService) getDashboardSummary(c *gin.Context) {
	// Get workflow summary
	var totalWorkflows int
	var activeWorkflows int
	err := s.db.QueryRow(`SELECT COUNT(*), 
						  SUM(CASE WHEN is_active THEN 1 ELSE 0 END)
						  FROM workflows`).
						  Scan(&totalWorkflows, &activeWorkflows)
	if err != nil {
		totalWorkflows = 0
		activeWorkflows = 0
	}

	// Get execution summary
	var totalExecutions int
	var runningExecutions int
	var completedExecutions int
	var failedExecutions int
	err = s.db.QueryRow(`SELECT COUNT(*), 
						 SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END),
						 SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END),
						 SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)
						 FROM workflow_executions 
						 WHERE started_at >= NOW() - INTERVAL '24 hours'`).
						 Scan(&totalExecutions, &runningExecutions, &completedExecutions, &failedExecutions)
	if err != nil {
		totalExecutions = 0
		runningExecutions = 0
		completedExecutions = 0
		failedExecutions = 0
	}

	// Get template summary
	var totalTemplates int
	var publicTemplates int
	err = s.db.QueryRow(`SELECT COUNT(*), 
						 SUM(CASE WHEN is_public THEN 1 ELSE 0 END)
						 FROM workflow_templates`).
						 Scan(&totalTemplates, &publicTemplates)
	if err != nil {
		totalTemplates = 0
		publicTemplates = 0
	}

	summary := gin.H{
		"workflows": gin.H{
			"total": totalWorkflows,
			"active": activeWorkflows,
		},
		"executions_24h": gin.H{
			"total": totalExecutions,
			"running": runningExecutions,
			"completed": completedExecutions,
			"failed": failedExecutions,
			"success_rate": func() float64 {
				if totalExecutions > 0 {
					return float64(completedExecutions) / float64(totalExecutions) * 100
				}
				return 0
			}(),
		},
		"templates": gin.H{
			"total": totalTemplates,
			"public": publicTemplates,
		},
		"generated_at": time.Now(),
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": summary,
	})
}

// Health check endpoint
func (s *WorkflowService) healthCheck(c *gin.Context) {
	// Test database connection
	err := s.db.Ping()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status": "unhealthy",
			"error": "database connection failed",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "healthy",
		"service": "workflow-service",
		"timestamp": time.Now(),
		"database": "connected",
	})
}

func main() {
	// Database connection
	dbHost := getEnv("DB_HOST", "localhost")
	dbPort := getEnv("DB_PORT", "5432")
	dbUser := getEnv("DB_USER", "postgres")
	dbPassword := getEnv("DB_PASSWORD", "password")
	dbName := getEnv("DB_NAME", "remittance")

	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		dbHost, dbPort, dbUser, dbPassword, dbName)

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}
	defer db.Close()

	// Test connection
	if err := db.Ping(); err != nil {
		log.Fatal("Failed to ping database:", err)
	}

	// Initialize service
	service := NewWorkflowService(db)
	if err := service.InitTables(); err != nil {
		log.Fatal("Failed to initialize tables:", err)
	}

	// Setup Gin router
	r := gin.Default()

	// CORS middleware
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"*"}
	r.Use(cors.New(config))

	// Routes
	api := r.Group("/api/v1")
	{
		// Health check
		api.GET("/health", service.healthCheck)
		
		// Workflows
		api.GET("/workflows", service.getWorkflows)
		api.POST("/workflows", service.createWorkflow)
		api.POST("/workflows/:id/execute", service.executeWorkflow)
		
		// Workflow Executions
		api.GET("/workflows/executions", service.getWorkflowExecutions)
		api.GET("/workflows/executions/:execution_id/steps", service.getWorkflowSteps)
		
		// Workflow Templates
		api.GET("/workflows/templates", service.getWorkflowTemplates)
		
		// Dashboard Summary
		api.GET("/workflows/dashboard", service.getDashboardSummary)
	}

	port := getEnv("PORT", "8085")
	log.Printf("Workflow Service starting on port %s", port)
	log.Fatal(r.Run("0.0.0.0:" + port))
}

func getEnv(key, defaultValue string) string {

// requireEnv returns the value of an environment variable or panics if not set
// Use this for critical configuration like database passwords, API keys, etc.
func requireEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("CRITICAL: Required environment variable %s is not set. Cannot start service.", key)
	}
	return value
}
	if value := os.Getenv(key); value != "" {

// requireEnv returns the value of an environment variable or panics if not set
// Use this for critical configuration like database passwords, API keys, etc.
func requireEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("CRITICAL: Required environment variable %s is not set. Cannot start service.", key)
	}
	return value
}
		return value

// requireEnv returns the value of an environment variable or panics if not set
// Use this for critical configuration like database passwords, API keys, etc.
func requireEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("CRITICAL: Required environment variable %s is not set. Cannot start service.", key)
	}
	return value
}
	}

// requireEnv returns the value of an environment variable or panics if not set
// Use this for critical configuration like database passwords, API keys, etc.
func requireEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("CRITICAL: Required environment variable %s is not set. Cannot start service.", key)
	}
	return value
}
	return defaultValue

// requireEnv returns the value of an environment variable or panics if not set
// Use this for critical configuration like database passwords, API keys, etc.
func requireEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("CRITICAL: Required environment variable %s is not set. Cannot start service.", key)
	}
	return value
}
}

// requireEnv returns the value of an environment variable or panics if not set
// Use this for critical configuration like database passwords, API keys, etc.
func requireEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("CRITICAL: Required environment variable %s is not set. Cannot start service.", key)
	}
	return value
}

