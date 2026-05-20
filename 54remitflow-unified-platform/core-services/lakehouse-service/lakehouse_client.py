"""
Lakehouse Client Library
Provides a simple interface for services to query the lakehouse
"""

import httpx
import logging
import os
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
from enum import Enum

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class TableLayer(str, Enum):
    BRONZE = "bronze"
    SILVER = "silver"
    GOLD = "gold"


class EventType(str, Enum):
    TRANSACTION = "transaction"
    WALLET = "wallet"
    KYC = "kyc"
    RISK = "risk"
    RECONCILIATION = "reconciliation"
    USER = "user"
    FX_RATE = "fx_rate"
    CORRIDOR = "corridor"
    TELEMETRY = "telemetry"


class LakehouseClient:
    """
    Client for interacting with the Lakehouse Service.
    Provides methods for querying analytics data and ingesting events.
    """
    
    def __init__(self, base_url: Optional[str] = None, timeout: float = 30.0):
        self.base_url = base_url or os.getenv("LAKEHOUSE_URL", "http://lakehouse-service:8020")
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None
    
    async def __aenter__(self):
        self._client = httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout)
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._client:
            await self._client.aclose()
    
    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout)
        return self._client
    
    async def health_check(self) -> Dict:
        """Check lakehouse service health"""
        client = await self._get_client()
        response = await client.get("/health")
        response.raise_for_status()
        return response.json()
    
    # Event Ingestion
    async def ingest_event(
        self,
        event_type: EventType,
        payload: Dict[str, Any],
        source_service: str,
        event_id: Optional[str] = None,
        metadata: Optional[Dict] = None
    ) -> Dict:
        """Ingest a single event into the lakehouse"""
        client = await self._get_client()
        
        event = {
            "event_type": event_type.value,
            "source_service": source_service,
            "payload": payload,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        if event_id:
            event["event_id"] = event_id
        if metadata:
            event["metadata"] = metadata
        
        response = await client.post("/api/v1/ingest", json=event)
        response.raise_for_status()
        return response.json()
    
    async def ingest_batch(
        self,
        events: List[Dict[str, Any]],
        source_topic: Optional[str] = None
    ) -> Dict:
        """Ingest a batch of events"""
        client = await self._get_client()
        
        response = await client.post(
            "/api/v1/ingest/batch",
            json={"events": events, "source_topic": source_topic}
        )
        response.raise_for_status()
        return response.json()
    
    # Query Methods
    async def query(
        self,
        table: str,
        layer: TableLayer = TableLayer.GOLD,
        filters: Optional[Dict] = None,
        columns: Optional[List[str]] = None,
        order_by: Optional[str] = None,
        limit: int = 1000,
        offset: int = 0
    ) -> Dict:
        """Query data from the lakehouse"""
        client = await self._get_client()
        
        request = {
            "table": table,
            "layer": layer.value,
            "limit": limit,
            "offset": offset
        }
        
        if filters:
            request["filters"] = filters
        if columns:
            request["columns"] = columns
        if order_by:
            request["order_by"] = order_by
        
        response = await client.post("/api/v1/query", json=request)
        response.raise_for_status()
        return response.json()
    
    async def aggregate(
        self,
        table: str,
        metrics: List[str],
        dimensions: List[str],
        filters: Optional[Dict] = None,
        time_range: Optional[Dict[str, str]] = None
    ) -> Dict:
        """Perform aggregation query"""
        client = await self._get_client()
        
        request = {
            "table": table,
            "metrics": metrics,
            "dimensions": dimensions
        }
        
        if filters:
            request["filters"] = filters
        if time_range:
            request["time_range"] = time_range
        
        response = await client.post("/api/v1/aggregate", json=request)
        response.raise_for_status()
        return response.json()
    
    # Convenience Methods for Common Analytics Queries
    async def get_transaction_summary(
        self,
        start_date: str,
        end_date: str,
        corridor: Optional[str] = None
    ) -> Dict:
        """Get transaction summary for date range"""
        client = await self._get_client()
        
        params = {"start_date": start_date, "end_date": end_date}
        if corridor:
            params["corridor"] = corridor
        
        response = await client.get("/api/v1/analytics/transactions/summary", params=params)
        response.raise_for_status()
        return response.json()
    
    async def get_corridor_performance(
        self,
        start_date: str,
        end_date: str
    ) -> Dict:
        """Get corridor performance metrics"""
        client = await self._get_client()
        
        response = await client.get(
            "/api/v1/analytics/corridors/performance",
            params={"start_date": start_date, "end_date": end_date}
        )
        response.raise_for_status()
        return response.json()
    
    async def get_user_segments(self, date: str) -> Dict:
        """Get user segment breakdown"""
        client = await self._get_client()
        
        response = await client.get(
            "/api/v1/analytics/users/segments",
            params={"date": date}
        )
        response.raise_for_status()
        return response.json()
    
    async def get_risk_summary(
        self,
        start_date: str,
        end_date: str
    ) -> Dict:
        """Get risk assessment summary"""
        client = await self._get_client()
        
        response = await client.get(
            "/api/v1/analytics/risk/summary",
            params={"start_date": start_date, "end_date": end_date}
        )
        response.raise_for_status()
        return response.json()
    
    async def get_revenue_metrics(
        self,
        start_date: str,
        end_date: str,
        group_by: str = "corridor"
    ) -> Dict:
        """Get revenue metrics"""
        client = await self._get_client()
        
        response = await client.get(
            "/api/v1/analytics/revenue/metrics",
            params={"start_date": start_date, "end_date": end_date, "group_by": group_by}
        )
        response.raise_for_status()
        return response.json()
    
    async def get_retention_cohorts(
        self,
        cohort_date: Optional[str] = None
    ) -> Dict:
        """Get retention cohort analysis"""
        client = await self._get_client()
        
        params = {}
        if cohort_date:
            params["cohort_date"] = cohort_date
        
        response = await client.get("/api/v1/analytics/retention/cohorts", params=params)
        response.raise_for_status()
        return response.json()
    
    # Feature Store Methods for ML
    async def get_user_features(self, user_id: str) -> Dict:
        """Get user features for ML models"""
        client = await self._get_client()
        
        response = await client.get(f"/api/v1/features/user/{user_id}")
        response.raise_for_status()
        return response.json()
    
    async def get_transaction_features(self, transaction_id: str) -> Dict:
        """Get transaction features for ML models"""
        client = await self._get_client()
        
        response = await client.get(f"/api/v1/features/transaction/{transaction_id}")
        response.raise_for_status()
        return response.json()
    
    # Table Management
    async def list_tables(self, layer: Optional[TableLayer] = None) -> List[str]:
        """List all tables"""
        client = await self._get_client()
        
        params = {}
        if layer:
            params["layer"] = layer.value
        
        response = await client.get("/api/v1/tables", params=params)
        response.raise_for_status()
        return response.json().get("tables", [])
    
    async def get_table_info(self, layer: TableLayer, table_name: str) -> Dict:
        """Get table metadata"""
        client = await self._get_client()
        
        response = await client.get(f"/api/v1/tables/{layer.value}/{table_name}")
        response.raise_for_status()
        return response.json()
    
    async def close(self):
        """Close the client connection"""
        if self._client:
            await self._client.aclose()
            self._client = None


# Synchronous wrapper for non-async code
class SyncLakehouseClient:
    """Synchronous wrapper for LakehouseClient"""
    
    def __init__(self, base_url: Optional[str] = None, timeout: float = 30.0):
        self.base_url = base_url or os.getenv("LAKEHOUSE_URL", "http://lakehouse-service:8020")
        self.timeout = timeout
    
    def _make_request(self, method: str, endpoint: str, **kwargs) -> Dict:
        with httpx.Client(base_url=self.base_url, timeout=self.timeout) as client:
            response = getattr(client, method)(endpoint, **kwargs)
            response.raise_for_status()
            return response.json()
    
    def health_check(self) -> Dict:
        return self._make_request("get", "/health")
    
    def query(
        self,
        table: str,
        layer: str = "gold",
        filters: Optional[Dict] = None,
        columns: Optional[List[str]] = None,
        order_by: Optional[str] = None,
        limit: int = 1000,
        offset: int = 0
    ) -> Dict:
        request = {
            "table": table,
            "layer": layer,
            "limit": limit,
            "offset": offset
        }
        if filters:
            request["filters"] = filters
        if columns:
            request["columns"] = columns
        if order_by:
            request["order_by"] = order_by
        
        return self._make_request("post", "/api/v1/query", json=request)
    
    def aggregate(
        self,
        table: str,
        metrics: List[str],
        dimensions: List[str],
        filters: Optional[Dict] = None,
        time_range: Optional[Dict[str, str]] = None
    ) -> Dict:
        request = {
            "table": table,
            "metrics": metrics,
            "dimensions": dimensions
        }
        if filters:
            request["filters"] = filters
        if time_range:
            request["time_range"] = time_range
        
        return self._make_request("post", "/api/v1/aggregate", json=request)
    
    def get_transaction_summary(
        self,
        start_date: str,
        end_date: str,
        corridor: Optional[str] = None
    ) -> Dict:
        params = {"start_date": start_date, "end_date": end_date}
        if corridor:
            params["corridor"] = corridor
        return self._make_request("get", "/api/v1/analytics/transactions/summary", params=params)
    
    def get_corridor_performance(self, start_date: str, end_date: str) -> Dict:
        return self._make_request(
            "get",
            "/api/v1/analytics/corridors/performance",
            params={"start_date": start_date, "end_date": end_date}
        )
    
    def get_user_segments(self, date: str) -> Dict:
        return self._make_request("get", "/api/v1/analytics/users/segments", params={"date": date})
    
    def get_risk_summary(self, start_date: str, end_date: str) -> Dict:
        return self._make_request(
            "get",
            "/api/v1/analytics/risk/summary",
            params={"start_date": start_date, "end_date": end_date}
        )
    
    def get_revenue_metrics(self, start_date: str, end_date: str, group_by: str = "corridor") -> Dict:
        return self._make_request(
            "get",
            "/api/v1/analytics/revenue/metrics",
            params={"start_date": start_date, "end_date": end_date, "group_by": group_by}
        )
    
    def get_user_features(self, user_id: str) -> Dict:
        return self._make_request("get", f"/api/v1/features/user/{user_id}")
    
    def get_transaction_features(self, transaction_id: str) -> Dict:
        return self._make_request("get", f"/api/v1/features/transaction/{transaction_id}")
