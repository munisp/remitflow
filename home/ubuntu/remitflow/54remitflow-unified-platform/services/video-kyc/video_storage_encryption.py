"""
Video Storage Encryption Service
AES-256 encryption for video KYC recordings and biometric data
"""

import os
import io
import logging
import secrets
import hashlib
import asyncio
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, BinaryIO, Tuple
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
import tempfile
import shutil

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.backends import default_backend

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class StorageBackend(str, Enum):
    """Supported storage backends"""
    LOCAL = "local"
    S3 = "s3"
    MINIO = "minio"
    RUSTFS = "rustfs"
    AZURE_BLOB = "azure_blob"
    GCS = "gcs"


@dataclass
class EncryptedVideoMetadata:
    """Metadata for encrypted video"""
    video_id: str
    session_id: str
    original_filename: str
    encrypted_filename: str
    file_size: int
    encrypted_size: int
    content_type: str
    encryption_algorithm: str
    key_id: str
    iv: bytes
    checksum_original: str
    checksum_encrypted: str
    created_at: datetime
    expires_at: Optional[datetime]
    
    def to_dict(self) -> Dict[str, Any]:
        import base64
        return {
            "video_id": self.video_id,
            "session_id": self.session_id,
            "original_filename": self.original_filename,
            "encrypted_filename": self.encrypted_filename,
            "file_size": self.file_size,
            "encrypted_size": self.encrypted_size,
            "content_type": self.content_type,
            "encryption_algorithm": self.encryption_algorithm,
            "key_id": self.key_id,
            "iv": base64.b64encode(self.iv).decode(),
            "checksum_original": self.checksum_original,
            "checksum_encrypted": self.checksum_encrypted,
            "created_at": self.created_at.isoformat(),
            "expires_at": self.expires_at.isoformat() if self.expires_at else None
        }


class VideoKeyManager:
    """
    Key management for video encryption
    Supports key rotation and secure key derivation
    """
    
    def __init__(self, master_key: Optional[str] = None):
        self._master_key = master_key or os.getenv("VIDEO_ENCRYPTION_KEY")
        if not self._master_key:
            logger.warning("No master key provided, generating ephemeral key")
            self._master_key = secrets.token_hex(32)
        
        self._key_cache: Dict[str, bytes] = {}
        self._current_key_version = 1
    
    def derive_video_key(self, video_id: str, key_version: Optional[int] = None) -> Tuple[bytes, str]:
        """
        Derive encryption key for a specific video
        Returns (key, key_id)
        """
        version = key_version or self._current_key_version
        key_id = f"video-key-v{version}-{video_id[:8]}"
        
        if key_id in self._key_cache:
            return self._key_cache[key_id], key_id
        
        # Create unique salt from video_id
        salt = hashlib.sha256(f"{video_id}-{version}".encode()).digest()
        
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,  # 256 bits
            salt=salt,
            iterations=100000,
            backend=default_backend()
        )
        
        key = kdf.derive(self._master_key.encode())
        self._key_cache[key_id] = key
        
        return key, key_id
    
    def rotate_key(self) -> int:
        """Rotate to new key version"""
        self._current_key_version += 1
        logger.info(f"Video encryption key rotated to version {self._current_key_version}")
        return self._current_key_version
    
    def clear_cache(self):
        """Clear key cache (for security)"""
        self._key_cache.clear()


