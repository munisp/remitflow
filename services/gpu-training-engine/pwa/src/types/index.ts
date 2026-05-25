/** GPU Training Engine — shared types (platform-agnostic). */

export type GpuVendor = "nvidia" | "amd" | "intel" | "huawei" | "apple" | "cpu";

export interface DeviceInfo {
  vendor: GpuVendor;
  backend: string;
  device_name: string;
  device_index: number;
  memory_total_mb: number;
  memory_free_mb: number;
  compute_capability: string;
  driver_version: string;
  is_available: boolean;
  priority: number;
}

export interface TrainingJob {
  job_id: string;
  status: "queued" | "loading_data" | "training" | "completed" | "failed";
  model_type: string;
  data_source: string;
  training_samples: number;
  device: { vendor: string; device_name: string; backend: string };
  metrics: Record<string, number>;
  training_time_s: number;
  epochs_trained: number;
  best_epoch: number;
  onnx_path: string | null;
  history: Array<{ epoch: number; train_loss: number; val_accuracy: number }>;
}

export interface RemoteNode {
  node_id: string;
  host: string;
  port: number;
  gpu_vendor: GpuVendor | null;
  status: "registered" | "healthy" | "unreachable";
  registered_at: string;
}

export interface InferenceResult {
  predictions: number[][];
  probabilities?: number[][];
  device_used: string;
  provider_used: string;
  latency_ms: number;
  batch_size: number;
}

export interface BenchmarkResult {
  provider: string;
  label: string;
  latency_ms: Record<string, number>;
  throughput_samples_per_sec: number;
}

export interface ExportResult {
  model_name: string;
  target_format: string;
  size_mb: number;
  output_path: string;
}

export interface WorkflowResult {
  data_source: string;
  training: TrainingJob;
  inference: InferenceResult;
  test_prediction?: { latency_ms: number; inference_device: string };
}

// ─── RBAC ───────────────────────────────────────────────────────────────────

export type Role = "admin" | "ml_engineer" | "data_scientist" | "viewer";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatar?: string;
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  ml_engineer: "ML Engineer",
  data_scientist: "Data Scientist",
  viewer: "Viewer",
};

export const ROLE_PERMISSIONS: Record<Role, {
  canTrain: boolean;
  canInfer: boolean;
  canExport: boolean;
  canBenchmark: boolean;
  canManageNodes: boolean;
  canManageUsers: boolean;
  canDeleteModels: boolean;
  canViewAll: boolean;
}> = {
  admin: {
    canTrain: true, canInfer: true, canExport: true, canBenchmark: true,
    canManageNodes: true, canManageUsers: true, canDeleteModels: true, canViewAll: true,
  },
  ml_engineer: {
    canTrain: true, canInfer: true, canExport: true, canBenchmark: true,
    canManageNodes: true, canManageUsers: false, canDeleteModels: true, canViewAll: true,
  },
  data_scientist: {
    canTrain: true, canInfer: true, canExport: false, canBenchmark: true,
    canManageNodes: false, canManageUsers: false, canDeleteModels: false, canViewAll: true,
  },
  viewer: {
    canTrain: false, canInfer: false, canExport: false, canBenchmark: false,
    canManageNodes: false, canManageUsers: false, canDeleteModels: false, canViewAll: true,
  },
};

// ─── Workflow wizard types ──────────────────────────────────────────────────

export interface WorkflowStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  active: boolean;
}

export type WorkflowType =
  | "training"
  | "inference"
  | "cross_gpu"
  | "remote_setup"
  | "onboarding";

// ─── Model presets (platform-agnostic) ──────────────────────────────────────

export interface ModelPreset {
  id: string;
  name: string;
  icon: string;
  description: string;
  architecture: string;
  default_epochs: number;
  default_batch_size: number;
  default_lr: number;
  input_features: number;
  output_classes: number;
}

export const DEFAULT_MODEL_PRESETS: ModelPreset[] = [
  { id: "image_classifier", name: "Image Classifier", icon: "image", description: "CNN/ViT for image classification", architecture: "ResNet-50 / ViT-B", default_epochs: 30, default_batch_size: 32, default_lr: 0.001, input_features: 3, output_classes: 10 },
  { id: "text_classifier", name: "Text Classifier", icon: "text", description: "Transformer for text classification", architecture: "DistilBERT / BERT-base", default_epochs: 10, default_batch_size: 16, default_lr: 2e-5, input_features: 512, output_classes: 5 },
  { id: "tabular_classifier", name: "Tabular Classifier", icon: "table", description: "MLP for tabular data", architecture: "4-layer MLP", default_epochs: 50, default_batch_size: 64, default_lr: 0.001, input_features: 11, output_classes: 2 },
  { id: "time_series", name: "Time Series Forecaster", icon: "chart", description: "LSTM/Transformer for sequence prediction", architecture: "Bi-LSTM + Attention", default_epochs: 100, default_batch_size: 128, default_lr: 0.0005, input_features: 1, output_classes: 1 },
  { id: "gnn_node_clf", name: "Graph Neural Network", icon: "network", description: "GAT/GCN for node classification", architecture: "3-layer GAT", default_epochs: 100, default_batch_size: 256, default_lr: 0.005, input_features: 16, output_classes: 2 },
  { id: "object_detection", name: "Object Detection", icon: "scan", description: "YOLO/SSD for object detection", architecture: "YOLOv8", default_epochs: 50, default_batch_size: 16, default_lr: 0.01, input_features: 3, output_classes: 80 },
  { id: "custom", name: "Custom Model", icon: "code", description: "Bring your own PyTorch model", architecture: "User-defined", default_epochs: 30, default_batch_size: 32, default_lr: 0.001, input_features: 0, output_classes: 0 },
];
