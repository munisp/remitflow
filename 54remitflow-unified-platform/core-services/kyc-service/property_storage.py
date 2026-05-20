"""
Property Transaction KYC Document Storage Integration
Handles secure storage of property transaction documents (bank statements, income docs, purchase agreements)
"""

import os
import hashlib
import logging
from typing import Optional, Dict, Any, BinaryIO
from datetime import datetime, timedelta
from dataclasses import dataclass
from enum import Enum
import uuid

logger = logging.getLogger(__name__)

# Storage configuration
STORAGE_PROVIDER = os.getenv("STORAGE_PROVIDER", "s3")  # s3, gcs, azure, local
S3_BUCKET = os.getenv("S3_BUCKET", "property-kyc-documents")
S3_REGION = os.getenv("S3_REGION", "eu-west-1")
GCS_BUCKET = os.getenv("GCS_BUCKET", "property-kyc-documents")
AZURE_CONTAINER = os.getenv("AZURE_CONTAINER", "property-kyc-documents")
LOCAL_STORAGE_PATH = os.getenv("LOCAL_STORAGE_PATH", "/tmp/property-kyc-documents")

# Presigned URL expiry
PRESIGNED_URL_EXPIRY_SECONDS = int(os.getenv("PRESIGNED_URL_EXPIRY_SECONDS", "3600"))


class DocumentCategory(str, Enum):
    IDENTITY = "identity"
    BANK_STATEMENT = "bank_statement"
    INCOME_DOCUMENT = "income_document"
    PURCHASE_AGREEMENT = "purchase_agreement"
    GIFT_DECLARATION = "gift_declaration"
    PROPERTY_DOCUMENT = "property_document"
    OTHER = "other"


class StorageProvider(str, Enum):
    S3 = "s3"
    GCS = "gcs"
    AZURE = "azure"
    LOCAL = "local"


@dataclass
class StoredDocument:
    """Represents a stored document"""
    storage_key: str
    document_hash: str
    content_type: str
    size_bytes: int
    category: DocumentCategory
    transaction_id: str
    party_id: Optional[str]
    uploaded_at: str
    metadata: Dict[str, Any]


@dataclass
class PresignedUrl:
    """Presigned URL for document access"""
    url: str
    expires_at: str
    method: str  # GET or PUT


def compute_document_hash(content: bytes) -> str:
    """Compute SHA-256 hash of document content"""
    return hashlib.sha256(content).hexdigest()


def generate_storage_key(
    transaction_id: str,
    category: DocumentCategory,
    party_id: Optional[str] = None,
    filename: Optional[str] = None
) -> str:
    """Generate a unique storage key for a document"""
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    unique_id = uuid.uuid4().hex[:8]
    
    if party_id:
        base_path = f"transactions/{transaction_id}/parties/{party_id}/{category.value}"
    else:
        base_path = f"transactions/{transaction_id}/{category.value}"
    
    if filename:
        ext = filename.split(".")[-1] if "." in filename else "bin"
        return f"{base_path}/{timestamp}_{unique_id}.{ext}"
    
    return f"{base_path}/{timestamp}_{unique_id}"


class PropertyDocumentStorage:
    """Abstract base class for document storage"""
    
    async def upload(
        self,
        content: bytes,
        storage_key: str,
        content_type: str,
        metadata: Optional[Dict[str, str]] = None
    ) -> StoredDocument:
        raise NotImplementedError
    
    async def download(self, storage_key: str) -> bytes:
        raise NotImplementedError
    
    async def get_presigned_download_url(
        self,
        storage_key: str,
        expiry_seconds: int = PRESIGNED_URL_EXPIRY_SECONDS
    ) -> PresignedUrl:
        raise NotImplementedError
    
    async def get_presigned_upload_url(
        self,
        storage_key: str,
        content_type: str,
        expiry_seconds: int = PRESIGNED_URL_EXPIRY_SECONDS
    ) -> PresignedUrl:
        raise NotImplementedError
    
    async def delete(self, storage_key: str) -> bool:
        raise NotImplementedError
    
    async def exists(self, storage_key: str) -> bool:
        raise NotImplementedError


