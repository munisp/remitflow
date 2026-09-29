/**
 * W17-C2 — Admin feature flags console (/admin/feature-flags, AdminRoute-gated).
 *
 * First admin UI consumer of the mounted `featureFlags` namespace
 * (server/routers/featureFlags.ts — 10 procs; this console wires the 2
 * read-side protectedProcedure procs `list` / `categories` plus all 6
 * adminProcedure mutations `toggle`, `setTenantOverride`,
 * `removeTenantOverride`, `setUserOverride`, `upsert`, `delete`. The
 * user-scope readers `check` and `getNavFlags` are deliberately not consumed
 * here):
 *   - list:    flag table with category/search/tenant filters and the
 *              server-computed effectiveEnabled / tenantOverride /
 *              userOverride overlays
 *   - actions: toggle (global enable + optional rollout %), upsert editor
 *              (create custom flag or edit existing), delete (confirm + TOTP)
 *   - overrides: tenant override set/remove and user override set forms
 *
 * TOTP step-up follows the BDC console pattern (pages/bdc/TotpField.tsx):
 * the 6-digit code is forwarded as `totpCode` on every admin mutation when
 * entered; the PBAC middleware enforces MFA fail-closed and any server
 * "2FA_REQUIRED"/FORBIDDEN error is surfaced verbatim. This console renders
 * server data only — every fetch failure is a dismissible red banner (PWA has
 * no toast library) and an empty flag list is an honest empty state.
 *
 * Visual/interaction standard: KycReviewConsole + BDC consoles (Tailwind,
 * rounded-2xl cards, indigo accents, shared primitives from pages/bdc/ui.tsx).
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  errorMessage,
  featureFlagsApi,
  type FeatureFlagRow,
  type FeatureFlagScope,
} from "./api";
import TotpField from "../../bdc/TotpField";
import {
  Badge,
  btnDangerCls,
  btnPrimaryCls,
  btnSecondaryCls,
  Card,
  Field,
  inputCls,
  PageHeader,
  Spinner,
} from "../../bdc/ui";

function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** Dismissible red error banner — fail-closed pattern (pages/Beneficiaries.tsx). */
const ErrorBanner: React.FC<{ message: string; onDismiss: () => void }> = ({
  message,
  onDismiss,
}) => (
  <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700 flex items-start justify-between gap-4">
    <span className="text-sm whitespace-pre-wrap">{message}</span>
    <button
      type="button"
      onClick={onDismiss}
      className="text-red-500 hover:text-red-700 text-sm font-medium shrink-0"
    >
      Dismiss
    </button>
  </div>
);

const SuccessBanner: React.FC<{ message: string; onDismiss: () => void }> = ({
  message,
  onDismiss,
}) => (
  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700 flex items-start justify-between gap-4">
    <span className="text-sm whitespace-pre-wrap">{message}</span>
    <button
      type="button"
      onClick={onDismiss}
      className="text-emerald-600 hover:text-emerald-800 text-sm font-medium shrink-0"
    >
      Dismiss
    </button>
  </div>
);

interface UpsertFormState {
  id?: number;
  key: string;
  name: string;
  description: string;
  scope: FeatureFlagScope;
  defaultEnabled: boolean;
  rolloutPct: number;
  category: string;
  tags: string; // comma-separated in the form
}

const EMPTY_UPSERT: UpsertFormState = {
  key: "",
  name: "",
  description: "",
  scope: "global",
  defaultEnabled: true,
  rolloutPct: 100,
  category: "feature",
  tags: "",
};

