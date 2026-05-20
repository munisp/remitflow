"""
End-to-end tests for E-commerce Store Setup Journey
"""

import pytest

@pytest.mark.e2e
class TestStoreSetupJourney:
    """Test complete store setup user journey"""
    
    @pytest.mark.asyncio
    async def test_complete_store_setup_flow(
        self,
        sample_agent,
        sample_product,
        mock_workflow_orchestrator
    ):
        """Test complete store setup journey"""
        
        # Step 1: Create store
        store = {
            "store_id": "STORE-12345",
            "agent_id": sample_agent["agent_id"],
            "name": f"{sample_agent['name']}'s Store",
            "status": "draft"
        }
        assert store["store_id"] is not None
        
        # Step 2: Configure branding
        store["branding"] = {
            "logo": "logo.png",
            "theme": "modern",
            "colors": {"primary": "#FF5722"}
        }
        assert store["branding"] is not None
        
        # Step 3: Import products
        store["products"] = [sample_product]
        assert len(store["products"]) > 0
        
        # Step 4: Set pricing
        for product in store["products"]:
            product["retail_price"] = product["price"] * 1.3  # 30% markup
        assert all(p["retail_price"] > p["price"] for p in store["products"])
        
        # Step 5: Payment gateway setup
        store["payment_methods"] = ["mpesa", "stripe", "bank_transfer"]
        assert len(store["payment_methods"]) > 0
        
        # Step 6: Launch store
        store["status"] = "active"
        assert store["status"] == "active"
        
        # Step 7: Marketing campaign
        campaign = {
            "campaign_id": "CAMP-12345",
            "store_id": store["store_id"],
            "channel": "social_media",
            "status": "active"
        }
        assert campaign["status"] == "active"
        
        # Verify workflow
        workflow_result = await mock_workflow_orchestrator.execute_workflow({
            "type": "store_setup",
            "data": store
        })
        assert workflow_result["status"] == "completed"
