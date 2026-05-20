# RustFS Object Storage Infrastructure

RustFS is a high-performance, S3-compatible object storage system built in Rust. It serves as the primary object storage backend for the Nigerian Remittance Platform, replacing MinIO.

## Features

- **High Performance**: 2.3x faster than MinIO for 4KB object payloads
- **S3 Compatible**: 100% compatible with S3 API
- **Apache 2.0 License**: Permissive licensing (vs MinIO's AGPL)
- **Built in Rust**: Memory-safe and high-performance
- **Distributed Mode**: Supports multi-node deployments for HA

## Architecture

### Single Node (Development/Staging)
- `rustfs-deployment.yaml`: Single-node StatefulSet deployment
- Suitable for development and staging environments
- Uses a single PVC for data storage

### Distributed Mode (Production)
- `rustfs-distributed.yaml`: 4-node distributed deployment
- Provides high availability and data redundancy
- Uses erasure coding for data protection
- Pod anti-affinity for node distribution

## Buckets

The platform uses the following buckets:

| Bucket | Purpose | Retention |
|--------|---------|-----------|
| `kyc-documents` | KYC verification documents | Versioned |
| `property-kyc-documents` | Property transaction documents | Versioned |
| `ml-models` | Trained ML model artifacts | Versioned |
| `ml-artifacts` | ML training artifacts | 90 days |
| `lakehouse-bronze` | Raw event data | 90 days |
| `lakehouse-silver` | Cleaned/conformed data | 365 days |
| `lakehouse-gold` | Business aggregates | 5 years |
| `audit-logs` | Audit trail logs | 365 days |
| `backups` | System backups | 90 days |

## Deployment

### Prerequisites
- Kubernetes 1.21+
- kubectl configured
- Storage class available (default: `standard`)

### Deploy Single Node
```bash
kubectl apply -f rustfs-deployment.yaml
kubectl apply -f bucket-init-job.yaml
```

### Deploy Distributed Mode
```bash
kubectl apply -f rustfs-deployment.yaml  # Creates namespace and secrets
kubectl apply -f rustfs-distributed.yaml
kubectl apply -f bucket-init-job.yaml
```

### Docker Compose (Local Development)
```bash
docker-compose up -d
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RUSTFS_ENDPOINT` | `http://localhost:9000` | RustFS API endpoint |
| `RUSTFS_ACCESS_KEY` | `rustfsadmin` | Access key |
| `RUSTFS_SECRET_KEY` | `rustfsadmin` | Secret key |
| `RUSTFS_REGION` | `us-east-1` | Region for S3 compatibility |
| `RUSTFS_SECURE` | `false` | Use HTTPS |
| `OBJECT_STORAGE_BACKEND` | `s3` | Backend type (`s3` or `memory`) |

### Service-Specific Bucket Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `RUSTFS_KYC_BUCKET` | `kyc-documents` | KYC documents bucket |
| `RUSTFS_PROPERTY_BUCKET` | `property-kyc-documents` | Property docs bucket |
| `RUSTFS_ML_BUCKET` | `ml-models` | ML models bucket |
| `RUSTFS_LAKEHOUSE_BRONZE_BUCKET` | `lakehouse-bronze` | Bronze layer bucket |
| `RUSTFS_LAKEHOUSE_SILVER_BUCKET` | `lakehouse-silver` | Silver layer bucket |
| `RUSTFS_LAKEHOUSE_GOLD_BUCKET` | `lakehouse-gold` | Gold layer bucket |

## Accessing RustFS

### Console UI
- URL: `http://localhost:9001` (local) or `https://rustfs-console.example.com` (k8s)
- Default credentials: `rustfsadmin` / `rustfsadmin`

### API Endpoint
- URL: `http://localhost:9000` (local) or `https://rustfs.example.com` (k8s)
- Use any S3-compatible client (boto3, aws-cli, mc)

### Using mc (MinIO Client)
```bash
# Configure alias
mc alias set rustfs http://localhost:9000 rustfsadmin rustfsadmin

# List buckets
mc ls rustfs/

# Upload file
mc cp myfile.pdf rustfs/kyc-documents/user123/

# Download file
mc cp rustfs/kyc-documents/user123/myfile.pdf ./
```

### Using Python (boto3)
```python
import boto3

client = boto3.client(
    's3',
    endpoint_url='http://localhost:9000',
    aws_access_key_id='rustfsadmin',
    aws_secret_access_key='rustfsadmin'
)

# Upload
client.put_object(Bucket='kyc-documents', Key='test.txt', Body=b'Hello')

# Download
response = client.get_object(Bucket='kyc-documents', Key='test.txt')
content = response['Body'].read()
```

## Monitoring

### Prometheus Metrics
RustFS exposes Prometheus metrics at `/minio/v2/metrics/cluster`

### Health Checks
- Liveness: `GET /minio/health/live`
- Readiness: `GET /minio/health/ready`

## Migration from MinIO

RustFS is designed as a drop-in replacement for MinIO. To migrate:

1. Update environment variables:
   - Change `MINIO_ENDPOINT` to `RUSTFS_ENDPOINT`
   - Change `MINIO_ACCESS_KEY` to `RUSTFS_ACCESS_KEY`
   - Change `MINIO_SECRET_KEY` to `RUSTFS_SECRET_KEY`

2. Data migration (if needed):
   ```bash
   # Using mc mirror
   mc alias set minio http://old-minio:9000 minioadmin minioadmin
   mc alias set rustfs http://new-rustfs:9000 rustfsadmin rustfsadmin
   mc mirror minio/ rustfs/
   ```

3. Update application code to use `rustfs_client.py` from `core-services/common/`

## Troubleshooting

### Common Issues

**Bucket creation fails**
- Ensure RustFS is healthy: `curl http://localhost:9000/minio/health/ready`
- Check credentials are correct

**Upload fails with 403**
- Verify access key and secret key
- Check bucket policy allows writes

**Slow performance**
- For distributed mode, ensure all nodes are healthy
- Check network latency between nodes
- Verify storage class performance

### Logs
```bash
# Kubernetes
kubectl logs -n rustfs statefulset/rustfs

# Docker
docker logs rustfs
```
