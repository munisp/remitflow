/**
 * fetchWithTimeout — AbortController-based timeout wrapper for fetch
 * (wave14 perf M1).
 *
 * Without this, a hung connection keeps a fetch pending indefinitely and
 * react-query callers wait for the full retry chain with no feedback.
 * 15s is the ceiling for any single attempt; callers' own AbortSignals are
 * still honored (whichever fires first wins).
 */
export const FETCH_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(
  input: unknown,
  init?: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const upstream = init?.signal ?? null;
  const onUpstreamAbort = () => controller.abort();
  if (upstream) {
    if (upstream.aborted) {
      controller.abort();
    } else {
      upstream.addEventListener('abort', onUpstreamAbort);
    }
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input as string, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (upstream) upstream.removeEventListener('abort', onUpstreamAbort);
  }
}
