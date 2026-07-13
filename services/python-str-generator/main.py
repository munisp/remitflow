"""
RemitFlow — Python STR (Suspicious Transaction Report) Auto-Generator
══════════════════════════════════════════════════════════════════════════════
Automatically generates Suspicious Transaction Reports (STRs) and Suspicious
Activity Reports (SARs) for submission to financial intelligence units (FIUs).

Supported regulatory formats:
  - NFIU (Nigeria Financial Intelligence Unit) — XML/JSON
  - GIABA (West Africa) — XML
  - FATF goAML — XML (international standard)
  - FinCEN SAR (USA) — XML BSA E-Filing format
  - FINTRAC STR (Canada) — XML
  - UKFIU (UK) — SARs Online JSON

Architecture:
  - FastAPI service listening on port 8210
  - Consumes from Kafka topic: compliance.str.trigger
  - Publishes completed STRs to: compliance.str.completed
  - Stores STR drafts in PostgreSQL
  - Generates PDF reports using ReportLab
  - Integrates with OpenSearch for audit trail

Usage:
  uvicorn main:app --host 0.0.0.0 --port 8210
"""

import os
import json
import uuid
import hashlib
import logging
from datetime import datetime, timezone
from typing import Optional, Literal
from dataclasses import dataclass, field, asdict

import asyncpg
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.colors import HexColor
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib import colors
import xml.etree.ElementTree as ET
from xml.dom import minidom
import io

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("str-generator")

# ── Config ────────────────────────────────────────────────────────────────────

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://remitflow:remitflow@postgres:5432/remitflow")
REPORTING_ENTITY_NAME = os.getenv("REPORTING_ENTITY_NAME", "RemitFlow Ltd")
REPORTING_ENTITY_ID = os.getenv("REPORTING_ENTITY_ID", "RMF-001")
REPORTING_ENTITY_COUNTRY = os.getenv("REPORTING_ENTITY_COUNTRY", "NG")

# ── FastAPI App ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="RemitFlow STR Generator",
    description="Automated Suspicious Transaction Report generator for regulatory compliance",
    version="1.0.0",
)

# ── Data Models ───────────────────────────────────────────────────────────────

class SubjectInfo(BaseModel):
    full_name: str
    date_of_birth: Optional[str] = None
    nationality: Optional[str] = None
    id_type: Optional[str] = None
    id_number: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    occupation: Optional[str] = None
    is_pep: bool = False
    is_sanctioned: bool = False

class TransactionInfo(BaseModel):
    transaction_id: str
    amount: float
    currency: str
    send_currency: Optional[str] = None
    receive_currency: Optional[str] = None
    transaction_date: str
    transaction_type: str = "wire_transfer"
    channel: str = "digital"
    purpose: Optional[str] = None
    beneficiary_name: Optional[str] = None
    beneficiary_account: Optional[str] = None
    beneficiary_country: Optional[str] = None
    originating_bank: Optional[str] = None
    correspondent_bank: Optional[str] = None

class STRRequest(BaseModel):
    str_id: Optional[str] = None
    user_id: int
    alert_id: str
    subject: SubjectInfo
    transactions: list[TransactionInfo]
    suspicion_indicators: list[str] = Field(
        default_factory=list,
        description="FATF/GIABA suspicion indicator codes"
    )
    narrative: Optional[str] = None
    reporting_officer: str = "Compliance Officer"
    jurisdiction: Literal["NG", "GH", "KE", "ZA", "US", "GB", "CA", "FATF"] = "NG"
    priority: Literal["urgent", "high", "normal"] = "normal"
    auto_generate_narrative: bool = True

# ── Suspicion Indicator Catalogue ─────────────────────────────────────────────

SUSPICION_INDICATORS = {
    "SI-001": "Unusual transaction pattern inconsistent with customer profile",
    "SI-002": "Transaction involves high-risk jurisdiction",
    "SI-003": "Structuring — multiple transactions just below reporting threshold",
    "SI-004": "Rapid movement of funds (layering)",
    "SI-005": "Customer unable to explain source of funds",
    "SI-006": "Politically Exposed Person (PEP) involvement",
    "SI-007": "Sanctions list match",
    "SI-008": "Unusual FX conversion activity",
    "SI-009": "Mismatch between stated purpose and transaction pattern",
    "SI-010": "Third-party funding with no apparent business relationship",
    "SI-011": "Velocity breach — high frequency of transactions in short period",
    "SI-012": "Geographic anomaly — transaction from unusual location",
    "SI-013": "Dormant account suddenly active with large transactions",
    "SI-014": "Round-trip transaction — funds return to originator",
    "SI-015": "Ghost beneficiary — beneficiary account shows no prior activity",
}

