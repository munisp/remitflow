/**
 * Platform-agnostic HTTP client for GPU Training Engine API.
 * Configurable via GPU_ENGINE_URL environment variable or runtime config.
 */
import type {
  DeviceInfo, TrainingJob, InferenceResult, BenchmarkResult,
  ExportResult, RemoteNode, WorkflowResult,
} from "@/types";

let BASE_URL = import.meta.env.VITE_GPU_ENGINE_URL || "/api";

export function setBaseUrl(url: string) {
  BASE_URL = url.replace(/\/$/, "");
}

export function getBaseUrl(): string {
  return BASE_URL;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json();
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("gpu_engine_token");
  if (token) return { Authorization: `Bearer ${token}` };
  return {};
}

// ─── Devices ────────────────────────────────────────────────────────────────

export async function getDevices(): Promise<{
  devices: DeviceInfo[];
  total: number;
  gpu_count: number;
  best_device: DeviceInfo | null;
}> {
  return request("/devices");
}

// ─── Training ───────────────────────────────────────────────────────────────

export interface TrainParams {
  modelType: string;
  preferredDevice?: string;
  epochs?: number;
  batchSize?: number;
  learningRate?: number;
  mixedPrecision?: boolean;
  exportOnnx?: boolean;
  dataSource?: string;
  customModelPath?: string;
  datasetPath?: string;
}

export async function train(params: TrainParams): Promise<TrainingJob> {
  return request("/train", {
    method: "POST",
    body: JSON.stringify({
      model_type: params.modelType,
      preferred_device: params.preferredDevice,
      epochs: params.epochs ?? 30,
      batch_size: params.batchSize ?? 64,
      learning_rate: params.learningRate ?? 0.001,
      mixed_precision: params.mixedPrecision ?? true,
      export_onnx: params.exportOnnx ?? true,
      data_source: params.dataSource ?? "synthetic",
      custom_model_path: params.customModelPath,
      dataset_path: params.datasetPath,
    }),
  });
}

// ─── Inference ──────────────────────────────────────────────────────────────

export interface InferParams {
  modelName: string;
  inputs: number[][];
  targetDevice?: string;
  returnProbabilities?: boolean;
}

export async function infer(params: InferParams): Promise<InferenceResult> {
  return request("/inference", {
    method: "POST",
    body: JSON.stringify({
      model_name: params.modelName,
      inputs: params.inputs,
      target_device: params.targetDevice,
      return_probabilities: params.returnProbabilities ?? true,
    }),
  });
}

// ─── Cross-GPU Workflow ─────────────────────────────────────────────────────

export interface WorkflowParams {
  modelType: string;
  trainDevice?: string;
  inferDevice?: string;
  epochs?: number;
}

export async function trainAndDeploy(params: WorkflowParams): Promise<WorkflowResult> {
  return request("/workflow/train-and-deploy", {
    method: "POST",
    body: JSON.stringify({
      model_type: params.modelType,
      train_device: params.trainDevice,
      infer_device: params.inferDevice,
      epochs: params.epochs ?? 30,
    }),
  });
}

// ─── Export ─────────────────────────────────────────────────────────────────

export async function exportModel(
  modelName: string,
  targetFormat: string,
): Promise<ExportResult> {
  return request("/export", {
    method: "POST",
    body: JSON.stringify({ model_name: modelName, target_format: targetFormat }),
  });
}

// ─── Benchmark ──────────────────────────────────────────────────────────────

export async function benchmark(
  modelName: string,
  inputShape: number[],
  batchSize?: number,
  iterations?: number,
): Promise<BenchmarkResult> {
  return request("/benchmark", {
    method: "POST",
    body: JSON.stringify({
      model_name: modelName,
      input_shape: inputShape,
      batch_size: batchSize ?? 1,
      iterations: iterations ?? 100,
    }),
  });
}

// ─── Jobs ───────────────────────────────────────────────────────────────────

export async function getJobs(): Promise<{ jobs: Record<string, TrainingJob> }> {
  return request("/jobs");
}

// ─── Models ─────────────────────────────────────────────────────────────────

export async function getModels(): Promise<{
  model_types: string[];
  loaded: Record<string, unknown>;
  available_onnx: string[];
  available_pytorch: string[];
}> {
  return request("/models");
}

// ─── Providers ──────────────────────────────────────────────────────────────

export async function getProviders(): Promise<{
  providers: Array<{ provider: string; label: string; vendor: string }>;
}> {
  return request("/providers");
}

// ─── Remote Nodes ───────────────────────────────────────────────────────────

export async function getRemoteNodes(): Promise<{ nodes: RemoteNode[] }> {
  return request("/remote/nodes");
}

export async function registerNode(params: {
  nodeId: string;
  host: string;
  port: number;
  gpuVendor?: string;
}): Promise<RemoteNode> {
  return request("/remote/register", {
    method: "POST",
    body: JSON.stringify({
      node_id: params.nodeId,
      host: params.host,
      port: params.port,
      gpu_vendor: params.gpuVendor,
    }),
  });
}

export async function remoteTrain(
  nodeId: string,
  modelType: string,
  epochs?: number,
  batchSize?: number,
): Promise<TrainingJob> {
  return request("/remote/train", {
    method: "POST",
    body: JSON.stringify({
      node_id: nodeId,
      model_type: modelType,
      epochs: epochs ?? 30,
      batch_size: batchSize ?? 64,
    }),
  });
}

export async function remoteInfer(
  nodeId: string,
  modelName: string,
  inputs: number[][],
): Promise<InferenceResult> {
  return request("/remote/infer", {
    method: "POST",
    body: JSON.stringify({
      node_id: nodeId,
      model_name: modelName,
      inputs,
    }),
  });
}

// ─── Health ─────────────────────────────────────────────────────────────────

export async function healthCheck(): Promise<{ status: string; version: string }> {
  return request("/health");
}
