/**
 * Receipt Generator — P2 Business 9.5
 * Generates PDF-style transfer receipts with full details.
 */

interface TransferReceipt {
  transactionId: string;
  referenceNumber: string;
  senderName: string;
  senderEmail: string;
  recipientName: string;
  recipientBank?: string;
  recipientAccount?: string;
  sendAmount: number;
  sendCurrency: string;
  receiveAmount: number;
  receiveCurrency: string;
  exchangeRate: number;
  fee: number;
  totalCharged: number;
  status: string;
  createdAt: string;
  completedAt?: string;
  deliveryMethod: string;
  corridor: string;
}

interface ReceiptContent {
  html: string;
  text: string;
  metadata: {
    receiptNumber: string;
    generatedAt: string;
    transactionId: string;
  };
}

export function generateReceipt(transfer: TransferReceipt): ReceiptContent {
  const receiptNumber = `RF-${Date.now().toString(36).toUpperCase()}-${transfer.transactionId.slice(-6)}`;
  const generatedAt = new Date().toISOString();

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>RemitFlow Receipt ${receiptNumber}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a2e}
.header{text-align:center;border-bottom:2px solid #1a1a2e;padding-bottom:16px;margin-bottom:24px}
.header h1{margin:0;font-size:24px;color:#1a1a2e}
.header p{margin:4px 0;color:#666;font-size:14px}
.receipt-id{font-family:monospace;font-size:12px;color:#888}
.section{margin-bottom:20px}
.section h3{font-size:14px;color:#666;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;border-bottom:1px solid #eee;padding-bottom:4px}
.row{display:flex;justify-content:space-between;padding:6px 0;font-size:14px}
.row .label{color:#666}
.row .value{font-weight:500}
.amount-box{background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px;text-align:center;margin:16px 0}
.amount-box .amount{font-size:28px;font-weight:700;color:#0369a1}
.amount-box .label{font-size:12px;color:#666}
.status{display:inline-block;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:600}
.status-completed{background:#dcfce7;color:#166534}
.status-pending{background:#fef3c7;color:#92400e}
.status-failed{background:#fce4ec;color:#c62828}
.footer{text-align:center;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:16px;margin-top:24px}
</style></head>
<body>
<div class="header">
<h1>RemitFlow</h1>
<p>Transfer Receipt</p>
<p class="receipt-id">${receiptNumber}</p>
</div>
<div class="section">
<h3>Transfer Details</h3>
<div class="row"><span class="label">Reference</span><span class="value">${transfer.referenceNumber}</span></div>
<div class="row"><span class="label">Date</span><span class="value">${new Date(transfer.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span></div>
<div class="row"><span class="label">Status</span><span class="value"><span class="status status-${transfer.status}">${transfer.status.toUpperCase()}</span></span></div>
<div class="row"><span class="label">Corridor</span><span class="value">${transfer.corridor}</span></div>
<div class="row"><span class="label">Delivery</span><span class="value">${transfer.deliveryMethod}</span></div>
</div>
<div class="section">
<h3>Sender</h3>
<div class="row"><span class="label">Name</span><span class="value">${transfer.senderName}</span></div>
<div class="row"><span class="label">Email</span><span class="value">${transfer.senderEmail}</span></div>
</div>
<div class="section">
<h3>Recipient</h3>
<div class="row"><span class="label">Name</span><span class="value">${transfer.recipientName}</span></div>
${transfer.recipientBank ? `<div class="row"><span class="label">Bank</span><span class="value">${transfer.recipientBank}</span></div>` : ""}
${transfer.recipientAccount ? `<div class="row"><span class="label">Account</span><span class="value">****${transfer.recipientAccount.slice(-4)}</span></div>` : ""}
</div>
<div class="amount-box">
<div class="label">Amount Received</div>
<div class="amount">${transfer.receiveCurrency} ${transfer.receiveAmount.toLocaleString("en", { minimumFractionDigits: 2 })}</div>
</div>
<div class="section">
<h3>Breakdown</h3>
<div class="row"><span class="label">You sent</span><span class="value">${transfer.sendCurrency} ${transfer.sendAmount.toLocaleString("en", { minimumFractionDigits: 2 })}</span></div>
<div class="row"><span class="label">Exchange rate</span><span class="value">1 ${transfer.sendCurrency} = ${transfer.exchangeRate} ${transfer.receiveCurrency}</span></div>
<div class="row"><span class="label">Transfer fee</span><span class="value">${transfer.sendCurrency} ${transfer.fee.toFixed(2)}</span></div>
<div class="row" style="font-weight:700;border-top:1px solid #ddd;padding-top:8px"><span class="label">Total charged</span><span class="value">${transfer.sendCurrency} ${transfer.totalCharged.toFixed(2)}</span></div>
</div>
<div class="footer">
<p>RemitFlow Ltd. | FCA Regulated | This is an auto-generated receipt.</p>
<p>Transaction ID: ${transfer.transactionId}</p>
<p>Generated: ${new Date(generatedAt).toLocaleString("en-GB")}</p>
</div>
</body></html>`;

  const text = [
    "REMITFLOW TRANSFER RECEIPT",
    `Receipt: ${receiptNumber}`,
    `Date: ${new Date(transfer.createdAt).toLocaleDateString("en-GB")}`,
    `Reference: ${transfer.referenceNumber}`,
    `Status: ${transfer.status.toUpperCase()}`,
    "",
    `Sender: ${transfer.senderName}`,
    `Recipient: ${transfer.recipientName}`,
    "",
    `Sent: ${transfer.sendCurrency} ${transfer.sendAmount.toFixed(2)}`,
    `Received: ${transfer.receiveCurrency} ${transfer.receiveAmount.toFixed(2)}`,
    `Rate: 1 ${transfer.sendCurrency} = ${transfer.exchangeRate} ${transfer.receiveCurrency}`,
    `Fee: ${transfer.sendCurrency} ${transfer.fee.toFixed(2)}`,
    `Total: ${transfer.sendCurrency} ${transfer.totalCharged.toFixed(2)}`,
  ].join("\n");

  return {
    html,
    text,
    metadata: { receiptNumber, generatedAt, transactionId: transfer.transactionId },
  };
}

export function generateBatchReceipt(transfers: TransferReceipt[]): {
  summary: string;
  receipts: ReceiptContent[];
} {
  const receipts = transfers.map(generateReceipt);
  const totalSent = transfers.reduce((s, t) => s + t.totalCharged, 0);
  const summary = `Batch receipt: ${transfers.length} transfers, total ${transfers[0]?.sendCurrency ?? "USD"} ${totalSent.toFixed(2)}`;
  return { summary, receipts };
}
