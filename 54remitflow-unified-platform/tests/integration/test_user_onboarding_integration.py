"""
Integration tests for UserOnboarding
Tests service-to-service communication and data flow
"""
import pytest
import asyncio
from decimal import Decimal
from datetime import datetime
import httpx

@pytest.mark.integration
class TestUserOnboardingIntegration:
    """Integration tests for user registration and KYC."""
    
    @pytest.fixture
    async def test_client(self):
        """Create test HTTP client."""
        async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
            yield client
    
    @pytest.fixture
    def test_user(self):
        """Create test user data."""
        return {
            "user_id": "test_user_123",
            "email": "test@example.com",
            "phone": "+1234567890",
            "kyc_status": "verified"
        }
    
    @pytest.mark.asyncio
    async def test_user_onboarding_end_to_end_flow(self, test_client, test_user):
        """Test complete user registration and KYC flow."""
        # Step 1: Register user
        response1 = await test_client.post(
            "/users/register",
            json={"user_id": test_user["user_id"]}
        )
        assert response1.status_code == 200
        data1 = response1.json()
        
        # Step 2: Verify identity
        response2 = await test_client.post(
            "/users/kyc",
            json={
                "user_id": test_user["user_id"],
                "data": data1
            }
        )
        assert response2.status_code == 200
        data2 = response2.json()
        
        # Step 3: Activate account
        response3 = await test_client.get(
            f"/users/activate/{data2['id']}"
        )
        assert response3.status_code == 200
        final_data = response3.json()
        
        # Verify end-to-end flow
        assert final_data["status"] == "success"
        assert final_data["user_id"] == test_user["user_id"]
    
    @pytest.mark.asyncio
    async def test_user_onboarding_service_communication(self, test_client):
        """Test communication between services."""
        # Test service A -> service B communication
        response = await test_client.post(
            "/api/v1/users/register",
            json={"test": "data"}
        )
        assert response.status_code in [200, 201]
        
        # Verify service B received the data
        result = response.json()
        assert "id" in result
        assert result["status"] in ["pending", "completed"]
    
    @pytest.mark.asyncio
    async def test_user_onboarding_database_integration(self, test_client, test_user):
        """Test database operations integration."""
        # Create record
        create_response = await test_client.post(
            "/users/register",
            json=test_user
        )
        assert create_response.status_code == 201
        created_id = create_response.json()["id"]
        
        # Read record
        read_response = await test_client.get(f"/users/register/{created_id}")
        assert read_response.status_code == 200
        assert read_response.json()["user_id"] == test_user["user_id"]
        
        # Update record
        update_response = await test_client.put(
            f"/users/register/{created_id}",
            json={"kyc_status": "enhanced"}
        )
        assert update_response.status_code == 200
        
        # Delete record
        delete_response = await test_client.delete(f"/users/register/{created_id}")
        assert delete_response.status_code == 204
    
    @pytest.mark.asyncio
    async def test_user_onboarding_error_handling(self, test_client):
        """Test error handling across services."""
        # Test invalid input
        response = await test_client.post(
            "/users/register",
            json={"invalid": "data"}
        )
        assert response.status_code in [400, 422]
        error = response.json()
        assert "error" in error or "detail" in error
    
    @pytest.mark.asyncio
    async def test_user_onboarding_transaction_rollback(self, test_client, test_user):
        """Test transaction rollback on failure."""
        # Start transaction that will fail
        response = await test_client.post(
            "/users/register/transaction",
            json={
                "user_id": test_user["user_id"],
                "amount": Decimal("-100.00")  # Invalid amount
            }
        )
        
        # Verify transaction was rolled back
        assert response.status_code == 400
        
        # Verify no partial data was saved
        check_response = await test_client.get(
            f"/users/register/transactions?user_id={test_user['user_id']}"
        )
        assert len(check_response.json()) == 0
    
    @pytest.mark.asyncio
    async def test_user_onboarding_concurrent_requests(self, test_client, test_user):
        """Test handling concurrent requests."""
        # Send multiple concurrent requests
        tasks = [
            test_client.post("/users/register", json=test_user)
            for _ in range(10)
        ]
        responses = await asyncio.gather(*tasks)
        
        # Verify all requests succeeded
        assert all(r.status_code in [200, 201] for r in responses)
        
        # Verify data consistency
        ids = [r.json()["id"] for r in responses]
        assert len(set(ids)) == 10  # All unique IDs
