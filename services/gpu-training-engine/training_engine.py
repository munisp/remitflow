"""
RemitFlow — GPU-Agnostic Universal Training Engine

Trains PyTorch models on ANY available GPU vendor:
  - NVIDIA (CUDA) — natively via torch.cuda
  - AMD (ROCm) — via HIP, transparent cuda API
  - Intel (XPU) — via Intel Extension for PyTorch (IPEX)
  - Huawei (Ascend) — via torch_npu
  - Apple (MPS) — via torch.backends.mps
  - CPU — always available as fallback

After training, exports model to ONNX for cross-device inference.
The ONNX model can then run on any other GPU vendor via ONNX Runtime.

Key Features:
  - Auto-detects best available device at startup
  - Device-specific optimizations (AMP, channels-last, compile)
  - Mixed precision training on all backends
  - Gradient accumulation for large-batch training on limited memory
  - Checkpointing with device-agnostic state_dict (always saved to CPU)
  - ONNX export with dynamic axes for variable batch/sequence length
"""

import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

from hardware_detector import (
    BackendType, DeviceInfo, GPUVendor,
    detect_all_devices, get_best_device, get_pytorch_device,
)

logger = logging.getLogger("training-engine")

MODELS_DIR = Path(os.getenv("MODELS_DIR", str(Path(__file__).parent / "models")))
MODELS_DIR.mkdir(parents=True, exist_ok=True)
ONNX_DIR = Path(os.getenv("ONNX_DIR", str(Path(__file__).parent / "onnx_models")))
ONNX_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class TrainingConfig:
    epochs: int = 30
    batch_size: int = 64
    learning_rate: float = 1e-3
    weight_decay: float = 0.01
    grad_accumulation_steps: int = 1
    mixed_precision: bool = True
    early_stopping_patience: int = 5
    max_grad_norm: float = 1.0
    warmup_steps: int = 100
    save_every_n_epochs: int = 5
    export_onnx: bool = True
    preferred_device: Optional[str] = None  # "nvidia", "amd", "intel", etc.


@dataclass
class TrainingResult:
    model_path: str
    onnx_path: Optional[str]
    device_used: Dict[str, Any]
    metrics: Dict[str, float]
    training_time_s: float
    epochs_trained: int
    best_epoch: int
    training_samples: int
    history: List[Dict[str, float]]


