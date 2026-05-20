package permify

import (
	"context"
	"fmt"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	v1 "github.com/Permify/permify-go/generated/base/v1"
	"workflow-orchestrator/pkg/logger"
)

// Client represents a Permify client for fine-grained authorization
type Client struct {
	client v1.PermissionClient
	conn   *grpc.ClientConn
	config *Config
}

// Config holds Permify configuration
type Config struct {
	GRPCAddr string
	TenantID string
}

// CheckResult represents the result of a permission check
type CheckResult struct {
	Allowed bool
	Reason  string
}

// NewClient creates a new Permify client
func NewClient(config *Config) (*Client, error) {
	// Create gRPC connection
	conn, err := grpc.Dial(config.GRPCAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Permify: %w", err)
	}

	// Create Permify client
	client := v1.NewPermissionClient(conn)

	return &Client{
		client: client,
		conn:   conn,
		config: config,
	}, nil
}

// CheckPermission checks if a user has permission to perform an action on a resource
func (c *Client) CheckPermission(ctx context.Context, userID, resource, relation, resourceID string) (*CheckResult, error) {
	logger.Logger.Info("Checking permission with Permify",
		logger.String("user_id", userID),
		logger.String("resource", resource),
		logger.String("relation", relation),
		logger.String("resource_id", resourceID),
	)

	// Create permission check request
	req := &v1.PermissionCheckRequest{
		TenantId: c.config.TenantID,
		Metadata: &v1.PermissionCheckRequestMetadata{
			SchemaVersion: "",
			SnapToken:     "",
			Depth:         20,
		},
		Entity: &v1.Entity{
			Type: resource,
			Id:   resourceID,
		},
		Permission: relation,
		Subject: &v1.Subject{
			Type: "user",
			Id:   userID,
		},
	}

	// Check permission
	resp, err := c.client.Check(ctx, req)
	if err != nil {
		logger.Logger.Error("Failed to check permission", logger.Error(err))
		return nil, fmt.Errorf("permission check failed: %w", err)
	}

	allowed := resp.Can == v1.CheckResult_CHECK_RESULT_ALLOWED

	logger.Logger.Info("Permission check result",
		logger.String("user_id", userID),
		logger.String("resource", resource),
		logger.String("allowed", fmt.Sprintf("%v", allowed)),
	)

	return &CheckResult{
		Allowed: allowed,
		Reason:  resp.Can.String(),
	}, nil
}

// WriteRelationship creates a relationship between entities
func (c *Client) WriteRelationship(ctx context.Context, resource, resourceID, relation, subjectType, subjectID string) error {
	logger.Logger.Info("Writing relationship to Permify",
		logger.String("resource", resource),
		logger.String("resource_id", resourceID),
		logger.String("relation", relation),
		logger.String("subject_type", subjectType),
		logger.String("subject_id", subjectID),
	)

	// Create relationship write request
	req := &v1.RelationshipWriteRequest{
		TenantId: c.config.TenantID,
		Metadata: &v1.RelationshipWriteRequestMetadata{
			SchemaVersion: "",
		},
		Tuples: []*v1.Tuple{
			{
				Entity: &v1.Entity{
					Type: resource,
					Id:   resourceID,
				},
				Relation: relation,
				Subject: &v1.Subject{
					Type: subjectType,
					Id:   subjectID,
				},
			},
		},
	}

	// Write relationship
	_, err := c.client.Write(ctx, req)
	if err != nil {
		logger.Logger.Error("Failed to write relationship", logger.Error(err))
		return fmt.Errorf("relationship write failed: %w", err)
	}

	logger.Logger.Info("Relationship written successfully")
	return nil
}

// DeleteRelationship deletes a relationship between entities
func (c *Client) DeleteRelationship(ctx context.Context, resource, resourceID, relation, subjectType, subjectID string) error {
	logger.Logger.Info("Deleting relationship from Permify",
		logger.String("resource", resource),
		logger.String("resource_id", resourceID),
		logger.String("relation", relation),
		logger.String("subject_type", subjectType),
		logger.String("subject_id", subjectID),
	)

	// Create relationship delete request
	req := &v1.RelationshipDeleteRequest{
		TenantId: c.config.TenantID,
		Filter: &v1.TupleFilter{
			Entity: &v1.EntityFilter{
				Type: resource,
				Ids:  []string{resourceID},
			},
			Relation: relation,
			Subject: &v1.SubjectFilter{
				Type: subjectType,
				Ids:  []string{subjectID},
			},
		},
	}

	// Delete relationship
	_, err := c.client.Delete(ctx, req)
	if err != nil {
		logger.Logger.Error("Failed to delete relationship", logger.Error(err))
		return fmt.Errorf("relationship delete failed: %w", err)
	}

	logger.Logger.Info("Relationship deleted successfully")
	return nil
}

// CheckWorkflowPermission checks if a user can perform an action on a workflow
func (c *Client) CheckWorkflowPermission(ctx context.Context, userID, workflowID, action string) (bool, error) {
	result, err := c.CheckPermission(ctx, userID, "workflow", action, workflowID)
	if err != nil {
		return false, err
	}
	return result.Allowed, nil
}

// GrantWorkflowAccess grants a user access to a workflow
func (c *Client) GrantWorkflowAccess(ctx context.Context, workflowID, userID, role string) error {
	// role can be "owner", "editor", "viewer"
	return c.WriteRelationship(ctx, "workflow", workflowID, role, "user", userID)
}

// RevokeWorkflowAccess revokes a user's access to a workflow
func (c *Client) RevokeWorkflowAccess(ctx context.Context, workflowID, userID, role string) error {
	return c.DeleteRelationship(ctx, "workflow", workflowID, role, "user", userID)
}

// CheckTenantMembership checks if a user is a member of a tenant
func (c *Client) CheckTenantMembership(ctx context.Context, userID, tenantID string) (bool, error) {
	result, err := c.CheckPermission(ctx, userID, "tenant", "member", tenantID)
	if err != nil {
		return false, err
	}
	return result.Allowed, nil
}

// AddTenantMember adds a user as a member of a tenant
func (c *Client) AddTenantMember(ctx context.Context, tenantID, userID string) error {
	return c.WriteRelationship(ctx, "tenant", tenantID, "member", "user", userID)
}

// RemoveTenantMember removes a user from a tenant
func (c *Client) RemoveTenantMember(ctx context.Context, tenantID, userID string) error {
	return c.DeleteRelationship(ctx, "tenant", tenantID, "member", "user", userID)
}

// Close closes the Permify client
func (c *Client) Close() error {
	return c.conn.Close()
}

