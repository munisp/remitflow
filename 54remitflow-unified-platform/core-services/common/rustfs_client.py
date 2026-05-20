"""
RustFS Object Storage Client
Unified S3-compatible object storage client for RustFS integration

RustFS is a high-performance, S3-compatible object storage system built in Rust.
This client provides a unified interface for all platform services to interact
with RustFS for document storage, model artifacts, lakehouse data, and more.

Configuration:
    RUSTFS_ENDPOINT: RustFS server endpoint (default: http://localhost:9000)
    RUSTFS_ACCESS_KEY: Access key for authentication
    RUSTFS_SECRET_KEY: Secret key for authentication
    RUSTFS_REGION: Region for S3 compatibility (default: us-east-1)
    RUSTFS_SECURE: Use HTTPS (default: false for local dev)
    OBJECT_STORAGE_BACKEND: Backend type - 's3' for RustFS/S3, 'memory' for testing
"""

import os
import io
import hashlib
import logging
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, List, BinaryIO, Tuple, Union
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
import uuid
import json

logger = logging.getLogger(__name__)


# Configuration from environment
RUSTFS_ENDPOINT = os.getenv("RUSTFS_ENDPOINT", "http://localhost:9000")
RUSTFS_ACCESS_KEY = os.getenv("RUSTFS_ACCESS_KEY", "rustfsadmin")
RUSTFS_SECRET_KEY = os.getenv("RUSTFS_SECRET_KEY", "rustfsadmin")
RUSTFS_REGION = os.getenv("RUSTFS_REGION", "us-east-1")
RUSTFS_SECURE = os.getenv("RUSTFS_SECURE", "false").lower() == "true"
OBJECT_STORAGE_BACKEND = os.getenv("OBJECT_STORAGE_BACKEND", "s3")  # s3 or memory

# Default buckets for different services
BUCKETS = {
    "kyc_documents": os.getenv("RUSTFS_KYC_BUCKET", "kyc-documents"),
    "property_documents": os.getenv("RUSTFS_PROPERTY_BUCKET", "property-kyc-documents"),
    "ml_models": os.getenv("RUSTFS_ML_BUCKET", "ml-models"),
    "ml_artifacts": os.getenv("RUSTFS_ML_ARTIFACTS_BUCKET", "ml-artifacts"),
    "lakehouse_bronze": os.getenv("RUSTFS_LAKEHOUSE_BRONZE_BUCKET", "lakehouse-bronze"),
    "lakehouse_silver": os.getenv("RUSTFS_LAKEHOUSE_SILVER_BUCKET", "lakehouse-silver"),
    "lakehouse_gold": os.getenv("RUSTFS_LAKEHOUSE_GOLD_BUCKET", "lakehouse-gold"),
    "audit_logs": os.getenv("RUSTFS_AUDIT_BUCKET", "audit-logs"),
    "backups": os.getenv("RUSTFS_BACKUP_BUCKET", "backups"),
}


class ObjectStorageBackend(str, Enum):
    """Supported storage backends"""
    S3 = "s3"  # RustFS, MinIO, AWS S3, or any S3-compatible storage
    MEMORY = "memory"  # In-memory storage for testing


@dataclass
class ObjectMetadata:
    """Metadata for a stored object"""
    key: str
    bucket: str
    size: int
    content_type: str
    etag: str
    last_modified: datetime
    metadata: Dict[str, str] = field(default_factory=dict)
    version_id: Optional[str] = None


@dataclass
class PutObjectResult:
    """Result of a put operation"""
    key: str
    bucket: str
    etag: str
    version_id: Optional[str] = None
    size: int = 0


@dataclass
class ListObjectsResult:
    """Result of a list operation"""
    objects: List[ObjectMetadata]
    is_truncated: bool
    continuation_token: Optional[str] = None
    prefix: Optional[str] = None