class StreamingAESEncryptor:
    """
    Streaming AES-256-GCM encryption for large video files
    Processes data in chunks to handle large files efficiently
    """
    
    CHUNK_SIZE = 64 * 1024  # 64KB chunks
    
    def __init__(self, key: bytes):
        self.key = key
        self.iv = secrets.token_bytes(12)  # 96-bit IV for GCM
    
    def encrypt_stream(
        self, 
        input_stream: BinaryIO, 
        output_stream: BinaryIO,
        file_size: Optional[int] = None
    ) -> Tuple[int, str]:
        """
        Encrypt video stream using AES-256-GCM
        Returns (encrypted_size, checksum)
        """
        # Write IV at the beginning
        output_stream.write(self.iv)
        
        cipher = Cipher(
            algorithms.AES(self.key),
            modes.GCM(self.iv),
            backend=default_backend()
        )
        encryptor = cipher.encryptor()
        
        hasher = hashlib.sha256()
        encrypted_size = len(self.iv)
        
        while True:
            chunk = input_stream.read(self.CHUNK_SIZE)
            if not chunk:
                break
            
            encrypted_chunk = encryptor.update(chunk)
            output_stream.write(encrypted_chunk)
            hasher.update(encrypted_chunk)
            encrypted_size += len(encrypted_chunk)
        
        # Finalize encryption
        final_chunk = encryptor.finalize()
        output_stream.write(final_chunk)
        encrypted_size += len(final_chunk)
        
        # Write authentication tag
        output_stream.write(encryptor.tag)
        encrypted_size += len(encryptor.tag)
        
        hasher.update(final_chunk)
        hasher.update(encryptor.tag)
        
        return encrypted_size, hasher.hexdigest()
    
    def decrypt_stream(
        self, 
        input_stream: BinaryIO, 
        output_stream: BinaryIO,
        file_size: int
    ) -> Tuple[int, str]:
        """
        Decrypt video stream
        Returns (decrypted_size, checksum)
        """
        # Read IV from beginning
        iv = input_stream.read(12)
        
        # Read all encrypted data except the tag
        encrypted_data = input_stream.read(file_size - 12 - 16)
        
        # Read authentication tag
        tag = input_stream.read(16)
        
        cipher = Cipher(
            algorithms.AES(self.key),
            modes.GCM(iv, tag),
            backend=default_backend()
        )
        decryptor = cipher.decryptor()
        
        hasher = hashlib.sha256()
        decrypted_size = 0
        
        # Process in chunks
        offset = 0
        while offset < len(encrypted_data):
            chunk = encrypted_data[offset:offset + self.CHUNK_SIZE]
            decrypted_chunk = decryptor.update(chunk)
            output_stream.write(decrypted_chunk)
            hasher.update(decrypted_chunk)
            decrypted_size += len(decrypted_chunk)
            offset += self.CHUNK_SIZE
        
        # Finalize decryption
        final_chunk = decryptor.finalize()
        output_stream.write(final_chunk)
        decrypted_size += len(final_chunk)
        hasher.update(final_chunk)
        
        return decrypted_size, hasher.hexdigest()


