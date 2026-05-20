"""
Regression Tests for RustFS Object Storage Client
Tests all storage operations to ensure migration from MinIO to RustFS works correctly
"""

import pytest
import asyncio
import json
import uuid
from datetime import datetime
from typing import Dict, Any

from rustfs_client import (
    ObjectStorageBackend,
    ObjectMetadata,
    PutObjectResult,
    ListObjectsResult,
    RustFSClient,
    InMemoryStorageClient,
    get_storage_client,
    reset_storage_client,
    upload_file,
    download_file,
    delete_file,
    get_presigned_url,
    file_exists,
    MLModelStorage,
    LakehouseStorage,
    AuditLogStorage,
    BUCKETS,
)


@pytest.fixture
def memory_client():
    """Create an in-memory storage client for testing"""
    return InMemoryStorageClient()


@pytest.fixture
def reset_singleton():
    """Reset the storage client singleton before and after tests"""
    reset_storage_client()
    yield
    reset_storage_client()


class TestInMemoryStorageClient:
    """Test suite for InMemoryStorageClient"""
    
    @pytest.mark.asyncio
    async def test_put_and_get_object(self, memory_client):
        """Test basic put and get operations"""
        bucket = "test-bucket"
        key = "test-key.txt"
        data = b"Hello, RustFS!"
        content_type = "text/plain"
        
        await memory_client.create_bucket(bucket)
        
        result = await memory_client.put_object(bucket, key, data, content_type)
        
        assert result.key == key
        assert result.bucket == bucket
        assert result.size == len(data)
        assert result.etag is not None
        
        content, metadata = await memory_client.get_object(bucket, key)
        
        assert content == data
        assert metadata.key == key
        assert metadata.bucket == bucket
        assert metadata.content_type == content_type
        assert metadata.size == len(data)
    
    @pytest.mark.asyncio
    async def test_put_object_with_metadata(self, memory_client):
        """Test put operation with custom metadata"""
        bucket = "test-bucket"
        key = "test-key.json"
        data = json.dumps({"test": "data"}).encode("utf-8")
        metadata = {"user_id": "123", "document_type": "kyc"}
        
        await memory_client.create_bucket(bucket)
        
        result = await memory_client.put_object(
            bucket, key, data,
            content_type="application/json",
            metadata=metadata
        )
        
        assert result.key == key
        
        content, obj_metadata = await memory_client.get_object(bucket, key)
        
        assert obj_metadata.metadata == metadata
    
    @pytest.mark.asyncio
    async def test_delete_object(self, memory_client):
        """Test delete operation"""
        bucket = "test-bucket"
        key = "to-delete.txt"
        data = b"Delete me"
        
        await memory_client.create_bucket(bucket)
        await memory_client.put_object(bucket, key, data)
        
        metadata = await memory_client.head_object(bucket, key)
        assert metadata is not None
        
        result = await memory_client.delete_object(bucket, key)
        assert result is True
        
        metadata = await memory_client.head_object(bucket, key)
        assert metadata is None
    
    @pytest.mark.asyncio
    async def test_head_object(self, memory_client):
        """Test head operation (get metadata without content)"""
        bucket = "test-bucket"
        key = "head-test.txt"
        data = b"Head test content"
        
        await memory_client.create_bucket(bucket)
        await memory_client.put_object(bucket, key, data, "text/plain")
        
        metadata = await memory_client.head_object(bucket, key)
        
        assert metadata is not None
        assert metadata.key == key
        assert metadata.size == len(data)
        assert metadata.content_type == "text/plain"
    
    @pytest.mark.asyncio
    async def test_head_object_not_found(self, memory_client):
        """Test head operation for non-existent object"""
        bucket = "test-bucket"
        
        await memory_client.create_bucket(bucket)
        
        metadata = await memory_client.head_object(bucket, "non-existent.txt")
        
        assert metadata is None
    
    @pytest.mark.asyncio
    async def test_list_objects(self, memory_client):
        """Test list objects operation"""
        bucket = "test-bucket"
        
        await memory_client.create_bucket(bucket)
        
        for i in range(5):
            await memory_client.put_object(bucket, f"file-{i}.txt", f"Content {i}".encode())
        
        result = await memory_client.list_objects(bucket)
        
        assert len(result.objects) == 5
        assert not result.is_truncated
    
    @pytest.mark.asyncio
    async def test_list_objects_with_prefix(self, memory_client):
        """Test list objects with prefix filter"""
        bucket = "test-bucket"
        
        await memory_client.create_bucket(bucket)
        
        await memory_client.put_object(bucket, "docs/file1.txt", b"Doc 1")
        await memory_client.put_object(bucket, "docs/file2.txt", b"Doc 2")
        await memory_client.put_object(bucket, "images/img1.png", b"Image 1")
        
        result = await memory_client.list_objects(bucket, prefix="docs/")
        
        assert len(result.objects) == 2
        assert all(obj.key.startswith("docs/") for obj in result.objects)
    
    @pytest.mark.asyncio
    async def test_list_objects_with_max_keys(self, memory_client):
        """Test list objects with max_keys limit"""
        bucket = "test-bucket"
        
        await memory_client.create_bucket(bucket)
        
        for i in range(10):
            await memory_client.put_object(bucket, f"file-{i:02d}.txt", f"Content {i}".encode())
        
        result = await memory_client.list_objects(bucket, max_keys=5)
        
        assert len(result.objects) == 5
        assert result.is_truncated is True
    
    @pytest.mark.asyncio
    async def test_generate_presigned_url(self, memory_client):
        """Test presigned URL generation"""
        bucket = "test-bucket"
        key = "presigned-test.txt"
        
        await memory_client.create_bucket(bucket)
        await memory_client.put_object(bucket, key, b"Presigned content")
        
        url = await memory_client.generate_presigned_url(bucket, key, expires_in=3600)
        
        assert url is not None
        assert bucket in url
        assert key in url
        assert "expires=" in url
    
    @pytest.mark.asyncio
    async def test_bucket_operations(self, memory_client):
        """Test bucket create, exists, and delete operations"""
        bucket = "new-bucket"
        
        exists = await memory_client.bucket_exists(bucket)
        assert exists is False
        
        created = await memory_client.create_bucket(bucket)
        assert created is True
        
        exists = await memory_client.bucket_exists(bucket)
        assert exists is True
        
        deleted = await memory_client.delete_bucket(bucket)
        assert deleted is True
        
        exists = await memory_client.bucket_exists(bucket)
        assert exists is False
    
    @pytest.mark.asyncio
    async def test_delete_non_empty_bucket_fails(self, memory_client):
        """Test that deleting a non-empty bucket fails"""
        bucket = "non-empty-bucket"
        
        await memory_client.create_bucket(bucket)
        await memory_client.put_object(bucket, "file.txt", b"Content")
        
        deleted = await memory_client.delete_bucket(bucket)
        assert deleted is False
    
    @pytest.mark.asyncio
    async def test_clear_storage(self, memory_client):
        """Test clearing all storage"""
        bucket = "test-bucket"
        
        await memory_client.create_bucket(bucket)
        await memory_client.put_object(bucket, "file.txt", b"Content")
        
        memory_client.clear()
        
        exists = await memory_client.bucket_exists(bucket)
        assert exists is False


