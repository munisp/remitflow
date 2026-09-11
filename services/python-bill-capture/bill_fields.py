"""
RemitFlow Bill Capture — bill field extraction heuristics.

REUSE NOTE: the merge-and-score approach (regex heuristics over OCR text
blocks, per-field confidence derived from the OCR confidence of the source
block multiplied by a pattern-strength weight) follows the field-normalization
approach of the existing KYC OCR service at
  services/python-kyc-pipeline/src/document_processor.py
(stage5_normalize_fields), specialized here for vendor bills/invoices.

Everything here operates ONLY on real OCR output. A field that cannot be
found in the OCR text is returned as None with confidence 0.0 — fields are
NEVER guessed or fabricated.
"""

import re
from datetime import datetime
from typing import Any, Optional

# ── Patterns ──────────────────────────────────────────────────────────────────

_CURRENCY_SYMBOLS = {
    "$": "USD", "€": "EUR", "£": "GBP", "₦": "NGN", "₵": "GHS",
    "KSh": "KES", "R": "ZAR", "¥": "JPY",
}
_ISO_CURRENCY_RE = re.compile(r"\b(USD|EUR|GBP|NGN|GHS|KES|ZAR|XOF|XAF|JPY|CAD|AUD|BRL|INR|KWD|AED)\b")

_MONEY_RE = re.compile(
    r"(?P<cur>[$€£₦₵¥]|\b(?:USD|EUR|GBP|NGN|GHS|KES|ZAR|XOF|XAF|JPY|CAD|AUD|BRL|INR|KWD|AED)\b)?\s*"
    r"(?P<amount>\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d+)"
)

_TOTAL_KEYWORDS = [
    "total due", "amount due", "balance due", "total amount due",
    "invoice total", "grand total", "total payable", "amount payable",
    "total",
]

_INVOICE_NO_RES = [
    re.compile(r"\binvoice\s*(?:no\.?|number|#|num)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-_/]{2,31})", re.IGNORECASE),
    re.compile(r"\binv(?:oice)?[-#\s]?([A-Za-z0-9][A-Za-z0-9\-_/]{2,31})\b", re.IGNORECASE),
    re.compile(r"\bbill\s*(?:no\.?|number|#)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-_/]{2,31})", re.IGNORECASE),
]

_DUE_DATE_KEYWORDS = ["due date", "payment due", "due by", "pay by", "date due", "due:"]

_DATE_RES = [
    # YYYY-MM-DD / YYYY/MM/DD
    (re.compile(r"\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b"), "ymd"),
    # DD/MM/YYYY or MM/DD/YYYY (ambiguous — DD-first assumed when >12)
    (re.compile(r"\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b"), "dmy"),
    # 15 Jan 2025 / January 15, 2025
    (re.compile(
        r"\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
        r"Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
        r"[\s,]+(\d{4})\b", re.IGNORECASE), "dmony"),
    (re.compile(
        r"\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
        r"Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
        r"\s+(\d{1,2})[\s,]+(\d{4})\b", re.IGNORECASE), "mondy"),
]

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

# Line-item heuristic: a line containing free text followed by qty x price = amount
_NUM = r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?"
_LINE_ITEM_RE = re.compile(
    r"^(?P<desc>[A-Za-z][A-Za-z0-9 .,&()/%\-]{3,80}?)\s+"
    r"(?P<qty>\d+(?:\.\d+)?)\s*[x×]?\s+"
    rf"(?P<unit>{_NUM})\s+"
    rf"(?P<amount>{_NUM})\s*$"
)

_NOISE_LINE_RE = re.compile(
    r"^\W*$|^(page|invoice|bill|statement|tax invoice)\b", re.IGNORECASE
)


def _parse_amount(raw: str) -> Optional[float]:
    try:
        return float(raw.replace(",", ""))
    except ValueError:
        return None


