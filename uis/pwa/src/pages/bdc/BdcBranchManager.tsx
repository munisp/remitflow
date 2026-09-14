import React, { useCallback, useEffect, useState } from "react";
import {
  asList,
  bdc,
  errMsg,
  fmtDateTime,
  fmtMoney,
  type BdcBranch,
  type CitManifest,
  type DenominationItem,
  type StockRow,
} from "./api";
import {
  Badge,
  btnPrimaryCls,
  btnSecondaryCls,
  Card,
  ErrorNote,
  Field,
  inputCls,
  JsonView,
  PageHeader,
  Spinner,
  statusTone,
  SuccessNote,
} from "./ui";
import TotpField from "./TotpField";

const BdcBranchManager: React.FC = () => {
  // ── branch registry ──
  const [branches, setBranches] = useState<BdcBranch[]>([]);
  const [branchesErr, setBranchesErr] = useState<string | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [nbCode, setNbCode] = useState("");
  const [nbName, setNbName] = useState("");
  const [nbAddress, setNbAddress] = useState("");
  const [nbState, setNbState] = useState("");
  const [nbLat, setNbLat] = useState("");
  const [nbLng, setNbLng] = useState("");
  const [nbMsg, setNbMsg] = useState<string | null>(null);
  const [nbErr, setNbErr] = useState<string | null>(null);
  const [statusTotp, setStatusTotp] = useState<Record<number, string>>({});
  const [statusMsg, setStatusMsg] = useState<Record<number, string>>({});

  // ── vault stock ──
  const [locType, setLocType] = useState<"vault" | "drawer" | "cit">("vault");
  const [locId, setLocId] = useState("");
  const [stock, setStock] = useState<StockRow[]>([]);
  const [stockErr, setStockErr] = useState<string | null>(null);
  const [stockLoading, setStockLoading] = useState(false);

  // ── transfer / CIT ──
  const [trFromType, setTrFromType] = useState("vault");
  const [trFromId, setTrFromId] = useState("");
  const [trToType, setTrToType] = useState("vault");
  const [trToId, setTrToId] = useState("");
  const [trCcy, setTrCcy] = useState("USD");
  const [trDenom, setTrDenom] = useState("");
  const [trNotes, setTrNotes] = useState("");
  const [manifest, setManifest] = useState<CitManifest | null>(null);
  const [trErr, setTrErr] = useState<string | null>(null);
  const [confirmManifestId, setConfirmManifestId] = useState("");
  const [confirmTotp, setConfirmTotp] = useState("");
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);

  // ── counterfeit ──
  const [cfBranch, setCfBranch] = useState("");
  const [cfCcy, setCfCcy] = useState("USD");
  const [cfDenom, setCfDenom] = useState("");
  const [cfSerial, setCfSerial] = useState("");
  const [cfNotes, setCfNotes] = useState("");
  const [cfMsg, setCfMsg] = useState<string | null>(null);
  const [cfErr, setCfErr] = useState<string | null>(null);

  // ── EOD close ──
  const [eodTotp, setEodTotp] = useState("");
  const [eodResult, setEodResult] = useState<unknown>(null);
  const [eodErr, setEodErr] = useState<string | null>(null);

  const loadBranches = useCallback(async () => {
    setBranchesLoading(true);
    setBranchesErr(null);
    try {
      const res = await bdc.operator.listBranches.query(
        statusFilter ? { status: statusFilter } : {},
      );
      setBranches(asList(res));
    } catch (e) {
      setBranchesErr(errMsg(e));
      setBranches([]);
    } finally {
      setBranchesLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  const registerBranch = async () => {
    setNbMsg(null);
    setNbErr(null);
    try {
      await bdc.operator.registerBranch.mutate({
        code: nbCode,
        name: nbName,
        address: nbAddress,
        stateCode: nbState,
        lat: nbLat || undefined,
        lng: nbLng || undefined,
      });
      setNbMsg(`Branch ${nbCode} registered (status pending — activate with TOTP). Geofence 1km + tier rules enforced server-side.`);
      setNbCode("");
      setNbName("");
      setNbAddress("");
      await loadBranches();
    } catch (e) {
      setNbErr(errMsg(e));
    }
  };

  const changeStatus = async (branchId: number, status: string) => {
    const code = statusTotp[branchId] ?? "";
    setStatusMsg((m) => ({ ...m, [branchId]: "" }));
    try {
      await bdc.operator.updateBranchStatus.mutate({ branchId, status, totpCode: code });
      setStatusMsg((m) => ({ ...m, [branchId]: `Status → ${status}.` }));
      await loadBranches();
    } catch (e) {
      // e.g. "cannot close with non-zero inventory" surfaces here.
      setStatusMsg((m) => ({ ...m, [branchId]: errMsg(e) }));
    }
  };

  const loadStock = async () => {
    setStockLoading(true);
    setStockErr(null);
    try {
      const res = await bdc.vault.getStock.query({ locationType: locType, locationId: Number(locId) });
      setStock(asList(res as StockRow[] | { rows: StockRow[] }));
    } catch (e) {
      setStockErr(errMsg(e));
      setStock([]);
    } finally {
      setStockLoading(false);
    }
  };

  const startTransfer = async () => {
    setTrErr(null);
    setManifest(null);
    try {
      const items: DenominationItem[] = [
        { currency: trCcy, denominationMinor: trDenom, noteCount: Number(trNotes) },
      ];
      const m = await bdc.vault.transferStock.mutate({
        from: { locationType: trFromType, locationId: Number(trFromId) },
        to: { locationType: trToType, locationId: Number(trToId) },
        items,
      });
      setManifest(m);
      setConfirmManifestId(String(m.id));
    } catch (e) {
      setTrErr(errMsg(e));
    }
  };

  const confirmDelivery = async () => {
    setConfirmMsg(null);
    try {
      const m = await bdc.vault.confirmDelivery.mutate({
        manifestId: Number(confirmManifestId),
        totpCode: confirmTotp,
      });
      setConfirmMsg(`Manifest #${m.id} → ${m.status}.`);
      setManifest(m);
    } catch (e) {
      // Dual-custody: confirmer must differ from the maker — server rejects otherwise.
      setConfirmMsg(errMsg(e));
    }
  };

  const reportCounterfeit = async () => {
    setCfMsg(null);
    setCfErr(null);
    try {
      await bdc.vault.reportCounterfeit.mutate({
        branchId: Number(cfBranch),
        currency: cfCcy,
        denominationMinor: cfDenom,
        noteSerial: cfSerial,
        notes: cfNotes || undefined,
      });
      setCfMsg("Counterfeit registered and inventory decremented (quarantined).");
      setCfSerial("");
      setCfNotes("");
    } catch (e) {
      setCfErr(errMsg(e));
    }
  };

  const runEodClose = async () => {
    setEodResult(null);
    setEodErr(null);
    try {
      const res = await bdc.sourcing.eodClose.mutate({ totpCode: eodTotp });
      setEodResult(res);
    } catch (e) {
      // eodClose hard-fails with the breach list (snapshot still recorded).
      setEodErr(errMsg(e));
    }
  };

  const stockTotals = stock.reduce<Record<string, number>>((acc, row) => {
    const v = Number(row.denominationMinor) * row.noteCount;
    acc[row.currency] = (acc[row.currency] ?? 0) + (Number.isFinite(v) ? v : 0);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <PageHeader
        title="BDC Branch Manager"
        subtitle="Branch registry, vault stock, dual-custody transfers, counterfeit register and EOD close"
      />

      <Card title="Branch registry (bdc.operator.listBranches / registerBranch / updateBranchStatus)">
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-44">
              <Field label="Status filter">
                <select className={inputCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">all</option>
                  <option value="pending">pending</option>
                  <option value="active">active</option>
                  <option value="suspended">suspended</option>
                  <option value="closed">closed</option>
                </select>
              </Field>
            </div>
            <button className={btnSecondaryCls} onClick={loadBranches}>Refresh</button>
          </div>
          {branchesErr && <ErrorNote error={branchesErr} />}
          {branchesLoading ? (
            <Spinner label="Loading branches..." />
          ) : branches.length === 0 ? (
            <p className="text-sm text-slate-400">No branches found.</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {branches.map((b) => (
                <div key={b.id} className="py-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        #{b.id} · {b.code} — {b.name}
                        {b.isHeadOffice && <Badge tone="info">head office</Badge>}
                      </p>
                      <p className="text-xs text-slate-400">
                        {b.stateCode ?? "—"} · {b.address ?? "no address"}
                      </p>
                    </div>
                    <Badge tone={statusTone(b.status)}>{b.status}</Badge>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <TotpField
                      value={statusTotp[b.id] ?? ""}
                      onChange={(c) => setStatusTotp((m) => ({ ...m, [b.id]: c }))}
                      label="Admin TOTP"
                    />
                    {["active", "suspended", "closed"].map((s) => (
                      <button
                        key={s}
                        className={s === "closed" ? btnSecondaryCls : btnSecondaryCls}
                        disabled={(statusTotp[b.id] ?? "").length !== 6 || b.status === s}
                        onClick={() => changeStatus(b.id, s)}
                      >
                        {s === "active" ? "Activate" : s === "suspended" ? "Suspend" : "Close"}
                      </button>
                    ))}
                  </div>
                  {statusMsg[b.id] && <p className="text-xs text-slate-500">{statusMsg[b.id]}</p>}
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-medium text-slate-500 mb-2">Register a new branch (admin):</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Code">
                <input className={inputCls} value={nbCode} onChange={(e) => setNbCode(e.target.value)} placeholder="e.g. IKEJA-01" />
              </Field>
              <Field label="Name">
                <input className={inputCls} value={nbName} onChange={(e) => setNbName(e.target.value)} />
              </Field>
              <Field label="State code">
                <input className={inputCls} value={nbState} onChange={(e) => setNbState(e.target.value.toUpperCase())} placeholder="e.g. LA" />
              </Field>
              <Field label="Address">
                <input className={inputCls} value={nbAddress} onChange={(e) => setNbAddress(e.target.value)} />
              </Field>
              <Field label="Latitude">
                <input className={inputCls} inputMode="decimal" value={nbLat} onChange={(e) => setNbLat(e.target.value)} />
              </Field>
              <Field label="Longitude">
                <input className={inputCls} inputMode="decimal" value={nbLng} onChange={(e) => setNbLng(e.target.value)} />
              </Field>
            </div>
            <div className="mt-3">
              <button className={btnPrimaryCls} disabled={!nbCode || !nbName || !nbState} onClick={registerBranch}>
                Register branch
              </button>
            </div>
            {nbMsg && <div className="mt-2"><SuccessNote>{nbMsg}</SuccessNote></div>}
            {nbErr && <div className="mt-2"><ErrorNote error={nbErr} /></div>}
          </div>
        </div>
      </Card>

      <Card title="Vault stock grid (bdc.vault.getStock)">
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Field label="Location type">
                <select className={inputCls} value={locType} onChange={(e) => setLocType(e.target.value as "vault" | "drawer" | "cit")}>
                  <option value="vault">vault</option>
                  <option value="drawer">drawer</option>
                  <option value="cit">cit</option>
                </select>
              </Field>
            </div>
            <div className="w-40">
              <Field label="Location ID">
                <input className={inputCls} inputMode="numeric" value={locId} onChange={(e) => setLocId(e.target.value.replace(/\D/g, ""))} />
              </Field>
            </div>
            <button className={btnSecondaryCls} disabled={!locId || stockLoading} onClick={loadStock}>
              {stockLoading ? "Loading..." : "Load stock"}
            </button>
          </div>
          {stockErr && <ErrorNote error={stockErr} />}
          {stock.length > 0 && (
            <>
              <div className="flex flex-wrap gap-2">
                {Object.entries(stockTotals).map(([ccy, total]) => (
                  <Badge key={ccy} tone="info">
                    {ccy} total {fmtMoney(total)}
                  </Badge>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                      <th className="py-2 pr-4 font-medium">Currency</th>
                      <th className="py-2 pr-4 font-medium">Denomination</th>
                      <th className="py-2 pr-4 font-medium">Notes</th>
                      <th className="py-2 pr-4 font-medium">Value</th>
                      <th className="py-2 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {stock.map((row, i) => (
                      <tr key={row.id ?? i}>
                        <td className="py-2 pr-4 font-semibold text-slate-900">{row.currency}</td>
                        <td className="py-2 pr-4 tabular-nums">{fmtMoney(row.denominationMinor)}</td>
                        <td className="py-2 pr-4 tabular-nums">{row.noteCount}</td>
                        <td className="py-2 pr-4 tabular-nums">
                          {fmtMoney(Number(row.denominationMinor) * row.noteCount, row.currency)}
                        </td>
                        <td className="py-2 text-xs text-slate-400">{fmtDateTime(row.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Stock transfer + CIT manifest (bdc.vault.transferStock — maker)">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="From type">
                <select className={inputCls} value={trFromType} onChange={(e) => setTrFromType(e.target.value)}>
                  <option value="vault">vault</option>
                  <option value="drawer">drawer</option>
                  <option value="cit">cit</option>
                </select>
              </Field>
              <Field label="From location ID">
                <input className={inputCls} inputMode="numeric" value={trFromId} onChange={(e) => setTrFromId(e.target.value.replace(/\D/g, ""))} />
              </Field>
              <Field label="To type">
                <select className={inputCls} value={trToType} onChange={(e) => setTrToType(e.target.value)}>
                  <option value="vault">vault</option>
                  <option value="drawer">drawer</option>
                  <option value="cit">cit</option>
                </select>
              </Field>
              <Field label="To location ID">
                <input className={inputCls} inputMode="numeric" value={trToId} onChange={(e) => setTrToId(e.target.value.replace(/\D/g, ""))} />
              </Field>
              <Field label="Currency">
                <input className={inputCls} maxLength={3} value={trCcy} onChange={(e) => setTrCcy(e.target.value.toUpperCase())} />
              </Field>
              <Field label="Denomination">
                <input className={inputCls} inputMode="decimal" value={trDenom} onChange={(e) => setTrDenom(e.target.value)} placeholder="e.g. 100.00" />
              </Field>
              <Field label="Note count">
                <input className={inputCls} inputMode="numeric" value={trNotes} onChange={(e) => setTrNotes(e.target.value.replace(/\D/g, ""))} />
              </Field>
            </div>
            <button
              className={btnPrimaryCls}
              disabled={!trFromId || !trToId || !trDenom || !trNotes}
              onClick={startTransfer}
            >
              Dispatch (create manifest)
            </button>
            {trErr && <ErrorNote error={trErr} />}
            {manifest && (
              <SuccessNote>
                Manifest #{manifest.id} created — status {manifest.status}. Stock
                decremented at source (version-guarded); awaiting second-custodian
                delivery confirmation.
              </SuccessNote>
            )}
          </div>
        </Card>

        <Card title="Confirm delivery (bdc.vault.confirmDelivery — second custodian + TOTP)">
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              Dual custody: the confirmer must be a different user than the maker
              who dispatched the manifest — the server rejects same-user
              confirmation. Count mismatches flip the manifest to disputed and
              quarantine the delta.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-40">
                <Field label="Manifest ID">
                  <input className={inputCls} inputMode="numeric" value={confirmManifestId} onChange={(e) => setConfirmManifestId(e.target.value.replace(/\D/g, ""))} />
                </Field>
              </div>
              <TotpField value={confirmTotp} onChange={setConfirmTotp} label="Confirmer TOTP" />
              <button
                className={btnPrimaryCls}
                disabled={!confirmManifestId || confirmTotp.length !== 6}
                onClick={confirmDelivery}
              >
                Confirm delivery
              </button>
            </div>
            {confirmMsg && <p className="text-xs text-slate-500">{confirmMsg}</p>}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Counterfeit report (bdc.vault.reportCounterfeit)">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Branch ID">
                <input className={inputCls} inputMode="numeric" value={cfBranch} onChange={(e) => setCfBranch(e.target.value.replace(/\D/g, ""))} />
              </Field>
              <Field label="Currency">
                <input className={inputCls} maxLength={3} value={cfCcy} onChange={(e) => setCfCcy(e.target.value.toUpperCase())} />
              </Field>
              <Field label="Denomination">
                <input className={inputCls} inputMode="decimal" value={cfDenom} onChange={(e) => setCfDenom(e.target.value)} />
              </Field>
              <Field label="Note serial">
                <input className={inputCls} value={cfSerial} onChange={(e) => setCfSerial(e.target.value)} />
              </Field>
            </div>
            <Field label="Notes">
              <textarea className={inputCls} rows={2} value={cfNotes} onChange={(e) => setCfNotes(e.target.value)} />
            </Field>
            <button
              className={btnPrimaryCls}
              disabled={!cfBranch || !cfDenom || !cfSerial}
              onClick={reportCounterfeit}
            >
              Register counterfeit
            </button>
            {cfMsg && <SuccessNote>{cfMsg}</SuccessNote>}
            {cfErr && <ErrorNote error={cfErr} />}
          </div>
        </Card>

        <Card title="End-of-day close (bdc.sourcing.eodClose — manager + TOTP)">
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              Records a position snapshot, then hard-fails with the breach list if
              any caps are breached (record-then-report). Expired NFEM batches are
              swept to expired with alerts.
            </p>
            <div className="flex items-end gap-3">
              <TotpField value={eodTotp} onChange={setEodTotp} />
              <button className={btnPrimaryCls} disabled={eodTotp.length !== 6} onClick={runEodClose}>
                Run EOD close
              </button>
            </div>
            {eodErr && <ErrorNote error={`EOD close reported breaches / failure: ${eodErr}`} />}
            {eodResult != null && (
              <>
                <SuccessNote>EOD snapshot recorded.</SuccessNote>
                <JsonView data={eodResult} />
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default BdcBranchManager;