class VideoStorageEncryptionService:
    """
    Main video storage encryption service
    Handles encrypted storage and retrieval of video KYC recordings
    """
    
    def __init__(
        self,
        storage_path: str = "/var/lib/video-kyc/encrypted",
        master_key: Optional[str] = None,
        retention_days: int = 90
    ):
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)
        
        self.key_manager = VideoKeyManager(master_key)
        self.retention_days = retention_days
        
        self._metadata_cache: Dict[str, EncryptedVideoMetadata] = {}
    
    def encrypt_and_store(
        self,
        video_data: bytes,
        session_id: str,
        original_filename: str,
        content_type: str = "video/webm"
    ) -> EncryptedVideoMetadata:
        """
        Encrypt video and store it
        Returns metadata for the encrypted video
        """
        video_id = secrets.token_hex(16)
        
        # Calculate original checksum
        original_checksum = hashlib.sha256(video_data).hexdigest()
        
        # Get encryption key
        key, key_id = self.key_manager.derive_video_key(video_id)
        
        # Create encryptor
        encryptor = StreamingAESEncryptor(key)
        
        # Encrypt video
        input_stream = io.BytesIO(video_data)
        encrypted_filename = f"{video_id}.enc"
        encrypted_path = self.storage_path / encrypted_filename
        
        with open(encrypted_path, 'wb') as output_file:
            encrypted_size, encrypted_checksum = encryptor.encrypt_stream(
                input_stream, output_file
            )
        
        # Create metadata
        metadata = EncryptedVideoMetadata(
            video_id=video_id,
            session_id=session_id,
            original_filename=original_filename,
            encrypted_filename=encrypted_filename,
            file_size=len(video_data),
            encrypted_size=encrypted_size,
            content_type=content_type,
            encryption_algorithm="AES-256-GCM",
            key_id=key_id,
            iv=encryptor.iv,
            checksum_original=original_checksum,
            checksum_encrypted=encrypted_checksum,
            created_at=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(days=self.retention_days)
        )
        
        # Store metadata
        self._store_metadata(metadata)
        self._metadata_cache[video_id] = metadata
        
        logger.info(f"Video encrypted and stored: {video_id} ({encrypted_size} bytes)")
        
        return metadata
    
    async def encrypt_and_store_async(
        self,
        video_data: bytes,
        session_id: str,
        original_filename: str,
        content_type: str = "video/webm"
    ) -> EncryptedVideoMetadata:
        """Async version of encrypt_and_store"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self.encrypt_and_store,
            video_data,
            session_id,
            original_filename,
            content_type
        )
    
    def retrieve_and_decrypt(self, video_id: str) -> Tuple[bytes, EncryptedVideoMetadata]:
        """
        Retrieve and decrypt video
        Returns (decrypted_data, metadata)
        """
        # Get metadata
        metadata = self._get_metadata(video_id)
        if not metadata:
            raise ValueError(f"Video not found: {video_id}")
        
        # Check expiration
        if metadata.expires_at and datetime.utcnow() > metadata.expires_at:
            raise ValueError(f"Video expired: {video_id}")
        
        # Get decryption key
        key, _ = self.key_manager.derive_video_key(video_id)
        
        # Read encrypted file
        encrypted_path = self.storage_path / metadata.encrypted_filename
        
        if not encrypted_path.exists():
            raise ValueError(f"Encrypted file not found: {metadata.encrypted_filename}")
        
        with open(encrypted_path, 'rb') as input_file:
            encrypted_data = input_file.read()
        
        # Decrypt
        input_stream = io.BytesIO(encrypted_data)
        output_stream = io.BytesIO()
        
        # Create decryptor with stored IV
        cipher = Cipher(
            algorithms.AES(key),
            modes.GCM(metadata.iv),
            backend=default_backend()
        )
        
        # Read past IV
        input_stream.read(12)
        
        # Read encrypted content (excluding tag)
        encrypted_content = encrypted_data[12:-16]
        tag = encrypted_data[-16:]
        
        cipher = Cipher(
            algorithms.AES(key),
            modes.GCM(metadata.iv, tag),
            backend=default_backend()
        )
        decryptor = cipher.decryptor()
        
        decrypted_data = decryptor.update(encrypted_content) + decryptor.finalize()
        
        # Verify checksum
        decrypted_checksum = hashlib.sha256(decrypted_data).hexdigest()
        if decrypted_checksum != metadata.checksum_original:
            raise ValueError("Checksum verification failed - data may be corrupted")
        
        logger.info(f"Video decrypted: {video_id} ({len(decrypted_data)} bytes)")
        
        return decrypted_data, metadata
    
    async def retrieve_and_decrypt_async(self, video_id: str) -> Tuple[bytes, EncryptedVideoMetadata]:
        """Async version of retrieve_and_decrypt"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.retrieve_and_decrypt, video_id)
    
    def delete_video(self, video_id: str) -> bool:
        """
        Securely delete encrypted video
        Overwrites file before deletion
        """
        metadata = self._get_metadata(video_id)
        if not metadata:
            return False
        
        encrypted_path = self.storage_path / metadata.encrypted_filename
        
        if encrypted_path.exists():
            # Secure deletion - overwrite with random data
            file_size = encrypted_path.stat().st_size
            with open(encrypted_path, 'wb') as f:
                f.write(secrets.token_bytes(file_size))
            
            # Delete file
            encrypted_path.unlink()
        
        # Delete metadata
        self._delete_metadata(video_id)
        
        if video_id in self._metadata_cache:
            del self._metadata_cache[video_id]
        
        logger.info(f"Video securely deleted: {video_id}")
        
        return True
    
    def cleanup_expired(self) -> int:
        """
        Clean up expired videos
        Returns number of videos deleted
        """
        deleted_count = 0
        now = datetime.utcnow()
        
        metadata_path = self.storage_path / "metadata"
        if not metadata_path.exists():
            return 0
        
        for metadata_file in metadata_path.glob("*.json"):
            try:
                import json
                with open(metadata_file, 'r') as f:
                    data = json.load(f)
                
                expires_at = data.get("expires_at")
                if expires_at:
                    expires_at = datetime.fromisoformat(expires_at)
                    if now > expires_at:
                        video_id = data["video_id"]
                        if self.delete_video(video_id):
                            deleted_count += 1
            except Exception as e:
                logger.error(f"Error processing metadata file {metadata_file}: {e}")
        
        logger.info(f"Cleanup completed: {deleted_count} expired videos deleted")
        
        return deleted_count
    
    def get_storage_stats(self) -> Dict[str, Any]:
        """Get storage statistics"""
        total_size = 0
        file_count = 0
        
        for file_path in self.storage_path.glob("*.enc"):
            total_size += file_path.stat().st_size
            file_count += 1
        
        return {
            "storage_path": str(self.storage_path),
            "total_files": file_count,
            "total_size_bytes": total_size,
            "total_size_mb": round(total_size / (1024 * 1024), 2),
            "retention_days": self.retention_days
        }
    
    def _store_metadata(self, metadata: EncryptedVideoMetadata):
        """Store metadata to disk"""
        import json
        
        metadata_path = self.storage_path / "metadata"
        metadata_path.mkdir(exist_ok=True)
        
        metadata_file = metadata_path / f"{metadata.video_id}.json"
        
        with open(metadata_file, 'w') as f:
            json.dump(metadata.to_dict(), f, indent=2)
    
    def _get_metadata(self, video_id: str) -> Optional[EncryptedVideoMetadata]:
        """Get metadata from cache or disk"""
        if video_id in self._metadata_cache:
            return self._metadata_cache[video_id]
        
        import json
        import base64
        
        metadata_file = self.storage_path / "metadata" / f"{video_id}.json"
        
        if not metadata_file.exists():
            return None
        
        with open(metadata_file, 'r') as f:
            data = json.load(f)
        
        metadata = EncryptedVideoMetadata(
            video_id=data["video_id"],
            session_id=data["session_id"],
            original_filename=data["original_filename"],
            encrypted_filename=data["encrypted_filename"],
            file_size=data["file_size"],
            encrypted_size=data["encrypted_size"],
            content_type=data["content_type"],
            encryption_algorithm=data["encryption_algorithm"],
            key_id=data["key_id"],
            iv=base64.b64decode(data["iv"]),
            checksum_original=data["checksum_original"],
            checksum_encrypted=data["checksum_encrypted"],
            created_at=datetime.fromisoformat(data["created_at"]),
            expires_at=datetime.fromisoformat(data["expires_at"]) if data.get("expires_at") else None
        )
        
        self._metadata_cache[video_id] = metadata
        
        return metadata
    
    def _delete_metadata(self, video_id: str):
        """Delete metadata from disk"""
        metadata_file = self.storage_path / "metadata" / f"{video_id}.json"
        
        if metadata_file.exists():
            metadata_file.unlink()


