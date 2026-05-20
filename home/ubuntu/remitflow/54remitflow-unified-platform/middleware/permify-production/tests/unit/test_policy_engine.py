"""
Unit tests for policy engine
"""

import pytest
from unittest.mock import Mock, AsyncMock
from policies.policy_engine import (
    PolicyEngine,
    PolicyType,
    Role,
    PolicyRule,
    SUPER_ADMIN_ROLE,
    ORG_OWNER_ROLE
)
from client.permify_client import PermissionResult, PermissionCheckResponse


class TestPolicyEngine:
    """Test suite for policy engine"""
    
    @pytest.fixture
    def mock_client(self):
        """Create mock Permify client"""
        client = Mock()
        client.check_permission = AsyncMock()
        client.create_relationship = AsyncMock()
        client.list_relationships = AsyncMock()
        return client
    
    @pytest.fixture
    def engine(self, mock_client):
        """Create policy engine with mock client"""
        return PolicyEngine(client=mock_client)
    
    def test_register_role(self, engine):
        """Test role registration"""
        role = Role(
            id="test_role",
            name="Test Role",
            permissions=["view", "edit"]
        )
        
        engine.register_role(role)
        
        assert engine.get_role("test_role") == role
    
    @pytest.mark.asyncio
    async def test_assign_role_to_user(self, engine, mock_client):
        """Test assigning role to user"""
        role = Role(
            id="admin",
            name="Admin",
            permissions=["manage_all"]
        )
        engine.register_role(role)
        
        mock_client.create_relationship.return_value = True
        
        result = await engine.assign_role_to_user("user_123", "admin")
        
        assert result is True
    
    @pytest.mark.asyncio
    async def test_check_role_permission_allowed(self, engine, mock_client):
        """Test role permission check - allowed"""
        role = Role(
            id="editor",
            name="Editor",
            permissions=["view", "edit"]
        )
        engine.register_role(role)
        
        mock_client.check_permission.return_value = PermissionCheckResponse(
            can=PermissionResult.ALLOWED,
            metadata={},
            duration_ms=10
        )
        
        result = await engine.check_role_permission("user_123", "editor", "edit")
        
        assert result is True
    
    @pytest.mark.asyncio
    async def test_check_role_permission_denied_no_permission(self, engine, mock_client):
        """Test role permission check - denied (role lacks permission)"""
        role = Role(
            id="viewer",
            name="Viewer",
            permissions=["view"]
        )
        engine.register_role(role)
        
        result = await engine.check_role_permission("user_123", "viewer", "edit")
        
        assert result is False
    
    def test_add_policy_rule(self, engine):
        """Test adding policy rule"""
        rule = PolicyRule(
            id="rule_1",
            name="Test Rule",
            policy_type=PolicyType.ABAC,
            conditions={"user": {"level": "senior"}},
            effect="allow",
            priority=100
        )
        
        engine.add_policy_rule(rule)
        
        assert len(engine.rules) == 1
        assert engine.rules[0] == rule
    
    def test_remove_policy_rule(self, engine):
        """Test removing policy rule"""
        rule = PolicyRule(
            id="rule_1",
            name="Test Rule",
            policy_type=PolicyType.ABAC,
            conditions={},
            effect="allow"
        )
        
        engine.add_policy_rule(rule)
        engine.remove_policy_rule("rule_1")
        
        assert len(engine.rules) == 0
    
    @pytest.mark.asyncio
    async def test_evaluate_abac_policy_allowed(self, engine):
        """Test ABAC policy evaluation - allowed"""
        rule = PolicyRule(
            id="senior_access",
            name="Senior Access Rule",
            policy_type=PolicyType.ABAC,
            conditions={
                "user": {"level": "senior"},
                "resource": {"classification": "sensitive"},
                "action": ["view", "edit"]
            },
            effect="allow",
            priority=100
        )
        engine.add_policy_rule(rule)
        
        result = await engine.evaluate_abac_policy(
            user_attributes={"level": "senior", "department": "finance"},
            resource_attributes={"classification": "sensitive", "owner": "org_1"},
            action="view"
        )
        
        assert result is True
    
    @pytest.mark.asyncio
    async def test_evaluate_abac_policy_denied(self, engine):
        """Test ABAC policy evaluation - denied"""
        rule = PolicyRule(
            id="senior_access",
            name="Senior Access Rule",
            policy_type=PolicyType.ABAC,
            conditions={
                "user": {"level": "senior"},
                "action": ["view"]
            },
            effect="allow"
        )
        engine.add_policy_rule(rule)
        
        result = await engine.evaluate_abac_policy(
            user_attributes={"level": "junior"},
            resource_attributes={},
            action="view"
        )
        
        assert result is False
    
    def test_compare_values_operators(self, engine):
        """Test value comparison with operators"""
        # Equality
        assert engine._compare_values(10, {"eq": 10}) is True
        assert engine._compare_values(10, {"eq": 20}) is False
        
        # Greater than
        assert engine._compare_values(15, {"gt": 10}) is True
        assert engine._compare_values(5, {"gt": 10}) is False
        
        # In list
        assert engine._compare_values("admin", {"in": ["admin", "editor"]}) is True
        assert engine._compare_values("viewer", {"in": ["admin", "editor"]}) is False
        
        # Contains
        assert engine._compare_values("hello world", {"contains": "world"}) is True
        assert engine._compare_values("hello", {"contains": "world"}) is False
    
    @pytest.mark.asyncio
    async def test_evaluate_rebac_policy(self, engine, mock_client):
        """Test ReBAC policy evaluation"""
        mock_client.list_relationships.return_value = [Mock()]  # Non-empty list
        
        result = await engine.evaluate_rebac_policy(
            subject_type="user",
            subject_id="user_123",
            relation="owner",
            object_type="account",
            object_id="acc_123"
        )
        
        assert result is True
    
    @pytest.mark.asyncio
    async def test_get_related_entities(self, engine, mock_client):
        """Test getting related entities"""
        mock_rel_1 = Mock()
        mock_rel_1.entity_id = "acc_1"
        mock_rel_2 = Mock()
        mock_rel_2.entity_id = "acc_2"
        
        mock_client.list_relationships.return_value = [mock_rel_1, mock_rel_2]
        
        entities = await engine.get_related_entities(
            subject_type="user",
            subject_id="user_123",
            relation="owner",
            object_type="account"
        )
        
        assert len(entities) == 2
        assert "acc_1" in entities
        assert "acc_2" in entities
    
    @pytest.mark.asyncio
    async def test_evaluate_policy_combined(self, engine, mock_client):
        """Test combined policy evaluation (ReBAC + RBAC + ABAC)"""
        # Mock ReBAC check (allowed)
        mock_client.check_permission.return_value = PermissionCheckResponse(
            can=PermissionResult.ALLOWED,
            metadata={},
            duration_ms=10
        )
        
        result = await engine.evaluate_policy(
            user_id="user_123",
            action="view",
            resource_type="account",
            resource_id="acc_123"
        )
        
        assert result is True


def test_predefined_roles():
    """Test predefined roles"""
    assert SUPER_ADMIN_ROLE.id == "super_admin"
    assert "manage_all" in SUPER_ADMIN_ROLE.permissions
    
    assert ORG_OWNER_ROLE.id == "org_owner"
    assert "manage_members" in ORG_OWNER_ROLE.permissions

