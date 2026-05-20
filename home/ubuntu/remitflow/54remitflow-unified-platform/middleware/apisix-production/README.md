# APISIX API Gateway - Production Implementation

**Version**: 1.0.0  
**Platform**: Nigerian Remittance Platform  
**Status**: Production Ready ✅

---

## Overview

Complete production-ready implementation of Apache APISIX API Gateway for the Nigerian Remittance Platform. This implementation provides enterprise-grade API management with authentication, rate limiting, load balancing, caching, and comprehensive monitoring.

---

## Features

### Core Capabilities
- ✅ **Dynamic Routing** - Configure routes without restart
- ✅ **Load Balancing** - Multiple algorithms (round-robin, consistent hash, EWMA, least-conn)
- ✅ **Health Checks** - Active and passive upstream health monitoring
- ✅ **Circuit Breaker** - Automatic failover for unhealthy upstreams
- ✅ **Authentication** - OpenID Connect (Keycloak), JWT, API Key
- ✅ **Rate Limiting** - Request, connection, and count limiting
- ✅ **Caching** - Proxy caching with configurable TTL
- ✅ **CORS** - Cross-Origin Resource Sharing support
- ✅ **SSL/TLS** - HTTPS termination and mTLS support

### Security Features
- ✅ **Keycloak Integration** - OpenID Connect authentication
- ✅ **JWT Validation** - Token-based authentication
- ✅ **IP Restriction** - Whitelist/blacklist IP addresses
- ✅ **CSRF Protection** - Cross-Site Request Forgery prevention
- ✅ **Request Validation** - JSON schema validation

### Observability
- ✅ **Prometheus Metrics** - Comprehensive metrics collection
- ✅ **Grafana Dashboards** - Real-time visualization
- ✅ **Distributed Tracing** - Jaeger integration
- ✅ **Access Logs** - Detailed request logging
- ✅ **Error Tracking** - Error logging and monitoring

---

## Architecture

```
┌─────────────┐
│   Clients   │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────┐
│         APISIX Gateway              │
│  ┌──────────────────────────────┐  │
│  │  Authentication (Keycloak)   │  │
│  ├──────────────────────────────┤  │
│  │  Rate Limiting               │  │
│  ├──────────────────────────────┤  │
│  │  Load Balancing              │  │
│  ├──────────────────────────────┤  │
│  │  Caching                     │  │
│  └──────────────────────────────┘  │
└────────┬────────────────────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌────────┐
│ etcd   │ │Upstream│
│Cluster │ │Services│
└────────┘ └────────┘
```

---

## Quick Start

### Prerequisites
- Docker 20.10+
- Docker Compose 2.0+
- Python 3.9+ (for configuration scripts)

### Installation

#### 1. Start APISIX Stack

```bash
cd docker
docker-compose up -d
```

Services started:
- APISIX Gateway: `http://localhost:9080`
- APISIX Dashboard: `http://localhost:9000`
- Admin API: `http://localhost:9180`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000`
- Jaeger UI: `http://localhost:16686`

#### 2. Configure Routes

```bash
cd ..
pip install -r requirements.txt
python routes/configure_routes.py
```

#### 3. Configure Security

```bash
python plugins/security_plugins.py
```

#### 4. Configure Advanced Features

```bash
python plugins/advanced_features.py
```

#### 5. Verify Installation

```bash
# Check APISIX status
curl http://localhost:9080/apisix/status

# Check metrics
curl http://localhost:9080/apisix/prometheus/metrics

# Run tests
pytest tests/test_apisix.py -v
```

---

## Configuration

### Routes

Routes are configured in `routes/configure_routes.py`. Each route includes:

- **URI Pattern** - Path matching pattern
- **Methods** - Allowed HTTP methods
- **Upstream** - Target service
- **Plugins** - Applied plugins (auth, rate limiting, etc.)

Example route configuration:

```python
"payment": {
    "name": "Payment Processing API",
    "uri": "/api/v1/payments/*",
    "methods": ["GET", "POST", "PUT", "DELETE"],
    "upstream_id": "payment",
    "plugins": {
        "openid-connect": {...},
        "cors": {...},
        "limit-req": {...}
    }
}
```

### Upstreams

Upstreams are configured with:

- **Load Balancing Algorithm** - round-robin, chash, ewma, least_conn
- **Health Checks** - Active and passive health monitoring
- **Timeouts** - Connect, send, read timeouts
- **Retries** - Number of retry attempts

### Security Plugins

Security plugins are configured in `plugins/security_plugins.py`:

- **OpenID Connect** - Keycloak authentication
- **JWT Auth** - Token validation
- **Key Auth** - API key authentication
- **CORS** - Cross-origin requests
- **IP Restriction** - IP whitelisting/blacklisting
- **CSRF** - CSRF protection

### Rate Limiting

Rate limiting is configured per route:

```python
"limit-req": {
    "rate": 200,      # Requests per second
    "burst": 100,     # Burst capacity
    "key": "remote_addr"
}
```

---

## Monitoring

### Prometheus Metrics

Access metrics at: `http://localhost:9080/apisix/prometheus/metrics`

Key metrics:
- `apisix_http_status` - HTTP status codes
- `apisix_http_latency` - Request latency
- `apisix_bandwidth` - Bandwidth usage
- `apisix_etcd_reachable` - etcd health

### Grafana Dashboards

Access Grafana at: `http://localhost:3000` (admin/admin)

Pre-configured dashboards:
- APISIX Overview
- Request Rate and Latency
- Upstream Health
- Error Rates

