/**
 * GPU Training Engine — Standalone PWA
 *
 * Platform-agnostic, role-based, guided-workflow GPU training dashboard.
 * No RemitFlow or project-specific dependencies.
 */
import { useState, useEffect, useCallback } from "react";
import { Toaster, toast } from "sonner";
import {
  Cpu, Monitor, Zap, RefreshCw, Download, Server, Network, Activity,
  BarChart3, Clock, CheckCircle2, XCircle, AlertCircle, Loader2,
  Settings, Layers, ArrowRight, ArrowLeftRight, Gauge, CircuitBoard,
  Rocket, ChevronRight, ChevronLeft, Play, User, LogOut, Shield,
  Workflow, HelpCircle, Globe, Box, Scan, Code, FileText, LayoutGrid,
  Image, Table, LineChart, Share2,
} from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { useAuth, useConnection, useWorkflow, useDeviceCache } from "@/lib/store";
import * as api from "@/lib/api";
import type {
  DeviceInfo, TrainingJob, RemoteNode, InferenceResult,
  BenchmarkResult, ExportResult, WorkflowResult, Role, GpuVendor,
  ModelPreset, WorkflowType,
} from "@/types";
import { ROLE_LABELS, ROLE_PERMISSIONS, DEFAULT_MODEL_PRESETS } from "@/types";

// ─── Constants ──────────────────────────────────────────────────────────────

const GPU_VENDORS: { value: GpuVendor; label: string; color: string }[] = [
  { value: "nvidia", label: "NVIDIA (CUDA)", color: "bg-green-500" },
  { value: "amd", label: "AMD (ROCm)", color: "bg-red-500" },
  { value: "intel", label: "Intel (XPU)", color: "bg-blue-500" },
  { value: "huawei", label: "Huawei (Ascend)", color: "bg-orange-500" },
  { value: "apple", label: "Apple (MPS)", color: "bg-gray-500" },
  { value: "cpu", label: "CPU", color: "bg-slate-500" },
];

const EXPORT_FORMATS = [
  { value: "onnx", label: "ONNX", desc: "Universal (any GPU)" },
  { value: "tensorrt", label: "TensorRT", desc: "NVIDIA optimized" },
  { value: "openvino", label: "OpenVINO", desc: "Intel optimized" },
  { value: "coreml", label: "CoreML", desc: "Apple optimized" },
  { value: "quantized", label: "INT8 Quantized", desc: "CPU fast (2-4x speedup)" },
];

const VENDOR_COLORS: Record<string, string> = {
  nvidia: "bg-green-500/10 text-green-700 border-green-300",
  amd: "bg-red-500/10 text-red-700 border-red-300",
  intel: "bg-blue-500/10 text-blue-700 border-blue-300",
  huawei: "bg-orange-500/10 text-orange-700 border-orange-300",
  apple: "bg-gray-500/10 text-gray-700 border-gray-300",
  cpu: "bg-slate-500/10 text-slate-700 border-slate-300",
};

const MODEL_ICON: Record<string, React.ReactNode> = {
  image: <Image className="h-4 w-4" />,
  text: <FileText className="h-4 w-4" />,
  table: <Table className="h-4 w-4" />,
  chart: <LineChart className="h-4 w-4" />,
  network: <Share2 className="h-4 w-4" />,
  scan: <Scan className="h-4 w-4" />,
  code: <Code className="h-4 w-4" />,
};

// ─── Shared UI Components ───────────────────────────────────────────────────

function VendorBadge({ vendor }: { vendor: string }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border", VENDOR_COLORS[vendor] || "bg-gray-100 text-gray-700")}>
      {vendor.toUpperCase()}
    </span>
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
  return <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", styles[status] || "bg-gray-100")}>{status}</span>;
}

function RoleBadge({ role }: { role: Role }) {
  const colors: Record<Role, string> = {
    admin: "bg-purple-500/10 text-purple-700",
    ml_engineer: "bg-blue-500/10 text-blue-700",
    data_scientist: "bg-green-500/10 text-green-700",
    viewer: "bg-gray-500/10 text-gray-700",
  };
  return <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", colors[role])}>{ROLE_LABELS[role]}</span>;
}

