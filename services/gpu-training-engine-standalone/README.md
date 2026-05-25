# GPU Training Engine

**Train on any GPU. Infer on any other. Remote or local.**

A standalone, platform-agnostic ML training and inference engine that works across all major GPU vendors. Train a model on NVIDIA, export to ONNX, and run inference on AMD, Intel, Huawei, Apple, or CPU — transparently.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     PWA Frontend (:4200)                     │
│  React + TypeScript + Tailwind + Zustand                    │
│  Role-based UI: Admin | ML Engineer | Data Scientist | Viewer│
│  5 Guided Workflows: Onboarding, Train, Infer, Cross-GPU,  │
│                       Remote Setup                           │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST API
┌──────────────────────────▼──────────────────────────────────┐
│                  Backend Server (:8120)                       │
│  FastAPI + JWT Auth + RBAC + Rate Limiting                   │
│                                                              │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐              │
│  │ Hardware   │ │ Universal  │ │ Inference  │              │
│  │ Detector   │ │ Trainer    │ │ Engine     │              │
│  │ (all GPUs) │ │ (PyTorch)  │ │ (ONNX RT)  │              │
│  └────────────┘ └─────┬──────┘ └──────▲─────┘              │
│                        │ ONNX export   │ load               │
│  ┌────────────┐ ┌──────▼───────────────┘                    │
│  │ Remote     │ │ Model Converter                           │
│  │ Node Mgr   │ │ (TensorRT/OpenVINO/CoreML/INT8)          │
│  └────────────┘ └───────────────────────────                │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼──────┐  ┌───────▼──────┐  ┌───────▼──────┐
│ PostgreSQL   │  │    Redis     │  │   Remote     │
│ (jobs,models │  │ (cache,queue │  │   GPU Nodes  │
│  users,audit)│  │  sessions)   │  │   (gRPC/HTTP)│
└──────────────┘  └──────────────┘  └──────────────┘
```

## Supported GPUs

| Vendor | Training Backend | Inference Provider |
|--------|------------------|--------------------|
| **NVIDIA** | CUDA + cuDNN + TF32 | TensorRT EP, CUDA EP |
| **AMD** | ROCm/HIP | ROCm EP, MIGraphX EP |
| **Intel** | XPU + IPEX | OpenVINO EP |
| **Huawei** | Ascend/CANN | CANN EP |
| **Apple** | MPS (Metal) | CoreML EP |
| **Windows** | — | DirectML EP |
| **CPU** | Always available | CPU EP + INT8 quantization |

## Quick Start

### Docker (recommended)

```bash
# Clone and start
git clone <repo-url> gpu-training-engine
cd gpu-training-engine
docker compose up -d

# Open the PWA
open http://localhost

# API docs
open http://localhost:8120/docs
```

Default login: `admin` / `admin`

### Local Development

```bash
# Prerequisites: Python 3.11+, Node 20+, PostgreSQL, Redis
./scripts/setup.sh
./scripts/start-dev.sh

# Frontend: http://localhost:4200
# Backend:  http://localhost:8120
```

### CLI

```bash
# Install CLI
pip install -r backend/requirements.txt
export PATH="$PATH:$(pwd)/cli"

# Detect hardware
gpu-engine devices

# Train a fraud detection model on best GPU
gpu-engine train fraud_detection --epochs 50

# Infer on a different device
gpu-engine infer fraud_detection -i "0.5,0.3,0.1,..." -d amd

# Cross-GPU workflow
gpu-engine workflow fraud_detection --train-device nvidia --infer-device intel

# Benchmark
gpu-engine benchmark fraud_detection --iterations 200

# Export to TensorRT
gpu-engine export fraud_detection tensorrt
```

## API Reference

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Create account (returns JWT) |
| POST | `/auth/login` | Login (returns JWT) |
| POST | `/auth/logout` | Invalidate session |
| GET | `/auth/me` | Current user info |

### Training

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/train` | Train a model (auto-detects best GPU) |
| GET | `/jobs` | List training jobs |
| GET | `/jobs/{id}` | Job details |

