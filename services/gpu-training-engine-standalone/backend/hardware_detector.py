"""
RemitFlow — GPU-Agnostic Hardware Detection

Detects all available compute devices across GPU vendors:
  - NVIDIA (CUDA / cuDNN / TensorRT)
  - AMD (ROCm / HIP / MIGraphX)
  - Intel (oneAPI / XPU / OpenVINO)
  - Huawei (Ascend / CANN)
  - Apple (Metal / MPS)
  - Qualcomm (Adreno / QNN)
  - CPU (always available)

Returns a ranked list of devices ordered by compute capability.
"""

import logging
import os
import platform
import subprocess
import shutil
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional

logger = logging.getLogger("hardware-detector")


class GPUVendor(str, Enum):
    NVIDIA = "nvidia"
    AMD = "amd"
    INTEL = "intel"
    HUAWEI = "huawei"
    APPLE = "apple"
    QUALCOMM = "qualcomm"
    CPU = "cpu"


class BackendType(str, Enum):
    CUDA = "cuda"              # NVIDIA
    ROCM = "rocm"              # AMD ROCm/HIP
    XPU = "xpu"                # Intel oneAPI
    ASCEND = "ascend"          # Huawei Ascend/CANN
    MPS = "mps"                # Apple Metal
    DIRECTML = "directml"      # Windows DirectML (vendor-agnostic)
    VULKAN = "vulkan"          # Vulkan compute (cross-vendor)
    OPENCL = "opencl"          # OpenCL (cross-vendor)
    CPU = "cpu"                # Always available


@dataclass
class DeviceInfo:
    vendor: GPUVendor
    backend: BackendType
    device_name: str
    device_index: int = 0
    memory_total_mb: int = 0
    memory_free_mb: int = 0
    compute_capability: str = ""
    driver_version: str = ""
    is_available: bool = True
    priority: int = 0  # lower = higher priority

    def to_dict(self) -> Dict:
        return {
            "vendor": self.vendor.value,
            "backend": self.backend.value,
            "device_name": self.device_name,
            "device_index": self.device_index,
            "memory_total_mb": self.memory_total_mb,
            "memory_free_mb": self.memory_free_mb,
            "compute_capability": self.compute_capability,
            "driver_version": self.driver_version,
            "is_available": self.is_available,
            "priority": self.priority,
        }


def _run_cmd(cmd: List[str], timeout: int = 5) -> Optional[str]:
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return result.stdout.strip() if result.returncode == 0 else None
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None


def detect_nvidia() -> List[DeviceInfo]:
    """Detect NVIDIA GPUs via PyTorch CUDA or nvidia-smi."""
    devices = []

    # Method 1: PyTorch CUDA
    try:
        import torch
        if torch.cuda.is_available():
            for i in range(torch.cuda.device_count()):
                props = torch.cuda.get_device_properties(i)
                mem_total = props.total_mem // (1024 * 1024)
                mem_free = mem_total  # Approximate
                try:
                    mem_free = (torch.cuda.mem_get_info(i)[0]) // (1024 * 1024)
                except Exception:
                    pass

                devices.append(DeviceInfo(
                    vendor=GPUVendor.NVIDIA,
                    backend=BackendType.CUDA,
                    device_name=props.name,
                    device_index=i,
                    memory_total_mb=mem_total,
                    memory_free_mb=mem_free,
                    compute_capability=f"{props.major}.{props.minor}",
                    driver_version=torch.version.cuda or "",
                    is_available=True,
                    priority=10 + i,
                ))
            if devices:
                return devices
    except ImportError:
        pass

    # Method 2: nvidia-smi
    output = _run_cmd(["nvidia-smi", "--query-gpu=name,memory.total,memory.free,driver_version", "--format=csv,noheader,nounits"])
    if output:
        for i, line in enumerate(output.strip().split("\n")):
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 4:
                devices.append(DeviceInfo(
                    vendor=GPUVendor.NVIDIA,
                    backend=BackendType.CUDA,
                    device_name=parts[0],
                    device_index=i,
                    memory_total_mb=int(float(parts[1])),
                    memory_free_mb=int(float(parts[2])),
                    driver_version=parts[3],
                    is_available=True,
                    priority=10 + i,
                ))
    return devices


