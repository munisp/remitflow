/**
 * BDC Vault Router — SPEC-bdc §3.7 (owner: B3)
 *
 * Denomination-level vault/drawer/CIT inventory, dual-custodian CIT transfers,
 * counterfeit register, and insurance valuation.
 *
 * Conventions (verified against repo):
 *  - auditedProcedure / auditedAdminProcedure chains (server/_core/trpc.ts);
 *    privileged "manager" ops map to the platform admin role until a dedicated
 *    BDC staff-role model lands (SPEC §3: admin ops use the admin chain).
 *  - TOTP step-up via requireTotpStepUp on adjustStock + transferStock +
 *    confirmDelivery + reportCounterfeit (input `totpCode?: string`).
 *  - Money: numeric(18,2) MAJOR units (orchestrator amendment to SPEC §2) —
 *    sums are computed in integer cents via toCents() from ./_shared.
 *  - Inventory mutations are version-guarded optimistic-concurrency updates
 *    (WHERE version = :v, SET version = :v+1 — 0 rows → CONFLICT).
 *  - Single-winner status flips: UPDATE ... WHERE status = ... RETURNING —
 *    0 rows → CONFLICT. All multi-statement mutations run in db.transaction.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { router, auditedProcedure, auditedAdminProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import {
  bdcDenominationInventory,
  bdcCitManifests,
  bdcCounterfeitRegister,
} from "../../../drizzle/schema";
import { resolveTenantContext } from "../../tenantMiddleware";
import { requireTotpStepUp } from "../../_core/totpStepUp";
import { createAuditLog } from "../../audit.service";
import { assertBranchActive, getBdcProfile, toCents } from "./_shared";

// ─── Local helpers ────────────────────────────────────────────────────────────

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable (fail-closed)" });
  }
  return db;
}

/** Resolve the caller's tenant — every BDC query is tenant-scoped (SPEC §0.9). */
async function requireTenantId(userId: number): Promise<number> {
  const tenant = await resolveTenantContext(userId);
  if (!tenant.tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "An active tenant is required for BDC vault operations." });
  }
  return tenant.tenantId;
}

const locationRefSchema = z.object({
  locationType: z.enum(["vault", "drawer", "cit"]),
  locationId: z.number().int().positive(),
});
type LocationRef = z.infer<typeof locationRefSchema>;

const denominationSchema = z.string().regex(/^\d+(\.\d{1,2})?$/, "denomination must be a major-unit amount (e.g. '100.00')");

const itemSchema = z.object({
  currency: z.string().length(3),
  denomination: denominationSchema,
  noteCount: z.number().int().positive(),
});
type Item = z.infer<typeof itemSchema>;

const itemKey = (i: { currency: string; denomination: string }) =>
  `${i.currency.toUpperCase()}|${i.denomination}`;

/**
 * Version-guarded stock mutation inside a transaction.
 * delta < 0 additionally requires note_count >= -delta (no negative stock).
 * Returns the updated row; throws CONFLICT when the guard matches 0 rows.
 */
