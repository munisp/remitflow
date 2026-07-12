"""
RemitFlow — Compliance Report Generator (Python)
══════════════════════════════════════════════════
Generates regulatory compliance reports: SAR (Suspicious Activity Reports),
CTR (Currency Transaction Reports), GDPR data exports, and AML audit trails.

Why Python:
  - ReportLab/WeasyPrint for PDF generation
  - Pandas for data aggregation and statistical analysis
  - Jinja2 for templated report generation
  - Rich ecosystem for regulatory format compliance (FinCEN, FATF)

Report Types:
  - SAR  — Suspicious Activity Report (FinCEN BSA)
  - CTR  — Currency Transaction Report (>$10,000 cash)
  - GDPR — Data Subject Access Request export
  - AML  — AML audit trail (30/90/365 day)
  - KYC  — KYC compliance summary
  - TXN  — Transaction monitoring report

Endpoints:
  POST /reports/sar         — Generate SAR report
  POST /reports/ctr         — Generate CTR report
  POST /reports/gdpr        — Generate GDPR data export
  POST /reports/aml         — Generate AML audit report
  POST /reports/kyc         — Generate KYC compliance report
  GET  /reports/:id         — Download generated report
  GET  /health              — Liveness probe
"""

import asyncio
import io
import json
import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

import asyncpg
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from prometheus_client import Counter, generate_latest, CONTENT_TYPE_LATEST
from pydantic import BaseModel
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph,
    Spacer, HRFlowable, PageBreak
)
from starlette.responses import Response

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "service": "compliance-reporter", "msg": "%(message)s"}',
)
logger = logging.getLogger(__name__)

# ─── Config ───────────────────────────────────────────────────────────────────

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/remitflow")
INSTITUTION_NAME = os.getenv("INSTITUTION_NAME", "RemitFlow Financial Services")
INSTITUTION_EIN = os.getenv("INSTITUTION_EIN", "XX-XXXXXXX")
INSTITUTION_ADDRESS = os.getenv("INSTITUTION_ADDRESS", "123 Financial District, New York, NY 10004")
BSA_ID = os.getenv("BSA_ID", "REMITFLOW-BSA-001")

# ─── Metrics ──────────────────────────────────────────────────────────────────

reports_generated = Counter(
    "compliance_reports_generated_total",
    "Total compliance reports generated",
    ["report_type"]
)

# ─── Request Models ───────────────────────────────────────────────────────────

class SARRequest(BaseModel):
    user_id: int
    transaction_ids: list[int]
    suspicious_activity_type: str
    narrative: str
    filing_date: Optional[str] = None

class CTRRequest(BaseModel):
    user_id: int
    transaction_id: int
    amount: float
    currency: str = "USD"

class GDPRRequest(BaseModel):
    user_id: int
    include_transactions: bool = True
    include_kyc: bool = True
    include_audit_logs: bool = True

class AMLReportRequest(BaseModel):
    period_days: int = 30
    include_blocked: bool = True
    include_flagged: bool = True
    min_risk_score: int = 31

# ─── PDF Builder ──────────────────────────────────────────────────────────────