### Distributed Tracing

Access Jaeger UI at: `http://localhost:16686`

Traces include:
- Request flow through APISIX
- Upstream service calls
- Plugin execution time

---

## Testing

### Run All Tests

```bash
pytest tests/test_apisix.py -v
```

### Test Categories

- **Infrastructure Tests** - Health checks, Admin API
- **Routing Tests** - Route configuration and forwarding
- **Security Tests** - Authentication, CORS, JWT
- **Rate Limiting Tests** - Rate limit enforcement
- **Performance Tests** - Response time, concurrent requests
- **Observability Tests** - Metrics, logs, tracing

### Load Testing

```bash
# Install Apache Bench
apt-get install apache2-utils

# Run load test
ab -n 10000 -c 100 http://localhost:9080/apisix/status
```

---

## Production Deployment

### Kubernetes

Deploy to Kubernetes:

```bash
kubectl apply -f kubernetes/apisix-deployment.yaml
```

This creates:
- etcd StatefulSet (3 replicas)
- APISIX Deployment (3 replicas)
- APISIX Dashboard Deployment (2 replicas)
- Services and Ingress
- HorizontalPodAutoscaler

### High Availability

Production setup includes:
- **3 etcd nodes** - Configuration store
- **3+ APISIX instances** - Gateway instances
- **2 Dashboard instances** - Management UI
- **Auto-scaling** - Based on CPU/memory usage

### SSL/TLS

Configure SSL certificates:

```bash
# Add SSL certificate
curl http://localhost:9180/apisix/admin/ssls/1 \
  -H "X-API-KEY: $ADMIN_KEY" \
  -X PUT -d '{
    "cert": "...",
    "key": "...",
    "snis": ["api.remittance-platform.ng"]
  }'
```

---

## Troubleshooting

### Common Issues

#### 1. APISIX Not Starting

```bash
# Check logs
docker logs apisix-gateway

# Check etcd connectivity
docker exec apisix-gateway curl http://etcd:2379/health
```

#### 2. Routes Not Working

```bash
# List all routes
curl http://localhost:9180/apisix/admin/routes \
  -H "X-API-KEY: $ADMIN_KEY"

# Check route configuration
curl http://localhost:9180/apisix/admin/routes/{route_id} \
  -H "X-API-KEY: $ADMIN_KEY"
```

#### 3. Authentication Failing

```bash
# Check Keycloak connectivity
curl http://keycloak:8080/realms/remittance/.well-known/openid-configuration

# Check plugin configuration
curl http://localhost:9180/apisix/admin/routes/{route_id} \
  -H "X-API-KEY: $ADMIN_KEY" | jq '.plugins'
```

---

## Performance Tuning

### APISIX Configuration

```yaml
nginx_config:
  worker_processes: auto
  worker_connections: 10240
  
  http:
    keepalive_timeout: 60s
    client_max_body_size: 10m
    
    upstream:
      keepalive: 320
      keepalive_requests: 1000
```

### etcd Configuration

```bash
# Increase etcd quota
etcdctl --endpoints=http://etcd:2379 \
  put /apisix/config/quota-backend-bytes 8589934592
```

---

## Security Best Practices

1. **Change Default Admin Key** - Update `APISIX_ADMIN_KEY` in production
2. **Enable HTTPS** - Use SSL/TLS for all traffic
3. **Restrict Admin API** - Limit access to Admin API by IP
4. **Use Strong Secrets** - Generate strong JWT secrets
5. **Enable mTLS** - Use mutual TLS for upstream connections
6. **Regular Updates** - Keep APISIX and plugins updated
7. **Audit Logs** - Enable and monitor access logs

---

## Maintenance

### Backup etcd

```bash
# Backup etcd data
etcdctl --endpoints=http://etcd:2379 snapshot save backup.db
```

### Update APISIX

```bash
# Pull latest image
docker pull apache/apisix:latest

# Restart with new image
docker-compose up -d
```

### Monitor Health

```bash
# Check APISIX health
curl http://localhost:9080/apisix/status

# Check etcd health
curl http://localhost:2379/health

# Check Prometheus metrics
curl http://localhost:9080/apisix/prometheus/metrics
```

---

## API Reference

### Admin API

**Base URL**: `http://localhost:9180/apisix/admin`

**Authentication**: `X-API-KEY` header

#### Routes

```bash
# List all routes
GET /routes

# Get route
GET /routes/{id}

# Create/Update route
PUT /routes/{id}

# Delete route
DELETE /routes/{id}
```

#### Upstreams

```bash
# List all upstreams
GET /upstreams

# Get upstream
GET /upstreams/{id}

# Create/Update upstream
PUT /upstreams/{id}

# Delete upstream
DELETE /upstreams/{id}
```

#### Plugins

```bash
# List available plugins
GET /plugins/list

# Get plugin schema
GET /plugins/{name}
```

---

## Support

### Documentation
- [APISIX Official Docs](https://apisix.apache.org/docs/apisix/getting-started/)
- [Plugin Hub](https://apisix.apache.org/plugins/)
- [API Reference](https://apisix.apache.org/docs/apisix/admin-api/)

### Community
- [GitHub Issues](https://github.com/apache/apisix/issues)
- [Slack Channel](https://apisix.apache.org/slack)
- [Mailing List](https://apisix.apache.org/mailing-list)

---

## License

Apache License 2.0

---

## Contributors

Nigerian Remittance Platform Team

---

**Status**: Production Ready ✅  
**Version**: 1.0.0  
**Last Updated**: October 24, 2024

