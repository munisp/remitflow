"""
ML Service Client - Client library for calling ML service from other services
Provides fraud detection, risk scoring, anomaly detection, and churn prediction

Usage:
    from common.ml_client import MLClient
    
    client = MLClient()
    result = await client.predict_fraud(user_id, amount, currency, destination_country)
"""

import os
import logging
import httpx
from typing import Dict, Any, Optional, List
from datetime import datetime
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)

# Configuration
ML_SERVICE_URL = os.getenv("ML_SERVICE_URL", "http://localhost:8025")
ML_SERVICE_TIMEOUT = float(os.getenv("ML_SERVICE_TIMEOUT", "5.0"))
USE_ML_SERVICE = os.getenv("USE_ML_SERVICE", "true").lower() == "true"
FAIL_CLOSED_ON_ML_UNAVAILABLE = os.getenv("FAIL_CLOSED_ON_ML_UNAVAILABLE", "false").lower() == "true"


class MLDecision(str, Enum):
    ALLOW = "allow"
    REVIEW = "review"
    BLOCK = "block"


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


@dataclass
class FraudPrediction:
    """Result of fraud prediction"""
    user_id: str
    prediction: str  # "fraud", "review", "legitimate"
    fraud_probability: float
    decision: MLDecision
    risk_factors: Dict[str, float]
    model_name: str
    model_version: str
    latency_ms: float


@dataclass
class RiskPrediction:
    """Result of risk scoring"""
    user_id: str
    risk_score: float  # 0-100
    risk_level: RiskLevel
    model_name: str
    model_version: str
    latency_ms: float


@dataclass
class AnomalyPrediction:
    """Result of anomaly detection"""
    user_id: str
    is_anomaly: bool
    anomaly_score: float
    model_name: str
    model_version: str
    latency_ms: float


@dataclass
class ChurnPrediction:
    """Result of churn prediction"""
    user_id: str
    churn_probability: float
    churn_risk_level: RiskLevel
    will_churn: bool
    model_name: str
    model_version: str
    latency_ms: float


class MLServiceUnavailable(Exception):
    """Raised when ML service is unavailable"""
    pass


