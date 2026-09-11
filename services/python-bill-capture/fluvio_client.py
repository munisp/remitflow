"""
RemitFlow Bill Capture — thin Fluvio produce/consume wrapper.

The repo does not use the native `fluvio` python client; the established
python-service pattern (see services/python-africbdc-adapter/main.py) is a
thin HTTP wrapper against a Fluvio gateway (`{FLUVIO_GATEWAY_URL}/produce`).
This module follows that pattern, guarded by FLUVIO_ENDPOINT:

  FLUVIO_ENDPOINT unset  → wrapper disabled; the caller falls back to inline
                           processing + a warning (never a silent drop).
  FLUVIO_ENDPOINT set    → produce: POST {endpoint}/produce {topic,key,value}
                           consume: GET  {endpoint}/consume?topic=..&offset=..

stdlib-only (urllib) so the service stays dependency-light.
"""

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional

logger = logging.getLogger("bill-capture.fluvio")

FLUVIO_ENDPOINT = os.getenv("FLUVIO_ENDPOINT", "").strip().rstrip("/")

TOPIC_INBOUND = "bill-capture-inbound"
TOPIC_EXTRACTED = "bill-capture-extracted"

_warned_disabled = False


def fluvio_enabled() -> bool:
    global _warned_disabled
    if FLUVIO_ENDPOINT:
        return True
    if not _warned_disabled:
        _warned_disabled = True
        logger.warning(
            "[BillCapture] FLUVIO_ENDPOINT unset — Fluvio produce/consume disabled; "
            "falling back to inline /extract processing (no stream consumer running)"
        )
    return False


def produce(topic: str, key: str, value: dict, timeout: float = 3.0) -> bool:
    """Produce one record. Returns False (with a warning) on any failure."""
    if not fluvio_enabled():
        return False
    try:
        body = json.dumps({"topic": topic, "key": key, "value": json.dumps(value)}).encode()
        req = urllib.request.Request(
            f"{FLUVIO_ENDPOINT}/produce",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 300
    except (urllib.error.URLError, OSError, ValueError) as e:
        logger.warning(f"[BillCapture] Fluvio produce to {topic} failed: {e}")
        return False


def consume(topic: str, offset: int = 0, max_records: int = 16, timeout: float = 5.0) -> list[dict]:
    """
    Poll records from a topic via the gateway. Returns [] on any failure —
    the consumer loop treats this as "no work" and backs off.
    """
    if not fluvio_enabled():
        return []
    try:
        qs = urllib.parse.urlencode({"topic": topic, "offset": offset, "max": max_records})
        req = urllib.request.Request(f"{FLUVIO_ENDPOINT}/consume?{qs}", method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode() or "{}")
        records = data.get("records", [])
        out = []
        for rec in records:
            try:
                out.append({
                    "offset": rec.get("offset"),
                    "key": rec.get("key"),
                    "value": json.loads(rec.get("value", "{}")),
                })
            except (ValueError, TypeError):
                continue
        return out
    except (urllib.error.URLError, OSError, ValueError) as e:
        logger.warning(f"[BillCapture] Fluvio consume from {topic} failed: {e}")
        return []