async function guardedStockMutation(
  tx: any,
  params: {
    tenantId: number;
    location: LocationRef;
    currency: string;
    denomination: string;
    delta: number;
  },
) {
  const { tenantId, location, currency, denomination, delta } = params;
  const rows = await tx
    .update(bdcDenominationInventory)
    .set({
      noteCount: sql`${bdcDenominationInventory.noteCount} + ${delta}`,
      version: sql`${bdcDenominationInventory.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(bdcDenominationInventory.tenantId, tenantId),
        eq(bdcDenominationInventory.locationType, location.locationType),
        eq(bdcDenominationInventory.locationId, location.locationId),
        eq(bdcDenominationInventory.currency, currency.toUpperCase()),
        eq(bdcDenominationInventory.denomination, denomination),
        // Version-guard: the row is re-read under the transaction; the +1
        // version bump makes concurrent writers collide. For decrements the
        // balance guard doubles as the "validated against from-location" check.
        ...(delta < 0 ? [sql`${bdcDenominationInventory.noteCount} >= ${-delta}`] : []),
      ),
    )
    .returning({
      id: bdcDenominationInventory.id,
      noteCount: bdcDenominationInventory.noteCount,
      version: bdcDenominationInventory.version,
    });
  if (rows.length === 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        delta < 0
          ? `Insufficient stock or concurrent modification for ${currency} ${denomination} at ${location.locationType}:${location.locationId}`
          : `Concurrent stock modification for ${currency} ${denomination} — retry`,
    });
  }
  return rows[0];
}

/** Increment helper with insert-if-absent (used on the receiving end of CIT). */
async function creditStock(
  tx: any,
  params: { tenantId: number; location: LocationRef; item: Item },
) {
  const { tenantId, location, item } = params;
  const [existing] = await tx
    .select({ id: bdcDenominationInventory.id, version: bdcDenominationInventory.version })
    .from(bdcDenominationInventory)
    .where(
      and(
        eq(bdcDenominationInventory.tenantId, tenantId),
        eq(bdcDenominationInventory.locationType, location.locationType),
        eq(bdcDenominationInventory.locationId, location.locationId),
        eq(bdcDenominationInventory.currency, item.currency.toUpperCase()),
        eq(bdcDenominationInventory.denomination, item.denomination),
      ),
    )
    .limit(1);
  if (!existing) {
    await tx.insert(bdcDenominationInventory).values({
      tenantId,
      locationType: location.locationType,
      locationId: location.locationId,
      currency: item.currency.toUpperCase(),
      denomination: item.denomination,
      noteCount: item.noteCount,
      version: 0,
    });
    return;
  }
  const rows = await tx
    .update(bdcDenominationInventory)
    .set({
      noteCount: sql`${bdcDenominationInventory.noteCount} + ${item.noteCount}`,
      version: sql`${bdcDenominationInventory.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(bdcDenominationInventory.id, existing.id),
        eq(bdcDenominationInventory.version, existing.version), // version-guarded
      ),
    )
    .returning({ id: bdcDenominationInventory.id });
  if (rows.length === 0) {
    throw new TRPCError({ code: "CONFLICT", message: "Concurrent stock modification — retry delivery confirmation" });
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const bdcVaultRouter = router({
  /** Stock for one location: denomination rows + per-currency totals (server-side). */
  getStock: auditedProcedure
    .input(z.object({
      locationType: z.enum(["vault", "drawer", "cit"]),
      locationId: z.number().int().positive(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      await getBdcProfile(db, tenantId);

      const rows = await db
        .select()
        .from(bdcDenominationInventory)
        .where(
          and(
            eq(bdcDenominationInventory.tenantId, tenantId),
            eq(bdcDenominationInventory.locationType, input.locationType),
            eq(bdcDenominationInventory.locationId, input.locationId),
          ),
        )
        .orderBy(bdcDenominationInventory.currency, bdcDenominationInventory.denomination);

      // Per-currency totals in integer cents: denomination × noteCount.
      const totalsMap = new Map<string, { currency: string; noteCount: number; totalCents: number }>();
      for (const row of rows) {
        const ccy = (row.currency ?? "").toUpperCase();
        const entry = totalsMap.get(ccy) ?? { currency: ccy, noteCount: 0, totalCents: 0 };
        entry.noteCount += row.noteCount;
        entry.totalCents += toCents(row.denomination ?? "0") * row.noteCount;
        totalsMap.set(ccy, entry);
      }

      return {
        location: { locationType: input.locationType, locationId: input.locationId },
        rows,
        totals: [...totalsMap.values()],
      };
    }),

  /** Stocktake correction (manager + TOTP). Version-guarded; audit before/after. */
  adjustStock: auditedAdminProcedure
    .input(z.object({
      location: locationRefSchema,
      currency: z.string().length(3),
      denomination: denominationSchema,
      noteCount: z.number().int().min(0), // absolute counted quantity
      expectedVersion: z.number().int().min(0).optional(),
      reason: z.string().min(5).max(500),
      totpCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      await getBdcProfile(db, tenantId);
      await requireTotpStepUp(ctx.user.id, input.totpCode, "vault stock adjustment");

      const result = await db.transaction(async (tx: any) => {
        const [before] = await tx
          .select()
          .from(bdcDenominationInventory)
          .where(
            and(
              eq(bdcDenominationInventory.tenantId, tenantId),
              eq(bdcDenominationInventory.locationType, input.location.locationType),
              eq(bdcDenominationInventory.locationId, input.location.locationId),
              eq(bdcDenominationInventory.currency, input.currency.toUpperCase()),
              eq(bdcDenominationInventory.denomination, input.denomination),
            ),
          )
          .limit(1);

        if (!before) {
          if (input.noteCount === 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "No inventory row to adjust and counted quantity is zero" });
          }
          const inserted = await tx
            .insert(bdcDenominationInventory)
            .values({
              tenantId,
              locationType: input.location.locationType,
              locationId: input.location.locationId,
              currency: input.currency.toUpperCase(),
              denomination: input.denomination,
              noteCount: input.noteCount,
              version: 0,
            })
            .returning();
          return { before: null, after: inserted[0] };
        }

        if (input.expectedVersion !== undefined && input.expectedVersion !== before.version) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Version mismatch: expected ${input.expectedVersion}, current ${before.version} — refresh and retry`,
          });
        }

        const updated = await tx
          .update(bdcDenominationInventory)
          .set({
            noteCount: input.noteCount,
            version: sql`${bdcDenominationInventory.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(bdcDenominationInventory.id, before.id),
              eq(bdcDenominationInventory.version, before.version), // version-guarded
            ),
          )
          .returning();
        if (updated.length === 0) {
          throw new TRPCError({ code: "CONFLICT", message: "Concurrent stock modification — refresh and retry" });
        }
        return { before, after: updated[0] };
      });

      await createAuditLog({
        userId: ctx.user.id,
        action: "BDC_VAULT_ADJUST_STOCK",
        targetType: "bdc_denomination_inventory",
        targetId: result.after.id,
        description: `Stocktake correction ${input.currency} ${input.denomination} at ${input.location.locationType}:${input.location.locationId}`,
        metadata: {
          tenantId,
          location: input.location,
          currency: input.currency.toUpperCase(),
          denomination: input.denomination,
          before: result.before ? { noteCount: result.before.noteCount, version: result.before.version } : null,
          after: { noteCount: result.after.noteCount, version: result.after.version },
          reason: input.reason,
        },
      });

      return result;
    }),

  /**
   * Maker leg of a CIT transfer: validates items against from-location
   * balances, decrements from-location (version-guarded, no negative stock),
   * and dispatches a manifest status 'in_transit' (custodianA = caller).
   */
  transferStock: auditedProcedure
    .input(z.object({
      from: locationRefSchema,
      to: locationRefSchema,
      items: z.array(itemSchema).min(1).max(200),
      custodianBId: z.number().int().positive(),
      note: z.string().max(500).optional(),
      totpCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      await getBdcProfile(db, tenantId);
      // Money-moving mutation — canonical step-up (F15), same pattern as confirmDelivery.
      await requireTotpStepUp(ctx.user.id, input.totpCode, "CIT stock transfer dispatch");

      if (input.custodianBId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Receiving custodian must differ from the maker (dual custody)" });
      }
      if (input.from.locationType === input.to.locationType && input.from.locationId === input.to.locationId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "from and to locations must differ" });
      }

      const manifest = await db.transaction(async (tx: any) => {
        for (const item of input.items) {
          // Version-guarded decrement; balance guard = validation against
          // from-location balances (0 rows → CONFLICT insufficient stock).
          await guardedStockMutation(tx, {
            tenantId,
            location: input.from,
            currency: item.currency,
            denomination: item.denomination,
            delta: -item.noteCount,
          });
        }
        const inserted = await tx
          .insert(bdcCitManifests)
          .values({
            tenantId,
            fromLocation: input.from,
            toLocation: input.to,
            items: input.items.map((i) => ({ ...i, currency: i.currency.toUpperCase() })),
            custodianAId: ctx.user.id,
            custodianBId: input.custodianBId,
            status: "in_transit",
            dispatchedAt: new Date(),
          })
          .returning();
        return inserted[0];
      });

      await createAuditLog({
        userId: ctx.user.id,
        action: "BDC_CIT_DISPATCH",
        targetType: "bdc_cit_manifests",
        targetId: manifest.id,
        description: `CIT manifest ${manifest.id} dispatched ${input.from.locationType}:${input.from.locationId} → ${input.to.locationType}:${input.to.locationId}`,
        metadata: { tenantId, from: input.from, to: input.to, items: input.items, custodianBId: input.custodianBId, note: input.note ?? null },
      });

      return manifest;
    }),

  /**
   * Checker leg (custodian B ≠ maker, + TOTP): recount vs manifest.
   * match → credit to-location + 'delivered'; mismatch → 'disputed' +
   * quarantine delta rows in the counterfeit/dispute register + audit.
   */
  confirmDelivery: auditedProcedure
    .input(z.object({
      manifestId: z.number().int().positive(),
      recount: z.array(itemSchema).min(0).max(200),
      totpCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      await getBdcProfile(db, tenantId);

      const [manifest] = await db
        .select()
        .from(bdcCitManifests)
        .where(and(eq(bdcCitManifests.id, input.manifestId), eq(bdcCitManifests.tenantId, tenantId)))
        .limit(1);
      if (!manifest) {
        throw new TRPCError({ code: "NOT_FOUND", message: "CIT manifest not found" });
      }
      if (manifest.custodianBId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the designated receiving custodian (custodianB) may confirm delivery" });
      }
      if (manifest.custodianAId === ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Maker-checker violation: the dispatching custodian cannot confirm delivery" });
      }
      await requireTotpStepUp(ctx.user.id, input.totpCode, "CIT delivery confirmation");

      const manifestItems = (manifest.items as Item[]).map((i) => ({ ...i, currency: i.currency.toUpperCase() }));
      const recount = input.recount.map((i) => ({ ...i, currency: i.currency.toUpperCase() }));

      const expected = new Map<string, number>();
      for (const i of manifestItems) expected.set(itemKey(i), (expected.get(itemKey(i)) ?? 0) + i.noteCount);
      const counted = new Map<string, number>();
      for (const i of recount) counted.set(itemKey(i), (counted.get(itemKey(i)) ?? 0) + i.noteCount);

      const deltas: Array<{ currency: string; denomination: string; expected: number; counted: number; delta: number }> = [];
      for (const key of new Set([...expected.keys(), ...counted.keys()])) {
        const exp = expected.get(key) ?? 0;
        const cnt = counted.get(key) ?? 0;
        if (exp !== cnt) {
          const [currency, denomination] = key.split("|");
          deltas.push({ currency, denomination, expected: exp, counted: cnt, delta: cnt - exp });
        }
      }
      const matched = deltas.length === 0;
      const nextStatus = matched ? "delivered" : "disputed";

      const toLocation = manifest.toLocation as LocationRef;

      const updated = await db.transaction(async (tx: any) => {
        // Guarded single-winner flip — only one confirmation can win.
        const flipped = await tx
          .update(bdcCitManifests)
          .set({
            status: nextStatus,
            deliveredAt: matched ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(bdcCitManifests.id, manifest.id),
              eq(bdcCitManifests.tenantId, tenantId),
              eq(bdcCitManifests.status, "in_transit"),
            ),
          )
          .returning();
        if (flipped.length === 0) {
          throw new TRPCError({ code: "CONFLICT", message: `Manifest ${manifest.id} is not in_transit (already ${manifest.status})` });
        }

        if (matched) {
          for (const item of manifestItems) {
            await creditStock(tx, { tenantId, location: toLocation, item });
          }
        } else {
          // Quarantine delta rows in the counterfeit/dispute register; notes
          // carry the full recount variance for investigation.
          for (const d of deltas) {
            await tx.insert(bdcCounterfeitRegister).values({
              tenantId,
              branchId: null,
              currency: d.currency,
              denomination: d.denomination,
              noteSerial: null,
              detectedByUserId: ctx.user.id,
              disposition: "quarantined",
              notes: `CIT dispute manifest=${manifest.id}: expected ${d.expected} × ${d.currency} ${d.denomination}, counted ${d.counted} (delta ${d.delta})`,
            });
          }
        }
        return flipped[0];
      });

      await createAuditLog({
        userId: ctx.user.id,
        action: matched ? "BDC_CIT_DELIVERED" : "BDC_CIT_DISPUTED",
        targetType: "bdc_cit_manifests",
        targetId: manifest.id,
        severity: matched ? "info" : "critical",
        description: matched
          ? `CIT manifest ${manifest.id} delivered to ${toLocation.locationType}:${toLocation.locationId}`
          : `CIT manifest ${manifest.id} DISPUTED — ${deltas.length} variance line(s) quarantined`,
        metadata: { tenantId, manifestId: manifest.id, matched, deltas, recount },
      });

      return { manifest: updated, matched, deltas };
    }),

  /** Counterfeit detection: register row + version-guarded inventory decrement + audit. */
  reportCounterfeit: auditedProcedure
    .input(z.object({
      branchId: z.number().int().positive(),
      location: locationRefSchema,
      currency: z.string().length(3),
      denomination: denominationSchema,
      noteSerial: z.string().max(64).optional(),
      noteCount: z.number().int().positive().default(1),
      notes: z.string().max(1000).optional(),
      totpCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      await getBdcProfile(db, tenantId);
      await assertBranchActive(db, tenantId, input.branchId);
      // Removes notes from sellable stock — canonical step-up (F15).
      await requireTotpStepUp(ctx.user.id, input.totpCode, "counterfeit report");

      const registerRow = await db.transaction(async (tx: any) => {
        // Version-guarded decrement — the notes leave sellable stock.
        await guardedStockMutation(tx, {
          tenantId,
          location: input.location,
          currency: input.currency,
          denomination: input.denomination,
          delta: -input.noteCount,
        });
        const inserted = await tx
          .insert(bdcCounterfeitRegister)
          .values({
            tenantId,
            branchId: input.branchId,
            currency: input.currency.toUpperCase(),
            denomination: input.denomination,
            noteSerial: input.noteSerial ?? null,
            detectedByUserId: ctx.user.id,
            disposition: "quarantined",
            notes: input.notes ?? null,
          })
          .returning();
        return inserted[0];
      });

      await createAuditLog({
        userId: ctx.user.id,
        action: "BDC_COUNTERFEIT_REPORTED",
        targetType: "bdc_counterfeit_register",
        targetId: registerRow.id,
        severity: "warning",
        description: `Counterfeit ${input.currency} ${input.denomination} ×${input.noteCount} quarantined at branch ${input.branchId}`,
        metadata: { tenantId, ...input, currency: input.currency.toUpperCase() },
      });

      return registerRow;
    }),

  /** Insurance valuation: stock totals per location (per currency, integer cents). */
  insuranceValue: auditedProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      await getBdcProfile(db, tenantId);

      const rows = await db
        .select()
        .from(bdcDenominationInventory)
        .where(eq(bdcDenominationInventory.tenantId, tenantId));

      const locations = new Map<string, {
        locationType: string;
        locationId: number;
        totals: Map<string, { currency: string; noteCount: number; totalCents: number }>;
      }>();
      const grand = new Map<string, { currency: string; noteCount: number; totalCents: number }>();

      for (const row of rows) {
        const locKey = `${row.locationType}:${row.locationId}`;
        const loc = locations.get(locKey) ?? {
          locationType: row.locationType ?? "unknown",
          locationId: row.locationId,
          totals: new Map(),
        };
        const ccy = (row.currency ?? "").toUpperCase();
        const cents = toCents(row.denomination ?? "0") * row.noteCount;
        const lt = loc.totals.get(ccy) ?? { currency: ccy, noteCount: 0, totalCents: 0 };
        lt.noteCount += row.noteCount;
        lt.totalCents += cents;
        loc.totals.set(ccy, lt);
        locations.set(locKey, loc);

        const gt = grand.get(ccy) ?? { currency: ccy, noteCount: 0, totalCents: 0 };
        gt.noteCount += row.noteCount;
        gt.totalCents += cents;
        grand.set(ccy, gt);
      }

      return {
        tenantId,
        valuedAt: new Date().toISOString(),
        locations: [...locations.values()].map((l) => ({
          locationType: l.locationType,
          locationId: l.locationId,
          totals: [...l.totals.values()],
        })),
        grandTotals: [...grand.values()],
      };
    }),
});
