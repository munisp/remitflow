import React, { useCallback, useEffect, useState } from "react";
import {
  bdc,
  errMsg,
  fmtCountdown,
  fmtDateTime,
  fmtMoney,
  newIdempotencyKey,
  PICKUP_AGENT_ID_TYPES,
  type ExecutePickupResult,
  type PickupAgentIdType,
  type PickupAuthorizationRow,
  type PickupStatus,
} from "./api";
import {
  Badge,
  btnDangerCls,
  btnPrimaryCls,
  btnSecondaryCls,
  Card,
  ErrorNote,
  Field,
  inputCls,
  PageHeader,
  Spinner,
  statusTone,
  SuccessNote,
} from "./ui";
import TotpField from "./TotpField";

const STATUS_FILTERS: readonly PickupStatus[] = ["pending", "used", "expired", "revoked"];

/** Ticking clock so expiresAt countdowns stay live. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * Third-party cash pickup authorizations (SPEC-wave12 §4.8 / §6.1) —
 * teller-facing (ProtectedRoute, like BdcTeller; the server-side procedure
 * guards remain authoritative — revoke is an admin procedure and will surface
 * FORBIDDEN to non-admins honestly).
 *
 * The agent ID number is captured once, encrypted server-side, and never
 * returned by any list/get API; execution re-verifies it with a constant-time
 * comparison (UNAUTHORIZED on mismatch). Dual control: the maker of the
 * transaction cannot execute its own agent pickup (server FORBIDDEN).
 */
