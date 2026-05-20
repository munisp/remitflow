"""
Audit Log Encryption - Secure storage with hash chaining for integrity
"""

import hashlib
import hmac
import json
import logging
from typing import Dict, Any, Optional
from datetime import datetime
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2
from cryptography.hazmat.backends import default_backend
import base64

logger = logging.getLogger(__name__)


class AuditEncryption:
    """Handles encryption and decryption of audit logs"""
    
    def __init__(self, master_key: Optional[str] = None):
        """Initialize encryption with master key"""
        if master_key:
            self.master_key = master_key.encode()
        else:
            # Generate a key (in production, this should be from secure storage)
            self.master_key = Fernet.generate_key()
        
        self.fernet = Fernet(self.master_key)
        logger.info("Audit encryption initialized")
    
    def encrypt_field(self, data: str) -> str:
        """Encrypt a single field"""
        try:
            encrypted = self.fernet.encrypt(data.encode())
            return base64.b64encode(encrypted).decode()
        except Exception as e:
            logger.error(f"Encryption error: {e}")
            raise
    
    def decrypt_field(self, encrypted_data: str) -> str:
        """Decrypt a single field"""
        try:
            decoded = base64.b64decode(encrypted_data.encode())
            decrypted = self.fernet.decrypt(decoded)
            return decrypted.decode()
        except Exception as e:
            logger.error(f"Decryption error: {e}")
            raise
    
    def encrypt_sensitive_fields(self, audit_data: Dict[str, Any]) -> Dict[str, Any]:
        """Encrypt sensitive fields in audit log"""
        sensitive_fields = [
            "ip_address", "user_agent", "before_state",
            "after_state", "metadata"
        ]
        
        encrypted_data = audit_data.copy()
        
        for field in sensitive_fields:
            if field in encrypted_data and encrypted_data[field]:
                if isinstance(encrypted_data[field], dict):
                    encrypted_data[field] = self.encrypt_field(
                        json.dumps(encrypted_data[field])
                    )
                else:
                    encrypted_data[field] = self.encrypt_field(
                        str(encrypted_data[field])
                    )
        
        return encrypted_data
    
    def decrypt_sensitive_fields(self, encrypted_data: Dict[str, Any]) -> Dict[str, Any]:
        """Decrypt sensitive fields in audit log"""
        sensitive_fields = [
            "ip_address", "user_agent", "before_state",
            "after_state", "metadata"
        ]
        
        decrypted_data = encrypted_data.copy()
        
        for field in sensitive_fields:
            if field in decrypted_data and decrypted_data[field]:
                try:
                    decrypted = self.decrypt_field(decrypted_data[field])
                    # Try to parse as JSON
                    try:
                        decrypted_data[field] = json.loads(decrypted)
                    except Exception:
                        decrypted_data[field] = decrypted
                except Exception as e:
                    logger.warning(f"Failed to decrypt field {field}: {e}")
        
        return decrypted_data