class ObjectStorageClient(ABC):
    """Abstract base class for object storage operations"""
    
    @abstractmethod
    async def put_object(
        self,
        bucket: str,
        key: str,
        data: Union[bytes, BinaryIO],
        content_type: str = "application/octet-stream",
        metadata: Optional[Dict[str, str]] = None
    ) -> PutObjectResult:
        """Upload an object to storage"""
        pass
    
    @abstractmethod
    async def get_object(self, bucket: str, key: str) -> Tuple[bytes, ObjectMetadata]:
        """Download an object from storage"""
        pass
    
    @abstractmethod
    async def delete_object(self, bucket: str, key: str) -> bool:
        """Delete an object from storage"""
        pass
    
    @abstractmethod
    async def head_object(self, bucket: str, key: str) -> Optional[ObjectMetadata]:
        """Get object metadata without downloading content"""
        pass
    
    @abstractmethod
    async def list_objects(
        self,
        bucket: str,
        prefix: Optional[str] = None,
        max_keys: int = 1000,
        continuation_token: Optional[str] = None
    ) -> ListObjectsResult:
        """List objects in a bucket"""
        pass
    
    @abstractmethod
    async def generate_presigned_url(
        self,
        bucket: str,
        key: str,
        expires_in: int = 3600,
        method: str = "GET"
    ) -> str:
        """Generate a presigned URL for temporary access"""
        pass
    
    @abstractmethod
    async def create_bucket(self, bucket: str) -> bool:
        """Create a new bucket"""
        pass
    
    @abstractmethod
    async def bucket_exists(self, bucket: str) -> bool:
        """Check if a bucket exists"""
        pass
    
    @abstractmethod
    async def delete_bucket(self, bucket: str) -> bool:
        """Delete a bucket (must be empty)"""
        pass
    
    def _compute_hash(self, data: bytes) -> str:
        """Compute MD5 hash for ETag"""
        return hashlib.md5(data).hexdigest()
    
    def _generate_etag(self, data: bytes) -> str:
        """Generate ETag in S3 format"""
        return f'"{self._compute_hash(data)}"'


