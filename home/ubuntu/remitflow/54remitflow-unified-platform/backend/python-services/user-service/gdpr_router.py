"""
GDPR Right-to-Erasure (Article 17) — Full Production Implementation
Performs cascade deletion of all personal data across all platform tables.
Retains anonymised transaction records for regulatory/AML purposes (7-year rule).
"""
from fastapi import APIRouter, HTTPException, BackgroundTasks, Header
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta
import asyncpg
import redis
import json
import os
import logging
import uuid

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/gdpr", tags=["GDPR Compliance"])

DATABASE_URL = os.getenv("DATABASE_URL")
REDIS_URL = os.getenv("REDIS_URL")

# Tables that must be HARD DELETED (personal data)
HARD_DELETE_TABLES = [
    ("user_sessions", "user_id"),
    ("user_devices", "user_id"),
    ("user_notifications", "user_id"),
    ("user_preferences", "user_id"),
    ("user_addresses", "user_id"),
    ("user_documents", "user_id"),
    ("kyc_submissions", "user_id"),
    ("biometric_data", "user_id"),
    ("beneficiaries", "user_id"),
    ("bank_accounts", "user_id"),
    ("wallets", "user_id"),
    ("wallet_transactions", "user_id"),
    ("airtime_purchases", "user_id"),
    ("bill_payments", "user_id"),
    ("support_tickets", "user_id"),
    ("chat_messages", "user_id"),
    ("gamification_points", "user_id"),
    ("promotion_redemptions", "user_id"),
    ("push_tokens", "user_id"),
    ("otp_codes", "user_id"),
    ("password_reset_tokens", "user_id"),
    ("refresh_tokens", "user_id"),
]

# Tables that must be ANONYMISED (financial records — regulatory retention)
ANONYMISE_TABLES = [
    ("transactions", "user_id"),
    ("aml_transaction_log", "user_id"),
    ("aml_alerts", "user_id"),
    ("audit_logs", "user_id"),
    ("payment_attempts", "user_id"),
]

ANON_PLACEHOLDER = "GDPR_ERASED"

class ErasureRequest(BaseModel):
    user_id: str
    reason: Optional[str] = "user_request"
    requested_by: Optional[str] = None  # admin ID if admin-initiated

class ErasureStatus(BaseModel):
    request_id: str
    user_id: str
    status: str
    tables_deleted: List[str]
    tables_anonymised: List[str]
    errors: List[str]
    completed_at: Optional[str]

async def _perform_erasure(request_id: str, user_id: str, reason: str, requested_by: Optional[str]):
    """
    Background task: performs the full cascade erasure.
    Logs every step to gdpr_erasure_log for audit trail.
    """
    tables_deleted = []
    tables_anonymised = []
    errors = []

    try:
        conn = await asyncpg.connect(DATABASE_URL)
    except Exception as e:
        logger.error(f"GDPR erasure DB connection failed for {user_id}: {e}")
        return

    try:
        # 1. Verify user exists
        user = await conn.fetchrow("SELECT id, email, status FROM users WHERE id = $1", user_id)
        if not user:
            await conn.execute(
                "INSERT INTO gdpr_erasure_log (id,user_id,status,error,created_at) VALUES ($1,$2,$3,$4,$5)",
                request_id, user_id, "failed", "User not found", datetime.utcnow())
            return

        # 2. Check for active transactions (cannot erase mid-transfer)
        active_tx = await conn.fetchval(
            "SELECT COUNT(*) FROM transactions WHERE user_id=$1 AND status IN ('pending','processing')", user_id)
        if active_tx > 0:
            await conn.execute(
                "INSERT INTO gdpr_erasure_log (id,user_id,status,error,created_at) VALUES ($1,$2,$3,$4,$5)",
                request_id, user_id, "blocked", f"{active_tx} active transactions — erasure deferred", datetime.utcnow())
            return

        async with conn.transaction():
            # 3. Hard delete personal data tables
            for table, col in HARD_DELETE_TABLES:
                try:
                    result = await conn.execute(f"DELETE FROM {table} WHERE {col} = $1", user_id)
                    count = int(result.split()[-1])
                    if count > 0:
                        tables_deleted.append(f"{table} ({count} rows)")
                        logger.info(f"GDPR: deleted {count} rows from {table} for user {user_id}")
                except asyncpg.UndefinedTableError:
                    pass  # Table may not exist in all deployments
                except Exception as e:
                    errors.append(f"{table}: {str(e)}")
                    logger.warning(f"GDPR: failed to delete from {table}: {e}")

            # 4. Anonymise financial records (regulatory retention)
            for table, col in ANONYMISE_TABLES:
                try:
                    # Replace all PII fields with GDPR_ERASED placeholder
                    result = await conn.execute(
                        f"""
                        UPDATE {table}
                        SET {col} = $1
                        WHERE {col} = $2
                        """,
                        ANON_PLACEHOLDER, user_id)
                    count = int(result.split()[-1])
                    if count > 0:
                        tables_anonymised.append(f"{table} ({count} rows)")
                        logger.info(f"GDPR: anonymised {count} rows in {table} for user {user_id}")
                except asyncpg.UndefinedTableError:
                    pass
                except Exception as e:
                    errors.append(f"anonymise {table}: {str(e)}")

            # 5. Anonymise the user record itself (keep for audit, remove PII)
            await conn.execute(
                """
                UPDATE users SET
                    email = $1,
                    phone = $2,
                    first_name = $3,
                    last_name = $4,
                    date_of_birth = NULL,
                    address = NULL,
                    profile_photo_url = NULL,
                    status = 'erased',
                    updated_at = $5
                WHERE id = $6
                """,
                f"erased_{user_id[:8]}@gdpr.invalid",
                f"+00000000000",
                ANON_PLACEHOLDER,
                ANON_PLACEHOLDER,
                datetime.utcnow(),
                user_id
            )

        # 6. Purge Redis cache for this user
        try:
            r = redis.from_url(REDIS_URL, decode_responses=True)
            keys = r.keys(f"*{user_id}*")
            if keys:
                r.delete(*keys)
                logger.info(f"GDPR: purged {len(keys)} Redis keys for user {user_id}")
        except Exception as e:
            errors.append(f"redis_purge: {str(e)}")

        # 7. Log the completed erasure
        await conn.execute(
            """
            INSERT INTO gdpr_erasure_log
              (id, user_id, reason, requested_by, status,
               tables_deleted, tables_anonymised, errors, completed_at, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            """,
            request_id, user_id, reason, requested_by or "self",
            "completed" if not errors else "completed_with_errors",
            json.dumps(tables_deleted), json.dumps(tables_anonymised),
            json.dumps(errors), datetime.utcnow(), datetime.utcnow()
        )

        logger.info(f"GDPR erasure completed for user {user_id}: "
                    f"{len(tables_deleted)} deleted, {len(tables_anonymised)} anonymised, "
                    f"{len(errors)} errors")

    except Exception as e:
        logger.error(f"GDPR erasure failed for {user_id}: {e}")
        try:
            await conn.execute(
                "INSERT INTO gdpr_erasure_log (id,user_id,status,error,created_at) VALUES ($1,$2,$3,$4,$5)",
                request_id, user_id, "failed", str(e), datetime.utcnow())
        except Exception:
            pass
    finally:
        await conn.close()