class S3DocumentStorage(PropertyDocumentStorage):
    """AWS S3 document storage implementation"""
    
    def __init__(self, bucket: str = S3_BUCKET, region: str = S3_REGION):
        self.bucket = bucket
        self.region = region
        self._client = None
    
    def _get_client(self):
        if self._client is None:
            try:
                import boto3
                self._client = boto3.client("s3", region_name=self.region)
            except ImportError:
                raise ImportError("boto3 is required for S3 storage. Install with: pip install boto3")
        return self._client
    
    async def upload(
        self,
        content: bytes,
        storage_key: str,
        content_type: str,
        metadata: Optional[Dict[str, str]] = None
    ) -> StoredDocument:
        client = self._get_client()
        
        document_hash = compute_document_hash(content)
        
        extra_args = {
            "ContentType": content_type,
            "Metadata": metadata or {},
            "ServerSideEncryption": "AES256"
        }
        extra_args["Metadata"]["document_hash"] = document_hash
        
        client.put_object(
            Bucket=self.bucket,
            Key=storage_key,
            Body=content,
            **extra_args
        )
        
        # Parse transaction_id and party_id from storage_key
        parts = storage_key.split("/")
        transaction_id = parts[1] if len(parts) > 1 else ""
        party_id = parts[3] if len(parts) > 3 and parts[2] == "parties" else None
        category_str = parts[-2] if len(parts) > 1 else "other"
        
        try:
            category = DocumentCategory(category_str)
        except ValueError:
            category = DocumentCategory.OTHER
        
        return StoredDocument(
            storage_key=storage_key,
            document_hash=document_hash,
            content_type=content_type,
            size_bytes=len(content),
            category=category,
            transaction_id=transaction_id,
            party_id=party_id,
            uploaded_at=datetime.utcnow().isoformat(),
            metadata=metadata or {}
        )
    
    async def download(self, storage_key: str) -> bytes:
        client = self._get_client()
        response = client.get_object(Bucket=self.bucket, Key=storage_key)
        return response["Body"].read()
    
    async def get_presigned_download_url(
        self,
        storage_key: str,
        expiry_seconds: int = PRESIGNED_URL_EXPIRY_SECONDS
    ) -> PresignedUrl:
        client = self._get_client()
        url = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": storage_key},
            ExpiresIn=expiry_seconds
        )
        expires_at = (datetime.utcnow() + timedelta(seconds=expiry_seconds)).isoformat()
        return PresignedUrl(url=url, expires_at=expires_at, method="GET")
    
    async def get_presigned_upload_url(
        self,
        storage_key: str,
        content_type: str,
        expiry_seconds: int = PRESIGNED_URL_EXPIRY_SECONDS
    ) -> PresignedUrl:
        client = self._get_client()
        url = client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self.bucket,
                "Key": storage_key,
                "ContentType": content_type
            },
            ExpiresIn=expiry_seconds
        )
        expires_at = (datetime.utcnow() + timedelta(seconds=expiry_seconds)).isoformat()
        return PresignedUrl(url=url, expires_at=expires_at, method="PUT")
    
    async def delete(self, storage_key: str) -> bool:
        client = self._get_client()
        try:
            client.delete_object(Bucket=self.bucket, Key=storage_key)
            return True
        except Exception as e:
            logger.error(f"Failed to delete {storage_key}: {e}")
            return False
    
    async def exists(self, storage_key: str) -> bool:
        client = self._get_client()
        try:
            client.head_object(Bucket=self.bucket, Key=storage_key)
            return True
        except Exception:
            return False


