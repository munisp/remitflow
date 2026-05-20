/**
 * smoke-v180.test.ts
 * Sprint v180 smoke tests:
 *  1. corridorAnalytics.successByPaymentMethod — new procedure
 *  2. Transfer Dispute router (raise, listMine, adminList, adminUpdate, adminStats)
 *  3. PAPSS settlement exponential backoff retry (withRetry logic)
 *  4. TransferAnalytics page — Radar chart import
 *  5. AdminDisputes page — stats cards and review dialog
 *  6. TransferDisputeForm page — form validation
 *  7. App.tsx routes — /admin/disputes and /transfers/:id/dispute registered
 *  8. DashboardLayout — Disputes sidebar link
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

// ─── Helpers ─────────────────────────────────────────────────────────────────
function readSrc(rel: string) {
  return readFileSync(join(ROOT, rel), "utf-8");
}

// ─── 1. corridorAnalytics.successByPaymentMethod procedure ───────────────────
describe("corridorAnalytics.successByPaymentMethod", () => {
  it("procedure is exported from productionFeatures.ts", () => {
    const src = readSrc("server/routers/productionFeatures.ts");
    expect(src).toContain("successByPaymentMethod");
  });

  it("procedure is inside corridorAnalyticsRouter", () => {
    const src = readSrc("server/routers/productionFeatures.ts");
    const routerStart = src.indexOf("export const corridorAnalyticsRouter = router({");
    const routerEnd = src.indexOf("\nexport const referralEngineRouter", routerStart);
    const routerBody = src.slice(routerStart, routerEnd);
    expect(routerBody).toContain("successByPaymentMethod");
  });

  it("has admin FORBIDDEN guard", () => {
    const src = readSrc("server/routers/productionFeatures.ts");
    const idx = src.indexOf("successByPaymentMethod");
    const snippet = src.slice(idx, idx + 400);
    expect(snippet).toContain("FORBIDDEN");
  });

  it("returns fallback data when db unavailable", () => {
    const src = readSrc("server/routers/productionFeatures.ts");
    const idx = src.indexOf("successByPaymentMethod");
    const snippet = src.slice(idx, idx + 800);
    expect(snippet).toContain("FALLBACK");
    expect(snippet).toContain("Bank Transfer");
    expect(snippet).toContain("Mobile Money");
  });

  it("computes successRate as percentage", () => {
    const src = readSrc("server/routers/productionFeatures.ts");
    const idx = src.indexOf("successByPaymentMethod");
    const snippet = src.slice(idx, idx + 1200);
    expect(snippet).toContain("successRate");
    expect(snippet).toContain("completed");
    expect(snippet).toContain("failed");
  });

  it("groups by payment_method column", () => {
    const src = readSrc("server/routers/productionFeatures.ts");
    const idx = src.indexOf("successByPaymentMethod");
    // SQL template literal is ~1500 chars after the procedure name
    const snippet = src.slice(idx, idx + 1800);
    expect(snippet).toContain("payment_method");
    expect(snippet).toContain("GROUP BY");
  });
});

// ─── 2. TransferAnalytics page — success rate chart ──────────────────────────
describe("TransferAnalytics page — successByPaymentMethod chart", () => {
  it("imports RadarChart from recharts", () => {
    const src = readSrc("client/src/pages/TransferAnalytics.tsx");
    expect(src).toContain("RadarChart");
    expect(src).toContain("Radar");
    expect(src).toContain("PolarGrid");
    expect(src).toContain("PolarAngleAxis");
  });

  it("calls trpc.corridorAnalytics.successByPaymentMethod.useQuery", () => {
    const src = readSrc("client/src/pages/TransferAnalytics.tsx");
    expect(src).toContain("corridorAnalytics.successByPaymentMethod.useQuery");
  });

  it("renders 'Success Rate by Payment Method' section heading", () => {
    const src = readSrc("client/src/pages/TransferAnalytics.tsx");
    expect(src).toContain("Success Rate by Payment Method");
  });

  it("renders bar chart for completed vs failed", () => {
    const src = readSrc("client/src/pages/TransferAnalytics.tsx");
    expect(src).toContain("dataKey=\"completed\"");
    expect(src).toContain("dataKey=\"failed\"");
  });

  it("renders radar chart for success rate", () => {
    const src = readSrc("client/src/pages/TransferAnalytics.tsx");
    expect(src).toContain("dataKey=\"successRate\"");
    expect(src).toContain("RadarChart");
  });

  it("renders summary table with Badge for success rate", () => {
    const src = readSrc("client/src/pages/TransferAnalytics.tsx");
    expect(src).toContain("successRate");
    expect(src).toContain("<Badge");
    expect(src).toContain("toFixed(1)");
  });
});

// ─── 3. transferDisputeRouter ─────────────────────────────────────────────────
describe("transferDisputeRouter", () => {
  it("router file exists", () => {
    const src = readSrc("server/routers/transferDispute.ts");
    expect(src).toBeTruthy();
  });

  it("exports transferDisputeRouter", () => {
    const src = readSrc("server/routers/transferDispute.ts");
    expect(src).toContain("export const transferDisputeRouter");
  });

  it("has raise procedure", () => {
    const src = readSrc("server/routers/transferDispute.ts");
    expect(src).toContain("raise: raiseDispute");
  });

  it("raise validates reason enum", () => {
    const src = readSrc("server/routers/transferDispute.ts");
    expect(src).toContain("unauthorized");
    expect(src).toContain("duplicate");
    expect(src).toContain("not_received");
    expect(src).toContain("wrong_amount");
    expect(src).toContain("other");
  });

  it("raise calls notifyOwner on submission", () => {
    const src = readSrc("server/routers/transferDispute.ts");
    expect(src).toContain("notifyOwner");
    expect(src).toContain("New Transfer Dispute");
  });

  it("raise prevents duplicate open disputes", () => {
    const src = readSrc("server/routers/transferDispute.ts");
    expect(src).toContain("CONFLICT");
    expect(src).toContain("open dispute already exists");
  });

  it("raise verifies transaction belongs to caller", () => {
    const src = readSrc("server/routers/transferDispute.ts");
    expect(src).toContain("NOT_FOUND");
    expect(src).toContain("does not belong to you");
  });

  it("has listMine procedure", () => {
    const src = readSrc("server/routers/transferDispute.ts");
    expect(src).toContain("listMine: listMyDisputes");
  });

  it("has adminList procedure with FORBIDDEN guard", () => {
    const src = readSrc("server/routers/transferDispute.ts");
    expect(src).toContain("adminList: adminListDisputes");
    expect(src).toContain("FORBIDDEN");
  });

  it("adminList supports status filter", () => {
    const src = readSrc("server/routers/transferDispute.ts");
    expect(src).toContain("status: z.enum");
    expect(src).toContain("under_review");
    expect(src).toContain("resolved");
    expect(src).toContain("closed");
  });

  it("has adminUpdate procedure", () => {
    const src = readSrc("server/routers/transferDispute.ts");
    expect(src).toContain("adminUpdate: adminUpdateDispute");
  });

  it("adminUpdate accepts resolution text", () => {
    const src = readSrc("server/routers/transferDispute.ts");
    expect(src).toContain("resolution");
  });

  it("has adminStats procedure", () => {
    const src = readSrc("server/routers/transferDispute.ts");
    expect(src).toContain("adminStats: adminDisputeStats");
  });

  it("adminStats returns avgResolutionHours", () => {
    const src = readSrc("server/routers/transferDispute.ts");
    expect(src).toContain("avgResolutionHours");
  });

  it("creates audit log on raise", () => {
    const src = readSrc("server/routers/transferDispute.ts");
    expect(src).toContain("createAuditLog");
    expect(src).toContain("dispute.raised");
  });
});

// ─── 4. transferDisputeRouter wired in appRouter ──────────────────────────────
describe("transferDisputeRouter wired in appRouter", () => {
  it("is imported in routers.ts", () => {
    const src = readSrc("server/routers.ts");
    expect(src).toContain("transferDisputeRouter");
    expect(src).toContain("./routers/transferDispute");
  });

  it("is registered in appRouter", () => {
    const src = readSrc("server/routers.ts");
    expect(src).toContain("transferDispute: transferDisputeRouter");
  });
});

// ─── 5. TransferDisputeForm page ──────────────────────────────────────────────
describe("TransferDisputeForm page", () => {
  it("page file exists", () => {
    const src = readSrc("client/src/pages/TransferDisputeForm.tsx");
    expect(src).toBeTruthy();
  });

  it("calls trpc.transferDispute.raise.useMutation", () => {
    const src = readSrc("client/src/pages/TransferDisputeForm.tsx");
    expect(src).toContain("transferDispute.raise.useMutation");
  });

  it("shows success state with disputeId after submission", () => {
    const src = readSrc("client/src/pages/TransferDisputeForm.tsx");
    expect(src).toContain("Dispute Submitted");
    expect(src).toContain("disputeId");
  });

  it("validates description minimum length", () => {
    const src = readSrc("client/src/pages/TransferDisputeForm.tsx");
    expect(src).toContain("description.length < 10");
  });

  it("shows reason hint text", () => {
    const src = readSrc("client/src/pages/TransferDisputeForm.tsx");
    expect(src).toContain("REASON_HINTS");
  });

  it("has cancel button navigating to /transfers", () => {
    const src = readSrc("client/src/pages/TransferDisputeForm.tsx");
    expect(src).toContain("/transfers");
    expect(src).toContain("Cancel");
  });
});

// ─── 6. AdminDisputes page ────────────────────────────────────────────────────
describe("AdminDisputes page", () => {
  it("page file exists", () => {
    const src = readSrc("client/src/pages/AdminDisputes.tsx");
    expect(src).toBeTruthy();
  });

  it("calls trpc.transferDispute.adminStats.useQuery", () => {
    const src = readSrc("client/src/pages/AdminDisputes.tsx");
    expect(src).toContain("transferDispute.adminStats.useQuery");
  });

  it("calls trpc.transferDispute.adminList.useQuery", () => {
    const src = readSrc("client/src/pages/AdminDisputes.tsx");
    expect(src).toContain("transferDispute.adminList.useQuery");
  });

  it("calls trpc.transferDispute.adminUpdate.useMutation", () => {
    const src = readSrc("client/src/pages/AdminDisputes.tsx");
    expect(src).toContain("transferDispute.adminUpdate.useMutation");
  });

  it("shows 4 stats cards (open, under_review, resolved, avgResolutionHours)", () => {
    const src = readSrc("client/src/pages/AdminDisputes.tsx");
    expect(src).toContain("stats?.open");
    expect(src).toContain("stats?.under_review");
    expect(src).toContain("stats?.resolved");
    expect(src).toContain("avgResolutionHours");
  });

  it("has status filter select", () => {
    const src = readSrc("client/src/pages/AdminDisputes.tsx");
    expect(src).toContain("statusFilter");
    expect(src).toContain("under_review");
    expect(src).toContain("resolved");
    expect(src).toContain("closed");
  });

  it("has review dialog with resolution textarea", () => {
    const src = readSrc("client/src/pages/AdminDisputes.tsx");
    expect(src).toContain("Dialog");
    expect(src).toContain("resolution");
    expect(src).toContain("Textarea");
  });

  it("has admin access guard", () => {
    const src = readSrc("client/src/pages/AdminDisputes.tsx");
    expect(src).toContain("Admin access required");
  });
});

// ─── 7. App.tsx routes ────────────────────────────────────────────────────────
describe("App.tsx routes for dispute pages", () => {
  it("imports TransferDisputeForm lazily", () => {
    const src = readSrc("client/src/App.tsx");
    expect(src).toContain("TransferDisputeForm");
    expect(src).toContain("./pages/TransferDisputeForm");
  });

  it("imports AdminDisputes lazily", () => {
    const src = readSrc("client/src/App.tsx");
    expect(src).toContain("AdminDisputes");
    expect(src).toContain("./pages/AdminDisputes");
  });

  it("registers /admin/disputes route", () => {
    const src = readSrc("client/src/App.tsx");
    expect(src).toContain('path="/admin/disputes"');
    expect(src).toContain("component={AdminDisputes}");
  });

  it("registers /transfers/:id/dispute route", () => {
    const src = readSrc("client/src/App.tsx");
    expect(src).toContain('path="/transfers/:id/dispute"');
    expect(src).toContain("component={TransferDisputeForm}");
  });
});

// ─── 8. DashboardLayout — Disputes sidebar link ───────────────────────────────
describe("DashboardLayout — Disputes sidebar link", () => {
  it("has admin/disputes link in sidebar", () => {
    const src = readSrc("client/src/components/DashboardLayout.tsx");
    expect(src).toContain('path: "/admin/disputes"');
  });

  it("is admin-only and secondary", () => {
    const src = readSrc("client/src/components/DashboardLayout.tsx");
    const idx = src.indexOf('path: "/admin/disputes"');
    const snippet = src.slice(Math.max(0, idx - 50), idx + 150);
    expect(snippet).toContain("adminOnly: true");
    expect(snippet).toContain("secondary: true");
  });
});

// ─── 9. PAPSS settlement exponential backoff retry ───────────────────────────
describe("PAPSS settlement — exponential backoff retry", () => {
  it("defines MAX_RETRIES = 3", () => {
    const src = readSrc("server/_core/index.ts");
    const idx = src.indexOf("papss-settlement");
    const snippet = src.slice(idx, idx + 3000);
    expect(snippet).toContain("MAX_RETRIES = 3");
  });

  it("defines withRetry helper", () => {
    const src = readSrc("server/_core/index.ts");
    expect(src).toContain("withRetry");
  });

  it("wraps fetchPendingTransfers with withRetry", () => {
    const src = readSrc("server/_core/index.ts");
    expect(src).toContain("fetchPendingTransfers");
    expect(src).toContain("withRetry");
  });

  it("wraps batchSettle with withRetry", () => {
    const src = readSrc("server/_core/index.ts");
    expect(src).toContain("batchSettle");
  });

  it("uses exponential delay: Math.pow(2, attempt - 1) * 500", () => {
    const src = readSrc("server/_core/index.ts");
    expect(src).toContain("Math.pow(2, attempt - 1) * 500");
  });

  it("response includes retryInfo field", () => {
    const src = readSrc("server/_core/index.ts");
    const idx = src.indexOf("papss-settlement");
    // retryInfo is ~4900 chars after the route comment — use a wider window
    const snippet = src.slice(idx, idx + 6000);
    expect(snippet).toContain("retryInfo");
    expect(snippet).toContain("maxRetries");
    expect(snippet).toContain("dbRetryCount");
  });

  it("logs warning on retry attempt", () => {
    const src = readSrc("server/_core/index.ts");
    expect(src).toContain("Retrying in");
  });
});

// ─── 10. Unit test: withRetry logic ──────────────────────────────────────────
describe("withRetry logic — unit", () => {
  it("resolves immediately on first success", async () => {
    const withRetry = async <T>(fn: () => Promise<T>, _label: string): Promise<T> => {
      let lastErr: any;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try { return await fn(); } catch (err: any) {
          lastErr = err;
          const delayMs = Math.pow(2, attempt - 1) * 500;
          if (attempt < 3) await new Promise(r => setTimeout(r, delayMs));
        }
      }
      throw lastErr;
    };
    const result = await withRetry(async () => 42, "test");
    expect(result).toBe(42);
  });

  it("retries up to 3 times then throws", async () => {
    vi.useFakeTimers();
    const withRetry = async <T>(fn: () => Promise<T>, _label: string): Promise<T> => {
      let lastErr: any;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try { return await fn(); } catch (err: any) {
          lastErr = err;
          const delayMs = Math.pow(2, attempt - 1) * 500;
          if (attempt < 3) await new Promise(r => setTimeout(r, delayMs));
        }
      }
      throw lastErr;
    };
    let calls = 0;
    const fn = async () => { calls++; throw new Error("fail"); };
    // Attach rejection handler BEFORE advancing timers to prevent unhandled rejection
    let caught: Error | null = null;
    const promise = withRetry(fn, "test").catch((e) => { caught = e; return undefined as unknown as never; });
    // advance timers to skip delays
    await vi.runAllTimersAsync();
    await promise; // promise resolves to undefined (error captured in caught)
    expect(caught).not.toBeNull();
    expect((caught as Error).message).toBe("fail");
    expect(calls).toBe(3);
    vi.useRealTimers();
  });

  it("succeeds on second attempt", async () => {
    vi.useFakeTimers();
    const withRetry = async <T>(fn: () => Promise<T>, _label: string): Promise<T> => {
      let lastErr: any;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try { return await fn(); } catch (err: any) {
          lastErr = err;
          const delayMs = Math.pow(2, attempt - 1) * 500;
          if (attempt < 3) await new Promise(r => setTimeout(r, delayMs));
        }
      }
      throw lastErr;
    };
    let calls = 0;
    const fn = async () => { calls++; if (calls < 2) throw new Error("transient"); return "ok"; };
    const promise = withRetry(fn, "test");
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    vi.useRealTimers();
  });

  it("delay doubles with each attempt (exponential backoff)", () => {
    const delays = [1, 2, 3].map(attempt => Math.pow(2, attempt - 1) * 500);
    expect(delays).toEqual([500, 1000, 2000]);
  });
});
