/**
 * OpenAPI Spec Provider
 *
 * Loads the canonical API contract (openapi/remitflow-api.yaml) and returns
 * it as a parsed object for the /api/docs.json and /openapi.json endpoints.
 * The YAML file is the single source of truth — this module never synthesizes
 * or patches spec content.
 *
 * The parsed document is cached after the first successful load; a missing or
 * unparseable contract file throws, so a broken deployment surfaces as a
 * loud startup/endpoint error rather than a fabricated empty spec.
 */

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "yaml";

const SPEC_FILENAME = path.join("openapi", "remitflow-api.yaml");

function candidateSpecPaths(): string[] {
  const candidates: string[] = [path.resolve(process.cwd(), SPEC_FILENAME)];
  // ESM module directory (server/lib in dev/tsx; dist in the bundled build).
  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(moduleDir, "..", "..", SPEC_FILENAME));
    candidates.push(path.resolve(moduleDir, "..", SPEC_FILENAME));
  } catch {
    // import.meta unavailable (CJS interop) — cwd candidate already covers it.
  }
  return candidates;
}

let cachedSpec: Record<string, unknown> | null = null;

export function generateOpenApiSpec(): Record<string, unknown> {
  if (cachedSpec) return cachedSpec;

  const attempted: string[] = [];
  for (const specPath of candidateSpecPaths()) {
    attempted.push(specPath);
    try {
      const raw = readFileSync(specPath, "utf-8");
      const doc = parse(raw) as Record<string, unknown> | null;
      if (!doc || typeof doc !== "object" || typeof doc.openapi !== "string") {
        throw new Error(`file at ${specPath} is not a valid OpenAPI document`);
      }
      cachedSpec = doc;
      return cachedSpec;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        // File exists but is unparseable — this is a deployment defect, not a
        // search-path miss.
        throw new Error(
          `[OpenAPI] Failed to parse API contract at ${specPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  throw new Error(
    `[OpenAPI] API contract ${SPEC_FILENAME} not found (searched: ${attempted.join(", ")}). ` +
      "The OpenAPI contract must ship with the server deployment.",
  );
}

/** Test/support hook: drop the cached document so the next call reloads it. */
export function resetOpenApiSpecCache(): void {
  cachedSpec = null;
}