class GCSDocumentStorage(PropertyDocumentStorage):
    """Google Cloud Storage document storage implementation"""
    
    def __init__(self, bucket: str = GCS_BUCKET):
        self.bucket_name = bucket
        self._client = None
        self._bucket = None
    
    def _get_bucket(self):
        if self._bucket is None:
            try:
                from google.cloud import storage
                self._client = storage.Client()
                self._bucket = self._client.bucket(self.bucket_name)
            except ImportError:
                raise ImportError("google-cloud-storage is required. Install with: pip install google-cloud-storage")
        return self._bucket
    
    async def upload(
        self,
        content: bytes,
        storage_key: str,
        content_type: str,
        metadata: Optional[Dict[str, str]] = None
    ) -> StoredDocument:
        bucket = self._get_bucket()
        blob = bucket.blob(storage_key)
        
        document_hash = compute_document_hash(content)
        
        blob.metadata = metadata or {}
        blob.metadata["document_hash"] = document_hash
        blob.upload_from_string(content, content_type=content_type)
        
        # Parse transaction_id and party_id from storage_key
        parts = storage_key.split("/")
        transaction_id = parts[1] if len(parts) > 1 else ""
        party_id = parts[3] if len(parts) > 3 and parts[2] == "parties" else None
        category_str = parts[-2] if len(parts) > 1 else "other"
        
        try:
            category = DocumentCategory(category_str)
        except ValueError:
            category = DocumentCategory.OTHER
        
        return StoredDocument(
            storage_key=storage_key,
            document_hash=document_hash,
            content_type=content_type,
            size_bytes=len(content),
            category=category,
            transaction_id=transaction_id,
            party_id=party_id,
            uploaded_at=datetime.utcnow().isoformat(),
            metadata=metadata or {}
        )
    
    async def download(self, storage_key: str) -> bytes:
        bucket = self._get_bucket()
        blob = bucket.blob(storage_key)
        return blob.download_as_bytes()
    
    async def get_presigned_download_url(
        self,
        storage_key: str,
        expiry_seconds: int = PRESIGNED_URL_EXPIRY_SECONDS
    ) -> PresignedUrl:
        bucket = self._get_bucket()
        blob = bucket.blob(storage_key)
        url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(seconds=expiry_seconds),
            method="GET"
        )
        expires_at = (datetime.utcnow() + timedelta(seconds=expiry_seconds)).isoformat()
        return PresignedUrl(url=url, expires_at=expires_at, method="GET")
    
    async def get_presigned_upload_url(
        self,
        storage_key: str,
        content_type: str,
        expiry_seconds: int = PRESIGNED_URL_EXPIRY_SECONDS
    ) -> PresignedUrl:
        bucket = self._get_bucket()
        blob = bucket.blob(storage_key)
        url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(seconds=expiry_seconds),
            method="PUT",
            content_type=content_type
        )
        expires_at = (datetime.utcnow() + timedelta(seconds=expiry_seconds)).isoformat()
        return PresignedUrl(url=url, expires_at=expires_at, method="PUT")
    
    async def delete(self, storage_key: str) -> bool:
        bucket = self._get_bucket()
        blob = bucket.blob(storage_key)
        try:
            blob.delete()
            return True
        except Exception as e:
            logger.error(f"Failed to delete {storage_key}: {e}")
            return False
    
    async def exists(self, storage_key: str) -> bool:
        bucket = self._get_bucket()
        blob = bucket.blob(storage_key)
        return blob.exists()


class LocalDocumentStorage(PropertyDocumentStorage):
    """Local filesystem document storage (for development/testing)"""
    
    def __init__(self, base_path: str = LOCAL_STORAGE_PATH):
        self.base_path = base_path
        os.makedirs(base_path, exist_ok=True)
    
    def _get_full_path(self, storage_key: str) -> str:
        return os.path.join(self.base_path, storage_key)
    
    async def upload(
        self,
        content: bytes,
        storage_key: str,
        content_type: str,
        metadata: Optional[Dict[str, str]] = None
    ) -> StoredDocument:
        full_path = self._get_full_path(storage_key)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        
        document_hash = compute_document_hash(content)
        
        with open(full_path, "wb") as f:
            f.write(content)
        
        # Store metadata in a sidecar file
        import json
        meta = metadata or {}
        meta["document_hash"] = document_hash
        meta["content_type"] = content_type
        meta["size_bytes"] = len(content)
        meta["uploaded_at"] = datetime.utcnow().isoformat()
        
        with open(f"{full_path}.meta.json", "w") as f:
            json.dump(meta, f)
        
        # Parse transaction_id and party_id from storage_key
        parts = storage_key.split("/")
        transaction_id = parts[1] if len(parts) > 1 else ""
        party_id = parts[3] if len(parts) > 3 and parts[2] == "parties" else None
        category_str = parts[-2] if len(parts) > 1 else "other"
        
        try:
            category = DocumentCategory(category_str)
        except ValueError:
            category = DocumentCategory.OTHER
        
        return StoredDocument(
            storage_key=storage_key,
            document_hash=document_hash,
            content_type=content_type,
            size_bytes=len(content),
            category=category,
            transaction_id=transaction_id,
            party_id=party_id,
            uploaded_at=datetime.utcnow().isoformat(),
            metadata=metadata or {}
        )
    
    async def download(self, storage_key: str) -> bytes:
        full_path = self._get_full_path(storage_key)
        with open(full_path, "rb") as f:
            return f.read()
    
    async def get_presigned_download_url(
        self,
        storage_key: str,
        expiry_seconds: int = PRESIGNED_URL_EXPIRY_SECONDS
    ) -> PresignedUrl:
        # For local storage, return a file:// URL (not secure, for dev only)
        full_path = self._get_full_path(storage_key)
        expires_at = (datetime.utcnow() + timedelta(seconds=expiry_seconds)).isoformat()
        return PresignedUrl(url=f"file://{full_path}", expires_at=expires_at, method="GET")
    
    async def get_presigned_upload_url(
        self,
        storage_key: str,
        content_type: str,
        expiry_seconds: int = PRESIGNED_URL_EXPIRY_SECONDS
    ) -> PresignedUrl:
        full_path = self._get_full_path(storage_key)
        expires_at = (datetime.utcnow() + timedelta(seconds=expiry_seconds)).isoformat()
        return PresignedUrl(url=f"file://{full_path}", expires_at=expires_at, method="PUT")
    
    async def delete(self, storage_key: str) -> bool:
        full_path = self._get_full_path(storage_key)
        try:
            os.remove(full_path)
            if os.path.exists(f"{full_path}.meta.json"):
                os.remove(f"{full_path}.meta.json")
            return True
        except Exception as e:
            logger.error(f"Failed to delete {storage_key}: {e}")
            return False
    
    async def exists(self, storage_key: str) -> bool:
        full_path = self._get_full_path(storage_key)
        return os.path.exists(full_path)