def _normalize_date(kind: str, m: re.Match) -> Optional[str]:
    """Normalize a matched date to YYYY-MM-DD. Returns None when implausible."""
    try:
        if kind == "ymd":
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        elif kind == "dmy":
            a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            d, mo = (a, b) if a > 12 else (b, a)
        elif kind == "dmony":
            d = int(m.group(1))
            mo = _MONTHS[m.group(2)[:3].lower()]
            y = int(m.group(3))
        else:  # mondy
            mo = _MONTHS[m.group(1)[:3].lower()]
            d = int(m.group(2))
            y = int(m.group(3))
        return datetime(y, mo, d).strftime("%Y-%m-%d")
    except (ValueError, KeyError):
        return None


def _line_conf(blocks: list[dict], needle: str) -> float:
    """OCR confidence of the block containing `needle` (1.0 when untracked)."""
    for b in blocks:
        if needle and needle in b.get("text", ""):
            return float(b.get("confidence", 1.0))
    return 1.0


def _find_amount_and_currency(lines: list[str], blocks: list[dict]) -> tuple[Optional[str], Optional[str], float, float]:
    """Find the bill total. Keyword-anchored lines beat bare money tokens."""
    best: tuple[Optional[str], Optional[str], float, float] = (None, None, 0.0, 0.0)

    for line in lines:
        low = line.lower()
        for kw in _TOTAL_KEYWORDS:
            idx = low.find(kw)
            if idx == -1:
                continue
            tail = line[idx + len(kw):]
            m = _MONEY_RE.search(tail)
            if not m:
                continue
            amount = _parse_amount(m.group("amount"))
            if amount is None:
                continue
            currency = None
            cur_conf = 0.0
            raw_cur = (m.group("cur") or "").strip()
            if raw_cur in _CURRENCY_SYMBOLS:
                currency, cur_conf = _CURRENCY_SYMBOLS[raw_cur], 0.7
            elif raw_cur:
                currency, cur_conf = raw_cur.upper(), 0.9
            # "total" alone is a weaker anchor than "total due"/"amount due"
            strength = 0.75 if kw == "total" else 0.9
            conf = round(strength * _line_conf(blocks, line), 4)
            if conf > best[2]:
                best = (f"{amount:.2f}", currency, conf, round(cur_conf * _line_conf(blocks, line), 4))

    # Fallback: largest monetary value on the page is usually the total.
    if best[0] is None:
        largest = 0.0
        for line in lines:
            for m in _MONEY_RE.finditer(line):
                amount = _parse_amount(m.group("amount"))
                if amount is not None and amount > largest:
                    largest = amount
                    currency = None
                    cur_conf = 0.0
                    raw_cur = (m.group("cur") or "").strip()
                    if raw_cur in _CURRENCY_SYMBOLS:
                        currency, cur_conf = _CURRENCY_SYMBOLS[raw_cur], 0.6
                    elif raw_cur:
                        currency, cur_conf = raw_cur.upper(), 0.8
                    best = (f"{amount:.2f}", currency, round(0.5 * _line_conf(blocks, line), 4), cur_conf)
    return best


