"""
Model Registry - MLflow-compatible model versioning and experiment tracking
Provides model lifecycle management, experiment tracking, and deployment

Features:
- Model versioning with semantic versioning
- Experiment tracking with metrics and parameters
- Model staging (development, staging, production)
- Model comparison and promotion
- Artifact storage and retrieval
- Model lineage tracking
"""

import os
import json
import logging
import pickle
import hashlib
import shutil
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict, field
from enum import Enum
from pathlib import Path
import asyncio

logger = logging.getLogger(__name__)

# Configuration
MODEL_REGISTRY_PATH = os.getenv("MODEL_REGISTRY_PATH", "/tmp/ml_model_registry")
MLFLOW_TRACKING_URI = os.getenv("MLFLOW_TRACKING_URI", "")
MLFLOW_ENABLED = os.getenv("MLFLOW_ENABLED", "false").lower() == "true"

# Try to import MLflow
try:
    import mlflow
    from mlflow.tracking import MlflowClient
    MLFLOW_AVAILABLE = True
except ImportError:
    MLFLOW_AVAILABLE = False
    logger.info("MLflow not available, using local model registry")


class ModelStage(str, Enum):
    DEVELOPMENT = "development"
    STAGING = "staging"
    PRODUCTION = "production"
    ARCHIVED = "archived"


class ExperimentStatus(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class ModelVersion:
    """A specific version of a model"""
    model_name: str
    version: str
    stage: ModelStage
    algorithm: str
    metrics: Dict[str, float]
    parameters: Dict[str, Any]
    feature_names: List[str]
    created_at: datetime
    updated_at: datetime
    description: str = ""
    tags: Dict[str, str] = field(default_factory=dict)
    artifact_path: str = ""
    run_id: str = ""
    parent_run_id: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "model_name": self.model_name,
            "version": self.version,
            "stage": self.stage.value,
            "algorithm": self.algorithm,
            "metrics": self.metrics,
            "parameters": self.parameters,
            "feature_names": self.feature_names,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "description": self.description,
            "tags": self.tags,
            "artifact_path": self.artifact_path,
            "run_id": self.run_id,
            "parent_run_id": self.parent_run_id
        }


@dataclass
class Experiment:
    """An ML experiment tracking run"""
    experiment_id: str
    experiment_name: str
    run_id: str
    status: ExperimentStatus
    start_time: datetime
    end_time: Optional[datetime]
    parameters: Dict[str, Any]
    metrics: Dict[str, float]
    tags: Dict[str, str]
    artifacts: List[str]
    model_name: Optional[str] = None
    model_version: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "experiment_id": self.experiment_id,
            "experiment_name": self.experiment_name,
            "run_id": self.run_id,
            "status": self.status.value,
            "start_time": self.start_time.isoformat(),
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "parameters": self.parameters,
            "metrics": self.metrics,
            "tags": self.tags,
            "artifacts": self.artifacts,
            "model_name": self.model_name,
            "model_version": self.model_version
        }


@dataclass
class ModelComparison:
    """Comparison between two model versions"""
    model_name: str
    version_a: str
    version_b: str
    metric_comparison: Dict[str, Dict[str, float]]  # metric -> {a, b, diff, pct_change}
    parameter_diff: Dict[str, Dict[str, Any]]  # param -> {a, b}
    recommendation: str
    winner: str
    confidence: float