class HashChain:
    """Implements hash chaining for audit log integrity"""
    
    def __init__(self, secret_key: str = "audit_chain_secret"):
        self.secret_key = secret_key.encode()
        self.previous_hash = self._generate_genesis_hash()
        logger.info("Hash chain initialized")
    
    def _generate_genesis_hash(self) -> str:
        """Generate genesis hash for chain start"""
        genesis_data = f"genesis_{datetime.utcnow().isoformat()}"
        return hashlib.sha256(genesis_data.encode()).hexdigest()
    
    def compute_hash(self, audit_data: Dict[str, Any]) -> str:
        """Compute hash for audit entry including previous hash"""
        # Create deterministic string from audit data
        data_string = json.dumps(audit_data, sort_keys=True, default=str)
        
        # Combine with previous hash
        chain_data = f"{self.previous_hash}:{data_string}"
        
        # Compute HMAC-SHA256
        hash_obj = hmac.new(
            self.secret_key,
            chain_data.encode(),
            hashlib.sha256
        )
        
        current_hash = hash_obj.hexdigest()
        
        # Update previous hash for next entry
        self.previous_hash = current_hash
        
        return current_hash
    
    def verify_hash(
        self,
        audit_data: Dict[str, Any],
        stored_hash: str,
        previous_hash: str
    ) -> bool:
        """Verify hash integrity"""
        # Temporarily set previous hash
        original_previous = self.previous_hash
        self.previous_hash = previous_hash
        
        # Compute expected hash
        computed_hash = self.compute_hash(audit_data)
        
        # Restore previous hash
        self.previous_hash = original_previous
        
        # Compare
        is_valid = hmac.compare_digest(computed_hash, stored_hash)
        
        if not is_valid:
            logger.warning("Hash verification failed for audit entry")
        
        return is_valid
    
    def verify_chain(self, audit_entries: list) -> Dict[str, Any]:
        """Verify entire chain integrity"""
        if not audit_entries:
            return {"valid": True, "entries_checked": 0}
        
        # Reset to genesis
        self.previous_hash = self._generate_genesis_hash()
        
        invalid_entries = []
        
        for i, entry in enumerate(audit_entries):
            if "hash_chain" not in entry or "previous_hash" not in entry:
                invalid_entries.append({
                    "index": i,
                    "event_id": entry.get("event_id"),
                    "reason": "Missing hash fields"
                })
                continue
            
            is_valid = self.verify_hash(
                entry,
                entry["hash_chain"],
                entry["previous_hash"]
            )
            
            if not is_valid:
                invalid_entries.append({
                    "index": i,
                    "event_id": entry.get("event_id"),
                    "reason": "Hash mismatch"
                })
            
            # Update for next iteration
            self.previous_hash = entry["hash_chain"]
        
        return {
            "valid": len(invalid_entries) == 0,
            "entries_checked": len(audit_entries),
            "invalid_entries": invalid_entries
        }
    
    def get_current_hash(self) -> str:
        """Get current hash in chain"""
        return self.previous_hash


class AuditStorage:
    """Manages audit log storage with encryption and hash chaining"""
    
    def __init__(self):
        self.encryption = AuditEncryption()
        self.hash_chain = HashChain()
        self.storage: list = []
        logger.info("Audit storage initialized")
    
    def store_entry(self, audit_data: Dict[str, Any]) -> Dict[str, Any]:
        """Store audit entry with encryption and hash chaining"""
        # Add previous hash
        audit_data["previous_hash"] = self.hash_chain.get_current_hash()
        
        # Encrypt sensitive fields
        encrypted_data = self.encryption.encrypt_sensitive_fields(audit_data)
        
        # Compute hash chain
        hash_value = self.hash_chain.compute_hash(audit_data)
        encrypted_data["hash_chain"] = hash_value
        
        # Store
        self.storage.append(encrypted_data)
        
        logger.debug(f"Stored audit entry: {audit_data.get('event_id')}")
        
        return {
            "event_id": audit_data.get("event_id"),
            "hash_chain": hash_value,
            "stored_at": datetime.utcnow().isoformat()
        }
    
    def retrieve_entry(self, event_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve and decrypt audit entry"""
        for entry in self.storage:
            if entry.get("event_id") == event_id:
                # Decrypt
                decrypted = self.encryption.decrypt_sensitive_fields(entry)
                return decrypted
        
        return None
    
    def retrieve_entries(
        self,
        filters: Optional[Dict[str, Any]] = None,
        limit: int = 100,
        offset: int = 0
    ) -> list:
        """Retrieve multiple entries with filters"""
        filtered = self.storage
        
        if filters:
            for key, value in filters.items():
                if value is not None:
                    filtered = [
                        entry for entry in filtered
                        if entry.get(key) == value
                    ]
        
        # Apply pagination
        paginated = filtered[offset:offset + limit]
        
        # Decrypt all entries
        decrypted_entries = [
            self.encryption.decrypt_sensitive_fields(entry)
            for entry in paginated
        ]
        
        return decrypted_entries
    
    def verify_integrity(self) -> Dict[str, Any]:
        """Verify integrity of all stored entries"""
        return self.hash_chain.verify_chain(self.storage)
    
    def get_storage_stats(self) -> Dict[str, Any]:
        """Get storage statistics"""
        total_entries = len(self.storage)
        
        if total_entries == 0:
            return {
                "total_entries": 0,
                "oldest_entry": None,
                "newest_entry": None
            }
        
        oldest = self.storage[0].get("timestamp")
        newest = self.storage[-1].get("timestamp")
        
        return {
            "total_entries": total_entries,
            "oldest_entry": oldest,
            "newest_entry": newest,
            "current_hash": self.hash_chain.get_current_hash()
        }
