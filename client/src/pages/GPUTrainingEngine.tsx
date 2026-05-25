/**
 * GPUTrainingEngine.tsx
 * GPU-Agnostic Training Engine Dashboard
 *
 * Full UI for managing GPU training/inference across vendors:
 *   - Device detection & hardware inventory
 *   - Training job submission & monitoring
 *   - Cross-device inference (train on one GPU, infer on another)
 *   - Remote node management
 *   - Model export & conversion
 *   - Benchmark & performance profiling
 */
import { useState, useEffect, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Cpu, Monitor, Zap, Play, Square, RefreshCw, Download,
  Upload, Server, Network, Activity, BarChart3, Clock,
  CheckCircle2, XCircle, AlertCircle, Loader2, Settings,
  Layers, GitBranch, ArrowRight, ArrowLeftRight, Gauge,
  HardDrive, Workflow, Box, CircuitBoard, Rocket,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface DeviceInfo {
  vendor: string;
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

interface TrainingJob {
  job_id: string;
  status: string;
  model_type: string;
  data_source: string;
  training_samples: number;
  device: Record<string, unknown>;
  metrics: Record<string, number>;
  training_time_s: number;
  epochs_trained: number;
  best_epoch: number;
  onnx_path: string | null;
  history: Array<{ epoch: number; train_loss: number; val_accuracy: number }>;
}

interface RemoteNode {
  node_id: string;
  host: string;
  port: number;
  gpu_vendor: string | null;
  status: string;
  registered_at: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MODEL_TYPES = [
  { value: "fraud_detection", label: "Fraud Detection", icon: "🛡️", desc: "MLP (11 features → 2 classes)" },
  { value: "nlu_intent", label: "NLU Intent", icon: "🗣️", desc: "Transformer (12 intent classes)" },
  { value: "fx_forecasting", label: "FX Forecasting", icon: "📈", desc: "LSTM + Attention (rate prediction)" },
  { value: "investment_scoring", label: "Investment Scoring", icon: "💰", desc: "MLP (5 risk quintiles)" },
  { value: "gnn_fraud", label: "GNN Fraud", icon: "🕸️", desc: "GAT (graph node classification)" },
] as const;

const GPU_VENDORS = [
  { value: "nvidia", label: "NVIDIA (CUDA)", color: "bg-green-500" },
  { value: "amd", label: "AMD (ROCm)", color: "bg-red-500" },
  { value: "intel", label: "Intel (XPU)", color: "bg-blue-500" },
  { value: "huawei", label: "Huawei (Ascend)", color: "bg-orange-500" },
  { value: "apple", label: "Apple (MPS)", color: "bg-gray-500" },
  { value: "cpu", label: "CPU", color: "bg-slate-500" },
] as const;

const EXPORT_FORMATS = [
  { value: "onnx", label: "ONNX", desc: "Universal (any GPU)" },
  { value: "tensorrt", label: "TensorRT", desc: "NVIDIA optimized" },
  { value: "openvino", label: "OpenVINO", desc: "Intel optimized" },
  { value: "coreml", label: "CoreML", desc: "Apple optimized" },
  { value: "quantized", label: "INT8 Quantized", desc: "CPU fast (2-4x speedup)" },
] as const;

// ─── Vendor Badge ───────────────────────────────────────────────────────────

function VendorBadge({ vendor }: { vendor: string }) {
  const colors: Record<string, string> = {
    nvidia: "bg-green-500/10 text-green-700 border-green-300",
    amd: "bg-red-500/10 text-red-700 border-red-300",
    intel: "bg-blue-500/10 text-blue-700 border-blue-300",
    huawei: "bg-orange-500/10 text-orange-700 border-orange-300",
    apple: "bg-gray-500/10 text-gray-700 border-gray-300",
    cpu: "bg-slate-500/10 text-slate-700 border-slate-300",
  };
  return (
    <Badge variant="outline" className={colors[vendor] || "bg-gray-100"}>
      {vendor.toUpperCase()}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    healthy: "bg-green-500/10 text-green-700",
    completed: "bg-green-500/10 text-green-700",
    training: "bg-blue-500/10 text-blue-700",
    loading_data: "bg-yellow-500/10 text-yellow-700",
    failed: "bg-red-500/10 text-red-700",
    registered: "bg-blue-500/10 text-blue-700",
    unreachable: "bg-red-500/10 text-red-700",
  };
  return <Badge className={styles[status] || "bg-gray-100"}>{status}</Badge>;
}

// ─── Devices Tab ────────────────────────────────────────────────────────────

function DevicesTab() {
  const { data: devicesData, isLoading, refetch } = trpc.mlPipeline.gpuEngine.devices.useQuery(
    undefined,
    { retry: 1, refetchInterval: 30000 }
  );

  const devices = (devicesData as { devices?: DeviceInfo[] })?.devices ?? [];
  const gpuCount = (devicesData as { gpu_count?: number })?.gpu_count ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <CircuitBoard className="h-5 w-5 text-purple-500" />
            Hardware Inventory
          </h3>
          <p className="text-sm text-muted-foreground">
            {devices.length} device(s) detected — {gpuCount} GPU(s) + CPU
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Scan
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-40 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {devices.map((device: DeviceInfo, idx: number) => (
            <Card key={idx} className={device.is_available ? "" : "opacity-60"}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <VendorBadge vendor={device.vendor} />
                  {device.is_available ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                </div>
                <CardTitle className="text-sm mt-2">{device.device_name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Backend</span>
                  <span className="font-mono">{device.backend}</span>
                </div>
                {device.memory_total_mb > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Memory</span>
                    <span>{Math.round(device.memory_total_mb / 1024)} GB</span>
                  </div>
                )}
                {device.compute_capability && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Compute</span>
                    <span className="font-mono">{device.compute_capability}</span>
                  </div>
                )}
                {device.driver_version && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Driver</span>
                    <span className="font-mono text-xs">{device.driver_version}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Priority</span>
                  <span>{device.priority === 100 ? "Fallback" : `#${device.priority}`}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Supported Vendors Reference */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Supported GPU Vendors & Backends</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
            {GPU_VENDORS.map((v) => (
              <div key={v.value} className="flex items-center gap-2 p-2 rounded border">
                <div className={`w-2 h-2 rounded-full ${v.color}`} />
                <span>{v.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Training Tab ───────────────────────────────────────────────────────────

function TrainingTab() {
  const [modelType, setModelType] = useState("fraud_detection");
  const [preferredDevice, setPreferredDevice] = useState<string>("");
  const [epochs, setEpochs] = useState(30);
  const [batchSize, setBatchSize] = useState(64);
  const [learningRate, setLearningRate] = useState(0.001);
  const [mixedPrecision, setMixedPrecision] = useState(true);
  const [exportOnnx, setExportOnnx] = useState(true);
  const [dataSource, setDataSource] = useState<"synthetic" | "platform_db">("synthetic");
  const [lastResult, setLastResult] = useState<TrainingJob | null>(null);

  const trainMutation = trpc.mlPipeline.gpuEngine.train.useMutation({
    onSuccess: (data) => {
      setLastResult(data as unknown as TrainingJob);
      toast.success(`Training complete — ${(data as { epochs_trained?: number }).epochs_trained} epochs on ${((data as { device?: Record<string, unknown> }).device as Record<string, unknown>)?.vendor || "CPU"}`);
    },
    onError: (err) => {
      toast.error(`Training failed: ${err.message}`);
    },
  });

  const handleTrain = () => {
    trainMutation.mutate({
      modelType: modelType as "fraud_detection" | "nlu_intent" | "fx_forecasting" | "investment_scoring" | "gnn_fraud",
      preferredDevice: preferredDevice || undefined,
      epochs,
      batchSize,
      learningRate,
      mixedPrecision,
      exportOnnx,
      dataSource: dataSource as "synthetic" | "platform_db" | "custom",
    });
  };

  const selectedModel = MODEL_TYPES.find((m) => m.value === modelType);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Training Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-blue-500" />
              Training Configuration
            </CardTitle>
            <CardDescription>Configure model training on any available GPU</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Model Type */}
            <div className="space-y-2">
              <Label>Model Type</Label>
              <Select value={modelType} onValueChange={setModelType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_TYPES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      <span className="flex items-center gap-2">
                        <span>{m.icon}</span>
                        <span>{m.label}</span>
                        <span className="text-xs text-muted-foreground ml-1">— {m.desc}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Preferred GPU */}
            <div className="space-y-2">
              <Label>Preferred GPU (auto-detect if empty)</Label>
              <Select value={preferredDevice} onValueChange={setPreferredDevice}>
                <SelectTrigger>
                  <SelectValue placeholder="Auto-detect best GPU" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect</SelectItem>
                  {GPU_VENDORS.map((v) => (
                    <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Data Source */}
            <div className="space-y-2">
              <Label>Data Source</Label>
              <Select value={dataSource} onValueChange={(v) => setDataSource(v as "synthetic" | "platform_db")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="platform_db">Platform DB (real data)</SelectItem>
                  <SelectItem value="synthetic">Synthetic (generated)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Hyperparameters */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Epochs</Label>
                <Input type="number" value={epochs} onChange={(e) => setEpochs(Number(e.target.value))} min={1} max={1000} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Batch Size</Label>
                <Input type="number" value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} min={1} max={4096} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Learning Rate</Label>
                <Input type="number" value={learningRate} onChange={(e) => setLearningRate(Number(e.target.value))} step={0.0001} min={0.00001} max={1} />
              </div>
            </div>

            {/* Toggles */}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch checked={mixedPrecision} onCheckedChange={setMixedPrecision} />
                <Label className="text-sm">Mixed Precision (FP16)</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={exportOnnx} onCheckedChange={setExportOnnx} />
                <Label className="text-sm">Export ONNX</Label>
              </div>
            </div>

            <Separator />

            <Button
              className="w-full"
              onClick={handleTrain}
              disabled={trainMutation.isPending}
            >
              {trainMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Training {selectedModel?.label}...
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4 mr-2" />
                  Start Training
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Training Results */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-green-500" />
              Training Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            {trainMutation.isPending ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <Loader2 className="h-12 w-12 animate-spin text-blue-500" />
                <p className="text-sm text-muted-foreground">Training in progress...</p>
                <p className="text-xs text-muted-foreground">Model is training on the best available GPU</p>
              </div>
            ) : lastResult ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Device</p>
                    <p className="font-semibold text-sm">
                      {(lastResult.device as Record<string, string>)?.vendor?.toUpperCase() || "CPU"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(lastResult.device as Record<string, string>)?.device_name || ""}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Data Source</p>
                    <p className="font-semibold text-sm">{lastResult.data_source}</p>
                    <p className="text-xs text-muted-foreground">{lastResult.training_samples} samples</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Training Time</p>
                    <p className="font-semibold text-sm">{lastResult.training_time_s}s</p>
                    <p className="text-xs text-muted-foreground">{lastResult.epochs_trained} epochs</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Best Accuracy</p>
                    <p className="font-semibold text-sm">
                      {((lastResult.metrics?.best_val_accuracy || 0) * 100).toFixed(1)}%
                    </p>
                    <p className="text-xs text-muted-foreground">Epoch {lastResult.best_epoch}</p>
                  </div>
                </div>

                {lastResult.onnx_path && (
                  <div className="flex items-center gap-2 p-2 rounded bg-green-500/10 text-green-700 text-xs">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>ONNX exported — ready for cross-device inference</span>
                  </div>
                )}

                {/* Training History Chart */}
                {lastResult.history && lastResult.history.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium">Training History (last 5 epochs)</p>
                    <div className="space-y-1">
                      {lastResult.history.map((h) => (
                        <div key={h.epoch} className="flex items-center gap-2 text-xs">
                          <span className="w-12 text-muted-foreground">E{h.epoch}</span>
                          <div className="flex-1">
                            <Progress value={Math.max(0, (1 - h.train_loss) * 100)} className="h-2" />
                          </div>
                          <span className="w-20 text-right">
                            loss: {h.train_loss.toFixed(4)}
                          </span>
                          <span className="w-20 text-right font-medium">
                            acc: {(h.val_accuracy * 100).toFixed(1)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Cpu className="h-12 w-12 mb-3 opacity-30" />
                <p className="text-sm">No training results yet</p>
                <p className="text-xs">Configure and start a training job</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Jobs List */}
      <JobsPanel />
    </div>
  );
}

// ─── Jobs Panel ─────────────────────────────────────────────────────────────

function JobsPanel() {
  const { data: jobsData, refetch } = trpc.mlPipeline.gpuEngine.jobs.useQuery(undefined, {
    retry: 1,
    refetchInterval: 10000,
  });

  const jobs = Object.entries(
    (jobsData as { jobs?: Record<string, Record<string, unknown>> })?.jobs || {}
  );

  if (jobs.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Workflow className="h-4 w-4" /> Training Jobs
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {jobs.map(([jobId, job]) => (
            <div key={jobId} className="flex items-center justify-between p-2 rounded border text-xs">
              <div className="flex items-center gap-3">
                <span className="font-mono text-muted-foreground">{jobId}</span>
                <span className="font-medium">{String(job.model_type || "")}</span>
              </div>
              <div className="flex items-center gap-2">
                {job.samples ? <span className="text-muted-foreground">{String(job.samples)} samples</span> : null}
                <StatusBadge status={String(job.status || "unknown")} />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Inference Tab ──────────────────────────────────────────────────────────

function InferenceTab() {
  const [modelName, setModelName] = useState("fraud_detection");
  const [targetDevice, setTargetDevice] = useState<string>("");
  const [inputText, setInputText] = useState("0.5, 0.3, 0.1, 0.8, 0.2, 0.6, 0.4, 0.7, 0.1, 0.9, 0.3");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const { data: modelsData } = trpc.mlPipeline.gpuEngine.models.useQuery(undefined, { retry: 1 });
  const { data: providersData } = trpc.mlPipeline.gpuEngine.providers.useQuery(undefined, { retry: 1 });

  const inferMutation = trpc.mlPipeline.gpuEngine.inference.useMutation({
    onSuccess: (data) => {
      setResult(data as Record<string, unknown>);
      toast.success(`Inference: ${(data as { latency_ms?: number }).latency_ms}ms on ${(data as { device_used?: string }).device_used}`);
    },
    onError: (err) => {
      toast.error(`Inference failed: ${err.message}`);
    },
  });

  const handleInfer = () => {
    const inputs = inputText.split(",").map((v) => parseFloat(v.trim()));
    inferMutation.mutate({
      modelName,
      inputs: [inputs],
      targetDevice: targetDevice || undefined,
      returnProbabilities: true,
    });
  };

  const models = modelsData as { loaded?: Record<string, unknown>; available_onnx?: string[]; model_types?: string[] } | undefined;
  const providers = (providersData as { providers?: Array<{ label: string; vendor: string }> })?.providers ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Inference Config */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-500" />
              Cross-Device Inference
            </CardTitle>
            <CardDescription>
              Run inference on ANY GPU — models are vendor-portable via ONNX
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Model</Label>
              <Select value={modelName} onValueChange={setModelName}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_TYPES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.icon} {m.label}
                    </SelectItem>
                  ))}
                  {(models?.available_onnx ?? []).filter(
                    (n: string) => !MODEL_TYPES.some((m) => m.value === n)
                  ).map((n: string) => (
                    <SelectItem key={n} value={n}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Target Device</Label>
              <Select value={targetDevice} onValueChange={setTargetDevice}>
                <SelectTrigger>
                  <SelectValue placeholder="Auto (best available)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect</SelectItem>
                  {GPU_VENDORS.map((v) => (
                    <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Input Features (comma-separated)</Label>
              <Input
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="0.5, 0.3, 0.1, ..."
                className="font-mono text-xs"
              />
            </div>

            <Button className="w-full" onClick={handleInfer} disabled={inferMutation.isPending}>
              {inferMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Running inference...</>
              ) : (
                <><Zap className="h-4 w-4 mr-2" /> Run Inference</>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Inference Result */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-green-500" /> Result
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Device</p>
                    <p className="font-semibold text-sm">{String(result.device_used)}</p>
                    <p className="text-xs text-muted-foreground font-mono">{String(result.provider_used)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Latency</p>
                    <p className="font-semibold text-sm">{String(result.latency_ms)} ms</p>
                    <p className="text-xs text-muted-foreground">Batch: {String(result.batch_size)}</p>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-xs text-muted-foreground mb-1">Predictions</p>
                  <p className="font-mono text-sm">{JSON.stringify(result.predictions)}</p>
                </div>

                {result.probabilities ? (
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground mb-1">Probabilities</p>
                    <p className="font-mono text-xs break-all">{JSON.stringify(result.probabilities)}</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Zap className="h-12 w-12 mb-3 opacity-30" />
                <p className="text-sm">No inference results yet</p>
                <p className="text-xs">Select a model and run inference</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Providers & Models */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Available Execution Providers</CardTitle>
          </CardHeader>
          <CardContent>
            {providers.length > 0 ? (
              <div className="space-y-1">
                {providers.map((p, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded border text-xs">
                    <span className="font-medium">{p.label}</span>
                    <VendorBadge vendor={p.vendor} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Connect to GPU Engine to see providers</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Loaded Models</CardTitle>
          </CardHeader>
          <CardContent>
            {models?.loaded && Object.keys(models.loaded).length > 0 ? (
              <div className="space-y-1">
                {Object.entries(models.loaded).map(([name, info]) => (
                  <div key={name} className="flex items-center justify-between p-2 rounded border text-xs">
                    <span className="font-medium">{name}</span>
                    <span className="text-muted-foreground font-mono">
                      {String((info as Record<string, unknown>)?.label || "")}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No models loaded — train a model first</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Cross-Device Workflow Tab ──────────────────────────────────────────────

function WorkflowTab() {
  const [modelType, setModelType] = useState("fraud_detection");
  const [trainDevice, setTrainDevice] = useState<string>("");
  const [inferDevice, setInferDevice] = useState<string>("");
  const [epochs, setEpochs] = useState(30);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const workflowMutation = trpc.mlPipeline.gpuEngine.trainAndDeploy.useMutation({
    onSuccess: (data) => {
      setResult(data as Record<string, unknown>);
      toast.success("Train-and-deploy workflow complete!");
    },
    onError: (err) => {
      toast.error(`Workflow failed: ${err.message}`);
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-purple-500" />
            Train on One GPU, Infer on Another
          </CardTitle>
          <CardDescription>
            Complete workflow: train model on one device, export to ONNX, deploy for inference on a different device
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Workflow Visualization */}
          <div className="flex items-center justify-center gap-3 p-4 rounded-lg bg-muted/30">
            <div className="text-center p-3 rounded-lg border bg-background">
              <CircuitBoard className="h-6 w-6 mx-auto mb-1 text-green-500" />
              <p className="text-xs font-medium">Train GPU</p>
              <p className="text-[10px] text-muted-foreground">
                {trainDevice ? trainDevice.toUpperCase() : "Auto"}
              </p>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
            <div className="text-center p-3 rounded-lg border bg-background">
              <Box className="h-6 w-6 mx-auto mb-1 text-blue-500" />
              <p className="text-xs font-medium">ONNX Model</p>
              <p className="text-[10px] text-muted-foreground">Portable</p>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
            <div className="text-center p-3 rounded-lg border bg-background">
              <Zap className="h-6 w-6 mx-auto mb-1 text-yellow-500" />
              <p className="text-xs font-medium">Infer GPU</p>
              <p className="text-[10px] text-muted-foreground">
                {inferDevice ? inferDevice.toUpperCase() : "Auto"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Model</Label>
              <Select value={modelType} onValueChange={setModelType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_TYPES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.icon} {m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Train On</Label>
              <Select value={trainDevice} onValueChange={setTrainDevice}>
                <SelectTrigger>
                  <SelectValue placeholder="Auto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect</SelectItem>
                  {GPU_VENDORS.map((v) => (
                    <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Infer On</Label>
              <Select value={inferDevice} onValueChange={setInferDevice}>
                <SelectTrigger>
                  <SelectValue placeholder="Auto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect</SelectItem>
                  {GPU_VENDORS.map((v) => (
                    <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Epochs</Label>
              <Input type="number" value={epochs} onChange={(e) => setEpochs(Number(e.target.value))} />
            </div>
          </div>

          <Button
            className="w-full"
            onClick={() => workflowMutation.mutate({
              modelType,
              trainDevice: trainDevice || undefined,
              inferDevice: inferDevice || undefined,
              epochs,
            })}
            disabled={workflowMutation.isPending}
          >
            {workflowMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Running workflow...</>
            ) : (
              <><Workflow className="h-4 w-4 mr-2" /> Train &amp; Deploy</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Workflow Result */}
      {result && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" /> Workflow Result
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Data Source</p>
                <p className="font-semibold text-sm">{String(result.data_source)}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Training Device</p>
                <p className="font-semibold text-sm">
                  {String(((result.training as Record<string, unknown>)?.device as Record<string, unknown>)?.vendor || "CPU").toUpperCase()}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Inference Device</p>
                <p className="font-semibold text-sm">
                  {String((result.inference as Record<string, unknown>)?.label || "N/A")}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Training Time</p>
                <p className="font-semibold text-sm">
                  {String((result.training as Record<string, unknown>)?.training_time_s || 0)}s
                </p>
              </div>
            </div>
            {result.test_prediction ? (
              <div className="mt-3 p-3 rounded-lg bg-green-500/10 text-xs">
                <p className="font-medium text-green-700 mb-1">Test Prediction Verified</p>
                <p className="font-mono">
                  Latency: {String((result.test_prediction as Record<string, unknown>)?.latency_ms)}ms,
                  Device: {String((result.test_prediction as Record<string, unknown>)?.inference_device)}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Remote Nodes Tab ───────────────────────────────────────────────────────

function RemoteNodesTab() {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newNode, setNewNode] = useState({ nodeId: "", host: "", port: 8120, gpuVendor: "" });

  const { data: nodesData, refetch } = trpc.mlPipeline.gpuEngine.remoteNodes.useQuery(undefined, { retry: 1 });

  const registerMutation = trpc.mlPipeline.gpuEngine.registerNode.useMutation({
    onSuccess: () => {
      toast.success("Remote node registered");
      setShowAddDialog(false);
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const nodes = ((nodesData as { nodes?: RemoteNode[] })?.nodes) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Server className="h-5 w-5 text-blue-500" />
            Remote GPU Nodes
          </h3>
          <p className="text-sm text-muted-foreground">
            Register remote machines for distributed training &amp; inference
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setShowAddDialog(true)}>
            <Server className="h-4 w-4 mr-1" /> Add Node
          </Button>
        </div>
      </div>

      {nodes.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {nodes.map((node) => (
            <Card key={node.node_id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{node.node_id}</CardTitle>
                  <StatusBadge status={node.status} />
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Host</span>
                  <span className="font-mono">{node.host}:{node.port}</span>
                </div>
                {node.gpu_vendor && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">GPU</span>
                    <VendorBadge vendor={node.gpu_vendor} />
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Registered</span>
                  <span>{new Date(node.registered_at).toLocaleDateString()}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-muted-foreground">
              <Network className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm">No remote nodes registered</p>
              <p className="text-xs">Add a remote GPU machine to enable distributed training</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Distributed Training Info */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">How Remote Training Works</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-2">
          <div className="flex items-start gap-2">
            <span className="font-bold text-foreground">1.</span>
            <span>Deploy the GPU Training Engine on a remote machine with GPU (e.g., NVIDIA server)</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-bold text-foreground">2.</span>
            <span>Register the node here with its host/port</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-bold text-foreground">3.</span>
            <span>Dispatch training to the remote GPU — model trains and exports to ONNX</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-bold text-foreground">4.</span>
            <span>Transfer the ONNX model back — run inference locally on any GPU or CPU</span>
          </div>
        </CardContent>
      </Card>

      {/* Add Node Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register Remote GPU Node</DialogTitle>
            <DialogDescription>
              Add a remote machine running the GPU Training Engine service
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Node ID</Label>
              <Input
                value={newNode.nodeId}
                onChange={(e) => setNewNode({ ...newNode, nodeId: e.target.value })}
                placeholder="e.g., gpu-server-1"
              />
            </div>
            <div className="space-y-2">
              <Label>Host</Label>
              <Input
                value={newNode.host}
                onChange={(e) => setNewNode({ ...newNode, host: e.target.value })}
                placeholder="e.g., 192.168.1.100"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Port</Label>
                <Input
                  type="number"
                  value={newNode.port}
                  onChange={(e) => setNewNode({ ...newNode, port: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>GPU Vendor</Label>
                <Select value={newNode.gpuVendor} onValueChange={(v) => setNewNode({ ...newNode, gpuVendor: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {GPU_VENDORS.filter((v) => v.value !== "cpu").map((v) => (
                      <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button
              onClick={() =>
                registerMutation.mutate({
                  nodeId: newNode.nodeId,
                  host: newNode.host,
                  port: newNode.port,
                  gpuVendor: newNode.gpuVendor || undefined,
                })
              }
              disabled={!newNode.nodeId || !newNode.host || registerMutation.isPending}
            >
              {registerMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Register"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Export & Benchmark Tab ─────────────────────────────────────────────────

function ExportBenchmarkTab() {
  const [exportModel, setExportModel] = useState("fraud_detection");
  const [exportFormat, setExportFormat] = useState("tensorrt");
  const [benchModel, setBenchModel] = useState("fraud_detection");
  const [benchInputShape, setBenchInputShape] = useState("11");
  const [benchResult, setBenchResult] = useState<Record<string, unknown> | null>(null);
  const [exportResult, setExportResult] = useState<Record<string, unknown> | null>(null);

  const exportMutation = trpc.mlPipeline.gpuEngine.exportModel.useMutation({
    onSuccess: (data) => {
      setExportResult(data as Record<string, unknown>);
      toast.success(`Exported to ${(data as { target_format?: string }).target_format}`);
    },
    onError: (err) => toast.error(`Export failed: ${err.message}`),
  });

  const benchmarkMutation = trpc.mlPipeline.gpuEngine.benchmark.useMutation({
    onSuccess: (data) => {
      setBenchResult(data as Record<string, unknown>);
      toast.success("Benchmark complete");
    },
    onError: (err) => toast.error(`Benchmark failed: ${err.message}`),
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Model Export */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5 text-blue-500" />
              Model Export &amp; Conversion
            </CardTitle>
            <CardDescription>
              Convert ONNX to vendor-optimized formats
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Source Model</Label>
              <Select value={exportModel} onValueChange={setExportModel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODEL_TYPES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.icon} {m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Target Format</Label>
              <Select value={exportFormat} onValueChange={setExportFormat}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPORT_FORMATS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label} — {f.desc}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              onClick={() => exportMutation.mutate({
                modelName: exportModel,
                targetFormat: exportFormat as "onnx" | "tensorrt" | "openvino" | "coreml" | "quantized",
              })}
              disabled={exportMutation.isPending}
            >
              {exportMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Exporting...</>
              ) : (
                <><Download className="h-4 w-4 mr-2" /> Export</>
              )}
            </Button>

            {exportResult && (
              <div className="p-3 rounded-lg bg-green-500/10 text-xs">
                <p className="font-medium text-green-700">
                  {String(exportResult.model_name)} → {String(exportResult.target_format)}
                </p>
                <p className="text-muted-foreground">
                  Size: {String(exportResult.size_mb)} MB
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Benchmark */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-5 w-5 text-orange-500" />
              Inference Benchmark
            </CardTitle>
            <CardDescription>
              Profile latency and throughput on current device
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Model</Label>
              <Select value={benchModel} onValueChange={setBenchModel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODEL_TYPES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.icon} {m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Input Feature Count</Label>
              <Input
                value={benchInputShape}
                onChange={(e) => setBenchInputShape(e.target.value)}
                placeholder="e.g., 11"
              />
            </div>
            <Button
              className="w-full"
              onClick={() => benchmarkMutation.mutate({
                modelName: benchModel,
                inputShape: benchInputShape.split(",").map((v) => parseInt(v.trim())),
                batchSize: 1,
                iterations: 100,
              })}
              disabled={benchmarkMutation.isPending}
            >
              {benchmarkMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Benchmarking...</>
              ) : (
                <><Gauge className="h-4 w-4 mr-2" /> Run Benchmark</>
              )}
            </Button>

            {benchResult && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 mb-2">
                  <VendorBadge vendor={String((benchResult as Record<string, unknown>).label || "cpu").toLowerCase()} />
                  <span className="text-xs font-mono">{String(benchResult.provider)}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {Object.entries((benchResult.latency_ms || {}) as Record<string, number>).map(([key, val]) => (
                    <div key={key} className="flex justify-between p-2 rounded bg-muted/50">
                      <span className="text-muted-foreground">{key}</span>
                      <span className="font-mono">{val} ms</span>
                    </div>
                  ))}
                </div>
                <div className="p-3 rounded-lg bg-blue-500/10 text-center">
                  <p className="text-xs text-muted-foreground">Throughput</p>
                  <p className="text-lg font-bold text-blue-700">
                    {String(benchResult.throughput_samples_per_sec)} samples/sec
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function GPUTrainingEngine() {
  const { t } = useTranslation();

  const { data: healthData, isLoading: healthLoading } = trpc.mlPipeline.gpuEngine.devices.useQuery(
    undefined,
    { retry: 1, refetchInterval: 30000 }
  );

  const health = healthData as {
    total?: number;
    gpu_count?: number;
    best_device?: DeviceInfo;
  } | undefined;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CircuitBoard className="h-7 w-7 text-purple-500" />
              GPU Training Engine
            </h1>
            <p className="text-muted-foreground mt-1">
              Train on any GPU — NVIDIA, AMD, Intel, Huawei, Apple — infer on any other
            </p>
          </div>
          <div className="flex items-center gap-3">
            {health?.best_device && (
              <div className="text-right text-xs">
                <p className="text-muted-foreground">Best Device</p>
                <p className="font-medium">{health.best_device.device_name}</p>
              </div>
            )}
            <VendorBadge vendor={health?.best_device?.vendor || "cpu"} />
          </div>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-3">
                <Monitor className="h-8 w-8 text-blue-500" />
                <div>
                  <p className="text-2xl font-bold">{health?.total ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">Devices</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-3">
                <Cpu className="h-8 w-8 text-green-500" />
                <div>
                  <p className="text-2xl font-bold">{health?.gpu_count ?? 0}</p>
                  <p className="text-xs text-muted-foreground">GPUs</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-3">
                <Layers className="h-8 w-8 text-purple-500" />
                <div>
                  <p className="text-2xl font-bold">5</p>
                  <p className="text-xs text-muted-foreground">Model Types</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-3">
                <ArrowLeftRight className="h-8 w-8 text-orange-500" />
                <div>
                  <p className="text-2xl font-bold">10</p>
                  <p className="text-xs text-muted-foreground">Inference Providers</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="devices" className="space-y-4">
          <TabsList className="grid grid-cols-5 w-full max-w-2xl">
            <TabsTrigger value="devices" className="text-xs">
              <CircuitBoard className="h-3 w-3 mr-1" /> Devices
            </TabsTrigger>
            <TabsTrigger value="training" className="text-xs">
              <Rocket className="h-3 w-3 mr-1" /> Training
            </TabsTrigger>
            <TabsTrigger value="inference" className="text-xs">
              <Zap className="h-3 w-3 mr-1" /> Inference
            </TabsTrigger>
            <TabsTrigger value="workflow" className="text-xs">
              <ArrowLeftRight className="h-3 w-3 mr-1" /> Cross-GPU
            </TabsTrigger>
            <TabsTrigger value="remote" className="text-xs">
              <Server className="h-3 w-3 mr-1" /> Remote
            </TabsTrigger>
          </TabsList>

          <TabsContent value="devices"><DevicesTab /></TabsContent>
          <TabsContent value="training"><TrainingTab /></TabsContent>
          <TabsContent value="inference"><InferenceTab /></TabsContent>
          <TabsContent value="workflow"><WorkflowTab /></TabsContent>
          <TabsContent value="remote"><RemoteNodesTab /></TabsContent>
        </Tabs>

        {/* Export & Benchmark (always visible) */}
        <Separator />
        <ExportBenchmarkTab />
      </div>
    </DashboardLayout>
  );
}
