"""
Unit tests for Compliance Service
Tests screening, monitoring rules, alerts, cases, and SARs
"""

import pytest
from fastapi.testclient import TestClient
from datetime import datetime, timedelta
from decimal import Decimal
import uuid

# Import the app for testing
from main import app, RiskLevel, AlertStatus, CaseStatus, SARStatus, ScreeningType

client = TestClient(app)


class TestHealthCheck:
    """Test health check endpoint"""
    
    def test_health_check(self):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "compliance"


class TestScreening:
    """Test sanctions and PEP screening"""
    
    def test_perform_screening_clear(self):
        """Test screening with no matches"""
        response = client.post("/screening/check", json={
            "entity_id": "user-123",
            "entity_type": "individual",
            "full_name": "John Smith",
            "nationality": "US",
            "country": "US",
            "screening_types": ["sanctions", "pep"]
        })
        assert response.status_code == 200
        data = response.json()
        assert data["is_clear"] is True
        assert data["overall_risk"] == "low"
        assert len(data["matches"]) == 0
    
    def test_perform_screening_with_match(self):
        """Test screening that finds a match"""
        response = client.post("/screening/check", json={
            "entity_id": "user-456",
            "entity_type": "individual",
            "full_name": "Test Sanctioned Person",
            "nationality": "IR",
            "country": "IR",
            "screening_types": ["sanctions"]
        })
        assert response.status_code == 200
        data = response.json()
        assert data["is_clear"] is False
        assert len(data["matches"]) > 0
        assert data["overall_risk"] in ["medium", "high", "critical"]
    
    def test_get_screening_result(self):
        """Test retrieving screening result"""
        # First create a screening
        create_response = client.post("/screening/check", json={
            "entity_id": "user-789",
            "entity_type": "individual",
            "full_name": "Jane Doe",
            "screening_types": ["sanctions", "pep"]
        })
        result_id = create_response.json()["id"]
        
        # Then retrieve it
        response = client.get(f"/screening/results/{result_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == result_id
    
    def test_get_screening_result_not_found(self):
        """Test retrieving non-existent screening result"""
        response = client.get("/screening/results/non-existent-id")
        assert response.status_code == 404


class TestMonitoringRules:
    """Test transaction monitoring rules"""
    
    def test_list_monitoring_rules(self):
        """Test listing monitoring rules"""
        response = client.get("/monitoring/rules")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # Default rules should be present
        assert len(data) > 0
    
    def test_create_monitoring_rule(self):
        """Test creating a new monitoring rule"""
        response = client.post("/monitoring/rules", params={
            "name": "Test Rule",
            "description": "A test monitoring rule",
            "rule_type": "threshold",
            "conditions": {"amount_threshold": 5000},
            "risk_score": 25
        })
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Test Rule"
        assert data["risk_score"] == 25
        assert data["is_active"] is True
    
    def test_update_monitoring_rule(self):
        """Test updating a monitoring rule"""
        # First create a rule
        create_response = client.post("/monitoring/rules", params={
            "name": "Rule to Update",
            "description": "Will be updated",
            "rule_type": "threshold",
            "conditions": {"amount_threshold": 1000},
            "risk_score": 10
        })
        rule_id = create_response.json()["id"]
        
        # Update it
        response = client.put(f"/monitoring/rules/{rule_id}", params={
            "risk_score": 50,
            "is_active": False
        })
        assert response.status_code == 200
        data = response.json()
        assert data["risk_score"] == 50
        assert data["is_active"] is False


class TestTransactionAnalysis:
    """Test transaction monitoring and analysis"""
    
    def test_analyze_low_risk_transaction(self):
        """Test analyzing a low-risk transaction"""
        response = client.post("/monitoring/analyze", params={
            "transaction_id": f"txn-{uuid.uuid4()}",
            "user_id": "user-001",
            "amount": 100,
            "currency": "USD",
            "source_country": "US",
            "destination_country": "US",
            "transaction_type": "transfer"
        })
        assert response.status_code == 200
        data = response.json()
        assert "risk_level" in data
        assert "total_risk_score" in data
    
    def test_analyze_high_value_transaction(self):
        """Test analyzing a high-value transaction that triggers rules"""
        response = client.post("/monitoring/analyze", params={
            "transaction_id": f"txn-{uuid.uuid4()}",
            "user_id": "user-002",
            "amount": 50000,
            "currency": "USD",
            "source_country": "US",
            "destination_country": "US",
            "transaction_type": "transfer"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["total_risk_score"] > 0
        assert len(data["triggered_rules"]) > 0
    
    def test_analyze_high_risk_country_transaction(self):
        """Test analyzing a transaction to high-risk country"""
        response = client.post("/monitoring/analyze", params={
            "transaction_id": f"txn-{uuid.uuid4()}",
            "user_id": "user-003",
            "amount": 1000,
            "currency": "USD",
            "source_country": "US",
            "destination_country": "IR",
            "transaction_type": "transfer"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["total_risk_score"] > 0
        assert "High Risk Country" in data["triggered_rules"]


class TestAlerts:
    """Test alert management"""
    
    def test_list_alerts(self):
        """Test listing alerts"""
        response = client.get("/alerts")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
    
    def test_list_alerts_with_filters(self):
        """Test listing alerts with filters"""
        response = client.get("/alerts", params={
            "status": "open",
            "limit": 10
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) <= 10


class TestCases:
    """Test compliance case management"""
    
    def test_create_case(self):
        """Test creating a compliance case"""
        response = client.post("/cases", params={
            "subject_id": "user-case-001",
            "case_type": "suspicious_activity",
            "risk_level": "medium",
            "notes": "Initial case notes"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["subject_id"] == "user-case-001"
        assert data["case_type"] == "suspicious_activity"
        assert data["status"] == "open"
        assert "CASE-" in data["case_number"]
    
    def test_list_cases(self):
        """Test listing cases"""
        response = client.get("/cases")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
    
    def test_get_case(self):
        """Test getting case details"""
        # First create a case
        create_response = client.post("/cases", params={
            "subject_id": "user-case-002",
            "case_type": "sanctions_match"
        })
        case_id = create_response.json()["id"]
        
        # Get the case
        response = client.get(f"/cases/{case_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == case_id
    
    def test_assign_case(self):
        """Test assigning a case"""
        # Create a case
        create_response = client.post("/cases", params={
            "subject_id": "user-case-003",
            "case_type": "pep_match"
        })
        case_id = create_response.json()["id"]
        
        # Assign it
        response = client.put(f"/cases/{case_id}/assign", params={
            "assigned_to": "analyst-001"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["assigned_to"] == "analyst-001"
        assert data["status"] == "in_progress"
    
    def test_add_case_note(self):
        """Test adding a note to a case"""
        # Create a case
        create_response = client.post("/cases", params={
            "subject_id": "user-case-004",
            "case_type": "fraud"
        })
        case_id = create_response.json()["id"]
        
        # Add a note
        response = client.post(f"/cases/{case_id}/notes", params={
            "author": "analyst-001",
            "content": "Investigation update: reviewed transaction history"
        })
        assert response.status_code == 200
        data = response.json()
        assert len(data["notes"]) > 0
    
    def test_close_case(self):
        """Test closing a case"""
        # Create a case
        create_response = client.post("/cases", params={
            "subject_id": "user-case-005",
            "case_type": "false_positive"
        })
        case_id = create_response.json()["id"]
        
        # Close it
        response = client.put(f"/cases/{case_id}/close", params={
            "closure_reason": "No suspicious activity found after investigation",
            "closed_by": "analyst-001"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "closed"
        assert data["closure_reason"] is not None


class TestSARs:
    """Test Suspicious Activity Report management"""
    
    def test_create_sar(self):
        """Test creating a SAR"""
        # First create a case
        case_response = client.post("/cases", params={
            "subject_id": "user-sar-001",
            "case_type": "suspicious_activity"
        })
        case_id = case_response.json()["id"]
        
        # Create SAR
        response = client.post("/sars", params={
            "case_id": case_id,
            "subject_id": "user-sar-001",
            "subject_name": "John Suspicious",
            "suspicious_activity_date": datetime.utcnow().isoformat(),
            "activity_description": "Multiple high-value transactions to high-risk countries",
            "amount_involved": 50000,
            "currency": "USD",
            "prepared_by": "analyst-001"
        })
        assert response.status_code == 200
        data = response.json()
        assert "SAR-" in data["sar_number"]
        assert data["status"] == "draft"
    
    def test_list_sars(self):
        """Test listing SARs"""
        response = client.get("/sars")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
    
    def test_review_and_file_sar(self):
        """Test SAR review and filing workflow"""
        # Create a case
        case_response = client.post("/cases", params={
            "subject_id": "user-sar-002",
            "case_type": "suspicious_activity"
        })
        case_id = case_response.json()["id"]
        
        # Create SAR
        sar_response = client.post("/sars", params={
            "case_id": case_id,
            "subject_id": "user-sar-002",
            "subject_name": "Jane Suspicious",
            "suspicious_activity_date": datetime.utcnow().isoformat(),
            "activity_description": "Structuring transactions to avoid reporting",
            "amount_involved": 45000,
            "currency": "USD",
            "prepared_by": "analyst-001"
        })
        sar_id = sar_response.json()["id"]
        
        # Review SAR
        review_response = client.put(f"/sars/{sar_id}/review", params={
            "reviewed_by": "supervisor-001",
            "approved": True
        })
        assert review_response.status_code == 200
        assert review_response.json()["status"] == "approved"
        
        # File SAR
        file_response = client.put(f"/sars/{sar_id}/file", params={
            "approved_by": "compliance-officer-001"
        })
        assert file_response.status_code == 200
        assert file_response.json()["status"] == "filed"


class TestRiskProfile:
    """Test user risk profile"""
    
    def test_get_user_risk_profile_new_user(self):
        """Test getting risk profile for new user"""
        response = client.get("/users/new-user-001/risk-profile")
        assert response.status_code == 200
        data = response.json()
        assert data["user_id"] == "new-user-001"
        assert data["risk_score"] == 0
        assert data["risk_level"] == "low"
    
    def test_risk_profile_updates_after_alerts(self):
        """Test that risk profile updates after transaction analysis"""
        user_id = f"user-risk-{uuid.uuid4()}"
        
        # Trigger some alerts
        client.post("/monitoring/analyze", params={
            "transaction_id": f"txn-{uuid.uuid4()}",
            "user_id": user_id,
            "amount": 50000,
            "currency": "USD",
            "source_country": "US",
            "destination_country": "IR",
            "transaction_type": "transfer"
        })
        
        # Check risk profile
        response = client.get(f"/users/{user_id}/risk-profile")
        assert response.status_code == 200
        data = response.json()
        assert data["alert_count"] > 0


class TestDashboard:
    """Test compliance dashboard statistics"""
    
    def test_get_compliance_stats(self):
        """Test getting compliance statistics"""
        response = client.get("/dashboard/stats")
        assert response.status_code == 200
        data = response.json()
        
        assert "alerts" in data
        assert "cases" in data
        assert "sars" in data
        assert "rules_active" in data
        
        assert "total" in data["alerts"]
        assert "open" in data["alerts"]
        assert "by_risk_level" in data["alerts"]


class TestNameSimilarity:
    """Test name similarity calculation"""
    
    def test_exact_match(self):
        """Test exact name match"""
        from main import calculate_name_similarity
        score = calculate_name_similarity("John Smith", "John Smith")
        assert score == 1.0
    
    def test_case_insensitive_match(self):
        """Test case-insensitive matching"""
        from main import calculate_name_similarity
        score = calculate_name_similarity("JOHN SMITH", "john smith")
        assert score == 1.0
    
    def test_partial_match(self):
        """Test partial name match"""
        from main import calculate_name_similarity
        score = calculate_name_similarity("John", "John Smith")
        assert score > 0.5
    
    def test_no_match(self):
        """Test names with no similarity"""
        from main import calculate_name_similarity
        score = calculate_name_similarity("John Smith", "Jane Doe")
        assert score < 0.5


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
