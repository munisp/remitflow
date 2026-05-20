# RemitFlow — Liveness & Anti-Spoofing Architecture

## Overview

RemitFlow implements a **three-layer, fail-closed liveness pipeline** for KYC identity verification. Every selfie submitted by a user passes through all three layers before the KYC step is approved.

```
Browser (React)
    │
    │  1. Still JPEG (passive liveness)
    │  2. 4-sec WebM video (active liveness)
    ▼
Node.js / tRPC  ──→  serviceRegistry.ts
    │
    ├──→ [Port 8096]  Rust Liveness Proxy       ← circuit-breaker + rate-limiter
    │         │
    │         └──→ [Port 8090]  Python KYC Liveness Service
    │                   ├── Passive liveness (single image)
    │                   ├── Active liveness  (video / motion)
    │                   ├── Face matching    (two images)
    │                   ├── Face detection
    │                   ├── 68-point facial landmarks
    │                   ├── Face feature extraction
    │                   ├── Anti-spoofing classification
    │                   └── Confidence score + DB persistence + event publishing
    │
    └──→ [Port 8097]  Python Deepfake Detector
              ├── HuggingFace ViT-L model (primary)
              ├── DCT frequency domain analysis (fallback 1)
              └── MediaPipe landmark consistency (fallback 2)
```

---

## Feature Coverage Matrix

| Feature | Service | Status | Notes |
|---|---|---|---|
| **Passive liveness** (single image) | python-kyc-liveness | ✅ Implemented | EAR blink + depth + texture analysis |
| **Active liveness** (video/motion) | python-kyc-liveness | ✅ Implemented | Blink detection + head yaw/pitch tracking |
| **Face matching** (two images) | python-kyc-liveness | ✅ Implemented | DeepFace cosine similarity |
| **Face detection** | python-kyc-liveness | ✅ Implemented | MediaPipe + OpenCV cascade |
| **68-point facial landmarks** | python-kyc-liveness | ✅ Implemented | MediaPipe FaceMesh (468 pts, subset to 68) |
| **Face feature extraction** | python-kyc-liveness | ✅ Implemented | DeepFace embeddings (ArcFace/Facenet) |
| **Anti-spoofing classification** | python-kyc-liveness | ✅ Implemented | VLM prompt + depth + texture ensemble |
| **Confidence score** | python-kyc-liveness | ✅ Implemented | 0–1 float, stored in DB |
| **Database persistence** | python-kyc-liveness | ✅ Implemented | `kyc_liveness_results` table |
| **Event publishing** | python-kyc-liveness | ✅ Implemented | Kafka `kyc.liveness.events` topic |
| **API service** | python-kyc-liveness | ✅ Implemented | FastAPI REST + `/health` + `/metrics` |
| **Fail-closed proxy** | rust-liveness-proxy | ✅ Implemented | Circuit breaker; outage → KYC blocked |
| **Deepfake detection** | python-deepfake | ✅ Implemented | ViT-L + DCT + landmark fallbacks |

### Spoofing Attack Types Detected

| Attack Type | Detection Method | Service |
|---|---|---|
| **Printed photo** | Texture analysis (LBP), depth flatness, VLM classification | python-kyc-liveness |
| **Screen replay** | Moiré pattern detection, display reflection artifacts | python-kyc-liveness |
| **Paper mask** | 3D depth inconsistency, edge rigidity analysis | python-kyc-liveness |
| **3D mask** | Depth map anomalies, skin texture irregularities | python-kyc-liveness |
| **Deepfake (GAN/diffusion)** | HuggingFace ViT-L classifier (primary) | python-deepfake |
| **Deepfake (frequency)** | DCT checkerboard artifact detection | python-deepfake |
| **Deepfake (landmark)** | MediaPipe landmark geometry consistency | python-deepfake |
| **High-quality photo** | Active liveness challenge (blink + head movement) | python-kyc-liveness |

---

## Service Details

### 1. Python KYC Liveness Service (Port 8090)

**Language:** Python 3.11  
**Framework:** FastAPI  
**Key Libraries:** OpenCV, MediaPipe, DeepFace, NumPy, Pillow

**Endpoints:**

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check with model status |
| `/check` | POST | Full liveness check (passive + anti-spoof) |
| `/check/active` | POST | Active liveness from video blob |
| `/match` | POST | Face matching between two images |
| `/landmarks` | POST | Extract 68-point facial landmarks |
| `/features` | POST | Extract face embedding vector |
| `/metrics` | GET | Prometheus-format metrics |

**Configuration (environment variables):**

```bash
LIVENESS_CONFIDENCE_THRESHOLD=0.65   # Minimum score to pass
FACE_MATCH_THRESHOLD=0.75            # Cosine similarity threshold
ENABLE_ACTIVE_LIVENESS=true
ACTIVE_LIVENESS_BLINK_THRESHOLD=0.25 # EAR threshold for blink detection
ACTIVE_LIVENESS_HEAD_MOVEMENT_DEG=15 # Minimum head rotation in degrees
KAFKA_BOOTSTRAP_SERVERS=kafka:9092   # Leave empty to disable event publishing
DATABASE_URL=mysql://...             # Leave empty to disable DB persistence
RATE_LIMIT_RPM=60
```

---

### 2. Rust Liveness Proxy (Port 8096)

**Language:** Rust 1.78  
**Framework:** Axum  
**Key Crates:** reqwest, tokio, tower-http

**Purpose:** Acts as a fail-closed circuit-breaker proxy in front of the Python liveness service. Ensures that:
- If the Python service is down, KYC is **blocked** (not silently approved)
- Per-user rate limiting is enforced at the network layer
- Slow upstream responses are cut off at `UPSTREAM_TIMEOUT_MS`

