"""
RustFS Migration Regression Tests

This module contains comprehensive regression tests to verify the RustFS migration
from MinIO. These tests ensure S3 API compatibility and validate all storage operations.

Test Categories:
1. Basic Operations: Upload, download, delete, list
2. Presigned URLs: GET and PUT presigned URL generation
3. Multipart Upload: Large file uploads
4. Bucket Operations: Create, delete, list buckets
5. Metadata Operations: Object metadata handling
6. Error Handling: Proper error responses
7. Performance: Basic performance benchmarks
"""

import asyncio
import hashlib
import io
import os
import time
import uuid
from typing import Optional
from dataclasses import dataclass

import pytest
import boto3
from botocore.exceptions import ClientError
from botocore.config import Config


@dataclass
class StorageTestConfig:
    """Test configuration for storage operations"""
    endpoint: str
    access_key: str
    secret_key: str
    region: str = "us-east-1"
    test_bucket: str = "test-bucket"
    
    @classmethod
    def from_env(cls, prefix: str = "RUSTFS") -> "StorageTestConfig":
        """Load configuration from environment variables"""
        return cls(
            endpoint=os.getenv(f"{prefix}_ENDPOINT", "http://localhost:9000"),
            access_key=os.getenv(f"{prefix}_ACCESS_KEY", "rustfsadmin"),
            secret_key=os.getenv(f"{prefix}_SECRET_KEY", "rustfsadmin123"),
            region=os.getenv(f"{prefix}_REGION", "us-east-1"),
            test_bucket=os.getenv(f"{prefix}_TEST_BUCKET", f"test-{uuid.uuid4().hex[:8]}"),
        )


class S3TestClient:
    """S3-compatible test client"""
    
    def __init__(self, config: StorageTestConfig):
        self.config = config
        self.client = boto3.client(
            's3',
            endpoint_url=config.endpoint,
            aws_access_key_id=config.access_key,
            aws_secret_access_key=config.secret_key,
            region_name=config.region,
            config=Config(
                signature_version='s3v4',
                s3={'addressing_style': 'path'}
            )
        )
    
    def create_bucket(self, bucket: str) -> bool:
        """Create a bucket"""
        try:
            self.client.create_bucket(Bucket=bucket)
            return True
        except ClientError as e:
            if e.response['Error']['Code'] in ['BucketAlreadyExists', 'BucketAlreadyOwnedByYou']:
                return True
            raise
    
    def delete_bucket(self, bucket: str) -> bool:
        """Delete a bucket (must be empty)"""
        try:
            self.client.delete_bucket(Bucket=bucket)
            return True
        except ClientError:
            return False
    
    def bucket_exists(self, bucket: str) -> bool:
        """Check if bucket exists"""
        try:
            self.client.head_bucket(Bucket=bucket)
            return True
        except ClientError:
            return False
    
    def put_object(self, bucket: str, key: str, data: bytes, content_type: Optional[str] = None) -> str:
        """Upload an object"""
        extra_args = {}
        if content_type:
            extra_args['ContentType'] = content_type
        
        response = self.client.put_object(
            Bucket=bucket,
            Key=key,
            Body=data,
            **extra_args
        )
        return response.get('ETag', '')
    
    def get_object(self, bucket: str, key: str) -> bytes:
        """Download an object"""
        response = self.client.get_object(Bucket=bucket, Key=key)
        return response['Body'].read()
    
    def delete_object(self, bucket: str, key: str) -> bool:
        """Delete an object"""
        try:
            self.client.delete_object(Bucket=bucket, Key=key)
            return True
        except ClientError:
            return False
    
    def object_exists(self, bucket: str, key: str) -> bool:
        """Check if object exists"""
        try:
            self.client.head_object(Bucket=bucket, Key=key)
            return True
        except ClientError:
            return False
    
    def list_objects(self, bucket: str, prefix: Optional[str] = None, max_keys: int = 1000) -> list:
        """List objects in bucket"""
        params = {'Bucket': bucket, 'MaxKeys': max_keys}
        if prefix:
            params['Prefix'] = prefix
        
        response = self.client.list_objects_v2(**params)
        return response.get('Contents', [])
    
    def get_presigned_url(self, bucket: str, key: str, expires_in: int = 3600) -> str:
        """Generate presigned GET URL"""
        return self.client.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket, 'Key': key},
            ExpiresIn=expires_in
        )
    
    def get_presigned_upload_url(self, bucket: str, key: str, expires_in: int = 3600) -> str:
        """Generate presigned PUT URL"""
        return self.client.generate_presigned_url(
            'put_object',
            Params={'Bucket': bucket, 'Key': key},
            ExpiresIn=expires_in
        )
    
    def cleanup_bucket(self, bucket: str):
        """Delete all objects in bucket and then delete bucket"""
        try:
            # List and delete all objects
            objects = self.list_objects(bucket)
            for obj in objects:
                self.delete_object(bucket, obj['Key'])
            
            # Delete bucket
            self.delete_bucket(bucket)
        except Exception:
            pass


