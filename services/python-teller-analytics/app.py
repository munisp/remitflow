"""
RemitFlow Teller-Fraud Analytics
─────────────────────────────────────────────────────────────────────────────
SPEC-wave12 §4.9 / G10 (owner: B7).

Computes per-teller fraud signals over a rolling window and upserts them into
`teller_fraud_signals` (ON CONFLICT (tenant_id, teller_user_id, signal_type,
window_start) DO UPDATE score/evidence — analyst `status` is preserved).

Signals:
  (a) variance_pattern        — ≥3 drawer sessions with |variance| in the
                                smallest decile of ticket sizes.
                                SKIPPED HONESTLY: the schema has no
                                drawer-session variance source (verified:
                                bdc_teller_drawers has no session/variance
                                columns and no bdc_drawer_sessions /
                                drawer-adjustment table exists anywhere in
                                the repo).
  (b) out_of_hours            — reversals outside 07:00–20:00 Africa/Lagos
                                ≥ 20% of the teller's activity (noise floor:
                                ≥3 out-of-hours events). Source: reversed
                                bdc_transactions only — no drawer-adjustment
                                table exists (same discovery as (a)).
  (c) reversal_concentration  — teller's share of the tenant's reversals
                                (maker OR checker) > mean + 3σ across tellers.
  (d) counterfeit_concentration — same 3σ rule over bdc_counterfeit_register
                                reports (detected_by_user_id).

Auth: x-internal-token header vs INTERNAL_API_TOKEN (constant-time compare).
Boot refuses to start without DATABASE_URL and INTERNAL_API_TOKEN (fail-closed,
mirrors services/python-refund-engine).
"""

import hmac
import logging
import os
import statistics
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

# ── PostgreSQL persistence ──────────────────────────────────────────────
import psycopg2
import psycopg2.extras


