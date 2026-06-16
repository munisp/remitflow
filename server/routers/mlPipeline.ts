/**
 * RemitFlow — ML Pipeline Router
 *
 * tRPC router integrating all real AI/ML/DL/GNN services:
 *   - NLU Intent Classifier (Transformer, port 8110)
 *   - FX Forecasting (LSTM+Transformer, port 8111)
 *   - GNN Fraud Detection (GAT, port 8112)
 *   - Investment ML (XGBoost/MLP, port 8122)
 *   - Ray Training Pipeline (port 8114)
 *   - MLflow Model Registry (port 8115)
 *   - ML Retraining Orchestrator (port 8116)
 *   - GPU-Agnostic Training Engine (port 8120)
 *
 * Each endpoint calls the real Python service with proper error handling
 * and circuit-breaker fallback.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure, auditedProcedure } from "../_core/trpc.js";
import { logger } from "../_core/logger.js";
import { createAuditLog } from "../db.js";

// ─── Service URLs ───────────────────────────────────────────────────────────

const NLU_URL = process.env.NLU_SERVICE_URL || "http://localhost:8110";
const FX_FORECAST_URL = process.env.FX_FORECAST_SERVICE_URL || "http://localhost:8111";
const GNN_FRAUD_URL = process.env.GNN_FRAUD_SERVICE_URL || "http://localhost:8112";
const INVESTMENT_ML_URL = process.env.INVESTMENT_ML_SERVICE_URL || "http://localhost:8122";
const RAY_TRAINING_URL = process.env.RAY_TRAINING_SERVICE_URL || "http://localhost:8114";
const MLFLOW_REGISTRY_URL = process.env.MLFLOW_REGISTRY_SERVICE_URL || "http://localhost:8115";
const ML_RETRAINING_URL = process.env.ML_RETRAINING_SERVICE_URL || "http://localhost:8116";
const GPU_ENGINE_URL = process.env.GPU_ENGINE_SERVICE_URL || "http://localhost:8120";

// ─── HTTP Client with Circuit Breaker ───────────────────────────────────────

interface CircuitState {
  failures: number;
  lastFailure: number;
  open: boolean;
}

const circuits: Record<string, CircuitState> = {};
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_RESET_MS = 30_000;

async function callMLService<T>(
  baseUrl: string,
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
  timeoutMs: number = 15_000,
): Promise<T> {
  const key = baseUrl;

  // Circuit breaker check
  const circuit = circuits[key] || { failures: 0, lastFailure: 0, open: false };
  circuits[key] = circuit;

  if (circuit.open && Date.now() - circuit.lastFailure < CIRCUIT_RESET_MS) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: `ML service at ${baseUrl} is temporarily unavailable (circuit open). Retrying in ${Math.ceil((CIRCUIT_RESET_MS - (Date.now() - circuit.lastFailure)) / 1000)}s.`,
    });
  }

  if (circuit.open) {
    circuit.open = false;
    circuit.failures = 0;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    };
    if (body && method === "POST") {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    circuit.failures = 0;
    return await response.json() as T;
  } catch (err: unknown) {
    circuit.failures += 1;
    circuit.lastFailure = Date.now();
    if (circuit.failures >= CIRCUIT_THRESHOLD) {
      circuit.open = true;
      logger.warn(`Circuit breaker OPEN for ${baseUrl} after ${circuit.failures} failures`);
    }

    const message = err instanceof Error ? err.message : String(err);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `ML service error (${baseUrl}): ${message}`,
    });
  } finally {
    clearTimeout(timeout);
  }
}

// ─── NLU Intent Classifier ──────────────────────────────────────────────────

const nluRouter = router({
  classify: protectedProcedure
    .input(z.object({
      text: z.string().min(1).max(500),
      includeAllScores: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      return callMLService<{
        intent: string;
        confidence: number;
        entities: Record<string, unknown>;
        all_scores?: Record<string, number>;
        latency_ms: number;
      }>(NLU_URL, "/classify", "POST", {
        text: input.text,
        include_all_scores: input.includeAllScores,
      });
    }),

  batchClassify: protectedProcedure
    .input(z.object({ texts: z.array(z.string()).min(1).max(32) }))
    .mutation(async ({ input }) => {
      return callMLService<{
        results: Array<{ intent: string; confidence: number; entities: Record<string, unknown> }>;
        latency_ms: number;
      }>(NLU_URL, "/batch", "POST", { texts: input.texts });
    }),

  modelInfo: protectedProcedure.query(async () => {
    return callMLService<Record<string, unknown>>(NLU_URL, "/model-info");
  }),

  retrain: adminProcedure.mutation(async () => {
    return callMLService<Record<string, unknown>>(NLU_URL, "/train", "POST");
  }),
});

// ─── FX Forecasting ─────────────────────────────────────────────────────────

const fxForecastMLRouter = router({
  forecast: protectedProcedure
    .input(z.object({
      fromCurrency: z.string().length(3),
      toCurrency: z.string().length(3),
      horizonDays: z.number().min(1).max(30).default(7),
      currentRate: z.number().positive().optional(),
    }))
    .query(async ({ input }) => {
      return callMLService<{
        pair: string;
        current_rate: number;
        forecast: Array<{
          day: number;
          date: string;
          predicted: number;
          lower_bound: number;
          upper_bound: number;
          confidence: number;
        }>;
        trend: string;
        recommendation: string;
        model_version: string;
        latency_ms: number;
      }>(FX_FORECAST_URL, "/forecast", "POST", {
        from_currency: input.fromCurrency,
        to_currency: input.toCurrency,
        horizon_days: input.horizonDays,
        current_rate: input.currentRate,
      });
    }),

  modelInfo: protectedProcedure.query(async () => {
    return callMLService<Record<string, unknown>>(FX_FORECAST_URL, "/model-info");
  }),

  retrain: adminProcedure.mutation(async () => {
    return callMLService<Record<string, unknown>>(FX_FORECAST_URL, "/train", "POST");
  }),
});

// ─── GNN Fraud Detection ────────────────────────────────────────────────────

const gnnFraudRouter = router({
  score: protectedProcedure
    .input(z.object({
      transactionId: z.string(),
      amountUsd: z.number().positive().max(10_000_000),
      senderCountry: z.string().default("US"),
      receiverCountry: z.string().default("NG"),
      hourOfDay: z.number().min(0).max(23).default(12),
      velocity1h: z.number().min(0).default(1),
      isNewBeneficiary: z.boolean().default(false),
      deviceFingerprint: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return callMLService<{
        transaction_id: string;
        fraud_score: number;
        risk_level: string;
        is_fraud: boolean;
        top_signals: string[];
        latency_ms: number;
      }>(GNN_FRAUD_URL, "/score", "POST", {
        transaction_id: input.transactionId,
        amount_usd: input.amountUsd,
        sender_country: input.senderCountry,
        receiver_country: input.receiverCountry,
        hour_of_day: input.hourOfDay,
        velocity_1h: input.velocity1h,
        is_new_beneficiary: input.isNewBeneficiary,
        device_fingerprint: input.deviceFingerprint,
      });
    }),

  modelInfo: protectedProcedure.query(async () => {
    return callMLService<Record<string, unknown>>(GNN_FRAUD_URL, "/model-info");
  }),

  retrain: adminProcedure.mutation(async () => {
    return callMLService<Record<string, unknown>>(GNN_FRAUD_URL, "/train", "POST");
  }),
});

// ─── Investment ML ──────────────────────────────────────────────────────────

const investmentMLRouter = router({
  riskScore: protectedProcedure
    .input(z.object({
      age: z.number().min(18).max(80).default(35),
      monthlyIncomeUsd: z.number().positive().default(2000),
      monthlyExpensesUsd: z.number().positive().default(1200),
      savingsUsd: z.number().min(0).default(5000),
      investmentExperienceYears: z.number().min(0).default(3),
      riskPreference: z.enum(["conservative", "moderate", "aggressive", "very_aggressive"]).default("moderate"),
      dependents: z.number().min(0).default(1),
      homeCountry: z.string().default("NG"),
    }))
    .query(async ({ input }) => {
      return callMLService<{
        risk_level: string;
        risk_score: number;
        confidence: number;
        recommended_allocation: Record<string, number>;
        expected_return_1y: number;
        investor_segment: number;
        latency_ms: number;
      }>(INVESTMENT_ML_URL, "/risk-score", "POST", {
        age: input.age,
        monthly_income_usd: input.monthlyIncomeUsd,
        monthly_expenses_usd: input.monthlyExpensesUsd,
        savings_usd: input.savingsUsd,
        investment_experience_years: input.investmentExperienceYears,
        risk_preference: input.riskPreference,
        dependents: input.dependents,
        home_country: input.homeCountry,
      });
    }),

  modelInfo: protectedProcedure.query(async () => {
    return callMLService<Record<string, unknown>>(INVESTMENT_ML_URL, "/model-info");
  }),

  retrain: adminProcedure.mutation(async () => {
    return callMLService<Record<string, unknown>>(INVESTMENT_ML_URL, "/train", "POST");
  }),
});

// ─── Ray Training Pipeline ──────────────────────────────────────────────────

const rayTrainingRouter = router({
  submitJob: adminProcedure
    .input(z.object({
      modelName: z.string().default("fraud_detection"),
      algorithm: z.string().default("gradient_boosting"),
      samples: z.number().min(1000).default(20000),
      nEstimators: z.number().min(50).default(200),
      maxDepth: z.number().min(2).default(6),
      learningRate: z.number().positive().default(0.1),
    }))
    .mutation(async ({ input }) => {
      return callMLService<{ job_id: string; status: string }>(
        RAY_TRAINING_URL, "/submit-job", "POST", {
          model_name: input.modelName,
          algorithm: input.algorithm,
          task: "fraud_detection",
          samples: input.samples,
          n_estimators: input.nEstimators,
          max_depth: input.maxDepth,
          learning_rate: input.learningRate,
        },
      );
    }),

  hyperparameterSearch: adminProcedure
    .input(z.object({
      modelName: z.string().default("fraud_detection"),
      baseSamples: z.number().min(1000).default(20000),
    }))
    .mutation(async ({ input }) => {
      return callMLService<{ job_id: string; status: string; trials: number }>(
        RAY_TRAINING_URL, "/hyperparameter-search", "POST", {
          model_name: input.modelName,
          base_samples: input.baseSamples,
        },
      );
    }),

  listJobs: adminProcedure.query(async () => {
    return callMLService<Array<Record<string, unknown>>>(RAY_TRAINING_URL, "/jobs");
  }),

  getJob: adminProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      return callMLService<Record<string, unknown>>(RAY_TRAINING_URL, `/jobs/${input.jobId}`);
    }),

  lakehouseIngest: adminProcedure.mutation(async () => {
    return callMLService<Record<string, unknown>>(RAY_TRAINING_URL, "/lakehouse/ingest", "POST");
  }),
});

// ─── MLflow Model Registry ──────────────────────────────────────────────────

const modelRegistryRouter = router({
  registerModel: adminProcedure
    .input(z.object({
      modelName: z.string(),
      version: z.string(),
      algorithm: z.string(),
      metrics: z.record(z.string(), z.number()),
      parameters: z.record(z.string(), z.unknown()).optional(),
      trainingSamples: z.number().optional(),
      stage: z.enum(["staging", "production", "archived"]).default("staging"),
    }))
    .mutation(async ({ input }) => {
      return callMLService<{ status: string; model_name: string; version: string }>(
        MLFLOW_REGISTRY_URL, "/register", "POST", {
          model_name: input.modelName,
          version: input.version,
          algorithm: input.algorithm,
          metrics: input.metrics,
          parameters: input.parameters,
          training_samples: input.trainingSamples,
          stage: input.stage,
        },
      );
    }),

  listModels: adminProcedure.query(async () => {
    return callMLService<Array<Record<string, unknown>>>(MLFLOW_REGISTRY_URL, "/models");
  }),

  getModel: adminProcedure
    .input(z.object({ modelName: z.string() }))
    .query(async ({ input }) => {
      return callMLService<Record<string, unknown>>(MLFLOW_REGISTRY_URL, `/models/${input.modelName}`);
    }),

  promoteModel: adminProcedure
    .input(z.object({
      modelName: z.string(),
      version: z.string(),
      stage: z.enum(["staging", "production", "archived"]),
    }))
    .mutation(async ({ input }) => {
      return callMLService<Record<string, unknown>>(
        MLFLOW_REGISTRY_URL, "/promote", "POST", {
          model_name: input.modelName,
          version: input.version,
          stage: input.stage,
        },
      );
    }),

  createABTest: adminProcedure
    .input(z.object({
      testName: z.string(),
      modelName: z.string(),
      versionA: z.string(),
      versionB: z.string(),
      trafficSplit: z.number().min(0).max(1).default(0.5),
    }))
    .mutation(async ({ input }) => {
      return callMLService<{ test_id: string; status: string }>(
        MLFLOW_REGISTRY_URL, "/ab-test/create", "POST", {
          test_name: input.testName,
          model_name: input.modelName,
          version_a: input.versionA,
          version_b: input.versionB,
          traffic_split: input.trafficSplit,
        },
      );
    }),

  getABTest: adminProcedure
    .input(z.object({ testId: z.string() }))
    .query(async ({ input }) => {
      return callMLService<Record<string, unknown>>(MLFLOW_REGISTRY_URL, `/ab-test/${input.testId}`);
    }),

  compareVersions: adminProcedure
    .input(z.object({
      modelName: z.string(),
      versionA: z.string(),
      versionB: z.string(),
    }))
    .mutation(async ({ input }) => {
      return callMLService<Record<string, unknown>>(
        MLFLOW_REGISTRY_URL, "/compare", "POST", {
          model_name: input.modelName,
          version_a: input.versionA,
          version_b: input.versionB,
        },
      );
    }),
});

// ─── ML Retraining Orchestrator ─────────────────────────────────────────────

const retrainingRouter = router({
  startWorkflow: adminProcedure
    .input(z.object({
      modelName: z.string().default("fraud_detection"),
      trigger: z.enum(["manual", "scheduled", "drift"]).default("manual"),
      algorithm: z.string().default("gradient_boosting"),
      samples: z.number().min(1000).default(20000),
      currentMetrics: z.record(z.string(), z.number()).optional(),
    }))
    .mutation(async ({ input }) => {
      return callMLService<{ run_id: string; status: string }>(
        ML_RETRAINING_URL, "/workflow/start", "POST", {
          model_name: input.modelName,
          trigger: input.trigger,
          algorithm: input.algorithm,
          samples: input.samples,
          current_metrics: input.currentMetrics,
        },
      );
    }),

  scheduleWorkflow: adminProcedure
    .input(z.object({
      modelName: z.string(),
      cron: z.string().default("0 2 * * 0"),
      algorithm: z.string().default("gradient_boosting"),
      samples: z.number().default(20000),
    }))
    .mutation(async ({ input }) => {
      return callMLService<Record<string, unknown>>(
        ML_RETRAINING_URL, "/workflow/schedule", "POST", {
          model_name: input.modelName,
          cron: input.cron,
          algorithm: input.algorithm,
          samples: input.samples,
        },
      );
    }),

  listWorkflows: adminProcedure.query(async () => {
    return callMLService<Array<Record<string, unknown>>>(ML_RETRAINING_URL, "/workflow/status");
  }),

  getWorkflow: adminProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ input }) => {
      return callMLService<Record<string, unknown>>(ML_RETRAINING_URL, `/workflow/${input.runId}`);
    }),

  checkDrift: adminProcedure
    .input(z.object({
      modelName: z.string(),
      recentPredictions: z.array(z.number()),
      recentActuals: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      return callMLService<Record<string, unknown>>(
        ML_RETRAINING_URL, "/drift/check", "POST", {
          model_name: input.modelName,
          recent_predictions: input.recentPredictions,
          recent_actuals: input.recentActuals,
        },
      );
    }),

  reportDrift: adminProcedure
    .input(z.object({
      modelName: z.string(),
      recentPredictions: z.array(z.number()),
      recentActuals: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      return callMLService<Record<string, unknown>>(
        ML_RETRAINING_URL, "/drift/report", "POST", {
          model_name: input.modelName,
          recent_predictions: input.recentPredictions,
          recent_actuals: input.recentActuals,
        },
      );
    }),

  /** Record prediction outcome for feedback loop training */
  recordFeedback: protectedProcedure
    .input(z.object({
      modelName: z.string(),
      inputId: z.string(),
      prediction: z.number(),
      actual: z.number().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      return callMLService<Record<string, unknown>>(
        ML_RETRAINING_URL, "/feedback/record", "POST", {
          model_name: input.modelName,
          input_id: input.inputId,
          prediction: input.prediction,
          actual: input.actual,
          metadata: input.metadata,
        },
      );
    }),

  /** Get feedback loop statistics */
  feedbackStats: adminProcedure.query(async () => {
    return callMLService<Record<string, unknown>>(ML_RETRAINING_URL, "/feedback/stats");
  }),

  /** Get continuous training status */
  continuousStatus: adminProcedure.query(async () => {
    return callMLService<Record<string, unknown>>(ML_RETRAINING_URL, "/continuous/status");
  }),

  /** Start continuous training loop */
  startContinuousTraining: adminProcedure.mutation(async () => {
    return callMLService<Record<string, unknown>>(ML_RETRAINING_URL, "/continuous/start", "POST");
  }),

  /** Stop continuous training loop */
  stopContinuousTraining: adminProcedure.mutation(async () => {
    return callMLService<Record<string, unknown>>(ML_RETRAINING_URL, "/continuous/stop", "POST");
  }),

  /** Data source availability for each model */
  dataSources: adminProcedure.query(async () => {
    return callMLService<Record<string, unknown>>(ML_RETRAINING_URL, "/data-sources");
  }),
});