const BdcPickup: React.FC = () => {
  useNow(); // re-render every second for live countdowns

  // ── authorize form ──
  const [customerId, setCustomerId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentIdType, setAgentIdType] = useState<PickupAgentIdType>("nin");
  const [agentIdNumber, setAgentIdNumber] = useState("");
  const [relationship, setRelationship] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [expiresInHours, setExpiresInHours] = useState("24");
  const [authTotp, setAuthTotp] = useState("");
  // Generate ONCE per user action so a retried submit replays idempotently;
  // rotated only after a successful authorization.
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey());
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const [authErr, setAuthErr] = useState<string | null>(null);

  // ── list ──
  const [rows, setRows] = useState<PickupAuthorizationRow[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [revokeTotp, setRevokeTotp] = useState<Record<number, string>>({});
  const [rowMsg, setRowMsg] = useState<Record<number, { kind: "ok" | "err"; text: string }>>({});

  // ── execute panel ──
  const [execAuthId, setExecAuthId] = useState("");
  const [execTxnId, setExecTxnId] = useState("");
  const [execAgentIdNumber, setExecAgentIdNumber] = useState("");
  const [execTotp, setExecTotp] = useState("");
  const [execBusy, setExecBusy] = useState(false);
  const [execResult, setExecResult] = useState<ExecutePickupResult | null>(null);
  const [execErr, setExecErr] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: number) => {
      setListLoading(true);
      setListErr(null);
      try {
        const res = await bdc.pickup.listAuthorizations.query({
          ...(customerFilter ? { customerId: Number(customerFilter) } : {}),
          ...(statusFilter ? { status: statusFilter as PickupStatus } : {}),
          ...(cursor ? { cursor } : {}),
        });
        setRows((prev) => (cursor ? [...prev, ...res.rows] : res.rows));
        setNextCursor(res.nextCursor);
      } catch (e) {
        setListErr(errMsg(e));
        if (!cursor) setRows([]);
      } finally {
        setListLoading(false);
      }
    },
    [statusFilter, customerFilter],
  );

  useEffect(() => {
    load();
  }, [load]);

  const authorize = async () => {
    setAuthBusy(true);
    setAuthMsg(null);
    setAuthErr(null);
    try {
      const res = await bdc.pickup.authorizePickup.mutate({
        customerId: Number(customerId),
        agentFullName: agentName,
        agentIdType,
        agentIdNumber,
        relationship,
        ...(maxAmount.trim() ? { maxAmount: maxAmount.trim() } : {}),
        expiresInHours: Number(expiresInHours),
        idempotencyKey: idemKey,
        totpCode: authTotp,
      });
      setAuthMsg(
        `Authorization #${res.authorizationId} created (status '${res.status}') — expires ${fmtDateTime(res.expiresAt)}.`,
      );
      // Rotate the idempotency key only after success: a failed submit keeps
      // the same key so a retry replays idempotently.
      setIdemKey(newIdempotencyKey());
      setAgentName("");
      setAgentIdNumber("");
      setRelationship("");
      setMaxAmount("");
      setAuthTotp("");
      await load();
    } catch (e) {
      // Honest failures: KYC not verified / rescreen-blocked →
      // PRECONDITION_FAILED; customer not found → NOT_FOUND.
      setAuthErr(errMsg(e));
    } finally {
      setAuthBusy(false);
    }
  };

  const revoke = async (authorizationId: number) => {
    const code = revokeTotp[authorizationId] ?? "";
    setRowMsg((m) => ({ ...m, [authorizationId]: { kind: "ok", text: "Revoking…" } }));
    try {
      await bdc.pickup.revokeAuthorization.mutate({ authorizationId, totpCode: code });
      setRowMsg((m) => ({
        ...m,
        [authorizationId]: { kind: "ok", text: `Authorization #${authorizationId} revoked.` },
      }));
      setRevokeTotp((m) => ({ ...m, [authorizationId]: "" }));
      await load();
    } catch (e) {
      // Admin procedure: FORBIDDEN for tellers; CONFLICT when not pending.
      setRowMsg((m) => ({ ...m, [authorizationId]: { kind: "err", text: errMsg(e) } }));
    }
  };

  const execute = async () => {
    setExecBusy(true);
    setExecResult(null);
    setExecErr(null);
    try {
      const res = await bdc.pickup.executeAgentPickup.mutate({
        authorizationId: Number(execAuthId),
        transactionId: Number(execTxnId),
        agentIdNumber: execAgentIdNumber,
        totpCode: execTotp,
      });
      setExecResult(res);
      setExecAgentIdNumber("");
      setExecTotp("");
      await load();
    } catch (e) {
      // Honest error surfacing verbatim — the server distinguishes:
      // UNAUTHORIZED (agent ID mismatch), FORBIDDEN (dual-control: maker
      // cannot execute own pickup), PRECONDITION_FAILED (expired / wrong
      // customer / amount over cap), CONFLICT (already used).
      setExecErr(errMsg(e));
    } finally {
      setExecBusy(false);
    }
  };

  const maxAmountValid = !maxAmount.trim() || /^\d+(\.\d{1,2})?$/.test(maxAmount.trim());

  return (
    <div className="space-y-6">
      <PageHeader
        title="BDC Agent Pickup"
        subtitle="Third-party cash pickup authorizations (bdc.pickup.*)"
      />

      <Card title="Authorize agent pickup (bdc.pickup.authorizePickup + TOTP)">
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Customer ID">
              <input
                className={inputCls}
                inputMode="numeric"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <Field label="Agent full name">
              <input
                className={inputCls}
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="As printed on the agent's ID"
              />
            </Field>
            <Field label="Relationship">
              <input
                className={inputCls}
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                placeholder="e.g. spouse, driver"
              />
            </Field>
            <Field label="Agent ID type">
              <select
                className={inputCls}
                value={agentIdType}
                onChange={(e) => setAgentIdType(e.target.value as PickupAgentIdType)}
              >
                {PICKUP_AGENT_ID_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field
              label="Agent ID number"
              hint="Encrypted at rest; re-verified at release. Never shown again."
            >
              <input
                className={inputCls}
                value={agentIdNumber}
                onChange={(e) => setAgentIdNumber(e.target.value)}
              />
            </Field>
            <Field label="Max amount (major units, optional)">
              <input
                className={inputCls}
                inputMode="decimal"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                placeholder="e.g. 500.00"
              />
              {!maxAmountValid && (
                <p className="text-xs text-amber-600 mt-1">
                  Must be a major-unit amount like 500 or 500.00
                </p>
              )}
            </Field>
            <Field label="Expires in (hours, 1–72)">
              <input
                className={inputCls}
                inputMode="numeric"
                value={expiresInHours}
                onChange={(e) => setExpiresInHours(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <TotpField value={authTotp} onChange={setAuthTotp} label="Teller TOTP" />
            <button
              className={btnPrimaryCls}
              disabled={
                !customerId ||
                agentName.trim().length < 2 ||
                agentIdNumber.trim().length < 4 ||
                relationship.trim().length < 2 ||
                !maxAmountValid ||
                !expiresInHours ||
                Number(expiresInHours) < 1 ||
                Number(expiresInHours) > 72 ||
                authTotp.length !== 6 ||
                authBusy
              }
              onClick={authorize}
            >
              {authBusy ? "Authorizing…" : "Authorize pickup"}
            </button>
          </div>
          {authMsg && <SuccessNote>{authMsg}</SuccessNote>}
          {authErr && <ErrorNote error={authErr} />}
        </div>
      </Card>

      <Card title="Authorizations (bdc.pickup.listAuthorizations)">
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Field label="Status">
                <select
                  className={inputCls}
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="">all</option>
                  {STATUS_FILTERS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="w-40">
              <Field label="Customer ID">
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={customerFilter}
                  onChange={(e) => setCustomerFilter(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
            </div>
            <button className={btnSecondaryCls} onClick={() => load()}>
              Refresh list
            </button>
          </div>
          {listErr && <ErrorNote error={listErr} />}
          {listLoading && rows.length === 0 ? (
            <Spinner label="Loading authorizations…" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-400">No authorizations found.</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {rows.map((r) => (
                <div key={r.id} className="py-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        #{r.id} · {r.agentFullName} ({r.agentIdType}) · customer {r.customerId}
                      </p>
                      <p className="text-xs text-slate-400">
                        {r.relationship}
                        {r.maxAmount != null ? ` · max ${fmtMoney(r.maxAmount)}` : " · no amount cap"}
                        {r.txnId != null ? ` · txn ${r.txnId}` : ""}
                        {r.usedAt ? ` · used ${fmtDateTime(r.usedAt)} by user ${r.usedBy ?? "?"}` : ""}
                        {r.createdAt ? ` · created ${fmtDateTime(r.createdAt)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.status === "pending" && (
                        <Badge tone={fmtCountdown(r.expiresAt) === "EXPIRED" ? "bad" : "info"}>
                          expires in {fmtCountdown(r.expiresAt)}
                        </Badge>
                      )}
                      <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                    </div>
                  </div>
                  {r.status === "pending" && (
                    <div className="flex flex-wrap items-end gap-2">
                      <TotpField
                        value={revokeTotp[r.id] ?? ""}
                        onChange={(c) => setRevokeTotp((m) => ({ ...m, [r.id]: c }))}
                        label="Admin TOTP (revoke)"
                      />
                      <button
                        className={btnDangerCls}
                        disabled={(revokeTotp[r.id] ?? "").length !== 6}
                        onClick={() => revoke(r.id)}
                      >
                        Revoke
                      </button>
                    </div>
                  )}
                  {rowMsg[r.id] &&
                    (rowMsg[r.id].kind === "ok" ? (
                      <SuccessNote>{rowMsg[r.id].text}</SuccessNote>
                    ) : (
                      <ErrorNote error={rowMsg[r.id].text} />
                    ))}
                </div>
              ))}
            </div>
          )}
          {nextCursor != null && (
            <button
              className={btnSecondaryCls}
              disabled={listLoading}
              onClick={() => load(nextCursor)}
            >
              {listLoading ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      </Card>

      <Card title="Execute agent pickup (bdc.pickup.executeAgentPickup + TOTP)">
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            Release cash to the authorized agent. The presented ID number is
            verified constant-time against the encrypted value (UNAUTHORIZED on
            mismatch); the teller who made the transaction cannot execute its
            pickup (dual control, FORBIDDEN); amount over the authorization cap
            and expiry are refused (PRECONDITION_FAILED).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Authorization ID">
              <input
                className={inputCls}
                inputMode="numeric"
                value={execAuthId}
                onChange={(e) => setExecAuthId(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <Field label="Transaction ID">
              <input
                className={inputCls}
                inputMode="numeric"
                value={execTxnId}
                onChange={(e) => setExecTxnId(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <Field label="Presented agent ID number">
              <input
                className={inputCls}
                value={execAgentIdNumber}
                onChange={(e) => setExecAgentIdNumber(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <TotpField value={execTotp} onChange={setExecTotp} label="Teller TOTP" />
            <button
              className={btnPrimaryCls}
              disabled={
                !execAuthId ||
                !execTxnId ||
                execAgentIdNumber.trim().length < 4 ||
                execTotp.length !== 6 ||
                execBusy
              }
              onClick={execute}
            >
              {execBusy ? "Verifying…" : "Release cash to agent"}
            </button>
          </div>
          {execErr && <ErrorNote error={execErr} />}
          {execResult && (
            <SuccessNote>
              Pickup executed — authorization #{execResult.authorizationId} marked
              'used' against transaction {execResult.transactionId} (agent{" "}
              {execResult.pickupAgent.name}, {execResult.pickupAgent.idType},{" "}
              {execResult.pickupAgent.relationship}) at {fmtDateTime(execResult.usedAt)}.
            </SuccessNote>
          )}
        </div>
      </Card>
    </div>
  );
};

export default BdcPickup;