class RustFSClient(ObjectStorageClient):
    """
    RustFS/S3-compatible object storage client using boto3
    
    This client works with RustFS, MinIO, AWS S3, or any S3-compatible storage.
    """
    
    def __init__(
        self,
        endpoint_url: str = RUSTFS_ENDPOINT,
        access_key: str = RUSTFS_ACCESS_KEY,
        secret_key: str = RUSTFS_SECRET_KEY,
        region: str = RUSTFS_REGION,
        secure: bool = RUSTFS_SECURE
    ):
        self.endpoint_url = endpoint_url
        self.access_key = access_key
        self.secret_key = secret_key
        self.region = region
        self.secure = secure
        self._client = None
        self._resource = None
    
    def _get_client(self):
        """Lazy initialization of boto3 client"""
        if self._client is None:
            try:
                import boto3
                from botocore.config import Config
                
                config = Config(
                    signature_version='s3v4',
                    retries={'max_attempts': 3, 'mode': 'adaptive'},
                    connect_timeout=5,
                    read_timeout=30
                )
                
                self._client = boto3.client(
                    "s3",
                    endpoint_url=self.endpoint_url,
                    aws_access_key_id=self.access_key,
                    aws_secret_access_key=self.secret_key,
                    region_name=self.region,
                    config=config
                )
                
                logger.info(f"RustFS client initialized with endpoint: {self.endpoint_url}")
            except ImportError:
                raise ImportError(
                    "boto3 is required for RustFS storage. Install with: pip install boto3"
                )
        
        return self._client
    
    async def put_object(
        self,
        bucket: str,
        key: str,
        data: Union[bytes, BinaryIO],
        content_type: str = "application/octet-stream",
        metadata: Optional[Dict[str, str]] = None
    ) -> PutObjectResult:
        """Upload an object to RustFS"""
        client = self._get_client()
        
        # Convert BinaryIO to bytes if needed
        if hasattr(data, 'read'):
            content = data.read()
        else:
            content = data
        
        extra_args = {
            "ContentType": content_type,
        }
        
        if metadata:
            extra_args["Metadata"] = metadata
        
        try:
            response = client.put_object(
                Bucket=bucket,
                Key=key,
                Body=content,
                **extra_args
            )
            
            logger.debug(f"Uploaded object to RustFS: {bucket}/{key}")
            
            return PutObjectResult(
                key=key,
                bucket=bucket,
                etag=response.get("ETag", ""),
                version_id=response.get("VersionId"),
                size=len(content)
            )
        except Exception as e:
            logger.error(f"Failed to upload to RustFS {bucket}/{key}: {e}")
            raise
    
    async def get_object(self, bucket: str, key: str) -> Tuple[bytes, ObjectMetadata]:
        """Download an object from RustFS"""
        client = self._get_client()
        
        try:
            response = client.get_object(Bucket=bucket, Key=key)
            content = response["Body"].read()
            
            metadata = ObjectMetadata(
                key=key,
                bucket=bucket,
                size=response.get("ContentLength", len(content)),
                content_type=response.get("ContentType", "application/octet-stream"),
                etag=response.get("ETag", ""),
                last_modified=response.get("LastModified", datetime.utcnow()),
                metadata=response.get("Metadata", {}),
                version_id=response.get("VersionId")
            )
            
            return content, metadata
        except Exception as e:
            logger.error(f"Failed to download from RustFS {bucket}/{key}: {e}")
            raise
    
    async def delete_object(self, bucket: str, key: str) -> bool:
        """Delete an object from RustFS"""
        client = self._get_client()
        
        try:
            client.delete_object(Bucket=bucket, Key=key)
            logger.debug(f"Deleted object from RustFS: {bucket}/{key}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete from RustFS {bucket}/{key}: {e}")
            return False
    
    async def head_object(self, bucket: str, key: str) -> Optional[ObjectMetadata]:
        """Get object metadata without downloading content"""
        client = self._get_client()
        
        try:
            response = client.head_object(Bucket=bucket, Key=key)
            
            return ObjectMetadata(
                key=key,
                bucket=bucket,
                size=response.get("ContentLength", 0),
                content_type=response.get("ContentType", "application/octet-stream"),
                etag=response.get("ETag", ""),
                last_modified=response.get("LastModified", datetime.utcnow()),
                metadata=response.get("Metadata", {}),
                version_id=response.get("VersionId")
            )
        except client.exceptions.ClientError as e:
            if e.response['Error']['Code'] == '404':
                return None
            raise
        except Exception as e:
            logger.error(f"Failed to head object from RustFS {bucket}/{key}: {e}")
            return None
    
    async def list_objects(
        self,
        bucket: str,
        prefix: Optional[str] = None,
        max_keys: int = 1000,
        continuation_token: Optional[str] = None
    ) -> ListObjectsResult:
        """List objects in a bucket"""
        client = self._get_client()
        
        kwargs = {
            "Bucket": bucket,
            "MaxKeys": max_keys
        }
        
        if prefix:
            kwargs["Prefix"] = prefix
        
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token
        
        try:
            response = client.list_objects_v2(**kwargs)
            
            objects = []
            for obj in response.get("Contents", []):
                objects.append(ObjectMetadata(
                    key=obj["Key"],
                    bucket=bucket,
                    size=obj.get("Size", 0),
                    content_type="",  # Not available in list response
                    etag=obj.get("ETag", ""),
                    last_modified=obj.get("LastModified", datetime.utcnow()),
                    metadata={}
                ))
            
            return ListObjectsResult(
                objects=objects,
                is_truncated=response.get("IsTruncated", False),
                continuation_token=response.get("NextContinuationToken"),
                prefix=prefix
            )
        except Exception as e:
            logger.error(f"Failed to list objects in RustFS {bucket}: {e}")
            raise
    
    async def generate_presigned_url(
        self,
        bucket: str,
        key: str,
        expires_in: int = 3600,
        method: str = "GET"
    ) -> str:
        """Generate a presigned URL for temporary access"""
        client = self._get_client()
        
        client_method = "get_object" if method.upper() == "GET" else "put_object"
        
        try:
            url = client.generate_presigned_url(
                client_method,
                Params={"Bucket": bucket, "Key": key},
                ExpiresIn=expires_in
            )
            return url
        except Exception as e:
            logger.error(f"Failed to generate presigned URL for {bucket}/{key}: {e}")
            raise
    
    async def create_bucket(self, bucket: str) -> bool:
        """Create a new bucket"""
        client = self._get_client()
        
        try:
            # For us-east-1, don't specify LocationConstraint
            if self.region == "us-east-1":
                client.create_bucket(Bucket=bucket)
            else:
                client.create_bucket(
                    Bucket=bucket,
                    CreateBucketConfiguration={"LocationConstraint": self.region}
                )
            logger.info(f"Created bucket: {bucket}")
            return True
        except client.exceptions.BucketAlreadyExists:
            logger.debug(f"Bucket already exists: {bucket}")
            return True
        except client.exceptions.BucketAlreadyOwnedByYou:
            logger.debug(f"Bucket already owned by you: {bucket}")
            return True
        except Exception as e:
            logger.error(f"Failed to create bucket {bucket}: {e}")
            return False
    
    async def bucket_exists(self, bucket: str) -> bool:
        """Check if a bucket exists"""
        client = self._get_client()
        
        try:
            client.head_bucket(Bucket=bucket)
            return True
        except Exception:
            return False
    
    async def delete_bucket(self, bucket: str) -> bool:
        """Delete a bucket (must be empty)"""
        client = self._get_client()
        
        try:
            client.delete_bucket(Bucket=bucket)
            logger.info(f"Deleted bucket: {bucket}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete bucket {bucket}: {e}")
            return False
    
    async def copy_object(
        self,
        source_bucket: str,
        source_key: str,
        dest_bucket: str,
        dest_key: str
    ) -> PutObjectResult:
        """Copy an object within RustFS"""
        client = self._get_client()
        
        try:
            response = client.copy_object(
                CopySource={"Bucket": source_bucket, "Key": source_key},
                Bucket=dest_bucket,
                Key=dest_key
            )
            
            return PutObjectResult(
                key=dest_key,
                bucket=dest_bucket,
                etag=response.get("CopyObjectResult", {}).get("ETag", ""),
                version_id=response.get("VersionId")
            )
        except Exception as e:
            logger.error(f"Failed to copy object: {e}")
            raise
    
    async def initialize_buckets(self) -> Dict[str, bool]:
        """Initialize all platform buckets"""
        results = {}
        for name, bucket in BUCKETS.items():
            results[name] = await self.create_bucket(bucket)
        return results


