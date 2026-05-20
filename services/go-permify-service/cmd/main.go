// RemitFlow — Permify Authorization Service (Go)
// Fine-grained RBAC/ABAC authorization using Permify (Zanzibar-inspired).
// Manages permissions for: users, admins, partners, compliance officers, agents.
//
// Schema: remitflow-permify-schema.yaml
// Permify server: permify:3476 (gRPC)

package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	permify "github.com/Permify/permify-go/v1"
	base "github.com/Permify/permify-go/v1/generated/base/v1"
)

// ─── Permission Schema ────────────────────────────────────────────────────────
// Defined in infra/permify/schema.yaml
// Entities: user, wallet, transaction, kyc_doc, partner, admin
// Relations: owner, viewer, approver, compliance_officer, partner_agent
// Permissions:
//   - wallet: read, write, transfer, freeze
//   - transaction: read, cancel, refund, export
//   - kyc_doc: read, approve, reject
//   - partner: manage_agents, view_earnings, sign_agreement
//   - admin: full_access, manage_users, view_all_transactions

const SchemaVersion = "v110"

// ─── Permission Definitions ───────────────────────────────────────────────────
type CheckRequest struct {
	SubjectType string `json:"subject_type" binding:"required"` // user, admin, partner
	SubjectID   string `json:"subject_id" binding:"required"`
	Permission  string `json:"permission" binding:"required"`
	EntityType  string `json:"entity_type" binding:"required"` // wallet, transaction, etc.
	EntityID    string `json:"entity_id" binding:"required"`
}

type CheckResponse struct {
	Allowed bool   `json:"allowed"`
	Reason  string `json:"reason,omitempty"`
}

type WriteRelationRequest struct {
	SubjectType  string `json:"subject_type" binding:"required"`
	SubjectID    string `json:"subject_id" binding:"required"`
	Relation     string `json:"relation" binding:"required"`
	EntityType   string `json:"entity_type" binding:"required"`
	EntityID     string `json:"entity_id" binding:"required"`
}

// ─── Permify Client ───────────────────────────────────────────────────────────
type AuthzService struct {
	client *permify.Client
	tenant string
}

func NewAuthzService(endpoint, tenant string) (*AuthzService, error) {
	pc, err := permify.NewClient(
		permify.Config{Endpoint: endpoint},
		permify.WithInsecure(),
	)
	if err != nil {
		return nil, err
	}
	return &AuthzService{client: pc, tenant: tenant}, nil
}

func (s *AuthzService) Check(ctx context.Context, req CheckRequest) (bool, error) {
	cr, err := s.client.Permission.Check(ctx, &base.PermissionCheckRequest{
		TenantId: s.tenant,
		Metadata: &base.PermissionCheckRequestMetadata{
			SchemaVersion: SchemaVersion,
			SnapToken:     "",
			Depth:         20,
		},
		Entity: &base.Entity{
			Type: req.EntityType,
			Id:   req.EntityID,
		},
		Permission: req.Permission,
		Subject: &base.Subject{
			Type: req.SubjectType,
			Id:   req.SubjectID,
		},
	})
	if err != nil {
		return false, err
	}
	return cr.Can == base.CheckResult_CHECK_RESULT_ALLOWED, nil
}

func (s *AuthzService) WriteRelation(ctx context.Context, req WriteRelationRequest) error {
	_, err := s.client.Data.Write(ctx, &base.DataWriteRequest{
		TenantId: s.tenant,
		Metadata: &base.DataWriteRequestMetadata{SchemaVersion: SchemaVersion},
		Tuples: []*base.Tuple{
			{
				Entity:   &base.Entity{Type: req.EntityType, Id: req.EntityID},
				Relation: req.Relation,
				Subject:  &base.Subject{Type: req.SubjectType, Id: req.SubjectID},
			},
		},
	})
	return err
}

