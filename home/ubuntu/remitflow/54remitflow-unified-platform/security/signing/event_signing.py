"""
Event Signing and Verification
Cryptographic signing for critical financial events
"""

import os
import json
import base64
import hashlib
import logging
from typing import Optional, Dict, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import hmac

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding, ec
from cryptography.hazmat.primitives.asymmetric.ec import SECP256R1
from cryptography.hazmat.backends import default_backend
from cryptography.exceptions import InvalidSignature
from cryptography.x509 import load_pem_x509_certificate

logger = logging.getLogger(__name__)


class SignatureAlgorithm(str, Enum):
    RSA_SHA256 = "RS256"
    RSA_SHA384 = "RS384"
    RSA_SHA512 = "RS512"
    ECDSA_SHA256 = "ES256"
    ECDSA_SHA384 = "ES384"
    HMAC_SHA256 = "HS256"


class EventType(str, Enum):
    PAYMENT_INSTRUCTION = "payment_instruction"
    LEDGER_POSTING = "ledger_posting"
    TRANSFER_REQUEST = "transfer_request"
    SETTLEMENT_BATCH = "settlement_batch"
    ACCOUNT_CREATION = "account_creation"
    BALANCE_ADJUSTMENT = "balance_adjustment"
    REVERSAL = "reversal"
    RECONCILIATION = "reconciliation"


@dataclass
class SignedEvent:
    """A cryptographically signed event"""
    event_id: str
    event_type: EventType
    timestamp: datetime
    payload: Dict[str, Any]
    
    # Signature info
    signature: str
    algorithm: SignatureAlgorithm
    key_id: str
    
    # Metadata
    issuer: str
    audience: str = ""
    nonce: str = ""
    
    # Chain info (for event chains)
    previous_event_id: Optional[str] = None
    previous_signature: Optional[str] = None
    sequence_number: int = 0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "event_id": self.event_id,
            "event_type": self.event_type.value,
            "timestamp": self.timestamp.isoformat(),
            "payload": self.payload,
            "signature": self.signature,
            "algorithm": self.algorithm.value,
            "key_id": self.key_id,
            "issuer": self.issuer,
            "audience": self.audience,
            "nonce": self.nonce,
            "previous_event_id": self.previous_event_id,
            "previous_signature": self.previous_signature,
            "sequence_number": self.sequence_number
        }


class KeyManager:
    """Manages cryptographic keys for signing"""
    
    def __init__(self):
        self._private_keys: Dict[str, Any] = {}
        self._public_keys: Dict[str, Any] = {}
        self._certificates: Dict[str, Any] = {}
        self._hmac_keys: Dict[str, bytes] = {}
    
    def load_private_key(self, key_id: str, key_path: str = None, key_pem: str = None):
        """Load a private key"""
        if key_path:
            with open(key_path, "rb") as f:
                key_data = f.read()
        elif key_pem:
            key_data = key_pem.encode()
        else:
            raise ValueError("Either key_path or key_pem must be provided")
        
        private_key = serialization.load_pem_private_key(
            key_data,
            password=None,
            backend=default_backend()
        )
        self._private_keys[key_id] = private_key
        
        # Extract public key
        self._public_keys[key_id] = private_key.public_key()
    
    def load_public_key(self, key_id: str, key_path: str = None, key_pem: str = None):
        """Load a public key"""
        if key_path:
            with open(key_path, "rb") as f:
                key_data = f.read()
        elif key_pem:
            key_data = key_pem.encode()
        else:
            raise ValueError("Either key_path or key_pem must be provided")
        
        public_key = serialization.load_pem_public_key(
            key_data,
            backend=default_backend()
        )
        self._public_keys[key_id] = public_key
    
    def load_certificate(self, key_id: str, cert_path: str = None, cert_pem: str = None):
        """Load a certificate"""
        if cert_path:
            with open(cert_path, "rb") as f:
                cert_data = f.read()
        elif cert_pem:
            cert_data = cert_pem.encode()
        else:
            raise ValueError("Either cert_path or cert_pem must be provided")
        
        cert = load_pem_x509_certificate(cert_data, default_backend())
        self._certificates[key_id] = cert
        self._public_keys[key_id] = cert.public_key()
    
    def set_hmac_key(self, key_id: str, key: bytes):
        """Set an HMAC key"""
        self._hmac_keys[key_id] = key
    
    def generate_rsa_key_pair(self, key_id: str, key_size: int = 2048):
        """Generate a new RSA key pair"""
        private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=key_size,
            backend=default_backend()
        )
        self._private_keys[key_id] = private_key
        self._public_keys[key_id] = private_key.public_key()
        return private_key
    
    def generate_ec_key_pair(self, key_id: str):
        """Generate a new EC key pair"""
        private_key = ec.generate_private_key(SECP256R1(), default_backend())
        self._private_keys[key_id] = private_key
        self._public_keys[key_id] = private_key.public_key()
        return private_key
    
    def get_private_key(self, key_id: str):
        """Get a private key"""
        return self._private_keys.get(key_id)
    
    def get_public_key(self, key_id: str):
        """Get a public key"""
        return self._public_keys.get(key_id)
    
    def get_hmac_key(self, key_id: str) -> Optional[bytes]:
        """Get an HMAC key"""
        return self._hmac_keys.get(key_id)