class LocalModelRegistry:
    """Local file-based model registry (MLflow-compatible interface)"""
    
    def __init__(self, registry_path: str = None):
        self.registry_path = Path(registry_path or MODEL_REGISTRY_PATH)
        self.registry_path.mkdir(parents=True, exist_ok=True)
        
        self.models_path = self.registry_path / "models"
        self.experiments_path = self.registry_path / "experiments"
        self.artifacts_path = self.registry_path / "artifacts"
        
        self.models_path.mkdir(exist_ok=True)
        self.experiments_path.mkdir(exist_ok=True)
        self.artifacts_path.mkdir(exist_ok=True)
        
        self._models: Dict[str, Dict[str, ModelVersion]] = {}
        self._experiments: Dict[str, Experiment] = {}
        self._load_registry()
        
        logger.info(f"Local model registry initialized at {self.registry_path}")
    
    def _load_registry(self):
        """Load registry state from disk"""
        # Load models
        models_file = self.registry_path / "models.json"
        if models_file.exists():
            try:
                with open(models_file, "r") as f:
                    data = json.load(f)
                    for model_name, versions in data.items():
                        self._models[model_name] = {}
                        for version, version_data in versions.items():
                            self._models[model_name][version] = ModelVersion(
                                model_name=version_data["model_name"],
                                version=version_data["version"],
                                stage=ModelStage(version_data["stage"]),
                                algorithm=version_data["algorithm"],
                                metrics=version_data["metrics"],
                                parameters=version_data["parameters"],
                                feature_names=version_data["feature_names"],
                                created_at=datetime.fromisoformat(version_data["created_at"]),
                                updated_at=datetime.fromisoformat(version_data["updated_at"]),
                                description=version_data.get("description", ""),
                                tags=version_data.get("tags", {}),
                                artifact_path=version_data.get("artifact_path", ""),
                                run_id=version_data.get("run_id", ""),
                                parent_run_id=version_data.get("parent_run_id", "")
                            )
            except Exception as e:
                logger.error(f"Failed to load models: {e}")
        
        # Load experiments
        experiments_file = self.registry_path / "experiments.json"
        if experiments_file.exists():
            try:
                with open(experiments_file, "r") as f:
                    data = json.load(f)
                    for run_id, exp_data in data.items():
                        self._experiments[run_id] = Experiment(
                            experiment_id=exp_data["experiment_id"],
                            experiment_name=exp_data["experiment_name"],
                            run_id=exp_data["run_id"],
                            status=ExperimentStatus(exp_data["status"]),
                            start_time=datetime.fromisoformat(exp_data["start_time"]),
                            end_time=datetime.fromisoformat(exp_data["end_time"]) if exp_data.get("end_time") else None,
                            parameters=exp_data["parameters"],
                            metrics=exp_data["metrics"],
                            tags=exp_data.get("tags", {}),
                            artifacts=exp_data.get("artifacts", []),
                            model_name=exp_data.get("model_name"),
                            model_version=exp_data.get("model_version")
                        )
            except Exception as e:
                logger.error(f"Failed to load experiments: {e}")
    
    def _save_registry(self):
        """Save registry state to disk"""
        # Save models
        models_data = {}
        for model_name, versions in self._models.items():
            models_data[model_name] = {}
            for version, model_version in versions.items():
                models_data[model_name][version] = model_version.to_dict()
        
        with open(self.registry_path / "models.json", "w") as f:
            json.dump(models_data, f, indent=2)
        
        # Save experiments
        experiments_data = {}
        for run_id, experiment in self._experiments.items():
            experiments_data[run_id] = experiment.to_dict()
        
        with open(self.registry_path / "experiments.json", "w") as f:
            json.dump(experiments_data, f, indent=2)
    
    def register_model(
        self,
        model_name: str,
        model: Any,
        algorithm: str,
        metrics: Dict[str, float],
        parameters: Dict[str, Any],
        feature_names: List[str],
        description: str = "",
        tags: Dict[str, str] = None,
        run_id: str = ""
    ) -> ModelVersion:
        """Register a new model version"""
        
        # Determine version number
        if model_name not in self._models:
            self._models[model_name] = {}
        
        existing_versions = list(self._models[model_name].keys())
        if existing_versions:
            # Parse existing versions and increment
            max_version = max(int(v.split(".")[-1]) for v in existing_versions if v.startswith("1.0."))
            new_version = f"1.0.{max_version + 1}"
        else:
            new_version = "1.0.0"
        
        # Save model artifact
        artifact_dir = self.artifacts_path / model_name / new_version
        artifact_dir.mkdir(parents=True, exist_ok=True)
        artifact_path = artifact_dir / "model.pkl"
        
        with open(artifact_path, "wb") as f:
            pickle.dump(model, f)
        
        # Create model version
        now = datetime.utcnow()
        model_version = ModelVersion(
            model_name=model_name,
            version=new_version,
            stage=ModelStage.DEVELOPMENT,
            algorithm=algorithm,
            metrics=metrics,
            parameters=parameters,
            feature_names=feature_names,
            created_at=now,
            updated_at=now,
            description=description,
            tags=tags or {},
            artifact_path=str(artifact_path),
            run_id=run_id
        )
        
        self._models[model_name][new_version] = model_version
        self._save_registry()
        
        logger.info(f"Registered model {model_name} version {new_version}")
        return model_version
    
    def get_model_version(self, model_name: str, version: str) -> Optional[ModelVersion]:
        """Get a specific model version"""
        if model_name not in self._models:
            return None
        return self._models[model_name].get(version)
    
    def get_latest_version(self, model_name: str, stage: ModelStage = None) -> Optional[ModelVersion]:
        """Get the latest version of a model, optionally filtered by stage"""
        if model_name not in self._models:
            return None
        
        versions = list(self._models[model_name].values())
        if stage:
            versions = [v for v in versions if v.stage == stage]
        
        if not versions:
            return None
        
        return max(versions, key=lambda v: v.created_at)
    
    def get_production_model(self, model_name: str) -> Optional[ModelVersion]:
        """Get the production version of a model"""
        return self.get_latest_version(model_name, ModelStage.PRODUCTION)
    
    def list_models(self) -> List[str]:
        """List all registered models"""
        return list(self._models.keys())
    
    def list_versions(self, model_name: str) -> List[ModelVersion]:
        """List all versions of a model"""
        if model_name not in self._models:
            return []
        return list(self._models[model_name].values())
    
    def transition_stage(self, model_name: str, version: str, stage: ModelStage) -> bool:
        """Transition a model version to a new stage"""
        model_version = self.get_model_version(model_name, version)
        if not model_version:
            return False
        
        # If promoting to production, demote current production
        if stage == ModelStage.PRODUCTION:
            current_prod = self.get_production_model(model_name)
            if current_prod and current_prod.version != version:
                current_prod.stage = ModelStage.ARCHIVED
                current_prod.updated_at = datetime.utcnow()
        
        model_version.stage = stage
        model_version.updated_at = datetime.utcnow()
        self._save_registry()
        
        logger.info(f"Transitioned {model_name} v{version} to {stage.value}")
        return True
    
    def load_model(self, model_name: str, version: str = None) -> Optional[Any]:
        """Load a model from the registry"""
        if version:
            model_version = self.get_model_version(model_name, version)
        else:
            model_version = self.get_production_model(model_name)
            if not model_version:
                model_version = self.get_latest_version(model_name)
        
        if not model_version or not model_version.artifact_path:
            return None
        
        try:
            with open(model_version.artifact_path, "rb") as f:
                return pickle.load(f)
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            return None
    
    def delete_model_version(self, model_name: str, version: str) -> bool:
        """Delete a model version"""
        if model_name not in self._models or version not in self._models[model_name]:
            return False
        
        model_version = self._models[model_name][version]
        
        # Delete artifact
        if model_version.artifact_path:
            try:
                Path(model_version.artifact_path).unlink(missing_ok=True)
            except Exception as e:
                logger.warning(f"Failed to delete artifact: {e}")
        
        del self._models[model_name][version]
        self._save_registry()
        
        logger.info(f"Deleted {model_name} v{version}")
        return True
    
    # Experiment tracking methods
    def create_experiment(self, experiment_name: str) -> str:
        """Create a new experiment"""
        experiment_id = hashlib.md5(experiment_name.encode()).hexdigest()[:8]
        return experiment_id
    
    def start_run(
        self,
        experiment_name: str,
        parameters: Dict[str, Any] = None,
        tags: Dict[str, str] = None
    ) -> str:
        """Start a new experiment run"""
        experiment_id = self.create_experiment(experiment_name)
        run_id = hashlib.md5(f"{experiment_name}_{datetime.utcnow().isoformat()}".encode()).hexdigest()[:12]
        
        experiment = Experiment(
            experiment_id=experiment_id,
            experiment_name=experiment_name,
            run_id=run_id,
            status=ExperimentStatus.RUNNING,
            start_time=datetime.utcnow(),
            end_time=None,
            parameters=parameters or {},
            metrics={},
            tags=tags or {},
            artifacts=[]
        )
        
        self._experiments[run_id] = experiment
        self._save_registry()
        
        logger.info(f"Started run {run_id} for experiment {experiment_name}")
        return run_id
    
    def log_params(self, run_id: str, params: Dict[str, Any]):
        """Log parameters to a run"""
        if run_id not in self._experiments:
            return
        
        self._experiments[run_id].parameters.update(params)
        self._save_registry()
    
    def log_metrics(self, run_id: str, metrics: Dict[str, float]):
        """Log metrics to a run"""
        if run_id not in self._experiments:
            return
        
        self._experiments[run_id].metrics.update(metrics)
        self._save_registry()
    
    def log_artifact(self, run_id: str, artifact_path: str):
        """Log an artifact to a run"""
        if run_id not in self._experiments:
            return
        
        self._experiments[run_id].artifacts.append(artifact_path)
        self._save_registry()
    
    def end_run(self, run_id: str, status: ExperimentStatus = ExperimentStatus.COMPLETED):
        """End an experiment run"""
        if run_id not in self._experiments:
            return
        
        self._experiments[run_id].status = status
        self._experiments[run_id].end_time = datetime.utcnow()
        self._save_registry()
        
        logger.info(f"Ended run {run_id} with status {status.value}")
    
    def get_run(self, run_id: str) -> Optional[Experiment]:
        """Get an experiment run"""
        return self._experiments.get(run_id)
    
    def list_runs(self, experiment_name: str = None) -> List[Experiment]:
        """List experiment runs"""
        runs = list(self._experiments.values())
        if experiment_name:
            runs = [r for r in runs if r.experiment_name == experiment_name]
        return sorted(runs, key=lambda r: r.start_time, reverse=True)
    
    def compare_models(
        self,
        model_name: str,
        version_a: str,
        version_b: str
    ) -> Optional[ModelComparison]:
        """Compare two model versions"""
        model_a = self.get_model_version(model_name, version_a)
        model_b = self.get_model_version(model_name, version_b)
        
        if not model_a or not model_b:
            return None
        
        # Compare metrics
        metric_comparison = {}
        all_metrics = set(model_a.metrics.keys()) | set(model_b.metrics.keys())
        
        for metric in all_metrics:
            val_a = model_a.metrics.get(metric, 0)
            val_b = model_b.metrics.get(metric, 0)
            diff = val_b - val_a
            pct_change = (diff / val_a * 100) if val_a != 0 else 0
            
            metric_comparison[metric] = {
                "version_a": val_a,
                "version_b": val_b,
                "diff": diff,
                "pct_change": pct_change
            }
        
        # Compare parameters
        parameter_diff = {}
        all_params = set(model_a.parameters.keys()) | set(model_b.parameters.keys())
        
        for param in all_params:
            val_a = model_a.parameters.get(param)
            val_b = model_b.parameters.get(param)
            if val_a != val_b:
                parameter_diff[param] = {"version_a": val_a, "version_b": val_b}
        
        # Determine winner based on primary metrics
        primary_metrics = ["auc_roc", "f1_score", "accuracy", "r2_score"]
        winner = version_a
        confidence = 0.5
        
        for metric in primary_metrics:
            if metric in metric_comparison:
                if metric_comparison[metric]["diff"] > 0:
                    winner = version_b
                    confidence = min(0.95, 0.5 + abs(metric_comparison[metric]["pct_change"]) / 100)
                else:
                    winner = version_a
                    confidence = min(0.95, 0.5 + abs(metric_comparison[metric]["pct_change"]) / 100)
                break
        
        recommendation = f"Version {winner} is recommended based on metric comparison"
        if confidence > 0.8:
            recommendation += " with high confidence"
        elif confidence > 0.6:
            recommendation += " with moderate confidence"
        else:
            recommendation += " with low confidence - consider additional testing"
        
        return ModelComparison(
            model_name=model_name,
            version_a=version_a,
            version_b=version_b,
            metric_comparison=metric_comparison,
            parameter_diff=parameter_diff,
            recommendation=recommendation,
            winner=winner,
            confidence=confidence
        )