def extract_bill_fields(text_blocks: list[dict], full_text: str) -> dict:
    """
    Extract vendor/amount/currency/dueDate/invoiceNumber/lineItems from OCR
    output with per-field confidence. Missing fields are None + 0.0.
    Overall confidence = min over all field confidences (spec C3), so any
    missing/weak field forces the job into human review upstream.
    """
    lines = [l.strip() for l in full_text.split("\n") if l.strip()]

    # ── invoiceNumber ────────────────────────────────────────────────────
    invoice_number = None
    inv_conf = 0.0
    for rx in _INVOICE_NO_RES:
        m = rx.search(full_text)
        if m:
            candidate = m.group(1).strip()
            if not candidate.isdigit() or len(candidate) >= 4:
                invoice_number = candidate
                inv_conf = round(0.9 * _line_conf(text_blocks, m.group(0)), 4)
                break

    # ── dueDate ──────────────────────────────────────────────────────────
    due_date = None
    due_conf = 0.0
    for line in lines:
        low = line.lower()
        if not any(kw in low for kw in _DUE_DATE_KEYWORDS):
            continue
        for rx, kind in _DATE_RES:
            m = rx.search(line)
            if m:
                normalized = _normalize_date(kind, m)
                if normalized:
                    due_date = normalized
                    due_conf = round(0.9 * _line_conf(text_blocks, line), 4)
                    break
        if due_date:
            break

    # ── amount + currency ────────────────────────────────────────────────
    amount, currency, amount_conf, cur_conf = _find_amount_and_currency(lines, text_blocks)

    # Currency fallback: any standalone ISO code on the page.
    if currency is None:
        m = _ISO_CURRENCY_RE.search(full_text)
        if m:
            currency = m.group(1)
            cur_conf = round(0.6 * _line_conf(text_blocks, m.group(0)), 4)

    # ── vendor ───────────────────────────────────────────────────────────
    # Heuristic: first non-noise line that does not look like a date/number —
    # invoices conventionally put the issuer name at the top. A bare top-line
    # guess is weak (0.6); a registered-company suffix or an explicit
    # "From:"/issuer anchor raises the pattern strength (0.85).
    vendor = None
    vendor_conf = 0.0
    for pos, line in enumerate(lines[:8]):
        if _NOISE_LINE_RE.match(line):
            continue
        if _MONEY_RE.fullmatch(line.strip()):
            continue
        if any(rx.search(line) for rx, _ in _DATE_RES):
            continue
        candidate = line.strip()
        anchor = re.match(r"(?i)^(from|issuer|biller|vendor|remit\s+to)\s*[:–-]\s*(.+)$", candidate)
        if anchor:
            candidate = anchor.group(2).strip()
        alpha = sum(c.isalpha() for c in candidate)
        if alpha < 3 or len(candidate) > 80:
            continue
        has_suffix = bool(re.search(
            r"\b(ltd|limited|llc|llp|inc|corp(?:oration)?|company|co\.|gmbh|plc|pty|s\.a\.|bv|sa)\b\.?",
            candidate, re.IGNORECASE))
        strength = 0.85 if (anchor or has_suffix) else 0.6
        vendor = candidate
        vendor_conf = round(strength * _line_conf(text_blocks, line), 4)
        break

    # ── lineItems ────────────────────────────────────────────────────────
    line_items: list[dict[str, Any]] = []
    item_confs: list[float] = []
    for line in lines:
        m = _LINE_ITEM_RE.match(line)
        if not m:
            continue
        qty = _parse_amount(m.group("qty"))
        unit = _parse_amount(m.group("unit"))
        amt = _parse_amount(m.group("amount"))
        if qty is None or unit is None or amt is None:
            continue
        # Sanity: qty * unit ≈ amount (within rounding); otherwise low confidence
        consistent = abs(qty * unit - amt) <= max(0.02, amt * 0.01)
        conf = round((0.85 if consistent else 0.4) * _line_conf(text_blocks, line), 4)
        line_items.append({
            "description": m.group("desc").strip(),
            "quantity": qty,
            "unitPrice": f"{unit:.2f}",
            "amount": f"{amt:.2f}",
            "confidence": conf,
        })
        item_confs.append(conf)
    items_conf = round(min(item_confs), 4) if item_confs else 0.0

    fields = {
        "vendor":        {"value": vendor,         "confidence": vendor_conf},
        "amount":        {"value": amount,         "confidence": amount_conf},
        "currency":      {"value": currency,       "confidence": cur_conf},
        "dueDate":       {"value": due_date,       "confidence": due_conf},
        "invoiceNumber": {"value": invoice_number, "confidence": inv_conf},
        "lineItems":     {"value": line_items or None, "confidence": items_conf},
    }
    overall = round(min(f["confidence"] for f in fields.values()), 4)

    return {
        "status": "extracted",
        "fields": fields,
        "confidence": overall,
    }