def detect_amd() -> List[DeviceInfo]:
    """Detect AMD GPUs via PyTorch ROCm or rocm-smi."""
    devices = []

    # Method 1: PyTorch ROCm (shows up as cuda in ROCm builds)
    try:
        import torch
        if hasattr(torch.version, 'hip') and torch.version.hip:
            for i in range(torch.cuda.device_count()):
                props = torch.cuda.get_device_properties(i)
                devices.append(DeviceInfo(
                    vendor=GPUVendor.AMD,
                    backend=BackendType.ROCM,
                    device_name=props.name,
                    device_index=i,
                    memory_total_mb=props.total_mem // (1024 * 1024),
                    compute_capability=f"gfx{props.major}{props.minor}",
                    driver_version=torch.version.hip or "",
                    is_available=True,
                    priority=20 + i,
                ))
            if devices:
                return devices
    except ImportError:
        pass

    # Method 2: rocm-smi
    output = _run_cmd(["rocm-smi", "--showproductname", "--showmeminfo", "vram", "--csv"])
    if output:
        lines = output.strip().split("\n")
        for i, line in enumerate(lines[1:]):  # skip header
            parts = [p.strip() for p in line.split(",")]
            name = parts[0] if parts else f"AMD GPU {i}"
            devices.append(DeviceInfo(
                vendor=GPUVendor.AMD,
                backend=BackendType.ROCM,
                device_name=name,
                device_index=i,
                is_available=True,
                priority=20 + i,
            ))

    # Method 3: Check for AMD via lspci
    if not devices:
        output = _run_cmd(["lspci"])
        if output:
            for line in output.split("\n"):
                if "AMD" in line and ("VGA" in line or "Display" in line or "3D" in line):
                    devices.append(DeviceInfo(
                        vendor=GPUVendor.AMD,
                        backend=BackendType.ROCM,
                        device_name=line.split(":")[-1].strip()[:64],
                        device_index=len(devices),
                        is_available=shutil.which("rocm-smi") is not None,
                        priority=20 + len(devices),
                    ))
    return devices


def detect_intel() -> List[DeviceInfo]:
    """Detect Intel GPUs via PyTorch XPU or sycl-ls."""
    devices = []

    # Method 1: PyTorch XPU (Intel Extension for PyTorch)
    try:
        import torch
        if hasattr(torch, 'xpu') and torch.xpu.is_available():
            for i in range(torch.xpu.device_count()):
                name = torch.xpu.get_device_name(i)
                props = torch.xpu.get_device_properties(i)
                devices.append(DeviceInfo(
                    vendor=GPUVendor.INTEL,
                    backend=BackendType.XPU,
                    device_name=name,
                    device_index=i,
                    memory_total_mb=getattr(props, 'total_memory', 0) // (1024 * 1024),
                    is_available=True,
                    priority=30 + i,
                ))
            if devices:
                return devices
    except (ImportError, AttributeError):
        pass

    # Method 2: Intel GPU via sycl-ls
    output = _run_cmd(["sycl-ls"])
    if output:
        for i, line in enumerate(output.strip().split("\n")):
            if "Intel" in line and "GPU" in line:
                devices.append(DeviceInfo(
                    vendor=GPUVendor.INTEL,
                    backend=BackendType.XPU,
                    device_name=line.strip()[:64],
                    device_index=i,
                    is_available=True,
                    priority=30 + i,
                ))

    # Method 3: lspci fallback
    if not devices:
        output = _run_cmd(["lspci"])
        if output:
            for line in output.split("\n"):
                if "Intel" in line and ("VGA" in line or "Display" in line or "3D" in line):
                    devices.append(DeviceInfo(
                        vendor=GPUVendor.INTEL,
                        backend=BackendType.XPU,
                        device_name=line.split(":")[-1].strip()[:64],
                        device_index=len(devices),
                        is_available=False,
                        priority=30 + len(devices),
                    ))
    return devices


def detect_huawei() -> List[DeviceInfo]:
    """Detect Huawei Ascend NPUs via npu-smi or torch_npu."""
    devices = []

    # Method 1: torch_npu (Huawei's PyTorch extension)
    try:
        import torch
        import torch_npu  # noqa: F401
        if torch.npu.is_available():
            for i in range(torch.npu.device_count()):
                name = torch.npu.get_device_name(i)
                props = torch.npu.get_device_properties(i)
                devices.append(DeviceInfo(
                    vendor=GPUVendor.HUAWEI,
                    backend=BackendType.ASCEND,
                    device_name=name,
                    device_index=i,
                    memory_total_mb=getattr(props, 'total_memory', 0) // (1024 * 1024),
                    is_available=True,
                    priority=25 + i,
                ))
            if devices:
                return devices
    except (ImportError, AttributeError):
        pass

    # Method 2: npu-smi
    output = _run_cmd(["npu-smi", "info"])
    if output:
        for i, line in enumerate(output.strip().split("\n")):
            if "Ascend" in line or "NPU" in line:
                devices.append(DeviceInfo(
                    vendor=GPUVendor.HUAWEI,
                    backend=BackendType.ASCEND,
                    device_name=line.strip()[:64],
                    device_index=i,
                    is_available=True,
                    priority=25 + i,
                ))
    return devices