class MLClient:
    """Client for ML service"""
    
    def __init__(self, base_url: str = None, timeout: float = None):
        self.base_url = base_url or ML_SERVICE_URL
        self.timeout = timeout or ML_SERVICE_TIMEOUT
        self._client = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client"""
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout
            )
        return self._client
    
    async def close(self):
        """Close the HTTP client"""
        if self._client:
            await self._client.aclose()
            self._client = None
    
    async def health_check(self) -> bool:
        """Check if ML service is healthy"""
        try:
            client = await self._get_client()
            response = await client.get("/health")
            return response.status_code == 200
        except Exception as e:
            logger.warning(f"ML service health check failed: {e}")
            return False
    
    async def predict_fraud(
        self,
        user_id: str,
        amount: float,
        currency: str = "NGN",
        destination_country: str = "NG",
        is_new_beneficiary: bool = False,
        is_new_device: bool = False
    ) -> FraudPrediction:
        """
        Get fraud prediction for a transaction.
        
        Args:
            user_id: User ID
            amount: Transaction amount
            currency: Currency code
            destination_country: Destination country code
            is_new_beneficiary: Whether this is a new beneficiary
            is_new_device: Whether this is a new device
            
        Returns:
            FraudPrediction with decision and risk factors
            
        Raises:
            MLServiceUnavailable: If ML service is unavailable and FAIL_CLOSED_ON_ML_UNAVAILABLE is True
        """
        if not USE_ML_SERVICE:
            logger.info("ML service disabled, returning default allow decision")
            return FraudPrediction(
                user_id=user_id,
                prediction="legitimate",
                fraud_probability=0.0,
                decision=MLDecision.ALLOW,
                risk_factors={},
                model_name="disabled",
                model_version="0.0.0",
                latency_ms=0.0
            )
        
        try:
            client = await self._get_client()
            response = await client.post(
                "/predict/fraud",
                params={
                    "user_id": user_id,
                    "amount": amount,
                    "currency": currency,
                    "destination_country": destination_country,
                    "is_new_beneficiary": is_new_beneficiary,
                    "is_new_device": is_new_device
                }
            )
            
            if response.status_code != 200:
                raise MLServiceUnavailable(f"ML service returned {response.status_code}")
            
            data = response.json()
            
            # Map prediction to decision
            prediction = data.get("prediction", "legitimate")
            if prediction == "fraud":
                decision = MLDecision.BLOCK
            elif prediction == "review":
                decision = MLDecision.REVIEW
            else:
                decision = MLDecision.ALLOW
            
            return FraudPrediction(
                user_id=user_id,
                prediction=prediction,
                fraud_probability=data.get("fraud_probability", 0.0),
                decision=decision,
                risk_factors=data.get("risk_factors", {}),
                model_name=data.get("model_name", "unknown"),
                model_version=data.get("model_version", "unknown"),
                latency_ms=data.get("latency_ms", 0.0)
            )
            
        except httpx.RequestError as e:
            logger.error(f"ML service request failed: {e}")
            if FAIL_CLOSED_ON_ML_UNAVAILABLE:
                raise MLServiceUnavailable(f"ML service unavailable: {e}")
            
            # Fail open - return default allow
            logger.warning("ML service unavailable, failing open with default allow")
            return FraudPrediction(
                user_id=user_id,
                prediction="legitimate",
                fraud_probability=0.0,
                decision=MLDecision.ALLOW,
                risk_factors={},
                model_name="fallback",
                model_version="0.0.0",
                latency_ms=0.0
            )
    
    async def predict_risk(
        self,
        user_id: str,
        amount: float,
        currency: str = "NGN",
        destination_country: str = "NG"
    ) -> RiskPrediction:
        """
        Get risk score for a transaction.
        
        Returns:
            RiskPrediction with score (0-100) and risk level
        """
        if not USE_ML_SERVICE:
            return RiskPrediction(
                user_id=user_id,
                risk_score=20.0,
                risk_level=RiskLevel.LOW,
                model_name="disabled",
                model_version="0.0.0",
                latency_ms=0.0
            )
        
        try:
            client = await self._get_client()
            response = await client.post(
                "/predict/risk",
                params={
                    "user_id": user_id,
                    "amount": amount,
                    "currency": currency,
                    "destination_country": destination_country
                }
            )
            
            if response.status_code != 200:
                raise MLServiceUnavailable(f"ML service returned {response.status_code}")
            
            data = response.json()
            
            risk_level_str = data.get("risk_level", "low")
            risk_level = RiskLevel(risk_level_str) if risk_level_str in [r.value for r in RiskLevel] else RiskLevel.LOW
            
            return RiskPrediction(
                user_id=user_id,
                risk_score=data.get("risk_score", 20.0),
                risk_level=risk_level,
                model_name=data.get("model_name", "unknown"),
                model_version=data.get("model_version", "unknown"),
                latency_ms=data.get("latency_ms", 0.0)
            )
            
        except httpx.RequestError as e:
            logger.error(f"ML service request failed: {e}")
            if FAIL_CLOSED_ON_ML_UNAVAILABLE:
                raise MLServiceUnavailable(f"ML service unavailable: {e}")
            
            return RiskPrediction(
                user_id=user_id,
                risk_score=20.0,
                risk_level=RiskLevel.LOW,
                model_name="fallback",
                model_version="0.0.0",
                latency_ms=0.0
            )
    
    async def predict_anomaly(
        self,
        user_id: str,
        amount: float,
        currency: str = "NGN"
    ) -> AnomalyPrediction:
        """
        Detect anomalies in transaction patterns.
        
        Returns:
            AnomalyPrediction with anomaly flag and score
        """
        if not USE_ML_SERVICE:
            return AnomalyPrediction(
                user_id=user_id,
                is_anomaly=False,
                anomaly_score=0.0,
                model_name="disabled",
                model_version="0.0.0",
                latency_ms=0.0
            )
        
        try:
            client = await self._get_client()
            response = await client.post(
                "/predict/anomaly",
                params={
                    "user_id": user_id,
                    "amount": amount,
                    "currency": currency
                }
            )
            
            if response.status_code != 200:
                raise MLServiceUnavailable(f"ML service returned {response.status_code}")
            
            data = response.json()
            
            return AnomalyPrediction(
                user_id=user_id,
                is_anomaly=data.get("is_anomaly", False),
                anomaly_score=data.get("anomaly_score", 0.0),
                model_name=data.get("model_name", "unknown"),
                model_version=data.get("model_version", "unknown"),
                latency_ms=data.get("latency_ms", 0.0)
            )
            
        except httpx.RequestError as e:
            logger.error(f"ML service request failed: {e}")
            if FAIL_CLOSED_ON_ML_UNAVAILABLE:
                raise MLServiceUnavailable(f"ML service unavailable: {e}")
            
            return AnomalyPrediction(
                user_id=user_id,
                is_anomaly=False,
                anomaly_score=0.0,
                model_name="fallback",
                model_version="0.0.0",
                latency_ms=0.0
            )
    
    async def predict_churn(self, user_id: str) -> ChurnPrediction:
        """
        Predict churn probability for a user.
        
        Returns:
            ChurnPrediction with probability and risk level
        """
        if not USE_ML_SERVICE:
            return ChurnPrediction(
                user_id=user_id,
                churn_probability=0.1,
                churn_risk_level=RiskLevel.LOW,
                will_churn=False,
                model_name="disabled",
                model_version="0.0.0",
                latency_ms=0.0
            )
        
        try:
            client = await self._get_client()
            response = await client.post(
                "/predict/churn",
                params={"user_id": user_id}
            )
            
            if response.status_code != 200:
                raise MLServiceUnavailable(f"ML service returned {response.status_code}")
            
            data = response.json()
            
            risk_level_str = data.get("churn_risk_level", "low")
            risk_level = RiskLevel(risk_level_str) if risk_level_str in [r.value for r in RiskLevel] else RiskLevel.LOW
            
            return ChurnPrediction(
                user_id=user_id,
                churn_probability=data.get("churn_probability", 0.1),
                churn_risk_level=risk_level,
                will_churn=data.get("will_churn", False),
                model_name=data.get("model_name", "unknown"),
                model_version=data.get("model_version", "unknown"),
                latency_ms=data.get("latency_ms", 0.0)
            )
            
        except httpx.RequestError as e:
            logger.error(f"ML service request failed: {e}")
            if FAIL_CLOSED_ON_ML_UNAVAILABLE:
                raise MLServiceUnavailable(f"ML service unavailable: {e}")
            
            return ChurnPrediction(
                user_id=user_id,
                churn_probability=0.1,
                churn_risk_level=RiskLevel.LOW,
                will_churn=False,
                model_name="fallback",
                model_version="0.0.0",
                latency_ms=0.0
            )
    
    async def get_models(self) -> List[Dict[str, Any]]:
        """Get list of available models"""
        try:
            client = await self._get_client()
            response = await client.get("/models")
            
            if response.status_code != 200:
                return []
            
            return response.json()
            
        except Exception as e:
            logger.error(f"Failed to get models: {e}")
            return []


# Global client instance
_ml_client = None


def get_ml_client() -> MLClient:
    """Get the global ML client instance"""
    global _ml_client
    if _ml_client is None:
        _ml_client = MLClient()
    return _ml_client


async def predict_fraud_for_transaction(
    user_id: str,
    amount: float,
    currency: str = "NGN",
    destination_country: str = "NG",
    is_new_beneficiary: bool = False,
    is_new_device: bool = False
) -> FraudPrediction:
    """
    Convenience function for fraud prediction.
    Use this in transaction flows.
    """
    client = get_ml_client()
    return await client.predict_fraud(
        user_id=user_id,
        amount=amount,
        currency=currency,
        destination_country=destination_country,
        is_new_beneficiary=is_new_beneficiary,
        is_new_device=is_new_device
    )


async def predict_risk_for_transaction(
    user_id: str,
    amount: float,
    currency: str = "NGN",
    destination_country: str = "NG"
) -> RiskPrediction:
    """
    Convenience function for risk scoring.
    Use this in transaction flows.
    """
    client = get_ml_client()
    return await client.predict_risk(
        user_id=user_id,
        amount=amount,
        currency=currency,
        destination_country=destination_country
    )
