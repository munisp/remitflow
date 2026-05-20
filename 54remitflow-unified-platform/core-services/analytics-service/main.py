"""
Unified Analytics Service - Production Implementation
Integrates with Lakehouse for all analytics queries
Provides reporting, customer behavior analytics, and predictive analytics
"""

from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
from enum import Enum
import logging
import os
import httpx
import numpy as np
from collections import defaultdict

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Unified Analytics Service", version="1.0.0", description="Analytics powered by Lakehouse")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# Configuration
LAKEHOUSE_URL = os.getenv("LAKEHOUSE_URL", "http://lakehouse-service:8020")


# Pydantic Models
class ReportType(str, Enum):
    TRANSACTION_SUMMARY = "transaction_summary"
    CORRIDOR_PERFORMANCE = "corridor_performance"
    USER_BEHAVIOR = "user_behavior"
    REVENUE_ANALYSIS = "revenue_analysis"
    RISK_ANALYTICS = "risk_analytics"
    RETENTION_ANALYSIS = "retention_analysis"


class CustomerProfile(BaseModel):
    user_id: str
    registration_date: Optional[str] = None
    transaction_history: Optional[List[Dict]] = None
    engagement_metrics: Optional[Dict] = None


class ChurnPrediction(BaseModel):
    user_id: str
    churn_probability: float
    churn_risk: str
    risk_factors: List[str]
    recommended_interventions: List[str]
    predicted_churn_date: Optional[str] = None
    timestamp: str


class CustomerSegment(BaseModel):
    segment_id: str
    segment_name: str
    characteristics: Dict
    user_count: int
    avg_ltv: float
    avg_transaction_value: float


class LTVCalculation(BaseModel):
    user_id: str
    lifetime_value: float
    predicted_ltv_12m: float
    predicted_ltv_24m: float
    confidence_interval: Dict
    value_drivers: List[Dict]
    timestamp: str


class ReportRequest(BaseModel):
    report_type: ReportType
    start_date: str
    end_date: str
    filters: Optional[Dict] = None
    group_by: Optional[List[str]] = None


class DashboardMetrics(BaseModel):
    total_transactions: int
    total_volume: float
    total_volume_usd: float
    avg_transaction_value: float
    success_rate: float
    top_corridors: List[Dict]
    gateway_distribution: Dict
    timestamp: str