def detect_apple_mps() -> List[DeviceInfo]:
    """Detect Apple Metal Performance Shaders (M1/M2/M3)."""
    devices = []
    if platform.system() != "Darwin":
        return devices

    try:
        import torch
        if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
            # Get chip name
            chip_name = _run_cmd(["sysctl", "-n", "machdep.cpu.brand_string"]) or "Apple Silicon"
            devices.append(DeviceInfo(
                vendor=GPUVendor.APPLE,
                backend=BackendType.MPS,
                device_name=chip_name,
                device_index=0,
                is_available=True,
                priority=15,
            ))
    except (ImportError, AttributeError):
        pass
    return devices


def detect_cpu() -> DeviceInfo:
    """CPU is always available as fallback."""
    import multiprocessing
    cpu_name = platform.processor() or "Unknown CPU"

    # Try to get better CPU name
    if platform.system() == "Linux":
        try:
            with open("/proc/cpuinfo") as f:
                for line in f:
                    if "model name" in line:
                        cpu_name = line.split(":")[1].strip()
                        break
        except Exception:
            pass

    return DeviceInfo(
        vendor=GPUVendor.CPU,
        backend=BackendType.CPU,
        device_name=cpu_name,
        device_index=0,
        memory_total_mb=0,
        is_available=True,
        priority=100,  # lowest priority (fallback)
    )


def detect_all_devices() -> List[DeviceInfo]:
    """
    Detect all available compute devices across all vendors.
    Returns a sorted list (best device first).
    """
    devices = []

    logger.info("Scanning for GPU/NPU hardware...")

    # Scan all vendors
    nvidia = detect_nvidia()
    if nvidia:
        logger.info(f"  NVIDIA: {len(nvidia)} device(s) — {', '.join(d.device_name for d in nvidia)}")
        devices.extend(nvidia)

    amd = detect_amd()
    if amd:
        logger.info(f"  AMD: {len(amd)} device(s) — {', '.join(d.device_name for d in amd)}")
        devices.extend(amd)

    intel = detect_intel()
    if intel:
        logger.info(f"  Intel: {len(intel)} device(s) — {', '.join(d.device_name for d in intel)}")
        devices.extend(intel)

    huawei = detect_huawei()
    if huawei:
        logger.info(f"  Huawei: {len(huawei)} device(s) — {', '.join(d.device_name for d in huawei)}")
        devices.extend(huawei)

    apple = detect_apple_mps()
    if apple:
        logger.info(f"  Apple: {len(apple)} device(s) — {', '.join(d.device_name for d in apple)}")
        devices.extend(apple)

    # CPU always available
    cpu = detect_cpu()
    devices.append(cpu)
    logger.info(f"  CPU: {cpu.device_name}")

    # Sort by priority (lower = better)
    devices.sort(key=lambda d: d.priority)

    logger.info(f"Total devices: {len(devices)}, best: {devices[0].vendor.value}/{devices[0].device_name}")
    return devices


def get_best_device() -> DeviceInfo:
    """Return the best available compute device."""
    devices = detect_all_devices()
    available = [d for d in devices if d.is_available]
    return available[0] if available else detect_cpu()


def get_pytorch_device(device_info: DeviceInfo) -> str:
    """Convert DeviceInfo to a PyTorch device string."""
    backend_to_torch = {
        BackendType.CUDA: f"cuda:{device_info.device_index}",
        BackendType.ROCM: f"cuda:{device_info.device_index}",  # ROCm uses cuda API
        BackendType.XPU: f"xpu:{device_info.device_index}",
        BackendType.ASCEND: f"npu:{device_info.device_index}",
        BackendType.MPS: "mps",
        BackendType.CPU: "cpu",
    }
    return backend_to_torch.get(device_info.backend, "cpu")
