"""
RemitFlow PDF Receipt Generator
FastAPI + ReportLab
Port: 8086

Endpoints:
  GET  /health
  POST /receipt/transfer     — Generate transfer receipt PDF
  POST /receipt/statement    — Generate account statement PDF
  POST /receipt/kyc          — Generate KYC confirmation letter PDF
"""
from __future__ import annotations

import io
import os
import logging
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("pdf-receipt")

app = FastAPI(
    title="RemitFlow PDF Receipt Generator",
    description="Generates PDF receipts, statements, and KYC letters",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Brand Colors ─────────────────────────────────────────────────────────────
BRAND_GREEN = colors.HexColor("#10b981")
BRAND_DARK = colors.HexColor("#0f172a")
BRAND_GRAY = colors.HexColor("#64748b")
BRAND_LIGHT = colors.HexColor("#f8fafc")
BRAND_BORDER = colors.HexColor("#e2e8f0")

# ─── Models ───────────────────────────────────────────────────────────────────

class TransferReceiptRequest(BaseModel):
    transaction_id: str
    reference: str
    sender_name: str
    sender_email: str
    sender_country: str
    receiver_name: str
    receiver_bank: Optional[str] = None
    receiver_account: Optional[str] = None
    receiver_phone: Optional[str] = None
    receiver_country: str
    send_amount: float
    send_currency: str
    receive_amount: float
    receive_currency: str
    exchange_rate: float
    fee_amount: float
    fee_currency: str
    total_deducted: float
    status: str
    created_at: str
    completed_at: Optional[str] = None
    delivery_method: str = "Bank Transfer"

class StatementRequest(BaseModel):
    account_holder: str
    account_id: str
    email: str
    period_start: str
    period_end: str
    opening_balance_usd: float
    closing_balance_usd: float
    transactions: List[dict]

class KycLetterRequest(BaseModel):
    user_name: str
    user_email: str
    kyc_tier: int
    verified_at: str
    daily_limit_usd: float
    monthly_limit_usd: float
    reference_number: str

# ─── PDF Builders ─────────────────────────────────────────────────────────────

def _build_header(elements, styles, title: str, subtitle: str = ""):
    """Add RemitFlow branded header to PDF."""
    # Logo text
    logo_style = ParagraphStyle(
        "Logo",
        parent=styles["Normal"],
        fontSize=22,
        fontName="Helvetica-Bold",
        textColor=BRAND_GREEN,
        spaceAfter=2,
    )
    elements.append(Paragraph("RemitFlow", logo_style))

    tagline_style = ParagraphStyle(
        "Tagline",
        parent=styles["Normal"],
        fontSize=9,
        textColor=BRAND_GRAY,
        spaceAfter=8,
    )
    elements.append(Paragraph("Your Family Back Home Deserves the Best", tagline_style))
    elements.append(HRFlowable(width="100%", thickness=2, color=BRAND_GREEN, spaceAfter=12))

    title_style = ParagraphStyle(
        "DocTitle",
        parent=styles["Normal"],
        fontSize=16,
        fontName="Helvetica-Bold",
        textColor=BRAND_DARK,
        spaceAfter=4,
    )
    elements.append(Paragraph(title, title_style))

    if subtitle:
        sub_style = ParagraphStyle(
            "DocSubtitle",
            parent=styles["Normal"],
            fontSize=10,
            textColor=BRAND_GRAY,
            spaceAfter=16,
        )
        elements.append(Paragraph(subtitle, sub_style))

def _build_footer_text() -> str:
    return (
        "RemitFlow Ltd. · Regulated by the FCA (UK) · FCA Ref: 123456 · "
        "AML/KYC compliant · support@remitflow.io · www.remitflow.io · "
        f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}"
    )

def _kv_table(data: list[tuple[str, str]], col_widths=(80*mm, 90*mm)) -> Table:
    """Build a key-value table with brand styling."""
    table_data = [[Paragraph(f"<b>{k}</b>", getSampleStyleSheet()["Normal"]),
                   Paragraph(str(v), getSampleStyleSheet()["Normal"])]
                  for k, v in data]
    t = Table(table_data, colWidths=col_widths)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BRAND_LIGHT),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [BRAND_LIGHT, colors.white]),
        ("GRID", (0, 0), (-1, -1), 0.5, BRAND_BORDER),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t

