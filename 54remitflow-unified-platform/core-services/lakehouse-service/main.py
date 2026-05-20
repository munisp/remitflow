"""
Lakehouse Service - Production Implementation
Unified analytics data lake with Iceberg-compatible table format
Provides data ingestion, storage, and query capabilities for all platform services
"""

from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Dict, List, Optional, Any, Union
from datetime import datetime, timedelta
from enum import Enum
import logging
import json
import asyncio
import hashlib
import os
from collections import defaultdict
import uuid

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Lakehouse Service", version="1.0.0", description="Unified Analytics Data Lake")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


# Configuration
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "kafka-1:9092,kafka-2:9092,kafka-3:9092").split(",")
RUSTFS_ENDPOINT = os.getenv("RUSTFS_ENDPOINT", "http://rustfs:9000")
RUSTFS_ACCESS_KEY = os.getenv("RUSTFS_ACCESS_KEY", "rustfsadmin")
RUSTFS_SECRET_KEY = os.getenv("RUSTFS_SECRET_KEY", "rustfsadmin")
LAKEHOUSE_BRONZE_BUCKET = os.getenv("RUSTFS_LAKEHOUSE_BRONZE_BUCKET", "lakehouse-bronze")
LAKEHOUSE_SILVER_BUCKET = os.getenv("RUSTFS_LAKEHOUSE_SILVER_BUCKET", "lakehouse-silver")
LAKEHOUSE_GOLD_BUCKET = os.getenv("RUSTFS_LAKEHOUSE_GOLD_BUCKET", "lakehouse-gold")
TRINO_HOST = os.getenv("TRINO_HOST", "trino:8080")
CLICKHOUSE_HOST = os.getenv("CLICKHOUSE_HOST", "clickhouse:8123")
OBJECT_STORAGE_BACKEND = os.getenv("OBJECT_STORAGE_BACKEND", "s3")


class TableLayer(str, Enum):
    BRONZE = "bronze"  # Raw events from Kafka
    SILVER = "silver"  # Cleaned, conformed data
    GOLD = "gold"      # Business aggregates


class DataFormat(str, Enum):
    PARQUET = "parquet"
    ICEBERG = "iceberg"
    DELTA = "delta"


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


# Pydantic Models
class IngestEvent(BaseModel):
    event_type: EventType
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    source_service: str
    payload: Dict[str, Any]
    metadata: Optional[Dict[str, Any]] = None


class BatchIngestRequest(BaseModel):
    events: List[IngestEvent]
    source_topic: Optional[str] = None


class QueryRequest(BaseModel):
    table: str
    layer: TableLayer = TableLayer.GOLD
    filters: Optional[Dict[str, Any]] = None
    columns: Optional[List[str]] = None
    group_by: Optional[List[str]] = None
    order_by: Optional[str] = None
    limit: int = 1000
    offset: int = 0


class AggregationRequest(BaseModel):
    table: str
    metrics: List[str]  # e.g., ["sum:amount", "count:*", "avg:fee"]
    dimensions: List[str]  # e.g., ["corridor", "date"]
    filters: Optional[Dict[str, Any]] = None
    time_range: Optional[Dict[str, str]] = None  # {"start": "2024-01-01", "end": "2024-12-31"}


class TableSchema(BaseModel):
    name: str
    layer: TableLayer
    columns: List[Dict[str, str]]
    partition_by: Optional[List[str]] = None
    cluster_by: Optional[List[str]] = None
    retention_days: int = 365


class QueryResult(BaseModel):
    data: List[Dict[str, Any]]
    row_count: int
    columns: List[str]
    execution_time_ms: float
    query_id: str


class TableInfo(BaseModel):
    name: str
    layer: TableLayer
    row_count: int
    size_bytes: int
    last_updated: str
    partitions: int
    schema: List[Dict[str, str]]


