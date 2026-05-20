"""
End-to-end tests for complete authorization flow
These tests require a running Permify server
"""

import pytest
import os
from client.permify_client import PermifyClient
from service.authorization_service import AuthorizationService
from policies.policy_engine import PolicyEngine, initialize_default_roles


# Skip E2E tests if Permify server is not available
PERMIFY_URL = os.getenv("PERMIFY_HTTP_URL", "http://localhost:3476")
SKIP_E2E = os.getenv("SKIP_E2E_TESTS", "true").lower() == "true"


@pytest.mark.skipif(SKIP_E2E, reason="E2E tests disabled (set SKIP_E2E_TESTS=false to enable)")
class TestAuthorizationE2E:
    """End-to-end authorization tests"""
    
    @pytest.fixture
    async def client(self):
        """Create Permify client"""
        client = PermifyClient(
            base_url=PERMIFY_URL,
            tenant_id="test_tenant_e2e"
        )
        yield client
        await client.close()
    
    @pytest.fixture
    async def auth_service(self, client):
        """Create authorization service"""
        service = AuthorizationService(client=client)
        yield service
        await service.close()
    
    @pytest.fixture
    def policy_engine(self, client):
        """Create policy engine with default roles"""
        engine = PolicyEngine(client=client)
        initialize_default_roles(engine)
        return engine
    
    @pytest.mark.asyncio
    async def test_complete_account_access_flow(self, auth_service):
        """Test complete account access flow"""
        user_id = "user_e2e_1"
        account_id = "acc_e2e_1"
        
        # 1. Setup account ownership
        await auth_service.assign_account_owner(user_id, account_id)
        
        # 2. Check view balance permission (should be allowed)
        can_view = await auth_service.can_view_account_balance(user_id, account_id)
        assert can_view is True
        
        # 3. Check transfer permission (should be allowed)
        can_transfer = await auth_service.can_transfer_from_account(user_id, account_id)
        assert can_transfer is True
        
        # 4. Check for different user (should be denied)
        other_user_id = "user_e2e_2"
        can_view_other = await auth_service.can_view_account_balance(other_user_id, account_id)
        assert can_view_other is False
    
    @pytest.mark.asyncio
    async def test_organization_hierarchy(self, auth_service):
        """Test organization hierarchy permissions"""
        org_id = "org_e2e_1"
        owner_id = "user_e2e_owner"
        admin_id = "user_e2e_admin"
        member_id = "user_e2e_member"
        
        # 1. Setup organization
        await auth_service.client.create_relationship(
            entity_type="organization",
            entity_id=org_id,
            relation="owner",
            subject_type="user",
            subject_id=owner_id
        )
        
        await auth_service.assign_organization_admin(admin_id, org_id)
        await auth_service.assign_organization_member(member_id, org_id)
        
        # 2. Check owner permissions
        can_owner_manage = await auth_service.can_manage_organization_members(owner_id, org_id)
        assert can_owner_manage is True
        
        # 3. Check admin permissions
        can_admin_manage = await auth_service.can_manage_organization_members(admin_id, org_id)
        assert can_admin_manage is True
        
        # 4. Check member permissions (should not be able to manage)
        can_member_manage = await auth_service.can_manage_organization_members(member_id, org_id)
        assert can_member_manage is False
    
    @pytest.mark.asyncio
    async def test_transaction_approval_workflow(self, auth_service):
        """Test transaction approval workflow"""
        transaction_id = "txn_e2e_1"
        sender_id = "user_e2e_sender"
        compliance_officer_id = "user_e2e_officer"
        
        # 1. Setup transaction relationships
        await auth_service.client.create_relationship(
            entity_type="transaction",
            entity_id=transaction_id,
            relation="sender",
            subject_type="user",
            subject_id=sender_id
        )
        
        await auth_service.client.create_relationship(
            entity_type="transaction",
            entity_id=transaction_id,
            relation="compliance_officer",
            subject_type="user",
            subject_id=compliance_officer_id
        )
        
        # 2. Sender can view transaction
        can_sender_view = await auth_service.can_view_transaction(sender_id, transaction_id)
        assert can_sender_view is True
        
        # 3. Compliance officer can approve
        can_officer_approve = await auth_service.can_approve_transaction(compliance_officer_id, transaction_id)
        assert can_officer_approve is True
        
        # 4. Sender cannot approve (not a compliance officer)
        can_sender_approve = await auth_service.can_approve_transaction(sender_id, transaction_id)
        assert can_sender_approve is False
    
    @pytest.mark.asyncio
    async def test_kyc_verification_flow(self, auth_service):
        """Test KYC verification flow"""
        verification_id = "kyc_e2e_1"
        subject_id = "user_e2e_subject"
        officer_id = "user_e2e_kyc_officer"
        
        # 1. Setup KYC verification
        await auth_service.client.create_relationship(
            entity_type="kyc_verification",
            entity_id=verification_id,
            relation="subject",
            subject_type="user",
            subject_id=subject_id
        )
        
        await auth_service.client.create_relationship(
            entity_type="kyc_verification",
            entity_id=verification_id,
            relation="compliance_officer",
            subject_type="user",
            subject_id=officer_id
        )
        
        # 2. Officer can approve KYC
        can_approve = await auth_service.can_approve_kyc(officer_id, verification_id)
        assert can_approve is True
        
        # 3. Subject cannot approve their own KYC
        can_self_approve = await auth_service.can_approve_kyc(subject_id, verification_id)
        assert can_self_approve is False
    
    @pytest.mark.asyncio
    async def test_bulk_permission_checks(self, auth_service):
        """Test bulk permission checks"""
        user_id = "user_e2e_bulk"
        
        # Setup multiple accounts
        accounts = ["acc_e2e_1", "acc_e2e_2", "acc_e2e_3"]
        for account_id in accounts:
            await auth_service.assign_account_owner(user_id, account_id)
        
        # Perform bulk permission checks
        checks = [
            {"entity_type": "account", "entity_id": acc_id, "permission": "view_balance"}
            for acc_id in accounts
        ]
        
        results = await auth_service.check_multiple_permissions(user_id, checks)
        
        # All should be allowed
        assert len(results) == 3
        assert all(results.values())
    
    @pytest.mark.asyncio
    async def test_role_based_access(self, policy_engine):
        """Test role-based access control"""
        user_id = "user_e2e_role"
        role_id = "org_admin"
        
        # Assign role to user
        await policy_engine.assign_role_to_user(user_id, role_id)
        
        # Check role permission
        has_permission = await policy_engine.check_role_permission(user_id, role_id, "manage_members")
        assert has_permission is True
    
    @pytest.mark.asyncio
    async def test_relationship_listing(self, client):
        """Test listing relationships"""
        user_id = "user_e2e_list"
        account_id = "acc_e2e_list"
        
        # Create relationship
        await client.create_relationship(
            entity_type="account",
            entity_id=account_id,
            relation="owner",
            subject_type="user",
            subject_id=user_id
        )
        
        # List relationships
        relationships = await client.list_relationships(
            entity_type="account",
            entity_id=account_id,
            relation="owner"
        )
        
        assert len(relationships) > 0
        assert any(r.subject_id == user_id for r in relationships)


@pytest.mark.skipif(SKIP_E2E, reason="E2E tests disabled")
class TestAuthorizationPerformance:
    """Performance tests for authorization"""
    
    @pytest.fixture
    async def client(self):
        """Create Permify client"""
        client = PermifyClient(
            base_url=PERMIFY_URL,
            tenant_id="test_tenant_perf"
        )
        yield client
        await client.close()
    
    @pytest.mark.asyncio
    async def test_permission_check_performance(self, client):
        """Test permission check performance"""
        import time
        
        user_id = "user_perf"
        account_id = "acc_perf"
        
        # Setup
        await client.create_relationship(
            entity_type="account",
            entity_id=account_id,
            relation="owner",
            subject_type="user",
            subject_id=user_id
        )
        
        # Measure performance
        iterations = 100
        start_time = time.time()
        
        for i in range(iterations):
            await client.check_permission(
                entity_type="account",
                entity_id=account_id,
                permission="view_balance",
                subject_type="user",
                subject_id=user_id
            )
        
        end_time = time.time()
        avg_time = (end_time - start_time) / iterations
        
        # Should be fast (< 100ms per check with caching)
        assert avg_time < 0.1, f"Average permission check time: {avg_time*1000:.2f}ms"