def _require_env(name: str) -> str:
    """Return the env var or fail loudly; never fall back to well-known defaults."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"[python-teller-analytics] {name} is not set. Refusing to fall back to "
            "well-known default credentials; configure it explicitly."
        )
    return value


_DB_URL = _require_env("DATABASE_URL")
_db_conn = None


def _get_db():
    global _db_conn
    if _db_conn is None or _db_conn.closed:
        _db_conn = psycopg2.connect(_DB_URL)
        _db_conn.autocommit = True
    return _db_conn


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("teller-analytics")

app = FastAPI(title="RemitFlow Teller-Fraud Analytics", version="1.0.0")

# ── Internal auth (fail-closed) ───────────────────────────────────────────────
INTERNAL_API_TOKEN = os.getenv("INTERNAL_API_TOKEN")
if not INTERNAL_API_TOKEN:
    raise RuntimeError(
        "INTERNAL_API_TOKEN is not set: refusing to start — an unset token would "
        "leave these endpoints unauthenticated. Configure it explicitly."
    )


def require_internal_auth(x_internal_token: Optional[str] = Header(default=None)) -> None:
    if not INTERNAL_API_TOKEN:
        raise HTTPException(status_code=503, detail="INTERNAL_API_TOKEN is not configured; endpoint disabled")
    if not x_internal_token or not hmac.compare_digest(x_internal_token, INTERNAL_API_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid or missing internal API token")


# ── Models ────────────────────────────────────────────────────────────────────

class RunRequest(BaseModel):
    tenant_id: Optional[int] = None  # null → all tenants (nightly scan)
    window_days: int = Field(default=30, ge=1, le=90)


class RunResponse(BaseModel):
    signals_written: int
    window_start: str
    window_end: str
    skipped: list[str]


# ── Signal computation ────────────────────────────────────────────────────────

# Lagos business window: 07:00–20:00 WAT (Africa/Lagos == UTC+1, no DST).
BUSINESS_START_HOUR = 7
BUSINESS_END_HOUR = 20
OUT_OF_HOURS_MIN_SHARE = 0.20
OUT_OF_HOURS_MIN_EVENTS = 3  # noise floor — a 1/1 share must not flag
CONCENTRATION_SIGMA = 3.0


def _tenant_clause(tenant_id: Optional[int]) -> tuple[str, tuple]:
    return (" AND tenant_id = %s", (tenant_id,)) if tenant_id is not None else ("", ())


def _upsert_signal(cur, tenant_id: int, teller_user_id: int, signal_type: str,
                   window_start: date, window_end: date, score: float, evidence: dict) -> None:
    """Idempotent upsert — score/evidence refresh, analyst status preserved."""
    cur.execute(
        """INSERT INTO teller_fraud_signals
             (tenant_id, teller_user_id, window_start, window_end, signal_type, score, evidence, status)
           VALUES (%s, %s, %s, %s, %s, %s, %s, 'open')
           ON CONFLICT (tenant_id, teller_user_id, signal_type, window_start)
           DO UPDATE SET score = EXCLUDED.score,
                         evidence = EXCLUDED.evidence,
                         window_end = EXCLUDED.window_end""",
        (tenant_id, teller_user_id, window_start, window_end, signal_type,
         round(score, 3), psycopg2.extras.Json(evidence)),
    )


def _out_of_hours_signals(cur, window_start: date, window_end: date,
                          tenant_id: Optional[int]) -> list[tuple[int, int, float, dict]]:
    """(b) reversals outside 07:00–20:00 Africa/Lagos ≥20% of teller activity.

    created_at/updated_at are `timestamp` columns written in UTC by the node
    service, so `(col AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Lagos'` renders
    the true Lagos wall-clock hour.
    """
    clause, params = _tenant_clause(tenant_id)
    cur.execute(
        f"""SELECT tenant_id, maker_id,
                   COUNT(*) AS total_activity,
                   COUNT(*) FILTER (
                     WHERE status = 'reversed' AND (
                       EXTRACT(HOUR FROM (updated_at AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Lagos') < %s
                       OR EXTRACT(HOUR FROM (updated_at AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Lagos') >= %s
                     )
                   ) AS out_of_hours_events
            FROM bdc_transactions
            WHERE created_at >= %s AND created_at < %s{clause}
            GROUP BY tenant_id, maker_id""",
        (BUSINESS_START_HOUR, BUSINESS_END_HOUR, window_start, window_end, *params),
    )
    signals = []
    for tenant, teller, total, ooh in cur.fetchall():
        if not teller or not total:
            continue
        share = ooh / total
        if ooh >= OUT_OF_HOURS_MIN_EVENTS and share >= OUT_OF_HOURS_MIN_SHARE:
            signals.append((tenant, teller, share * 100.0, {
                "out_of_hours_events": int(ooh),
                "total_activity": int(total),
                "share": round(share, 4),
                "business_window": "07:00-20:00 Africa/Lagos",
                # Honest source note: drawer adjustments would belong here too,
                # but no drawer-adjustment table exists in the schema.
                "source": "bdc_transactions reversals only (no drawer-adjustment source table exists)",
            }))
    return signals


def _concentration_signals(rows: list[tuple[int, int, int]], sigma: float,
                           min_events: int) -> list[tuple[int, int, float, dict]]:
    """3σ share-of-tenant concentration over (tenant, teller, count) rows."""
    by_tenant: dict[int, dict[int, int]] = {}
    for tenant, teller, count in rows:
        if teller:
            by_tenant.setdefault(tenant, {}).setdefault(teller, 0)
            by_tenant[tenant][teller] += count

    signals = []
    for tenant, teller_counts in by_tenant.items():
        total = sum(teller_counts.values())
        if total < min_events or len(teller_counts) < 2:
            continue  # 3σ over a single actor is meaningless — honest skip
        shares = {t: c / total for t, c in teller_counts.items()}
        values = list(shares.values())
        mean = statistics.fmean(values)
        sd = statistics.pstdev(values)
        if sd == 0:
            continue
        for teller, share in shares.items():
            z = (share - mean) / sd
            if share > mean + sigma * sd:
                signals.append((tenant, teller, z, {
                    "teller_events": teller_counts[teller],
                    "tenant_events": total,
                    "share": round(share, 4),
                    "mean_share": round(mean, 4),
                    "stddev_share": round(sd, 4),
                    "sigma_threshold": sigma,
                    "z_score": round(z, 3),
                }))
    return signals


def _reversal_concentration(cur, window_start: date, window_end: date,
                            tenant_id: Optional[int]):
    """(c) reversal concentration — a reversal counts for BOTH its maker and
    its checker (either chair may be the anomaly)."""
    clause, params = _tenant_clause(tenant_id)
    cur.execute(
        f"""SELECT tenant_id, maker_id, checker_id
            FROM bdc_transactions
            WHERE status = 'reversed' AND created_at >= %s AND created_at < %s{clause}""",
        (window_start, window_end, *params),
    )
    rows: list[tuple[int, int, int]] = []
    for tenant, maker, checker in cur.fetchall():
        if maker:
            rows.append((tenant, maker, 1))
        if checker and checker != maker:
            rows.append((tenant, checker, 1))
    return _concentration_signals(rows, CONCENTRATION_SIGMA, min_events=2)


def _counterfeit_concentration(cur, window_start: date, window_end: date,
                               tenant_id: Optional[int]):
    """(d) counterfeit report concentration (detected_by_user_id)."""
    clause, params = _tenant_clause(tenant_id)
    cur.execute(
        f"""SELECT tenant_id, detected_by_user_id, COUNT(*)
            FROM bdc_counterfeit_register
            WHERE created_at >= %s AND created_at < %s{clause}
            GROUP BY tenant_id, detected_by_user_id""",
        (window_start, window_end, *params),
    )
    rows = [(t, u, c) for t, u, c in cur.fetchall()]
    return _concentration_signals(rows, CONCENTRATION_SIGMA, min_events=2)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post("/analytics/teller-fraud/run", response_model=RunResponse)
async def run_teller_fraud_scan(req: RunRequest, _auth: None = Depends(require_internal_auth)):
    window_end = datetime.now(timezone.utc).date()
    window_start = window_end - timedelta(days=req.window_days)
    skipped: list[str] = []
    signals_written = 0

    conn = _get_db()
    with conn.cursor() as cur:
        # (a) variance_pattern — SKIPPED HONESTLY. Verified at implementation
        # time: bdc_teller_drawers has no session/variance columns and no
        # bdc_drawer_sessions / drawer-adjustment table exists anywhere in the
        # repo (drizzle/schema.ts + all migrations + all services).
        skipped.append(
            "variance_pattern: no drawer-session variance source exists "
            "(bdc_teller_drawers has no session/variance columns; no "
            "bdc_drawer_sessions or drawer-adjustment table in schema)"
        )

        for tenant, teller, score, evidence in _out_of_hours_signals(
            cur, window_start, window_end, req.tenant_id
        ):
            _upsert_signal(cur, tenant, teller, "out_of_hours", window_start, window_end, score, evidence)
            signals_written += 1

        for tenant, teller, score, evidence in _reversal_concentration(
            cur, window_start, window_end, req.tenant_id
        ):
            _upsert_signal(cur, tenant, teller, "reversal_concentration", window_start, window_end, score, evidence)
            signals_written += 1

        for tenant, teller, score, evidence in _counterfeit_concentration(
            cur, window_start, window_end, req.tenant_id
        ):
            _upsert_signal(cur, tenant, teller, "counterfeit_concentration", window_start, window_end, score, evidence)
            signals_written += 1

    logger.info(
        "teller-fraud run complete: tenant=%s window=%s..%s signals=%d skipped=%d",
        req.tenant_id, window_start, window_end, signals_written, len(skipped),
    )
    return RunResponse(
        signals_written=signals_written,
        window_start=window_start.isoformat(),
        window_end=window_end.isoformat(),
        skipped=skipped,
    )


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "teller-analytics"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("TELLER_ANALYTICS_PORT", "8230"))
    uvicorn.run(app, host="0.0.0.0", port=port)
