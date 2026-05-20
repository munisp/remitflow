package engine

import (
"context"

"workflow-orchestrator/internal/domain"
"workflow-orchestrator/internal/middleware"
"workflow-orchestrator/internal/repository"
)

type StateManager struct {
repo  repository.WorkflowRepository
redis *middleware.RedisClient
}

func NewStateManager(repo repository.WorkflowRepository, redis *middleware.RedisClient) *StateManager {
return &StateManager{
repo:  repo,
redis: redis,
}
}

func (s *StateManager) SaveState(ctx context.Context, workflow *domain.Workflow) error {
if err := s.repo.Update(ctx, workflow); err != nil {
return err
}

if err := s.redis.CacheWorkflowState(ctx, workflow); err != nil {
return err
}

return nil
}

func (s *StateManager) GetState(ctx context.Context, workflowID string) (*domain.Workflow, error) {
workflow, err := s.redis.GetWorkflowState(ctx, workflowID)
if err == nil && workflow != nil {
return workflow, nil
}

return s.repo.GetByWorkflowID(ctx, workflowID)
}