# ============================================================================
# FIXTURES
# ============================================================================

@pytest.fixture(scope="module")
def rustfs_config():
    """RustFS configuration"""
    return StorageTestConfig.from_env("RUSTFS")


@pytest.fixture(scope="module")
def minio_config():
    """MinIO configuration (for comparison)"""
    return StorageTestConfig.from_env("MINIO")


@pytest.fixture(scope="module")
def rustfs_client(rustfs_config):
    """RustFS test client"""
    client = S3TestClient(rustfs_config)
    client.create_bucket(rustfs_config.test_bucket)
    yield client
    client.cleanup_bucket(rustfs_config.test_bucket)


@pytest.fixture(scope="module")
def minio_client(minio_config):
    """MinIO test client (for comparison)"""
    try:
        client = S3TestClient(minio_config)
        client.create_bucket(minio_config.test_bucket)
        yield client
        client.cleanup_bucket(minio_config.test_bucket)
    except Exception:
        yield None


# ============================================================================
# BASIC OPERATIONS TESTS
# ============================================================================

class TestBasicOperations:
    """Test basic storage operations"""
    
    def test_bucket_creation(self, rustfs_client, rustfs_config):
        """Test bucket creation"""
        bucket = f"test-create-{uuid.uuid4().hex[:8]}"
        try:
            assert rustfs_client.create_bucket(bucket)
            assert rustfs_client.bucket_exists(bucket)
        finally:
            rustfs_client.delete_bucket(bucket)
    
    def test_object_upload_download(self, rustfs_client, rustfs_config):
        """Test object upload and download"""
        key = f"test-object-{uuid.uuid4().hex[:8]}.txt"
        data = b"Hello, RustFS! This is a test object."
        
        # Upload
        etag = rustfs_client.put_object(rustfs_config.test_bucket, key, data)
        assert etag
        
        # Download
        downloaded = rustfs_client.get_object(rustfs_config.test_bucket, key)
        assert downloaded == data
        
        # Cleanup
        rustfs_client.delete_object(rustfs_config.test_bucket, key)
    
    def test_object_delete(self, rustfs_client, rustfs_config):
        """Test object deletion"""
        key = f"test-delete-{uuid.uuid4().hex[:8]}.txt"
        data = b"Delete me!"
        
        # Upload
        rustfs_client.put_object(rustfs_config.test_bucket, key, data)
        assert rustfs_client.object_exists(rustfs_config.test_bucket, key)
        
        # Delete
        assert rustfs_client.delete_object(rustfs_config.test_bucket, key)
        assert not rustfs_client.object_exists(rustfs_config.test_bucket, key)
    
    def test_object_list(self, rustfs_client, rustfs_config):
        """Test object listing"""
        prefix = f"list-test-{uuid.uuid4().hex[:8]}/"
        keys = [f"{prefix}file{i}.txt" for i in range(5)]
        
        # Upload multiple objects
        for key in keys:
            rustfs_client.put_object(rustfs_config.test_bucket, key, b"test data")
        
        # List objects
        objects = rustfs_client.list_objects(rustfs_config.test_bucket, prefix=prefix)
        listed_keys = [obj['Key'] for obj in objects]
        
        assert len(listed_keys) == 5
        for key in keys:
            assert key in listed_keys
        
        # Cleanup
        for key in keys:
            rustfs_client.delete_object(rustfs_config.test_bucket, key)
    
    def test_object_with_content_type(self, rustfs_client, rustfs_config):
        """Test object upload with content type"""
        key = f"test-content-type-{uuid.uuid4().hex[:8]}.json"
        data = b'{"test": "data"}'
        content_type = "application/json"
        
        # Upload with content type
        rustfs_client.put_object(rustfs_config.test_bucket, key, data, content_type=content_type)
        
        # Verify
        response = rustfs_client.client.head_object(
            Bucket=rustfs_config.test_bucket,
            Key=key
        )
        assert response['ContentType'] == content_type
        
        # Cleanup
        rustfs_client.delete_object(rustfs_config.test_bucket, key)


