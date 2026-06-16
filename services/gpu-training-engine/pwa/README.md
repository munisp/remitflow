# GPU Training Engine — Standalone PWA

Platform-agnostic, role-based GPU training dashboard. Train on any GPU (NVIDIA, AMD, Intel, Huawei, Apple) — infer on any other.

## Features

- **Standalone** — No project dependencies. Works with any backend running the GPU Training Engine API.
- **Role-Based Access** — Admin, ML Engineer, Data Scientist, Viewer with scoped permissions.
- **Guided Workflows** — Step-by-step wizards for Training, Inference, Cross-GPU, Remote Setup, and Onboarding.
- **PWA** — Installable, offline-capable, works on desktop and mobile.
- **Platform-Agnostic** — Configurable API endpoint. Not tied to any specific project.

## Quick Start

```bash
npm install
npm run dev          # http://localhost:4200
```

Set `VITE_GPU_ENGINE_URL` to point to your GPU Training Engine backend:

```bash
VITE_GPU_ENGINE_URL=http://your-gpu-server:8120 npm run dev
```

## Docker

```bash
docker build -t gpu-engine-pwa .
docker run -p 4200:4200 gpu-engine-pwa
```

## Roles

| Role | Train | Infer | Export | Benchmark | Nodes | Users | Delete Models |
|------|-------|-------|--------|-----------|-------|-------|---------------|
| Admin | Y | Y | Y | Y | Y | Y | Y |
| ML Engineer | Y | Y | Y | Y | Y | N | Y |
| Data Scientist | Y | Y | N | Y | N | N | N |
| Viewer | N | N | N | N | N | N | N |

## Guided Workflows

1. **Onboarding** — New user tour (connect, scan, first train)
2. **Training** — Select model → configure → select GPU → train → review
3. **Inference** — Select model → select device → input data → run
4. **Cross-GPU** — Train on GPU A → export ONNX → infer on GPU B
5. **Remote Setup** — Add node → verify → dispatch job → transfer model

## Architecture

```
┌──────────────────┐     ┌──────────────────────┐
│  PWA (React/TS)  │────▶│  GPU Training Engine  │
│  Port 4200       │ API │  Port 8120 (Python)   │
│  Standalone app  │     │  PyTorch + ONNX       │
└──────────────────┘     └──────────────────────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
               NVIDIA/CUDA  AMD/ROCm   Intel/XPU
               Huawei/CANN  Apple/MPS  CPU
```
