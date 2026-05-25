"""
RemitFlow — Cross-GPU Inference Engine (ONNX Runtime)

Runs inference on ANY GPU vendor — even different from training GPU.
Train on NVIDIA → inference on AMD, Intel, Huawei, Apple, or CPU.

Execution Providers (ranked by priority):
  1. TensorrtExecutionProvider   — NVIDIA TensorRT (fastest)
  2. CUDAExecutionProvider       — NVIDIA CUDA
  3. ROCMExecutionProvider       — AMD ROCm
  4. MIGraphXExecutionProvider   — AMD MIGraphX optimized
  5. DmlExecutionProvider        — DirectML (Windows, any GPU)
  6. OpenVINOExecutionProvider   — Intel OpenVINO
  7. CANNExecutionProvider       — Huawei Ascend CANN
  8. CoreMLExecutionProvider     — Apple CoreML
  9. ACLExecutionProvider        — ARM Compute Library
  10. CPUExecutionProvider       — CPU (always available)

Key features:
  - Auto-selects best available execution provider
  - Falls back gracefully through the priority chain
  - Supports batched inference
  - Thread-safe session management
  - Memory-mapped model loading for large models
  - Dynamic quantization for CPU inference speedup
"""

import json
import logging
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np

logger = logging.getLogger("inference-engine")


@dataclass
class InferenceResult:
    predictions: np.ndarray
    probabilities: Optional[np.ndarray] = None
    latency_ms: float = 0.0
    device_used: str = ""
    provider_used: str = ""
    model_name: str = ""
    batch_size: int = 0


# Priority-ordered list of ONNX Runtime execution providers
_PROVIDER_PRIORITY = [
    ("TensorrtExecutionProvider", "nvidia", "TensorRT"),
    ("CUDAExecutionProvider", "nvidia", "CUDA"),
    ("ROCMExecutionProvider", "amd", "ROCm"),
    ("MIGraphXExecutionProvider", "amd", "MIGraphX"),
    ("DmlExecutionProvider", "directml", "DirectML"),
    ("OpenVINOExecutionProvider", "intel", "OpenVINO"),
    ("CANNExecutionProvider", "huawei", "CANN"),
    ("CoreMLExecutionProvider", "apple", "CoreML"),
    ("ACLExecutionProvider", "arm", "ACL"),
    ("CPUExecutionProvider", "cpu", "CPU"),
]


