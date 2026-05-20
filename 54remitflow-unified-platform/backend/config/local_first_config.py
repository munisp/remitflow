"""
Local-First Architecture Configuration
Makes local deployment the default and preferred option for all services
"""

import os
from typing import Dict, Optional
from enum import Enum
from pydantic import BaseModel
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class DeploymentMode(str, Enum):
    LOCAL = "local"
    CLOUD = "cloud"
    HYBRID = "hybrid"

class LocalFirstConfig(BaseModel):
    """Configuration for local-first architecture"""
    
    # Deployment mode (default: LOCAL)
    deployment_mode: DeploymentMode = DeploymentMode.LOCAL
    
    # DeepSeek OCR configuration
    deepseek_local: bool = True
    deepseek_model_dir: str = "/opt/models/deepseek"
    deepseek_model_name: str = "deepseek-ai/deepseek-vl-7b-chat"
    deepseek_device: str = "cuda"  # cuda or cpu
    deepseek_port: int = 8045
    
    # Biometric verification configuration
    biometric_local: bool = True
    biometric_use_face_recognition: bool = True
    biometric_use_deepface: bool = True
    biometric_port: int = 8046
    
    # NIMC integration configuration
    nimc_local: bool = True
    nimc_sandbox: bool = True  # Use sandbox until production credentials
    nimc_port: int = 8047
    
    # CAC integration configuration
    cac_local: bool = True
    cac_sandbox: bool = True  # Use sandbox until production credentials
    cac_port: int = 8048
    
    # Docling configuration
    docling_local: bool = True
    docling_port: int = 8049
    
    # Fallback configuration
    enable_cloud_fallback: bool = False
    fallback_timeout: int = 5  # seconds
    
    # Performance configuration
    enable_caching: bool = True
    cache_ttl: int = 3600  # seconds
    enable_batch_processing: bool = True
    batch_size: int = 10
    
    # Security configuration
    require_local_processing: bool = True  # Reject cloud processing
    data_residency_compliance: bool = True
    
    class Config:
        env_prefix = "LOCAL_FIRST_"

class ServiceRegistry:
    """Registry of local services"""
    
    def __init__(self, config: LocalFirstConfig):
        self.config = config
        self.services = self._build_service_registry()
    
    def _build_service_registry(self) -> Dict[str, Dict]:
        """Build registry of all local services"""
        
        services = {}
        
        # DeepSeek OCR Service
        if self.config.deepseek_local:
            services["deepseek_ocr"] = {
                "name": "DeepSeek OCR",
                "url": f"http://localhost:{self.config.deepseek_port}",
                "health_endpoint": f"http://localhost:{self.config.deepseek_port}/health",
                "deployment": "local",
                "priority": 1
            }
        
        # Biometric Verification Service
        if self.config.biometric_local:
            services["biometric"] = {
                "name": "Biometric Verification",
                "url": f"http://localhost:{self.config.biometric_port}",
                "health_endpoint": f"http://localhost:{self.config.biometric_port}/health",
                "deployment": "local",
                "priority": 1
            }
        
        # NIMC Integration Service
        if self.config.nimc_local:
            services["nimc"] = {
                "name": "NIMC Integration",
                "url": f"http://localhost:{self.config.nimc_port}",
                "health_endpoint": f"http://localhost:{self.config.nimc_port}/health",
                "deployment": "local",
                "priority": 1
            }
        
        # CAC Integration Service
        if self.config.cac_local:
            services["cac"] = {
                "name": "CAC Integration",
                "url": f"http://localhost:{self.config.cac_port}",
                "health_endpoint": f"http://localhost:{self.config.cac_port}/health",
                "deployment": "local",
                "priority": 1
            }
        
        # Docling Service
        if self.config.docling_local:
            services["docling"] = {
                "name": "Docling Document Processing",
                "url": f"http://localhost:{self.config.docling_port}",
                "health_endpoint": f"http://localhost:{self.config.docling_port}/health",
                "deployment": "local",
                "priority": 1
            }
        
        return services
    
    def get_service_url(self, service_name: str) -> Optional[str]:
        """Get service URL"""
        service = self.services.get(service_name)
        return service["url"] if service else None
    
    def is_service_local(self, service_name: str) -> bool:
        """Check if service is deployed locally"""
        service = self.services.get(service_name)
        return service["deployment"] == "local" if service else False
    
    def get_all_services(self) -> Dict[str, Dict]:
        """Get all registered services"""
        return self.services

# Default configuration (local-first)
DEFAULT_CONFIG = LocalFirstConfig(
    deployment_mode=DeploymentMode.LOCAL,
    deepseek_local=True,
    biometric_local=True,
    nimc_local=True,
    cac_local=True,
    docling_local=True,
    enable_cloud_fallback=False,
    require_local_processing=True
)

# Environment variables override
def load_config_from_env() -> LocalFirstConfig:
    """Load configuration from environment variables"""
    
    config = LocalFirstConfig(
        deployment_mode=os.getenv("LOCAL_FIRST_DEPLOYMENT_MODE", "local"),
        deepseek_local=os.getenv("LOCAL_FIRST_DEEPSEEK_LOCAL", "true").lower() == "true",
        deepseek_model_dir=os.getenv("LOCAL_FIRST_DEEPSEEK_MODEL_DIR", "/opt/models/deepseek"),
        deepseek_device=os.getenv("LOCAL_FIRST_DEEPSEEK_DEVICE", "cuda"),
        biometric_local=os.getenv("LOCAL_FIRST_BIOMETRIC_LOCAL", "true").lower() == "true",
        nimc_local=os.getenv("LOCAL_FIRST_NIMC_LOCAL", "true").lower() == "true",
        nimc_sandbox=os.getenv("LOCAL_FIRST_NIMC_SANDBOX", "true").lower() == "true",
        cac_local=os.getenv("LOCAL_FIRST_CAC_LOCAL", "true").lower() == "true",
        cac_sandbox=os.getenv("LOCAL_FIRST_CAC_SANDBOX", "true").lower() == "true",
        docling_local=os.getenv("LOCAL_FIRST_DOCLING_LOCAL", "true").lower() == "true",
        enable_cloud_fallback=os.getenv("LOCAL_FIRST_ENABLE_CLOUD_FALLBACK", "false").lower() == "true",
        require_local_processing=os.getenv("LOCAL_FIRST_REQUIRE_LOCAL_PROCESSING", "true").lower() == "true"
    )
    
    return config

# Initialize configuration
CONFIG = load_config_from_env()
SERVICE_REGISTRY = ServiceRegistry(CONFIG)

logger.info(f"Local-First Configuration loaded:")
logger.info(f"  Deployment Mode: {CONFIG.deployment_mode}")
logger.info(f"  DeepSeek Local: {CONFIG.deepseek_local}")
logger.info(f"  Biometric Local: {CONFIG.biometric_local}")
logger.info(f"  NIMC Local: {CONFIG.nimc_local}")
logger.info(f"  CAC Local: {CONFIG.cac_local}")
logger.info(f"  Docling Local: {CONFIG.docling_local}")
logger.info(f"  Cloud Fallback: {CONFIG.enable_cloud_fallback}")
logger.info(f"  Require Local Processing: {CONFIG.require_local_processing}")
