#!/usr/bin/env python3
"""
RemitFlow GPU Training Engine — CLI

Command-line interface for GPU-agnostic model training, inference,
and remote node management.

Usage:
  gpu-engine devices                          List all detected GPUs
  gpu-engine train <model> [options]          Train a model on best GPU
  gpu-engine infer <model> --input <data>     Run inference
  gpu-engine workflow <model> [options]        Train-and-deploy workflow
  gpu-engine benchmark <model> [options]      Benchmark inference latency
  gpu-engine export <model> <format>          Export model to target format
  gpu-engine remote add <id> <host> [port]    Register remote GPU node
  gpu-engine remote list                      List remote nodes
  gpu-engine remote train <node> <model>      Train on remote GPU
  gpu-engine remote infer <node> <model>      Infer on remote GPU
  gpu-engine remote transfer <model> <node>   Transfer model to remote
  gpu-engine models                           List available models
  gpu-engine providers                        List inference providers
  gpu-engine jobs                             List training jobs
  gpu-engine health                           Check engine health
  gpu-engine serve [--port 8120]              Start the engine server

Examples:
  # Detect available GPUs
  gpu-engine devices

  # Train fraud detection on NVIDIA, export ONNX
  gpu-engine train fraud_detection --device nvidia --epochs 50

  # Train on NVIDIA, infer on AMD
  gpu-engine workflow fraud_detection --train-device nvidia --infer-device amd

  # Run inference on Intel GPU
  gpu-engine infer fraud_detection --input "0.5,0.3,0.1,0.8,0.2,0.6,0.4,0.7,0.1,0.9,0.3" --device intel

  # Benchmark latency
  gpu-engine benchmark fraud_detection --input-shape 11 --iterations 200

  # Export to TensorRT (NVIDIA optimized)
  gpu-engine export fraud_detection tensorrt

  # Quantize for fast CPU inference
  gpu-engine export fraud_detection quantized

  # Remote: register a GPU server, train there, pull model back
  gpu-engine remote add gpu-srv-1 10.0.1.50 8120 --gpu nvidia
  gpu-engine remote train gpu-srv-1 fraud_detection --epochs 100
  gpu-engine remote transfer fraud_detection gpu-srv-1

  # Start the engine HTTP server
  gpu-engine serve --port 8120
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Optional

# ─── Formatting ──────────────────────────────────────────────────────────────

BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
BLUE = "\033[34m"
PURPLE = "\033[35m"
CYAN = "\033[36m"
RESET = "\033[0m"

VENDOR_COLORS = {
    "nvidia": GREEN,
    "amd": RED,
    "intel": BLUE,
    "huawei": YELLOW,
    "apple": DIM,
    "cpu": CYAN,
}


def color(text: str, c: str) -> str:
    return f"{c}{text}{RESET}"


def header(text: str) -> str:
    return f"\n{BOLD}{PURPLE}{'─' * 60}{RESET}\n{BOLD}  {text}{RESET}\n{BOLD}{PURPLE}{'─' * 60}{RESET}"


def table_row(label: str, value: str, width: int = 20) -> str:
    return f"  {DIM}{label:<{width}}{RESET} {value}"


def status_icon(ok: bool) -> str:
    return color("●", GREEN) if ok else color("●", RED)


# ─── HTTP Client ─────────────────────────────────────────────────────────────

def api_call(path: str, method: str = "GET", body: Optional[dict] = None,
             base_url: Optional[str] = None, timeout: int = 300) -> dict:
    """Call the GPU Training Engine HTTP API."""
    import urllib.request
    import urllib.error

    url = (base_url or os.getenv("GPU_ENGINE_URL", "http://localhost:8120")) + path
    headers = {"Content-Type": "application/json"}

    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode() if e.fp else ""
        print(f"{RED}Error {e.code}: {error_body}{RESET}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"{RED}Connection failed: {e.reason}{RESET}", file=sys.stderr)
        print(f"{DIM}Is the GPU Training Engine running? Start with: gpu-engine serve{RESET}", file=sys.stderr)
        sys.exit(1)


# ─── Commands ────────────────────────────────────────────────────────────────

def cmd_devices(args: argparse.Namespace):
    """List all detected compute devices."""
    # Try local detection first (no server needed)
    try:
        sys.path.insert(0, str(Path(__file__).parent))
        from hardware_detector import detect_all_devices
        devices = detect_all_devices()

        print(header("GPU/NPU/CPU Hardware Inventory"))
        print()

        for i, d in enumerate(devices):
            vc = VENDOR_COLORS.get(d.vendor.value, "")
            avail = status_icon(d.is_available)
            print(f"  {avail} {color(d.vendor.value.upper(), vc):>12}  {BOLD}{d.device_name}{RESET}")
            print(table_row("Backend", d.backend.value))
            if d.memory_total_mb > 0:
                print(table_row("Memory", f"{d.memory_total_mb // 1024} GB ({d.memory_total_mb} MB)"))
            if d.compute_capability:
                print(table_row("Compute", d.compute_capability))
            if d.driver_version:
                print(table_row("Driver", d.driver_version))
            print(table_row("Priority", str(d.priority)))
            print()

        gpus = [d for d in devices if d.vendor.value != "cpu"]
        print(f"  {BOLD}Total:{RESET} {len(devices)} device(s), {len(gpus)} GPU(s)")
        print(f"  {BOLD}Best:{RESET}  {devices[0].vendor.value.upper()} — {devices[0].device_name}")
    except Exception:
        # Fall back to API
        data = api_call("/devices")
        print(header("GPU/NPU/CPU Hardware Inventory"))
        for d in data.get("devices", []):
            vc = VENDOR_COLORS.get(d["vendor"], "")
            print(f"  {status_icon(d['is_available'])} {color(d['vendor'].upper(), vc):>12}  {BOLD}{d['device_name']}{RESET}")
            print(table_row("Backend", d["backend"]))
            if d.get("memory_total_mb", 0) > 0:
                print(table_row("Memory", f"{d['memory_total_mb'] // 1024} GB"))
            print()


def cmd_train(args: argparse.Namespace):
    """Train a model on the best available GPU."""
    print(header(f"Training: {args.model}"))
    print(table_row("Preferred GPU", args.device or "auto-detect"))
    print(table_row("Epochs", str(args.epochs)))
    print(table_row("Batch Size", str(args.batch_size)))
    print(table_row("Learning Rate", str(args.lr)))
    print(table_row("Mixed Precision", "Yes" if args.mixed_precision else "No"))
    print(table_row("Data Source", args.data_source))
    print(table_row("Export ONNX", "Yes" if args.export_onnx else "No"))
    print()

    t0 = time.time()

    if args.local:
        # Direct local training (no server needed)
        sys.path.insert(0, str(Path(__file__).parent))
        from training_engine import TrainingConfig, UniversalTrainer
        from main import generate_synthetic_data, load_platform_data, _MODEL_REGISTRY
        import numpy as np
        import torch.nn as nn

        config = TrainingConfig(
            epochs=args.epochs,
            batch_size=args.batch_size,
            learning_rate=args.lr,
            mixed_precision=args.mixed_precision,
            export_onnx=args.export_onnx,
            preferred_device=args.device,
        )
        trainer = UniversalTrainer(config)

        print(f"  {CYAN}Loading data...{RESET}")
        if args.data_source == "platform_db":
            X, y, src = load_platform_data(args.model)
        else:
            X, y = generate_synthetic_data(args.model)
            src = "synthetic"

        split = int(len(X) * 0.8)
        idx = np.random.permutation(len(X))
        X, y = X[idx], y[idx]

        model_info = _MODEL_REGISTRY.get(args.model)
        if not model_info:
            print(f"{RED}Unknown model: {args.model}{RESET}")
            sys.exit(1)

        model = model_info["cls"]()
        loss_fn = nn.MSELoss() if args.model == "fx_forecasting" else nn.CrossEntropyLoss()

        print(f"  {CYAN}Training on {trainer.device_info.vendor.value.upper()} ({trainer.device_info.device_name})...{RESET}")

        result = trainer.train(
            model=model,
            train_data=(X[:split], y[:split]),
            val_data=(X[split:], y[split:]),
            model_name=args.model,
            loss_fn=loss_fn,
        )

        print()
        print(f"  {GREEN}Training complete!{RESET}")
        print(table_row("Device", f"{result.device_used['vendor'].upper()} ({result.device_used['device_name']})"))
        print(table_row("Data Source", src))
        print(table_row("Samples", str(result.training_samples)))
        print(table_row("Epochs", f"{result.epochs_trained} (best: {result.best_epoch})"))
        print(table_row("Best Accuracy", f"{result.metrics.get('best_val_accuracy', 0):.4f}"))
        print(table_row("Training Time", f"{result.training_time_s}s"))
        print(table_row("Model Path", result.model_path))
        if result.onnx_path:
            print(table_row("ONNX Path", result.onnx_path))
    else:
        # Train via API
        body = {
            "model_type": args.model,
            "preferred_device": args.device,
            "epochs": args.epochs,
            "batch_size": args.batch_size,
            "learning_rate": args.lr,
            "mixed_precision": args.mixed_precision,
            "export_onnx": args.export_onnx,
            "data_source": args.data_source,
        }
        print(f"  {CYAN}Sending to GPU Engine...{RESET}")
        result = api_call("/train", "POST", body)

        print()
        print(f"  {GREEN}Training complete!{RESET}")
        print(table_row("Job ID", result.get("job_id", "")))
        device = result.get("device", {})
        print(table_row("Device", f"{device.get('vendor', 'cpu').upper()} ({device.get('device_name', '')})"))
        print(table_row("Data Source", result.get("data_source", "")))
        print(table_row("Samples", str(result.get("training_samples", 0))))
        print(table_row("Epochs", f"{result.get('epochs_trained', 0)} (best: {result.get('best_epoch', 0)})"))
        metrics = result.get("metrics", {})
        print(table_row("Best Accuracy", f"{metrics.get('best_val_accuracy', 0):.4f}"))
        print(table_row("Training Time", f"{result.get('training_time_s', 0)}s"))
        if result.get("onnx_path"):
            print(table_row("ONNX Path", result["onnx_path"]))


def cmd_infer(args: argparse.Namespace):
    """Run inference on a model."""
    inputs = [[float(v.strip()) for v in args.input.split(",")]]

    print(header(f"Inference: {args.model}"))
    print(table_row("Target Device", args.device or "auto"))
    print(table_row("Input Shape", f"1 x {len(inputs[0])}"))
    print()

    result = api_call("/inference", "POST", {
        "model_name": args.model,
        "inputs": inputs,
        "target_device": args.device,
        "return_probabilities": True,
    })

    print(f"  {GREEN}Inference complete!{RESET}")
    print(table_row("Device", result.get("device_used", "")))
    print(table_row("Provider", result.get("provider_used", "")))
    print(table_row("Latency", f"{result.get('latency_ms', 0)} ms"))
    print(table_row("Predictions", json.dumps(result.get("predictions", []))))
    if result.get("probabilities"):
        probs = result["probabilities"]
        print(table_row("Probabilities", json.dumps([round(p, 4) for p in probs[0]] if probs else [])))


def cmd_workflow(args: argparse.Namespace):
    """Train on one GPU, deploy for inference on another."""
    print(header(f"Cross-GPU Workflow: {args.model}"))
    print(table_row("Train Device", args.train_device or "auto"))
    print(table_row("Infer Device", args.infer_device or "auto"))
    print(table_row("Epochs", str(args.epochs)))
    print()

    result = api_call("/workflow/train-and-deploy", "POST", {
        "model_type": args.model,
        "train_device": args.train_device,
        "infer_device": args.infer_device,
        "epochs": args.epochs,
        "batch_size": args.batch_size,
    })

    training = result.get("training", {})
    inference = result.get("inference", {})
    test_pred = result.get("test_prediction", {})

    print(f"  {GREEN}Workflow complete!{RESET}")
    print()
    print(f"  {BOLD}Training{RESET}")
    device = training.get("device", {})
    print(table_row("Device", f"{device.get('vendor', 'cpu').upper()} ({device.get('device_name', '')})"))
    print(table_row("Epochs", str(training.get("epochs_trained", 0))))
    print(table_row("Accuracy", f"{training.get('best_val_accuracy', 0):.4f}"))
    print(table_row("Time", f"{training.get('training_time_s', 0)}s"))
    print()
    print(f"  {BOLD}Inference{RESET}")
    print(table_row("Provider", inference.get("provider", "")))
    print(table_row("Label", inference.get("label", "")))
    if test_pred:
        print(table_row("Test Latency", f"{test_pred.get('latency_ms', 0)} ms"))
        print(table_row("Test Device", test_pred.get("inference_device", "")))


def cmd_benchmark(args: argparse.Namespace):
    """Benchmark inference latency."""
    input_shape = [int(v.strip()) for v in args.input_shape.split(",")]

    print(header(f"Benchmark: {args.model}"))
    print(table_row("Input Shape", str(input_shape)))
    print(table_row("Batch Size", str(args.batch_size)))
    print(table_row("Iterations", str(args.iterations)))
    print()

    result = api_call("/benchmark", "POST", {
        "model_name": args.model,
        "input_shape": input_shape,
        "batch_size": args.batch_size,
        "iterations": args.iterations,
    })

    latency = result.get("latency_ms", {})
    print(f"  {GREEN}Benchmark complete!{RESET}")
    print(table_row("Provider", result.get("provider", "")))
    print(table_row("Label", result.get("label", "")))
    print()
    print(f"  {BOLD}Latency (ms){RESET}")
    for k, v in latency.items():
        print(table_row(f"  {k}", f"{v} ms"))
    print()
    print(f"  {BOLD}Throughput:{RESET} {color(str(result.get('throughput_samples_per_sec', 0)), GREEN)} samples/sec")


def cmd_export(args: argparse.Namespace):
    """Export model to target format."""
    print(header(f"Export: {args.model} → {args.format}"))

    result = api_call("/export", "POST", {
        "model_name": args.model,
        "target_format": args.format,
    })

    print(f"  {GREEN}Export complete!{RESET}")
    print(table_row("Model", result.get("model_name", "")))
    print(table_row("Format", result.get("target_format", "")))
    print(table_row("Output", result.get("output_path", "")))
    print(table_row("Size", f"{result.get('size_mb', 0)} MB"))


def cmd_models(args: argparse.Namespace):
    """List available models."""
    result = api_call("/models")

    print(header("Available Models"))
    print()

    print(f"  {BOLD}Model Types:{RESET}")
    for mt in result.get("model_types", []):
        print(f"    • {mt}")

    loaded = result.get("loaded", {})
    if loaded:
        print(f"\n  {BOLD}Loaded (inference ready):{RESET}")
        for name, info in loaded.items():
            print(f"    {GREEN}●{RESET} {name} — {info.get('label', '')}")

    onnx = result.get("available_onnx", [])
    if onnx:
        print(f"\n  {BOLD}Available ONNX:{RESET}")
        for name in onnx:
            print(f"    • {name}.onnx")

    pt = result.get("available_pytorch", [])
    if pt:
        print(f"\n  {BOLD}Available PyTorch:{RESET}")
        for name in pt:
            print(f"    • {name}")


def cmd_providers(args: argparse.Namespace):
    """List ONNX Runtime execution providers."""
    result = api_call("/providers")
    providers = result.get("providers", [])

    print(header("Inference Execution Providers"))
    print()
    for p in providers:
        vc = VENDOR_COLORS.get(p.get("vendor", ""), "")
        print(f"  {color(p.get('vendor', '').upper(), vc):>12}  {p.get('label', '')}  {DIM}({p.get('provider', '')}){RESET}")


def cmd_jobs(args: argparse.Namespace):
    """List training jobs."""
    result = api_call("/jobs")
    jobs = result.get("jobs", {})

    print(header("Training Jobs"))
    if not jobs:
        print(f"  {DIM}No training jobs{RESET}")
        return

    for job_id, job in jobs.items():
        status = job.get("status", "unknown")
        sc = GREEN if status == "completed" else (YELLOW if status == "training" else RED)
        print(f"  {color('●', sc)} {job_id}  {BOLD}{job.get('model_type', '')}{RESET}  status={status}  samples={job.get('samples', '—')}")


def cmd_health(args: argparse.Namespace):
    """Check engine health."""
    result = api_call("/health")

    print(header("GPU Training Engine Health"))
    print(table_row("Status", color(result.get("status", "unknown"), GREEN)))
    print(table_row("Version", result.get("version", "")))
    print(table_row("Uptime", f"{result.get('uptime_s', 0):.0f}s"))
    devices = result.get("devices", {})
    print(table_row("Total Devices", str(devices.get("total", 0))))
    print(table_row("GPUs", str(devices.get("gpus", 0))))
    best = devices.get("best", {})
    if best:
        vc = VENDOR_COLORS.get(best.get("vendor", ""), "")
        print(table_row("Best Device", f"{color(best.get('vendor', '').upper(), vc)} — {best.get('device_name', '')}"))
    print(table_row("Models Loaded", str(result.get("models_loaded", 0))))
    print(table_row("Active Jobs", str(result.get("active_jobs", 0))))


def cmd_remote_add(args: argparse.Namespace):
    """Register a remote GPU node."""
    result = api_call("/remote/nodes/register", "POST", {
        "node_id": args.node_id,
        "host": args.host,
        "port": args.port,
        "gpu_vendor": args.gpu,
    })
    print(f"  {GREEN}●{RESET} Registered node: {BOLD}{args.node_id}{RESET} ({args.host}:{args.port})")


def cmd_remote_list(args: argparse.Namespace):
    """List remote nodes."""
    result = api_call("/remote/nodes")
    nodes = result.get("nodes", [])

    print(header("Remote GPU Nodes"))
    if not nodes:
        print(f"  {DIM}No remote nodes registered{RESET}")
        return

    for n in nodes:
        sc = GREEN if n.get("status") == "healthy" else (YELLOW if n.get("status") == "registered" else RED)
        vc = VENDOR_COLORS.get(n.get("gpu_vendor", ""), "")
        print(f"  {color('●', sc)} {BOLD}{n['node_id']}{RESET}  {n['host']}:{n['port']}  GPU={color(str(n.get('gpu_vendor', 'unknown')).upper(), vc)}  status={n.get('status', '')}")


def cmd_remote_train(args: argparse.Namespace):
    """Train on a remote GPU node."""
    print(header(f"Remote Training: {args.model} on {args.node_id}"))
    result = api_call("/remote/train", "POST", {
        "node_id": args.node_id,
        "model_type": args.model,
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "learning_rate": args.lr,
        "mixed_precision": True,
    })
    print(f"  {GREEN}Remote training dispatched!{RESET}")
    print(f"  {json.dumps(result, indent=2)}")


def cmd_remote_infer(args: argparse.Namespace):
    """Run inference on a remote node."""
    inputs = [[float(v.strip()) for v in args.input.split(",")]]
    result = api_call("/remote/infer", "POST", {
        "node_id": args.node_id,
        "model_name": args.model,
        "inputs": inputs,
        "return_probabilities": True,
    })
    print(f"  {GREEN}Remote inference complete!{RESET}")
    print(table_row("Predictions", json.dumps(result.get("predictions", []))))
    print(table_row("Latency", f"{result.get('latency_ms', 0)} ms"))


def cmd_remote_transfer(args: argparse.Namespace):
    """Transfer ONNX model to remote node."""
    result = api_call(f"/remote/transfer?model_name={args.model}&target_node_id={args.node_id}", "POST")
    print(f"  {GREEN}Model transferred!{RESET}")
    print(f"  {json.dumps(result, indent=2)}")


def cmd_serve(args: argparse.Namespace):
    """Start the GPU Training Engine HTTP server."""
    print(header("Starting GPU Training Engine"))
    print(table_row("Port", str(args.port)))
    print()

    os.environ["GPU_ENGINE_PORT"] = str(args.port)

    import uvicorn
    from main import app
    uvicorn.run(app, host="0.0.0.0", port=args.port, log_level="info")


# ─── Argument Parser ─────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="gpu-engine",
        description="RemitFlow GPU-Agnostic Training Engine CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--url", default=None, help="Engine URL (default: http://localhost:8120)")

    sub = parser.add_subparsers(dest="command", help="Command")

    # devices
    sub.add_parser("devices", help="List all detected GPU/NPU/CPU devices")

    # train
    p = sub.add_parser("train", help="Train a model on best available GPU")
    p.add_argument("model", choices=["fraud_detection", "nlu_intent", "fx_forecasting", "investment_scoring", "gnn_fraud"])
    p.add_argument("--device", "-d", default=None, help="Preferred GPU: nvidia, amd, intel, huawei, apple, cpu")
    p.add_argument("--epochs", "-e", type=int, default=30)
    p.add_argument("--batch-size", "-b", type=int, default=64)
    p.add_argument("--lr", type=float, default=0.001)
    p.add_argument("--mixed-precision", action="store_true", default=True)
    p.add_argument("--no-mixed-precision", dest="mixed_precision", action="store_false")
    p.add_argument("--export-onnx", action="store_true", default=True)
    p.add_argument("--no-export-onnx", dest="export_onnx", action="store_false")
    p.add_argument("--data-source", choices=["synthetic", "platform_db"], default="synthetic")
    p.add_argument("--local", action="store_true", help="Train locally (no server needed)")

    # infer
    p = sub.add_parser("infer", help="Run inference on a model")
    p.add_argument("model")
    p.add_argument("--input", "-i", required=True, help="Comma-separated input features")
    p.add_argument("--device", "-d", default=None, help="Target GPU vendor")

    # workflow
    p = sub.add_parser("workflow", help="Train on one GPU, infer on another")
    p.add_argument("model", choices=["fraud_detection", "nlu_intent", "fx_forecasting", "investment_scoring", "gnn_fraud"])
    p.add_argument("--train-device", default=None, help="GPU to train on")
    p.add_argument("--infer-device", default=None, help="GPU to infer on")
    p.add_argument("--epochs", "-e", type=int, default=30)
    p.add_argument("--batch-size", "-b", type=int, default=64)

    # benchmark
    p = sub.add_parser("benchmark", help="Benchmark inference latency")
    p.add_argument("model")
    p.add_argument("--input-shape", default="11", help="Comma-separated input dimensions")
    p.add_argument("--batch-size", "-b", type=int, default=1)
    p.add_argument("--iterations", "-n", type=int, default=100)

    # export
    p = sub.add_parser("export", help="Export model to target format")
    p.add_argument("model")
    p.add_argument("format", choices=["onnx", "tensorrt", "openvino", "coreml", "quantized"])

    # models
    sub.add_parser("models", help="List available models")

    # providers
    sub.add_parser("providers", help="List inference execution providers")

    # jobs
    sub.add_parser("jobs", help="List training jobs")

    # health
    sub.add_parser("health", help="Check engine health")

    # remote
    remote = sub.add_parser("remote", help="Remote GPU node management")
    rsub = remote.add_subparsers(dest="remote_cmd")

    p = rsub.add_parser("add", help="Register a remote GPU node")
    p.add_argument("node_id")
    p.add_argument("host")
    p.add_argument("port", type=int, nargs="?", default=8120)
    p.add_argument("--gpu", default=None, help="GPU vendor on remote")

    rsub.add_parser("list", help="List remote nodes")

    p = rsub.add_parser("train", help="Train on remote GPU")
    p.add_argument("node_id")
    p.add_argument("model")
    p.add_argument("--epochs", "-e", type=int, default=30)
    p.add_argument("--batch-size", "-b", type=int, default=64)
    p.add_argument("--lr", type=float, default=0.001)

    p = rsub.add_parser("infer", help="Infer on remote GPU")
    p.add_argument("node_id")
    p.add_argument("model")
    p.add_argument("--input", "-i", required=True)

    p = rsub.add_parser("transfer", help="Transfer model to remote")
    p.add_argument("model")
    p.add_argument("node_id")

    # serve
    p = sub.add_parser("serve", help="Start the engine HTTP server")
    p.add_argument("--port", "-p", type=int, default=8120)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    if args.url:
        os.environ["GPU_ENGINE_URL"] = args.url

    cmd_map = {
        "devices": cmd_devices,
        "train": cmd_train,
        "infer": cmd_infer,
        "workflow": cmd_workflow,
        "benchmark": cmd_benchmark,
        "export": cmd_export,
        "models": cmd_models,
        "providers": cmd_providers,
        "jobs": cmd_jobs,
        "health": cmd_health,
        "serve": cmd_serve,
    }

    if args.command == "remote":
        remote_map = {
            "add": cmd_remote_add,
            "list": cmd_remote_list,
            "train": cmd_remote_train,
            "infer": cmd_remote_infer,
            "transfer": cmd_remote_transfer,
        }
        if args.remote_cmd in remote_map:
            remote_map[args.remote_cmd](args)
        else:
            parser.parse_args(["remote", "--help"])
    elif args.command in cmd_map:
        cmd_map[args.command](args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