class MLflowModelRegistry:
    """MLflow-based model registry (when MLflow is available)"""
    
    def __init__(self, tracking_uri: str = None):
        if not MLFLOW_AVAILABLE:
            raise RuntimeError("MLflow not available")
        
        self.tracking_uri = tracking_uri or MLFLOW_TRACKING_URI
        if self.tracking_uri:
            mlflow.set_tracking_uri(self.tracking_uri)
        
        self.client = MlflowClient()
        logger.info(f"MLflow model registry initialized with URI: {self.tracking_uri}")
    
    def register_model(
        self,
        model_name: str,
        model: Any,
        algorithm: str,
        metrics: Dict[str, float],
        parameters: Dict[str, Any],
        feature_names: List[str],
        description: str = "",
        tags: Dict[str, str] = None,
        run_id: str = ""
    ) -> ModelVersion:
        """Register a model with MLflow"""
        with mlflow.start_run() as run:
            # Log parameters
            mlflow.log_params(parameters)
            
            # Log metrics
            mlflow.log_metrics(metrics)
            
            # Log model
            mlflow.sklearn.log_model(model, "model", registered_model_name=model_name)
            
            # Log tags
            if tags:
                for key, value in tags.items():
                    mlflow.set_tag(key, value)
            
            mlflow.set_tag("algorithm", algorithm)
            mlflow.set_tag("feature_names", json.dumps(feature_names))
            
            run_id = run.info.run_id
        
        # Get the registered model version
        versions = self.client.search_model_versions(f"name='{model_name}'")
        latest_version = max(versions, key=lambda v: int(v.version))
        
        now = datetime.utcnow()
        return ModelVersion(
            model_name=model_name,
            version=latest_version.version,
            stage=ModelStage.DEVELOPMENT,
            algorithm=algorithm,
            metrics=metrics,
            parameters=parameters,
            feature_names=feature_names,
            created_at=now,
            updated_at=now,
            description=description,
            tags=tags or {},
            artifact_path=latest_version.source,
            run_id=run_id
        )
    
    def transition_stage(self, model_name: str, version: str, stage: ModelStage) -> bool:
        """Transition model to a new stage"""
        mlflow_stage = {
            ModelStage.DEVELOPMENT: "None",
            ModelStage.STAGING: "Staging",
            ModelStage.PRODUCTION: "Production",
            ModelStage.ARCHIVED: "Archived"
        }.get(stage, "None")
        
        try:
            self.client.transition_model_version_stage(
                name=model_name,
                version=version,
                stage=mlflow_stage
            )
            return True
        except Exception as e:
            logger.error(f"Failed to transition model stage: {e}")
            return False
    
    def load_model(self, model_name: str, version: str = None) -> Optional[Any]:
        """Load a model from MLflow"""
        try:
            if version:
                model_uri = f"models:/{model_name}/{version}"
            else:
                model_uri = f"models:/{model_name}/Production"
            
            return mlflow.sklearn.load_model(model_uri)
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            return None


# Factory function to get the appropriate registry
def get_model_registry():
    """Get the model registry instance"""
    if MLFLOW_ENABLED and MLFLOW_AVAILABLE and MLFLOW_TRACKING_URI:
        return MLflowModelRegistry(MLFLOW_TRACKING_URI)
    else:
        return LocalModelRegistry()


# Global instance
_registry = None


def get_registry() -> LocalModelRegistry:
    """Get the global model registry instance"""
    global _registry
    if _registry is None:
        _registry = get_model_registry()
    return _registry