def get_document_storage() -> PropertyDocumentStorage:
    """Factory function to get the configured document storage provider"""
    provider = StorageProvider(STORAGE_PROVIDER.lower())
    
    if provider == StorageProvider.S3:
        return S3DocumentStorage()
    elif provider == StorageProvider.GCS:
        return GCSDocumentStorage()
    elif provider == StorageProvider.LOCAL:
        return LocalDocumentStorage()
    else:
        logger.warning(f"Unknown storage provider {provider}, falling back to local")
        return LocalDocumentStorage()


class PropertyDocumentService:
    """High-level service for property document operations"""
    
    def __init__(self, storage: Optional[PropertyDocumentStorage] = None):
        self.storage = storage or get_document_storage()
    
    async def upload_bank_statement(
        self,
        transaction_id: str,
        party_id: str,
        content: bytes,
        filename: str,
        content_type: str = "application/pdf",
        bank_name: Optional[str] = None,
        statement_period: Optional[str] = None
    ) -> StoredDocument:
        """Upload a bank statement document"""
        storage_key = generate_storage_key(
            transaction_id=transaction_id,
            category=DocumentCategory.BANK_STATEMENT,
            party_id=party_id,
            filename=filename
        )
        
        metadata = {
            "original_filename": filename,
            "bank_name": bank_name or "",
            "statement_period": statement_period or ""
        }
        
        return await self.storage.upload(content, storage_key, content_type, metadata)
    
    async def upload_income_document(
        self,
        transaction_id: str,
        party_id: str,
        content: bytes,
        filename: str,
        document_type: str,
        content_type: str = "application/pdf",
        tax_year: Optional[int] = None
    ) -> StoredDocument:
        """Upload an income verification document"""
        storage_key = generate_storage_key(
            transaction_id=transaction_id,
            category=DocumentCategory.INCOME_DOCUMENT,
            party_id=party_id,
            filename=filename
        )
        
        metadata = {
            "original_filename": filename,
            "document_type": document_type,
            "tax_year": str(tax_year) if tax_year else ""
        }
        
        return await self.storage.upload(content, storage_key, content_type, metadata)
    
    async def upload_purchase_agreement(
        self,
        transaction_id: str,
        content: bytes,
        filename: str,
        content_type: str = "application/pdf"
    ) -> StoredDocument:
        """Upload a purchase agreement document"""
        storage_key = generate_storage_key(
            transaction_id=transaction_id,
            category=DocumentCategory.PURCHASE_AGREEMENT,
            filename=filename
        )
        
        metadata = {
            "original_filename": filename
        }
        
        return await self.storage.upload(content, storage_key, content_type, metadata)
    
    async def upload_identity_document(
        self,
        transaction_id: str,
        party_id: str,
        content: bytes,
        filename: str,
        id_type: str,
        content_type: str = "image/jpeg"
    ) -> StoredDocument:
        """Upload an identity document"""
        storage_key = generate_storage_key(
            transaction_id=transaction_id,
            category=DocumentCategory.IDENTITY,
            party_id=party_id,
            filename=filename
        )
        
        metadata = {
            "original_filename": filename,
            "id_type": id_type
        }
        
        return await self.storage.upload(content, storage_key, content_type, metadata)
    
    async def get_download_url(
        self,
        storage_key: str,
        expiry_seconds: int = PRESIGNED_URL_EXPIRY_SECONDS
    ) -> PresignedUrl:
        """Get a presigned download URL for a document"""
        return await self.storage.get_presigned_download_url(storage_key, expiry_seconds)
    
    async def verify_document_integrity(
        self,
        storage_key: str,
        expected_hash: str
    ) -> bool:
        """Verify document integrity by comparing hashes"""
        try:
            content = await self.storage.download(storage_key)
            actual_hash = compute_document_hash(content)
            return actual_hash == expected_hash
        except Exception as e:
            logger.error(f"Failed to verify document integrity: {e}")
            return False