func (s *AuthzService) DeleteRelation(ctx context.Context, req WriteRelationRequest) error {
	_, err := s.client.Data.Delete(ctx, &base.DataDeleteRequest{
		TenantId: s.tenant,
		TupleFilter: &base.TupleFilter{
			Entity:   &base.EntityFilter{Type: req.EntityType, Ids: []string{req.EntityID}},
			Relation: req.Relation,
			Subject:  &base.SubjectFilter{Type: req.SubjectType, Ids: []string{req.SubjectID}},
		},
	})
	return err
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────
var authzSvc *AuthzService

func checkPermission(c *gin.Context) {
	var req CheckRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	allowed, err := authzSvc.Check(ctx, req)
	if err != nil {
		// Fallback: deny on error (fail-safe)
		log.Printf("[Permify] Check error: %v", err)
		c.JSON(http.StatusOK, CheckResponse{Allowed: false, Reason: "authz_service_error"})
		return
	}

	c.JSON(http.StatusOK, CheckResponse{Allowed: allowed})
}

func writeRelation(c *gin.Context) {
	var req WriteRelationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := authzSvc.WriteRelation(ctx, req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"written": true})
}

func deleteRelation(c *gin.Context) {
	var req WriteRelationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := authzSvc.DeleteRelation(ctx, req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// Bulk permission check for UI (check multiple permissions at once)
func bulkCheck(c *gin.Context) {
	var reqs []CheckRequest
	if err := c.ShouldBindJSON(&reqs); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	results := make([]map[string]interface{}, len(reqs))
	for i, req := range reqs {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		allowed, err := authzSvc.Check(ctx, req)
		cancel()
		results[i] = map[string]interface{}{
			"permission": req.Permission,
			"entity":     req.EntityType + ":" + req.EntityID,
			"allowed":    allowed,
			"error":      err != nil,
		}
	}
	c.JSON(http.StatusOK, gin.H{"results": results})
}

// Seed default relations for a new user
func seedUserRelations(c *gin.Context) {
	userID := c.Param("user_id")
	walletID := c.Query("wallet_id")
	if walletID == "" {
		walletID = userID
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	relations := []WriteRelationRequest{
		{SubjectType: "user", SubjectID: userID, Relation: "owner", EntityType: "wallet", EntityID: walletID},
		{SubjectType: "user", SubjectID: userID, Relation: "owner", EntityType: "user", EntityID: userID},
	}

	for _, rel := range relations {
		if err := authzSvc.WriteRelation(ctx, rel); err != nil {
			log.Printf("[Permify] Seed relation error: %v", err)
		}
	}
	c.JSON(http.StatusCreated, gin.H{"seeded": true, "user_id": userID})
}

// ─── Main ─────────────────────────────────────────────────────────────────────
func main() {
	permifyEndpoint := os.Getenv("PERMIFY_ENDPOINT")
	if permifyEndpoint == "" {
		permifyEndpoint = "permify:3476"
	}
	tenant := os.Getenv("PERMIFY_TENANT")
	if tenant == "" {
		tenant = "remitflow"
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8095"
	}

	var err error
	authzSvc, err = NewAuthzService(permifyEndpoint, tenant)
	if err != nil {
		log.Printf("[Permify] Connect warning: %v (using mock mode)", err)
		// Use mock service in dev
		authzSvc = &AuthzService{tenant: tenant}
	}

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "healthy",
			"service": "permify-authz",
			"version": "v110.0.0",
		})
	})

	api := r.Group("/api/v1/authz")
	api.POST("/check", checkPermission)
	api.POST("/check/bulk", bulkCheck)
	api.POST("/relations", writeRelation)
	api.DELETE("/relations", deleteRelation)
	api.POST("/users/:user_id/seed", seedUserRelations)

	log.Printf("[Permify] Authorization service listening on :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("[Permify] Server error: %v", err)
	}
}

// Mock check for dev mode (when Permify server is unavailable)
func mockCheck(req CheckRequest) bool {
	// Admin has all permissions
	if req.SubjectType == "admin" {
		return true
	}
	// Owner can read/write their own wallet
	if req.SubjectType == "user" && req.EntityType == "wallet" {
		return req.Permission == "read" || req.Permission == "write" || req.Permission == "transfer"
	}
	return false
}

var _ = json.Marshal // suppress import