class InMemoryStorageClient(ObjectStorageClient):
    """
    In-memory object storage for testing
    
    This client stores objects in memory and is useful for unit tests
    and local development without a real RustFS instance.
    """
    
    def __init__(self):
        self._buckets: Dict[str, Dict[str, Tuple[bytes, ObjectMetadata]]] = {}
        logger.info("In-memory storage client initialized")
    
    async def put_object(
        self,
        bucket: str,
        key: str,
        data: Union[bytes, BinaryIO],
        content_type: str = "application/octet-stream",
        metadata: Optional[Dict[str, str]] = None
    ) -> PutObjectResult:
        """Store an object in memory"""
        if bucket not in self._buckets:
            self._buckets[bucket] = {}
        
        # Convert BinaryIO to bytes if needed
        if hasattr(data, 'read'):
            content = data.read()
        else:
            content = data
        
        etag = self._generate_etag(content)
        version_id = str(uuid.uuid4())
        
        obj_metadata = ObjectMetadata(
            key=key,
            bucket=bucket,
            size=len(content),
            content_type=content_type,
            etag=etag,
            last_modified=datetime.utcnow(),
            metadata=metadata or {},
            version_id=version_id
        )
        
        self._buckets[bucket][key] = (content, obj_metadata)
        
        return PutObjectResult(
            key=key,
            bucket=bucket,
            etag=etag,
            version_id=version_id,
            size=len(content)
        )
    
    async def get_object(self, bucket: str, key: str) -> Tuple[bytes, ObjectMetadata]:
        """Retrieve an object from memory"""
        if bucket not in self._buckets or key not in self._buckets[bucket]:
            raise KeyError(f"Object not found: {bucket}/{key}")
        
        return self._buckets[bucket][key]
    
    async def delete_object(self, bucket: str, key: str) -> bool:
        """Delete an object from memory"""
        if bucket in self._buckets and key in self._buckets[bucket]:
            del self._buckets[bucket][key]
            return True
        return False
    
    async def head_object(self, bucket: str, key: str) -> Optional[ObjectMetadata]:
        """Get object metadata"""
        if bucket not in self._buckets or key not in self._buckets[bucket]:
            return None
        
        _, metadata = self._buckets[bucket][key]
        return metadata
    
    async def list_objects(
        self,
        bucket: str,
        prefix: Optional[str] = None,
        max_keys: int = 1000,
        continuation_token: Optional[str] = None
    ) -> ListObjectsResult:
        """List objects in a bucket"""
        if bucket not in self._buckets:
            return ListObjectsResult(objects=[], is_truncated=False, prefix=prefix)
        
        objects = []
        for key, (_, metadata) in self._buckets[bucket].items():
            if prefix is None or key.startswith(prefix):
                objects.append(metadata)
        
        # Sort by key and apply max_keys
        objects.sort(key=lambda x: x.key)
        is_truncated = len(objects) > max_keys
        objects = objects[:max_keys]
        
        return ListObjectsResult(
            objects=objects,
            is_truncated=is_truncated,
            prefix=prefix
        )
    
    async def generate_presigned_url(
        self,
        bucket: str,
        key: str,
        expires_in: int = 3600,
        method: str = "GET"
    ) -> str:
        """Generate a fake presigned URL for testing"""
        expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
        return f"memory://{bucket}/{key}?expires={expires_at.isoformat()}&method={method}"
    
    async def create_bucket(self, bucket: str) -> bool:
        """Create a bucket in memory"""
        if bucket not in self._buckets:
            self._buckets[bucket] = {}
        return True
    
    async def bucket_exists(self, bucket: str) -> bool:
        """Check if a bucket exists"""
        return bucket in self._buckets
    
    async def delete_bucket(self, bucket: str) -> bool:
        """Delete a bucket from memory"""
        if bucket in self._buckets:
            if self._buckets[bucket]:
                return False  # Bucket not empty
            del self._buckets[bucket]
            return True
        return False
    
    def clear(self):
        """Clear all stored data (for testing)"""
        self._buckets.clear()