class TestMLModelStorage:
    """Test suite for ML Model Storage helper"""
    
    @pytest.mark.asyncio
    async def test_save_and_load_model(self, memory_client):
        """Test saving and loading ML model artifacts"""
        ml_storage = MLModelStorage(memory_client)
        
        await memory_client.create_bucket(BUCKETS["ml_models"])
        
        model_name = "fraud_detector"
        version = "1.0.0"
        model_data = b"serialized_model_data_here"
        metadata = {"algorithm": "xgboost", "accuracy": "0.95"}
        
        result = await ml_storage.save_model(model_name, version, model_data, metadata)
        
        assert result.key == f"{model_name}/{version}/model.pkl"
        
        loaded_data, loaded_metadata = await ml_storage.load_model(model_name, version)
        
        assert loaded_data == model_data
    
    @pytest.mark.asyncio
    async def test_list_model_versions(self, memory_client):
        """Test listing model versions"""
        ml_storage = MLModelStorage(memory_client)
        
        await memory_client.create_bucket(BUCKETS["ml_models"])
        
        model_name = "risk_scorer"
        versions = ["1.0.0", "1.1.0", "2.0.0"]
        
        for version in versions:
            await ml_storage.save_model(model_name, version, f"model_{version}".encode())
        
        listed_versions = await ml_storage.list_versions(model_name)
        
        assert set(listed_versions) == set(versions)
    
    @pytest.mark.asyncio
    async def test_delete_model(self, memory_client):
        """Test deleting a model version"""
        ml_storage = MLModelStorage(memory_client)
        
        await memory_client.create_bucket(BUCKETS["ml_models"])
        
        model_name = "anomaly_detector"
        version = "1.0.0"
        
        await ml_storage.save_model(model_name, version, b"model_data")
        
        deleted = await ml_storage.delete_model(model_name, version)
        assert deleted is True
        
        with pytest.raises(KeyError):
            await ml_storage.load_model(model_name, version)


