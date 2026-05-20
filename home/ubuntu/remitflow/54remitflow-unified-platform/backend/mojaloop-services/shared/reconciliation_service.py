"""
TigerBeetle Reconciliation Service for Mojaloop
Ensures Postgres orchestration state matches TigerBeetle monetary truth.

This service runs as a background worker to:
1. Process pending reconciliation queue
2. Detect and fix state mismatches
3. Handle orphaned pending transfers
4. Generate reconciliation reports
"""
import os
import asyncio
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from decimal import Decimal
from enum import Enum

import asyncpg
import httpx
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

from database_ha import (
    HADatabasePool, get_db_pool, close_db_pool,
    TigerBeetleReconciler, DatabaseConfig,
    generate_idempotency_key, transition_state
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ReconciliationConfig:
    """Reconciliation service configuration"""
    RECONCILIATION_INTERVAL = int(os.getenv("RECONCILIATION_INTERVAL", "60"))
    BATCH_SIZE = int(os.getenv("RECONCILIATION_BATCH_SIZE", "100"))
    STALE_TRANSFER_THRESHOLD_MINUTES = int(os.getenv("STALE_TRANSFER_THRESHOLD", "30"))
    TIGERBEETLE_URL = os.getenv("TIGERBEETLE_URL", "http://localhost:8160")
    PORT = int(os.getenv("RECONCILIATION_PORT", "8010"))


config = ReconciliationConfig()


class ReconciliationStatus(str, Enum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class ReconciliationResult(BaseModel):
    transfer_id: str
    action: str
    success: bool
    message: str
    postgres_state: Optional[str] = None
    tigerbeetle_state: Optional[str] = None


class ReconciliationReport(BaseModel):
    run_id: str
    started_at: datetime
    completed_at: Optional[datetime] = None
    total_processed: int = 0
    successful: int = 0
    failed: int = 0
    state_mismatches: int = 0
    orphans_detected: int = 0
    results: List[ReconciliationResult] = []


# FastAPI app
app = FastAPI(
    title="Mojaloop Reconciliation Service",
    description="Reconciles Postgres state with TigerBeetle monetary truth",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Global state
reconciler: Optional[TigerBeetleReconciler] = None
is_running = False
last_run: Optional[ReconciliationReport] = None


async def startup():
    """Initialize service"""
    global reconciler
    await get_db_pool()
    reconciler = TigerBeetleReconciler(config.TIGERBEETLE_URL)
    logger.info("Reconciliation service started")


async def shutdown():
    """Cleanup service"""
    global reconciler
    if reconciler:
        await reconciler.close()
    await close_db_pool()
    logger.info("Reconciliation service stopped")


@app.on_event("startup")
async def on_startup():
    await startup()
    # Start background reconciliation worker
    asyncio.create_task(reconciliation_worker())


@app.on_event("shutdown")
async def on_shutdown():
    await shutdown()


# ==================== Reconciliation Logic ====================

async def find_stale_transfers(
    conn: asyncpg.Connection,
    threshold_minutes: int = 30
) -> List[Dict[str, Any]]:
    """Find transfers that are stuck in intermediate states"""
    threshold = datetime.utcnow() - timedelta(minutes=threshold_minutes)
    
    # Check transfers schema
    transfers = await conn.fetch("""
        SELECT transfer_id, state, tigerbeetle_pending_id, created_at, expiration
        FROM transfers.transfers
        WHERE state IN ('RECEIVED', 'RESERVED')
        AND created_at < $1
        AND tigerbeetle_pending_id IS NOT NULL
    """, threshold)
    
    return [dict(t) for t in transfers]


async def find_state_mismatches(
    conn: asyncpg.Connection,
    reconciler: TigerBeetleReconciler,
    batch_size: int = 100
) -> List[Dict[str, Any]]:
    """Find transfers where Postgres and TigerBeetle states don't match"""
    mismatches = []
    
    # Get recent completed transfers
    transfers = await conn.fetch("""
        SELECT transfer_id, state, tigerbeetle_pending_id, tigerbeetle_transfer_id
        FROM transfers.transfers
        WHERE state IN ('COMMITTED', 'ABORTED')
        AND tigerbeetle_pending_id IS NOT NULL
        AND completed_at > NOW() - INTERVAL '1 hour'
        LIMIT $1
    """, batch_size)
    
    for transfer in transfers:
        tb_status = await reconciler.get_pending_transfer_status(
            transfer['tigerbeetle_pending_id']
        )
        
        if tb_status:
            pg_state = transfer['state']
            expected_tb = "POSTED" if pg_state == "COMMITTED" else "VOIDED"
            
            if tb_status != expected_tb and tb_status != "NOT_FOUND":
                mismatches.append({
                    "transfer_id": str(transfer['transfer_id']),
                    "postgres_state": pg_state,
                    "tigerbeetle_state": tb_status,
                    "expected_tigerbeetle": expected_tb
                })
    
    return mismatches


async def reconcile_stale_transfer(
    conn: asyncpg.Connection,
    reconciler: TigerBeetleReconciler,
    transfer: Dict[str, Any]
) -> ReconciliationResult:
    """Reconcile a single stale transfer"""
    transfer_id = str(transfer['transfer_id'])
    pending_id = transfer['tigerbeetle_pending_id']
    
    result = ReconciliationResult(
        transfer_id=transfer_id,
        action="none",
        success=True,
        message="",
        postgres_state=transfer['state']
    )
    
    # Get TigerBeetle status
    tb_status = await reconciler.get_pending_transfer_status(pending_id)
    result.tigerbeetle_state = tb_status
    
    if tb_status == "POSTED":
        # TigerBeetle shows committed
        if transfer['state'] != "COMMITTED":
            await conn.execute("""
                UPDATE transfers.transfers
                SET state = 'COMMITTED', updated_at = NOW(), completed_at = NOW()
                WHERE transfer_id = $1
            """, transfer['transfer_id'])
            result.action = "updated_to_committed"
            result.message = f"Reconciled from {transfer['state']} to COMMITTED"
    
    elif tb_status == "VOIDED":
        # TigerBeetle shows aborted
        if transfer['state'] not in ("ABORTED", "EXPIRED"):
            await conn.execute("""
                UPDATE transfers.transfers
                SET state = 'ABORTED', updated_at = NOW(), completed_at = NOW(),
                    error_code = 'RECONCILED', error_description = 'Reconciled from TigerBeetle VOIDED state'
                WHERE transfer_id = $1
            """, transfer['transfer_id'])
            result.action = "updated_to_aborted"
            result.message = f"Reconciled from {transfer['state']} to ABORTED"
    
    elif tb_status == "PENDING":
        # Still pending - check expiration
        if transfer.get('expiration') and datetime.utcnow() > transfer['expiration']:
            # Expired - void in TigerBeetle
            try:
                void_key = generate_idempotency_key("void", transfer_id, "reconciliation")
                await reconciler.client.post(
                    f"{reconciler.tigerbeetle_url}/transfers/pending/void",
                    json={
                        "pending_transfer_id": pending_id,
                        "idempotency_key": void_key
                    }
                )
                await conn.execute("""
                    UPDATE transfers.transfers
                    SET state = 'EXPIRED', updated_at = NOW(), completed_at = NOW(),
                        error_code = 'EXPIRED', error_description = 'Transfer expired during reconciliation'
                    WHERE transfer_id = $1
                """, transfer['transfer_id'])
                result.action = "voided_expired"
                result.message = "Voided expired pending transfer"
            except Exception as e:
                result.success = False
                result.message = f"Failed to void expired transfer: {e}"
        else:
            result.action = "still_pending"
            result.message = "Transfer still pending in TigerBeetle"
    
    elif tb_status == "NOT_FOUND":
        # Pending transfer not found - orphan
        result.action = "orphan_detected"
        result.message = "Pending transfer not found in TigerBeetle"
        
        # Mark as aborted with error
        await conn.execute("""
            UPDATE transfers.transfers
            SET state = 'ABORTED', updated_at = NOW(), completed_at = NOW(),
                error_code = 'ORPHAN', error_description = 'Pending transfer not found in TigerBeetle'
            WHERE transfer_id = $1 AND state NOT IN ('COMMITTED', 'ABORTED')
        """, transfer['transfer_id'])
    
    else:
        result.success = False
        result.message = f"Unknown TigerBeetle status: {tb_status}"
    
    return result


async def run_reconciliation(batch_size: int = 100) -> ReconciliationReport:
    """Run a full reconciliation cycle"""
    global last_run
    
    report = ReconciliationReport(
        run_id=generate_idempotency_key("reconciliation", datetime.utcnow().isoformat()),
        started_at=datetime.utcnow()
    )
    
    pool = await get_db_pool()
    
    async with pool.primary.acquire() as conn:
        # Find stale transfers
        stale_transfers = await find_stale_transfers(
            conn, config.STALE_TRANSFER_THRESHOLD_MINUTES
        )
        
        logger.info(f"Found {len(stale_transfers)} stale transfers to reconcile")
        
        for transfer in stale_transfers[:batch_size]:
            try:
                result = await reconcile_stale_transfer(conn, reconciler, transfer)
                report.results.append(result)
                report.total_processed += 1
                
                if result.success:
                    report.successful += 1
                else:
                    report.failed += 1
                
                if result.action in ("updated_to_committed", "updated_to_aborted"):
                    report.state_mismatches += 1
                elif result.action == "orphan_detected":
                    report.orphans_detected += 1
                    
            except Exception as e:
                logger.error(f"Failed to reconcile transfer {transfer['transfer_id']}: {e}")
                report.failed += 1
                report.results.append(ReconciliationResult(
                    transfer_id=str(transfer['transfer_id']),
                    action="error",
                    success=False,
                    message=str(e)
                ))
        
        # Process reconciliation queue
        queue_results = await reconciler.process_reconciliation_queue(
            conn, "transfers", batch_size
        )
        
        for qr in queue_results:
            report.total_processed += 1
            if qr.get("success", False):
                report.successful += 1
            else:
                report.failed += 1
    
    report.completed_at = datetime.utcnow()
    last_run = report
    
    logger.info(
        f"Reconciliation completed: {report.total_processed} processed, "
        f"{report.successful} successful, {report.failed} failed, "
        f"{report.state_mismatches} mismatches, {report.orphans_detected} orphans"
    )
    
    return report


async def reconciliation_worker():
    """Background worker for periodic reconciliation"""
    global is_running
    
    while True:
        try:
            is_running = True
            await run_reconciliation(config.BATCH_SIZE)
        except Exception as e:
            logger.error(f"Reconciliation worker error: {e}")
        finally:
            is_running = False
        
        await asyncio.sleep(config.RECONCILIATION_INTERVAL)


# ==================== API Endpoints ====================

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    pool = await get_db_pool()
    db_health = await pool.health_check()
    
    return {
        "status": "healthy" if db_health["primary"] else "unhealthy",
        "database": db_health,
        "reconciler_running": is_running,
        "last_run": last_run.dict() if last_run else None
    }


@app.post("/reconcile")
async def trigger_reconciliation(background_tasks: BackgroundTasks):
    """Trigger manual reconciliation"""
    if is_running:
        raise HTTPException(status_code=409, detail="Reconciliation already in progress")
    
    background_tasks.add_task(run_reconciliation, config.BATCH_SIZE)
    
    return {"message": "Reconciliation triggered", "status": "started"}


@app.get("/status")
async def get_status():
    """Get reconciliation status"""
    return {
        "is_running": is_running,
        "last_run": last_run.dict() if last_run else None,
        "config": {
            "interval_seconds": config.RECONCILIATION_INTERVAL,
            "batch_size": config.BATCH_SIZE,
            "stale_threshold_minutes": config.STALE_TRANSFER_THRESHOLD_MINUTES
        }
    }


@app.get("/report")
async def get_last_report():
    """Get last reconciliation report"""
    if not last_run:
        raise HTTPException(status_code=404, detail="No reconciliation has run yet")
    
    return last_run.dict()


@app.get("/stale-transfers")
async def get_stale_transfers():
    """Get list of stale transfers"""
    pool = await get_db_pool()
    
    async with pool.primary.acquire() as conn:
        transfers = await find_stale_transfers(
            conn, config.STALE_TRANSFER_THRESHOLD_MINUTES
        )
    
    return {
        "count": len(transfers),
        "threshold_minutes": config.STALE_TRANSFER_THRESHOLD_MINUTES,
        "transfers": transfers
    }


@app.post("/reconcile/{transfer_id}")
async def reconcile_single_transfer(transfer_id: str):
    """Reconcile a single transfer"""
    pool = await get_db_pool()
    
    async with pool.primary.acquire() as conn:
        transfer = await conn.fetchrow("""
            SELECT transfer_id, state, tigerbeetle_pending_id, created_at, expiration
            FROM transfers.transfers
            WHERE transfer_id = $1
        """, transfer_id)
        
        if not transfer:
            raise HTTPException(status_code=404, detail="Transfer not found")
        
        if not transfer['tigerbeetle_pending_id']:
            raise HTTPException(
                status_code=400, 
                detail="Transfer has no TigerBeetle pending ID"
            )
        
        result = await reconcile_stale_transfer(conn, reconciler, dict(transfer))
    
    return result.dict()


# ==================== Position Reconciliation ====================

@app.post("/reconcile/positions/{fsp_id}")
async def reconcile_participant_positions(fsp_id: str):
    """Reconcile participant positions with TigerBeetle"""
    pool = await get_db_pool()
    
    async with pool.primary.acquire() as conn:
        # Get Postgres position
        pg_position = await conn.fetchrow("""
            SELECT value as position
            FROM central_ledger.participant_positions
            WHERE fsp_id = $1 AND position_type = 'POSITION'
        """, fsp_id)
        
        if not pg_position:
            raise HTTPException(status_code=404, detail="Participant not found")
        
        # Get participant's TigerBeetle account
        participant = await conn.fetchrow("""
            SELECT tigerbeetle_account_id
            FROM central_ledger.participants
            WHERE fsp_id = $1
        """, fsp_id)
        
        if not participant or not participant['tigerbeetle_account_id']:
            raise HTTPException(
                status_code=400,
                detail="Participant has no TigerBeetle account"
            )
        
        # Get TigerBeetle balance
        try:
            response = await reconciler.client.get(
                f"{reconciler.tigerbeetle_url}/accounts/{participant['tigerbeetle_account_id']}/balance"
            )
            
            if response.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail="Failed to get TigerBeetle balance"
                )
            
            tb_balance = response.json()
            tb_position = Decimal(str(tb_balance.get("available_balance", 0)))
            
        except httpx.RequestError as e:
            raise HTTPException(
                status_code=502,
                detail=f"TigerBeetle connection error: {e}"
            )
        
        pg_pos = pg_position['position']
        difference = tb_position - pg_pos
        
        result = {
            "fsp_id": fsp_id,
            "postgres_position": str(pg_pos),
            "tigerbeetle_position": str(tb_position),
            "difference": str(difference),
            "in_sync": abs(difference) < Decimal("0.01"),
            "action": "none"
        }
        
        if abs(difference) >= Decimal("0.01"):
            # Update Postgres to match TigerBeetle (source of truth)
            await conn.execute("""
                UPDATE central_ledger.participant_positions
                SET value = $2, updated_at = NOW()
                WHERE fsp_id = $1 AND position_type = 'POSITION'
            """, fsp_id, tb_position)
            
            # Record in history
            await conn.execute("""
                INSERT INTO central_ledger.position_history
                (fsp_id, currency, position_type, previous_value, new_value, change_amount, reason)
                VALUES ($1, 'NGN', 'POSITION', $2, $3, $4, 'Reconciliation with TigerBeetle')
            """, fsp_id, pg_pos, tb_position, difference)
            
            result["action"] = "updated_position"
            result["message"] = f"Updated position from {pg_pos} to {tb_position}"
        
        return result


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=config.PORT)