def generate_transfer_receipt_pdf(req: TransferReceiptRequest) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=20*mm,
        leftMargin=20*mm,
        topMargin=20*mm,
        bottomMargin=20*mm,
    )
    styles = getSampleStyleSheet()
    elements = []

    _build_header(elements, styles, "Transfer Receipt", f"Transaction ID: {req.transaction_id}")

    # Status badge
    status_color = BRAND_GREEN if req.status == "completed" else colors.orange
    status_style = ParagraphStyle(
        "Status",
        parent=styles["Normal"],
        fontSize=12,
        fontName="Helvetica-Bold",
        textColor=status_color,
        spaceAfter=16,
    )
    elements.append(Paragraph(f"Status: {req.status.upper()}", status_style))

    # Transfer summary box
    summary_data = [
        ["You Sent", f"{req.send_amount:,.2f} {req.send_currency}"],
        ["Recipient Receives", f"{req.receive_amount:,.2f} {req.receive_currency}"],
        ["Exchange Rate", f"1 {req.send_currency} = {req.exchange_rate:.4f} {req.receive_currency}"],
        ["Transfer Fee", f"{req.fee_amount:,.2f} {req.fee_currency}"],
        ["Total Deducted", f"{req.total_deducted:,.2f} {req.send_currency}"],
    ]
    summary_table = Table(
        [[Paragraph(f"<b>{k}</b>", styles["Normal"]), Paragraph(f"<b>{v}</b>", styles["Normal"])]
         for k, v in summary_data],
        colWidths=[80*mm, 90*mm]
    )
    summary_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f0fdf4")),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#dcfce7")),
        ("GRID", (0, 0), (-1, -1), 0.5, BRAND_GREEN),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ]))
    elements.append(summary_table)
    elements.append(Spacer(1, 12))

    # Sender details
    section_style = ParagraphStyle(
        "Section",
        parent=styles["Normal"],
        fontSize=11,
        fontName="Helvetica-Bold",
        textColor=BRAND_DARK,
        spaceBefore=12,
        spaceAfter=6,
    )
    elements.append(Paragraph("Sender Details", section_style))
    elements.append(_kv_table([
        ("Name", req.sender_name),
        ("Email", req.sender_email),
        ("Country", req.sender_country),
    ]))

    elements.append(Paragraph("Recipient Details", section_style))
    receiver_data = [("Name", req.receiver_name), ("Country", req.receiver_country)]
    if req.receiver_bank:
        receiver_data.append(("Bank", req.receiver_bank))
    if req.receiver_account:
        receiver_data.append(("Account", f"****{req.receiver_account[-4:]}"))
    if req.receiver_phone:
        receiver_data.append(("Mobile", req.receiver_phone))
    receiver_data.append(("Delivery Method", req.delivery_method))
    elements.append(_kv_table(receiver_data))

    elements.append(Paragraph("Transaction Details", section_style))
    tx_data = [
        ("Reference", req.reference),
        ("Transaction ID", req.transaction_id),
        ("Initiated", req.created_at),
    ]
    if req.completed_at:
        tx_data.append(("Completed", req.completed_at))
    elements.append(_kv_table(tx_data))

    elements.append(Spacer(1, 20))
    elements.append(HRFlowable(width="100%", thickness=0.5, color=BRAND_BORDER))
    footer_style = ParagraphStyle(
        "Footer",
        parent=styles["Normal"],
        fontSize=7,
        textColor=BRAND_GRAY,
        alignment=TA_CENTER,
        spaceBefore=8,
    )
    elements.append(Paragraph(_build_footer_text(), footer_style))

    doc.build(elements)
    return buffer.getvalue()