function PermissionGate({ permission, children, fallback }: {
  permission: keyof typeof ROLE_PERMISSIONS.admin;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const can = useAuth((s) => s.can);
  if (!can(permission)) {
    return fallback ? <>{fallback}</> : (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <Shield className="h-8 w-8 mb-2 opacity-30" />
        <p className="text-sm">Insufficient permissions</p>
        <p className="text-xs">This action requires a higher role</p>
      </div>
    );
  }
  return <>{children}</>;
}

// ─── Guided Workflow Wizard ─────────────────────────────────────────────────

function WorkflowWizard() {
  const { activeWorkflow, steps, currentStep, nextStep, prevStep, cancelWorkflow, completeStep } = useWorkflow();
  if (!activeWorkflow) return null;

  const step = steps[currentStep];
  const progress = ((currentStep + 1) / steps.length) * 100;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Workflow className="h-5 w-5 text-purple-500" />
              {activeWorkflow.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())} Workflow
            </h2>
            <button onClick={cancelWorkflow} className="text-gray-400 hover:text-gray-600 text-sm">Cancel</button>
          </div>
          {/* Step progress */}
          <div className="flex items-center gap-1">
            {steps.map((s, i) => (
              <div key={s.id} className="flex items-center flex-1">
                <div className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors",
                  s.completed ? "bg-green-500 text-white border-green-500" :
                  s.active ? "bg-purple-500 text-white border-purple-500" :
                  "bg-gray-100 text-gray-400 border-gray-200"
                )}>
                  {s.completed ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </div>
                {i < steps.length - 1 && (
                  <div className={cn("flex-1 h-0.5 mx-1", i < currentStep ? "bg-green-500" : "bg-gray-200")} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="p-6 min-h-[200px]">
          <h3 className="text-xl font-semibold mb-1">{step?.title}</h3>
          <p className="text-sm text-muted-foreground mb-6">{step?.description}</p>
          <WorkflowStepContent workflow={activeWorkflow} stepId={step?.id || ""} />
        </div>

        {/* Footer */}
        <div className="p-4 border-t flex items-center justify-between">
          <button
            onClick={prevStep}
            disabled={currentStep === 0}
            className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-30 hover:bg-gray-100"
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
          <span className="text-xs text-muted-foreground">
            Step {currentStep + 1} of {steps.length}
          </span>
          <button
            onClick={() => {
              completeStep(step?.id || "");
              if (currentStep === steps.length - 1) {
                cancelWorkflow();
                toast.success("Workflow complete!");
              } else {
                nextStep();
              }
            }}
            className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700"
          >
            {currentStep === steps.length - 1 ? "Finish" : "Next"} <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkflowStepContent({ workflow, stepId }: { workflow: WorkflowType; stepId: string }) {
  const tips: Record<string, Record<string, { text: string; icon: React.ReactNode }>> = {
    onboarding: {
      welcome: { text: "This engine lets you train ML models on any GPU (NVIDIA, AMD, Intel, Huawei, Apple) and run inference on any other — including CPU. Models are portable via ONNX format.", icon: <CircuitBoard className="h-12 w-12 text-purple-500" /> },
      connect: { text: "Enter your GPU Training Engine API URL. The engine runs as a standalone service on any machine — local, cloud, or on-premise. Default: http://localhost:8120", icon: <Globe className="h-12 w-12 text-blue-500" /> },
      scan: { text: "Click 'Scan Hardware' on the Devices tab to auto-detect all available GPUs and compute backends on the connected machine.", icon: <Scan className="h-12 w-12 text-green-500" /> },
      first_train: { text: "Go to the Training tab, select a model preset, and click 'Start Training'. The engine will auto-select the best available GPU.", icon: <Rocket className="h-12 w-12 text-orange-500" /> },
      done: { text: "You're ready to use the GPU Training Engine! Explore the tabs: Devices, Training, Inference, Cross-GPU, and Remote.", icon: <CheckCircle2 className="h-12 w-12 text-green-500" /> },
    },
    training: {
      select_model: { text: "Choose a model preset (Image Classifier, Text Classifier, etc.) or use a custom PyTorch model. Each preset configures the right architecture and defaults.", icon: <Layers className="h-12 w-12 text-purple-500" /> },
      configure: { text: "Tune hyperparameters: epochs, batch size, learning rate. Enable mixed precision (FP16) for 2x faster training on modern GPUs. Choose synthetic data or upload your dataset.", icon: <Settings className="h-12 w-12 text-blue-500" /> },
      select_gpu: { text: "Pick a specific GPU vendor or leave on 'Auto' to use the best available. The engine detects NVIDIA/CUDA, AMD/ROCm, Intel/XPU, Huawei/Ascend, and Apple/MPS.", icon: <CircuitBoard className="h-12 w-12 text-green-500" /> },
      train: { text: "Click 'Start Training'. The engine handles device allocation, mixed precision, gradient accumulation, and early stopping. Monitor real-time metrics.", icon: <Rocket className="h-12 w-12 text-orange-500" /> },
      review: { text: "Review accuracy, loss curves, training time, and device utilization. If ONNX export was enabled, the model is ready for cross-device inference.", icon: <BarChart3 className="h-12 w-12 text-green-500" /> },
    },
    inference: {
      select_model: { text: "Choose any trained model — either from local storage or a recently trained model. ONNX models can run on any GPU vendor.", icon: <Layers className="h-12 w-12 text-purple-500" /> },
      select_device: { text: "Pick any device — you can train on NVIDIA and infer on AMD, Intel, or CPU. The ONNX runtime handles the translation.", icon: <CircuitBoard className="h-12 w-12 text-blue-500" /> },
      prepare_input: { text: "Enter input data as comma-separated numbers matching your model's input shape. For image models, provide the flattened tensor.", icon: <FileText className="h-12 w-12 text-orange-500" /> },
      run: { text: "Execute inference. Results show predictions, probabilities, latency, and which execution provider was used.", icon: <Zap className="h-12 w-12 text-yellow-500" /> },
    },
    cross_gpu: {
      select_model: { text: "Select the model to train. This workflow trains on one GPU vendor and deploys inference on a completely different one.", icon: <Layers className="h-12 w-12 text-purple-500" /> },
      train_gpu: { text: "Choose which GPU to train on (e.g., NVIDIA A100). Training uses native PyTorch with vendor-specific optimizations.", icon: <CircuitBoard className="h-12 w-12 text-green-500" /> },
      export_onnx: { text: "After training, the model is automatically exported to ONNX — the universal format that runs on any hardware.", icon: <Download className="h-12 w-12 text-blue-500" /> },
      infer_gpu: { text: "Select a different GPU for inference (e.g., AMD MI250X, Intel Max, or CPU). ONNX Runtime handles the hardware translation.", icon: <Zap className="h-12 w-12 text-yellow-500" /> },
      deploy: { text: "Execute the full pipeline: train → export → deploy → test prediction. Verify that cross-GPU portability works.", icon: <Rocket className="h-12 w-12 text-orange-500" /> },
    },
    remote_setup: {
      add_node: { text: "Enter the hostname/IP, port, and GPU type of a remote machine running the GPU Training Engine service.", icon: <Server className="h-12 w-12 text-blue-500" /> },
      verify: { text: "The engine pings the remote node to verify connectivity and detect its GPU hardware.", icon: <Activity className="h-12 w-12 text-green-500" /> },
      dispatch: { text: "Send a training job to the remote node. It trains on the remote GPU and exports to ONNX automatically.", icon: <Rocket className="h-12 w-12 text-orange-500" /> },
      transfer: { text: "Pull the trained ONNX model back to your local machine. Run inference locally on any device.", icon: <Download className="h-12 w-12 text-purple-500" /> },
    },
  };

  const tip = tips[workflow]?.[stepId];
  if (!tip) return <p className="text-muted-foreground">Continue to the next step.</p>;

  return (
    <div className="flex flex-col items-center text-center gap-4">
      {tip.icon}
      <p className="text-sm leading-relaxed max-w-md">{tip.text}</p>
    </div>
  );
}

// ─── Login Page ─────────────────────────────────────────────────────────────

function LoginPage() {
  const login = useAuth((s) => s.login);
  const { apiUrl, setApiUrl } = useConnection();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("ml_engineer");
  const [url, setUrl] = useState(apiUrl);

  const handleLogin = () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setApiUrl(url);
    api.setBaseUrl(url);
    login({ id: crypto.randomUUID(), name: name.trim(), email: email.trim(), role }, undefined);
    toast.success(`Welcome, ${name.trim()}!`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 dark:from-gray-950 dark:to-gray-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-md w-full p-8 space-y-6">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mx-auto mb-4">
            <CircuitBoard className="h-8 w-8 text-purple-600" />
          </div>
          <h1 className="text-2xl font-bold">GPU Training Engine</h1>
          <p className="text-sm text-muted-foreground mt-1">Train on any GPU — infer on any other</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-background text-sm" placeholder="Your name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email (optional)</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-background text-sm" placeholder="your@email.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Role</label>
            <select
              value={role} onChange={(e) => setRole(e.target.value as Role)}
              className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
            >
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              {role === "admin" && "Full access to all features, user management, and node management"}
              {role === "ml_engineer" && "Can train, infer, export, benchmark, and manage remote nodes"}
              {role === "data_scientist" && "Can train, infer, and benchmark — no export or node management"}
              {role === "viewer" && "Read-only access to view devices, models, and results"}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">GPU Engine API URL</label>
            <input
              type="url" value={url} onChange={(e) => setUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-background text-sm font-mono" placeholder="http://localhost:8120"
            />
            <p className="text-xs text-muted-foreground mt-1">
              The GPU Training Engine server. Can be local or remote.
            </p>
          </div>
        </div>

        <button onClick={handleLogin} className="w-full py-2.5 rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-700 transition-colors">
          Sign In
        </button>

        <p className="text-xs text-center text-muted-foreground">
          Platform-agnostic — works with any project, any GPU
        </p>
      </div>
    </div>
  );
}

// ─── Onboarding Banner ──────────────────────────────────────────────────────

function OnboardingBanner() {
  const { showOnboarding, dismissOnboarding, startWorkflow } = useWorkflow();
  if (!showOnboarding) return null;

  return (
    <div className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-200 dark:border-purple-800 rounded-xl p-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <HelpCircle className="h-8 w-8 text-purple-500 shrink-0" />
        <div>
          <p className="font-semibold text-sm">New to GPU Training Engine?</p>
          <p className="text-xs text-muted-foreground">Take a guided tour to learn how to train on any GPU and infer on any other.</p>
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <button onClick={dismissOnboarding} className="px-3 py-1.5 rounded-lg text-xs border hover:bg-gray-50">Dismiss</button>
        <button onClick={() => { startWorkflow("onboarding"); dismissOnboarding(); }} className="px-3 py-1.5 rounded-lg text-xs bg-purple-600 text-white hover:bg-purple-700">Start Tour</button>
      </div>
    </div>
  );
}

// ─── Workflow Launcher ──────────────────────────────────────────────────────

function WorkflowLauncher() {
  const { startWorkflow } = useWorkflow();
  const can = useAuth((s) => s.can);

  const workflows: { type: WorkflowType; title: string; desc: string; icon: React.ReactNode; permission?: keyof typeof ROLE_PERMISSIONS.admin }[] = [
    { type: "training", title: "Training Workflow", desc: "Step-by-step model training", icon: <Rocket className="h-5 w-5 text-blue-500" />, permission: "canTrain" },
    { type: "inference", title: "Inference Workflow", desc: "Run inference on any device", icon: <Zap className="h-5 w-5 text-yellow-500" />, permission: "canInfer" },
    { type: "cross_gpu", title: "Cross-GPU Workflow", desc: "Train on one GPU, infer on another", icon: <ArrowLeftRight className="h-5 w-5 text-purple-500" />, permission: "canTrain" },
    { type: "remote_setup", title: "Remote Node Setup", desc: "Configure distributed training", icon: <Server className="h-5 w-5 text-green-500" />, permission: "canManageNodes" },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {workflows.map((w) => {
        const allowed = !w.permission || can(w.permission);
        return (
          <button
            key={w.type}
            onClick={() => allowed && startWorkflow(w.type)}
            disabled={!allowed}
            className={cn(
              "p-4 rounded-xl border text-left transition-all",
              allowed ? "hover:border-purple-300 hover:shadow-md cursor-pointer" : "opacity-50 cursor-not-allowed"
            )}
          >
            <div className="flex items-center gap-2 mb-2">{w.icon}<span className="font-semibold text-sm">{w.title}</span></div>
            <p className="text-xs text-muted-foreground">{w.desc}</p>
          </button>
        );
      })}
    </div>
  );
}

// ─── Devices Page ───────────────────────────────────────────────────────────

function DevicesPage() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [gpuCount, setGpuCount] = useState(0);
  const { setDevices: cacheDevices } = useDeviceCache();

  const scan = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getDevices();
      setDevices(data.devices);
      setGpuCount(data.gpu_count);
      cacheDevices(data.devices);
    } catch (err) {
      toast.error(`Scan failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  }, [cacheDevices]);

  useEffect(() => { scan(); }, [scan]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <CircuitBoard className="h-5 w-5 text-purple-500" /> Hardware Inventory
          </h3>
          <p className="text-sm text-muted-foreground">{devices.length} device(s) — {gpuCount} GPU(s) + CPU</p>
        </div>
        <button onClick={scan} disabled={loading} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm hover:bg-gray-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Scan
        </button>
      </div>

      {loading && devices.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => <div key={i} className="h-40 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {devices.map((d, i) => (
            <div key={i} className={cn("rounded-xl border p-4 space-y-3", !d.is_available && "opacity-50")}>
              <div className="flex items-center justify-between">
                <VendorBadge vendor={d.vendor} />
                {d.is_available ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
              </div>
              <p className="font-semibold text-sm">{d.device_name}</p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Backend</span><span className="font-mono">{d.backend}</span></div>
                {d.memory_total_mb > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Memory</span><span>{formatBytes(d.memory_total_mb)}</span></div>}
                {d.compute_capability && <div className="flex justify-between"><span className="text-muted-foreground">Compute</span><span className="font-mono">{d.compute_capability}</span></div>}
                {d.driver_version && <div className="flex justify-between"><span className="text-muted-foreground">Driver</span><span className="font-mono">{d.driver_version}</span></div>}
                <div className="flex justify-between"><span className="text-muted-foreground">Priority</span><span>{d.priority === 100 ? "Fallback" : `#${d.priority}`}</span></div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border p-4">
        <p className="font-semibold text-sm mb-3">Supported GPU Vendors & Backends</p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
          {GPU_VENDORS.map((v) => (
            <div key={v.value} className="flex items-center gap-2 p-2 rounded-lg border">
              <div className={cn("w-2 h-2 rounded-full", v.color)} />
              <span>{v.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Training Page ──────────────────────────────────────────────────────────

function TrainingPage() {
  const [preset, setPreset] = useState<ModelPreset>(DEFAULT_MODEL_PRESETS[2]);
  const [preferredDevice, setPreferredDevice] = useState("");
  const [epochs, setEpochs] = useState(preset.default_epochs);
  const [batchSize, setBatchSize] = useState(preset.default_batch_size);
  const [lr, setLr] = useState(preset.default_lr);
  const [mixedPrecision, setMixedPrecision] = useState(true);
  const [exportOnnx, setExportOnnx] = useState(true);
  const [dataSource, setDataSource] = useState("synthetic");
  const [training, setTraining] = useState(false);
  const [result, setResult] = useState<TrainingJob | null>(null);

  const handlePresetChange = (id: string) => {
    const p = DEFAULT_MODEL_PRESETS.find((m) => m.id === id);
    if (p) { setPreset(p); setEpochs(p.default_epochs); setBatchSize(p.default_batch_size); setLr(p.default_lr); }
  };

  const handleTrain = async () => {
    setTraining(true);
    try {
      const data = await api.train({
        modelType: preset.id, preferredDevice: preferredDevice || undefined,
        epochs, batchSize, learningRate: lr, mixedPrecision, exportOnnx, dataSource,
      });
      setResult(data);
      toast.success(`Training complete — ${data.epochs_trained} epochs on ${data.device?.vendor?.toUpperCase() || "CPU"}`);
    } catch (err) {
      toast.error(`Training failed: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setTraining(false);
    }
  };

  return (
    <PermissionGate permission="canTrain">
      <div className="space-y-4">
        {/* Model Preset Selector */}
        <div className="rounded-xl border p-4">
          <p className="font-semibold text-sm mb-3 flex items-center gap-2"><Layers className="h-4 w-4 text-purple-500" /> Model Presets</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
            {DEFAULT_MODEL_PRESETS.map((m) => (
              <button key={m.id} onClick={() => handlePresetChange(m.id)}
                className={cn("p-3 rounded-lg border text-center transition-all text-xs",
                  preset.id === m.id ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20" : "hover:border-gray-300"
                )}>
                <div className="flex justify-center mb-1">{MODEL_ICON[m.icon] || <Code className="h-4 w-4" />}</div>
                <p className="font-medium">{m.name}</p>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">{preset.description} — {preset.architecture}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Config */}
          <div className="rounded-xl border p-4 space-y-4">
            <p className="font-semibold text-sm flex items-center gap-2"><Settings className="h-4 w-4 text-blue-500" /> Training Configuration</p>
            <div>
              <label className="block text-xs font-medium mb-1">Preferred GPU</label>
              <select value={preferredDevice} onChange={(e) => setPreferredDevice(e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-background text-sm">
                <option value="">Auto-detect best GPU</option>
                {GPU_VENDORS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Data Source</label>
              <select value={dataSource} onChange={(e) => setDataSource(e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-background text-sm">
                <option value="synthetic">Synthetic (generated)</option>
                <option value="upload">Upload dataset</option>
                <option value="url">Dataset URL</option>
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="block text-xs font-medium mb-1">Epochs</label>
                <input type="number" value={epochs} onChange={(e) => setEpochs(Number(e.target.value))} className="w-full px-3 py-2 rounded-lg border bg-background text-sm" min={1} max={1000} />
              </div>
              <div><label className="block text-xs font-medium mb-1">Batch Size</label>
                <input type="number" value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} className="w-full px-3 py-2 rounded-lg border bg-background text-sm" min={1} max={4096} />
              </div>
              <div><label className="block text-xs font-medium mb-1">Learning Rate</label>
                <input type="number" value={lr} onChange={(e) => setLr(Number(e.target.value))} step={0.0001} className="w-full px-3 py-2 rounded-lg border bg-background text-sm" />
              </div>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={mixedPrecision} onChange={(e) => setMixedPrecision(e.target.checked)} className="rounded" />
                Mixed Precision (FP16)
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={exportOnnx} onChange={(e) => setExportOnnx(e.target.checked)} className="rounded" />
                Export ONNX
              </label>
            </div>
            <button onClick={handleTrain} disabled={training} className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">
              {training ? <><Loader2 className="h-4 w-4 animate-spin" /> Training {preset.name}...</> : <><Rocket className="h-4 w-4" /> Start Training</>}
            </button>
          </div>

          {/* Results */}
          <div className="rounded-xl border p-4">
            <p className="font-semibold text-sm flex items-center gap-2 mb-4"><BarChart3 className="h-4 w-4 text-green-500" /> Training Results</p>
            {training ? (
              <div className="flex flex-col items-center py-12 gap-3">
                <Loader2 className="h-12 w-12 animate-spin text-blue-500" />
                <p className="text-sm text-muted-foreground">Training in progress...</p>
              </div>
            ) : result ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                    <p className="text-xs text-muted-foreground">Device</p>
                    <p className="font-semibold text-sm">{result.device?.vendor?.toUpperCase() || "CPU"}</p>
                    <p className="text-xs text-muted-foreground">{result.device?.device_name}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                    <p className="text-xs text-muted-foreground">Training Time</p>
                    <p className="font-semibold text-sm">{result.training_time_s}s</p>
                    <p className="text-xs text-muted-foreground">{result.epochs_trained} epochs</p>
                  </div>
                  <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                    <p className="text-xs text-muted-foreground">Best Accuracy</p>
                    <p className="font-semibold text-sm">{((result.metrics?.best_val_accuracy || 0) * 100).toFixed(1)}%</p>
                    <p className="text-xs text-muted-foreground">Epoch {result.best_epoch}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                    <p className="text-xs text-muted-foreground">Samples</p>
                    <p className="font-semibold text-sm">{result.training_samples}</p>
                    <p className="text-xs text-muted-foreground">{result.data_source}</p>
                  </div>
                </div>
                {result.onnx_path && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-green-500/10 text-green-700 text-xs">
                    <CheckCircle2 className="h-4 w-4" /> ONNX exported — ready for cross-device inference
                  </div>
                )}
                {result.history?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium mb-2">Training History</p>
                    {result.history.slice(-5).map((h) => (
                      <div key={h.epoch} className="flex items-center gap-2 text-xs mb-1">
                        <span className="w-10 text-muted-foreground">E{h.epoch}</span>
                        <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.max(0, (1 - h.train_loss) * 100)}%` }} />
                        </div>
                        <span className="w-20 text-right">loss: {h.train_loss.toFixed(4)}</span>
                        <span className="w-16 text-right font-medium">{(h.val_accuracy * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center py-12 text-muted-foreground">
                <Cpu className="h-12 w-12 mb-3 opacity-30" />
                <p className="text-sm">No training results yet</p>
                <p className="text-xs">Configure and start a training job</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </PermissionGate>
  );
}

// ─── Inference Page ─────────────────────────────────────────────────────────

function InferencePage() {
  const [modelName, setModelName] = useState("tabular_classifier");
  const [targetDevice, setTargetDevice] = useState("");
  const [inputText, setInputText] = useState("0.5, 0.3, 0.1, 0.8, 0.2, 0.6, 0.4, 0.7, 0.1, 0.9, 0.3");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<InferenceResult | null>(null);

  const handleInfer = async () => {
    setRunning(true);
    try {
      const inputs = inputText.split(",").map((v) => parseFloat(v.trim()));
      const data = await api.infer({ modelName, inputs: [inputs], targetDevice: targetDevice || undefined, returnProbabilities: true });
      setResult(data);
      toast.success(`Inference: ${data.latency_ms}ms on ${data.device_used}`);
    } catch (err) {
      toast.error(`Inference failed: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <PermissionGate permission="canInfer">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border p-4 space-y-4">
          <p className="font-semibold text-sm flex items-center gap-2"><Zap className="h-4 w-4 text-yellow-500" /> Cross-Device Inference</p>
          <p className="text-xs text-muted-foreground">Run inference on ANY GPU — models are vendor-portable via ONNX</p>
          <div>
            <label className="block text-xs font-medium mb-1">Model</label>
            <select value={modelName} onChange={(e) => setModelName(e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-background text-sm">
              {DEFAULT_MODEL_PRESETS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Target Device</label>
            <select value={targetDevice} onChange={(e) => setTargetDevice(e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-background text-sm">
              <option value="">Auto (best available)</option>
              {GPU_VENDORS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Input Features (comma-separated)</label>
            <input value={inputText} onChange={(e) => setInputText(e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-background text-sm font-mono" />
          </div>
          <button onClick={handleInfer} disabled={running} className="w-full py-2.5 rounded-lg bg-yellow-500 text-white font-medium hover:bg-yellow-600 disabled:opacity-50 flex items-center justify-center gap-2">
            {running ? <><Loader2 className="h-4 w-4 animate-spin" /> Running...</> : <><Zap className="h-4 w-4" /> Run Inference</>}
          </button>
        </div>

        <div className="rounded-xl border p-4">
          <p className="font-semibold text-sm flex items-center gap-2 mb-4"><Activity className="h-4 w-4 text-green-500" /> Result</p>
          {result ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                  <p className="text-xs text-muted-foreground">Device</p>
                  <p className="font-semibold text-sm">{result.device_used}</p>
                  <p className="text-xs text-muted-foreground font-mono">{result.provider_used}</p>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                  <p className="text-xs text-muted-foreground">Latency</p>
                  <p className="font-semibold text-sm">{result.latency_ms} ms</p>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                <p className="text-xs text-muted-foreground mb-1">Predictions</p>
                <p className="font-mono text-sm">{JSON.stringify(result.predictions)}</p>
              </div>
              {result.probabilities && (
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                  <p className="text-xs text-muted-foreground mb-1">Probabilities</p>
                  <p className="font-mono text-xs break-all">{JSON.stringify(result.probabilities)}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center py-12 text-muted-foreground">
              <Zap className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm">No inference results yet</p>
            </div>
          )}
        </div>
      </div>
    </PermissionGate>
  );
}

// ─── Cross-GPU Page ─────────────────────────────────────────────────────────

function CrossGPUPage() {
  const [modelType, setModelType] = useState("tabular_classifier");
  const [trainDevice, setTrainDevice] = useState("");
  const [inferDevice, setInferDevice] = useState("");
  const [epochs, setEpochs] = useState(30);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<WorkflowResult | null>(null);

  const handleDeploy = async () => {
    setRunning(true);
    try {
      const data = await api.trainAndDeploy({ modelType, trainDevice: trainDevice || undefined, inferDevice: inferDevice || undefined, epochs });
      setResult(data);
      toast.success("Cross-GPU workflow complete!");
    } catch (err) {
      toast.error(`Workflow failed: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <PermissionGate permission="canTrain">
      <div className="space-y-4">
        <div className="rounded-xl border p-4 space-y-4">
          <p className="font-semibold text-sm flex items-center gap-2"><ArrowLeftRight className="h-4 w-4 text-purple-500" /> Train on One GPU, Infer on Another</p>
          <p className="text-xs text-muted-foreground">Complete workflow: train → ONNX export → deploy inference on a different device</p>

          {/* Visualization */}
          <div className="flex items-center justify-center gap-3 p-4 rounded-lg bg-gray-50 dark:bg-gray-800">
            <div className="text-center p-3 rounded-lg border bg-white dark:bg-gray-900">
              <CircuitBoard className="h-6 w-6 mx-auto mb-1 text-green-500" />
              <p className="text-xs font-medium">Train GPU</p>
              <p className="text-[10px] text-muted-foreground">{trainDevice ? trainDevice.toUpperCase() : "Auto"}</p>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
            <div className="text-center p-3 rounded-lg border bg-white dark:bg-gray-900">
              <Box className="h-6 w-6 mx-auto mb-1 text-blue-500" />
              <p className="text-xs font-medium">ONNX</p>
              <p className="text-[10px] text-muted-foreground">Portable</p>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
            <div className="text-center p-3 rounded-lg border bg-white dark:bg-gray-900">
              <Zap className="h-6 w-6 mx-auto mb-1 text-yellow-500" />
              <p className="text-xs font-medium">Infer GPU</p>
              <p className="text-[10px] text-muted-foreground">{inferDevice ? inferDevice.toUpperCase() : "Auto"}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Model</label>
              <select value={modelType} onChange={(e) => setModelType(e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-background text-sm">
                {DEFAULT_MODEL_PRESETS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Train On</label>
              <select value={trainDevice} onChange={(e) => setTrainDevice(e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-background text-sm">
                <option value="">Auto</option>
                {GPU_VENDORS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Infer On</label>
              <select value={inferDevice} onChange={(e) => setInferDevice(e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-background text-sm">
                <option value="">Auto</option>
                {GPU_VENDORS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Epochs</label>
              <input type="number" value={epochs} onChange={(e) => setEpochs(Number(e.target.value))} className="w-full px-3 py-2 rounded-lg border bg-background text-sm" />
            </div>
          </div>

          <button onClick={handleDeploy} disabled={running} className="w-full py-2.5 rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {running ? <><Loader2 className="h-4 w-4 animate-spin" /> Running...</> : <><Workflow className="h-4 w-4" /> Train & Deploy</>}
          </button>
        </div>

        {result && (
          <div className="rounded-xl border p-4">
            <p className="font-semibold text-sm flex items-center gap-2 mb-3"><CheckCircle2 className="h-4 w-4 text-green-500" /> Workflow Result</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                <p className="text-xs text-muted-foreground">Data Source</p>
                <p className="font-semibold text-sm">{result.data_source}</p>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                <p className="text-xs text-muted-foreground">Training Device</p>
                <p className="font-semibold text-sm">{result.training?.device?.vendor?.toUpperCase() || "CPU"}</p>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                <p className="text-xs text-muted-foreground">Inference Device</p>
                <p className="font-semibold text-sm">{result.inference?.device_used || "N/A"}</p>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                <p className="text-xs text-muted-foreground">Training Time</p>
                <p className="font-semibold text-sm">{result.training?.training_time_s || 0}s</p>
              </div>
            </div>
            {result.test_prediction && (
              <div className="mt-3 p-3 rounded-lg bg-green-500/10 text-xs">
                <p className="font-medium text-green-700 mb-1">Test Prediction Verified</p>
                <p className="font-mono">Latency: {result.test_prediction.latency_ms}ms, Device: {result.test_prediction.inference_device}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </PermissionGate>
  );
}

// ─── Remote Nodes Page ──────────────────────────────────────────────────────

function RemotePage() {
  const [nodes, setNodes] = useState<RemoteNode[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newNode, setNewNode] = useState({ nodeId: "", host: "", port: 8120, gpuVendor: "" });
  const [loading, setLoading] = useState(false);

  const fetchNodes = useCallback(async () => {
    try {
      const data = await api.getRemoteNodes();
      setNodes(data.nodes);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchNodes(); }, [fetchNodes]);

  const handleRegister = async () => {
    setLoading(true);
    try {
      await api.registerNode({ nodeId: newNode.nodeId, host: newNode.host, port: newNode.port, gpuVendor: newNode.gpuVendor || undefined });
      toast.success("Node registered");
      setShowAdd(false);
      setNewNode({ nodeId: "", host: "", port: 8120, gpuVendor: "" });
      fetchNodes();
    } catch (err) {
      toast.error(`Failed: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PermissionGate permission="canManageNodes">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-lg flex items-center gap-2"><Server className="h-5 w-5 text-blue-500" /> Remote GPU Nodes</p>
            <p className="text-sm text-muted-foreground">Register remote machines for distributed training & inference</p>
          </div>
          <div className="flex gap-2">
            <button onClick={fetchNodes} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm hover:bg-gray-50"><RefreshCw className="h-4 w-4" /> Refresh</button>
            <button onClick={() => setShowAdd(true)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"><Server className="h-4 w-4" /> Add Node</button>
          </div>
        </div>

        {nodes.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {nodes.map((node) => (
              <div key={node.node_id} className="rounded-xl border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-sm">{node.node_id}</p>
                  <StatusBadge status={node.status} />
                </div>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Host</span><span className="font-mono">{node.host}:{node.port}</span></div>
                  {node.gpu_vendor && <div className="flex justify-between"><span className="text-muted-foreground">GPU</span><VendorBadge vendor={node.gpu_vendor} /></div>}
                  <div className="flex justify-between"><span className="text-muted-foreground">Registered</span><span>{new Date(node.registered_at).toLocaleDateString()}</span></div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border p-12 text-center text-muted-foreground">
            <Network className="h-12 w-12 mb-3 mx-auto opacity-30" />
            <p className="text-sm">No remote nodes registered</p>
            <p className="text-xs">Add a remote GPU machine to enable distributed training</p>
          </div>
        )}

        {/* How it works */}
        <div className="rounded-xl border p-4">
          <p className="font-semibold text-sm mb-3">How Remote Training Works</p>
          <div className="space-y-2 text-xs text-muted-foreground">
            {["Deploy the GPU Training Engine on a remote machine with GPU", "Register the node here with its host/port", "Dispatch training to the remote GPU — model trains and exports to ONNX", "Transfer the ONNX model back — run inference locally on any GPU or CPU"].map((text, i) => (
              <div key={i} className="flex items-start gap-2"><span className="font-bold text-foreground">{i + 1}.</span><span>{text}</span></div>
            ))}
          </div>
        </div>

        {/* Add Node Dialog */}
        {showAdd && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
              <h3 className="font-bold text-lg">Register Remote GPU Node</h3>
              <p className="text-sm text-muted-foreground">Add a remote machine running the GPU Training Engine service</p>
              <div>
                <label className="block text-xs font-medium mb-1">Node ID</label>
                <input value={newNode.nodeId} onChange={(e) => setNewNode({ ...newNode, nodeId: e.target.value })} className="w-full px-3 py-2 rounded-lg border bg-background text-sm" placeholder="e.g., gpu-server-1" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Host</label>
                <input value={newNode.host} onChange={(e) => setNewNode({ ...newNode, host: e.target.value })} className="w-full px-3 py-2 rounded-lg border bg-background text-sm" placeholder="e.g., 192.168.1.100" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Port</label>
                  <input type="number" value={newNode.port} onChange={(e) => setNewNode({ ...newNode, port: Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg border bg-background text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">GPU Vendor</label>
                  <select value={newNode.gpuVendor} onChange={(e) => setNewNode({ ...newNode, gpuVendor: e.target.value })} className="w-full px-3 py-2 rounded-lg border bg-background text-sm">
                    <option value="">Select...</option>
                    {GPU_VENDORS.filter((v) => v.value !== "cpu").map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button onClick={() => setShowAdd(false)} className="px-4 py-2 rounded-lg border text-sm">Cancel</button>
                <button onClick={handleRegister} disabled={!newNode.nodeId || !newNode.host || loading} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Register"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PermissionGate>
  );
}

// ─── Export & Benchmark Page ────────────────────────────────────────────────

function ExportBenchmarkPage() {
  const [exportModel, setExportModel] = useState("tabular_classifier");
  const [exportFormat, setExportFormat] = useState("tensorrt");
  const [benchModel, setBenchModel] = useState("tabular_classifier");
  const [benchInput, setBenchInput] = useState("11");
  const [exporting, setExporting] = useState(false);
  const [benching, setBenching] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [benchResult, setBenchResult] = useState<BenchmarkResult | null>(null);

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await api.exportModel(exportModel, exportFormat);
      setExportResult(data);
      toast.success(`Exported to ${data.target_format}`);
    } catch (err) { toast.error(`Export failed: ${err instanceof Error ? err.message : "Unknown"}`); }
    finally { setExporting(false); }
  };

  const handleBench = async () => {
    setBenching(true);
    try {
      const data = await api.benchmark(benchModel, benchInput.split(",").map(Number), 1, 100);
      setBenchResult(data);
      toast.success("Benchmark complete");
    } catch (err) { toast.error(`Benchmark failed: ${err instanceof Error ? err.message : "Unknown"}`); }
    finally { setBenching(false); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <PermissionGate permission="canExport">
        <div className="rounded-xl border p-4 space-y-4">
          <p className="font-semibold text-sm flex items-center gap-2"><Download className="h-4 w-4 text-blue-500" /> Model Export & Conversion</p>
          <div>
            <label className="block text-xs font-medium mb-1">Source Model</label>
            <select value={exportModel} onChange={(e) => setExportModel(e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-background text-sm">
              {DEFAULT_MODEL_PRESETS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Target Format</label>
            <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-background text-sm">
              {EXPORT_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label} — {f.desc}</option>)}
            </select>
          </div>
          <button onClick={handleExport} disabled={exporting} className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export
          </button>
          {exportResult && (
            <div className="p-3 rounded-lg bg-green-500/10 text-xs text-green-700">
              {exportResult.model_name} → {exportResult.target_format} ({exportResult.size_mb} MB)
            </div>
          )}
        </div>
      </PermissionGate>

      <PermissionGate permission="canBenchmark">
        <div className="rounded-xl border p-4 space-y-4">
          <p className="font-semibold text-sm flex items-center gap-2"><Gauge className="h-4 w-4 text-orange-500" /> Inference Benchmark</p>
          <div>
            <label className="block text-xs font-medium mb-1">Model</label>
            <select value={benchModel} onChange={(e) => setBenchModel(e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-background text-sm">
              {DEFAULT_MODEL_PRESETS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Input Shape</label>
            <input value={benchInput} onChange={(e) => setBenchInput(e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-background text-sm font-mono" />
          </div>
          <button onClick={handleBench} disabled={benching} className="w-full py-2.5 rounded-lg bg-orange-500 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2">
            {benching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />} Run Benchmark
          </button>
          {benchResult && (
            <div className="space-y-2">
              <div className="flex items-center gap-2"><VendorBadge vendor={benchResult.label?.toLowerCase() || "cpu"} /><span className="text-xs font-mono">{benchResult.provider}</span></div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(benchResult.latency_ms).map(([k, v]) => (
                  <div key={k} className="flex justify-between p-2 rounded-lg bg-gray-50 dark:bg-gray-800">
                    <span className="text-muted-foreground">{k}</span><span className="font-mono">{v} ms</span>
                  </div>
                ))}
              </div>
              <div className="p-3 rounded-lg bg-blue-500/10 text-center">
                <p className="text-xs text-muted-foreground">Throughput</p>
                <p className="text-lg font-bold text-blue-700">{benchResult.throughput_samples_per_sec} samples/sec</p>
              </div>
            </div>
          )}
        </div>
      </PermissionGate>
    </div>
  );
}

// ─── Settings Page ──────────────────────────────────────────────────────────

function SettingsPage() {
  const { user, setRole, logout } = useAuth();
  const { apiUrl, setApiUrl, connected, lastPing } = useConnection();
  const [url, setUrl] = useState(apiUrl);
  const [testing, setTesting] = useState(false);

  const testConnection = async () => {
    setTesting(true);
    try {
      setApiUrl(url);
      api.setBaseUrl(url);
      const start = Date.now();
      await api.healthCheck();
      const ping = Date.now() - start;
      useConnection.getState().setLastPing(ping);
      toast.success(`Connected — ${ping}ms`);
    } catch (err) {
      useConnection.getState().setConnected(false);
      toast.error(`Connection failed: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-xl border p-4 space-y-4">
        <p className="font-semibold text-sm flex items-center gap-2"><Globe className="h-4 w-4 text-blue-500" /> API Connection</p>
        <div>
          <label className="block text-xs font-medium mb-1">GPU Engine URL</label>
          <div className="flex gap-2">
            <input value={url} onChange={(e) => setUrl(e.target.value)} className="flex-1 px-3 py-2 rounded-lg border bg-background text-sm font-mono" />
            <button onClick={testConnection} disabled={testing} className="px-4 py-2 rounded-lg border text-sm flex items-center gap-1 hover:bg-gray-50">
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />} Test
            </button>
          </div>
          <div className="flex items-center gap-2 mt-2 text-xs">
            <div className={cn("w-2 h-2 rounded-full", connected ? "bg-green-500" : "bg-red-500")} />
            <span>{connected ? `Connected (${lastPing}ms)` : "Not connected"}</span>
          </div>
        </div>
      </div>

      <div className="rounded-xl border p-4 space-y-4">
        <p className="font-semibold text-sm flex items-center gap-2"><User className="h-4 w-4 text-purple-500" /> Profile & Role</p>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
            <User className="h-6 w-6 text-purple-600" />
          </div>
          <div>
            <p className="font-semibold">{user?.name}</p>
            <p className="text-xs text-muted-foreground">{user?.email || "No email"}</p>
          </div>
          <RoleBadge role={user?.role || "viewer"} />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Role</label>
          <select value={user?.role || "viewer"} onChange={(e) => setRole(e.target.value as Role)} className="w-full px-3 py-2 rounded-lg border bg-background text-sm">
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </div>
        <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
          <p className="text-xs font-medium mb-2">Permissions</p>
          <div className="grid grid-cols-2 gap-1 text-xs">
            {user && Object.entries(ROLE_PERMISSIONS[user.role]).map(([perm, val]) => (
              <div key={perm} className="flex items-center gap-1">
                {val ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <XCircle className="h-3 w-3 text-red-400" />}
                <span className={val ? "" : "text-muted-foreground"}>{perm.replace(/^can/, "").replace(/([A-Z])/g, " $1")}</span>
              </div>
            ))}
          </div>
        </div>
        <button onClick={logout} className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm text-red-600 hover:bg-red-50">
          <LogOut className="h-4 w-4" /> Sign Out
        </button>
      </div>
    </div>
  );
}

// ─── Main App Shell ─────────────────────────────────────────────────────────

type Page = "devices" | "training" | "inference" | "cross_gpu" | "remote" | "export" | "settings";

const NAV_ITEMS: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: "devices", label: "Devices", icon: <CircuitBoard className="h-4 w-4" /> },
  { id: "training", label: "Training", icon: <Rocket className="h-4 w-4" /> },
  { id: "inference", label: "Inference", icon: <Zap className="h-4 w-4" /> },
  { id: "cross_gpu", label: "Cross-GPU", icon: <ArrowLeftRight className="h-4 w-4" /> },
  { id: "remote", label: "Remote", icon: <Server className="h-4 w-4" /> },
  { id: "export", label: "Export & Bench", icon: <Download className="h-4 w-4" /> },
  { id: "settings", label: "Settings", icon: <Settings className="h-4 w-4" /> },
];

export default function App() {
  const user = useAuth((s) => s.user);
  const [page, setPage] = useState<Page>("devices");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { connected } = useConnection();

  if (!user) return <><LoginPage /><Toaster richColors position="top-right" /></>;

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      {/* Sidebar */}
      <aside className={cn("border-r bg-card flex flex-col transition-all duration-200", sidebarOpen ? "w-56" : "w-14")}>
        <div className="p-3 border-b flex items-center gap-2">
          <CircuitBoard className="h-6 w-6 text-purple-500 shrink-0" />
          {sidebarOpen && <span className="font-bold text-sm truncate">GPU Engine</span>}
        </div>

        <nav className="flex-1 py-2 space-y-0.5 px-2">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors",
                page === item.id ? "bg-purple-50 dark:bg-purple-900/20 text-purple-700 font-medium" : "text-muted-foreground hover:bg-gray-50 dark:hover:bg-gray-800"
              )}
            >
              {item.icon}
              {sidebarOpen && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shrink-0">
              <User className="h-3.5 w-3.5 text-purple-600" />
            </div>
            {sidebarOpen && (
              <div className="min-w-0">
                <p className="text-xs font-medium truncate">{user.name}</p>
                <p className="text-[10px] text-muted-foreground">{ROLE_LABELS[user.role]}</p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <header className="border-b px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
              <LayoutGrid className="h-4 w-4" />
            </button>
            <h1 className="font-bold text-lg">
              {NAV_ITEMS.find((n) => n.id === page)?.label || "GPU Training Engine"}
            </h1>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1">
              <div className={cn("w-2 h-2 rounded-full", connected ? "bg-green-500" : "bg-red-500")} />
              <span className="text-muted-foreground">{connected ? "Connected" : "Disconnected"}</span>
            </div>
            <RoleBadge role={user.role} />
          </div>
        </header>

        <div className="p-6 space-y-6">
          {/* Onboarding + Workflow launchers on devices page */}
          {page === "devices" && (
            <>
              <OnboardingBanner />
              <WorkflowLauncher />
            </>
          )}

          {page === "devices" && <DevicesPage />}
          {page === "training" && <TrainingPage />}
          {page === "inference" && <InferencePage />}
          {page === "cross_gpu" && <CrossGPUPage />}
          {page === "remote" && <RemotePage />}
          {page === "export" && <ExportBenchmarkPage />}
          {page === "settings" && <SettingsPage />}
        </div>
      </main>

      <WorkflowWizard />
      <Toaster richColors position="top-right" />
    </div>
  );
}