class InferenceEngine:
    """
    Cross-GPU inference engine using ONNX Runtime.
    Loads ONNX model once, runs inference on any available hardware.
    """

    def __init__(self, preferred_provider: Optional[str] = None):
        self._sessions: Dict[str, Any] = {}  # model_name → ORT session
        self._session_lock = threading.Lock()
        self._preferred_provider = preferred_provider
        self._available_providers: List[Tuple[str, str, str]] = []
        self._detect_providers()

    def _detect_providers(self):
        """Detect which ONNX Runtime execution providers are available."""
        try:
            import onnxruntime as ort
            available = ort.get_available_providers()
            self._available_providers = [
                (name, vendor, label)
                for name, vendor, label in _PROVIDER_PRIORITY
                if name in available
            ]
            logger.info(f"ONNX Runtime providers: {[p[2] for p in self._available_providers]}")
        except ImportError:
            logger.warning("onnxruntime not installed — inference will be limited")
            self._available_providers = []

    def get_providers(self) -> List[Dict[str, str]]:
        """Return list of available inference providers with metadata."""
        return [
            {"provider": name, "vendor": vendor, "label": label}
            for name, vendor, label in self._available_providers
        ]

    def _select_providers(self, target_vendor: Optional[str] = None) -> List[str]:
        """Select execution providers, preferring target vendor."""
        providers = []

        # If a specific vendor is requested, try that first
        if target_vendor:
            for name, vendor, _ in self._available_providers:
                if vendor == target_vendor.lower():
                    providers.append(name)

        # If preferred provider specified at init
        if self._preferred_provider:
            for name, vendor, _ in self._available_providers:
                if vendor == self._preferred_provider.lower() and name not in providers:
                    providers.append(name)

        # Add all remaining in priority order
        for name, _, _ in self._available_providers:
            if name not in providers:
                providers.append(name)

        # CPU always available as ultimate fallback
        if "CPUExecutionProvider" not in providers:
            providers.append("CPUExecutionProvider")

        return providers

    def load_model(
        self,
        model_name: str,
        onnx_path: str,
        target_vendor: Optional[str] = None,
        enable_optimization: bool = True,
        inter_op_threads: int = 0,
        intra_op_threads: int = 0,
    ) -> Dict[str, Any]:
        """
        Load an ONNX model with the best available execution provider.

        Args:
            model_name: identifier for this model
            onnx_path: path to .onnx file
            target_vendor: preferred GPU vendor ("nvidia", "amd", "intel", "huawei", "cpu")
            enable_optimization: enable graph optimizations
            inter_op_threads: parallelism between ops (0 = auto)
            intra_op_threads: parallelism within ops (0 = auto)
        """
        import onnxruntime as ort

        if not Path(onnx_path).exists():
            raise FileNotFoundError(f"ONNX model not found: {onnx_path}")

        # Session options
        sess_options = ort.SessionOptions()
        if enable_optimization:
            sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        if inter_op_threads > 0:
            sess_options.inter_op_num_threads = inter_op_threads
        if intra_op_threads > 0:
            sess_options.intra_op_num_threads = intra_op_threads

        # Memory optimization for large models
        sess_options.enable_mem_pattern = True
        sess_options.enable_mem_reuse = True

        # Select providers
        providers = self._select_providers(target_vendor)
        logger.info(f"[{model_name}] Loading with providers: {providers}")

        # Provider-specific options
        provider_options = []
        for p in providers:
            if p == "CUDAExecutionProvider":
                provider_options.append({
                    "device_id": 0,
                    "arena_extend_strategy": "kSameAsRequested",
                    "cudnn_conv_algo_search": "DEFAULT",
                    "do_copy_in_default_stream": True,
                })
            elif p == "TensorrtExecutionProvider":
                provider_options.append({
                    "device_id": 0,
                    "trt_max_workspace_size": str(2 * 1024 * 1024 * 1024),
                    "trt_fp16_enable": True,
                })
            elif p == "OpenVINOExecutionProvider":
                provider_options.append({
                    "device_type": "GPU",
                    "precision": "FP16",
                })
            elif p == "CANNExecutionProvider":
                provider_options.append({
                    "device_id": 0,
                    "precision_mode": "allow_fp32_to_fp16",
                })
            else:
                provider_options.append({})

        # Create session
        session = ort.InferenceSession(
            onnx_path,
            sess_options=sess_options,
            providers=list(zip(providers, provider_options)),
        )

        # Detect which provider was actually used
        active_provider = session.get_providers()[0] if session.get_providers() else "CPUExecutionProvider"
        active_label = "CPU"
        for name, vendor, label in _PROVIDER_PRIORITY:
            if name == active_provider:
                active_label = label
                break

        with self._session_lock:
            self._sessions[model_name] = {
                "session": session,
                "provider": active_provider,
                "label": active_label,
                "onnx_path": onnx_path,
                "input_name": session.get_inputs()[0].name,
                "input_shape": session.get_inputs()[0].shape,
                "output_names": [o.name for o in session.get_outputs()],
                "loaded_at": time.time(),
            }

        file_size_mb = os.path.getsize(onnx_path) / (1024 * 1024)
        logger.info(
            f"[{model_name}] Loaded on {active_label} ({active_provider}), "
            f"model size: {file_size_mb:.1f} MB"
        )

        return {
            "model_name": model_name,
            "provider": active_provider,
            "label": active_label,
            "input_shape": str(session.get_inputs()[0].shape),
            "output_shape": str(session.get_outputs()[0].shape),
            "file_size_mb": round(file_size_mb, 1),
        }

    def predict(
        self,
        model_name: str,
        inputs: np.ndarray,
        return_probabilities: bool = True,
    ) -> InferenceResult:
        """
        Run inference on loaded ONNX model using the best available GPU/CPU.
        """
        with self._session_lock:
            if model_name not in self._sessions:
                raise ValueError(f"Model '{model_name}' not loaded. Call load_model() first.")
            sess_info = self._sessions[model_name]

        session = sess_info["session"]
        input_name = sess_info["input_name"]
        output_names = sess_info["output_names"]

        # Ensure correct dtype
        if inputs.dtype != np.float32:
            inputs = inputs.astype(np.float32)

        t0 = time.perf_counter()
        outputs = session.run(output_names, {input_name: inputs})
        latency_ms = (time.perf_counter() - t0) * 1000

        raw_output = outputs[0]

        # Determine predictions and probabilities
        probabilities = None
        if raw_output.ndim == 2 and raw_output.shape[1] > 1:
            # Classification: apply softmax to get probabilities
            exp_scores = np.exp(raw_output - np.max(raw_output, axis=1, keepdims=True))
            probabilities = exp_scores / np.sum(exp_scores, axis=1, keepdims=True)
            predictions = np.argmax(raw_output, axis=1)
        elif raw_output.ndim == 2 and raw_output.shape[1] == 1:
            # Binary / regression
            predictions = raw_output.squeeze(-1)
            probabilities = 1 / (1 + np.exp(-predictions))  # sigmoid
        else:
            predictions = raw_output

        return InferenceResult(
            predictions=predictions,
            probabilities=probabilities if return_probabilities else None,
            latency_ms=round(latency_ms, 3),
            device_used=sess_info["label"],
            provider_used=sess_info["provider"],
            model_name=model_name,
            batch_size=len(inputs),
        )

    def benchmark(
        self, model_name: str, input_shape: tuple,
        n_iterations: int = 100, batch_size: int = 1,
    ) -> Dict[str, Any]:
        """
        Benchmark inference latency for a loaded model.
        """
        dummy = np.random.randn(batch_size, *input_shape).astype(np.float32)

        # Warmup
        for _ in range(5):
            self.predict(model_name, dummy, return_probabilities=False)

        latencies = []
        for _ in range(n_iterations):
            result = self.predict(model_name, dummy, return_probabilities=False)
            latencies.append(result.latency_ms)

        latencies_np = np.array(latencies)
        return {
            "model_name": model_name,
            "provider": self._sessions[model_name]["provider"],
            "label": self._sessions[model_name]["label"],
            "batch_size": batch_size,
            "iterations": n_iterations,
            "latency_ms": {
                "mean": round(float(np.mean(latencies_np)), 3),
                "median": round(float(np.median(latencies_np)), 3),
                "p95": round(float(np.percentile(latencies_np, 95)), 3),
                "p99": round(float(np.percentile(latencies_np, 99)), 3),
                "min": round(float(np.min(latencies_np)), 3),
                "max": round(float(np.max(latencies_np)), 3),
            },
            "throughput_samples_per_sec": round(
                batch_size * 1000 / float(np.mean(latencies_np)), 1
            ),
        }

    def quantize_model(
        self,
        model_name: str,
        onnx_path: str,
        quantization_type: str = "dynamic",
    ) -> str:
        """
        Quantize ONNX model for faster CPU/edge inference.
        INT8 quantization can give 2-4x speedup on CPU.
        """
        from onnxruntime.quantization import quantize_dynamic, QuantType

        output_path = onnx_path.replace(".onnx", f"_quantized_{quantization_type}.onnx")

        quantize_dynamic(
            model_input=onnx_path,
            model_output=output_path,
            weight_type=QuantType.QInt8,
        )

        original_size = os.path.getsize(onnx_path) / (1024 * 1024)
        quantized_size = os.path.getsize(output_path) / (1024 * 1024)
        logger.info(
            f"[{model_name}] Quantized: {original_size:.1f}MB → {quantized_size:.1f}MB "
            f"({quantized_size/original_size*100:.0f}%)"
        )
        return output_path

    def get_loaded_models(self) -> Dict[str, Dict[str, Any]]:
        """Return info about all loaded models."""
        with self._session_lock:
            return {
                name: {
                    "provider": info["provider"],
                    "label": info["label"],
                    "onnx_path": info["onnx_path"],
                    "input_shape": str(info["input_shape"]),
                    "loaded_at": info["loaded_at"],
                }
                for name, info in self._sessions.items()
            }

    def unload_model(self, model_name: str) -> bool:
        """Unload a model to free GPU/CPU memory."""
        with self._session_lock:
            if model_name in self._sessions:
                del self._sessions[model_name]
                logger.info(f"[{model_name}] Unloaded")
                return True
        return False