def generate_statement_pdf(req: StatementRequest) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=20*mm, leftMargin=20*mm,
                            topMargin=20*mm, bottomMargin=20*mm)
    styles = getSampleStyleSheet()
    elements = []

    _build_header(elements, styles, "Account Statement",
                  f"Period: {req.period_start} to {req.period_end}")

    section_style = ParagraphStyle("Section", parent=styles["Normal"], fontSize=11,
                                   fontName="Helvetica-Bold", textColor=BRAND_DARK,
                                   spaceBefore=12, spaceAfter=6)
    elements.append(Paragraph("Account Information", section_style))
    elements.append(_kv_table([
        ("Account Holder", req.account_holder),
        ("Account ID", req.account_id),
        ("Email", req.email),
        ("Opening Balance", f"${req.opening_balance_usd:,.2f} USD"),
        ("Closing Balance", f"${req.closing_balance_usd:,.2f} USD"),
    ]))

    elements.append(Paragraph("Transactions", section_style))
    if req.transactions:
        headers = ["Date", "Description", "Amount", "Status"]
        rows = [headers]
        for tx in req.transactions[:50]:  # limit to 50 rows
            rows.append([
                str(tx.get("date", "")),
                str(tx.get("description", ""))[:40],
                f"${float(tx.get('amount', 0)):,.2f}",
                str(tx.get("status", "")),
            ])
        t = Table(rows, colWidths=[30*mm, 80*mm, 30*mm, 30*mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), BRAND_DARK),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, BRAND_LIGHT]),
            ("GRID", (0, 0), (-1, -1), 0.3, BRAND_BORDER),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ]))
        elements.append(t)
    else:
        elements.append(Paragraph("No transactions in this period.", styles["Normal"]))

    elements.append(Spacer(1, 20))
    elements.append(HRFlowable(width="100%", thickness=0.5, color=BRAND_BORDER))
    footer_style = ParagraphStyle("Footer", parent=styles["Normal"], fontSize=7,
                                  textColor=BRAND_GRAY, alignment=TA_CENTER, spaceBefore=8)
    elements.append(Paragraph(_build_footer_text(), footer_style))
    doc.build(elements)
    return buffer.getvalue()

def generate_kyc_letter_pdf(req: KycLetterRequest) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=20*mm, leftMargin=20*mm,
                            topMargin=20*mm, bottomMargin=20*mm)
    styles = getSampleStyleSheet()
    elements = []

    _build_header(elements, styles, "KYC Verification Confirmation",
                  f"Reference: {req.reference_number}")

    body_style = ParagraphStyle("Body", parent=styles["Normal"], fontSize=10,
                                textColor=BRAND_DARK, spaceAfter=10, leading=16)
    elements.append(Paragraph(
        f"Dear {req.user_name},<br/><br/>"
        f"We are pleased to confirm that your identity verification (KYC) has been successfully "
        f"completed on RemitFlow. Your account has been verified to <b>Tier {req.kyc_tier}</b>.",
        body_style
    ))

    section_style = ParagraphStyle("Section", parent=styles["Normal"], fontSize=11,
                                   fontName="Helvetica-Bold", textColor=BRAND_DARK,
                                   spaceBefore=12, spaceAfter=6)
    elements.append(Paragraph("Verification Details", section_style))
    elements.append(_kv_table([
        ("Name", req.user_name),
        ("Email", req.email),
        ("KYC Tier", f"Tier {req.kyc_tier}"),
        ("Verified On", req.verified_at),
        ("Daily Transfer Limit", f"${req.daily_limit_usd:,.2f} USD"),
        ("Monthly Transfer Limit", f"${req.monthly_limit_usd:,.2f} USD"),
        ("Reference Number", req.reference_number),
    ]))

    elements.append(Spacer(1, 12))
    elements.append(Paragraph(
        "This letter serves as official confirmation of your KYC status. "
        "Please retain this document for your records. "
        "If you have any questions, contact us at support@remitflow.io.",
        body_style
    ))

    elements.append(Spacer(1, 20))
    elements.append(HRFlowable(width="100%", thickness=0.5, color=BRAND_BORDER))
    footer_style = ParagraphStyle("Footer", parent=styles["Normal"], fontSize=7,
                                  textColor=BRAND_GRAY, alignment=TA_CENTER, spaceBefore=8)
    elements.append(Paragraph(_build_footer_text(), footer_style))
    doc.build(elements)
    return buffer.getvalue()

# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "pdf-receipt", "version": "1.0.0",
            "timestamp": datetime.now(timezone.utc).isoformat()}

@app.post("/receipt/transfer")
async def receipt_transfer(req: TransferReceiptRequest):
    try:
        pdf_bytes = generate_transfer_receipt_pdf(req)
        filename = f"remitflow_receipt_{req.reference}.pdf"
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except Exception as e:
        logger.error(f"PDF generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/receipt/statement")
async def receipt_statement(req: StatementRequest):
    try:
        pdf_bytes = generate_statement_pdf(req)
        filename = f"remitflow_statement_{req.account_id}_{req.period_start}_{req.period_end}.pdf"
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except Exception as e:
        logger.error(f"Statement PDF generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/receipt/kyc")
async def receipt_kyc(req: KycLetterRequest):
    try:
        pdf_bytes = generate_kyc_letter_pdf(req)
        filename = f"remitflow_kyc_{req.reference_number}.pdf"
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except Exception as e:
        logger.error(f"KYC letter PDF generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8086))
    logger.info(f"RemitFlow PDF Receipt Generator starting on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
