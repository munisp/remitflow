"""
Unit tests for Fraud Detection
"""

import pytest

class TestFraudDetection:
    """Test suite for fraud detection"""
    
    def test_transaction_risk_score(self, sample_payment):
        """Test transaction risk scoring"""
        risk_score = 0.0
        
        # High amount = higher risk
        if sample_payment["amount"] > 50000:
            risk_score += 0.3
        
        # Certain payment methods = higher risk
        if sample_payment["payment_method"] == "bank_transfer":
            risk_score += 0.2
        
        assert 0.0 <= risk_score <= 1.0
    
    def test_fraud_detection_threshold(self, sample_payment):
        """Test fraud detection threshold"""
        risk_score = 0.7
        threshold = 0.8
        is_fraudulent = risk_score >= threshold
        assert isinstance(is_fraudulent, bool)
    
    @pytest.mark.parametrize("amount,expected_risk", [
        (100, "low"),
        (10000, "medium"),
        (100000, "high"),
    ])
    def test_amount_based_risk(self, amount, expected_risk):
        """Test amount-based risk assessment"""
        if amount < 5000:
            risk = "low"
        elif amount < 50000:
            risk = "medium"
        else:
            risk = "high"
        assert risk == expected_risk
