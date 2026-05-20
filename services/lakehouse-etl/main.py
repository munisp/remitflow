"""
RemitFlow — Lakehouse ETL Pipeline (Python)
Extracts data from PostgreSQL, transforms it, and loads into:
  - Apache Iceberg / Delta Lake tables (analytics lakehouse)
  - Aggregated metrics for dashboards
  - Regulatory reporting exports (CSV/Parquet)
"""

import asyncio
import csv
import io
import json
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Query, BackgroundTasks
from fastapi.responses import PlainTextResponse, StreamingResponse
import uvicorn

# ── Config ────────────────────────────────────────────────────────────────────

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
PORT = int(os.getenv("PORT", "8089"))
DATABASE_URL = os.getenv("DATABASE_URL", "")
LAKEHOUSE_PATH = os.getenv("LAKEHOUSE_PATH", "/data/lakehouse")
S3_BUCKET = os.getenv("S3_BUCKET", "remitflow-lakehouse")
PIPELINE_INTERVAL_SECS = int(os.getenv("PIPELINE_INTERVAL_SECS", "3600"))  # 1 hour

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("lakehouse-etl")

# ── Pipeline Stats ────────────────────────────────────────────────────────────

stats = {
    "pipelines_run": 0,
    "records_extracted": 0,
    "records_loaded": 0,
    "last_run_at": None,
    "last_run_duration_ms": 0,
    "running": True,
}

# ── ETL Pipelines ─────────────────────────────────────────────────────────────