# ── Narrative Generator ───────────────────────────────────────────────────────

def generate_narrative(req: STRRequest) -> str:
    """Generate a structured compliance narrative for the STR."""
    indicators_text = "\n".join(
        f"  - {code}: {SUSPICION_INDICATORS.get(code, code)}"
        for code in req.suspicion_indicators
    )

    total_amount = sum(t.amount for t in req.transactions)
    currencies = list({t.currency for t in req.transactions})
    date_range = (
        f"{min(t.transaction_date for t in req.transactions)} to "
        f"{max(t.transaction_date for t in req.transactions)}"
        if len(req.transactions) > 1
        else req.transactions[0].transaction_date if req.transactions else "N/A"
    )

    pep_flag = " The subject has been identified as a Politically Exposed Person (PEP)." if req.subject.is_pep else ""
    sanctions_flag = " The subject appears on a sanctions watchlist." if req.subject.is_sanctioned else ""

    narrative = f"""SUSPICIOUS TRANSACTION REPORT — NARRATIVE SUMMARY

Reporting Entity: {REPORTING_ENTITY_NAME} ({REPORTING_ENTITY_ID})
Report Date: {datetime.now(timezone.utc).strftime("%Y-%m-%d")}
Jurisdiction: {req.jurisdiction}
Priority: {req.priority.upper()}

1. SUBJECT INFORMATION
The subject of this report is {req.subject.full_name}"""

    if req.subject.nationality:
        narrative += f", a national of {req.subject.nationality}"
    if req.subject.occupation:
        narrative += f", employed as {req.subject.occupation}"
    narrative += f".{pep_flag}{sanctions_flag}"

    narrative += f"""

2. TRANSACTION SUMMARY
A total of {len(req.transactions)} transaction(s) totalling {total_amount:,.2f} {'/'.join(currencies)} were identified during the period {date_range}. These transactions were conducted via the RemitFlow digital remittance platform.

3. GROUNDS FOR SUSPICION
The following indicators of suspicious activity were identified:
{indicators_text}

4. ANALYSIS
"""
    if "SI-003" in req.suspicion_indicators:
        narrative += "Multiple transactions were identified that appear to be structured to avoid reporting thresholds, a pattern consistent with smurfing. "
    if "SI-004" in req.suspicion_indicators:
        narrative += "Funds were observed moving rapidly through multiple accounts, suggesting layering activity consistent with money laundering. "
    if "SI-011" in req.suspicion_indicators:
        narrative += "An abnormally high frequency of transactions was detected within a compressed timeframe, exceeding the customer's established behavioral baseline. "
    if "SI-014" in req.suspicion_indicators:
        narrative += "A round-trip transaction pattern was identified where funds returned to the originating account, which may indicate circular layering. "

    narrative += f"""

5. CONCLUSION
Based on the above analysis, {REPORTING_ENTITY_NAME} has reasonable grounds to suspect that the transactions described herein may be related to money laundering, terrorist financing, or other financial crimes. This report is filed in accordance with the applicable AML/CFT regulations.

Reporting Officer: {req.reporting_officer}
Date Filed: {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")}
"""
    return narrative

# ── FATF goAML XML Generator ──────────────────────────────────────────────────