# Singleton instance
_storage_client: Optional[ObjectStorageClient] = None


def get_storage_client() -> ObjectStorageClient:
    """
    Get the configured object storage client
    
    Returns RustFSClient for production (OBJECT_STORAGE_BACKEND=s3)
    Returns InMemoryStorageClient for testing (OBJECT_STORAGE_BACKEND=memory)
    """
    global _storage_client
    
    if _storage_client is None:
        backend = OBJECT_STORAGE_BACKEND.lower()
        
        if backend == "memory":
            logger.info("Using in-memory storage backend (testing mode)")
            _storage_client = InMemoryStorageClient()
        else:
            logger.info(f"Using RustFS storage backend at {RUSTFS_ENDPOINT}")
            _storage_client = RustFSClient()
    
    return _storage_client


def reset_storage_client():
    """Reset the storage client singleton (for testing)"""
    global _storage_client
    _storage_client = None


# Convenience functions for common operations
async def upload_file(
    bucket: str,
    key: str,
    data: Union[bytes, BinaryIO],
    content_type: str = "application/octet-stream",
    metadata: Optional[Dict[str, str]] = None
) -> PutObjectResult:
    """Upload a file to object storage"""
    client = get_storage_client()
    return await client.put_object(bucket, key, data, content_type, metadata)


async def download_file(bucket: str, key: str) -> Tuple[bytes, ObjectMetadata]:
    """Download a file from object storage"""
    client = get_storage_client()
    return await client.get_object(bucket, key)


async def delete_file(bucket: str, key: str) -> bool:
    """Delete a file from object storage"""
    client = get_storage_client()
    return await client.delete_object(bucket, key)


async def get_presigned_url(
    bucket: str,
    key: str,
    expires_in: int = 3600,
    method: str = "GET"
) -> str:
    """Generate a presigned URL"""
    client = get_storage_client()
    return await client.generate_presigned_url(bucket, key, expires_in, method)


async def file_exists(bucket: str, key: str) -> bool:
    """Check if a file exists"""
    client = get_storage_client()
    metadata = await client.head_object(bucket, key)
    return metadata is not None


# Service-specific helper classes
class MLModelStorage:
    """Helper class for ML model artifact storage"""
    
    def __init__(self, client: Optional[ObjectStorageClient] = None):
        self.client = client or get_storage_client()
        self.bucket = BUCKETS["ml_models"]
    
    async def save_model(
        self,
        model_name: str,
        version: str,
        model_data: bytes,
        metadata: Optional[Dict[str, str]] = None
    ) -> PutObjectResult:
        """Save a trained model to storage"""
        key = f"{model_name}/{version}/model.pkl"
        return await self.client.put_object(
            self.bucket, key, model_data,
            content_type="application/octet-stream",
            metadata=metadata
        )
    
    async def load_model(self, model_name: str, version: str) -> Tuple[bytes, ObjectMetadata]:
        """Load a model from storage"""
        key = f"{model_name}/{version}/model.pkl"
        return await self.client.get_object(self.bucket, key)
    
    async def list_versions(self, model_name: str) -> List[str]:
        """List all versions of a model"""
        result = await self.client.list_objects(self.bucket, prefix=f"{model_name}/")
        versions = set()
        for obj in result.objects:
            parts = obj.key.split("/")
            if len(parts) >= 2:
                versions.add(parts[1])
        return sorted(versions)
    
    async def delete_model(self, model_name: str, version: str) -> bool:
        """Delete a model version"""
        key = f"{model_name}/{version}/model.pkl"
        return await self.client.delete_object(self.bucket, key)