class EventSigner:
    """Signs events with cryptographic signatures"""
    
    def __init__(self, key_manager: KeyManager):
        self.key_manager = key_manager
        self._sequence_numbers: Dict[str, int] = {}
        self._last_signatures: Dict[str, str] = {}
    
    def sign_event(
        self,
        event_id: str,
        event_type: EventType,
        payload: Dict[str, Any],
        key_id: str,
        algorithm: SignatureAlgorithm = SignatureAlgorithm.RSA_SHA256,
        issuer: str = "remittance-platform",
        audience: str = "",
        chain_id: str = None
    ) -> SignedEvent:
        """Sign an event"""
        timestamp = datetime.now(timezone.utc)
        nonce = base64.b64encode(os.urandom(16)).decode()
        
        # Handle event chaining
        previous_event_id = None
        previous_signature = None
        sequence_number = 0
        
        if chain_id:
            sequence_number = self._sequence_numbers.get(chain_id, 0) + 1
            previous_signature = self._last_signatures.get(chain_id)
            self._sequence_numbers[chain_id] = sequence_number
        
        # Create signing payload
        signing_payload = {
            "event_id": event_id,
            "event_type": event_type.value,
            "timestamp": timestamp.isoformat(),
            "payload": payload,
            "issuer": issuer,
            "audience": audience,
            "nonce": nonce,
            "previous_signature": previous_signature,
            "sequence_number": sequence_number
        }
        
        # Canonicalize and sign
        canonical = json.dumps(signing_payload, sort_keys=True, separators=(",", ":"))
        signature = self._create_signature(canonical.encode(), key_id, algorithm)
        
        # Update chain state
        if chain_id:
            self._last_signatures[chain_id] = signature
        
        return SignedEvent(
            event_id=event_id,
            event_type=event_type,
            timestamp=timestamp,
            payload=payload,
            signature=signature,
            algorithm=algorithm,
            key_id=key_id,
            issuer=issuer,
            audience=audience,
            nonce=nonce,
            previous_event_id=previous_event_id,
            previous_signature=previous_signature,
            sequence_number=sequence_number
        )
    
    def _create_signature(
        self,
        data: bytes,
        key_id: str,
        algorithm: SignatureAlgorithm
    ) -> str:
        """Create a signature"""
        if algorithm in [SignatureAlgorithm.RSA_SHA256, SignatureAlgorithm.RSA_SHA384, SignatureAlgorithm.RSA_SHA512]:
            return self._sign_rsa(data, key_id, algorithm)
        elif algorithm in [SignatureAlgorithm.ECDSA_SHA256, SignatureAlgorithm.ECDSA_SHA384]:
            return self._sign_ecdsa(data, key_id, algorithm)
        elif algorithm == SignatureAlgorithm.HMAC_SHA256:
            return self._sign_hmac(data, key_id)
        else:
            raise ValueError(f"Unsupported algorithm: {algorithm}")
    
    def _sign_rsa(self, data: bytes, key_id: str, algorithm: SignatureAlgorithm) -> str:
        """Sign with RSA"""
        private_key = self.key_manager.get_private_key(key_id)
        if not private_key:
            raise ValueError(f"Private key not found: {key_id}")
        
        hash_algo = {
            SignatureAlgorithm.RSA_SHA256: hashes.SHA256(),
            SignatureAlgorithm.RSA_SHA384: hashes.SHA384(),
            SignatureAlgorithm.RSA_SHA512: hashes.SHA512()
        }[algorithm]
        
        signature = private_key.sign(
            data,
            padding.PKCS1v15(),
            hash_algo
        )
        return base64.b64encode(signature).decode()
    
    def _sign_ecdsa(self, data: bytes, key_id: str, algorithm: SignatureAlgorithm) -> str:
        """Sign with ECDSA"""
        private_key = self.key_manager.get_private_key(key_id)
        if not private_key:
            raise ValueError(f"Private key not found: {key_id}")
        
        hash_algo = {
            SignatureAlgorithm.ECDSA_SHA256: hashes.SHA256(),
            SignatureAlgorithm.ECDSA_SHA384: hashes.SHA384()
        }[algorithm]
        
        signature = private_key.sign(
            data,
            ec.ECDSA(hash_algo)
        )
        return base64.b64encode(signature).decode()
    
    def _sign_hmac(self, data: bytes, key_id: str) -> str:
        """Sign with HMAC"""
        key = self.key_manager.get_hmac_key(key_id)
        if not key:
            raise ValueError(f"HMAC key not found: {key_id}")
        
        signature = hmac.new(key, data, hashlib.sha256).digest()
        return base64.b64encode(signature).decode()


