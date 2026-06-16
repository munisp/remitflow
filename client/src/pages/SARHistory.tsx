/**
 * SARHistory.tsx
 * SAR (Suspicious Activity Report) History Page
 * Lists all submitted SARs with metadata and PDF export capability.
 */
import { useTranslation } from 'react-i18next';
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { DeadlineBadge } from "./OfficerWorkload";
import {
  FileText, Download, Search, Calendar, User,
  ShieldAlert, RefreshCw, ChevronLeft, ChevronRight
} from "lucide-react";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  low: "bg-blue-100 text-blue-800 border-blue-200",
};

const PAGE_SIZE = 20;

export default function SARHistory() {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");

  const { data, isLoading, refetch } = trpc.complianceAlerts.sarHistory.useQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Client-side search filter
  const filtered = search.trim()
    ? items.filter(i =>
        i.title.toLowerCase().includes(search.toLowerCase()) ||
        (i.sarReference ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (i.mlroName ?? "").toLowerCase().includes(search.toLowerCase()) ||
        i.alertType.toLowerCase().includes(search.toLowerCase())
      )
    : items;

  const handleExportPDF = (item: typeof items[0]) => {
    // Build a simple printable HTML blob and open in new tab
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(item.metadata ?? "{}"); } catch {}

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>SAR ${item.sarReference ?? item.id}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; color: #111; }
    h1 { font-size: 20px; border-bottom: 2px solid #333; padding-bottom: 8px; }
    .label { font-weight: bold; color: #555; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
    .value { font-size: 14px; margin-bottom: 12px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; background: #fee2e2; color: #991b1b; }
    .notice { background: #fef3c7; border: 1px solid #f59e0b; padding: 12px; border-radius: 6px; font-size: 12px; margin-top: 24px; }
    @media print { body { margin: 20px; } }
  </style>
</head>
<body>
  <h1>Suspicious Activity Report</h1>
  <div class="label">SAR Reference</div>
  <div class="value">${item.sarReference ?? "N/A"}</div>
  <div class="label">Alert ID</div>
  <div class="value">#${item.id}</div>
  <div class="label">Alert Title</div>
  <div class="value">${item.title}</div>
  <div class="label">Alert Type</div>
  <div class="value">${item.alertType}</div>
  <div class="label">Severity</div>
  <div class="value"><span class="badge">${item.severity.toUpperCase()}</span></div>
  <div class="label">Submitted At</div>
  <div class="value">${item.sarSubmittedAt ? new Date(item.sarSubmittedAt).toLocaleString() : "N/A"}</div>
  <div class="label">Submitted By (MLRO)</div>
  <div class="value">${item.mlroName ?? item.mlroEmail ?? "Unknown"}</div>
  ${meta.amount ? `<div class="label">Amount Involved</div><div class="value">${Number(meta.amount).toLocaleString()} ${meta.currency ?? "USD"}</div>` : ""}
  <div class="notice">
    <strong>Confidentiality Notice:</strong> This document contains information subject to legal privilege and regulatory confidentiality obligations.
    Disclosure to any person other than the intended recipient is strictly prohibited. Tipping off the subject of this SAR is a criminal offence.
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (win) {
      win.onload = () => { win.print(); URL.revokeObjectURL(url); };
    } else {
      toast.error("Popup blocked — please allow popups for PDF export");
    }
  };

  const handleExportCSV = () => {
    if (!items.length) { toast.error("No data to export"); return; }
    const header = ["ID", "SAR Reference", "Title", "Alert Type", "Severity", "Submitted At", "MLRO Name", "MLRO Email"];
    const rows = items.map(i => [
      i.id,
      i.sarReference ?? "",
      `"${i.title.replace(/"/g, '""')}"`,
      i.alertType,
      i.severity,
      i.sarSubmittedAt ? new Date(i.sarSubmittedAt).toISOString() : "",
      i.mlroName ?? "",
      i.mlroEmail ?? "",
    ]);
    const csv = [header, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `sar-history-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <FileText className="h-6 w-6 text-blue-500" />
              SAR History
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              All submitted Suspicious Activity Reports — {total} total
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExportCSV}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <FileText className="h-8 w-8 text-blue-500" />
                <div>
                  <p className="text-2xl font-bold">{total}</p>
                  <p className="text-xs text-muted-foreground">Total SARs Filed</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <ShieldAlert className="h-8 w-8 text-red-500" />
                <div>
                  <p className="text-2xl font-bold">
                    {items.filter(i => i.severity === "critical" || i.severity === "high").length}
                  </p>
                  <p className="text-xs text-muted-foreground">Critical / High (this page)</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <User className="h-8 w-8 text-purple-500" />
                <div>
                  <p className="text-2xl font-bold">
                    {new Set(items.map(i => i.mlroName ?? i.mlroEmail).filter(Boolean)).size}
                  </p>
                  <p className="text-xs text-muted-foreground">Unique MLROs (this page)</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search + Table */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <CardTitle className="text-base">SAR Records</CardTitle>
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by title, reference, MLRO…"
                  className="pl-8 h-8 text-sm"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Loading SAR history…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                {search ? "No SARs match your search." : "No SARs have been submitted yet."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">SAR Reference</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Alert</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Type</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Severity</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Submitted</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">Deadline</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground text-xs">MLRO</th>
                      <th className="text-right px-4 py-2 font-medium text-muted-foreground text-xs">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filtered.map(item => (
                      <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                            {item.sarReference ?? `SAR-${item.id}`}
                          </span>
                        </td>
                        <td className="px-4 py-3 max-w-[240px]">
                          <p className="font-medium text-foreground truncate text-xs">{item.title}</p>
                          <p className="text-xs text-muted-foreground">#{item.id}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-muted-foreground capitalize">
                            {item.alertType.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`text-xs ${SEVERITY_COLORS[item.severity] ?? ""}`}>
                            {item.severity.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {item.sarSubmittedAt
                              ? new Date(item.sarSubmittedAt).toLocaleDateString()
                              : "—"}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <DeadlineBadge deadline={(item as any).sarDeadline} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <User className="h-3 w-3" />
                            {item.mlroName ?? item.mlroEmail ?? "Unknown"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs px-2"
                            onClick={() => handleExportPDF(item)}
                          >
                            <Download className="h-3 w-3 mr-1" />
                            PDF
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <p className="text-xs text-muted-foreground">
                  Page {page + 1} of {totalPages} — {total} total SARs
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline" size="sm"
                    className="h-7 w-7 p-0"
                    disabled={page === 0}
                    onClick={() => setPage(p => p - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    className="h-7 w-7 p-0"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage(p => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