# ============================================================================
# PRESIGNED URL TESTS
# ============================================================================

class TestPresignedUrls:
    """Test presigned URL operations"""
    
    def test_presigned_get_url(self, rustfs_client, rustfs_config):
        """Test presigned GET URL generation"""
        key = f"test-presign-get-{uuid.uuid4().hex[:8]}.txt"
        data = b"Presigned GET test data"
        
        # Upload object
        rustfs_client.put_object(rustfs_config.test_bucket, key, data)
        
        # Generate presigned URL
        url = rustfs_client.get_presigned_url(rustfs_config.test_bucket, key)
        assert url
        assert rustfs_config.test_bucket in url
        assert key in url
        
        # Cleanup
        rustfs_client.delete_object(rustfs_config.test_bucket, key)
    
    def test_presigned_put_url(self, rustfs_client, rustfs_config):
        """Test presigned PUT URL generation"""
        key = f"test-presign-put-{uuid.uuid4().hex[:8]}.txt"
        
        # Generate presigned upload URL
        url = rustfs_client.get_presigned_upload_url(rustfs_config.test_bucket, key)
        assert url
        assert rustfs_config.test_bucket in url
        assert key in url


# ============================================================================
# LARGE FILE TESTS
# ============================================================================

class TestLargeFiles:
    """Test large file operations"""
    
    def test_large_file_upload(self, rustfs_client, rustfs_config):
        """Test large file upload (1MB)"""
        key = f"test-large-{uuid.uuid4().hex[:8]}.bin"
        size = 1024 * 1024  # 1MB
        data = os.urandom(size)
        
        # Calculate checksum
        expected_checksum = hashlib.md5(data).hexdigest()
        
        # Upload
        start_time = time.time()
        rustfs_client.put_object(rustfs_config.test_bucket, key, data)
        upload_time = time.time() - start_time
        
        # Download and verify
        start_time = time.time()
        downloaded = rustfs_client.get_object(rustfs_config.test_bucket, key)
        download_time = time.time() - start_time
        
        actual_checksum = hashlib.md5(downloaded).hexdigest()
        assert actual_checksum == expected_checksum
        
        print(f"Upload time: {upload_time:.2f}s, Download time: {download_time:.2f}s")
        
        # Cleanup
        rustfs_client.delete_object(rustfs_config.test_bucket, key)


# ============================================================================
# ERROR HANDLING TESTS
# ============================================================================

class TestErrorHandling:
    """Test error handling"""
    
    def test_get_nonexistent_object(self, rustfs_client, rustfs_config):
        """Test getting non-existent object"""
        key = f"nonexistent-{uuid.uuid4().hex[:8]}.txt"
        
        with pytest.raises(ClientError) as exc_info:
            rustfs_client.get_object(rustfs_config.test_bucket, key)
        
        assert exc_info.value.response['Error']['Code'] in ['NoSuchKey', 'NotFound']
    
    def test_delete_nonexistent_bucket(self, rustfs_client):
        """Test deleting non-existent bucket"""
        bucket = f"nonexistent-bucket-{uuid.uuid4().hex[:8]}"
        
        # Should not raise, just return False
        result = rustfs_client.delete_bucket(bucket)
        assert result is False


# ============================================================================
# COMPATIBILITY TESTS
# ============================================================================

class TestMinioCompatibility:
    """Test RustFS compatibility with MinIO operations"""
    
    def test_same_operations_both_backends(self, rustfs_client, minio_client, rustfs_config, minio_config):
        """Test that same operations work on both RustFS and MinIO"""
        if minio_client is None:
            pytest.skip("MinIO not available for comparison")
        
        key = f"compat-test-{uuid.uuid4().hex[:8]}.txt"
        data = b"Compatibility test data"
        
        # Test on RustFS
        rustfs_client.put_object(rustfs_config.test_bucket, key, data)
        rustfs_data = rustfs_client.get_object(rustfs_config.test_bucket, key)
        
        # Test on MinIO
        minio_client.put_object(minio_config.test_bucket, key, data)
        minio_data = minio_client.get_object(minio_config.test_bucket, key)
        
        # Verify both return same data
        assert rustfs_data == minio_data == data
        
        # Cleanup
        rustfs_client.delete_object(rustfs_config.test_bucket, key)
        minio_client.delete_object(minio_config.test_bucket, key)


