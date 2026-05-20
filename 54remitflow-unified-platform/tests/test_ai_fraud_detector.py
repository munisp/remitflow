#!/usr/bin/env python3
"""
Unit Tests for AI Fraud Detector
"""

import pytest
from decimal import Decimal
from datetime import datetime, timedelta
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../services/fraud-detection/src'))

from ai_fraud_detector import AIFraudDetector, RiskLevel, FraudSignal


class TestAIFraudDetector:
    """Test suite for AI Fraud Detector"""
    
    @pytest.fixture
    def detector(self):
        """Create detector instance"""
        return AIFraudDetector()
    
    @pytest.fixture
    def clean_transaction(self):
        """Clean transaction data"""
        return {
            "transaction_id": "txn_test_001",
            "amount": 100.00,
            "currency": "USD",
            "beneficiary_id": "ben_001",
            "beneficiary_country": "NG",
            "ip_address": "192.168.1.1",
            "location": {"country": "US", "city": "New York"},
            "user_created_at": "2024-01-01T00:00:00",
            "kyc_status": "verified"
        }
    
    @pytest.fixture
    def user_history(self):
        """Normal user history"""
        return [
            {"amount": 100.00, "created_at": (datetime.utcnow() - timedelta(days=5)).isoformat(), "beneficiary_id": "ben_001"},
            {"amount": 150.00, "created_at": (datetime.utcnow() - timedelta(days=3)).isoformat(), "beneficiary_id": "ben_001"},
            {"amount": 120.00, "created_at": (datetime.utcnow() - timedelta(days=1)).isoformat(), "beneficiary_id": "ben_002"},
        ]
    
    def test_low_risk_transaction(self, detector, clean_transaction, user_history):
        """Test low-risk transaction detection"""
        result = detector.analyze_transaction(
            user_id="user_001",
            transaction_data=clean_transaction,
            user_history=user_history
        )
        
        assert result["risk_level"] == RiskLevel.LOW.value
        assert result["risk_score"] <= 30
        assert result["should_block"] is False
        assert result["requires_review"] is False
    
    def test_velocity_abuse_detection(self, detector, clean_transaction):
        """Test velocity abuse detection"""
        # Create history with many recent transactions
        recent_history = [
            {"amount": 100.00, "created_at": (datetime.utcnow() - timedelta(minutes=10)).isoformat(), "beneficiary_id": "ben_001"},
            {"amount": 100.00, "created_at": (datetime.utcnow() - timedelta(minutes=20)).isoformat(), "beneficiary_id": "ben_001"},
            {"amount": 100.00, "created_at": (datetime.utcnow() - timedelta(minutes=30)).isoformat(), "beneficiary_id": "ben_001"},
            {"amount": 100.00, "created_at": (datetime.utcnow() - timedelta(minutes=40)).isoformat(), "beneficiary_id": "ben_001"},
            {"amount": 100.00, "created_at": (datetime.utcnow() - timedelta(minutes=50)).isoformat(), "beneficiary_id": "ben_001"},
        ]
        
        result = detector.analyze_transaction(
            user_id="user_002",
            transaction_data=clean_transaction,
            user_history=recent_history
        )
        
        assert FraudSignal.VELOCITY_ABUSE.value in result["fraud_signals"]
        assert result["risk_score"] >= 15
    
    def test_amount_anomaly_detection(self, detector, user_history):
        """Test amount anomaly detection"""
        # Transaction 10x larger than average
        large_transaction = {
            "transaction_id": "txn_large",
            "amount": 5000.00,  # 10x normal
            "currency": "USD",
            "beneficiary_id": "ben_001",
            "beneficiary_country": "NG",
            "ip_address": "192.168.1.1",
            "location": {"country": "US", "city": "New York"},
            "user_created_at": "2024-01-01T00:00:00",
            "kyc_status": "verified"
        }
        
        result = detector.analyze_transaction(
            user_id="user_003",
            transaction_data=large_transaction,
            user_history=user_history
        )
        
        assert FraudSignal.AMOUNT_ANOMALY.value in result["fraud_signals"]
        assert result["risk_score"] >= 10
    
    def test_location_mismatch_detection(self, detector, clean_transaction, user_history):
        """Test location mismatch detection"""
        # Transaction from different country
        different_location_txn = clean_transaction.copy()
        different_location_txn["location"] = {"country": "CN", "city": "Beijing"}
        
        # Set up user pattern with US location
        detector.user_patterns["user_004"] = {
            "typical_location": {"country": "US", "city": "New York"}
        }
        
        result = detector.analyze_transaction(
            user_id="user_004",
            transaction_data=different_location_txn,
            user_history=user_history
        )
        
        assert FraudSignal.LOCATION_MISMATCH.value in result["fraud_signals"]
        assert result["risk_score"] >= 10
    
    def test_new_device_detection(self, detector, clean_transaction, user_history):
        """Test new device detection"""
        # First transaction - new device
        device_info = {
            "user_agent": "Mozilla/5.0...",
            "screen_resolution": "1920x1080",
            "timezone": "America/New_York",
            "language": "en-US",
            "platform": "MacIntel"
        }
        
        # Set up known devices for user
        detector.device_fingerprints["user_005"] = {"known_fingerprint_123"}
        
        result = detector.analyze_transaction(
            user_id="user_005",
            transaction_data=clean_transaction,
            user_history=user_history,
            device_info=device_info
        )
        
        assert FraudSignal.DEVICE_FINGERPRINT.value in result["fraud_signals"]
        assert result["risk_score"] >= 10
    
    def test_incomplete_kyc_detection(self, detector, user_history):
        """Test incomplete KYC detection"""
        unverified_txn = {
            "transaction_id": "txn_unverified",
            "amount": 100.00,
            "currency": "USD",
            "beneficiary_id": "ben_001",
            "beneficiary_country": "NG",
            "ip_address": "192.168.1.1",
            "location": {"country": "US", "city": "New York"},
            "user_created_at": "2024-01-01T00:00:00",
            "kyc_status": "pending"
        }
        
        result = detector.analyze_transaction(
            user_id="user_006",
            transaction_data=unverified_txn,
            user_history=user_history
        )
        
        assert FraudSignal.KYC_INCOMPLETE.value in result["fraud_signals"]
        assert result["risk_score"] >= 3
    
    def test_new_account_detection(self, detector, clean_transaction, user_history):
        """Test new account detection"""
        new_account_txn = clean_transaction.copy()
        new_account_txn["user_created_at"] = (datetime.utcnow() - timedelta(days=3)).isoformat()
        
        result = detector.analyze_transaction(
            user_id="user_007",
            transaction_data=new_account_txn,
            user_history=[]
        )
        
        assert FraudSignal.ACCOUNT_AGE.value in result["fraud_signals"]
    
    def test_critical_risk_blocking(self, detector):
        """Test that critical risk transactions are blocked"""
        # Create high-risk transaction
        high_risk_txn = {
            "transaction_id": "txn_highrisk",
            "amount": 10000.00,  # Large amount
            "currency": "USD",
            "beneficiary_id": "ben_new",
            "beneficiary_country": "NG",
            "ip_address": "192.168.1.1",
            "location": {"country": "CN", "city": "Beijing"},  # Different location
            "user_created_at": (datetime.utcnow() - timedelta(days=2)).isoformat(),  # New account
            "kyc_status": "pending"  # Unverified
        }
        
        # Recent velocity abuse
        recent_history = [
            {"amount": 1000.00, "created_at": (datetime.utcnow() - timedelta(minutes=10)).isoformat(), "beneficiary_id": "ben_001"},
            {"amount": 1000.00, "created_at": (datetime.utcnow() - timedelta(minutes=20)).isoformat(), "beneficiary_id": "ben_002"},
            {"amount": 1000.00, "created_at": (datetime.utcnow() - timedelta(minutes=30)).isoformat(), "beneficiary_id": "ben_003"},
            {"amount": 1000.00, "created_at": (datetime.utcnow() - timedelta(minutes=40)).isoformat(), "beneficiary_id": "ben_004"},
            {"amount": 1000.00, "created_at": (datetime.utcnow() - timedelta(minutes=50)).isoformat(), "beneficiary_id": "ben_005"},
        ]
        
        result = detector.analyze_transaction(
            user_id="user_highrisk",
            transaction_data=high_risk_txn,
            user_history=recent_history
        )
        
        # Should have multiple fraud signals
        assert len(result["fraud_signals"]) >= 3
        
        # Should be high or critical risk
        assert result["risk_level"] in [RiskLevel.HIGH.value, RiskLevel.CRITICAL.value]
        
        # Should require review or be blocked
        assert result["requires_review"] is True or result["should_block"] is True
    
    def test_medium_risk_requires_2fa(self, detector, user_history):
        """Test that medium risk requires 2FA"""
        medium_risk_txn = {
            "transaction_id": "txn_medium",
            "amount": 500.00,  # Slightly higher than normal
            "currency": "USD",
            "beneficiary_id": "ben_new",  # New beneficiary
            "beneficiary_country": "NG",
            "ip_address": "192.168.1.1",
            "location": {"country": "US", "city": "New York"},
            "user_created_at": "2024-01-01T00:00:00",
            "kyc_status": "verified"
        }
        
        result = detector.analyze_transaction(
            user_id="user_medium",
            transaction_data=medium_risk_txn,
            user_history=user_history
        )
        
        if result["risk_level"] == RiskLevel.MEDIUM.value:
            assert result["requires_2fa"] is True
    
    def test_confidence_calculation(self, detector, clean_transaction, user_history):
        """Test confidence score calculation"""
        result = detector.analyze_transaction(
            user_id="user_conf",
            transaction_data=clean_transaction,
            user_history=user_history
        )
        
        assert "confidence" in result
        assert 0.0 <= result["confidence"] <= 1.0
    
    def test_recommendation_generation(self, detector, clean_transaction, user_history):
        """Test recommendation generation"""
        result = detector.analyze_transaction(
            user_id="user_rec",
            transaction_data=clean_transaction,
            user_history=user_history
        )
        
        assert "recommendation" in result
        assert "action" in result["recommendation"]
        assert "message" in result["recommendation"]
        
        # Action should be one of the valid actions
        valid_actions = ["approve", "approve_with_2fa", "manual_review", "block"]
        assert result["recommendation"]["action"] in valid_actions