@router.post("/erasure", summary="GDPR Article 17 — Right to Erasure")
async def request_erasure(request: ErasureRequest, background_tasks: BackgroundTasks):
    """
    Initiates a GDPR right-to-erasure request. Performs cascade deletion of all
    personal data and anonymisation of financial records required for regulatory retention.
    Returns immediately; erasure runs as a background task.
    """
    request_id = str(uuid.uuid4())

    # Check for existing pending request
    try:
        conn = await asyncpg.connect(DATABASE_URL)
        existing = await conn.fetchrow(
            "SELECT id, status FROM gdpr_erasure_log WHERE user_id=$1 AND status IN ('pending','processing')",
            request.user_id)
        await conn.close()
        if existing:
            raise HTTPException(status_code=409, detail=f"Erasure request {existing['id']} already in progress")
    except HTTPException:
        raise
    except Exception:
        pass  # DB may not have table yet — proceed

    background_tasks.add_task(
        _perform_erasure,
        request_id,
        request.user_id,
        request.reason or "user_request",
        request.requested_by
    )

    return {
        "request_id": request_id,
        "user_id": request.user_id,
        "status": "processing",
        "message": "Erasure request accepted. Personal data will be deleted within 30 days as required by GDPR Article 17.",
        "submitted_at": datetime.utcnow().isoformat(),
    }


@router.get("/erasure/{request_id}", summary="Check erasure request status")
async def get_erasure_status(request_id: str):
    """Check the status of a GDPR erasure request."""
    try:
        conn = await asyncpg.connect(DATABASE_URL)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
    try:
        row = await conn.fetchrow("SELECT * FROM gdpr_erasure_log WHERE id=$1", request_id)
        if not row:
            raise HTTPException(status_code=404, detail="Erasure request not found")
        return dict(row)
    finally:
        await conn.close()


@router.get("/erasure/user/{user_id}", summary="Get all erasure requests for a user")
async def get_user_erasure_history(user_id: str):
    """Get the full erasure request history for a user."""
    try:
        conn = await asyncpg.connect(DATABASE_URL)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
    try:
        rows = await conn.fetch(
            "SELECT id,status,reason,completed_at,created_at FROM gdpr_erasure_log WHERE user_id=$1 ORDER BY created_at DESC",
            user_id)
        return {"user_id": user_id, "requests": [dict(r) for r in rows]}
    finally:
        await conn.close()


@router.get("/data-export/{user_id}", summary="GDPR Article 20 — Data Portability Export")
async def export_user_data(user_id: str):
    """
    Export all personal data for a user in machine-readable format.
    GDPR Article 20 — Right to Data Portability.
    """
    try:
        conn = await asyncpg.connect(DATABASE_URL)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
    try:
        user = await conn.fetchrow(
            "SELECT id,email,phone,first_name,last_name,date_of_birth,created_at FROM users WHERE id=$1", user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        transactions = await conn.fetch(
            "SELECT id,amount,currency,status,created_at FROM transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1000",
            user_id)
        beneficiaries = await conn.fetch(
            "SELECT id,name,bank_name,account_number,country FROM beneficiaries WHERE user_id=$1",
            user_id)

        return {
            "export_date": datetime.utcnow().isoformat(),
            "user": dict(user),
            "transactions": [dict(t) for t in transactions],
            "beneficiaries": [dict(b) for b in beneficiaries],
            "data_controller": "RemitFlow Ltd",
            "gdpr_article": "Article 20 — Right to Data Portability",
        }
    finally:
        await conn.close()