class TransactionPipeline:
    """Extract-Transform-Load for transaction data."""

    name = "transactions"

    @staticmethod
    def transform(row: Dict[str, Any]) -> Dict[str, Any]:
        """Apply business transformations to transaction data."""
        return {
            **row,
            "amount_usd": float(row.get("amount", 0)),  # In prod: apply FX rates
            "date_partition": row.get("created_at", "")[:10],
            "hour_partition": row.get("created_at", "")[:13],
            "is_large_transaction": float(row.get("amount", 0)) > 10000,
            "is_cross_border": row.get("destination_country") != row.get("source_country"),
            "etl_timestamp": datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    def get_schema() -> Dict[str, str]:
        return {
            "id": "string",
            "user_id": "string",
            "amount": "decimal(18,2)",
            "amount_usd": "decimal(18,2)",
            "currency": "string",
            "status": "string",
            "type": "string",
            "destination_country": "string",
            "date_partition": "date",
            "hour_partition": "timestamp",
            "is_large_transaction": "boolean",
            "is_cross_border": "boolean",
            "created_at": "timestamp",
            "etl_timestamp": "timestamp",
        }


class UserAnalyticsPipeline:
    """Extract-Transform-Load for user analytics."""

    name = "user_analytics"

    @staticmethod
    def transform(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            **row,
            "days_since_registration": (
                datetime.now(timezone.utc) -
                datetime.fromisoformat(row.get("created_at", datetime.now(timezone.utc).isoformat()).replace("Z", "+00:00"))
            ).days if row.get("created_at") else 0,
            "is_kyc_verified": row.get("kyc_status") == "approved",
            "etl_timestamp": datetime.now(timezone.utc).isoformat(),
        }


class CorridorMetricsPipeline:
    """Aggregate corridor-level metrics."""

    name = "corridor_metrics"

    @staticmethod
    def aggregate(transactions: List[Dict]) -> List[Dict]:
        """Aggregate transactions by corridor."""
        corridors: Dict[str, Dict] = {}
        for tx in transactions:
            key = f"{tx.get('currency', 'USD')}-{tx.get('destination_country', 'XX')}"
            if key not in corridors:
                corridors[key] = {
                    "corridor": key,
                    "source_currency": tx.get("currency", "USD"),
                    "destination_country": tx.get("destination_country", "XX"),
                    "transaction_count": 0,
                    "total_volume": 0.0,
                    "avg_amount": 0.0,
                    "date_partition": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                    "etl_timestamp": datetime.now(timezone.utc).isoformat(),
                }
            corridors[key]["transaction_count"] += 1
            corridors[key]["total_volume"] += float(tx.get("amount", 0))

        for corridor in corridors.values():
            if corridor["transaction_count"] > 0:
                corridor["avg_amount"] = corridor["total_volume"] / corridor["transaction_count"]

        return list(corridors.values())


class RegulatoryReportPipeline:
    """Generate regulatory reports (SAR, CTR, FBAR)."""

    name = "regulatory_reports"

    REPORT_TYPES = ["SAR", "CTR", "FBAR", "AML_SUMMARY", "KYC_SUMMARY"]

    @staticmethod
    def generate_sar_report(transactions: List[Dict]) -> List[Dict]:
        """Generate Suspicious Activity Report data."""
        suspicious = [
            tx for tx in transactions
            if float(tx.get("amount", 0)) > 10000
            or tx.get("status") == "flagged"
        ]
        return [
            {
                "report_type": "SAR",
                "transaction_id": tx.get("id"),
                "user_id": tx.get("user_id"),
                "amount": tx.get("amount"),
                "currency": tx.get("currency"),
                "reason": "Large transaction" if float(tx.get("amount", 0)) > 10000 else "Flagged",
                "report_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "filing_deadline": (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d"),
            }
            for tx in suspicious
        ]

    @staticmethod
    def generate_ctr_report(transactions: List[Dict]) -> List[Dict]:
        """Generate Currency Transaction Report data (>$10,000 cash)."""
        return [
            {
                "report_type": "CTR",
                "transaction_id": tx.get("id"),
                "user_id": tx.get("user_id"),
                "amount": tx.get("amount"),
                "currency": tx.get("currency"),
                "report_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            }
            for tx in transactions
            if float(tx.get("amount", 0)) > 10000
        ]


# ── Pipeline Runner ───────────────────────────────────────────────────────────

async def run_pipeline(pipeline_name: Optional[str] = None) -> Dict[str, Any]:
    """Run ETL pipelines."""
    start = datetime.now(timezone.utc)
    results = {}

    pipelines = [TransactionPipeline, UserAnalyticsPipeline, CorridorMetricsPipeline]
    if pipeline_name:
        pipelines = [p for p in pipelines if p.name == pipeline_name]

    for pipeline in pipelines:
        try:
            logger.info(f"[ETL] Running pipeline: {pipeline.name}")
            # In production: query PostgreSQL and write to S3/lakehouse
            # For now: simulate successful run
            results[pipeline.name] = {
                "status": "success",
                "records_extracted": 0,
                "records_loaded": 0,
                "duration_ms": 0,
            }
            stats["pipelines_run"] += 1
        except Exception as e:
            logger.error(f"[ETL] Pipeline {pipeline.name} failed: {e}")
            results[pipeline.name] = {"status": "error", "error": str(e)}

    duration_ms = int((datetime.now(timezone.utc) - start).total_seconds() * 1000)
    stats["last_run_at"] = start.isoformat()
    stats["last_run_duration_ms"] = duration_ms

    return {"pipelines": results, "duration_ms": duration_ms}


async def pipeline_loop() -> None:
    """Periodic pipeline runner."""
    await asyncio.sleep(30)  # Initial delay
    while stats["running"]:
        try:
            logger.info("[ETL] Starting scheduled pipeline run")
            await run_pipeline()
            logger.info("[ETL] Scheduled pipeline run complete")
        except Exception as e:
            logger.error(f"[ETL] Scheduled run error: {e}")
        await asyncio.sleep(PIPELINE_INTERVAL_SECS)


# ── FastAPI App ───────────────────────────────────────────────────────────────

app = FastAPI(title="RemitFlow Lakehouse ETL", version="1.0.0")


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "lakehouse-etl",
        "version": "1.0.0",
        "stats": stats,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/metrics", response_class=PlainTextResponse)
async def metrics():
    return f"""# HELP etl_pipelines_run_total Total ETL pipeline runs
# TYPE etl_pipelines_run_total counter
etl_pipelines_run_total {stats['pipelines_run']}
# HELP etl_records_loaded_total Total records loaded to lakehouse
# TYPE etl_records_loaded_total counter
etl_records_loaded_total {stats['records_loaded']}
"""


@app.post("/pipelines/run")
async def trigger_pipeline(
    background_tasks: BackgroundTasks,
    pipeline: Optional[str] = Query(default=None),
):
    """Trigger an ETL pipeline run."""
    background_tasks.add_task(run_pipeline, pipeline)
    return {"status": "triggered", "pipeline": pipeline or "all"}


@app.get("/pipelines")
async def list_pipelines():
    return {
        "pipelines": [
            {"name": "transactions", "description": "Transaction data ETL"},
            {"name": "user_analytics", "description": "User analytics ETL"},
            {"name": "corridor_metrics", "description": "Corridor metrics aggregation"},
            {"name": "regulatory_reports", "description": "SAR/CTR/FBAR report generation"},
        ]
    }


@app.get("/reports/{report_type}")
async def get_report(
    report_type: str,
    format: str = Query(default="json", enum=["json", "csv"]),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
):
    """Generate a regulatory report."""
    valid_types = RegulatoryReportPipeline.REPORT_TYPES
    if report_type not in valid_types:
        return {"error": f"Unknown report type. Valid: {valid_types}"}

    # In production: query actual data
    sample_data = [
        {
            "report_type": report_type,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "period_start": start_date or (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d"),
            "period_end": end_date or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "record_count": 0,
            "status": "no_data",
        }
    ]

    if format == "csv":
        output = io.StringIO()
        if sample_data:
            writer = csv.DictWriter(output, fieldnames=sample_data[0].keys())
            writer.writeheader()
            writer.writerows(sample_data)
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode()),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={report_type}_{datetime.now().strftime('%Y%m%d')}.csv"},
        )

    return {"report_type": report_type, "data": sample_data}


@app.on_event("startup")
async def startup():
    asyncio.create_task(pipeline_loop())
    logger.info(f"[LAKEHOUSE-ETL] Started on port {PORT}")


@app.on_event("shutdown")
async def shutdown():
    stats["running"] = False


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, log_level=LOG_LEVEL.lower())
