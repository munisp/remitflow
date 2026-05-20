# CORS Configuration Guide
## PIX Integration Service - Cross-Origin Resource Sharing

**Version**: 2.5.0  
**Date**: November 1, 2024  
**Status**: ✅ Production Ready

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Configuration Options](#configuration-options)
4. [Environment-Specific Setup](#environment-specific-setup)
5. [Security Best Practices](#security-best-practices)
6. [Common Scenarios](#common-scenarios)
7. [Troubleshooting](#troubleshooting)
8. [Testing CORS](#testing-cors)

---

## Overview

### What is CORS?

**Cross-Origin Resource Sharing (CORS)** is a security mechanism that allows or restricts web applications running at one origin (domain) to access resources from a different origin.

### Why Do We Need CORS?

When your frontend (e.g., `https://app.example.com`) needs to call your backend API (e.g., `https://api.example.com`), browsers enforce the **Same-Origin Policy** and block the request unless the backend explicitly allows it via CORS headers.

### How It Works

```
Frontend (https://app.example.com)
    │
    ├── Makes request to API
    │
    v
Backend (https://api.example.com)
    │
    ├── Checks CORS configuration
    ├── Adds CORS headers to response
    │
    v
Browser
    │
    ├── Validates CORS headers
    └── Allows or blocks response
```

---

## Quick Start

### 1. Development Setup

For local development with frontend on `localhost:3000`:

**.env**:
```bash
ENVIRONMENT=development
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000
CORS_ALLOW_CREDENTIALS=true
CORS_ALLOWED_METHODS=*
CORS_ALLOWED_HEADERS=*
CORS_MAX_AGE=600
```

### 2. Production Setup

For production with frontend at `https://app.example.com`:

**.env**:
```bash
ENVIRONMENT=production
CORS_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
CORS_ALLOW_CREDENTIALS=true
CORS_ALLOWED_METHODS=GET,POST,PUT,PATCH,DELETE,OPTIONS
CORS_ALLOWED_HEADERS=accept,accept-encoding,authorization,content-type,dnt,origin,user-agent,x-csrftoken,x-requested-with
CORS_EXPOSE_HEADERS=content-length,content-type
CORS_MAX_AGE=3600
```

### 3. Verify Configuration

```bash
# Start the service
python main.py

# Check logs for CORS configuration
# You should see:
# INFO: CORS middleware configured successfully
# INFO: CORS Configuration Summary:
#   - Environment: production
#   - Allowed Origins: ['https://app.example.com']
#   ...
```

---

## Configuration Options

### CORS_ALLOWED_ORIGINS

**Description**: Comma-separated list of allowed origin URLs

**Format**: `https://domain1.com,https://domain2.com`

**Examples**:
```bash
# Single origin
CORS_ALLOWED_ORIGINS=https://app.example.com

# Multiple origins
CORS_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com,https://mobile.example.com

# Development (localhost)
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# All origins (DEVELOPMENT ONLY - NOT SECURE)
CORS_ALLOWED_ORIGINS=*
```

**⚠️ Security Warning**: Never use `*` in production!

---

### CORS_ALLOW_CREDENTIALS

**Description**: Allow cookies and authorization headers in cross-origin requests

**Values**: `true` or `false`

**When to use `true`**:
- Frontend sends authentication tokens in headers
- Frontend needs to send/receive cookies
- Using session-based authentication

**When to use `false`**:
- Public API with no authentication
- API key authentication only (no cookies)

**Example**:
```bash
CORS_ALLOW_CREDENTIALS=true
```

**⚠️ Important**: Cannot use `CORS_ALLOWED_ORIGINS=*` when `CORS_ALLOW_CREDENTIALS=true`

---

### CORS_ALLOWED_METHODS

**Description**: HTTP methods allowed in cross-origin requests

**Format**: Comma-separated list or `*`

**Common Methods**:
- `GET` - Read data
- `POST` - Create data
- `PUT` - Update data (full replacement)
- `PATCH` - Update data (partial)
- `DELETE` - Delete data
- `OPTIONS` - Preflight requests (automatically included)

**Examples**:
```bash
# Read-only API
CORS_ALLOWED_METHODS=GET,OPTIONS

# Full CRUD API
CORS_ALLOWED_METHODS=GET,POST,PUT,PATCH,DELETE,OPTIONS

# All methods (development)
CORS_ALLOWED_METHODS=*
```

---

### CORS_ALLOWED_HEADERS

**Description**: HTTP headers allowed in cross-origin requests

**Format**: Comma-separated list or `*`

**Common Headers**:
- `accept` - Response format
- `authorization` - Auth tokens
- `content-type` - Request body format
- `origin` - Request origin
- `user-agent` - Client info
- `x-csrftoken` - CSRF protection
- `x-requested-with` - AJAX indicator

**Examples**:
```bash
# Minimal (public API)
CORS_ALLOWED_HEADERS=accept,content-type

# Standard (authenticated API)
CORS_ALLOWED_HEADERS=accept,authorization,content-type,origin

# Comprehensive (production)
CORS_ALLOWED_HEADERS=accept,accept-encoding,authorization,content-type,dnt,origin,user-agent,x-csrftoken,x-requested-with

# All headers (development)
CORS_ALLOWED_HEADERS=*
```

---

### CORS_EXPOSE_HEADERS

**Description**: Response headers that JavaScript can access

**Format**: Comma-separated list

**Default Headers** (always exposed):
- `cache-control`
- `content-language`
- `content-type`
- `expires`
- `last-modified`
- `pragma`

**Additional Headers** (must be explicitly exposed):
- `content-length` - Response size
- `x-ratelimit-remaining` - Rate limit info
- `x-total-count` - Pagination total

**Example**:
```bash
CORS_EXPOSE_HEADERS=content-length,content-type,x-ratelimit-remaining,x-total-count
```

---

### CORS_MAX_AGE

**Description**: How long (in seconds) browsers can cache preflight responses

**Format**: Integer (seconds)

**Recommended Values**:
- Development: `600` (10 minutes)
- Production: `3600` (1 hour) or `86400` (24 hours)

**Example**:
```bash
# Development (frequent changes)
CORS_MAX_AGE=600

# Production (stable config)
CORS_MAX_AGE=3600
```

**Trade-offs**:
- **Higher values**: Fewer preflight requests, better performance, slower config updates
- **Lower values**: More preflight requests, worse performance, faster config updates

---

## Environment-Specific Setup

### Development Environment

**Goal**: Maximize convenience, allow all local origins

```bash
ENVIRONMENT=development
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://localhost:8080
CORS_ALLOW_CREDENTIALS=true
CORS_ALLOWED_METHODS=*
CORS_ALLOWED_HEADERS=*
CORS_EXPOSE_HEADERS=content-length,content-type
CORS_MAX_AGE=600
```

**Automatic Defaults**:
- If `ENVIRONMENT=development`, wildcards (`*`) are allowed
- Default origins include common development ports

---

### Staging Environment

**Goal**: Match production config, test with staging domains

```bash
ENVIRONMENT=staging
CORS_ALLOWED_ORIGINS=https://staging-app.example.com,https://staging-admin.example.com
CORS_ALLOW_CREDENTIALS=true
CORS_ALLOWED_METHODS=GET,POST,PUT,PATCH,DELETE,OPTIONS
CORS_ALLOWED_HEADERS=accept,accept-encoding,authorization,content-type,origin,user-agent
CORS_EXPOSE_HEADERS=content-length,content-type
CORS_MAX_AGE=3600
```

---

### Production Environment

**Goal**: Maximum security, specific domains only

```bash
ENVIRONMENT=production
CORS_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
CORS_ALLOW_CREDENTIALS=true
CORS_ALLOWED_METHODS=GET,POST,PUT,PATCH,DELETE,OPTIONS
CORS_ALLOWED_HEADERS=accept,accept-encoding,authorization,content-type,dnt,origin,user-agent,x-csrftoken,x-requested-with
CORS_EXPOSE_HEADERS=content-length,content-type
CORS_MAX_AGE=3600
```

**⚠️ Production Validation**:
- System automatically validates production config
- Warnings logged for insecure settings
- Wildcards (`*`) trigger critical warnings

---

## Security Best Practices

### 1. Never Use Wildcards in Production

❌ **BAD** (Production):
```bash
CORS_ALLOWED_ORIGINS=*
```

✅ **GOOD** (Production):
```bash
CORS_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
```

---

### 2. Specify Exact Origins

❌ **BAD** (Too permissive):
```bash
CORS_ALLOWED_ORIGINS=https://*.example.com
```

✅ **GOOD** (Specific subdomains):
```bash
CORS_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com,https://mobile.example.com
```

---

### 3. Use HTTPS in Production

❌ **BAD** (Insecure):
```bash
CORS_ALLOWED_ORIGINS=http://app.example.com
```

✅ **GOOD** (Secure):
```bash
CORS_ALLOWED_ORIGINS=https://app.example.com
```

---

### 4. Limit Methods and Headers

❌ **BAD** (Too permissive):
```bash
CORS_ALLOWED_METHODS=*
CORS_ALLOWED_HEADERS=*
```

✅ **GOOD** (Specific):
```bash
CORS_ALLOWED_METHODS=GET,POST,PUT,DELETE,OPTIONS
CORS_ALLOWED_HEADERS=accept,authorization,content-type,origin
```

---

### 5. Credentials Require Specific Origins

❌ **BAD** (Invalid combination):
```bash
CORS_ALLOWED_ORIGINS=*
CORS_ALLOW_CREDENTIALS=true
```

✅ **GOOD** (Valid combination):
```bash
CORS_ALLOWED_ORIGINS=https://app.example.com
CORS_ALLOW_CREDENTIALS=true
```

---

## Common Scenarios

### Scenario 1: React App on Vercel

**Frontend**: `https://myapp.vercel.app`  
**Backend**: `https://api.example.com`

```bash
CORS_ALLOWED_ORIGINS=https://myapp.vercel.app
CORS_ALLOW_CREDENTIALS=true
CORS_ALLOWED_METHODS=GET,POST,PUT,PATCH,DELETE,OPTIONS
CORS_ALLOWED_HEADERS=accept,authorization,content-type,origin
```

---

### Scenario 2: Multiple Frontends

**App**: `https://app.example.com`  
**Admin**: `https://admin.example.com`  
**Mobile Web**: `https://m.example.com`

```bash
CORS_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com,https://m.example.com
CORS_ALLOW_CREDENTIALS=true
CORS_ALLOWED_METHODS=GET,POST,PUT,PATCH,DELETE,OPTIONS
CORS_ALLOWED_HEADERS=accept,authorization,content-type,origin
```

---

### Scenario 3: Public API (No Auth)

**Public API**: No authentication required

```bash
CORS_ALLOWED_ORIGINS=*
CORS_ALLOW_CREDENTIALS=false
CORS_ALLOWED_METHODS=GET,POST,OPTIONS
CORS_ALLOWED_HEADERS=accept,content-type
```

---

### Scenario 4: Local Development with Multiple Ports

**Frontend**: `localhost:3000` (React)  
**Admin**: `localhost:5173` (Vite)  
**Mobile**: `localhost:8080` (Vue)

```bash
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,http://localhost:8080,http://127.0.0.1:3000
CORS_ALLOW_CREDENTIALS=true
CORS_ALLOWED_METHODS=*
CORS_ALLOWED_HEADERS=*
```

---

## Troubleshooting

### Error: "CORS policy: No 'Access-Control-Allow-Origin' header"

**Cause**: Origin not in `CORS_ALLOWED_ORIGINS`

**Solution**:
```bash
# Add your frontend domain
CORS_ALLOWED_ORIGINS=https://your-frontend-domain.com
```

---

### Error: "CORS policy: Credentials mode is 'include'"

**Cause**: Using `*` for origins with credentials enabled

**Solution**:
```bash
# Replace wildcard with specific origin
CORS_ALLOWED_ORIGINS=https://your-frontend-domain.com
CORS_ALLOW_CREDENTIALS=true
```

---

### Error: "CORS policy: Method not allowed"

**Cause**: HTTP method not in `CORS_ALLOWED_METHODS`

**Solution**:
```bash
# Add the required method (e.g., PATCH)
CORS_ALLOWED_METHODS=GET,POST,PUT,PATCH,DELETE,OPTIONS
```

---

### Error: "CORS policy: Header not allowed"

**Cause**: Custom header not in `CORS_ALLOWED_HEADERS`

**Solution**:
```bash
# Add the required header
CORS_ALLOWED_HEADERS=accept,authorization,content-type,x-custom-header
```

---

### Preflight Requests Failing

**Symptoms**: OPTIONS requests return 404 or 405

**Cause**: Server not handling OPTIONS method

**Solution**: FastAPI automatically handles OPTIONS. Check:
1. CORS middleware is configured
2. `OPTIONS` is in `CORS_ALLOWED_METHODS`

---

## Testing CORS

### Test 1: Check CORS Headers

```bash
curl -I -X OPTIONS http://localhost:8000/api/v1/pix/keys \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST"
```

**Expected Response**:
```
HTTP/1.1 200 OK
access-control-allow-origin: http://localhost:3000
access-control-allow-credentials: true
access-control-allow-methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
access-control-allow-headers: accept,authorization,content-type
access-control-max-age: 3600
```

---

### Test 2: JavaScript Fetch

```javascript
// Frontend code
fetch('http://localhost:8000/api/v1/pix/keys', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
  },
  credentials: 'include'  // Send cookies
})
.then(response => response.json())
.then(data => console.log('Success:', data))
.catch(error => console.error('CORS Error:', error));
```

---

### Test 3: Browser DevTools

1. Open browser DevTools (F12)
2. Go to **Network** tab
3. Make request to API
4. Click on request
5. Check **Response Headers**:
   - `access-control-allow-origin`
   - `access-control-allow-credentials`
   - `access-control-allow-methods`

---

### Test 4: Automated Testing

```python
# test_cors.py
import requests

def test_cors_headers():
    response = requests.options(
        'http://localhost:8000/api/v1/pix/keys',
        headers={
            'Origin': 'http://localhost:3000',
            'Access-Control-Request-Method': 'POST'
        }
    )
    
    assert response.status_code == 200
    assert 'access-control-allow-origin' in response.headers
    assert response.headers['access-control-allow-origin'] == 'http://localhost:3000'
    assert 'access-control-allow-credentials' in response.headers
    print("✅ CORS headers present and correct")

if __name__ == "__main__":
    test_cors_headers()
```

---

## Configuration Validation

The system automatically validates CORS configuration:

### Validation Checks

1. ✅ **Production Wildcard Check**: Warns if `*` used in production
2. ✅ **Credentials + Wildcard Check**: Errors if both enabled
3. ✅ **Empty Origins Check**: Errors if no origins configured
4. ✅ **Localhost in Production**: Warns if localhost in production origins
5. ✅ **HTTPS Check**: Warns if HTTP used in production

### View Validation Results

```bash
# Check application logs on startup
# You'll see:
INFO: CORS configuration validation passed
# or
ERROR: CORS Configuration Issues:
  - CRITICAL: Wildcard (*) origins in production
  - ERROR: Cannot use credentials with wildcard (*) origins
```

---

## Advanced Configuration

### Dynamic Origin Validation

For more complex scenarios (e.g., multi-tenant), you can extend `CORSConfig`:

```python
# cors_config.py
class CORSConfig:
    @staticmethod
    def is_origin_allowed(origin: str) -> bool:
        """Custom origin validation logic"""
        # Example: Allow all subdomains of example.com
        if origin.endswith('.example.com'):
            return True
        
        # Check against configured origins
        allowed = CORSConfig.get_allowed_origins()
        return origin in allowed
```

---

## Conclusion

CORS configuration is **critical for security** and **essential for functionality**. This guide provides:

✅ **Environment-specific configurations** for development, staging, production  
✅ **Security best practices** to prevent vulnerabilities  
✅ **Common scenarios** with ready-to-use configs  
✅ **Troubleshooting guide** for common issues  
✅ **Testing procedures** to verify configuration  
✅ **Automatic validation** to catch misconfigurations  

**Status**: ✅ Production Ready  
**Security**: ✅ Best Practices Implemented  
**Validation**: ✅ Automatic Checks Enabled

---

**Version**: 2.5.0  
**Last Updated**: November 1, 2024  
**Maintainer**: PIX Integration Team