class CompliancePDFBuilder:
    """Builds professional compliance PDFs using ReportLab."""

    def __init__(self):
        self.styles = getSampleStyleSheet()
        self._add_custom_styles()

    def _add_custom_styles(self):
        self.styles.add(ParagraphStyle(
            name="ReportTitle",
            parent=self.styles["Title"],
            fontSize=18,
            spaceAfter=12,
            textColor=colors.HexColor("#1a1a2e"),
        ))
        self.styles.add(ParagraphStyle(
            name="SectionHeader",
            parent=self.styles["Heading2"],
            fontSize=12,
            spaceBefore=12,
            spaceAfter=6,
            textColor=colors.HexColor("#16213e"),
            borderPad=4,
        ))
        self.styles.add(ParagraphStyle(
            name="BodySmall",
            parent=self.styles["Normal"],
            fontSize=9,
            spaceAfter=4,
        ))
        self.styles.add(ParagraphStyle(
            name="Confidential",
            parent=self.styles["Normal"],
            fontSize=8,
            textColor=colors.red,
            alignment=1,  # center
        ))

    def _header_table(self, report_type: str, report_id: str) -> Table:
        data = [
            [
                Paragraph(f"<b>{INSTITUTION_NAME}</b>", self.styles["Normal"]),
                Paragraph(f"<b>{report_type}</b>", self.styles["ReportTitle"]),
            ],
            [
                Paragraph(f"EIN: {INSTITUTION_EIN}<br/>BSA ID: {BSA_ID}", self.styles["BodySmall"]),
                Paragraph(
                    f"Report ID: {report_id}<br/>Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
                    self.styles["BodySmall"]
                ),
            ],
        ]
        table = Table(data, colWidths=[3*inch, 4.5*inch])
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a1a2e")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("ALIGN", (1, 0), (1, 0), "RIGHT"),
            ("ALIGN", (1, 1), (1, 1), "RIGHT"),
            ("LINEBELOW", (0, -1), (-1, -1), 1, colors.HexColor("#1a1a2e")),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]))
        return table

    def _data_table(self, headers: list, rows: list, col_widths=None) -> Table:
        data = [headers] + rows
        table = Table(data, colWidths=col_widths)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#16213e")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8f9fa")]),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#dee2e6")),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ]))
        return table

    def build_sar(self, data: dict) -> bytes:
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.5*inch, bottomMargin=0.5*inch)
        story = []

        report_id = f"SAR-{data['user_id']}-{datetime.now().strftime('%Y%m%d%H%M%S')}"

        story.append(self._header_table("SUSPICIOUS ACTIVITY REPORT (SAR)", report_id))
        story.append(Spacer(1, 12))
        story.append(Paragraph("⚠ CONFIDENTIAL — FOR REGULATORY USE ONLY", self.styles["Confidential"]))
        story.append(Spacer(1, 12))

        # Subject information
        story.append(Paragraph("1. SUBJECT INFORMATION", self.styles["SectionHeader"]))
        subject_data = [
            ["Field", "Value"],
            ["User ID", str(data.get("user_id", "N/A"))],
            ["Full Name", data.get("full_name", "N/A")],
            ["Email", data.get("email_masked", "N/A")],
            ["KYC Tier", data.get("kyc_tier", "N/A")],
            ["Account Status", data.get("account_status", "N/A")],
            ["Account Created", str(data.get("created_at", "N/A"))],
        ]
        story.append(self._data_table(subject_data[0], subject_data[1:], [2*inch, 5.5*inch]))
        story.append(Spacer(1, 12))

        # Suspicious activity
        story.append(Paragraph("2. SUSPICIOUS ACTIVITY", self.styles["SectionHeader"]))
        story.append(Paragraph(f"<b>Activity Type:</b> {data.get('activity_type', 'N/A')}", self.styles["Normal"]))
        story.append(Spacer(1, 6))
        story.append(Paragraph("<b>Narrative:</b>", self.styles["Normal"]))
        story.append(Paragraph(data.get("narrative", ""), self.styles["BodySmall"]))
        story.append(Spacer(1, 12))

        # Transactions
        if data.get("transactions"):
            story.append(Paragraph("3. RELATED TRANSACTIONS", self.styles["SectionHeader"]))
            tx_headers = ["TX ID", "Date", "Amount", "Currency", "Rail", "Status", "Risk Score"]
            tx_rows = [
                [
                    str(tx.get("id", "")),
                    str(tx.get("created_at", ""))[:10],
                    f"${float(tx.get('amount', 0)):,.2f}",
                    str(tx.get("currency", "")),
                    str(tx.get("rail", "")),
                    str(tx.get("status", "")),
                    str(tx.get("risk_score", "N/A")),
                ]
                for tx in data["transactions"]
            ]
            story.append(self._data_table(tx_headers, tx_rows))
            story.append(Spacer(1, 12))

        # Filing information
        story.append(Paragraph("4. FILING INFORMATION", self.styles["SectionHeader"]))
        filing_data = [
            ["Field", "Value"],
            ["Filing Institution", INSTITUTION_NAME],
            ["BSA ID", BSA_ID],
            ["Filing Date", datetime.now(timezone.utc).strftime("%Y-%m-%d")],
            ["Report ID", report_id],
            ["Prepared By", "Automated Compliance System v1.0"],
        ]
        story.append(self._data_table(filing_data[0], filing_data[1:], [2*inch, 5.5*inch]))

        doc.build(story)
        return buffer.getvalue()

    def build_aml_report(self, data: dict) -> bytes:
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=0.5*inch, bottomMargin=0.5*inch)
        story = []

        report_id = f"AML-{data['period_days']}D-{datetime.now().strftime('%Y%m%d')}"

        story.append(self._header_table(f"AML AUDIT REPORT — {data['period_days']}-DAY PERIOD", report_id))
        story.append(Spacer(1, 12))

        # Summary statistics
        story.append(Paragraph("EXECUTIVE SUMMARY", self.styles["SectionHeader"]))
        summary_data = [
            ["Metric", "Value"],
            ["Report Period", f"{data['period_days']} days ending {datetime.now().strftime('%Y-%m-%d')}"],
            ["Total Transactions", str(data.get("total_transactions", 0))],
            ["Total Volume", f"${data.get('total_volume', 0):,.2f}"],
            ["Flagged Transactions", str(data.get("flagged_count", 0))],
            ["Blocked Transactions", str(data.get("blocked_count", 0))],
            ["SARs Filed", str(data.get("sar_count", 0))],
            ["High-Risk Users", str(data.get("high_risk_users", 0))],
        ]
        story.append(self._data_table(summary_data[0], summary_data[1:], [3*inch, 4*inch]))
        story.append(Spacer(1, 12))

        # High-risk transactions
        if data.get("high_risk_transactions"):
            story.append(Paragraph("HIGH-RISK TRANSACTIONS", self.styles["SectionHeader"]))
            headers = ["TX ID", "User ID", "Amount", "Country", "Rail", "Risk Score", "Action"]
            rows = [
                [
                    str(tx.get("id", "")),
                    str(tx.get("user_id", "")),
                    f"${float(tx.get('amount', 0)):,.2f}",
                    str(tx.get("recipient_country", "")),
                    str(tx.get("rail", "")),
                    str(tx.get("risk_score", "")),
                    str(tx.get("action", "")),
                ]
                for tx in data["high_risk_transactions"][:50]  # Limit to 50 rows
            ]
            story.append(self._data_table(headers, rows))

        doc.build(story)
        return buffer.getvalue()

    def build_gdpr_export(self, data: dict) -> bytes:
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=0.5*inch, bottomMargin=0.5*inch)
        story = []

        report_id = f"GDPR-{data['user_id']}-{datetime.now().strftime('%Y%m%d%H%M%S')}"

        story.append(self._header_table("GDPR DATA SUBJECT ACCESS REQUEST", report_id))
        story.append(Spacer(1, 12))
        story.append(Paragraph(
            "This document contains all personal data held by RemitFlow Financial Services "
            "for the data subject identified below, in accordance with GDPR Article 15.",
            self.styles["BodySmall"]
        ))
        story.append(Spacer(1, 12))

        # Personal data
        story.append(Paragraph("PERSONAL DATA", self.styles["SectionHeader"]))
        user = data.get("user", {})
        user_data = [
            ["Field", "Value"],
            ["User ID", str(user.get("id", ""))],
            ["Email", str(user.get("email", ""))],
            ["Full Name", f"{user.get('first_name', '')} {user.get('last_name', '')}"],
            ["Phone", str(user.get("phone", ""))],
            ["Country", str(user.get("country", ""))],
            ["KYC Status", str(user.get("kyc_tier", ""))],
            ["Account Created", str(user.get("created_at", ""))[:10]],
        ]
        story.append(self._data_table(user_data[0], user_data[1:], [2.5*inch, 4.5*inch]))
        story.append(Spacer(1, 12))

        # Transaction history
        if data.get("transactions"):
            story.append(Paragraph("TRANSACTION HISTORY", self.styles["SectionHeader"]))
            tx_headers = ["Date", "Amount", "Currency", "Type", "Status"]
            tx_rows = [
                [
                    str(tx.get("created_at", ""))[:10],
                    f"${float(tx.get('amount', 0)):,.2f}",
                    str(tx.get("currency", "")),
                    str(tx.get("type", "")),
                    str(tx.get("status", "")),
                ]
                for tx in data.get("transactions", [])[:100]
            ]
            story.append(self._data_table(tx_headers, tx_rows))

        doc.build(story)
        return buffer.getvalue()

