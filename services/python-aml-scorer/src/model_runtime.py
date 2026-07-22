"""CPU-only model training and inference runtime for the AML scorer.

Artifacts are deliberately trained from labeled platform history and persisted to a
volume-backed path. The runtime never invents model metrics or falls back to heuristic
"ML" when an artifact is unavailable.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import hashlib
import os
import tempfile

import joblib
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split


FEATURE_NAMES = [
    "amount",
    "log_amount",
    "amount_to_30d_average_ratio",
    "tx_count_24h",
    "tx_count_7d",
    "tx_count_30d",
    "amount_24h",
    "amount_7d",
    "account_age_days",
    "kyc_verified",
    "failed_tx_count_30d",
    "high_risk_country",
    "payment_rail_risk",
    "hour_of_day",
    "weekday",
    "weekend",
    "cross_currency",
]


@dataclass(frozen=True)
class ModelMetadata:
    version: str
    trained_at: str
    training_rows: int
    positive_rows: int
    feature_names: list[str]
    auc_roc: float | None
    algorithm: str = "HistGradientBoostingClassifier"


class CPUModelRuntime:
    """Owns an atomic on-disk sklearn model artifact and its verified metadata."""

    def __init__(self, artifact_path: str, min_training_rows: int) -> None:
        self.artifact_path = Path(artifact_path)
        self.min_training_rows = min_training_rows
        self.model: HistGradientBoostingClassifier | None = None
        self.metadata: ModelMetadata | None = None

    @property
    def loaded(self) -> bool:
        return self.model is not None and self.metadata is not None

    def load(self) -> ModelMetadata:
        if not self.artifact_path.is_file():
            raise FileNotFoundError(f"AML model artifact does not exist: {self.artifact_path}")
        artifact = joblib.load(self.artifact_path)
        if not isinstance(artifact, dict) or "model" not in artifact or "metadata" not in artifact:
            raise ValueError("AML model artifact has an invalid format")
        metadata_raw = artifact["metadata"]
        metadata = ModelMetadata(**metadata_raw)
        if metadata.feature_names != FEATURE_NAMES:
            raise ValueError("AML model artifact feature schema does not match the running scorer")
        model = artifact["model"]
        if not hasattr(model, "predict_proba"):
            raise ValueError("AML model artifact does not implement probability inference")
        self.model = model
        self.metadata = metadata
        return metadata

    def predict_probability(self, features: np.ndarray) -> float:
        if not self.loaded or self.model is None:
            raise RuntimeError("AML model artifact is not loaded")
        matrix = np.asarray(features, dtype=np.float64).reshape(1, -1)
        if matrix.shape[1] != len(FEATURE_NAMES):
            raise ValueError(f"Expected {len(FEATURE_NAMES)} AML features, received {matrix.shape[1]}")
        probability = float(self.model.predict_proba(matrix)[0][1])
        return min(max(probability, 0.0), 1.0)

    def train(self, features: np.ndarray, labels: np.ndarray) -> ModelMetadata:
        matrix = np.asarray(features, dtype=np.float64)
        target = np.asarray(labels, dtype=np.int64)
        if matrix.ndim != 2 or matrix.shape[1] != len(FEATURE_NAMES):
            raise ValueError(f"Training matrix must have {len(FEATURE_NAMES)} features")
        if len(matrix) < self.min_training_rows:
            raise ValueError(f"At least {self.min_training_rows} labeled transaction rows are required")
        unique = np.unique(target)
        if set(unique.tolist()) != {0, 1}:
            raise ValueError("Training labels must include both non-fraud and fraud outcomes")

        test_size = 0.2 if len(matrix) >= 50 else 0.0
        auc_roc: float | None = None
        if test_size:
            x_train, x_test, y_train, y_test = train_test_split(
                matrix, target, test_size=test_size, stratify=target, random_state=42
            )
        else:
            x_train, y_train = matrix, target
            x_test = y_test = None

        model = HistGradientBoostingClassifier(
            learning_rate=0.08,
            max_iter=300,
            max_leaf_nodes=31,
            l2_regularization=1.0,
            random_state=42,
        )
        model.fit(x_train, y_train)
        if x_test is not None and y_test is not None and len(np.unique(y_test)) == 2:
            auc_roc = float(roc_auc_score(y_test, model.predict_proba(x_test)[:, 1]))

        trained_at = datetime.now(timezone.utc).isoformat()
        fingerprint = hashlib.sha256(
            f"{trained_at}:{len(matrix)}:{int(target.sum())}:{FEATURE_NAMES}".encode("utf-8")
        ).hexdigest()[:12]
        metadata = ModelMetadata(
            version=f"aml-{fingerprint}",
            trained_at=trained_at,
            training_rows=int(len(matrix)),
            positive_rows=int(target.sum()),
            feature_names=FEATURE_NAMES,
            auc_roc=auc_roc,
        )
        self._persist(model, metadata)
        self.model = model
        self.metadata = metadata
        return metadata

    def _persist(self, model: HistGradientBoostingClassifier, metadata: ModelMetadata) -> None:
        self.artifact_path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary_name = tempfile.mkstemp(
            prefix=f".{self.artifact_path.name}.", suffix=".tmp", dir=self.artifact_path.parent
        )
        os.close(fd)
        temporary_path = Path(temporary_name)
        try:
            joblib.dump({"model": model, "metadata": asdict(metadata)}, temporary_path)
            os.replace(temporary_path, self.artifact_path)
        finally:
            if temporary_path.exists():
                temporary_path.unlink(missing_ok=True)

    def info(self) -> dict[str, Any]:
        if not self.metadata:
            return {"loaded": False, "artifact_path": str(self.artifact_path), "feature_count": len(FEATURE_NAMES)}
        return {"loaded": True, "artifact_path": str(self.artifact_path), **asdict(self.metadata)}
