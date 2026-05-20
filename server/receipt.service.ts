/**
 * Transfer Receipt PDF Generator
 * Uses pdfmake to produce branded, print-ready PDF receipts for completed transfers.
 */

// pdfmake works in Node.js via the server-side API
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require("pdfmake/build/pdfmake");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const vfsFonts = require("pdfmake/build/vfs_fonts");

const printer = new PdfPrinter.default({
  Roboto: {
    normal: Buffer.from(vfsFonts.pdfMake.vfs["Roboto-Regular.ttf"], "base64"),
    bold: Buffer.from(vfsFonts.pdfMake.vfs["Roboto-Medium.ttf"], "base64"),
    italics: Buffer.from(vfsFonts.pdfMake.vfs["Roboto-Italic.ttf"], "base64"),
    bolditalics: Buffer.from(vfsFonts.pdfMake.vfs["Roboto-MediumItalic.ttf"], "base64"),
  },
});

export interface ReceiptData {
  reference: string;
  type: string;
  status: string;
  fromCurrency: string;
  fromAmount: number;
  toCurrency?: string;
  toAmount?: number;
  fee: number;
  fxRate?: number;
  description?: string;
  recipientName?: string;
  recipientAccount?: string;
  recipientBank?: string;
  recipientCountry?: string;
  createdAt: Date | string;
  userName: string;
  userEmail: string;
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
}

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
}

function statusColor(status: string): string {
  switch (status) {
    case "completed": return "#16a34a";
    case "pending": return "#d97706";
    case "failed": return "#dc2626";
    default: return "#6b7280";
  }
}

