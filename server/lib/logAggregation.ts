/**
 * Log aggregation transport — P1 Observability 7.5
 * Sends structured logs to Loki/CloudWatch/ELK.
 */
import pino from "pino";

interface LogTransportConfig {
  type: "loki" | "cloudwatch" | "stdout";
  endpoint?: string;
  labels?: Record<string, string>;
  batchSize?: number;
  flushIntervalMs?: number;
}

const logBuffer: Array<{ timestamp: string; level: string; message: string; data: Record<string, unknown> }> = [];
const MAX_BUFFER = 1000;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let transportConfig: LogTransportConfig = { type: "stdout" };

export function initLogTransport(config: LogTransportConfig): void {
  transportConfig = config;

  if (flushTimer) clearInterval(flushTimer);

  if (config.type !== "stdout") {
    flushTimer = setInterval(flushLogs, config.flushIntervalMs ?? 5000);
  }
}

export function bufferLog(
  level: string,
  message: string,
  data: Record<string, unknown> = {}
): void {
  logBuffer.push({
    timestamp: new Date().toISOString(),
    level,
    message,
    data,
  });

  if (logBuffer.length >= (transportConfig.batchSize ?? MAX_BUFFER)) {
    flushLogs();
  }
}

async function flushLogs(): Promise<void> {
  if (logBuffer.length === 0) return;

  const batch = logBuffer.splice(0, transportConfig.batchSize ?? 100);

  if (transportConfig.type === "loki" && transportConfig.endpoint) {
    await sendToLoki(batch);
  } else if (transportConfig.type === "cloudwatch" && transportConfig.endpoint) {
    await sendToCloudWatch(batch);
  }
}

async function sendToLoki(
  batch: typeof logBuffer
): Promise<void> {
  if (!transportConfig.endpoint) return;

  const streams = [
    {
      stream: {
        service: "remitflow-api",
        environment: process.env.NODE_ENV ?? "development",
        ...transportConfig.labels,
      },
      values: batch.map((entry) => [
        String(Date.parse(entry.timestamp) * 1_000_000),
        JSON.stringify({ level: entry.level, msg: entry.message, ...entry.data }),
      ]),
    },
  ];

  try {
    await fetch(`${transportConfig.endpoint}/loki/api/v1/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streams }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Don't let log transport failures crash the app
  }
}

async function sendToCloudWatch(
  batch: typeof logBuffer
): Promise<void> {
  if (!transportConfig.endpoint) return;

  try {
    await fetch(transportConfig.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logGroupName: "/remitflow/api",
        logStreamName: `${process.env.HOSTNAME ?? "local"}-${new Date().toISOString().slice(0, 10)}`,
        logEvents: batch.map((entry) => ({
          timestamp: Date.parse(entry.timestamp),
          message: JSON.stringify({ level: entry.level, msg: entry.message, ...entry.data }),
        })),
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // silently fail
  }
}

export function createLogger(module: string) {
  const logger = pino({
    name: module,
    level: process.env.LOG_LEVEL ?? "info",
    formatters: {
      level: (label) => ({ level: label }),
    },
  });

  return {
    info: (msg: string, data?: Record<string, unknown>) => {
      logger.info(data ?? {}, msg);
      bufferLog("info", msg, { module, ...data });
    },
    warn: (msg: string, data?: Record<string, unknown>) => {
      logger.warn(data ?? {}, msg);
      bufferLog("warn", msg, { module, ...data });
    },
    error: (msg: string, data?: Record<string, unknown>) => {
      logger.error(data ?? {}, msg);
      bufferLog("error", msg, { module, ...data });
    },
    debug: (msg: string, data?: Record<string, unknown>) => {
      logger.debug(data ?? {}, msg);
      bufferLog("debug", msg, { module, ...data });
    },
  };
}
