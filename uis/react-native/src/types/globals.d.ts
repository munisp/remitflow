/**
 * Minimal ambient declarations for this package's standalone type-check.
 *
 * `process.env` is referenced by trpc.ts / api.ts. Metro only inlines
 * NODE_ENV at bundle time, so custom env vars read here evaluate to
 * undefined at runtime unless the app adds a babel inline-transform — the
 * existing `?? <default>` fallbacks therefore always apply. This declaration
 * exists to type-check that pre-existing pattern without adding @types/node
 * (wave14 forbids new deps).
 */
declare const process: {
  env: Record<string, string | undefined>;
};