const FeatureFlagsConsole: React.FC = () => {
  // ── list / filters ──
  const [flags, setFlags] = useState<FeatureFlagRow[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [tenantFilter, setTenantFilter] = useState("");
  const [listLoading, setListLoading] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);

  // ── flag-row actions (toggle / delete) ──
  const [rowTotp, setRowTotp] = useState("");
  const [rowBusyId, setRowBusyId] = useState<number | null>(null);
  const [rolloutDrafts, setRolloutDrafts] = useState<Record<number, string>>({});
  const [rowErr, setRowErr] = useState<string | null>(null);
  const [rowMsg, setRowMsg] = useState<string | null>(null);

  // ── upsert editor ──
  const [editorOpen, setEditorOpen] = useState(false);
  const [upsertForm, setUpsertForm] = useState<UpsertFormState>(EMPTY_UPSERT);
  const [upsertTotp, setUpsertTotp] = useState("");
  const [upsertBusy, setUpsertBusy] = useState(false);
  const [upsertErr, setUpsertErr] = useState<string | null>(null);
  const [upsertMsg, setUpsertMsg] = useState<string | null>(null);

  // ── tenant override ──
  const [tFlagId, setTFlagId] = useState("");
  const [tTenantId, setTTenantId] = useState("");
  const [tEnabled, setTEnabled] = useState(true);
  const [tReason, setTReason] = useState("");
  const [tExpiresAt, setTExpiresAt] = useState("");
  const [tTotp, setTTotp] = useState("");
  const [tBusy, setTBusy] = useState(false);
  const [tErr, setTErr] = useState<string | null>(null);
  const [tMsg, setTMsg] = useState<string | null>(null);

  // ── user override ──
  const [uFlagId, setUFlagId] = useState("");
  const [uUserId, setUUserId] = useState("");
  const [uEnabled, setUEnabled] = useState(true);
  const [uTotp, setUTotp] = useState("");
  const [uBusy, setUBusy] = useState(false);
  const [uErr, setUErr] = useState<string | null>(null);
  const [uMsg, setUMsg] = useState<string | null>(null);

  const loadFlags = useCallback(async () => {
    setListLoading(true);
    setListErr(null);
    try {
      const tenantId = tenantFilter.trim() ? Number(tenantFilter) : undefined;
      const input: { category?: string; search?: string; tenantId?: number } = {};
      if (category) input.category = category;
      if (search.trim()) input.search = search.trim();
      if (tenantId !== undefined && Number.isInteger(tenantId) && tenantId > 0) input.tenantId = tenantId;
      const res = await featureFlagsApi.featureFlags.list.query(input);
      setFlags(res);
    } catch (e) {
      setFlags(null);
      setListErr(errorMessage(e, "Feature flags could not be loaded. The API may be unavailable."));
    } finally {
      setListLoading(false);
    }
  }, [category, search, tenantFilter]);

  const loadCategories = useCallback(async () => {
    try {
      setCategories(await featureFlagsApi.featureFlags.categories.query());
    } catch {
      // Categories drive only the filter dropdown — fail closed to no options.
      setCategories([]);
    }
  }, []);

  useEffect(() => {
    void loadCategories();
    void loadFlags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── row mutations ──

  const toggleFlag = async (flag: FeatureFlagRow) => {
    setRowBusyId(flag.id);
    setRowErr(null);
    setRowMsg(null);
    try {
      const totpCode = rowTotp.length === 6 ? rowTotp : undefined;
      const rolloutRaw = (rolloutDrafts[flag.id] ?? "").trim();
      const rolloutPct = rolloutRaw === "" ? undefined : Number(rolloutRaw);
      await featureFlagsApi.featureFlags.toggle.mutate({
        flagId: flag.id,
        enabled: !flag.defaultEnabled,
        ...(rolloutPct !== undefined && Number.isFinite(rolloutPct) ? { rolloutPct } : {}),
        ...(totpCode ? { totpCode } : {}),
      });
      setRowMsg(`Flag "${flag.key}" ${flag.defaultEnabled ? "disabled" : "enabled"} globally (server verified).`);
      setRowTotp("");
      void loadFlags();
    } catch (e) {
      setRowErr(errorMessage(e, "Toggle failed."));
    } finally {
      setRowBusyId(null);
    }
  };

  const deleteFlag = async (flag: FeatureFlagRow) => {
    if (!window.confirm(`Delete feature flag "${flag.key}" (#${flag.id})? This removes the flag row and its overrides.`)) {
      return;
    }
    setRowBusyId(flag.id);
    setRowErr(null);
    setRowMsg(null);
    try {
      const totpCode = rowTotp.length === 6 ? rowTotp : undefined;
      await featureFlagsApi.featureFlags.delete.mutate({
        id: flag.id,
        ...(totpCode ? { totpCode } : {}),
      });
      setRowMsg(`Flag "${flag.key}" deleted (server verified).`);
      setRowTotp("");
      void loadFlags();
    } catch (e) {
      setRowErr(errorMessage(e, "Delete failed."));
    } finally {
      setRowBusyId(null);
    }
  };

  // ── upsert ──

  const openCreate = () => {
    setUpsertForm(EMPTY_UPSERT);
    setUpsertErr(null);
    setUpsertMsg(null);
    setEditorOpen(true);
  };

  const openEdit = (flag: FeatureFlagRow) => {
    setUpsertForm({
      id: flag.id,
      key: flag.key,
      name: flag.name,
      description: flag.description ?? "",
      scope: (flag.scope as FeatureFlagScope) || "global",
      defaultEnabled: flag.defaultEnabled,
      rolloutPct: flag.rolloutPct,
      category: flag.category ?? "feature",
      tags: (flag.tags ?? []).join(", "),
    });
    setUpsertErr(null);
    setUpsertMsg(null);
    setEditorOpen(true);
  };

  const submitUpsert = async () => {
    const f = upsertForm;
    if (f.key.trim().length < 2 || f.name.trim().length < 2) {
      setUpsertErr("Key and name must be at least 2 characters (server-enforced).");
      return;
    }
    setUpsertBusy(true);
    setUpsertErr(null);
    setUpsertMsg(null);
    try {
      const totpCode = upsertTotp.length === 6 ? upsertTotp : undefined;
      const tags = f.tags.split(",").map((t) => t.trim()).filter(Boolean);
      const res = await featureFlagsApi.featureFlags.upsert.mutate({
        ...(f.id !== undefined ? { id: f.id } : {}),
        key: f.key.trim(),
        name: f.name.trim(),
        ...(f.description.trim() ? { description: f.description.trim() } : {}),
        scope: f.scope,
        defaultEnabled: f.defaultEnabled,
        rolloutPct: f.rolloutPct,
        category: f.category.trim() || "feature",
        tags,
        ...(totpCode ? { totpCode } : {}),
      });
      setUpsertMsg(`Flag ${f.id !== undefined ? "updated" : "created"} (id ${res.id}).`);
      setUpsertTotp("");
      setEditorOpen(false);
      void loadFlags();
    } catch (e) {
      setUpsertErr(errorMessage(e, "Upsert failed."));
    } finally {
      setUpsertBusy(false);
    }
  };

  // ── overrides ──

  const submitTenantOverride = async (remove: boolean) => {
    const tenantId = Number(tTenantId);
    const flagId = Number(tFlagId);
    if (!Number.isInteger(tenantId) || tenantId <= 0 || !Number.isInteger(flagId) || flagId <= 0) {
      setTErr("Enter valid positive numeric tenant ID and flag ID.");
      return;
    }
    setTBusy(true);
    setTErr(null);
    setTMsg(null);
    try {
      const totpCode = tTotp.length === 6 ? tTotp : undefined;
      if (remove) {
        await featureFlagsApi.featureFlags.removeTenantOverride.mutate({
          tenantId,
          flagId,
          ...(totpCode ? { totpCode } : {}),
        });
        setTMsg(`Tenant override removed (tenant ${tenantId}, flag ${flagId}) — reverts to global default.`);
      } else {
        await featureFlagsApi.featureFlags.setTenantOverride.mutate({
          tenantId,
          flagId,
          enabled: tEnabled,
          ...(tReason.trim() ? { reason: tReason.trim() } : {}),
          ...(tExpiresAt ? { expiresAt: tExpiresAt } : {}),
          ...(totpCode ? { totpCode } : {}),
        });
        setTMsg(`Tenant override set (tenant ${tenantId}, flag ${flagId}, enabled=${tEnabled}).`);
      }
      setTTotp("");
      void loadFlags();
    } catch (e) {
      setTErr(errorMessage(e, "Tenant override failed."));
    } finally {
      setTBusy(false);
    }
  };

  const submitUserOverride = async () => {
    const userId = Number(uUserId);
    const flagId = Number(uFlagId);
    if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(flagId) || flagId <= 0) {
      setUErr("Enter valid positive numeric user ID and flag ID.");
      return;
    }
    setUBusy(true);
    setUErr(null);
    setUMsg(null);
    try {
      const totpCode = uTotp.length === 6 ? uTotp : undefined;
      await featureFlagsApi.featureFlags.setUserOverride.mutate({
        userId,
        flagId,
        enabled: uEnabled,
        ...(totpCode ? { totpCode } : {}),
      });
      setUMsg(`User override set (user ${userId}, flag ${flagId}, enabled=${uEnabled}).`);
      setUTotp("");
      void loadFlags();
    } catch (e) {
      setUErr(errorMessage(e, "User override failed."));
    } finally {
      setUBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageHeader
          title="Feature Flags"
          subtitle="Global toggles, rollout percentages, tenant/user overrides, and custom flag management."
        />
        <button type="button" onClick={openCreate} className={btnPrimaryCls}>
          New flag
        </button>
      </div>

      {/* ── upsert editor ── */}
      {editorOpen && (
        <Card title={upsertForm.id !== undefined ? `Edit flag #${upsertForm.id}` : "Create flag"}>
          {upsertErr && <div className="mb-3"><ErrorBanner message={upsertErr} onDismiss={() => setUpsertErr(null)} /></div>}
          {upsertMsg && <div className="mb-3"><SuccessBanner message={upsertMsg} onDismiss={() => setUpsertMsg(null)} /></div>}
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Key (2-100 chars)">
              <input value={upsertForm.key} onChange={(e) => setUpsertForm((f) => ({ ...f, key: e.target.value }))} className={inputCls} placeholder="my_feature_key" />
            </Field>
            <Field label="Name (2-255 chars)">
              <input value={upsertForm.name} onChange={(e) => setUpsertForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} placeholder="My Feature" />
            </Field>
            <Field label="Description (optional)">
              <input value={upsertForm.description} onChange={(e) => setUpsertForm((f) => ({ ...f, description: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="Category">
              <input value={upsertForm.category} onChange={(e) => setUpsertForm((f) => ({ ...f, category: e.target.value }))} className={inputCls} placeholder="feature" />
            </Field>
            <Field label="Scope">
              <select value={upsertForm.scope} onChange={(e) => setUpsertForm((f) => ({ ...f, scope: e.target.value as FeatureFlagScope }))} className={inputCls}>
                <option value="global">global</option>
                <option value="tenant">tenant</option>
                <option value="user">user</option>
              </select>
            </Field>
            <Field label="Rollout %">
              <input
                type="number"
                min={0}
                max={100}
                value={upsertForm.rolloutPct}
                onChange={(e) => setUpsertForm((f) => ({ ...f, rolloutPct: Number(e.target.value) }))}
                className={inputCls}
              />
            </Field>
            <Field label="Tags (comma-separated)">
              <input value={upsertForm.tags} onChange={(e) => setUpsertForm((f) => ({ ...f, tags: e.target.value }))} className={inputCls} placeholder="beta, payments" />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-700 self-end pb-2">
              <input
                type="checkbox"
                checked={upsertForm.defaultEnabled}
                onChange={(e) => setUpsertForm((f) => ({ ...f, defaultEnabled: e.target.checked }))}
              />
              Enabled by default
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-4 mt-4">
            <TotpField value={upsertTotp} onChange={setUpsertTotp} disabled={upsertBusy} />
            <button type="button" onClick={() => void submitUpsert()} className={btnPrimaryCls} disabled={upsertBusy}>
              {upsertBusy ? "Saving…" : upsertForm.id !== undefined ? "Save changes" : "Create flag"}
            </button>
            <button type="button" onClick={() => setEditorOpen(false)} className={btnSecondaryCls} disabled={upsertBusy}>
              Close
            </button>
          </div>
        </Card>
      )}

      {/* ── filters ── */}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Category">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Search">
          <input value={search} onChange={(e) => setSearch(e.target.value)} className={inputCls} placeholder="name, key, or description" />
        </Field>
        <Field label="Tenant ID (overlay view)" hint="Shows tenant overrides for this tenant.">
          <input value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value.replace(/\D/g, ""))} className={inputCls} placeholder="optional" inputMode="numeric" />
        </Field>
        <button type="button" onClick={() => void loadFlags()} className={btnSecondaryCls} disabled={listLoading}>
          Apply / refresh
        </button>
      </div>

      {listErr && <ErrorBanner message={listErr} onDismiss={() => setListErr(null)} />}
      {rowErr && <ErrorBanner message={rowErr} onDismiss={() => setRowErr(null)} />}
      {rowMsg && <SuccessBanner message={rowMsg} onDismiss={() => setRowMsg(null)} />}

      {/* ── flag list ── */}
      {listLoading && <Spinner label="Loading feature flags..." />}
      {flags && (
        <Card title={`Flags (${flags.length})`}>
          <div className="mb-3">
            <TotpField value={rowTotp} onChange={setRowTotp} disabled={rowBusyId !== null} label="TOTP step-up code (toggle / delete)" />
          </div>
          {flags.length === 0 ? (
            <p className="text-sm text-slate-500">No feature flags matched the current filters.</p>
          ) : (
            <div className="space-y-3">
              {flags.map((f) => (
                <div key={f.id} className="rounded-xl border border-slate-100 p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-900">{f.name}</span>
                      <span className="font-mono text-xs text-slate-500">{f.key}</span>
                      <Badge tone="neutral">#{f.id}</Badge>
                      {f.category && <Badge tone="info">{f.category}</Badge>}
                      <Badge tone="neutral">{f.scope}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={f.defaultEnabled ? "ok" : "bad"}>
                        default {f.defaultEnabled ? "on" : "off"}
                      </Badge>
                      <Badge tone={f.effectiveEnabled ? "ok" : "warn"}>
                        effective {f.effectiveEnabled ? "on" : "off"}
                      </Badge>
                      {f.rolloutPct < 100 && <Badge tone="warn">rollout {f.rolloutPct}%</Badge>}
                    </div>
                  </div>
                  {f.description && <p className="text-xs text-slate-500">{f.description}</p>}
                  <p className="text-xs text-slate-400">
                    tenant override: {f.tenantOverride === null ? "—" : f.tenantOverride ? "on" : "off"}
                    {" · "}user override: {f.userOverride === null ? "—" : f.userOverride ? "on" : "off"}
                    {" · "}updated {fmtDate(f.updatedAt)}
                  </p>
                  <div className="flex flex-wrap items-end gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => void toggleFlag(f)}
                      className={f.defaultEnabled ? btnDangerCls : btnPrimaryCls}
                      disabled={rowBusyId !== null}
                    >
                      {rowBusyId === f.id ? "Working…" : f.defaultEnabled ? "Disable globally" : "Enable globally"}
                    </button>
                    <Field label="Rollout % (optional, applied on toggle)">
                      <input
                        value={rolloutDrafts[f.id] ?? ""}
                        onChange={(e) => setRolloutDrafts((m) => ({ ...m, [f.id]: e.target.value.replace(/\D/g, "") }))}
                        className={`${inputCls} w-24`}
                        placeholder={String(f.rolloutPct)}
                        inputMode="numeric"
                      />
                    </Field>
                    <button type="button" onClick={() => openEdit(f)} className={btnSecondaryCls} disabled={rowBusyId !== null}>
                      Edit
                    </button>
                    <button type="button" onClick={() => void deleteFlag(f)} className={btnDangerCls} disabled={rowBusyId !== null}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── tenant overrides ── */}
      <Card title="Tenant override (set / remove — TOTP step-up)">
        {tErr && <div className="mb-3"><ErrorBanner message={tErr} onDismiss={() => setTErr(null)} /></div>}
        {tMsg && <div className="mb-3"><SuccessBanner message={tMsg} onDismiss={() => setTMsg(null)} /></div>}
        <div className="grid md:grid-cols-3 gap-4">
          <Field label="Tenant ID">
            <input value={tTenantId} onChange={(e) => setTTenantId(e.target.value.replace(/\D/g, ""))} className={inputCls} inputMode="numeric" />
          </Field>
          <Field label="Flag">
            <select value={tFlagId} onChange={(e) => setTFlagId(e.target.value)} className={inputCls}>
              <option value="">Select flag…</option>
              {(flags ?? []).map((f) => (
                <option key={f.id} value={f.id}>#{f.id} — {f.key}</option>
              ))}
            </select>
          </Field>
          <Field label="Enabled">
            <select value={tEnabled ? "on" : "off"} onChange={(e) => setTEnabled(e.target.value === "on")} className={inputCls}>
              <option value="on">on</option>
              <option value="off">off</option>
            </select>
          </Field>
          <Field label="Reason (optional)">
            <input value={tReason} onChange={(e) => setTReason(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Expires at (optional ISO timestamp)">
            <input value={tExpiresAt} onChange={(e) => setTExpiresAt(e.target.value)} className={inputCls} placeholder="2025-12-31T00:00:00Z" />
          </Field>
          <div className="self-end">
            <TotpField value={tTotp} onChange={setTTotp} disabled={tBusy} />
          </div>
        </div>
        <div className="flex gap-3 mt-4">
          <button type="button" onClick={() => void submitTenantOverride(false)} className={btnPrimaryCls} disabled={tBusy || !tTenantId || !tFlagId}>
            {tBusy ? "Working…" : "Set tenant override"}
          </button>
          <button type="button" onClick={() => void submitTenantOverride(true)} className={btnDangerCls} disabled={tBusy || !tTenantId || !tFlagId}>
            Remove override
          </button>
        </div>
      </Card>

      {/* ── user overrides ── */}
      <Card title="User override (beta / early access — TOTP step-up)">
        {uErr && <div className="mb-3"><ErrorBanner message={uErr} onDismiss={() => setUErr(null)} /></div>}
        {uMsg && <div className="mb-3"><SuccessBanner message={uMsg} onDismiss={() => setUMsg(null)} /></div>}
        <div className="grid md:grid-cols-3 gap-4">
          <Field label="User ID">
            <input value={uUserId} onChange={(e) => setUUserId(e.target.value.replace(/\D/g, ""))} className={inputCls} inputMode="numeric" />
          </Field>
          <Field label="Flag">
            <select value={uFlagId} onChange={(e) => setUFlagId(e.target.value)} className={inputCls}>
              <option value="">Select flag…</option>
              {(flags ?? []).map((f) => (
                <option key={f.id} value={f.id}>#{f.id} — {f.key}</option>
              ))}
            </select>
          </Field>
          <Field label="Enabled">
            <select value={uEnabled ? "on" : "off"} onChange={(e) => setUEnabled(e.target.value === "on")} className={inputCls}>
              <option value="on">on</option>
              <option value="off">off</option>
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-4 mt-4">
          <TotpField value={uTotp} onChange={setUTotp} disabled={uBusy} />
          <button type="button" onClick={() => void submitUserOverride()} className={btnPrimaryCls} disabled={uBusy || !uUserId || !uFlagId}>
            {uBusy ? "Working…" : "Set user override"}
          </button>
        </div>
      </Card>
    </div>
  );
};

export default FeatureFlagsConsole;