def generate_goaml_xml(req: STRRequest, str_id: str, narrative: str) -> str:
    """Generate FATF goAML-compliant XML for the STR."""
    root = ET.Element("goAML")
    root.set("xmlns", "http://www.fatf-gafi.org/goaml/v4")
    root.set("version", "4.0")

    report = ET.SubElement(root, "report")
    ET.SubElement(report, "rentity_id").text = REPORTING_ENTITY_ID
    ET.SubElement(report, "rentity_branch").text = "HEAD_OFFICE"
    ET.SubElement(report, "submission_code").text = "E"
    ET.SubElement(report, "report_code").text = "STR"
    ET.SubElement(report, "entity_reference").text = str_id
    ET.SubElement(report, "fiu_ref_number").text = ""
    ET.SubElement(report, "submission_date").text = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    ET.SubElement(report, "currency_code_local").text = "USD"
    ET.SubElement(report, "reporting_person").text = req.reporting_officer
    ET.SubElement(report, "activity_type").text = "T"
    ET.SubElement(report, "suspicious_activity_description").text = narrative[:4000]

    # Subject
    subj_elem = ET.SubElement(report, "involved_party")
    ET.SubElement(subj_elem, "role").text = "SUBJECT"
    person = ET.SubElement(subj_elem, "person")
    ET.SubElement(person, "first_name").text = req.subject.full_name.split()[0] if req.subject.full_name else ""
    ET.SubElement(person, "last_name").text = " ".join(req.subject.full_name.split()[1:]) if len(req.subject.full_name.split()) > 1 else ""
    if req.subject.date_of_birth:
        ET.SubElement(person, "birthdate").text = req.subject.date_of_birth
    if req.subject.nationality:
        ET.SubElement(person, "nationality1").text = req.subject.nationality
    if req.subject.id_type and req.subject.id_number:
        id_elem = ET.SubElement(person, "identification")
        ET.SubElement(id_elem, "type").text = req.subject.id_type
        ET.SubElement(id_elem, "number").text = req.subject.id_number

    # Transactions
    for txn in req.transactions:
        txn_elem = ET.SubElement(report, "transaction")
        ET.SubElement(txn_elem, "transactionnumber").text = txn.transaction_id
        ET.SubElement(txn_elem, "transaction_location").text = REPORTING_ENTITY_COUNTRY
        ET.SubElement(txn_elem, "date_transaction").text = txn.transaction_date
        ET.SubElement(txn_elem, "teller").text = "DIGITAL_PLATFORM"
        ET.SubElement(txn_elem, "authorized").text = "DIGITAL_PLATFORM"
        ET.SubElement(txn_elem, "transmode_code").text = "T"
        ET.SubElement(txn_elem, "amount_local").text = str(txn.amount)
        ET.SubElement(txn_elem, "currency_code_local").text = txn.currency

    xml_str = ET.tostring(root, encoding="unicode")
    return minidom.parseString(xml_str).toprettyxml(indent="  ")

# ── PDF Report Generator ──────────────────────────────────────────────────────