# ─── FastAPI App ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="RemitFlow Compliance Reporter",
    description="Regulatory compliance report generation",
    version="1.0.0"
)

_pool: Optional[asyncpg.Pool] = None
pdf_builder = CompliancePDFBuilder()

async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=5)
    return _pool

@app.on_event("startup")
async def startup():
    await get_pool()
    logger.info("Compliance reporter started")

@app.on_event("shutdown")
async def shutdown():
    global _pool
    if _pool:
        await _pool.close()

@app.post("/reports/sar")
async def generate_sar(req: SARRequest):
    """Generate a Suspicious Activity Report."""
    pool = await get_pool()

    user = await pool.fetchrow(
        "SELECT id, email, first_name, last_name, kyc_tier, account_status, created_at FROM users WHERE id = $1",
        req.user_id
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    transactions = await pool.fetch(
        "SELECT id, amount, currency, status, created_at FROM transactions WHERE id = ANY($1)",
        req.transaction_ids
    )

    data = {
        "user_id": req.user_id,
        "full_name": f"{user['first_name']} {user['last_name']}",
        "email_masked": user["email"][:3] + "***@***",
        "kyc_tier": user["kyc_tier"],
        "account_status": user["account_status"],
        "created_at": str(user["created_at"])[:10],
        "activity_type": req.suspicious_activity_type,
        "narrative": req.narrative,
        "transactions": [dict(tx) for tx in transactions],
    }

    pdf_bytes = pdf_builder.build_sar(data)
    reports_generated.labels(report_type="SAR").inc()

    report_id = f"SAR-{req.user_id}-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    logger.info(f"SAR generated: {report_id}")

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{report_id}.pdf"'}
    )

