/**
 * dataPipelines.ts
 * tRPC router for Apache NiFi, dbt, and Apache Airflow integrations
 *
 * Provides:
 * - NiFi pipeline status, start/stop/trigger
 * - dbt model runs, tests, docs generation, model list
 * - Airflow DAG status, trigger, pause/unpause, run history
 */

import { z } from "zod";
import { router, protectedProcedure, publicProcedure ,
  auditedProcedure, rateLimitedProcedure
} from "../_core/trpc";
import { nifiService, REMITFLOW_PIPELINES } from "../nifi.service";
import { dbtService } from "../dbt.service";
import { airflowService } from "../airflow.service";

// ─── NiFi Router ──────────────────────────────────────────────────────────────
export const nifiRouter = router({
  getStatus: protectedProcedure.query(async () => {
    return nifiService.getStatus();
  }),

  getPipelines: protectedProcedure.query(async () => {
    return nifiService.getPipelineList();
  }),

  startPipeline: auditedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .mutation(async ({ input }) => {
      return nifiService.startPipeline(input.pipelineId);
    }),

  stopPipeline: auditedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .mutation(async ({ input }) => {
      return nifiService.stopPipeline(input.pipelineId);
    }),

  triggerPipeline: auditedProcedure
    .input(z.object({
      pipelineId: z.string(),
      payload: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      return nifiService.triggerPipeline(input.pipelineId, input.payload);
    }),

  getPipelineIds: publicProcedure.query(() => {
    return Object.values(REMITFLOW_PIPELINES).map((p) => ({ id: p.id, name: p.name, description: p.description }));
  }),
});

// ─── dbt Router ───────────────────────────────────────────────────────────────
export const dbtRouter = router({
  getStatus: protectedProcedure.query(async () => {
    return dbtService.getStatus();
  }),

  getModels: protectedProcedure.query(async () => {
    return dbtService.getModelList();
  }),

  runModels: auditedProcedure
    .input(z.object({ select: z.string().optional() }))
    .mutation(async ({ input }) => {
      return dbtService.runModels(input.select);
    }),

  runTests: auditedProcedure
    .input(z.object({ select: z.string().optional() }))
    .mutation(async ({ input }) => {
      return dbtService.runTests(input.select);
    }),

  generateDocs: auditedProcedure.mutation(async () => {
    return dbtService.generateDocs();
  }),

  runByLayer: auditedProcedure
    .input(z.object({ layer: z.enum(["staging", "intermediate", "marts"]) }))
    .mutation(async ({ input }) => {
      return dbtService.runModels(`tag:${input.layer}`);
    }),
});

// ─── Airflow Router ───────────────────────────────────────────────────────────
export const airflowRouter = router({
  getStatus: protectedProcedure.query(async () => {
    return airflowService.getStatus();
  }),

  getDags: protectedProcedure.query(async () => {
    return airflowService.getDagList();
  }),

  triggerDag: auditedProcedure
    .input(z.object({
      dagId: z.string(),
      conf: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      return airflowService.triggerDag(input.dagId, input.conf);
    }),

  getDagRuns: protectedProcedure
    .input(z.object({ dagId: z.string(), limit: z.number().min(1).max(100).default(10) }))
    .query(async ({ input }) => {
      return airflowService.getDagRuns(input.dagId, input.limit);
    }),

  pauseDag: auditedProcedure
    .input(z.object({ dagId: z.string() }))
    .mutation(async ({ input }) => {
      return airflowService.pauseDag(input.dagId);
    }),

  unpauseDag: auditedProcedure
    .input(z.object({ dagId: z.string() }))
    .mutation(async ({ input }) => {
      return airflowService.unpauseDag(input.dagId);
    }),

  // Convenience: trigger the full daily ETL pipeline
  triggerDailyEtl: auditedProcedure.mutation(async () => {
    return airflowService.triggerDag("remitflow_daily_etl", { triggered_by: "api", manual: true });
  }),

  // Convenience: trigger KYC workflow for a specific user
  triggerKycWorkflow: auditedProcedure
    .input(z.object({ userId: z.number(), documentId: z.number() }))
    .mutation(async ({ input }) => {
      return airflowService.triggerDag("remitflow_kyc_workflow", {
        user_id: input.userId,
        document_id: input.documentId,
      });
    }),

  // Convenience: trigger compliance report generation
  triggerComplianceReport: auditedProcedure
    .input(z.object({ reportType: z.enum(["aml", "kyc", "fatf", "full"]), periodStart: z.string(), periodEnd: z.string() }))
    .mutation(async ({ input }) => {
      return airflowService.triggerDag("remitflow_compliance_report", {
        report_type: input.reportType,
        period_start: input.periodStart,
        period_end: input.periodEnd,
      });
    }),
});

// ─── Combined Data Pipelines Router ──────────────────────────────────────────
export const dataPipelinesRouter = router({
  nifi: nifiRouter,
  dbt: dbtRouter,
  airflow: airflowRouter,

  // Unified status for the Data Pipelines dashboard
  getOverallStatus: protectedProcedure.query(async () => {
    const [nifi, dbt, airflow] = await Promise.all([
      nifiService.getStatus(),
      dbtService.getStatus(),
      airflowService.getStatus(),
    ]);

    return {
      nifi: {
        available: nifi.available,
        pipelineCount: nifi.processGroups.length,
        totalFlowFilesQueued: nifi.totalFlowFilesQueued,
        activeThreadCount: nifi.activeThreadCount,
        error: nifi.error,
      },
      dbt: {
        available: dbt.available,
        modelCount: dbt.models.length,
        version: dbt.version,
        error: dbt.error,
      },
      airflow: {
        available: airflow.available,
        dagCount: airflow.dags.length,
        runningDagRuns: airflow.runningDagRuns,
        failedDagRuns24h: airflow.failedDagRuns24h,
        error: airflow.error,
      },
      overallHealth: nifi.available || dbt.available || airflow.available ? "partial" : "offline",
    };
  }),

  // Trigger the full end-to-end data pipeline
  triggerFullPipeline: auditedProcedure
    .input(z.object({ includeModelRetraining: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      const results = await Promise.all([
        nifiService.triggerPipeline("remitflow-tx-ingest"),
        nifiService.triggerPipeline("remitflow-lakehouse-etl"),
        airflowService.triggerDag("remitflow_daily_etl"),
        dbtService.runModels(),
        ...(input.includeModelRetraining ? [airflowService.triggerDag("remitflow_fraud_model_retrain")] : []),
      ]);

      return {
        success: results.every((r: any) => r?.success !== false),
        steps: [
          { step: "NiFi Transaction Ingest", ...results[0] },
          { step: "NiFi Lakehouse ETL", ...results[1] },
          { step: "Airflow Daily ETL DAG", ...results[2] },
          { step: "dbt Model Run", ...results[3] },
          ...(input.includeModelRetraining ? [{ step: "Airflow Fraud Model Retrain", ...results[4] }] : []),
        ],
      };
    }),
});
