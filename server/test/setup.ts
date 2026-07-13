/**
 * RemitFlow — Vitest Global Test Setup
 * Runs before every test file. Sets up mocks, environment variables,
 * and test utilities.
 */

import { vi, beforeAll, afterAll, afterEach } from "vitest";

// ── Environment Variables ─────────────────────────────────────────────────────
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-minimum-32-characters-long";
process.env.SESSION_SECRET = "test-session-secret-minimum-32-chars-long";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://remitflow:remitflow123@localhost:5432/remitflow_test";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
process.env.KAFKA_BROKERS = "localhost:9092";
process.env.TB_BRIDGE_URL = "http://localhost:8200";
process.env.KEYCLOAK_URL = "http://localhost:8080";
process.env.PERMIFY_URL = "http://localhost:3476";
process.env.OPENSEARCH_URL = "http://localhost:9200";
process.env.TEMPORAL_ADDRESS = "localhost:7233";
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";

// ── Global Mocks ──────────────────────────────────────────────────────────────

// Mock the logger to suppress output during tests
vi.mock("../server/_core/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

// Mock Redis client
vi.mock("../server/middleware/redis", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    exists: vi.fn().mockResolvedValue(0),
    expire: vi.fn().mockResolvedValue(1),
    hget: vi.fn().mockResolvedValue(null),
    hset: vi.fn().mockResolvedValue(1),
    pipeline: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue([]),
    })),
    quit: vi.fn().mockResolvedValue("OK"),
  },
  getRedis: vi.fn().mockReturnValue({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
  }),
}));

// Mock Kafka producer
vi.mock("../server/middleware/kafka", () => ({
  publishPaymentInitiated: vi.fn().mockResolvedValue(undefined),
  publishPaymentCompleted: vi.fn().mockResolvedValue(undefined),
  publishKycEvent: vi.fn().mockResolvedValue(undefined),
  publishPlatformEvent: vi.fn().mockResolvedValue(undefined),
  ensureTopicsExist: vi.fn().mockResolvedValue(undefined),
  disconnectKafka: vi.fn().mockResolvedValue(undefined),
  KAFKA_TOPICS: {
    PAYMENT_INITIATED: "payment.initiated",
    PAYMENT_COMPLETED: "payment.completed",
    KYC_TRIGGER_FIRED: "kyc.trigger.fired",
  },
}));

// Mock TigerBeetle
vi.mock("../server/middleware/tigerBeetle", () => ({
  tigerBeetle: {
    createAccounts: vi.fn().mockResolvedValue([]),
    createTransfers: vi.fn().mockResolvedValue([]),
    lookupAccounts: vi.fn().mockResolvedValue([]),
    lookupTransfers: vi.fn().mockResolvedValue([]),
  },
}));

// Mock OpenTelemetry (avoid SDK initialization in tests)
vi.mock("../server/telemetry/otel", () => ({
  initTelemetry: vi.fn(),
  shutdownTelemetry: vi.fn().mockResolvedValue(undefined),
  getTracer: vi.fn(() => ({
    startActiveSpan: vi.fn((name, opts, fn) => fn({ end: vi.fn(), setStatus: vi.fn(), setAttributes: vi.fn(), recordException: vi.fn(), spanContext: () => ({ traceId: "test-trace-id" }) })),
  })),
  getMeter: vi.fn(() => ({
    createCounter: vi.fn(() => ({ add: vi.fn() })),
    createHistogram: vi.fn(() => ({ record: vi.fn() })),
    createObservableGauge: vi.fn(() => ({ addCallback: vi.fn() })),
  })),
  withSpan: vi.fn(async (name, fn) => fn({ end: vi.fn(), setStatus: vi.fn(), setAttributes: vi.fn(), recordException: vi.fn() })),
  recordTransferMetric: vi.fn(),
  recordKycMetric: vi.fn(),
  recordApiLatency: vi.fn(),
  recordMiddlewareHealth: vi.fn(),
  otelRequestMiddleware: vi.fn((req, res, next) => next()),
}));

// ── Cleanup ───────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  vi.restoreAllMocks();
});