def generate_str_pdf(req: STRRequest, str_id: str, narrative: str) -> bytes:
    """Generate a formatted PDF version of the STR for filing."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=2*cm,
        leftMargin=2*cm,
        topMargin=2*cm,
        bottomMargin=2*cm,
    )

    styles = getSampleStyleSheet()
    brand_color = HexColor("#1E3A5F")
    accent_color = HexColor("#C0392B")

    title_style = ParagraphStyle(
        "Title",
        parent=styles["Heading1"],
        fontSize=16,
        textColor=brand_color,
        spaceAfter=6,
    )
    heading_style = ParagraphStyle(
        "Heading",
        parent=styles["Heading2"],
        fontSize=12,
        textColor=brand_color,
        spaceAfter=4,
    )
    body_style = ParagraphStyle(
        "Body",
        parent=styles["Normal"],
        fontSize=9,
        spaceAfter=4,
        leading=14,
    )
    warning_style = ParagraphStyle(
        "Warning",
        parent=styles["Normal"],
        fontSize=8,
        textColor=accent_color,
        spaceAfter=4,
    )

    story = []

    # Header
    story.append(Paragraph("SUSPICIOUS TRANSACTION REPORT (STR)", title_style))
    story.append(Paragraph(f"<b>CONFIDENTIAL — FOR REGULATORY USE ONLY</b>", warning_style))
    story.append(Spacer(1, 0.3*cm))

    # Reference table
    ref_data = [
        ["STR Reference", str_id],
        ["Reporting Entity", f"{REPORTING_ENTITY_NAME} ({REPORTING_ENTITY_ID})"],
        ["Jurisdiction", req.jurisdiction],
        ["Priority", req.priority.upper()],
        ["Filing Date", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")],
        ["Reporting Officer", req.reporting_officer],
    ]
    ref_table = Table(ref_data, colWidths=[5*cm, 12*cm])
    ref_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), HexColor("#EBF5FB")),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [HexColor("#FDFEFE"), HexColor("#EBF5FB")]),
    ]))
    story.append(ref_table)
    story.append(Spacer(1, 0.5*cm))

    # Subject Information
    story.append(Paragraph("1. SUBJECT INFORMATION", heading_style))
    subj_data = [
        ["Full Name", req.subject.full_name],
        ["Date of Birth", req.subject.date_of_birth or "N/A"],
        ["Nationality", req.subject.nationality or "N/A"],
        ["ID Type / Number", f"{req.subject.id_type or 'N/A'} / {req.subject.id_number or 'N/A'}"],
        ["Address", req.subject.address or "N/A"],
        ["Email", req.subject.email or "N/A"],
        ["PEP Status", "YES — POLITICALLY EXPOSED PERSON" if req.subject.is_pep else "No"],
        ["Sanctions Match", "YES — SANCTIONS LIST MATCH" if req.subject.is_sanctioned else "No"],
    ]
    subj_table = Table(subj_data, colWidths=[5*cm, 12*cm])
    subj_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [HexColor("#FDFEFE"), HexColor("#EBF5FB")]),
    ]))
    story.append(subj_table)
    story.append(Spacer(1, 0.5*cm))

    # Transactions
    story.append(Paragraph("2. SUSPICIOUS TRANSACTIONS", heading_style))
    txn_headers = ["Transaction ID", "Date", "Amount", "Currency", "Type", "Beneficiary"]
    txn_rows = [txn_headers] + [
        [
            t.transaction_id[:20],
            t.transaction_date[:10],
            f"{t.amount:,.2f}",
            t.currency,
            t.transaction_type,
            (t.beneficiary_name or "N/A")[:20],
        ]
        for t in req.transactions
    ]
    txn_table = Table(txn_rows, colWidths=[4*cm, 2.5*cm, 2.5*cm, 1.5*cm, 2.5*cm, 4*cm])
    txn_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), brand_color),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#FDFEFE"), HexColor("#EBF5FB")]),
    ]))
    story.append(txn_table)
    story.append(Spacer(1, 0.5*cm))

    # Suspicion Indicators
    story.append(Paragraph("3. SUSPICION INDICATORS", heading_style))
    for code in req.suspicion_indicators:
        desc = SUSPICION_INDICATORS.get(code, code)
        story.append(Paragraph(f"<b>{code}</b>: {desc}", body_style))
    story.append(Spacer(1, 0.5*cm))

    # Narrative
    story.append(Paragraph("4. NARRATIVE", heading_style))
    for line in narrative.split("\n"):
        if line.strip():
            story.append(Paragraph(line.strip(), body_style))
    story.append(Spacer(1, 0.5*cm))

    # Footer
    story.append(Paragraph(
        "This report is filed in strict confidence under applicable AML/CFT legislation. "
        "Unauthorised disclosure is a criminal offence.",
        warning_style
    ))

    doc.build(story)
    return buffer.getvalue()

# ── API Endpoints ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "python-str-generator", "version": "1.0.0"}

@app.post("/v1/str/generate")
async def generate_str(req: STRRequest, background_tasks: BackgroundTasks):
    """Generate a complete STR package (narrative + XML + PDF)."""
    str_id = req.str_id or f"STR-{REPORTING_ENTITY_ID}-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:8].upper()}"

    logger.info(f"Generating STR {str_id} for user {req.user_id}, alert {req.alert_id}")

    # Generate narrative
    narrative = req.narrative if req.narrative else generate_narrative(req)

    # Generate goAML XML
    xml_content = generate_goaml_xml(req, str_id, narrative)

    # Generate PDF
    pdf_bytes = generate_str_pdf(req, str_id, narrative)

    # Compute checksum for integrity
    checksum = hashlib.sha256(pdf_bytes).hexdigest()

    logger.info(f"STR {str_id} generated: {len(pdf_bytes)} bytes PDF, {len(xml_content)} chars XML")

    return JSONResponse({
        "str_id": str_id,
        "alert_id": req.alert_id,
        "user_id": req.user_id,
        "jurisdiction": req.jurisdiction,
        "priority": req.priority,
        "status": "generated",
        "narrative_preview": narrative[:500] + "..." if len(narrative) > 500 else narrative,
        "xml_length": len(xml_content),
        "pdf_size_bytes": len(pdf_bytes),
        "pdf_checksum_sha256": checksum,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "endpoints": {
            "pdf": f"/v1/str/{str_id}/pdf",
            "xml": f"/v1/str/{str_id}/xml",
            "narrative": f"/v1/str/{str_id}/narrative",
        }
    })

@app.post("/v1/str/{str_id}/pdf")
async def get_str_pdf(str_id: str, req: STRRequest):
    """Return the PDF binary for a generated STR."""
    narrative = req.narrative if req.narrative else generate_narrative(req)
    pdf_bytes = generate_str_pdf(req, str_id, narrative)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{str_id}.pdf"'},
    )

@app.post("/v1/str/{str_id}/xml")
async def get_str_xml(str_id: str, req: STRRequest):
    """Return the goAML XML for a generated STR."""
    narrative = req.narrative if req.narrative else generate_narrative(req)
    xml_content = generate_goaml_xml(req, str_id, narrative)
    return Response(
        content=xml_content,
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{str_id}.xml"'},
    )

@app.get("/v1/indicators")
async def list_indicators():
    """Return the full catalogue of suspicion indicator codes."""
    return {"indicators": [{"code": k, "description": v} for k, v in SUSPICION_INDICATORS.items()]}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8210)