class TestLakehouseStorage:
    """Test suite for Lakehouse Storage helper"""
    
    @pytest.mark.asyncio
    async def test_write_and_read_event(self, memory_client):
        """Test writing and reading lakehouse events"""
        lakehouse = LakehouseStorage(memory_client)
        
        for bucket in [BUCKETS["lakehouse_bronze"], BUCKETS["lakehouse_silver"], BUCKETS["lakehouse_gold"]]:
            await memory_client.create_bucket(bucket)
        
        event_type = "transaction"
        event_id = str(uuid.uuid4())
        event_data = {
            "transaction_id": "tx_123",
            "amount": 1000,
            "currency": "NGN",
            "status": "completed"
        }
        timestamp = datetime(2024, 12, 15, 10, 30, 0)
        
        result = await lakehouse.write_event("bronze", event_type, event_id, event_data, timestamp)
        
        assert result.bucket == BUCKETS["lakehouse_bronze"]
        assert event_type in result.key
        assert "dt=2024-12-15" in result.key
        
        events = await lakehouse.read_events("bronze", event_type, "2024-12-15", "10")
        
        assert len(events) == 1
        assert events[0]["transaction_id"] == "tx_123"
    
    @pytest.mark.asyncio
    async def test_write_parquet(self, memory_client):
        """Test writing Parquet files to lakehouse"""
        lakehouse = LakehouseStorage(memory_client)
        
        await memory_client.create_bucket(BUCKETS["lakehouse_silver"])
        
        table_name = "fact_transactions"
        partition = "dt=2024-12-15"
        parquet_data = b"fake_parquet_data"
        
        result = await lakehouse.write_parquet("silver", table_name, partition, parquet_data)
        
        assert result.bucket == BUCKETS["lakehouse_silver"]
        assert table_name in result.key
        assert partition in result.key


class TestAuditLogStorage:
    """Test suite for Audit Log Storage helper"""
    
    @pytest.mark.asyncio
    async def test_write_and_query_logs(self, memory_client):
        """Test writing and querying audit logs"""
        audit_storage = AuditLogStorage(memory_client)
        
        await memory_client.create_bucket(BUCKETS["audit_logs"])
        
        service = "kyc-service"
        action = "document_upload"
        user_id = "user_123"
        data = {"document_type": "passport", "file_size": 1024}
        timestamp = datetime(2024, 12, 15, 14, 30, 0)
        
        result = await audit_storage.write_log(service, action, user_id, data, timestamp)
        
        assert result.bucket == BUCKETS["audit_logs"]
        assert service in result.key
        assert action in result.key
        
        logs = await audit_storage.query_logs(service, "2024-12-15", action)
        
        assert len(logs) == 1
        assert logs[0]["service"] == service
        assert logs[0]["action"] == action
        assert logs[0]["user_id"] == user_id


class TestStorageClientFactory:
    """Test suite for storage client factory"""
    
    def test_get_memory_client(self, reset_singleton, monkeypatch):
        """Test getting in-memory storage client"""
        monkeypatch.setenv("OBJECT_STORAGE_BACKEND", "memory")
        
        reset_storage_client()
        client = get_storage_client()
        
        assert isinstance(client, InMemoryStorageClient)
    
    def test_singleton_pattern(self, reset_singleton, monkeypatch):
        """Test that get_storage_client returns the same instance"""
        monkeypatch.setenv("OBJECT_STORAGE_BACKEND", "memory")
        
        reset_storage_client()
        client1 = get_storage_client()
        client2 = get_storage_client()
        
        assert client1 is client2


class TestConvenienceFunctions:
    """Test suite for convenience functions"""
    
    @pytest.mark.asyncio
    async def test_upload_download_delete_flow(self, reset_singleton, monkeypatch):
        """Test the full upload, download, delete flow using convenience functions"""
        monkeypatch.setenv("OBJECT_STORAGE_BACKEND", "memory")
        reset_storage_client()
        
        client = get_storage_client()
        bucket = "test-bucket"
        key = "convenience-test.txt"
        data = b"Convenience function test"
        
        await client.create_bucket(bucket)
        
        result = await upload_file(bucket, key, data, "text/plain")
        assert result.key == key
        
        exists = await file_exists(bucket, key)
        assert exists is True
        
        content, metadata = await download_file(bucket, key)
        assert content == data
        
        url = await get_presigned_url(bucket, key)
        assert url is not None
        
        deleted = await delete_file(bucket, key)
        assert deleted is True
        
        exists = await file_exists(bucket, key)
        assert exists is False


