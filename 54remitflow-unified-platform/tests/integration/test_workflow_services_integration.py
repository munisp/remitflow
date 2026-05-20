"""
Integration tests for Workflow Orchestration + Services
"""

import pytest
from unittest.mock import AsyncMock

@pytest.mark.integration
class TestWorkflowServicesIntegration:
    """Test integration between workflow orchestrator and services"""
    
    @pytest.mark.asyncio
    async def test_procurement_workflow_integration(
        self, 
        mock_workflow_orchestrator,
        sample_product,
        sample_payment
    ):
        """Test procurement workflow with all services"""
        workflow_data = {
            "workflow_type": "procurement",
            "products": [sample_product],
            "payment": sample_payment
        }
        
        result = await mock_workflow_orchestrator.execute_workflow(workflow_data)
        assert result["status"] == "completed"
    
    @pytest.mark.asyncio
    async def test_order_fulfillment_integration(
        self,
        mock_workflow_orchestrator,
        sample_order,
        mock_notification_service
    ):
        """Test order fulfillment with notifications"""
        workflow_data = {
            "workflow_type": "order_fulfillment",
            "order": sample_order
        }
        
        result = await mock_workflow_orchestrator.execute_workflow(workflow_data)
        
        # Verify notification sent
        await mock_notification_service.send_sms("+254712345678", "Order confirmed")
        assert result["status"] == "completed"
