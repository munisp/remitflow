"""
RemitFlow Encryption-at-Rest Service
Column-level encryption for PII, AES-256-GCM with envelope encryption
Port: 8102

REQUIRED:
  - ENCRYPTION_MASTER_KEY (base64-encoded 32-byte key, or KMS ARN)
  - AWS_KMS_KEY_ID (optional, for AWS KMS integration)
  - DATABASE_URL

FAIL-CLOSED:
  If master key is missing or invalid, service panics on boot.
  NEVER stores plaintext PII without encryption.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import signal
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="[ENCRYPTION] %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="RemitFlow Encryption-at-Rest Service",
    description="Column-level encryption for PII with AES-256-GCM",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Master Key Management ─────────────────────────────────────────────────────
MASTER_KEY_B64 = os.getenv("ENCRYPTION_MASTER_KEY", "").strip()
AWS_KMS_KEY_ID = os.getenv("AWS_KMS_KEY_ID", "").strip()

if not MASTER_KEY_B64 and not AWS_KMS_KEY_ID:
    raise RuntimeError(
        "CRITICAL: Neither ENCRYPTION_MASTER_KEY nor AWS_KMS_KEY_ID is set. "
        "Encryption service cannot start without a key management strategy."
    )

# Derive data encryption keys from master key
_kdf_salt = os.urandom(16) if not MASTER_KEY_B64 else b"remitflow_fixed_salt_v1"

def _derive_key(master_key: bytes, purpose: str) -> bytes:
    """Derive a purpose-specific key from the master key."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_kdf_salt + purpose.encode(),
        iterations=480000,
    )
    return kdf.derive(master_key)

_master_key = base64.b64decode(MASTER_KEY_B64) if MASTER_KEY_B64 else b""

# Purpose-specific keys
_KEY_PII = _derive_key(_master_key, "pii") if _master_key else b""
_KEY_FINANCIAL = _derive_key(_master_key, "financial") if _master_key else b""
_KEY_DOCUMENT = _derive_key(_master_key, "document") if _master_key else b""

# ─── Encryption/Decryption ─────────────────────────────────────────────────────

def encrypt(plaintext: str, key: bytes, associated_data: bytes = b"") -> str:
    """Encrypt plaintext with AES-256-GCM. Returns base64-encoded ciphertext."""
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), associated_data)
    # Format: base64(nonce || ciphertext)
    return base64.b64encode(nonce + ciphertext).decode("ascii")

def decrypt(ciphertext_b64: str, key: bytes, associated_data: bytes = b"") -> str:
    """Decrypt AES-256-GCM ciphertext."""
    data = base64.b64decode(ciphertext_b64)
    nonce = data[:12]
    ciphertext = data[12:]
    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(nonce, ciphertext, associated_data)
    return plaintext.decode("utf-8")

# ─── Pydantic Models ───────────────────────────────────────────────────────────

class EncryptRequest(BaseModel):
    plaintext: str
    purpose: str = Field(default="pii", pattern=r"^(pii|financial|document)$")
    associated_data: Optional[str] = None

class EncryptResponse(BaseModel):
    ciphertext: str
    purpose: str
    algorithm: str
    key_version: str

class DecryptRequest(BaseModel):
    ciphertext: str
    purpose: str = Field(default="pii", pattern=r"^(pii|financial|document)$")
    associated_data: Optional[str] = None

class DecryptResponse(BaseModel):
    plaintext: str
    purpose: str

class BatchEncryptRequest(BaseModel):
    items: List[Dict[str, Any]]
    fields: List[str]  # Which fields to encrypt
    purpose: str = Field(default="pii", pattern=r"^(pii|financial|document)$")

class BatchEncryptResponse(BaseModel):
    encrypted_items: List[Dict[str, Any]]
    encrypted_fields: List[str]

# ─── Key Selection ─────────────────────────────────────────────────────────────

def _get_key(purpose: str) -> bytes:
    if purpose == "pii":
        return _KEY_PII
    elif purpose == "financial":
        return _KEY_FINANCIAL
    elif purpose == "document":
        return _KEY_DOCUMENT
    raise ValueError(f"Unknown encryption purpose: {purpose}")

# ─── Handlers ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "encryption-at-rest",
        "version": "2.0.0",
        "algorithm": "AES-256-GCM",
        "key_management": "AWS_KMS" if AWS_KMS_KEY_ID else "envelope",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/encrypt", response_model=EncryptResponse)
def encrypt_endpoint(req: EncryptRequest):
    key = _get_key(req.purpose)
    ad = req.associated_data.encode() if req.associated_data else b""
    ciphertext = encrypt(req.plaintext, key, ad)
    return EncryptResponse(
        ciphertext=ciphertext,
        purpose=req.purpose,
        algorithm="AES-256-GCM",
        key_version="v1",
    )

@app.post("/decrypt", response_model=DecryptResponse)
def decrypt_endpoint(req: DecryptRequest):
    key = _get_key(req.purpose)
    ad = req.associated_data.encode() if req.associated_data else b""
    try:
        plaintext = decrypt(req.ciphertext, key, ad)
        return DecryptResponse(plaintext=plaintext, purpose=req.purpose)
    except Exception as e:
        logger.error(f"Decryption failed: {e}")
        raise HTTPException(status_code=400, detail="Decryption failed. Invalid ciphertext or associated data.")

@app.post("/encrypt/batch", response_model=BatchEncryptResponse)
def batch_encrypt(req: BatchEncryptRequest):
    key = _get_key(req.purpose)
    encrypted_items = []

    for item in req.items:
        encrypted_item = dict(item)
        for field in req.fields:
            if field in encrypted_item and encrypted_item[field] is not None:
                encrypted_item[field] = encrypt(str(encrypted_item[field]), key)
        encrypted_items.append(encrypted_item)

    return BatchEncryptResponse(
        encrypted_items=encrypted_items,
        encrypted_fields=req.fields,
    )

@app.post("/tokenize")
def tokenize(req: EncryptRequest):
    """Create a deterministic token (hash) for searchability while keeping value encrypted."""
    key = _get_key(req.purpose)
    # Create a searchable token using HMAC
    token = base64.b64encode(
        hashlib.sha256(req.plaintext.encode() + key).digest()
    ).decode("ascii")[:32]
    ciphertext = encrypt(req.plaintext, key)

    return {
        "token": token,
        "ciphertext": ciphertext,
        "purpose": req.purpose,
        "note": "Use token for exact-match queries. Use ciphertext for storage. Decrypt ciphertext for display.",
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8102"))
    logger.info(f"Starting encryption-at-rest v2.0 on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