class LakehouseStorage:
    """Helper class for lakehouse data storage"""
    
    def __init__(self, client: Optional[ObjectStorageClient] = None):
        self.client = client or get_storage_client()
    
    def _get_bucket(self, layer: str) -> str:
        """Get bucket for a lakehouse layer"""
        layer_map = {
            "bronze": BUCKETS["lakehouse_bronze"],
            "silver": BUCKETS["lakehouse_silver"],
            "gold": BUCKETS["lakehouse_gold"]
        }
        return layer_map.get(layer, BUCKETS["lakehouse_bronze"])
    
    async def write_event(
        self,
        layer: str,
        event_type: str,
        event_id: str,
        data: Dict[str, Any],
        timestamp: Optional[datetime] = None
    ) -> PutObjectResult:
        """Write an event to the lakehouse"""
        ts = timestamp or datetime.utcnow()
        date_partition = ts.strftime("%Y-%m-%d")
        hour_partition = ts.strftime("%H")
        
        key = f"{event_type}/dt={date_partition}/hr={hour_partition}/{event_id}.json"
        bucket = self._get_bucket(layer)
        
        return await self.client.put_object(
            bucket, key,
            json.dumps(data).encode("utf-8"),
            content_type="application/json",
            metadata={"event_type": event_type, "timestamp": ts.isoformat()}
        )
    
    async def read_events(
        self,
        layer: str,
        event_type: str,
        date: str,
        hour: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Read events from the lakehouse"""
        bucket = self._get_bucket(layer)
        prefix = f"{event_type}/dt={date}/"
        if hour:
            prefix += f"hr={hour}/"
        
        result = await self.client.list_objects(bucket, prefix=prefix)
        events = []
        
        for obj in result.objects:
            if obj.key.endswith(".json"):
                content, _ = await self.client.get_object(bucket, obj.key)
                events.append(json.loads(content.decode("utf-8")))
        
        return events
    
    async def write_parquet(
        self,
        layer: str,
        table_name: str,
        partition: str,
        data: bytes
    ) -> PutObjectResult:
        """Write a Parquet file to the lakehouse"""
        key = f"{table_name}/{partition}/data.parquet"
        bucket = self._get_bucket(layer)
        
        return await self.client.put_object(
            bucket, key, data,
            content_type="application/octet-stream",
            metadata={"format": "parquet", "table": table_name}
        )


class AuditLogStorage:
    """Helper class for audit log storage"""
    
    def __init__(self, client: Optional[ObjectStorageClient] = None):
        self.client = client or get_storage_client()
        self.bucket = BUCKETS["audit_logs"]
    
    async def write_log(
        self,
        service: str,
        action: str,
        user_id: str,
        data: Dict[str, Any],
        timestamp: Optional[datetime] = None
    ) -> PutObjectResult:
        """Write an audit log entry"""
        ts = timestamp or datetime.utcnow()
        date_partition = ts.strftime("%Y-%m-%d")
        log_id = str(uuid.uuid4())
        
        key = f"{service}/dt={date_partition}/{action}/{log_id}.json"
        
        log_entry = {
            "log_id": log_id,
            "service": service,
            "action": action,
            "user_id": user_id,
            "timestamp": ts.isoformat(),
            "data": data
        }
        
        return await self.client.put_object(
            self.bucket, key,
            json.dumps(log_entry).encode("utf-8"),
            content_type="application/json"
        )
    
    async def query_logs(
        self,
        service: str,
        date: str,
        action: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Query audit logs"""
        prefix = f"{service}/dt={date}/"
        if action:
            prefix += f"{action}/"
        
        result = await self.client.list_objects(self.bucket, prefix=prefix)
        logs = []
        
        for obj in result.objects:
            if obj.key.endswith(".json"):
                content, _ = await self.client.get_object(self.bucket, obj.key)
                logs.append(json.loads(content.decode("utf-8")))
        
        return logs


# Export all public classes and functions
__all__ = [
    "ObjectStorageBackend",
    "ObjectMetadata",
    "PutObjectResult",
    "ListObjectsResult",
    "ObjectStorageClient",
    "RustFSClient",
    "InMemoryStorageClient",
    "get_storage_client",
    "reset_storage_client",
    "upload_file",
    "download_file",
    "delete_file",
    "get_presigned_url",
    "file_exists",
    "MLModelStorage",
    "LakehouseStorage",
    "AuditLogStorage",
    "BUCKETS",
    "RUSTFS_ENDPOINT",
    "RUSTFS_ACCESS_KEY",
    "RUSTFS_SECRET_KEY",
]