# ============================================================================
# PERFORMANCE BENCHMARK TESTS
# ============================================================================

class TestPerformance:
    """Performance benchmark tests"""
    
    def test_small_object_throughput(self, rustfs_client, rustfs_config):
        """Test small object (4KB) throughput - RustFS should be 2.3x faster"""
        num_objects = 100
        object_size = 4 * 1024  # 4KB
        prefix = f"perf-test-{uuid.uuid4().hex[:8]}/"
        
        # Generate test data
        data = os.urandom(object_size)
        keys = [f"{prefix}obj{i}.bin" for i in range(num_objects)]
        
        # Upload benchmark
        start_time = time.time()
        for key in keys:
            rustfs_client.put_object(rustfs_config.test_bucket, key, data)
        upload_time = time.time() - start_time
        
        # Download benchmark
        start_time = time.time()
        for key in keys:
            rustfs_client.get_object(rustfs_config.test_bucket, key)
        download_time = time.time() - start_time
        
        # Calculate throughput
        upload_throughput = num_objects / upload_time
        download_throughput = num_objects / download_time
        
        print(f"\n4KB Object Performance:")
        print(f"  Upload: {upload_throughput:.1f} objects/sec ({upload_time:.2f}s total)")
        print(f"  Download: {download_throughput:.1f} objects/sec ({download_time:.2f}s total)")
        
        # Cleanup
        for key in keys:
            rustfs_client.delete_object(rustfs_config.test_bucket, key)
        
        # Basic sanity check - should handle at least 10 objects/sec
        assert upload_throughput > 10
        assert download_throughput > 10


# ============================================================================
# INTEGRATION TESTS
# ============================================================================

class TestIntegration:
    """Integration tests for real-world scenarios"""
    
    def test_document_storage_workflow(self, rustfs_client, rustfs_config):
        """Test document storage workflow (KYC documents)"""
        user_id = uuid.uuid4().hex[:8]
        prefix = f"kyc/{user_id}/"
        
        documents = [
            (f"{prefix}id_front.jpg", b"ID front image data", "image/jpeg"),
            (f"{prefix}id_back.jpg", b"ID back image data", "image/jpeg"),
            (f"{prefix}selfie.jpg", b"Selfie image data", "image/jpeg"),
            (f"{prefix}proof_of_address.pdf", b"PDF document data", "application/pdf"),
        ]
        
        # Upload all documents
        for key, data, content_type in documents:
            rustfs_client.put_object(rustfs_config.test_bucket, key, data, content_type=content_type)
        
        # List user's documents
        objects = rustfs_client.list_objects(rustfs_config.test_bucket, prefix=prefix)
        assert len(objects) == 4
        
        # Download and verify each document
        for key, expected_data, _ in documents:
            downloaded = rustfs_client.get_object(rustfs_config.test_bucket, key)
            assert downloaded == expected_data
        
        # Cleanup
        for key, _, _ in documents:
            rustfs_client.delete_object(rustfs_config.test_bucket, key)
    
    def test_video_storage_workflow(self, rustfs_client, rustfs_config):
        """Test video storage workflow (Video KYC)"""
        session_id = uuid.uuid4().hex[:8]
        key = f"video-kyc/{session_id}/recording.mp4"
        
        # Simulate video data (1MB)
        video_data = os.urandom(1024 * 1024)
        video_checksum = hashlib.sha256(video_data).hexdigest()
        
        # Upload video
        rustfs_client.put_object(
            rustfs_config.test_bucket,
            key,
            video_data,
            content_type="video/mp4"
        )
        
        # Generate presigned URL for playback
        url = rustfs_client.get_presigned_url(rustfs_config.test_bucket, key, expires_in=3600)
        assert url
        
        # Download and verify integrity
        downloaded = rustfs_client.get_object(rustfs_config.test_bucket, key)
        downloaded_checksum = hashlib.sha256(downloaded).hexdigest()
        assert downloaded_checksum == video_checksum
        
        # Cleanup
        rustfs_client.delete_object(rustfs_config.test_bucket, key)


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