class ModelConverter:
    """
    Converts models between formats for cross-device portability.
    PyTorch ↔ ONNX ↔ TensorRT ↔ OpenVINO ↔ CoreML ↔ CANN
    """

    @staticmethod
    def pytorch_to_onnx(
        model: Any,
        input_shape: tuple,
        output_path: str,
        opset_version: int = 17,
        dynamic_axes: Optional[Dict] = None,
    ) -> str:
        """Export PyTorch model to ONNX."""
        import torch
        model.eval()
        model.cpu()
        dummy = torch.randn(1, *input_shape)

        if dynamic_axes is None:
            dynamic_axes = {"input": {0: "batch_size"}, "output": {0: "batch_size"}}

        torch.onnx.export(
            model, dummy, output_path,
            export_params=True,
            opset_version=opset_version,
            do_constant_folding=True,
            input_names=["input"],
            output_names=["output"],
            dynamic_axes=dynamic_axes,
        )

        import onnx
        onnx.checker.check_model(onnx.load(output_path))
        logger.info(f"Exported to ONNX: {output_path}")
        return output_path

    @staticmethod
    def onnx_to_openvino(onnx_path: str, output_dir: str) -> Optional[str]:
        """Convert ONNX to Intel OpenVINO IR format."""
        try:
            from openvino.tools import mo
            ov_model = mo.convert_model(onnx_path)
            output_path = os.path.join(output_dir, Path(onnx_path).stem + ".xml")
            from openvino.runtime import serialize
            serialize(ov_model, output_path)
            logger.info(f"Exported to OpenVINO: {output_path}")
            return output_path
        except ImportError:
            logger.warning("OpenVINO not installed — skipping conversion")
            return None

    @staticmethod
    def onnx_to_tensorrt(onnx_path: str, output_path: str, fp16: bool = True) -> Optional[str]:
        """Convert ONNX to NVIDIA TensorRT engine."""
        try:
            import tensorrt as trt
            TRT_LOGGER = trt.Logger(trt.Logger.WARNING)
            builder = trt.Builder(TRT_LOGGER)
            network = builder.create_network(1 << int(trt.NetworkDefinitionCreationFlag.EXPLICIT_BATCH))
            parser = trt.OnnxParser(network, TRT_LOGGER)

            with open(onnx_path, "rb") as f:
                if not parser.parse(f.read()):
                    for i in range(parser.num_errors):
                        logger.error(f"TensorRT parse error: {parser.get_error(i)}")
                    return None

            config = builder.create_builder_config()
            config.set_memory_pool_limit(trt.MemoryPoolType.WORKSPACE, 2 << 30)
            if fp16 and builder.platform_has_fast_fp16:
                config.set_flag(trt.BuilderFlag.FP16)

            engine = builder.build_serialized_network(network, config)
            if engine:
                with open(output_path, "wb") as f:
                    f.write(engine)
                logger.info(f"Exported to TensorRT: {output_path}")
                return output_path
            return None
        except ImportError:
            logger.warning("TensorRT not installed — skipping conversion")
            return None

    @staticmethod
    def onnx_to_coreml(onnx_path: str, output_path: str) -> Optional[str]:
        """Convert ONNX to Apple CoreML."""
        try:
            import coremltools as ct
            import onnx
            onnx_model = onnx.load(onnx_path)
            ml_model = ct.converters.onnx.convert(model=onnx_model)
            ml_model.save(output_path)
            logger.info(f"Exported to CoreML: {output_path}")
            return output_path
        except ImportError:
            logger.warning("coremltools not installed — skipping conversion")
            return None
