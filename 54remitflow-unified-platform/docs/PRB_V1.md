# Production Readiness Baseline (PRB) v1

## Overview

This document defines the objective pass/fail criteria for production readiness of the Nigerian Remittance Platform. All criteria must pass before the platform can be considered production-ready.

**Verification Command:** `make verify`  
**Success Criteria:** Exit code 0 and all checks reported as PASSED

## Scope

### In-Scope Components
- `core-services/*-service/` - All backend microservices
- `pwa/src/` - Progressive Web App source code
- `android-native/app/src/main/` - Android native app source
- `ios-native/RemittanceApp/` - iOS native app source
- `infrastructure/` - Terraform and Kubernetes configurations
- `.github/workflows/` - CI/CD pipeline definitions
- `ops-dashboard/` - Operations dashboard

### Out-of-Scope (Excluded from Verification)
- `COMPREHENSIVE_SUPER_PLATFORM/` - Legacy archive
- `node_modules/` - Third-party dependencies
- `**/test/**`, `**/*_test.py`, `**/*Test.kt`, `**/*Tests.swift` - Test files
- `**/Preview*/` - SwiftUI preview files
- `docs/` - Documentation files

---

## Requirements

### PRB-001: No Hardcoded Credentials in Infrastructure

**Description:** No passwords, API keys, tokens, or secrets committed in YAML/YML files under `infrastructure/` or `.github/workflows/`.

**Verification Command:**
```bash
./scripts/verify_no_credentials.sh
```

**Pass Condition:** Script exits 0 with message "PASSED: No hardcoded credentials found"

**Fail Condition:** Any match found for patterns: `password=`, `secret=`, `api_key=`, `apikey=`, `token=` with actual values (not environment variable references)

---

### PRB-002: No Mock Data Functions in Production Code

**Description:** No functions named `generateMock*` or `_generate_mock*` in production source paths. Mock functions are only allowed in test files or behind `#if DEBUG` guards.

**Verification Command:**
```bash
./scripts/verify_no_mocks.sh
```

**Pass Condition:** Script exits 0 with message "PASSED: No mock functions in production code"

**Fail Condition:** Any `generateMock` or `_generate_mock` function found in production paths

---

### PRB-003: No TODO/FIXME Placeholders

**Description:** No `TODO`, `FIXME`, `XXX`, or `HACK` comments in production code indicating incomplete implementation.

**Verification Command:**
```bash
./scripts/verify_no_todos.sh
```

**Pass Condition:** Script exits 0 with message "PASSED: No TODO/FIXME placeholders found"

**Fail Condition:** Any TODO/FIXME/XXX/HACK comment found in production code (excluding placeholder text in UI like phone number formats)

---

### PRB-004: All Python Services Compile

**Description:** All Python backend services are syntactically valid and can be compiled without errors.

**Verification Command:**
```bash
./scripts/verify_python_compile.sh
```

**Pass Condition:** Script exits 0 with message "PASSED: All Python services compile successfully"

**Fail Condition:** Any syntax error or compilation failure in Python files

---

### PRB-005: All Dockerfiles Build Successfully

**Description:** Every Dockerfile in `core-services/` and `ops-dashboard/` builds a container image without errors.

**Verification Command:**
```bash
./scripts/verify_docker_builds.sh
```

**Pass Condition:** Script exits 0 with message "PASSED: All Dockerfiles build successfully"

**Fail Condition:** Any Dockerfile fails to build

---

### PRB-006: PWA Builds Successfully

**Description:** The PWA can be built with `npm run build` without TypeScript or bundling errors.

**Verification Command:**
```bash
./scripts/verify_pwa_build.sh
```

**Pass Condition:** Script exits 0 with message "PASSED: PWA builds successfully"

**Fail Condition:** Build command fails with non-zero exit code

---

### PRB-007: Database Persistence Verified

**Description:** In production environment (`ENVIRONMENT=production`), services must use persistent storage (PostgreSQL/Redis) and must NOT silently fall back to in-memory storage. In-memory fallbacks are only allowed when explicitly enabled via environment variables in non-production environments.

**Verification Command:**
```bash
./scripts/verify_persistence.sh
```

**Pass Condition:** Script exits 0 with message "PASSED: Database persistence verified"

**Fail Condition:** 
- Any `:memory:` or `sqlite:///` found in production configuration
- Any silent in-memory fallback without explicit environment check

---

## Verification Summary

| ID | Requirement | Command |
|----|-------------|---------|
| PRB-001 | No hardcoded credentials | `./scripts/verify_no_credentials.sh` |
| PRB-002 | No mock functions | `./scripts/verify_no_mocks.sh` |
| PRB-003 | No TODO/FIXME | `./scripts/verify_no_todos.sh` |
| PRB-004 | Python compiles | `./scripts/verify_python_compile.sh` |
| PRB-005 | Dockerfiles build | `./scripts/verify_docker_builds.sh` |
| PRB-006 | PWA builds | `./scripts/verify_pwa_build.sh` |
| PRB-007 | Persistence verified | `./scripts/verify_persistence.sh` |

---

## Running Verification

### Full Verification (CI)
```bash
make verify
```

### Individual Checks
```bash
make verify-no-credentials
make verify-no-mocks
make verify-no-todos
make verify-python-compile
make verify-docker-builds
make verify-pwa-build
make verify-persistence
```

### Quick Verification (No Docker/Mobile)
```bash
make verify-quick
```

---

## Environment Variables

The following environment variables control production behavior:

| Variable | Production Value | Description |
|----------|------------------|-------------|
| `ENVIRONMENT` | `production` | Environment identifier |
| `USE_MOCK_DATA` | `false` | Disable mock data |
| `ALLOW_IN_MEMORY_FALLBACK` | `false` | Disable in-memory fallbacks |
| `DATABASE_URL` | PostgreSQL DSN | Must be PostgreSQL, not SQLite |
| `REDIS_URL` | Redis DSN | Must be real Redis, not in-memory |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | 2024-12-19 | Initial PRB v1 specification |