// ─── ML Health Dashboard ────────────────────────────────────────────────────

const mlHealthRouter = router({
  allServices: protectedProcedure.query(async () => {
    const services = [
      { name: "NLU Intent Classifier", url: NLU_URL, port: 8110 },
      { name: "FX Forecasting (LSTM+Transformer)", url: FX_FORECAST_URL, port: 8111 },
      { name: "GNN Fraud Detection (GAT)", url: GNN_FRAUD_URL, port: 8112 },
      { name: "Investment ML (XGBoost/MLP)", url: INVESTMENT_ML_URL, port: 8122 },
      { name: "Ray Training Pipeline", url: RAY_TRAINING_URL, port: 8114 },
      { name: "MLflow Model Registry", url: MLFLOW_REGISTRY_URL, port: 8115 },
      { name: "ML Retraining Orchestrator", url: ML_RETRAINING_URL, port: 8116 },
    ];

    const results = await Promise.allSettled(
      services.map(async (svc) => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3000);
          const res = await fetch(`${svc.url}/health`, { signal: controller.signal });
          clearTimeout(timeout);
          const data = await res.json();
          return { ...svc, status: "healthy", details: data };
        } catch {
          return { ...svc, status: "unreachable", details: null };
        }
      }),
    );

    return results.map((r) => (r.status === "fulfilled" ? r.value : { status: "error" }));
  }),

  modelVersions: adminProcedure.query(async () => {
    const modelInfoEndpoints = [
      { name: "NLU", url: NLU_URL },
      { name: "FX Forecast", url: FX_FORECAST_URL },
      { name: "GNN Fraud", url: GNN_FRAUD_URL },
      { name: "Investment ML", url: INVESTMENT_ML_URL },
    ];

    const results = await Promise.allSettled(
      modelInfoEndpoints.map(async (ep) => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3000);
          const res = await fetch(`${ep.url}/model-info`, { signal: controller.signal });
          clearTimeout(timeout);
          return { name: ep.name, info: await res.json() };
        } catch {
          return { name: ep.name, info: null, error: "unreachable" };
        }
      }),
    );

    return results.map((r) => (r.status === "fulfilled" ? r.value : { error: "failed" }));
  }),
});