class BiometricDataEncryptor:
    """
    Specialized encryption for biometric data (face encodings, fingerprints, etc.)
    Uses additional security measures for sensitive biometric information
    """
    
    def __init__(self, master_key: Optional[str] = None):
        self._master_key = master_key or os.getenv("BIOMETRIC_ENCRYPTION_KEY")
        if not self._master_key:
            self._master_key = secrets.token_hex(32)
    
    def encrypt_face_encoding(self, encoding: bytes, user_id: str) -> Dict[str, Any]:
        """Encrypt face encoding with user-specific key"""
        import base64
        
        # Derive user-specific key
        salt = hashlib.sha256(user_id.encode()).digest()
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=150000,  # Higher iterations for biometric data
            backend=default_backend()
        )
        key = kdf.derive(self._master_key.encode())
        
        # Encrypt
        iv = secrets.token_bytes(12)
        cipher = Cipher(
            algorithms.AES(key),
            modes.GCM(iv),
            backend=default_backend()
        )
        encryptor = cipher.encryptor()
        
        ciphertext = encryptor.update(encoding) + encryptor.finalize()
        
        return {
            "ciphertext": base64.b64encode(ciphertext).decode(),
            "iv": base64.b64encode(iv).decode(),
            "tag": base64.b64encode(encryptor.tag).decode(),
            "user_id_hash": hashlib.sha256(user_id.encode()).hexdigest()[:16],
            "algorithm": "AES-256-GCM",
            "created_at": datetime.utcnow().isoformat()
        }
    
    def decrypt_face_encoding(self, encrypted_data: Dict[str, Any], user_id: str) -> bytes:
        """Decrypt face encoding"""
        import base64
        
        # Verify user ID
        expected_hash = hashlib.sha256(user_id.encode()).hexdigest()[:16]
        if encrypted_data["user_id_hash"] != expected_hash:
            raise ValueError("User ID mismatch")
        
        # Derive key
        salt = hashlib.sha256(user_id.encode()).digest()
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=150000,
            backend=default_backend()
        )
        key = kdf.derive(self._master_key.encode())
        
        # Decrypt
        iv = base64.b64decode(encrypted_data["iv"])
        tag = base64.b64decode(encrypted_data["tag"])
        ciphertext = base64.b64decode(encrypted_data["ciphertext"])
        
        cipher = Cipher(
            algorithms.AES(key),
            modes.GCM(iv, tag),
            backend=default_backend()
        )
        decryptor = cipher.decryptor()
        
        return decryptor.update(ciphertext) + decryptor.finalize()
    
    def encrypt_liveness_data(self, liveness_data: Dict[str, Any], session_id: str) -> Dict[str, Any]:
        """Encrypt liveness detection data"""
        import json
        import base64
        
        # Serialize data
        plaintext = json.dumps(liveness_data).encode()
        
        # Derive session-specific key
        salt = hashlib.sha256(session_id.encode()).digest()
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
            backend=default_backend()
        )
        key = kdf.derive(self._master_key.encode())
        
        # Encrypt
        iv = secrets.token_bytes(12)
        cipher = Cipher(
            algorithms.AES(key),
            modes.GCM(iv),
            backend=default_backend()
        )
        encryptor = cipher.encryptor()
        
        ciphertext = encryptor.update(plaintext) + encryptor.finalize()
        
        return {
            "ciphertext": base64.b64encode(ciphertext).decode(),
            "iv": base64.b64encode(iv).decode(),
            "tag": base64.b64encode(encryptor.tag).decode(),
            "session_id_hash": hashlib.sha256(session_id.encode()).hexdigest()[:16],
            "algorithm": "AES-256-GCM",
            "created_at": datetime.utcnow().isoformat()
        }
    
    def decrypt_liveness_data(self, encrypted_data: Dict[str, Any], session_id: str) -> Dict[str, Any]:
        """Decrypt liveness detection data"""
        import json
        import base64
        
        # Verify session ID
        expected_hash = hashlib.sha256(session_id.encode()).hexdigest()[:16]
        if encrypted_data["session_id_hash"] != expected_hash:
            raise ValueError("Session ID mismatch")
        
        # Derive key
        salt = hashlib.sha256(session_id.encode()).digest()
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
            backend=default_backend()
        )
        key = kdf.derive(self._master_key.encode())
        
        # Decrypt
        iv = base64.b64decode(encrypted_data["iv"])
        tag = base64.b64decode(encrypted_data["tag"])
        ciphertext = base64.b64decode(encrypted_data["ciphertext"])
        
        cipher = Cipher(
            algorithms.AES(key),
            modes.GCM(iv, tag),
            backend=default_backend()
        )
        decryptor = cipher.decryptor()
        
        plaintext = decryptor.update(ciphertext) + decryptor.finalize()
        
        return json.loads(plaintext.decode())


# Global service instances
_video_storage_service: Optional[VideoStorageEncryptionService] = None
_biometric_encryptor: Optional[BiometricDataEncryptor] = None


def get_video_storage_service() -> VideoStorageEncryptionService:
    """Get or create video storage service instance"""
    global _video_storage_service
    if _video_storage_service is None:
        _video_storage_service = VideoStorageEncryptionService()
    return _video_storage_service


def get_biometric_encryptor() -> BiometricDataEncryptor:
    """Get or create biometric encryptor instance"""
    global _biometric_encryptor
    if _biometric_encryptor is None:
        _biometric_encryptor = BiometricDataEncryptor()
    return _biometric_encryptor