class TestFraudDetectorIntegration:
    """Integration tests for fraud detector"""
    
    @pytest.fixture
    def detector(self):
        return AIFraudDetector()
    
    def test_end_to_end_fraud_detection(self, detector):
        """Test complete fraud detection flow"""
        # Simulate real-world scenario
        user_id = "user_e2e"
        
        # User's transaction history
        history = [
            {"amount": 100.00, "created_at": (datetime.utcnow() - timedelta(days=30)).isoformat(), "beneficiary_id": "ben_001"},
            {"amount": 150.00, "created_at": (datetime.utcnow() - timedelta(days=20)).isoformat(), "beneficiary_id": "ben_001"},
            {"amount": 120.00, "created_at": (datetime.utcnow() - timedelta(days=10)).isoformat(), "beneficiary_id": "ben_002"},
        ]
        
        # New transaction
        transaction = {
            "transaction_id": "txn_e2e",
            "amount": 200.00,
            "currency": "USD",
            "beneficiary_id": "ben_001",
            "beneficiary_country": "NG",
            "ip_address": "192.168.1.1",
            "location": {"country": "US", "city": "New York"},
            "user_created_at": "2024-01-01T00:00:00",
            "kyc_status": "verified"
        }
        
        device_info = {
            "user_agent": "Mozilla/5.0...",
            "screen_resolution": "1920x1080",
            "timezone": "America/New_York",
            "language": "en-US",
            "platform": "MacIntel"
        }
        
        # Analyze
        result = detector.analyze_transaction(
            user_id,
            transaction,
            history,
            device_info
        )
        
        # Verify result structure
        assert "transaction_id" in result
        assert "risk_score" in result
        assert "risk_level" in result
        assert "fraud_signals" in result
        assert "recommendation" in result
        
        # Result should be actionable
        assert "should_block" in result
        assert "requires_2fa" in result
        assert "requires_review" in result


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])