class LakehouseClient:
    """Client for querying the Lakehouse service"""
    
    def __init__(self, base_url: str):
        self.base_url = base_url
        self._client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(base_url=self.base_url, timeout=30.0)
        return self._client
    
    async def query(self, table: str, layer: str = "gold", filters: Optional[Dict] = None, 
                    columns: Optional[List[str]] = None, limit: int = 1000) -> Dict:
        client = await self._get_client()
        request = {"table": table, "layer": layer, "limit": limit}
        if filters:
            request["filters"] = filters
        if columns:
            request["columns"] = columns
        
        try:
            response = await client.post("/api/v1/query", json=request)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Lakehouse query error: {e}")
            return {"data": [], "row_count": 0}
    
    async def aggregate(self, table: str, metrics: List[str], dimensions: List[str],
                        filters: Optional[Dict] = None, time_range: Optional[Dict] = None) -> Dict:
        client = await self._get_client()
        request = {"table": table, "metrics": metrics, "dimensions": dimensions}
        if filters:
            request["filters"] = filters
        if time_range:
            request["time_range"] = time_range
        
        try:
            response = await client.post("/api/v1/aggregate", json=request)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Lakehouse aggregate error: {e}")
            return {"data": [], "row_count": 0}
    
    async def get_user_features(self, user_id: str) -> Dict:
        client = await self._get_client()
        try:
            response = await client.get(f"/api/v1/features/user/{user_id}")
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Lakehouse user features error: {e}")
            return {"features": {}}
    
    async def get_transaction_summary(self, start_date: str, end_date: str, corridor: Optional[str] = None) -> Dict:
        client = await self._get_client()
        params = {"start_date": start_date, "end_date": end_date}
        if corridor:
            params["corridor"] = corridor
        
        try:
            response = await client.get("/api/v1/analytics/transactions/summary", params=params)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Lakehouse transaction summary error: {e}")
            return {"summary": []}
    
    async def get_corridor_performance(self, start_date: str, end_date: str) -> Dict:
        client = await self._get_client()
        try:
            response = await client.get(
                "/api/v1/analytics/corridors/performance",
                params={"start_date": start_date, "end_date": end_date}
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Lakehouse corridor performance error: {e}")
            return {"corridors": []}
    
    async def get_user_segments(self, date: str) -> Dict:
        client = await self._get_client()
        try:
            response = await client.get("/api/v1/analytics/users/segments", params={"date": date})
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Lakehouse user segments error: {e}")
            return {"segments": []}
    
    async def get_risk_summary(self, start_date: str, end_date: str) -> Dict:
        client = await self._get_client()
        try:
            response = await client.get(
                "/api/v1/analytics/risk/summary",
                params={"start_date": start_date, "end_date": end_date}
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Lakehouse risk summary error: {e}")
            return {"risk_summary": {}}
    
    async def get_revenue_metrics(self, start_date: str, end_date: str, group_by: str = "corridor") -> Dict:
        client = await self._get_client()
        try:
            response = await client.get(
                "/api/v1/analytics/revenue/metrics",
                params={"start_date": start_date, "end_date": end_date, "group_by": group_by}
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Lakehouse revenue metrics error: {e}")
            return {"revenue": []}
    
    async def get_retention_cohorts(self, cohort_date: Optional[str] = None) -> Dict:
        client = await self._get_client()
        params = {}
        if cohort_date:
            params["cohort_date"] = cohort_date
        
        try:
            response = await client.get("/api/v1/analytics/retention/cohorts", params=params)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Lakehouse retention cohorts error: {e}")
            return {"cohorts": []}
    
    async def close(self):
        if self._client:
            await self._client.aclose()


# Initialize lakehouse client
lakehouse = LakehouseClient(LAKEHOUSE_URL)


class CustomerBehaviorEngine:
    """Customer Behavior Analytics Engine - Powered by Lakehouse"""
    
    def __init__(self, lakehouse_client: LakehouseClient):
        self.lakehouse = lakehouse_client
        self.churn_model_weights = {
            "recency": 0.30,
            "frequency": 0.25,
            "monetary": 0.20,
            "engagement": 0.15,
            "tenure": 0.10
        }
        self.segments = {
            "high_value": {"name": "High Value Customers", "ltv_multiplier": 2.5},
            "growing": {"name": "Growing Customers", "ltv_multiplier": 1.8},
            "at_risk": {"name": "At-Risk Customers", "ltv_multiplier": 0.5},
            "dormant": {"name": "Dormant Customers", "ltv_multiplier": 0.1},
            "new": {"name": "New Customers", "ltv_multiplier": 1.2}
        }
    
    async def predict_churn(self, user_id: str) -> ChurnPrediction:
        """Predict customer churn using lakehouse features"""
        
        # Get user features from lakehouse
        features_response = await self.lakehouse.get_user_features(user_id)
        features = features_response.get("features", {})
        
        # Calculate churn score from features
        days_inactive = features.get("days_since_last_transaction", 30)
        tx_count_30d = features.get("total_transactions_30d", 0)
        failed_ratio = features.get("failed_transaction_ratio", 0)
        account_age = features.get("account_age_days", 0)
        
        # Recency score (0-100, higher is better)
        recency_score = max(0, 100 - days_inactive * 2)
        
        # Frequency score
        frequency_score = min(tx_count_30d * 10, 100)
        
        # Engagement score (inverse of failed ratio)
        engagement_score = max(0, 100 - failed_ratio * 200)
        
        # Tenure score
        tenure_score = min(account_age / 3.65, 100)
        
        # Weighted churn risk score
        churn_risk_score = (
            (100 - recency_score) * self.churn_model_weights["recency"] +
            (100 - frequency_score) * self.churn_model_weights["frequency"] +
            (100 - engagement_score) * self.churn_model_weights["engagement"] +
            (100 - tenure_score) * self.churn_model_weights["tenure"]
        )
        
        churn_probability = min(churn_risk_score / 100, 1.0)
        
        # Determine risk level
        if churn_probability >= 0.7:
            churn_risk = "CRITICAL"
        elif churn_probability >= 0.5:
            churn_risk = "HIGH"
        elif churn_probability >= 0.3:
            churn_risk = "MEDIUM"
        else:
            churn_risk = "LOW"
        
        # Identify risk factors
        risk_factors = []
        if days_inactive > 30:
            risk_factors.append(f"No transaction in {days_inactive} days")
        if tx_count_30d < 2:
            risk_factors.append(f"Low transaction frequency ({tx_count_30d} in 30 days)")
        if failed_ratio > 0.1:
            risk_factors.append(f"High failed transaction ratio ({failed_ratio:.1%})")
        if account_age < 90:
            risk_factors.append("New customer (high early churn risk)")
        
        # Recommend interventions
        interventions = []
        if churn_probability >= 0.5:
            interventions.append("Send personalized retention offer")
            interventions.append("Assign to customer success team")
        if days_inactive > 30:
            interventions.append("Send re-engagement campaign")
        if failed_ratio > 0.1:
            interventions.append("Provide customer support outreach")
        
        # Predict churn date
        predicted_churn_date = None
        if churn_probability >= 0.5:
            days_to_churn = int(30 * (1 - churn_probability))
            predicted_churn_date = (datetime.utcnow() + timedelta(days=days_to_churn)).isoformat()
        
        return ChurnPrediction(
            user_id=user_id,
            churn_probability=round(churn_probability, 3),
            churn_risk=churn_risk,
            risk_factors=risk_factors if risk_factors else ["No significant risk factors"],
            recommended_interventions=interventions if interventions else ["Continue standard engagement"],
            predicted_churn_date=predicted_churn_date,
            timestamp=datetime.utcnow().isoformat()
        )
    
    async def calculate_ltv(self, user_id: str) -> LTVCalculation:
        """Calculate Customer Lifetime Value using lakehouse data"""
        
        # Get user features from lakehouse
        features_response = await self.lakehouse.get_user_features(user_id)
        features = features_response.get("features", {})
        
        total_volume = features.get("total_volume_30d_usd", 0)
        avg_tx_value = features.get("avg_transaction_value", 0)
        tx_count = features.get("total_transactions_30d", 0)
        churn_risk = features.get("churn_risk_score", 0.15)
        
        # Historical LTV (estimated from 30-day data)
        historical_ltv = total_volume * 12  # Annualized
        
        # Retention rate
        retention_rate = 1 - churn_risk
        
        # 12-month prediction
        monthly_value = total_volume
        predicted_ltv_12m = sum(monthly_value * (retention_rate ** i) for i in range(12))
        
        # 24-month prediction
        predicted_ltv_24m = sum(monthly_value * (retention_rate ** i) for i in range(24))
        
        # Confidence intervals
        confidence_interval = {
            "lower_bound": round(predicted_ltv_12m * 0.7, 2),
            "upper_bound": round(predicted_ltv_12m * 1.3, 2)
        }
        
        # Value drivers
        value_drivers = [
            {"driver": "Average Transaction Value", "contribution": avg_tx_value, "weight": 0.40},
            {"driver": "Transaction Frequency", "contribution": tx_count, "weight": 0.35},
            {"driver": "Retention Rate", "contribution": retention_rate, "weight": 0.25}
        ]
        
        return LTVCalculation(
            user_id=user_id,
            lifetime_value=round(historical_ltv, 2),
            predicted_ltv_12m=round(predicted_ltv_12m, 2),
            predicted_ltv_24m=round(predicted_ltv_24m, 2),
            confidence_interval=confidence_interval,
            value_drivers=value_drivers,
            timestamp=datetime.utcnow().isoformat()
        )
    
    async def get_segment(self, user_id: str) -> CustomerSegment:
        """Get customer segment using lakehouse data"""
        
        features_response = await self.lakehouse.get_user_features(user_id)
        features = features_response.get("features", {})
        
        days_inactive = features.get("days_since_last_transaction", 30)
        tx_count = features.get("total_transactions_30d", 0)
        avg_value = features.get("avg_transaction_value", 0)
        account_age = features.get("account_age_days", 0)
        is_high_value = features.get("is_high_value_user", False)
        
        # Determine segment
        if days_inactive > 90:
            segment_id = "dormant"
        elif days_inactive > 30 or tx_count < 2:
            segment_id = "at_risk"
        elif account_age < 90:
            segment_id = "new"
        elif is_high_value or (avg_value > 500 and tx_count > 5):
            segment_id = "high_value"
        else:
            segment_id = "growing"
        
        segment_info = self.segments[segment_id]
        
        return CustomerSegment(
            segment_id=segment_id,
            segment_name=segment_info["name"],
            characteristics={"avg_transaction_value": avg_value, "transaction_count": tx_count},
            user_count=1,
            avg_ltv=avg_value * tx_count * segment_info["ltv_multiplier"],
            avg_transaction_value=avg_value
        )


class ReportingEngine:
    """Reporting Engine - Powered by Lakehouse"""
    
    def __init__(self, lakehouse_client: LakehouseClient):
        self.lakehouse = lakehouse_client
    
    async def get_dashboard_metrics(self, start_date: str, end_date: str) -> DashboardMetrics:
        """Get real-time dashboard metrics from lakehouse"""
        
        # Get transaction summary from lakehouse
        summary = await self.lakehouse.get_transaction_summary(start_date, end_date)
        summary_data = summary.get("summary", [])
        
        # Aggregate metrics
        total_transactions = sum(d.get("sum:total_transactions", 0) for d in summary_data)
        total_volume_usd = sum(d.get("sum:total_volume_usd", 0) for d in summary_data)
        avg_success_rate = np.mean([d.get("avg:success_rate", 0.95) for d in summary_data]) if summary_data else 0.95
        
        # Get corridor performance
        corridors = await self.lakehouse.get_corridor_performance(start_date, end_date)
        corridor_data = corridors.get("corridors", [])
        
        # Top corridors by volume
        top_corridors = sorted(corridor_data, key=lambda x: x.get("sum:total_volume_usd", 0), reverse=True)[:5]
        
        # Gateway distribution (from aggregated data)
        gateway_distribution = {}
        for corridor in corridor_data:
            gateway = corridor.get("corridor", "UNKNOWN")
            gateway_distribution[gateway] = gateway_distribution.get(gateway, 0) + corridor.get("sum:total_transactions", 0)
        
        return DashboardMetrics(
            total_transactions=int(total_transactions),
            total_volume=round(total_volume_usd / 0.0013, 2),  # Convert to NGN
            total_volume_usd=round(total_volume_usd, 2),
            avg_transaction_value=round(total_volume_usd / max(total_transactions, 1), 2),
            success_rate=round(avg_success_rate, 4),
            top_corridors=[{"corridor": c.get("corridor"), "volume_usd": c.get("sum:total_volume_usd", 0)} for c in top_corridors],
            gateway_distribution=gateway_distribution,
            timestamp=datetime.utcnow().isoformat()
        )
    
    async def generate_report(self, request: ReportRequest) -> Dict:
        """Generate custom report from lakehouse data"""
        
        if request.report_type == ReportType.TRANSACTION_SUMMARY:
            return await self._transaction_summary_report(request)
        elif request.report_type == ReportType.CORRIDOR_PERFORMANCE:
            return await self._corridor_performance_report(request)
        elif request.report_type == ReportType.USER_BEHAVIOR:
            return await self._user_behavior_report(request)
        elif request.report_type == ReportType.REVENUE_ANALYSIS:
            return await self._revenue_analysis_report(request)
        elif request.report_type == ReportType.RISK_ANALYTICS:
            return await self._risk_analytics_report(request)
        elif request.report_type == ReportType.RETENTION_ANALYSIS:
            return await self._retention_analysis_report(request)
        else:
            raise HTTPException(status_code=400, detail=f"Unknown report type: {request.report_type}")
    
    async def _transaction_summary_report(self, request: ReportRequest) -> Dict:
        summary = await self.lakehouse.get_transaction_summary(request.start_date, request.end_date)
        return {
            "report_type": "transaction_summary",
            "data": summary.get("summary", []),
            "generated_at": datetime.utcnow().isoformat()
        }
    
    async def _corridor_performance_report(self, request: ReportRequest) -> Dict:
        corridors = await self.lakehouse.get_corridor_performance(request.start_date, request.end_date)
        return {
            "report_type": "corridor_performance",
            "data": corridors.get("corridors", []),
            "generated_at": datetime.utcnow().isoformat()
        }
    
    async def _user_behavior_report(self, request: ReportRequest) -> Dict:
        segments = await self.lakehouse.get_user_segments(request.end_date)
        return {
            "report_type": "user_behavior",
            "data": segments.get("segments", []),
            "generated_at": datetime.utcnow().isoformat()
        }
    
    async def _revenue_analysis_report(self, request: ReportRequest) -> Dict:
        revenue = await self.lakehouse.get_revenue_metrics(request.start_date, request.end_date)
        return {
            "report_type": "revenue_analysis",
            "data": revenue.get("revenue", []),
            "generated_at": datetime.utcnow().isoformat()
        }
    
    async def _risk_analytics_report(self, request: ReportRequest) -> Dict:
        risk = await self.lakehouse.get_risk_summary(request.start_date, request.end_date)
        return {
            "report_type": "risk_analytics",
            "data": risk.get("risk_summary", {}),
            "generated_at": datetime.utcnow().isoformat()
        }
    
    async def _retention_analysis_report(self, request: ReportRequest) -> Dict:
        cohorts = await self.lakehouse.get_retention_cohorts()
        return {
            "report_type": "retention_analysis",
            "data": cohorts.get("cohorts", []),
            "generated_at": datetime.utcnow().isoformat()
        }


class PredictiveAnalyticsEngine:
    """Predictive Analytics Engine - Powered by Lakehouse"""
    
    def __init__(self, lakehouse_client: LakehouseClient):
        self.lakehouse = lakehouse_client
    
    async def predict_transaction_success(self, transaction_id: str) -> Dict:
        """Predict transaction success probability"""
        
        features_response = await self.lakehouse.get_transaction_features(transaction_id)
        features = features_response.get("features", {})
        
        # Calculate success probability based on features
        corridor_success_rate = features.get("corridor_success_rate", 0.95)
        user_velocity = features.get("user_velocity_daily", 0)
        is_new_device = features.get("is_new_device", False)
        is_new_beneficiary = features.get("is_new_beneficiary", False)
        amount_ratio = features.get("amount_vs_user_avg_ratio", 1.0)
        
        # Base probability from corridor
        probability = corridor_success_rate
        
        # Adjust for risk factors
        if is_new_device:
            probability *= 0.95
        if is_new_beneficiary:
            probability *= 0.98
        if amount_ratio > 3:
            probability *= 0.90
        if user_velocity > 10:
            probability *= 0.85
        
        # Determine risk level
        if probability >= 0.9:
            risk_level = "low"
        elif probability >= 0.7:
            risk_level = "medium"
        else:
            risk_level = "high"
        
        return {
            "transaction_id": transaction_id,
            "success_probability": round(probability, 3),
            "risk_level": risk_level,
            "risk_factors": {
                "is_new_device": is_new_device,
                "is_new_beneficiary": is_new_beneficiary,
                "high_amount_ratio": amount_ratio > 3,
                "high_velocity": user_velocity > 10
            },
            "timestamp": datetime.utcnow().isoformat()
        }
    
    async def forecast_revenue(self, days: int = 30) -> Dict:
        """Forecast revenue for next N days"""
        
        # Get historical revenue data
        end_date = datetime.utcnow().strftime("%Y-%m-%d")
        start_date = (datetime.utcnow() - timedelta(days=90)).strftime("%Y-%m-%d")
        
        revenue_data = await self.lakehouse.get_revenue_metrics(start_date, end_date, group_by="date")
        historical = revenue_data.get("revenue", [])
        
        if not historical:
            return {"forecast": [], "summary": {}}
        
        # Simple moving average forecast
        recent_revenue = [d.get("sum:total_revenue", 0) for d in historical[-30:]]
        avg_daily = np.mean(recent_revenue) if recent_revenue else 0
        std_daily = np.std(recent_revenue) if recent_revenue else 0
        
        # Generate forecast
        forecast = []
        for i in range(days):
            date = (datetime.utcnow() + timedelta(days=i+1)).strftime("%Y-%m-%d")
            predicted = avg_daily * (1 + np.random.normal(0, 0.1))  # Add some variance
            
            forecast.append({
                "date": date,
                "predicted_revenue": round(predicted, 2),
                "lower_bound": round(max(0, predicted - 1.96 * std_daily), 2),
                "upper_bound": round(predicted + 1.96 * std_daily, 2)
            })
        
        return {
            "forecast": forecast,
            "summary": {
                "total_forecast": round(sum(f["predicted_revenue"] for f in forecast), 2),
                "avg_daily_revenue": round(avg_daily, 2),
                "periods": days
            },
            "timestamp": datetime.utcnow().isoformat()
        }
    
    async def detect_anomalies(self, metric: str = "transaction_volume", days: int = 7) -> Dict:
        """Detect anomalies in business metrics"""
        
        end_date = datetime.utcnow().strftime("%Y-%m-%d")
        start_date = (datetime.utcnow() - timedelta(days=90)).strftime("%Y-%m-%d")
        
        # Get historical data
        summary = await self.lakehouse.get_transaction_summary(start_date, end_date)
        data = summary.get("summary", [])
        
        if not data:
            return {"anomalies": [], "total_data_points": 0}
        
        # Calculate rolling statistics
        values = [d.get("sum:total_volume_usd", 0) for d in data]
        mean = np.mean(values)
        std = np.std(values)
        
        # Detect anomalies (values beyond 2 standard deviations)
        anomalies = []
        for i, d in enumerate(data):
            value = d.get("sum:total_volume_usd", 0)
            z_score = (value - mean) / (std + 1e-6)
            
            if abs(z_score) > 2:
                anomalies.append({
                    "date": d.get("date", f"day_{i}"),
                    "value": value,
                    "expected_value": round(mean, 2),
                    "deviation": round(z_score, 2),
                    "severity": "high" if abs(z_score) > 3 else "medium"
                })
        
        return {
            "anomalies": anomalies,
            "total_data_points": len(data),
            "threshold_used": 2.0,
            "timestamp": datetime.utcnow().isoformat()
        }


# Initialize engines
behavior_engine = CustomerBehaviorEngine(lakehouse)
reporting_engine = ReportingEngine(lakehouse)
predictive_engine = PredictiveAnalyticsEngine(lakehouse)


# API Endpoints
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "unified-analytics",
        "lakehouse_url": LAKEHOUSE_URL,
        "timestamp": datetime.utcnow().isoformat()
    }


# Dashboard & Reporting Endpoints
@app.get("/api/v1/dashboard", response_model=DashboardMetrics)
async def get_dashboard(
    start_date: str = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: str = Query(..., description="End date (YYYY-MM-DD)")
):
    """Get real-time dashboard metrics from lakehouse"""
    try:
        return await reporting_engine.get_dashboard_metrics(start_date, end_date)
    except Exception as e:
        logger.error(f"Dashboard error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/reports/generate")
async def generate_report(request: ReportRequest):
    """Generate custom report from lakehouse data"""
    try:
        return await reporting_engine.generate_report(request)
    except Exception as e:
        logger.error(f"Report generation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Customer Behavior Endpoints
@app.get("/api/v1/customers/{user_id}/churn", response_model=ChurnPrediction)
async def predict_churn(user_id: str):
    """Predict customer churn probability"""
    try:
        return await behavior_engine.predict_churn(user_id)
    except Exception as e:
        logger.error(f"Churn prediction error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/customers/{user_id}/ltv", response_model=LTVCalculation)
async def calculate_ltv(user_id: str):
    """Calculate Customer Lifetime Value"""
    try:
        return await behavior_engine.calculate_ltv(user_id)
    except Exception as e:
        logger.error(f"LTV calculation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/customers/{user_id}/segment", response_model=CustomerSegment)
async def get_segment(user_id: str):
    """Get customer segment"""
    try:
        return await behavior_engine.get_segment(user_id)
    except Exception as e:
        logger.error(f"Segmentation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/segments")
async def get_all_segments(date: str = Query(..., description="Date (YYYY-MM-DD)")):
    """Get all customer segments from lakehouse"""
    try:
        return await lakehouse.get_user_segments(date)
    except Exception as e:
        logger.error(f"Segments error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Predictive Analytics Endpoints
@app.get("/api/v1/predictions/transaction/{transaction_id}")
async def predict_transaction_success(transaction_id: str):
    """Predict transaction success probability"""
    try:
        return await predictive_engine.predict_transaction_success(transaction_id)
    except Exception as e:
        logger.error(f"Transaction prediction error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/predictions/revenue")
async def forecast_revenue(days: int = Query(30, description="Number of days to forecast")):
    """Forecast revenue for next N days"""
    try:
        return await predictive_engine.forecast_revenue(days)
    except Exception as e:
        logger.error(f"Revenue forecast error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/predictions/anomalies")
async def detect_anomalies(
    metric: str = Query("transaction_volume", description="Metric to analyze"),
    days: int = Query(7, description="Days to analyze")
):
    """Detect anomalies in business metrics"""
    try:
        return await predictive_engine.detect_anomalies(metric, days)
    except Exception as e:
        logger.error(f"Anomaly detection error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Corridor & Risk Analytics
@app.get("/api/v1/corridors/performance")
async def get_corridor_performance(
    start_date: str = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: str = Query(..., description="End date (YYYY-MM-DD)")
):
    """Get corridor performance metrics from lakehouse"""
    try:
        return await lakehouse.get_corridor_performance(start_date, end_date)
    except Exception as e:
        logger.error(f"Corridor performance error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/risk/summary")
async def get_risk_summary(
    start_date: str = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: str = Query(..., description="End date (YYYY-MM-DD)")
):
    """Get risk assessment summary from lakehouse"""
    try:
        return await lakehouse.get_risk_summary(start_date, end_date)
    except Exception as e:
        logger.error(f"Risk summary error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Revenue Analytics
@app.get("/api/v1/revenue/metrics")
async def get_revenue_metrics(
    start_date: str = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: str = Query(..., description="End date (YYYY-MM-DD)"),
    group_by: str = Query("corridor", description="Group by: corridor, gateway, or date")
):
    """Get revenue metrics from lakehouse"""
    try:
        return await lakehouse.get_revenue_metrics(start_date, end_date, group_by)
    except Exception as e:
        logger.error(f"Revenue metrics error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Retention Analytics
@app.get("/api/v1/retention/cohorts")
async def get_retention_cohorts(cohort_date: Optional[str] = None):
    """Get retention cohort analysis from lakehouse"""
    try:
        return await lakehouse.get_retention_cohorts(cohort_date)
    except Exception as e:
        logger.error(f"Retention cohorts error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.on_event("shutdown")
async def shutdown():
    await lakehouse.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8030)