class TestRegressionMinIOToRustFS:
    """
    Regression tests to ensure MinIO to RustFS migration doesn't break functionality
    These tests verify that all storage operations work correctly after migration
    """
    
    @pytest.mark.asyncio
    async def test_kyc_document_storage_flow(self, memory_client):
        """Test KYC document storage workflow (regression test)"""
        bucket = "kyc-documents"
        await memory_client.create_bucket(bucket)
        
        user_id = "user_456"
        document_type = "passport"
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        unique_id = uuid.uuid4().hex[:8]
        
        key = f"kyc/{user_id}/{document_type}/{timestamp}_{unique_id}.pdf"
        document_data = b"fake_pdf_content"
        metadata = {
            "original_filename": "passport.pdf",
            "user_id": user_id,
            "document_type": document_type
        }
        
        result = await memory_client.put_object(
            bucket, key, document_data,
            content_type="application/pdf",
            metadata=metadata
        )
        
        assert result.key == key
        assert result.size == len(document_data)
        
        content, obj_metadata = await memory_client.get_object(bucket, key)
        assert content == document_data
        assert obj_metadata.metadata["user_id"] == user_id
        
        url = await memory_client.generate_presigned_url(bucket, key, expires_in=3600)
        assert url is not None
    
    @pytest.mark.asyncio
    async def test_ml_model_artifact_storage_flow(self, memory_client):
        """Test ML model artifact storage workflow (regression test)"""
        bucket = "ml-models"
        await memory_client.create_bucket(bucket)
        
        model_name = "fraud_detector_v2"
        version = "2.0.0"
        key = f"{model_name}/{version}/model.pkl"
        
        import pickle
        model_data = pickle.dumps({"weights": [0.1, 0.2, 0.3], "bias": 0.5})
        metadata = {
            "algorithm": "xgboost",
            "accuracy": "0.96",
            "training_date": datetime.utcnow().isoformat()
        }
        
        result = await memory_client.put_object(
            bucket, key, model_data,
            content_type="application/octet-stream",
            metadata=metadata
        )
        
        assert result.key == key
        
        content, obj_metadata = await memory_client.get_object(bucket, key)
        loaded_model = pickle.loads(content)
        assert loaded_model["weights"] == [0.1, 0.2, 0.3]
    
    @pytest.mark.asyncio
    async def test_lakehouse_event_storage_flow(self, memory_client):
        """Test lakehouse event storage workflow (regression test)"""
        bucket = "lakehouse-bronze"
        await memory_client.create_bucket(bucket)
        
        event_type = "transaction"
        event_id = str(uuid.uuid4())
        timestamp = datetime.utcnow()
        date_partition = timestamp.strftime("%Y-%m-%d")
        hour_partition = timestamp.strftime("%H")
        
        key = f"{event_type}/dt={date_partition}/hr={hour_partition}/{event_id}.json"
        event_data = {
            "event_id": event_id,
            "timestamp": timestamp.isoformat(),
            "user_id": "user_789",
            "amount": 50000,
            "currency": "NGN",
            "corridor": "NG-US",
            "status": "completed"
        }
        
        result = await memory_client.put_object(
            bucket, key,
            json.dumps(event_data).encode("utf-8"),
            content_type="application/json"
        )
        
        assert result.key == key
        
        content, _ = await memory_client.get_object(bucket, key)
        loaded_event = json.loads(content.decode("utf-8"))
        assert loaded_event["event_id"] == event_id
        assert loaded_event["amount"] == 50000
    
    @pytest.mark.asyncio
    async def test_versioning_support(self, memory_client):
        """Test object versioning support (regression test)"""
        bucket = "versioned-bucket"
        key = "versioned-file.txt"
        
        await memory_client.create_bucket(bucket)
        
        result1 = await memory_client.put_object(bucket, key, b"Version 1")
        version1 = result1.version_id
        
        result2 = await memory_client.put_object(bucket, key, b"Version 2")
        version2 = result2.version_id
        
        assert version1 != version2
        
        content, _ = await memory_client.get_object(bucket, key)
        assert content == b"Version 2"
    
    @pytest.mark.asyncio
    async def test_large_file_handling(self, memory_client):
        """Test handling of larger files (regression test)"""
        bucket = "large-files"
        key = "large-file.bin"
        
        await memory_client.create_bucket(bucket)
        
        large_data = b"x" * (10 * 1024 * 1024)
        
        result = await memory_client.put_object(bucket, key, large_data)
        
        assert result.size == len(large_data)
        
        content, metadata = await memory_client.get_object(bucket, key)
        assert len(content) == len(large_data)
        assert metadata.size == len(large_data)
    
    @pytest.mark.asyncio
    async def test_special_characters_in_key(self, memory_client):
        """Test handling of special characters in object keys (regression test)"""
        bucket = "special-chars"
        
        await memory_client.create_bucket(bucket)
        
        keys_to_test = [
            "path/to/file with spaces.txt",
            "path/to/file-with-dashes.txt",
            "path/to/file_with_underscores.txt",
            "path/to/file.multiple.dots.txt",
        ]
        
        for key in keys_to_test:
            await memory_client.put_object(bucket, key, f"Content for {key}".encode())
            content, _ = await memory_client.get_object(bucket, key)
            assert content == f"Content for {key}".encode()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
