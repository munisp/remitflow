/**
 * Backward-compatible export for callers that previously imported this module.
 * The active implementation is tenant-scoped, PostgreSQL-backed, and does not
 * use Redis or process-local response caches for financial mutations.
 */
export {
  durableIdempotencyMiddleware as idempotencyMiddleware,
  hashIdempotencyRequest,
  IdempotencyConflictError,
} from "./durableIdempotency";
