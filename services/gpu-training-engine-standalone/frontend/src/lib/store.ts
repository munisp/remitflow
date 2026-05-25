/**
 * Global state (Zustand) — auth, connection, workflow progress.
 * Platform-agnostic: no RemitFlow dependencies.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User, Role, WorkflowType, WorkflowStep, DeviceInfo } from "@/types";
import { ROLE_PERMISSIONS } from "@/types";
import { setBaseUrl } from "./api";

// ─── Auth store ─────────────────────────────────────────────────────────────

interface AuthState {
  user: User | null;
  token: string | null;
  login: (user: User, token?: string) => void;
  logout: () => void;
  setRole: (role: Role) => void;
  can: (permission: keyof typeof ROLE_PERMISSIONS.admin) => boolean;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      login: (user, token) => {
        set({ user, token: token ?? null });
        if (token) localStorage.setItem("gpu_engine_token", token);
      },
      logout: () => {
        set({ user: null, token: null });
        localStorage.removeItem("gpu_engine_token");
      },
      setRole: (role) => {
        const u = get().user;
        if (u) set({ user: { ...u, role } });
      },
      can: (permission) => {
        const u = get().user;
        if (!u) return false;
        return ROLE_PERMISSIONS[u.role]?.[permission] ?? false;
      },
    }),
    { name: "gpu-engine-auth" },
  ),
);

// ─── Connection config ──────────────────────────────────────────────────────

interface ConnectionState {
  apiUrl: string;
  connected: boolean;
  lastPing: number | null;
  setApiUrl: (url: string) => void;
  setConnected: (v: boolean) => void;
  setLastPing: (ms: number) => void;
}

export const useConnection = create<ConnectionState>()(
  persist(
    (set) => ({
      apiUrl: import.meta.env.VITE_GPU_ENGINE_URL || "http://localhost:8120",
      connected: false,
      lastPing: null,
      setApiUrl: (url) => {
        set({ apiUrl: url });
        setBaseUrl(url);
      },
      setConnected: (v) => set({ connected: v }),
      setLastPing: (ms) => set({ lastPing: ms, connected: true }),
    }),
    { name: "gpu-engine-connection" },
  ),
);

// ─── Guided workflow state ──────────────────────────────────────────────────

interface WorkflowState {
  activeWorkflow: WorkflowType | null;
  steps: WorkflowStep[];
  currentStep: number;
  showOnboarding: boolean;
  startWorkflow: (type: WorkflowType) => void;
  nextStep: () => void;
  prevStep: () => void;
  completeStep: (stepId: string) => void;
  cancelWorkflow: () => void;
  dismissOnboarding: () => void;
}

const WORKFLOW_STEPS: Record<WorkflowType, Omit<WorkflowStep, "completed" | "active">[]> = {
  onboarding: [
    { id: "welcome", title: "Welcome", description: "GPU Training Engine overview" },
    { id: "connect", title: "Connect", description: "Set your GPU Engine API endpoint" },
    { id: "scan", title: "Scan Hardware", description: "Detect available GPUs" },
    { id: "first_train", title: "First Training", description: "Run a quick training job" },
    { id: "done", title: "Ready!", description: "You're all set" },
  ],
  training: [
    { id: "select_model", title: "Select Model", description: "Choose a model architecture or upload your own" },
    { id: "configure", title: "Configure", description: "Set hyperparameters and data source" },
    { id: "select_gpu", title: "Select GPU", description: "Pick a target device or auto-detect" },
    { id: "train", title: "Train", description: "Start training and monitor progress" },
    { id: "review", title: "Review Results", description: "Check metrics and export model" },
  ],
  inference: [
    { id: "select_model", title: "Select Model", description: "Choose a trained model" },
    { id: "select_device", title: "Select Device", description: "Pick inference device (can differ from training)" },
    { id: "prepare_input", title: "Prepare Input", description: "Enter input data" },
    { id: "run", title: "Run Inference", description: "Execute and view results" },
  ],
  cross_gpu: [
    { id: "select_model", title: "Select Model", description: "Choose model architecture" },
    { id: "train_gpu", title: "Training GPU", description: "Select which GPU to train on" },
    { id: "export_onnx", title: "Export to ONNX", description: "Convert to portable ONNX format" },
    { id: "infer_gpu", title: "Inference GPU", description: "Select a different GPU for inference" },
    { id: "deploy", title: "Deploy", description: "Run the full cross-GPU pipeline" },
  ],
  remote_setup: [
    { id: "add_node", title: "Add Remote Node", description: "Enter host, port, and GPU type" },
    { id: "verify", title: "Verify Connection", description: "Test connectivity to remote node" },
    { id: "dispatch", title: "Dispatch Job", description: "Send a training job to the remote node" },
    { id: "transfer", title: "Transfer Model", description: "Pull the trained model back locally" },
  ],
};

export const useWorkflow = create<WorkflowState>()(
  persist(
    (set, get) => ({
      activeWorkflow: null,
      steps: [],
      currentStep: 0,
      showOnboarding: true,
      startWorkflow: (type) => {
        const defs = WORKFLOW_STEPS[type];
        set({
          activeWorkflow: type,
          currentStep: 0,
          steps: defs.map((s, i) => ({ ...s, completed: false, active: i === 0 })),
        });
      },
      nextStep: () => {
        const { currentStep, steps } = get();
        if (currentStep < steps.length - 1) {
          const next = currentStep + 1;
          set({
            currentStep: next,
            steps: steps.map((s, i) => ({
              ...s,
              active: i === next,
              completed: i < next ? true : s.completed,
            })),
          });
        }
      },
      prevStep: () => {
        const { currentStep, steps } = get();
        if (currentStep > 0) {
          const prev = currentStep - 1;
          set({
            currentStep: prev,
            steps: steps.map((s, i) => ({ ...s, active: i === prev })),
          });
        }
      },
      completeStep: (stepId) => {
        set({
          steps: get().steps.map((s) =>
            s.id === stepId ? { ...s, completed: true } : s,
          ),
        });
      },
      cancelWorkflow: () => set({ activeWorkflow: null, steps: [], currentStep: 0 }),
      dismissOnboarding: () => set({ showOnboarding: false }),
    }),
    { name: "gpu-engine-workflow" },
  ),
);

// ─── Device cache ───────────────────────────────────────────────────────────

interface DeviceCache {
  devices: DeviceInfo[];
  lastScan: number | null;
  setDevices: (d: DeviceInfo[]) => void;
}

export const useDeviceCache = create<DeviceCache>()((set) => ({
  devices: [],
  lastScan: null,
  setDevices: (devices) => set({ devices, lastScan: Date.now() }),
}));