export async function generateReceiptPdf(data: ReceiptData): Promise<Buffer> {
  const statusCol = statusColor(data.status);
  const typeLabel = data.type.charAt(0).toUpperCase() + data.type.slice(1);

  const tableBody: any[][] = [
    [{ text: "Reference", style: "tableHeader" }, { text: data.reference, style: "tableValue" }],
    [{ text: "Type", style: "tableHeader" }, { text: typeLabel, style: "tableValue" }],
    [{ text: "Status", style: "tableHeader" }, { text: data.status.toUpperCase(), style: "tableValue", color: statusCol, bold: true }],
    [{ text: "Date & Time", style: "tableHeader" }, { text: formatDate(data.createdAt), style: "tableValue" }],
    [{ text: "Amount Sent", style: "tableHeader" }, { text: formatCurrency(data.fromAmount, data.fromCurrency), style: "tableValue" }],
  ];

  if (data.toCurrency && data.toAmount) {
    tableBody.push([{ text: "Amount Received", style: "tableHeader" }, { text: formatCurrency(data.toAmount, data.toCurrency), style: "tableValue" }]);
  }
  if (data.fxRate && data.toCurrency) {
    tableBody.push([{ text: "Exchange Rate", style: "tableHeader" }, { text: `1 ${data.fromCurrency} = ${data.fxRate.toFixed(4)} ${data.toCurrency}`, style: "tableValue" }]);
  }
  tableBody.push([{ text: "Fee", style: "tableHeader" }, { text: formatCurrency(data.fee, data.fromCurrency), style: "tableValue" }]);

  if (data.recipientName) {
    tableBody.push([{ text: "Recipient", style: "tableHeader" }, { text: data.recipientName, style: "tableValue" }]);
  }
  if (data.recipientAccount) {
    tableBody.push([{ text: "Account / Phone", style: "tableHeader" }, { text: data.recipientAccount, style: "tableValue" }]);
  }
  if (data.recipientBank) {
    tableBody.push([{ text: "Bank / Network", style: "tableHeader" }, { text: data.recipientBank, style: "tableValue" }]);
  }
  if (data.recipientCountry) {
    tableBody.push([{ text: "Destination Country", style: "tableHeader" }, { text: data.recipientCountry, style: "tableValue" }]);
  }
  if (data.description) {
    tableBody.push([{ text: "Description", style: "tableHeader" }, { text: data.description, style: "tableValue" }]);
  }

  const docDefinition: any = {
    pageSize: "A4",
    pageMargins: [40, 60, 40, 60],
    content: [
      // Header band
      {
        canvas: [{ type: "rect", x: 0, y: 0, w: 515, h: 80, r: 8, color: "#1e40af" }],
        margin: [0, 0, 0, 0],
      },
      {
        columns: [
          {
            stack: [
              { text: "RemitFlow", fontSize: 24, bold: true, color: "#ffffff", margin: [0, -70, 0, 0] },
              { text: "Cross-Border Remittance Platform", fontSize: 9, color: "#bfdbfe", margin: [0, 2, 0, 0] },
            ],
          },
          {
            stack: [
              { text: "TRANSFER RECEIPT", fontSize: 14, bold: true, color: "#ffffff", alignment: "right", margin: [0, -70, 0, 0] },
              { text: data.reference, fontSize: 9, color: "#bfdbfe", alignment: "right", margin: [0, 2, 0, 0] },
            ],
          },
        ],
        margin: [8, 0, 8, 20],
      },

      // Status badge
      {
        table: {
          widths: ["*"],
          body: [[{
            text: `● ${data.status.toUpperCase()}`,
            fillColor: data.status === "completed" ? "#dcfce7" : data.status === "pending" ? "#fef9c3" : "#fee2e2",
            color: statusCol,
            bold: true,
            fontSize: 11,
            alignment: "center",
            margin: [0, 6, 0, 6],
          }]],
        },
        layout: "noBorders",
        margin: [0, 0, 0, 16],
      },

      // Transaction details table
      {
        text: "Transaction Details",
        style: "sectionHeader",
        margin: [0, 0, 0, 8],
      },
      {
        table: {
          widths: [160, "*"],
          body: tableBody,
        },
        layout: {
          hLineWidth: (i: number) => (i === 0 || i === tableBody.length) ? 1 : 0.5,
          vLineWidth: () => 0,
          hLineColor: () => "#e5e7eb",
          paddingLeft: () => 8,
          paddingRight: () => 8,
          paddingTop: () => 8,
          paddingBottom: () => 8,
        },
        margin: [0, 0, 0, 20],
      },

      // Sender info
      {
        text: "Sender Information",
        style: "sectionHeader",
        margin: [0, 0, 0, 8],
      },
      {
        table: {
          widths: [160, "*"],
          body: [
            [{ text: "Name", style: "tableHeader" }, { text: data.userName, style: "tableValue" }],
            [{ text: "Email", style: "tableHeader" }, { text: data.userEmail, style: "tableValue" }],
          ],
        },
        layout: {
          hLineWidth: (i: number) => (i === 0 || i === 2) ? 1 : 0.5,
          vLineWidth: () => 0,
          hLineColor: () => "#e5e7eb",
          paddingLeft: () => 8,
          paddingRight: () => 8,
          paddingTop: () => 8,
          paddingBottom: () => 8,
        },
        margin: [0, 0, 0, 24],
      },

      // Disclaimer
      {
        canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: "#e5e7eb" }],
        margin: [0, 0, 0, 12],
      },
      {
        text: "This receipt is auto-generated by RemitFlow and serves as proof of transaction. For disputes or queries, contact support@remitflow.com or visit remitflow.com/support. RemitFlow is regulated by the FCA (UK) and CBN (Nigeria).",
        fontSize: 8,
        color: "#9ca3af",
        alignment: "center",
        margin: [0, 0, 0, 8],
      },
      {
        text: `Generated on ${formatDate(new Date())}`,
        fontSize: 8,
        color: "#9ca3af",
        alignment: "center",
      },
    ],
    styles: {
      sectionHeader: { fontSize: 11, bold: true, color: "#1e40af", margin: [0, 0, 0, 4] },
      tableHeader: { fontSize: 9, color: "#6b7280", bold: true },
      tableValue: { fontSize: 10, color: "#111827" },
    },
    defaultStyle: { font: "Roboto", fontSize: 10, color: "#374151" },
  };

  return new Promise((resolve, reject) => {
    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    const chunks: Buffer[] = [];
    pdfDoc.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
    pdfDoc.on("error", reject);
    pdfDoc.end();
  });
}
