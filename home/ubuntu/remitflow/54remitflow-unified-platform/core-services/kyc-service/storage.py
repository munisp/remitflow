"""
Document Storage Module
S3-compatible storage for KYC documents with local fallback
"""

import os
import hashlib
import logging
from abc import ABC, abstractmethod
from typing import Optional, BinaryIO, Tuple
from dataclasses import dataclass
from datetime import datetime, timedelta
import uuid

logger = logging.getLogger(__name__)

# Environment configuration
STORAGE_PROVIDER = os.getenv("STORAGE_PROVIDER", "local")  # local, s3, gcs
STORAGE_BUCKET = os.getenv("STORAGE_BUCKET", "kyc-documents")
LOCAL_STORAGE_PATH = os.getenv("LOCAL_STORAGE_PATH", "/tmp/kyc-documents")


@dataclass
class StorageResult:
    """Result from storage operation"""
    success: bool
    storage_key: str
    file_url: str
    file_hash: str
    file_size: int
    content_type: str
    provider: str
    error: Optional[str] = None


class StorageProvider(ABC):
    """Abstract base class for storage providers"""
    
    @abstractmethod
    async def upload(
        self,
        file: BinaryIO,
        filename: str,
        content_type: str,
        user_id: str,
        document_type: str
    ) -> StorageResult:
        """Upload a file to storage"""
        pass
    
    @abstractmethod
    async def download(self, storage_key: str) -> Tuple[bytes, str]:
        """Download a file from storage, returns (content, content_type)"""
        pass
    
    @abstractmethod
    async def delete(self, storage_key: str) -> bool:
        """Delete a file from storage"""
        pass
    
    @abstractmethod
    async def get_presigned_url(self, storage_key: str, expires_in: int = 3600) -> str:
        """Get a presigned URL for temporary access"""
        pass
    
    def _generate_storage_key(self, user_id: str, document_type: str, filename: str) -> str:
        """Generate a unique storage key"""
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        unique_id = uuid.uuid4().hex[:8]
        ext = os.path.splitext(filename)[1] or ".bin"
        return f"kyc/{user_id}/{document_type}/{timestamp}_{unique_id}{ext}"
    
    def _calculate_hash(self, content: bytes) -> str:
        """Calculate SHA-256 hash of content"""
        return hashlib.sha256(content).hexdigest()


class LocalStorageProvider(StorageProvider):
    """Local filesystem storage for development"""
    
    def __init__(self, base_path: str = LOCAL_STORAGE_PATH):
        self.base_path = base_path
        os.makedirs(base_path, exist_ok=True)
    
    async def upload(
        self,
        file: BinaryIO,
        filename: str,
        content_type: str,
        user_id: str,
        document_type: str
    ) -> StorageResult:
        try:
            storage_key = self._generate_storage_key(user_id, document_type, filename)
            full_path = os.path.join(self.base_path, storage_key)
            
            # Create directory structure
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            
            # Read and write file
            content = file.read()
            file_hash = self._calculate_hash(content)
            
            with open(full_path, "wb") as f:
                f.write(content)
            
            # Store metadata
            metadata_path = f"{full_path}.meta"
            with open(metadata_path, "w") as f:
                f.write(f"content_type={content_type}\n")
                f.write(f"original_filename={filename}\n")
                f.write(f"file_hash={file_hash}\n")
            
            return StorageResult(
                success=True,
                storage_key=storage_key,
                file_url=f"file://{full_path}",
                file_hash=file_hash,
                file_size=len(content),
                content_type=content_type,
                provider="local"
            )
        except Exception as e:
            logger.error(f"Local storage upload failed: {e}")
            return StorageResult(
                success=False,
                storage_key="",
                file_url="",
                file_hash="",
                file_size=0,
                content_type=content_type,
                provider="local",
                error=str(e)
            )
    
    async def download(self, storage_key: str) -> Tuple[bytes, str]:
        full_path = os.path.join(self.base_path, storage_key)
        
        # Read content type from metadata
        content_type = "application/octet-stream"
        metadata_path = f"{full_path}.meta"
        if os.path.exists(metadata_path):
            with open(metadata_path, "r") as f:
                for line in f:
                    if line.startswith("content_type="):
                        content_type = line.split("=", 1)[1].strip()
                        break
        
        with open(full_path, "rb") as f:
            return f.read(), content_type
    
    async def delete(self, storage_key: str) -> bool:
        try:
            full_path = os.path.join(self.base_path, storage_key)
            if os.path.exists(full_path):
                os.remove(full_path)
            metadata_path = f"{full_path}.meta"
            if os.path.exists(metadata_path):
                os.remove(metadata_path)
            return True
        except Exception as e:
            logger.error(f"Local storage delete failed: {e}")
            return False
    
    async def get_presigned_url(self, storage_key: str, expires_in: int = 3600) -> str:
        # Local storage doesn't support presigned URLs, return file path
        return f"file://{os.path.join(self.base_path, storage_key)}"


