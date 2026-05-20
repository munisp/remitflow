import { useRef } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Download, Printer, ArrowLeft, CheckCircle2, Clock, XCircle, RefreshCw } from "lucide-react";

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="h-5 w-5 text-green-500" />;
  if (status === "pending" || status === "processing") return <Clock className="h-5 w-5 text-yellow-500" />;
  return <XCircle className="h-5 w-5 text-red-500" />;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: "bg-green-100 text-green-800",
    pending: "bg-yellow-100 text-yellow-800",
    processing: "bg-blue-100 text-blue-800",
    failed: "bg-red-100 text-red-800",
    cancelled: "bg-gray-100 text-gray-800",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[status] ?? "bg-gray-100 text-gray-800"}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function TransactionReceipt() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const receiptRef = useRef<HTMLDivElement>(null);
  const txId = Number(params.id);

  const { data: txn, isLoading } = trpc.transactions.getById.useQuery(
    { id: txId },
    { enabled: !!txId && !isNaN(txId) }
  );

  const { data: profile } = trpc.auth.me.useQuery();

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadHTML = () => {
    if (!txn) return;
    const html = generateReceiptHTML(txn, profile);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `remitflow-receipt-${txn.id}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Receipt downloaded!");
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!txn) {
    return (
      <DashboardLayout>
        <div className="p-6 text-center">
          <p className="text-muted-foreground">Transaction not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/transactions")}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Transactions
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const rows = [
    { label: "Transaction ID", value: `#${txn.id}` },
    { label: "Reference", value: (txn as any).reference ?? `RF-${txn.id}` },
    { label: "Type", value: ((txn as any).type ?? "").toUpperCase() },
    { label: "Status", value: <StatusBadge status={(txn as any).status ?? "completed"} /> },
    { label: "Date & Time", value: new Date((txn as any).createdAt).toLocaleString() },
    { label: "From", value: `${Number((txn as any).fromAmount).toLocaleString()} ${(txn as any).fromCurrency}` },
    ...(((txn as any).toAmount && (txn as any).toCurrency) ? [{ label: "To", value: `${Number((txn as any).toAmount).toLocaleString()} ${(txn as any).toCurrency}` }] : []),
    ...(((txn as any).fxRate) ? [{ label: "Exchange Rate", value: `1 ${(txn as any).fromCurrency} = ${Number((txn as any).fxRate).toFixed(4)} ${(txn as any).toCurrency}` }] : []),
    { label: "Fee", value: `${Number((txn as any).fee ?? 0).toLocaleString()} ${(txn as any).fromCurrency}` },
    ...(((txn as any).recipientName) ? [{ label: "Recipient", value: (txn as any).recipientName }] : []),
    ...(((txn as any).recipientBank) ? [{ label: "Recipient Bank", value: (txn as any).recipientBank }] : []),
    ...(((txn as any).recipientAccount) ? [{ label: "Account Number", value: (txn as any).recipientAccount }] : []),
    ...(((txn as any).description) ? [{ label: "Description", value: (txn as any).description }] : []),
    { label: "Account Holder", value: profile?.name ?? "—" },
  ];

  return (
    <DashboardLayout>
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        {/* Actions */}
        <div className="flex items-center justify-between print:hidden">
          <Button variant="ghost" onClick={() => navigate("/transactions")}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-2" /> Print
            </Button>
            <Button onClick={handleDownloadHTML}>
              <Download className="h-4 w-4 mr-2" /> Download
            </Button>
          </div>
        </div>

        {/* Receipt Card */}
        <div ref={receiptRef} className="bg-card border rounded-xl overflow-hidden shadow-sm">
          {/* Header */}
          <div className="bg-primary p-6 text-primary-foreground">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-bold">⚡ RemitFlow</p>
                <p className="text-sm opacity-80">Cross-Border Remittance Platform</p>
              </div>
              <div className="text-right">
                <p className="text-sm opacity-80">Payment Receipt</p>
                <p className="font-mono text-sm">#{txn.id}</p>
              </div>
            </div>
          </div>

          {/* Status Banner */}
          <div className="px-6 py-4 bg-muted/30 flex items-center gap-3">
            <StatusIcon status={(txn as any).status ?? "completed"} />
            <div>
              <p className="font-semibold">
                {(txn as any).status === "completed" ? "Payment Successful" :
                  (txn as any).status === "pending" ? "Payment Pending" :
                  (txn as any).status === "processing" ? "Payment Processing" : "Payment Failed"}
              </p>
              <p className="text-sm text-muted-foreground">
                {new Date((txn as any).createdAt).toLocaleString()}
              </p>
            </div>
          </div>

          {/* Amount */}
          <div className="px-6 py-5 text-center border-b">
            <p className="text-4xl font-bold">
              {Number((txn as any).fromAmount).toLocaleString()}
              <span className="text-xl text-muted-foreground ml-2">{(txn as any).fromCurrency}</span>
            </p>
            {(txn as any).toAmount && (txn as any).toCurrency && (
              <p className="text-sm text-muted-foreground mt-1">
                → {Number((txn as any).toAmount).toLocaleString()} {(txn as any).toCurrency}
              </p>
            )}
          </div>

          {/* Details */}
          <div className="px-6 py-4 space-y-0">
            {rows.map((row, i) => (
              <div key={i} className="flex justify-between items-center py-2.5 border-b last:border-0">
                <span className="text-sm text-muted-foreground">{row.label}</span>
                <span className="text-sm font-medium text-right max-w-[60%]">
                  {typeof row.value === "string" ? row.value : row.value}
                </span>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-muted/30 text-center space-y-1">
            <p className="text-xs text-muted-foreground">
              Thank you for using RemitFlow. This is an official receipt.
            </p>
            <p className="text-xs text-muted-foreground">
              RemitFlow Ltd · FCA Registered · support@remitflow.io
            </p>
            <p className="text-xs font-mono text-muted-foreground">
              Ref: RF-{txn.id}-{Date.now().toString(36).toUpperCase()}
            </p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function generateReceiptHTML(txn: any, profile: any): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>RemitFlow Receipt #${txn.id}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 40px auto; color: #111; background: #f9fafb; }
  .card { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .header { background: #7c3aed; color: white; padding: 24px; }
  .header h1 { margin: 0; font-size: 20px; }
  .header p { margin: 4px 0 0; opacity: 0.8; font-size: 13px; }
  .amount { text-align: center; padding: 24px; border-bottom: 1px solid #f3f4f6; }
  .amount .big { font-size: 36px; font-weight: 700; }
  .amount .currency { font-size: 18px; color: #6b7280; margin-left: 6px; }
  .rows { padding: 0 24px; }
  .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-size: 14px; }
  .row:last-child { border-bottom: none; }
  .label { color: #6b7280; }
  .value { font-weight: 500; text-align: right; max-width: 60%; }
  .footer { background: #f9fafb; padding: 16px 24px; text-align: center; font-size: 12px; color: #9ca3af; }
  .badge { display: inline-block; background: #d1fae5; color: #065f46; padding: 2px 10px; border-radius: 20px; font-size: 12px; }
  @media print { body { background: white; } .card { box-shadow: none; } }
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <h1>⚡ RemitFlow</h1>
    <p>Cross-Border Remittance Platform</p>
    <p style="margin-top:8px;font-size:12px;opacity:0.7">Receipt #${txn.id} · ${new Date(txn.createdAt).toLocaleString()}</p>
  </div>
  <div class="amount">
    <span class="big">${Number(txn.fromAmount).toLocaleString()}</span>
    <span class="currency">${txn.fromCurrency}</span>
    ${txn.toAmount ? `<div style="font-size:14px;color:#6b7280;margin-top:4px">→ ${Number(txn.toAmount).toLocaleString()} ${txn.toCurrency}</div>` : ""}
  </div>
  <div class="rows">
    <div class="row"><span class="label">Status</span><span class="value"><span class="badge">${txn.status ?? "completed"}</span></span></div>
    <div class="row"><span class="label">Type</span><span class="value">${(txn.type ?? "").toUpperCase()}</span></div>
    <div class="row"><span class="label">Reference</span><span class="value">${txn.reference ?? `RF-${txn.id}`}</span></div>
    ${txn.fxRate ? `<div class="row"><span class="label">Exchange Rate</span><span class="value">1 ${txn.fromCurrency} = ${Number(txn.fxRate).toFixed(4)} ${txn.toCurrency}</span></div>` : ""}
    <div class="row"><span class="label">Fee</span><span class="value">${Number(txn.fee ?? 0).toLocaleString()} ${txn.fromCurrency}</span></div>
    ${txn.recipientName ? `<div class="row"><span class="label">Recipient</span><span class="value">${txn.recipientName}</span></div>` : ""}
    ${txn.recipientBank ? `<div class="row"><span class="label">Bank</span><span class="value">${txn.recipientBank}</span></div>` : ""}
    ${txn.recipientAccount ? `<div class="row"><span class="label">Account</span><span class="value">${txn.recipientAccount}</span></div>` : ""}
    ${txn.description ? `<div class="row"><span class="label">Description</span><span class="value">${txn.description}</span></div>` : ""}
    <div class="row"><span class="label">Account Holder</span><span class="value">${profile?.name ?? "—"}</span></div>
  </div>
  <div class="footer">
    <p>Thank you for using RemitFlow. This is an official receipt.</p>
    <p>RemitFlow Ltd · FCA Registered · support@remitflow.io</p>
    <p style="font-family:monospace">Ref: RF-${txn.id}-${Date.now().toString(36).toUpperCase()}</p>
  </div>
</div>
</body>
</html>`;
}