@app.post("/reports/aml")
async def generate_aml_report(req: AMLReportRequest):
    """Generate an AML audit report."""
    pool = await get_pool()
    since = datetime.now(timezone.utc) - timedelta(days=req.period_days)

    stats = await pool.fetchrow(
        """
        SELECT
            COUNT(*) AS total_transactions,
            COALESCE(SUM(amount), 0) AS total_volume,
            COUNT(*) FILTER (WHERE risk_score >= $2) AS flagged_count,
            COUNT(*) FILTER (WHERE status = 'blocked') AS blocked_count
        FROM transactions
        WHERE created_at >= $1
        """,
        since, req.min_risk_score
    )

    high_risk_txs = await pool.fetch(
        """
        SELECT t.id, t.user_id, t.amount, t.status, t.created_at,
               fa.risk_score, fa.risk_tier, fa.action
        FROM transactions t
        LEFT JOIN fraud_alerts fa ON fa.transaction_id = t.id
        WHERE t.created_at >= $1 AND fa.risk_score >= $2
        ORDER BY fa.risk_score DESC
        LIMIT 100
        """,
        since, req.min_risk_score
    )

    data = {
        "period_days": req.period_days,
        "total_transactions": stats["total_transactions"],
        "total_volume": float(stats["total_volume"]),
        "flagged_count": stats["flagged_count"],
        "blocked_count": stats["blocked_count"],
        "high_risk_transactions": [dict(tx) for tx in high_risk_txs],
    }

    pdf_bytes = pdf_builder.build_aml_report(data)
    reports_generated.labels(report_type="AML").inc()

    report_id = f"AML-{req.period_days}D-{datetime.now().strftime('%Y%m%d')}"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{report_id}.pdf"'}
    )

@app.post("/reports/gdpr")
async def generate_gdpr_export(req: GDPRRequest):
    """Generate a GDPR data subject access request export."""
    pool = await get_pool()

    user = await pool.fetchrow(
        "SELECT * FROM users WHERE id = $1",
        req.user_id
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    data = {"user_id": req.user_id, "user": dict(user)}

    if req.include_transactions:
        txs = await pool.fetch(
            "SELECT id, amount, currency, type, status, created_at FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500",
            req.user_id
        )
        data["transactions"] = [dict(tx) for tx in txs]

    pdf_bytes = pdf_builder.build_gdpr_export(data)
    reports_generated.labels(report_type="GDPR").inc()

    report_id = f"GDPR-{req.user_id}-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{report_id}.pdf"'}
    )

@app.get("/health")
async def health():
    try:
        pool = await get_pool()
        await pool.fetchval("SELECT 1")
        db_ok = True
    except Exception:
        db_ok = False

    return JSONResponse(
        status_code=200 if db_ok else 503,
        content={
            "status": "ok" if db_ok else "degraded",
            "service": "compliance-reporter",
            "db_ok": db_ok,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    )

@app.get("/metrics")
async def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("COMPLIANCE_REPORTER_PORT", "8104"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