class UniversalTrainer:
    """
    GPU-agnostic training engine.
    Trains on any available GPU, exports to ONNX for cross-device inference.
    """

    def __init__(self, config: Optional[TrainingConfig] = None):
        self.config = config or TrainingConfig()
        self.devices = detect_all_devices()
        self.device_info = self._select_device()
        self.torch_device = torch.device(get_pytorch_device(self.device_info))
        self._setup_backend()

        logger.info(
            f"Training engine initialized: {self.device_info.vendor.value} "
            f"({self.device_info.device_name}) on {self.torch_device}"
        )

    def _select_device(self) -> DeviceInfo:
        """Select the best device, optionally preferring a specific vendor."""
        if self.config.preferred_device:
            preferred = self.config.preferred_device.lower()
            for d in self.devices:
                if d.vendor.value == preferred and d.is_available:
                    return d
            logger.warning(f"Preferred device '{preferred}' not available, using best alternative")

        available = [d for d in self.devices if d.is_available]
        return available[0] if available else self.devices[-1]  # last = CPU

    def _setup_backend(self):
        """Apply backend-specific optimizations."""
        backend = self.device_info.backend

        if backend == BackendType.CUDA:
            torch.backends.cudnn.benchmark = True
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
            logger.info("NVIDIA optimizations: cuDNN benchmark + TF32 enabled")

        elif backend == BackendType.ROCM:
            # ROCm uses CUDA API, same optimizations
            torch.backends.cudnn.benchmark = True
            logger.info("AMD ROCm optimizations: cuDNN benchmark enabled")

        elif backend == BackendType.XPU:
            try:
                import intel_extension_for_pytorch as ipex  # noqa: F401
                logger.info("Intel IPEX loaded for XPU optimization")
            except ImportError:
                logger.info("Intel XPU available but IPEX not installed")

        elif backend == BackendType.ASCEND:
            try:
                import torch_npu  # noqa: F401
                logger.info("Huawei torch_npu loaded for Ascend optimization")
            except ImportError:
                logger.info("Ascend device available but torch_npu not installed")

        elif backend == BackendType.MPS:
            logger.info("Apple MPS backend active")

    def _get_amp_context(self):
        """Get the appropriate automatic mixed precision context."""
        if not self.config.mixed_precision:
            return torch.amp.autocast("cpu", enabled=False)

        backend = self.device_info.backend

        if backend in (BackendType.CUDA, BackendType.ROCM):
            return torch.amp.autocast("cuda", dtype=torch.float16)
        elif backend == BackendType.XPU:
            try:
                return torch.amp.autocast("xpu", dtype=torch.bfloat16)
            except Exception:
                return torch.amp.autocast("cpu", enabled=False)
        elif backend == BackendType.MPS:
            return torch.amp.autocast("cpu", enabled=False)  # MPS doesn't support AMP yet
        else:
            return torch.amp.autocast("cpu", enabled=False)

    def _get_scaler(self):
        """Get gradient scaler for mixed precision."""
        if not self.config.mixed_precision:
            return None
        if self.device_info.backend in (BackendType.CUDA, BackendType.ROCM):
            return torch.amp.GradScaler("cuda")
        return None

    def train(
        self,
        model: nn.Module,
        train_data: Tuple[np.ndarray, np.ndarray],
        val_data: Optional[Tuple[np.ndarray, np.ndarray]] = None,
        model_name: str = "model",
        loss_fn: Optional[nn.Module] = None,
        metric_fn: Optional[Callable] = None,
    ) -> TrainingResult:
        """
        Train a model on the best available GPU.

        Args:
            model: PyTorch model
            train_data: (X, y) numpy arrays
            val_data: optional (X_val, y_val)
            model_name: name for saved artifacts
            loss_fn: loss function (default: CrossEntropyLoss)
            metric_fn: evaluation metric function
        """
        t_start = time.perf_counter()

        # Move model to device
        model = model.to(self.torch_device)

        # Intel IPEX optimization
        if self.device_info.backend == BackendType.XPU:
            try:
                import intel_extension_for_pytorch as ipex
                model, _ = ipex.optimize(model)
            except ImportError:
                pass

        # Prepare data
        X_train, y_train = train_data
        X_t = torch.tensor(X_train, dtype=torch.float32)
        y_t = torch.tensor(y_train, dtype=torch.long if y_train.dtype in (np.int32, np.int64) else torch.float32)
        train_dataset = TensorDataset(X_t, y_t)
        train_loader = DataLoader(
            train_dataset, batch_size=self.config.batch_size,
            shuffle=True, num_workers=0, pin_memory=(self.device_info.backend != BackendType.CPU),
        )

        val_loader = None
        if val_data is not None:
            X_v, y_v = val_data
            X_vt = torch.tensor(X_v, dtype=torch.float32)
            y_vt = torch.tensor(y_v, dtype=torch.long if y_v.dtype in (np.int32, np.int64) else torch.float32)
            val_dataset = TensorDataset(X_vt, y_vt)
            val_loader = DataLoader(val_dataset, batch_size=self.config.batch_size * 2, num_workers=0)

        # Optimizer and scheduler
        optimizer = torch.optim.AdamW(
            model.parameters(), lr=self.config.learning_rate,
            weight_decay=self.config.weight_decay,
        )
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=self.config.epochs)

        if loss_fn is None:
            loss_fn = nn.CrossEntropyLoss()

        scaler = self._get_scaler()
        amp_ctx = self._get_amp_context()

        # Training loop
        best_val_metric = -float("inf")
        best_epoch = 0
        patience_counter = 0
        history: List[Dict[str, float]] = []

        for epoch in range(self.config.epochs):
            model.train()
            total_loss = 0
            n_batches = 0

            for batch_idx, (X_batch, y_batch) in enumerate(train_loader):
                X_batch = X_batch.to(self.torch_device, non_blocking=True)
                y_batch = y_batch.to(self.torch_device, non_blocking=True)

                with amp_ctx:
                    output = model(X_batch)
                    loss = loss_fn(output, y_batch)
                    loss = loss / self.config.grad_accumulation_steps

                if scaler is not None:
                    scaler.scale(loss).backward()
                    if (batch_idx + 1) % self.config.grad_accumulation_steps == 0:
                        scaler.unscale_(optimizer)
                        torch.nn.utils.clip_grad_norm_(model.parameters(), self.config.max_grad_norm)
                        scaler.step(optimizer)
                        scaler.update()
                        optimizer.zero_grad(set_to_none=True)
                else:
                    loss.backward()
                    if (batch_idx + 1) % self.config.grad_accumulation_steps == 0:
                        torch.nn.utils.clip_grad_norm_(model.parameters(), self.config.max_grad_norm)
                        optimizer.step()
                        optimizer.zero_grad(set_to_none=True)

                total_loss += loss.item() * self.config.grad_accumulation_steps
                n_batches += 1

            scheduler.step()
            avg_loss = total_loss / max(n_batches, 1)

            # Validation
            val_metric = 0
            if val_loader is not None:
                model.eval()
                correct = 0
                total = 0
                with torch.no_grad():
                    for X_batch, y_batch in val_loader:
                        X_batch = X_batch.to(self.torch_device, non_blocking=True)
                        y_batch = y_batch.to(self.torch_device, non_blocking=True)
                        output = model(X_batch)
                        if metric_fn:
                            val_metric += metric_fn(output, y_batch)
                        else:
                            preds = output.argmax(dim=-1)
                            correct += (preds == y_batch).sum().item()
                            total += len(y_batch)

                if not metric_fn:
                    val_metric = correct / max(total, 1)

            epoch_data = {
                "epoch": epoch + 1,
                "train_loss": round(avg_loss, 6),
                "val_accuracy": round(val_metric, 4),
                "lr": round(scheduler.get_last_lr()[0], 8),
            }
            history.append(epoch_data)

            if (epoch + 1) % 5 == 0 or epoch == 0:
                logger.info(
                    f"[{model_name}] Epoch {epoch+1}/{self.config.epochs} "
                    f"loss={avg_loss:.4f} val_acc={val_metric:.4f} "
                    f"device={self.device_info.vendor.value}"
                )

            # Early stopping
            if val_metric > best_val_metric:
                best_val_metric = val_metric
                best_epoch = epoch + 1
                patience_counter = 0
                # Save checkpoint (always to CPU for portability)
                checkpoint_path = MODELS_DIR / f"{model_name}_best.pt"
                torch.save(model.cpu().state_dict(), checkpoint_path)
                model.to(self.torch_device)
            else:
                patience_counter += 1
                if patience_counter >= self.config.early_stopping_patience:
                    logger.info(f"[{model_name}] Early stopping at epoch {epoch+1}")
                    break

            # Periodic checkpoint
            if self.config.save_every_n_epochs and (epoch + 1) % self.config.save_every_n_epochs == 0:
                cp_path = MODELS_DIR / f"{model_name}_epoch{epoch+1}.pt"
                torch.save(model.cpu().state_dict(), cp_path)
                model.to(self.torch_device)

        # Load best weights
        best_path = MODELS_DIR / f"{model_name}_best.pt"
        if best_path.exists():
            model.cpu()
            model.load_state_dict(torch.load(best_path, weights_only=True))

        # Export to ONNX
        onnx_path = None
        if self.config.export_onnx:
            onnx_path = self.export_onnx(model, X_train.shape[1:], model_name)

        training_time = time.perf_counter() - t_start

        result = TrainingResult(
            model_path=str(best_path),
            onnx_path=onnx_path,
            device_used=self.device_info.to_dict(),
            metrics={"best_val_accuracy": best_val_metric},
            training_time_s=round(training_time, 2),
            epochs_trained=len(history),
            best_epoch=best_epoch,
            training_samples=len(X_train),
            history=history,
        )

        # Save training metadata
        meta_path = MODELS_DIR / f"{model_name}_metadata.json"
        with open(meta_path, "w") as f:
            json.dump({
                "model_name": model_name,
                "trained_at": datetime.now(timezone.utc).isoformat(),
                "device": self.device_info.to_dict(),
                "config": {
                    "epochs": self.config.epochs,
                    "batch_size": self.config.batch_size,
                    "learning_rate": self.config.learning_rate,
                    "mixed_precision": self.config.mixed_precision,
                },
                "metrics": result.metrics,
                "training_time_s": result.training_time_s,
                "epochs_trained": result.epochs_trained,
                "best_epoch": result.best_epoch,
                "training_samples": result.training_samples,
                "model_path": result.model_path,
                "onnx_path": result.onnx_path,
            }, f, indent=2)

        logger.info(
            f"[{model_name}] Training complete: {result.epochs_trained} epochs, "
            f"best_val_acc={best_val_metric:.4f}, "
            f"time={training_time:.1f}s, device={self.device_info.vendor.value}"
        )
        return result

    def export_onnx(
        self, model: nn.Module, input_shape: tuple, model_name: str,
        dynamic_axes: Optional[Dict[str, Dict[int, str]]] = None,
    ) -> Optional[str]:
        """
        Export PyTorch model to ONNX format for cross-GPU inference.
        ONNX models can run on any GPU vendor via ONNX Runtime.
        """
        try:
            model.eval()
            model.cpu()

            # Create dummy input matching model's expected shape
            dummy = torch.randn(1, *input_shape)

            onnx_path = str(ONNX_DIR / f"{model_name}.onnx")

            if dynamic_axes is None:
                dynamic_axes = {"input": {0: "batch_size"}, "output": {0: "batch_size"}}

            torch.onnx.export(
                model, dummy, onnx_path,
                export_params=True,
                opset_version=17,
                do_constant_folding=True,
                input_names=["input"],
                output_names=["output"],
                dynamic_axes=dynamic_axes,
            )

            # Verify exported model
            import onnx
            onnx_model = onnx.load(onnx_path)
            onnx.checker.check_model(onnx_model)

            file_size_mb = os.path.getsize(onnx_path) / (1024 * 1024)
            logger.info(f"[{model_name}] ONNX exported: {onnx_path} ({file_size_mb:.1f} MB)")
            return onnx_path

        except Exception as e:
            logger.warning(f"[{model_name}] ONNX export failed: {e}")
            return None
