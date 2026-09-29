"""
RemitFlow KYC Pipeline — PostgreSQL persistence (wave-15, G5)

PG table `kyc_pipeline_results` (drizzle/0095_kyc_wave15.sql) is the SOURCE
OF TRUTH for every pipeline stage result, replacing the in-memory
kyc_results dict. `simulated=true` rows are honest failure markers and must
never count as success downstream.

FAIL-CLOSED: DATABASE_URL missing or any PG error raises PersistenceError;
callers (FastAPI handlers) map that to HTTP 503. There is no silent
in-memory fallback for durability.

Repo convention (see services/python-kyc-liveness/main.py, SPEC-wave14
§4.6): statement_timeout=5000 applied to every connection; credentials come
from DATABASE_URL only, never defaults. asyncpg is used because it is
already pinned in this service's requirements.txt.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Optional

logger = logging.getLogger("kyc-pipeline.db")

_STATEMENT_TIMEOUT_MS = "5000"  # SPEC-wave14 §4.6 repo convention

_pool = None


class PersistenceError(RuntimeError):
    """PG unavailable / misconfigured → callers must fail closed (503)."""


def _require_env(name: str) -> str:
    """Return the env var or fail loudly; never fall back to default credentials."""
    value = os.getenv(name)
    if not value:
        raise PersistenceError(
            f"[python-kyc-pipeline] {name} is not set. Refusing to fall back to "
            "well-known default credentials; configure it explicitly."
        )
    return value


async def init_pool():
    """Create the asyncpg pool (idempotent). Raises PersistenceError on failure."""
    global _pool
    if _pool is not None:
        return _pool
    try:
        import asyncpg
    except ImportError as e:
        raise PersistenceError(f"asyncpg not installed: {e}") from e
    dsn = _require_env("DATABASE_URL")
    try:
        _pool = await asyncpg.create_pool(
            dsn,
            min_size=1,
            max_size=10,
            server_settings={"statement_timeout": _STATEMENT_TIMEOUT_MS},
        )
        logger.info("[db] asyncpg pool created (statement_timeout=%sms)", _STATEMENT_TIMEOUT_MS)
        return _pool
    except Exception as e:
        logger.error(f"[db] pool creation failed: {e}")
        raise PersistenceError(f"pg_pool_unavailable: {e}") from e


async def close_pool():
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def _get_pool():
    if _pool is None:
        await init_pool()
    return _pool


_INSERT_SQL = """
INSERT INTO kyc_pipeline_results
    ("userId", session_id, stage, model, success, simulated, score, details)
VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb)
"""


async def persist_stage_result(
    user_id: Optional[int],
    session_id: str,
    stage: str,
    model: Optional[str],
    success: bool,
    simulated: bool,
    score: Optional[float],
    details: dict,
) -> None:
    """Insert one stage row. Raises PersistenceError (fail-closed) on failure."""
    try:
        pool = await _get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                _INSERT_SQL,
                user_id, session_id, stage, model,
                bool(success), bool(simulated),
                float(score) if score is not None else None,
                json.dumps(details or {}),
            )
    except PersistenceError:
        raise
    except Exception as e:
        logger.error(f"[db] persist_stage_result failed (stage={stage}): {e}")
        raise PersistenceError(f"pg_insert_failed: {e}") from e


async def persist_stage_results(user_id: Optional[int], session_id: str,
                                stages: list[dict]) -> None:
    """Insert all stage rows for a submission in one transaction."""
    try:
        pool = await _get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                for s in stages:
                    await conn.execute(
                        _INSERT_SQL,
                        user_id, session_id, s.get("stage", "unknown"),
                        s.get("model"), bool(s.get("success", False)),
                        bool(s.get("simulated", False)),
                        float(s["score"]) if s.get("score") is not None else None,
                        json.dumps(s.get("details") or {}),
                    )
    except PersistenceError:
        raise
    except Exception as e:
        logger.error(f"[db] persist_stage_results failed: {e}")
        raise PersistenceError(f"pg_insert_failed: {e}") from e


async def get_submission(session_id: str) -> Optional[dict]:
    """Fetch the 'final' stage row for a submission (source of truth)."""
    try:
        pool = await _get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT stage, model, success, simulated, score, details, created_at
                   FROM kyc_pipeline_results
                   WHERE session_id = $1::uuid AND stage = 'final'
                   ORDER BY created_at DESC LIMIT 1""",
                session_id,
            )
            if row is None:
                return None
            out = dict(row)
            out["details"] = json.loads(out["details"]) if isinstance(out["details"], str) else out["details"]
            out["created_at"] = out["created_at"].isoformat() if out.get("created_at") else None
            return out
    except PersistenceError:
        raise
    except Exception as e:
        logger.error(f"[db] get_submission failed: {e}")
        raise PersistenceError(f"pg_query_failed: {e}") from e


async def list_user_submissions(user_id: int, limit: int = 50) -> list[dict]:
    """List 'final' stage rows for a user (source of truth)."""
    try:
        pool = await _get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT session_id::text AS session_id, success, simulated,
                          score, details, created_at
                   FROM kyc_pipeline_results
                   WHERE "userId" = $1 AND stage = 'final'
                   ORDER BY created_at DESC LIMIT $2""",
                user_id, limit,
            )
            out = []
            for r in rows:
                d = dict(r)
                d["details"] = json.loads(d["details"]) if isinstance(d["details"], str) else d["details"]
                d["created_at"] = d["created_at"].isoformat() if d.get("created_at") else None
                out.append(d)
            return out
    except PersistenceError:
        raise
    except Exception as e:
        logger.error(f"[db] list_user_submissions failed: {e}")
        raise PersistenceError(f"pg_query_failed: {e}") from e