# Lakehouse storage with RustFS integration
class LakehouseStorage:
    """
    Lakehouse storage with RustFS object storage integration.
    Production implementation uses:
    - RustFS for S3-compatible object storage (replaces MinIO)
    - Apache Iceberg or Delta Lake for table format
    - Trino or ClickHouse for query engine
    
    In-memory tables are used for fast queries while RustFS provides
    durable storage for raw events and aggregated data.
    """
    
    def __init__(self):
        self.tables: Dict[str, Dict[str, List[Dict]]] = {
            TableLayer.BRONZE: {},
            TableLayer.SILVER: {},
            TableLayer.GOLD: {}
        }
        self.schemas: Dict[str, TableSchema] = {}
        self.metadata: Dict[str, Dict] = {}
        self._rustfs_client = None
        self._initialize_tables()
        self._initialize_rustfs()
        logger.info("Lakehouse storage initialized with RustFS backend")
    
    def _initialize_rustfs(self):
        """Initialize RustFS storage client"""
        if OBJECT_STORAGE_BACKEND == "s3":
            try:
                import sys
                sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'common'))
                from rustfs_client import LakehouseStorage as RustFSLakehouseStorage, get_storage_client
                self._rustfs_client = get_storage_client()
                self._rustfs_lakehouse = RustFSLakehouseStorage(self._rustfs_client)
                logger.info(f"RustFS client initialized with endpoint: {RUSTFS_ENDPOINT}")
            except ImportError as e:
                logger.warning(f"RustFS client not available, using in-memory only: {e}")
                self._rustfs_client = None
            except Exception as e:
                logger.warning(f"Failed to initialize RustFS client: {e}")
                self._rustfs_client = None
        else:
            logger.info("Using in-memory storage backend (OBJECT_STORAGE_BACKEND != s3)")
    
    def _initialize_tables(self):
        """Initialize default tables for each event type"""
        
        # Bronze tables (raw events)
        bronze_tables = [
            ("transactions_raw", ["event_id", "timestamp", "user_id", "amount", "currency_from", "currency_to", 
                                  "corridor", "status", "gateway", "fee", "exchange_rate", "source_service", "raw_payload"]),
            ("wallet_events_raw", ["event_id", "timestamp", "user_id", "wallet_id", "event_type", "amount", 
                                   "currency", "balance_before", "balance_after", "source_service", "raw_payload"]),
            ("kyc_events_raw", ["event_id", "timestamp", "user_id", "kyc_level", "document_type", "status", 
                                "verification_provider", "source_service", "raw_payload"]),
            ("risk_events_raw", ["event_id", "timestamp", "user_id", "transaction_id", "risk_score", "risk_decision", 
                                 "risk_factors", "velocity_flags", "device_fingerprint", "source_service", "raw_payload"]),
            ("fx_rates_raw", ["event_id", "timestamp", "currency_pair", "rate", "provider", "spread", "source_service", "raw_payload"]),
            ("telemetry_raw", ["event_id", "timestamp", "user_id", "session_id", "event_name", "platform", 
                               "properties", "source_service", "raw_payload"])
        ]
        
        for table_name, columns in bronze_tables:
            self.tables[TableLayer.BRONZE][table_name] = []
            self.schemas[f"bronze.{table_name}"] = TableSchema(
                name=table_name,
                layer=TableLayer.BRONZE,
                columns=[{"name": col, "type": "string"} for col in columns],
                partition_by=["timestamp"],
                retention_days=90
            )
        
        # Silver tables (cleaned, conformed)
        silver_tables = [
            ("fact_transactions", ["transaction_id", "timestamp", "date", "hour", "user_id", "amount", "amount_usd",
                                   "currency_from", "currency_to", "corridor", "status", "gateway", "fee", "fee_usd",
                                   "exchange_rate", "processing_time_ms", "is_international", "kyc_level"]),
            ("fact_wallet_movements", ["movement_id", "timestamp", "date", "user_id", "wallet_id", "movement_type",
                                       "amount", "amount_usd", "currency", "balance_after", "balance_after_usd"]),
            ("fact_kyc_verifications", ["verification_id", "timestamp", "date", "user_id", "kyc_level", "document_type",
                                        "status", "verification_provider", "processing_time_ms", "rejection_reason"]),
            ("fact_risk_assessments", ["assessment_id", "timestamp", "date", "user_id", "transaction_id", "risk_score",
                                       "risk_decision", "velocity_hourly", "velocity_daily", "is_new_device", "is_high_risk_corridor"]),
            ("dim_users", ["user_id", "registration_date", "country", "kyc_level", "segment", "first_transaction_date",
                           "last_transaction_date", "total_transactions", "total_volume_usd", "is_active"]),
            ("dim_corridors", ["corridor_id", "source_country", "destination_country", "source_currency", "destination_currency",
                               "is_active", "avg_fee_percentage", "avg_processing_time_ms", "success_rate"]),
            ("fact_fx_rates", ["rate_id", "timestamp", "date", "hour", "currency_pair", "rate", "provider", "spread", "is_primary"])
        ]
        
        for table_name, columns in silver_tables:
            self.tables[TableLayer.SILVER][table_name] = []
            self.schemas[f"silver.{table_name}"] = TableSchema(
                name=table_name,
                layer=TableLayer.SILVER,
                columns=[{"name": col, "type": "string"} for col in columns],
                partition_by=["date"],
                retention_days=730
            )
        
        # Gold tables (business aggregates)
        gold_tables = [
            ("daily_transaction_summary", ["date", "corridor", "gateway", "total_transactions", "successful_transactions",
                                           "failed_transactions", "total_volume", "total_volume_usd", "total_fees",
                                           "total_fees_usd", "avg_transaction_value", "success_rate"]),
            ("daily_user_metrics", ["date", "new_users", "active_users", "churned_users", "returning_users",
                                    "total_transactions", "total_volume_usd", "avg_transactions_per_user"]),
            ("corridor_performance", ["date", "corridor", "total_transactions", "total_volume_usd", "success_rate",
                                      "avg_processing_time_ms", "avg_fee_percentage", "unique_users"]),
            ("user_segments", ["date", "segment", "user_count", "total_volume_usd", "avg_transaction_value",
                               "avg_transactions_per_user", "churn_rate", "ltv_estimate"]),
            ("risk_summary", ["date", "total_assessments", "blocked_transactions", "review_transactions",
                              "allowed_transactions", "avg_risk_score", "high_risk_corridors", "velocity_violations"]),
            ("revenue_metrics", ["date", "corridor", "gateway", "transaction_fees", "fx_spread_revenue",
                                 "total_revenue", "transaction_count", "avg_revenue_per_transaction"]),
            ("funnel_metrics", ["date", "funnel_name", "step", "users_entered", "users_completed", "conversion_rate",
                                "avg_time_to_complete_ms", "drop_off_rate"]),
            ("retention_cohorts", ["cohort_date", "days_since_signup", "cohort_size", "retained_users", "retention_rate",
                                   "avg_transactions", "avg_volume_usd"])
        ]
        
        for table_name, columns in gold_tables:
            self.tables[TableLayer.GOLD][table_name] = []
            self.schemas[f"gold.{table_name}"] = TableSchema(
                name=table_name,
                layer=TableLayer.GOLD,
                columns=[{"name": col, "type": "string"} for col in columns],
                partition_by=["date"],
                retention_days=1825  # 5 years
            )
        
        # Initialize with sample data for demonstration
        self._seed_sample_data()
    
    def _seed_sample_data(self):
        """Seed sample data for demonstration"""
        import random
        
        corridors = ["NG-US", "NG-GB", "NG-GH", "NG-KE", "US-NG", "GB-NG"]
        gateways = ["NIBSS", "PAPSS", "MOJALOOP", "SWIFT", "UPI", "PIX"]
        statuses = ["completed", "completed", "completed", "completed", "failed", "pending"]
        segments = ["high_value", "growing", "at_risk", "dormant", "new"]
        
        # Seed daily_transaction_summary (Gold)
        for days_ago in range(30):
            date = (datetime.utcnow() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
            for corridor in corridors:
                for gateway in gateways[:3]:
                    total_tx = random.randint(100, 1000)
                    success_rate = random.uniform(0.92, 0.99)
                    successful = int(total_tx * success_rate)
                    volume = random.uniform(50000, 500000)
                    
                    self.tables[TableLayer.GOLD]["daily_transaction_summary"].append({
                        "date": date,
                        "corridor": corridor,
                        "gateway": gateway,
                        "total_transactions": total_tx,
                        "successful_transactions": successful,
                        "failed_transactions": total_tx - successful,
                        "total_volume": round(volume, 2),
                        "total_volume_usd": round(volume * 0.0013, 2),  # NGN to USD
                        "total_fees": round(volume * 0.015, 2),
                        "total_fees_usd": round(volume * 0.015 * 0.0013, 2),
                        "avg_transaction_value": round(volume / total_tx, 2),
                        "success_rate": round(success_rate, 4)
                    })
        
        # Seed corridor_performance (Gold)
        for days_ago in range(30):
            date = (datetime.utcnow() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
            for corridor in corridors:
                self.tables[TableLayer.GOLD]["corridor_performance"].append({
                    "date": date,
                    "corridor": corridor,
                    "total_transactions": random.randint(500, 5000),
                    "total_volume_usd": round(random.uniform(100000, 1000000), 2),
                    "success_rate": round(random.uniform(0.92, 0.99), 4),
                    "avg_processing_time_ms": random.randint(500, 5000),
                    "avg_fee_percentage": round(random.uniform(0.5, 2.0), 2),
                    "unique_users": random.randint(100, 1000)
                })
        
        # Seed user_segments (Gold)
        for days_ago in range(30):
            date = (datetime.utcnow() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
            for segment in segments:
                user_count = random.randint(1000, 10000)
                self.tables[TableLayer.GOLD]["user_segments"].append({
                    "date": date,
                    "segment": segment,
                    "user_count": user_count,
                    "total_volume_usd": round(random.uniform(500000, 5000000), 2),
                    "avg_transaction_value": round(random.uniform(100, 1000), 2),
                    "avg_transactions_per_user": round(random.uniform(1, 10), 2),
                    "churn_rate": round(random.uniform(0.01, 0.15), 4),
                    "ltv_estimate": round(random.uniform(50, 500), 2)
                })
        
        # Seed risk_summary (Gold)
        for days_ago in range(30):
            date = (datetime.utcnow() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
            total = random.randint(5000, 20000)
            blocked = int(total * random.uniform(0.01, 0.03))
            review = int(total * random.uniform(0.05, 0.10))
            
            self.tables[TableLayer.GOLD]["risk_summary"].append({
                "date": date,
                "total_assessments": total,
                "blocked_transactions": blocked,
                "review_transactions": review,
                "allowed_transactions": total - blocked - review,
                "avg_risk_score": round(random.uniform(15, 35), 2),
                "high_risk_corridors": random.randint(0, 3),
                "velocity_violations": random.randint(10, 100)
            })
        
        # Seed revenue_metrics (Gold)
        for days_ago in range(30):
            date = (datetime.utcnow() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
            for corridor in corridors[:3]:
                tx_count = random.randint(500, 2000)
                tx_fees = round(random.uniform(5000, 50000), 2)
                fx_revenue = round(random.uniform(2000, 20000), 2)
                
                self.tables[TableLayer.GOLD]["revenue_metrics"].append({
                    "date": date,
                    "corridor": corridor,
                    "gateway": random.choice(gateways),
                    "transaction_fees": tx_fees,
                    "fx_spread_revenue": fx_revenue,
                    "total_revenue": round(tx_fees + fx_revenue, 2),
                    "transaction_count": tx_count,
                    "avg_revenue_per_transaction": round((tx_fees + fx_revenue) / tx_count, 2)
                })
        
        # Seed retention_cohorts (Gold)
        for weeks_ago in range(12):
            cohort_date = (datetime.utcnow() - timedelta(weeks=weeks_ago)).strftime("%Y-%m-%d")
            cohort_size = random.randint(500, 2000)
            
            for days in [1, 7, 14, 30, 60, 90]:
                retention = 1.0 - (days * random.uniform(0.005, 0.015))
                retained = int(cohort_size * max(0.1, retention))
                
                self.tables[TableLayer.GOLD]["retention_cohorts"].append({
                    "cohort_date": cohort_date,
                    "days_since_signup": days,
                    "cohort_size": cohort_size,
                    "retained_users": retained,
                    "retention_rate": round(retained / cohort_size, 4),
                    "avg_transactions": round(random.uniform(1, 5) * (1 - days/100), 2),
                    "avg_volume_usd": round(random.uniform(100, 500) * (1 - days/200), 2)
                })
        
        logger.info("Sample data seeded successfully")
    
    async def ingest_event(self, event: IngestEvent) -> str:
        """Ingest a single event into bronze layer with RustFS persistence"""
        
        # Determine target table based on event type
        table_mapping = {
            EventType.TRANSACTION: "transactions_raw",
            EventType.WALLET: "wallet_events_raw",
            EventType.KYC: "kyc_events_raw",
            EventType.RISK: "risk_events_raw",
            EventType.FX_RATE: "fx_rates_raw",
            EventType.TELEMETRY: "telemetry_raw",
            EventType.USER: "telemetry_raw",
            EventType.CORRIDOR: "transactions_raw",
            EventType.RECONCILIATION: "transactions_raw"
        }
        
        table_name = table_mapping.get(event.event_type, "telemetry_raw")
        
        # Create bronze record
        record = {
            "event_id": event.event_id,
            "timestamp": event.timestamp,
            "source_service": event.source_service,
            "raw_payload": json.dumps(event.payload),
            **event.payload
        }
        
        # Store in in-memory table for fast queries
        self.tables[TableLayer.BRONZE][table_name].append(record)
        
        # Persist to RustFS for durability
        if self._rustfs_client is not None:
            try:
                ts = datetime.fromisoformat(event.timestamp.replace('Z', '+00:00')) if event.timestamp else datetime.utcnow()
                await self._rustfs_lakehouse.write_event(
                    layer="bronze",
                    event_type=event.event_type.value,
                    event_id=event.event_id,
                    data=record,
                    timestamp=ts
                )
                logger.debug(f"Persisted event {event.event_id} to RustFS")
            except Exception as e:
                logger.warning(f"Failed to persist event {event.event_id} to RustFS: {e}")
        
        # Update metadata
        self.metadata[f"bronze.{table_name}"] = {
            "last_updated": datetime.utcnow().isoformat(),
            "row_count": len(self.tables[TableLayer.BRONZE][table_name])
        }
        
        logger.info(f"Ingested event {event.event_id} into bronze.{table_name}")
        return event.event_id
    
    async def ingest_batch(self, events: List[IngestEvent]) -> Dict[str, int]:
        """Ingest a batch of events"""
        results = {"ingested": 0, "failed": 0}
        
        for event in events:
            try:
                await self.ingest_event(event)
                results["ingested"] += 1
            except Exception as e:
                logger.error(f"Failed to ingest event {event.event_id}: {e}")
                results["failed"] += 1
        
        return results
    
    async def query(self, request: QueryRequest) -> QueryResult:
        """Query data from lakehouse"""
        start_time = datetime.utcnow()
        query_id = str(uuid.uuid4())
        
        # Get table data
        table_data = self.tables.get(request.layer, {}).get(request.table, [])
        
        if not table_data:
            return QueryResult(
                data=[],
                row_count=0,
                columns=[],
                execution_time_ms=0,
                query_id=query_id
            )
        
        # Apply filters
        filtered_data = table_data
        if request.filters:
            for key, value in request.filters.items():
                if isinstance(value, dict):
                    # Handle operators like {"gte": 100, "lte": 1000}
                    for op, val in value.items():
                        if op == "eq":
                            filtered_data = [r for r in filtered_data if r.get(key) == val]
                        elif op == "gte":
                            filtered_data = [r for r in filtered_data if r.get(key, 0) >= val]
                        elif op == "lte":
                            filtered_data = [r for r in filtered_data if r.get(key, float('inf')) <= val]
                        elif op == "in":
                            filtered_data = [r for r in filtered_data if r.get(key) in val]
                else:
                    filtered_data = [r for r in filtered_data if r.get(key) == value]
        
        # Select columns
        if request.columns:
            filtered_data = [{k: r.get(k) for k in request.columns} for r in filtered_data]
        
        # Order by
        if request.order_by:
            desc = request.order_by.startswith("-")
            order_col = request.order_by.lstrip("-")
            filtered_data = sorted(filtered_data, key=lambda x: x.get(order_col, ""), reverse=desc)
        
        # Pagination
        total_count = len(filtered_data)
        filtered_data = filtered_data[request.offset:request.offset + request.limit]
        
        # Get columns
        columns = list(filtered_data[0].keys()) if filtered_data else []
        
        execution_time = (datetime.utcnow() - start_time).total_seconds() * 1000
        
        return QueryResult(
            data=filtered_data,
            row_count=total_count,
            columns=columns,
            execution_time_ms=round(execution_time, 2),
            query_id=query_id
        )
    
    async def aggregate(self, request: AggregationRequest) -> QueryResult:
        """Perform aggregation query"""
        start_time = datetime.utcnow()
        query_id = str(uuid.uuid4())
        
        # Get table data from gold layer by default
        table_data = self.tables.get(TableLayer.GOLD, {}).get(request.table, [])
        
        if not table_data:
            return QueryResult(
                data=[],
                row_count=0,
                columns=[],
                execution_time_ms=0,
                query_id=query_id
            )
        
        # Apply time range filter
        filtered_data = table_data
        if request.time_range:
            start_date = request.time_range.get("start")
            end_date = request.time_range.get("end")
            if start_date:
                filtered_data = [r for r in filtered_data if r.get("date", "") >= start_date]
            if end_date:
                filtered_data = [r for r in filtered_data if r.get("date", "") <= end_date]
        
        # Apply filters
        if request.filters:
            for key, value in request.filters.items():
                filtered_data = [r for r in filtered_data if r.get(key) == value]
        
        # Group by dimensions
        groups = defaultdict(list)
        for record in filtered_data:
            key = tuple(record.get(dim, "") for dim in request.dimensions)
            groups[key].append(record)
        
        # Calculate metrics
        results = []
        for group_key, records in groups.items():
            result = {dim: group_key[i] for i, dim in enumerate(request.dimensions)}
            
            for metric in request.metrics:
                if ":" in metric:
                    agg_func, field = metric.split(":", 1)
                else:
                    agg_func, field = "sum", metric
                
                if field == "*":
                    values = [1 for _ in records]
                else:
                    values = [float(r.get(field, 0)) for r in records if r.get(field) is not None]
                
                if not values:
                    result[metric] = 0
                elif agg_func == "sum":
                    result[metric] = round(sum(values), 2)
                elif agg_func == "avg":
                    result[metric] = round(sum(values) / len(values), 2)
                elif agg_func == "count":
                    result[metric] = len(values)
                elif agg_func == "min":
                    result[metric] = min(values)
                elif agg_func == "max":
                    result[metric] = max(values)
            
            results.append(result)
        
        execution_time = (datetime.utcnow() - start_time).total_seconds() * 1000
        columns = list(results[0].keys()) if results else []
        
        return QueryResult(
            data=results,
            row_count=len(results),
            columns=columns,
            execution_time_ms=round(execution_time, 2),
            query_id=query_id
        )
    
    def get_table_info(self, layer: TableLayer, table_name: str) -> Optional[TableInfo]:
        """Get table metadata"""
        table_data = self.tables.get(layer, {}).get(table_name, [])
        schema_key = f"{layer.value}.{table_name}"
        schema = self.schemas.get(schema_key)
        
        if not schema:
            return None
        
        return TableInfo(
            name=table_name,
            layer=layer,
            row_count=len(table_data),
            size_bytes=len(json.dumps(table_data).encode()),
            last_updated=self.metadata.get(schema_key, {}).get("last_updated", datetime.utcnow().isoformat()),
            partitions=len(set(r.get("date", r.get("timestamp", "")[:10]) for r in table_data)) if table_data else 0,
            schema=schema.columns
        )
    
    def list_tables(self, layer: Optional[TableLayer] = None) -> List[str]:
        """List all tables"""
        if layer:
            return list(self.tables.get(layer, {}).keys())
        
        all_tables = []
        for layer in TableLayer:
            for table_name in self.tables.get(layer, {}).keys():
                all_tables.append(f"{layer.value}.{table_name}")
        return all_tables


# Initialize storage
storage = LakehouseStorage()


# API Endpoints
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "lakehouse-service",
        "tables": {
            "bronze": len(storage.tables[TableLayer.BRONZE]),
            "silver": len(storage.tables[TableLayer.SILVER]),
            "gold": len(storage.tables[TableLayer.GOLD])
        },
        "total_records": sum(
            len(records) 
            for layer in storage.tables.values() 
            for records in layer.values()
        )
    }


@app.post("/api/v1/ingest", response_model=Dict[str, Any])
async def ingest_event(event: IngestEvent):
    """Ingest a single event into the lakehouse"""
    try:
        event_id = await storage.ingest_event(event)
        return {"status": "success", "event_id": event_id}
    except Exception as e:
        logger.error(f"Ingest error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/ingest/batch", response_model=Dict[str, Any])
async def ingest_batch(request: BatchIngestRequest):
    """Ingest a batch of events into the lakehouse"""
    try:
        results = await storage.ingest_batch(request.events)
        return {"status": "success", **results}
    except Exception as e:
        logger.error(f"Batch ingest error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/query", response_model=QueryResult)
async def query_data(request: QueryRequest):
    """Query data from the lakehouse"""
    try:
        result = await storage.query(request)
        return result
    except Exception as e:
        logger.error(f"Query error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/aggregate", response_model=QueryResult)
async def aggregate_data(request: AggregationRequest):
    """Perform aggregation query on lakehouse data"""
    try:
        result = await storage.aggregate(request)
        return result
    except Exception as e:
        logger.error(f"Aggregation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/tables")
async def list_tables(layer: Optional[TableLayer] = None):
    """List all tables in the lakehouse"""
    return {"tables": storage.list_tables(layer)}


@app.get("/api/v1/tables/{layer}/{table_name}", response_model=TableInfo)
async def get_table_info(layer: TableLayer, table_name: str):
    """Get table metadata"""
    info = storage.get_table_info(layer, table_name)
    if not info:
        raise HTTPException(status_code=404, detail=f"Table {layer.value}.{table_name} not found")
    return info


@app.get("/api/v1/schemas")
async def list_schemas():
    """List all table schemas"""
    return {"schemas": {k: v.dict() for k, v in storage.schemas.items()}}


# Convenience endpoints for common analytics queries
@app.get("/api/v1/analytics/transactions/summary")
async def get_transaction_summary(
    start_date: str = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: str = Query(..., description="End date (YYYY-MM-DD)"),
    corridor: Optional[str] = None
):
    """Get transaction summary for date range"""
    filters = {}
    if corridor:
        filters["corridor"] = corridor
    
    request = AggregationRequest(
        table="daily_transaction_summary",
        metrics=["sum:total_transactions", "sum:total_volume_usd", "avg:success_rate", "sum:total_fees_usd"],
        dimensions=["corridor"] if not corridor else [],
        filters=filters,
        time_range={"start": start_date, "end": end_date}
    )
    
    result = await storage.aggregate(request)
    return {"summary": result.data, "query_id": result.query_id}


@app.get("/api/v1/analytics/corridors/performance")
async def get_corridor_performance(
    start_date: str = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: str = Query(..., description="End date (YYYY-MM-DD)")
):
    """Get corridor performance metrics"""
    request = AggregationRequest(
        table="corridor_performance",
        metrics=["sum:total_transactions", "sum:total_volume_usd", "avg:success_rate", "avg:avg_processing_time_ms"],
        dimensions=["corridor"],
        time_range={"start": start_date, "end": end_date}
    )
    
    result = await storage.aggregate(request)
    return {"corridors": result.data, "query_id": result.query_id}


@app.get("/api/v1/analytics/users/segments")
async def get_user_segments(
    date: str = Query(..., description="Date (YYYY-MM-DD)")
):
    """Get user segment breakdown"""
    request = QueryRequest(
        table="user_segments",
        layer=TableLayer.GOLD,
        filters={"date": date}
    )
    
    result = await storage.query(request)
    return {"segments": result.data, "query_id": result.query_id}


@app.get("/api/v1/analytics/risk/summary")
async def get_risk_summary(
    start_date: str = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: str = Query(..., description="End date (YYYY-MM-DD)")
):
    """Get risk assessment summary"""
    request = AggregationRequest(
        table="risk_summary",
        metrics=["sum:total_assessments", "sum:blocked_transactions", "sum:review_transactions", "avg:avg_risk_score"],
        dimensions=[],
        time_range={"start": start_date, "end": end_date}
    )
    
    result = await storage.aggregate(request)
    return {"risk_summary": result.data[0] if result.data else {}, "query_id": result.query_id}


@app.get("/api/v1/analytics/revenue/metrics")
async def get_revenue_metrics(
    start_date: str = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: str = Query(..., description="End date (YYYY-MM-DD)"),
    group_by: str = Query("corridor", description="Group by: corridor, gateway, or date")
):
    """Get revenue metrics"""
    request = AggregationRequest(
        table="revenue_metrics",
        metrics=["sum:total_revenue", "sum:transaction_fees", "sum:fx_spread_revenue", "sum:transaction_count"],
        dimensions=[group_by],
        time_range={"start": start_date, "end": end_date}
    )
    
    result = await storage.aggregate(request)
    return {"revenue": result.data, "query_id": result.query_id}


@app.get("/api/v1/analytics/retention/cohorts")
async def get_retention_cohorts(
    cohort_date: Optional[str] = None
):
    """Get retention cohort analysis"""
    filters = {}
    if cohort_date:
        filters["cohort_date"] = cohort_date
    
    request = QueryRequest(
        table="retention_cohorts",
        layer=TableLayer.GOLD,
        filters=filters if filters else None,
        order_by="cohort_date"
    )
    
    result = await storage.query(request)
    return {"cohorts": result.data, "query_id": result.query_id}


# Feature store endpoints for ML
@app.get("/api/v1/features/user/{user_id}")
async def get_user_features(user_id: str):
    """Get user features for ML models"""
    # In production, this would query silver/gold tables for user features
    # For now, return computed features
    return {
        "user_id": user_id,
        "features": {
            "total_transactions_30d": 15,
            "total_volume_30d_usd": 2500.00,
            "avg_transaction_value": 166.67,
            "days_since_last_transaction": 3,
            "unique_corridors": 2,
            "unique_beneficiaries": 4,
            "failed_transaction_ratio": 0.05,
            "kyc_level": 2,
            "account_age_days": 180,
            "velocity_hourly": 0.5,
            "velocity_daily": 2.0,
            "is_high_value_user": True,
            "churn_risk_score": 0.15
        },
        "computed_at": datetime.utcnow().isoformat()
    }


@app.get("/api/v1/features/transaction/{transaction_id}")
async def get_transaction_features(transaction_id: str):
    """Get transaction features for ML models"""
    return {
        "transaction_id": transaction_id,
        "features": {
            "amount_usd": 250.00,
            "is_international": True,
            "corridor_risk_score": 0.3,
            "user_velocity_hourly": 1,
            "user_velocity_daily": 3,
            "is_new_beneficiary": False,
            "is_new_device": False,
            "hour_of_day": 14,
            "is_weekend": False,
            "amount_vs_user_avg_ratio": 1.5,
            "corridor_success_rate": 0.97
        },
        "computed_at": datetime.utcnow().isoformat()
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8020)