class EventVerifier:
    """Verifies event signatures"""
    
    def __init__(self, key_manager: KeyManager):
        self.key_manager = key_manager
    
    def verify_event(self, event: SignedEvent) -> Tuple[bool, Optional[str]]:
        """Verify an event signature"""
        # Reconstruct signing payload
        signing_payload = {
            "event_id": event.event_id,
            "event_type": event.event_type.value,
            "timestamp": event.timestamp.isoformat(),
            "payload": event.payload,
            "issuer": event.issuer,
            "audience": event.audience,
            "nonce": event.nonce,
            "previous_signature": event.previous_signature,
            "sequence_number": event.sequence_number
        }
        
        canonical = json.dumps(signing_payload, sort_keys=True, separators=(",", ":"))
        
        try:
            valid = self._verify_signature(
                canonical.encode(),
                event.signature,
                event.key_id,
                event.algorithm
            )
            if valid:
                return True, None
            else:
                return False, "Signature verification failed"
        except Exception as e:
            return False, str(e)
    
    def _verify_signature(
        self,
        data: bytes,
        signature: str,
        key_id: str,
        algorithm: SignatureAlgorithm
    ) -> bool:
        """Verify a signature"""
        signature_bytes = base64.b64decode(signature)
        
        if algorithm in [SignatureAlgorithm.RSA_SHA256, SignatureAlgorithm.RSA_SHA384, SignatureAlgorithm.RSA_SHA512]:
            return self._verify_rsa(data, signature_bytes, key_id, algorithm)
        elif algorithm in [SignatureAlgorithm.ECDSA_SHA256, SignatureAlgorithm.ECDSA_SHA384]:
            return self._verify_ecdsa(data, signature_bytes, key_id, algorithm)
        elif algorithm == SignatureAlgorithm.HMAC_SHA256:
            return self._verify_hmac(data, signature_bytes, key_id)
        else:
            raise ValueError(f"Unsupported algorithm: {algorithm}")
    
    def _verify_rsa(
        self,
        data: bytes,
        signature: bytes,
        key_id: str,
        algorithm: SignatureAlgorithm
    ) -> bool:
        """Verify RSA signature"""
        public_key = self.key_manager.get_public_key(key_id)
        if not public_key:
            raise ValueError(f"Public key not found: {key_id}")
        
        hash_algo = {
            SignatureAlgorithm.RSA_SHA256: hashes.SHA256(),
            SignatureAlgorithm.RSA_SHA384: hashes.SHA384(),
            SignatureAlgorithm.RSA_SHA512: hashes.SHA512()
        }[algorithm]
        
        try:
            public_key.verify(signature, data, padding.PKCS1v15(), hash_algo)
            return True
        except InvalidSignature:
            return False
    
    def _verify_ecdsa(
        self,
        data: bytes,
        signature: bytes,
        key_id: str,
        algorithm: SignatureAlgorithm
    ) -> bool:
        """Verify ECDSA signature"""
        public_key = self.key_manager.get_public_key(key_id)
        if not public_key:
            raise ValueError(f"Public key not found: {key_id}")
        
        hash_algo = {
            SignatureAlgorithm.ECDSA_SHA256: hashes.SHA256(),
            SignatureAlgorithm.ECDSA_SHA384: hashes.SHA384()
        }[algorithm]
        
        try:
            public_key.verify(signature, data, ec.ECDSA(hash_algo))
            return True
        except InvalidSignature:
            return False
    
    def _verify_hmac(self, data: bytes, signature: bytes, key_id: str) -> bool:
        """Verify HMAC signature"""
        key = self.key_manager.get_hmac_key(key_id)
        if not key:
            raise ValueError(f"HMAC key not found: {key_id}")
        
        expected = hmac.new(key, data, hashlib.sha256).digest()
        return hmac.compare_digest(signature, expected)
    
    def verify_event_chain(self, events: list[SignedEvent]) -> Tuple[bool, Optional[str]]:
        """Verify a chain of events"""
        if not events:
            return True, None
        
        # Sort by sequence number
        sorted_events = sorted(events, key=lambda e: e.sequence_number)
        
        previous_signature = None
        for i, event in enumerate(sorted_events):
            # Verify individual signature
            valid, error = self.verify_event(event)
            if not valid:
                return False, f"Event {event.event_id} failed verification: {error}"
            
            # Verify chain continuity
            if i > 0:
                if event.previous_signature != previous_signature:
                    return False, f"Chain broken at event {event.event_id}"
            
            previous_signature = event.signature
        
        return True, None


# Global instances
_key_manager: Optional[KeyManager] = None
_event_signer: Optional[EventSigner] = None
_event_verifier: Optional[EventVerifier] = None


def get_key_manager() -> KeyManager:
    """Get or create key manager"""
    global _key_manager
    if _key_manager is None:
        _key_manager = KeyManager()
        
        # Load keys from environment or files
        signing_key_path = os.getenv("SIGNING_KEY_PATH")
        if signing_key_path and os.path.exists(signing_key_path):
            _key_manager.load_private_key("default", signing_key_path)
        else:
            # Generate ephemeral key for development
            _key_manager.generate_rsa_key_pair("default")
            logger.warning("Using ephemeral signing key - not for production!")
    
    return _key_manager


def get_event_signer() -> EventSigner:
    """Get or create event signer"""
    global _event_signer
    if _event_signer is None:
        _event_signer = EventSigner(get_key_manager())
    return _event_signer


def get_event_verifier() -> EventVerifier:
    """Get or create event verifier"""
    global _event_verifier
    if _event_verifier is None:
        _event_verifier = EventVerifier(get_key_manager())
    return _event_verifier