**Circuit Breaker States:**

```
CLOSED (normal) ──[N failures]──→ OPEN (blocking)
                                       │
                              [timeout elapsed]
                                       ▼
                              HALF-OPEN (testing)
                                  │         │
                              [success]  [failure]
                                  │         │
                               CLOSED    OPEN
```

**Fail-closed response** (when circuit is OPEN):
```json
{
  "passed": false,
  "confidence": 0.0,
  "livenessScore": 0.0,
  "spoofingDetected": false,
  "serviceUnavailable": true,
  "error": "liveness_service_circuit_open"
}
```

**Configuration:**

```bash
PORT=8096
UPSTREAM_URL=http://python-kyc-liveness:8090
CIRCUIT_BREAKER_THRESHOLD=3     # Failures before opening circuit
CIRCUIT_BREAKER_TIMEOUT_SEC=30  # Seconds before attempting half-open
RATE_LIMIT_RPM=20               # Per user_id
UPSTREAM_TIMEOUT_MS=8000
FAIL_CLOSED=true
```

---

### 3. Python Deepfake Detector (Port 8097)

**Language:** Python 3.11  
**Framework:** FastAPI  
**Key Libraries:** transformers (HuggingFace), torch, OpenCV, MediaPipe, NumPy

**Detection Pipeline (waterfall):**

```
Input image
    │
    ├─[1]─ HuggingFace ViT-L model (Wvolf/ViT-L_Deepfake_Detection)
    │       ↓ if unavailable (model not loaded / OOM)
    ├─[2]─ DCT Frequency Domain Analysis
    │       ↓ if unavailable (OpenCV error)
    └─[3]─ MediaPipe Landmark Consistency
            ↓ if all fail
           FAIL-CLOSED (is_deepfake=true)
```

**Endpoints:**

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check with model load status |
| `/check` | POST | Single image deepfake check |
| `/batch` | POST | Batch check (max 8 images) |
| `/metrics` | GET | Prometheus-format metrics |

**Configuration:**

```bash
PORT=8097
HF_DEEPFAKE_MODEL_ID=Wvolf/ViT-L_Deepfake_Detection
DEEPFAKE_CONFIDENCE_THRESHOLD=0.55
ENABLE_FREQUENCY_FALLBACK=true
ENABLE_LANDMARK_FALLBACK=true
USE_GPU=false    # Set to true if CUDA is available
RATE_LIMIT_RPM=20
MAX_BATCH_SIZE=8
```

---

## Frontend: Active Liveness Capture

The `LivenessCapture` React component (`client/src/components/LivenessCapture.tsx`) replaces the static file upload for the selfie KYC step.

**Flow:**
1. User clicks "Open Camera" → `getUserMedia({ video: true })`
2. Face guide overlay shown (oval outline)
3. 3-second countdown
4. 4-second recording via `MediaRecorder` (WebM/VP9)
5. Still JPEG extracted from canvas at recording end
6. Both still + video uploaded to S3 via tRPC
7. Still frame sent to liveness service for passive analysis
8. Video blob stored for active liveness analysis

**Supported browsers:** Chrome 74+, Firefox 66+, Edge 79+, Safari 14.1+  
**Not supported:** Safari Private Browsing (blocks `getUserMedia`)

---

## Deployment

### Quick Start (Docker Compose)

```bash
# Start all liveness services
docker compose -f docker-compose.liveness.yml up -d

# Check health
curl http://localhost:8096/health   # Rust proxy
curl http://localhost:8090/health   # Python liveness
curl http://localhost:8097/health   # Deepfake detector

# View logs
docker compose -f docker-compose.liveness.yml logs -f

# Stop
docker compose -f docker-compose.liveness.yml down
```

### Environment Variables for Node.js Server

Add to your `.env` (or inject via secrets manager):

```bash
RUST_LIVENESS_PROXY_URL=http://rust-liveness-proxy:8096
PYTHON_KYC_LIVENESS_URL=http://python-kyc-liveness:8090
PYTHON_DEEPFAKE_URL=http://python-deepfake:8097
```

### Production Checklist

- [ ] Set `LIVENESS_CONFIDENCE_THRESHOLD` ≥ 0.65 (lower = more permissive)
- [ ] Set `DEEPFAKE_CONFIDENCE_THRESHOLD` ≥ 0.55
- [ ] Configure `KAFKA_BOOTSTRAP_SERVERS` for event publishing
- [ ] Configure `DATABASE_URL` for liveness result persistence
- [ ] Enable GPU for deepfake detector (`USE_GPU=true`) if available
- [ ] Set `CIRCUIT_BREAKER_THRESHOLD=3` and `CIRCUIT_BREAKER_TIMEOUT_SEC=30`
- [ ] Configure Prometheus scraping on `/metrics` endpoints
- [ ] Set up alerting on `liveness_service_circuit_open` metric

---

## Security Notes

1. **Fail-closed everywhere:** Service outages block KYC, not approve it.
2. **No permissive fallback scores:** The old `passed: true, score: 0.88` fallback has been replaced with `passed: false, score: 0.0`.
3. **Rate limiting at two layers:** Rust proxy (network) + Python service (application).
4. **No client-side trust:** Liveness scores are computed server-side only; the frontend only captures and uploads media.
5. **Video is best-effort:** Video upload failure does not block passive liveness check, but active liveness cannot be performed without it.

---

## Test Coverage

| Service | Test File | Tests |
|---|---|---|
| python-deepfake-detector | `test_deepfake_detector.py` | 18 tests (all passing) |
| rust-liveness-proxy | `src/main.rs` (unit tests) | 4 tests (all passing) |
| Node.js serviceRegistry | `server/smoke-v96.test.ts` | Included in existing suite |