// ─── GPU Training Engine Router ──────────────────────────────────────────────

const gpuEngineRouter = router({
  /** List all detected GPU/NPU/CPU devices */
  devices: adminProcedure.query(async () => {
    return callMLService<Record<string, unknown>>(GPU_ENGINE_URL, "/devices");
  }),

  /** Train a model on the best available GPU */
  train: adminProcedure
    .input(
      z.object({
        modelType: z.enum(["fraud_detection", "nlu_intent", "fx_forecasting", "investment_scoring", "gnn_fraud"]),
        preferredDevice: z.string().optional(),
        epochs: z.number().min(1).max(1000).default(30),
        batchSize: z.number().min(1).max(4096).default(64),
        learningRate: z.number().gt(0).lt(1).default(0.001),
        mixedPrecision: z.boolean().default(true),
        exportOnnx: z.boolean().default(true),
        dataSource: z.enum(["synthetic", "platform_db", "custom"]).default("synthetic"),
      }),
    )
    .mutation(async ({ input }) => {
      return callMLService<Record<string, unknown>>(
        GPU_ENGINE_URL,
        "/train",
        "POST",
        {
          model_type: input.modelType,
          preferred_device: input.preferredDevice,
          epochs: input.epochs,
          batch_size: input.batchSize,
          learning_rate: input.learningRate,
          mixed_precision: input.mixedPrecision,
          export_onnx: input.exportOnnx,
          data_source: input.dataSource,
        },
        120_000,
      );
    }),

  /** Run inference on a loaded ONNX model (any GPU vendor) */
  inference: protectedProcedure
    .input(
      z.object({
        modelName: z.string(),
        inputs: z.array(z.array(z.number())),
        targetDevice: z.string().optional(),
        returnProbabilities: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      return callMLService<Record<string, unknown>>(
        GPU_ENGINE_URL,
        "/inference",
        "POST",
        {
          model_name: input.modelName,
          inputs: input.inputs,
          target_device: input.targetDevice,
          return_probabilities: input.returnProbabilities,
        },
      );
    }),

  /** List all loaded and available models */
  models: adminProcedure.query(async () => {
    return callMLService<Record<string, unknown>>(GPU_ENGINE_URL, "/models");
  }),

  /** List available inference providers */
  providers: adminProcedure.query(async () => {
    return callMLService<Record<string, unknown>>(GPU_ENGINE_URL, "/providers");
  }),

  /** Benchmark model inference latency */
  benchmark: adminProcedure
    .input(
      z.object({
        modelName: z.string(),
        inputShape: z.array(z.number()),
        batchSize: z.number().default(1),
        iterations: z.number().default(100),
      }),
    )
    .mutation(async ({ input }) => {
      return callMLService<Record<string, unknown>>(
        GPU_ENGINE_URL,
        "/benchmark",
        "POST",
        {
          model_name: input.modelName,
          input_shape: input.inputShape,
          batch_size: input.batchSize,
          iterations: input.iterations,
        },
      );
    }),

  /** Export model to different format (tensorrt, openvino, coreml, quantized) */
  exportModel: adminProcedure
    .input(
      z.object({
        modelName: z.string(),
        targetFormat: z.enum(["onnx", "tensorrt", "openvino", "coreml", "quantized"]),
        inputShape: z.array(z.number()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return callMLService<Record<string, unknown>>(
        GPU_ENGINE_URL,
        "/export",
        "POST",
        {
          model_name: input.modelName,
          target_format: input.targetFormat,
          input_shape: input.inputShape,
        },
      );
    }),

  /** Train-and-deploy workflow: train on one GPU, infer on another */
  trainAndDeploy: adminProcedure
    .input(
      z.object({
        modelType: z.string(),
        trainDevice: z.string().optional(),
        inferDevice: z.string().optional(),
        epochs: z.number().default(30),
        batchSize: z.number().default(64),
      }),
    )
    .mutation(async ({ input }) => {
      return callMLService<Record<string, unknown>>(
        GPU_ENGINE_URL,
        "/workflow/train-and-deploy",
        "POST",
        {
          model_type: input.modelType,
          train_device: input.trainDevice,
          infer_device: input.inferDevice,
          epochs: input.epochs,
          batch_size: input.batchSize,
        },
        300_000,
      );
    }),

  /** Register a remote GPU node */
  registerNode: adminProcedure
    .input(
      z.object({
        nodeId: z.string(),
        host: z.string(),
        port: z.number().default(8120),
        gpuVendor: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return callMLService<Record<string, unknown>>(
        GPU_ENGINE_URL,
        "/remote/nodes/register",
        "POST",
        {
          node_id: input.nodeId,
          host: input.host,
          port: input.port,
          gpu_vendor: input.gpuVendor,
        },
      );
    }),

  /** List remote nodes */
  remoteNodes: adminProcedure.query(async () => {
    return callMLService<Record<string, unknown>>(GPU_ENGINE_URL, "/remote/nodes");
  }),

  /** Dispatch training to remote GPU node */
  remoteTrain: adminProcedure
    .input(
      z.object({
        nodeId: z.string(),
        modelType: z.string(),
        epochs: z.number().default(30),
        batchSize: z.number().default(64),
        learningRate: z.number().default(0.001),
        mixedPrecision: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      return callMLService<Record<string, unknown>>(
        GPU_ENGINE_URL,
        "/remote/train",
        "POST",
        {
          node_id: input.nodeId,
          model_type: input.modelType,
          epochs: input.epochs,
          batch_size: input.batchSize,
          learning_rate: input.learningRate,
          mixed_precision: input.mixedPrecision,
        },
        300_000,
      );
    }),

  /** Run inference on remote GPU node */
  remoteInfer: adminProcedure
    .input(
      z.object({
        nodeId: z.string(),
        modelName: z.string(),
        inputs: z.array(z.array(z.number())),
        returnProbabilities: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      return callMLService<Record<string, unknown>>(
        GPU_ENGINE_URL,
        "/remote/infer",
        "POST",
        {
          node_id: input.nodeId,
          model_name: input.modelName,
          inputs: input.inputs,
          return_probabilities: input.returnProbabilities,
        },
      );
    }),

  /** Transfer ONNX model to remote node */
  transferModel: adminProcedure
    .input(
      z.object({
        modelName: z.string(),
        targetNodeId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      return callMLService<Record<string, unknown>>(
        GPU_ENGINE_URL,
        `/remote/transfer?model_name=${encodeURIComponent(input.modelName)}&target_node_id=${encodeURIComponent(input.targetNodeId)}`,
        "POST",
      );
    }),

  /** List training jobs */
  jobs: adminProcedure.query(async () => {
    return callMLService<Record<string, unknown>>(GPU_ENGINE_URL, "/jobs");
  }),
});

// ─── Export Combined Router ─────────────────────────────────────────────────

export const mlPipelineRouter = router({
  nlu: nluRouter,
  fxForecast: fxForecastMLRouter,
  gnnFraud: gnnFraudRouter,
  investmentML: investmentMLRouter,
  rayTraining: rayTrainingRouter,
  modelRegistry: modelRegistryRouter,
  retraining: retrainingRouter,
  health: mlHealthRouter,
  gpuEngine: gpuEngineRouter,
});