### Inference

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/inference` | Run inference (any GPU vendor) |
| POST | `/benchmark` | Benchmark latency |

### Models

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/models` | List all models |
| POST | `/export` | Export to TensorRT/OpenVINO/CoreML/INT8 |
| GET | `/devices` | List detected GPUs |
| GET | `/providers` | List ONNX execution providers |

### Cross-GPU Workflow

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/workflow/train-and-deploy` | Train → ONNX → Deploy on different GPU |

### Remote Nodes

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/remote/nodes/register` | Register a remote GPU node |
| GET | `/remote/nodes` | List remote nodes |
| POST | `/remote/train` | Dispatch training to remote |
| POST | `/remote/infer` | Run inference on remote |
| POST | `/remote/transfer` | Transfer ONNX model to remote |

## RBAC Roles

| Permission | Admin | ML Engineer | Data Scientist | Viewer |
|------------|-------|-------------|----------------|--------|
| Train models | Y | Y | Y | — |
| Run inference | Y | Y | Y | — |
| Export models | Y | Y | — | — |
| Benchmark | Y | Y | Y | — |
| Manage nodes | Y | Y | — | — |
| Manage users | Y | — | — | — |
| Delete models | Y | Y | — | — |
| View audit log | Y | — | — | — |

## Model Types (built-in)

| Model | Architecture | Input | Output |
|-------|-------------|-------|--------|
| `fraud_detection` | 4-layer MLP (128d, BatchNorm, Dropout) | 11 features | 2 classes |
| `nlu_intent` | Transformer (128d, 4 heads, 2 layers) | 64 tokens | 12 intents |
| `fx_forecasting` | BiLSTM + Attention (128d, 2 layers) | 5 features | 1 value |
| `investment_scoring` | MLP (256d, LayerNorm, GELU) | 15 features | 5 risk classes |
| `gnn_fraud` | GAT-style MLP (64d, BatchNorm) | 32 node features | 2 classes |

Custom models can be trained by providing base64-encoded data via `custom_data` parameter.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://gpu_engine:...` | PostgreSQL connection |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection |
| `GPU_ENGINE_PORT` | `8120` | Backend port |
| `JWT_SECRET` | dev secret | JWT signing key |
| `CORS_ORIGINS` | `*` | Allowed CORS origins |
| `VITE_GPU_ENGINE_URL` | `http://localhost:8120` | Frontend API target |

## Directory Structure

```
gpu-training-engine/
├── backend/                 # Python FastAPI server
│   ├── server.py            # Main server (auth, DB, endpoints)
│   ├── hardware_detector.py # GPU detection (NVIDIA/AMD/Intel/Huawei/Apple)
│   ├── training_engine.py   # Universal PyTorch trainer
│   ├── inference_engine.py  # ONNX Runtime inference + converter
│   └── requirements.txt
├── frontend/                # React PWA
│   ├── src/App.tsx          # Main app (5 tabs + guided workflows)
│   ├── src/lib/api.ts       # HTTP client
│   ├── src/lib/store.ts     # Zustand state (auth, connection, workflow)
│   ├── src/types/index.ts   # TypeScript types
│   └── package.json
├── middleware/               # Shared middleware
│   ├── auth.py              # JWT + API key + RBAC
│   └── cache.py             # Redis cache + job queue + rate limiter
├── database/
│   └── schema.sql           # PostgreSQL schema (10 tables)
├── cli/
│   └── gpu-engine           # CLI tool
├── docker/
│   ├── Dockerfile.backend
│   ├── Dockerfile.frontend
│   └── nginx.conf
├── scripts/
│   ├── setup.sh
│   └── start-dev.sh
├── docker-compose.yml
├── .env.example
└── README.md
```

## License

MIT