class S3StorageProvider(StorageProvider):
    """AWS S3 storage provider"""
    
    def __init__(self):
        self.bucket = os.getenv("AWS_S3_BUCKET", STORAGE_BUCKET)
        self.region = os.getenv("AWS_REGION", "us-east-1")
        self.access_key = os.getenv("AWS_ACCESS_KEY_ID")
        self.secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")
        self.endpoint_url = os.getenv("AWS_S3_ENDPOINT_URL")  # For S3-compatible services
        
        self._client = None
    
    def _get_client(self):
        """Lazy initialization of boto3 client"""
        if self._client is None:
            try:
                import boto3
                from botocore.config import Config
                
                config = Config(
                    signature_version='s3v4',
                    retries={'max_attempts': 3}
                )
                
                kwargs = {
                    "service_name": "s3",
                    "region_name": self.region,
                    "config": config
                }
                
                if self.access_key and self.secret_key:
                    kwargs["aws_access_key_id"] = self.access_key
                    kwargs["aws_secret_access_key"] = self.secret_key
                
                if self.endpoint_url:
                    kwargs["endpoint_url"] = self.endpoint_url
                
                self._client = boto3.client(**kwargs)
            except ImportError:
                raise ImportError("boto3 is required for S3 storage. Install with: pip install boto3")
        
        return self._client
    
    async def upload(
        self,
        file: BinaryIO,
        filename: str,
        content_type: str,
        user_id: str,
        document_type: str
    ) -> StorageResult:
        try:
            client = self._get_client()
            storage_key = self._generate_storage_key(user_id, document_type, filename)
            
            content = file.read()
            file_hash = self._calculate_hash(content)
            
            # Reset file position
            file.seek(0)
            
            client.upload_fileobj(
                file,
                self.bucket,
                storage_key,
                ExtraArgs={
                    "ContentType": content_type,
                    "Metadata": {
                        "original_filename": filename,
                        "user_id": user_id,
                        "document_type": document_type,
                        "file_hash": file_hash
                    }
                }
            )
            
            # Generate URL
            if self.endpoint_url:
                file_url = f"{self.endpoint_url}/{self.bucket}/{storage_key}"
            else:
                file_url = f"https://{self.bucket}.s3.{self.region}.amazonaws.com/{storage_key}"
            
            return StorageResult(
                success=True,
                storage_key=storage_key,
                file_url=file_url,
                file_hash=file_hash,
                file_size=len(content),
                content_type=content_type,
                provider="s3"
            )
        except Exception as e:
            logger.error(f"S3 upload failed: {e}")
            return StorageResult(
                success=False,
                storage_key="",
                file_url="",
                file_hash="",
                file_size=0,
                content_type=content_type,
                provider="s3",
                error=str(e)
            )
    
    async def download(self, storage_key: str) -> Tuple[bytes, str]:
        client = self._get_client()
        
        response = client.get_object(Bucket=self.bucket, Key=storage_key)
        content = response["Body"].read()
        content_type = response.get("ContentType", "application/octet-stream")
        
        return content, content_type
    
    async def delete(self, storage_key: str) -> bool:
        try:
            client = self._get_client()
            client.delete_object(Bucket=self.bucket, Key=storage_key)
            return True
        except Exception as e:
            logger.error(f"S3 delete failed: {e}")
            return False
    
    async def get_presigned_url(self, storage_key: str, expires_in: int = 3600) -> str:
        client = self._get_client()
        
        url = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": storage_key},
            ExpiresIn=expires_in
        )
        
        return url


class GCSStorageProvider(StorageProvider):
    """Google Cloud Storage provider"""
    
    def __init__(self):
        self.bucket_name = os.getenv("GCS_BUCKET", STORAGE_BUCKET)
        self.credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        
        self._client = None
        self._bucket = None
    
    def _get_bucket(self):
        """Lazy initialization of GCS bucket"""
        if self._bucket is None:
            try:
                from google.cloud import storage
                
                if self.credentials_path:
                    self._client = storage.Client.from_service_account_json(self.credentials_path)
                else:
                    self._client = storage.Client()
                
                self._bucket = self._client.bucket(self.bucket_name)
            except ImportError:
                raise ImportError("google-cloud-storage is required for GCS. Install with: pip install google-cloud-storage")
        
        return self._bucket
    
    async def upload(
        self,
        file: BinaryIO,
        filename: str,
        content_type: str,
        user_id: str,
        document_type: str
    ) -> StorageResult:
        try:
            bucket = self._get_bucket()
            storage_key = self._generate_storage_key(user_id, document_type, filename)
            
            content = file.read()
            file_hash = self._calculate_hash(content)
            
            blob = bucket.blob(storage_key)
            blob.metadata = {
                "original_filename": filename,
                "user_id": user_id,
                "document_type": document_type,
                "file_hash": file_hash
            }
            
            file.seek(0)
            blob.upload_from_file(file, content_type=content_type)
            
            return StorageResult(
                success=True,
                storage_key=storage_key,
                file_url=f"gs://{self.bucket_name}/{storage_key}",
                file_hash=file_hash,
                file_size=len(content),
                content_type=content_type,
                provider="gcs"
            )
        except Exception as e:
            logger.error(f"GCS upload failed: {e}")
            return StorageResult(
                success=False,
                storage_key="",
                file_url="",
                file_hash="",
                file_size=0,
                content_type=content_type,
                provider="gcs",
                error=str(e)
            )
    
    async def download(self, storage_key: str) -> Tuple[bytes, str]:
        bucket = self._get_bucket()
        blob = bucket.blob(storage_key)
        
        content = blob.download_as_bytes()
        content_type = blob.content_type or "application/octet-stream"
        
        return content, content_type
    
    async def delete(self, storage_key: str) -> bool:
        try:
            bucket = self._get_bucket()
            blob = bucket.blob(storage_key)
            blob.delete()
            return True
        except Exception as e:
            logger.error(f"GCS delete failed: {e}")
            return False
    
    async def get_presigned_url(self, storage_key: str, expires_in: int = 3600) -> str:
        bucket = self._get_bucket()
        blob = bucket.blob(storage_key)
        
        url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(seconds=expires_in),
            method="GET"
        )
        
        return url


# Storage Factory
def get_storage_provider() -> StorageProvider:
    """Get configured storage provider"""
    provider = STORAGE_PROVIDER.lower()
    
    if provider == "s3":
        return S3StorageProvider()
    elif provider == "gcs":
        return GCSStorageProvider()
    else:
        return LocalStorageProvider()
