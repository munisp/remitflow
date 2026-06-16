import React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Code2, Zap, Shield, Bug, Plus, AlertTriangle, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useTranslation } from 'react-i18next';

// Static extended changelog (local — covers all versions not yet in DB)
const STATIC_CHANGELOG = [
  {
    version: "v2.4.0",
    date: "2026-04-19",
    type: "feature",
    changes: [
      "Added CBDC transfer endpoints: POST /api/cbdc/transfer, GET /api/cbdc/wallets",
      "Added tenant feature flag enforcement middleware",
      "Added white-label CSS injection: GET /api/tenant/theme.css",
      "Added direct debit mandate CRUD: /api/direct-debit/*",
      "Added transaction CSV/JSON export with date range filter",
    ],
  },
  {
    version: "v2.3.0",
    date: "2026-04-15",
    type: "feature",
    changes: [
      "Added SSE real-time notifications: GET /api/sse/notifications",
      "Added Admin Feature Flags management: /api/trpc/featureFlags.*",
      "Added Tenant management: /api/trpc/tenants.*",
      "Added White-label config: /api/trpc/whiteLabelConfig.*",
      "Added mTLS certificate generation for gRPC services",
    ],
  },
  {
    version: "v2.2.0",
    date: "2026-04-10",
    type: "security",
    changes: [
      "CSRF double-submit cookie now set on every login",
      "Added GET /api/csrf-token bootstrap endpoint",
      "Added per-procedure rate limiting for transfer.send (10/min), kyc.uploadDocument (5/min)",
      "Added X-Content-Type-Options: nosniff on all file download responses",
      "Upgraded helmet CSP to include nonce support",
    ],
  },
  {
    version: "v2.1.0",
    date: "2026-04-05",
    type: "feature",
    changes: [
      "Added Mojaloop FSPIOP webhook callbacks",
      "Added Prometheus metrics endpoint: GET /metrics",
      "Added Grafana dashboard provisioning",
      "Added Go transaction-export-service (port 8082)",
      "Added Rust pdf-receipt-service (port 8083)",
      "Added Python compliance-ml service (port 8084)",
    ],
  },
  {
    version: "v2.0.0",
    date: "2026-03-28",
    type: "breaking",
    changes: [
      "BREAKING: tRPC router restructured — all procedures now under feature namespaces",
      "BREAKING: JWT session cookie renamed from session to remitflow_session",
      "Added multi-currency wallet system",
      "Added KYC tier progression (Tier 0→1→2→3)",
      "Added FX rate alerts with email/SMS notifications",
    ],
  },
  {
    version: "v1.5.0",
    date: "2026-03-15",
    type: "feature",
    changes: [
      "Added community savings pools",
      "Added investment portfolio tracking",
      "Added recurring payment scheduler",
      "Added batch payment CSV upload",
      "Added AML/KYC document upload with S3 storage",
    ],
  },
];

const TYPE_CONFIG: Record<string, { color: string; icon: React.ReactElement; label: string }> = {
  feature: { color: "bg-blue-100 text-blue-800", icon: <Plus className="w-3 h-3" />, label: "Feature" },
  security: { color: "bg-red-100 text-red-800", icon: <Shield className="w-3 h-3" />, label: "Security" },
  breaking: { color: "bg-orange-100 text-orange-800", icon: <AlertTriangle className="w-3 h-3" />, label: "Breaking" },
  bugfix: { color: "bg-green-100 text-green-800", icon: <Bug className="w-3 h-3" />, label: "Bug Fix" },
  fix: { color: "bg-green-100 text-green-800", icon: <Bug className="w-3 h-3" />, label: "Bug Fix" },
  performance: { color: "bg-purple-100 text-purple-800", icon: <Zap className="w-3 h-3" />, label: "Performance" },
};

export default function APIChangelog() {
  const { t } = useTranslation();
  const { data: dbEntries = [], isLoading, isError } = trpc.apiChangelog.list.useQuery();

  // Merge DB entries (from apiChangelog router) with static entries, deduplicate by version
  const dbVersions = new Set((dbEntries as any[]).map((e: any) => e.version));
  const merged = [
    ...(dbEntries as any[]).map((e: any) => ({
      version: e.version,
      date: e.date,
      type: e.type,
      changes: e.description ? [e.description] : [],
    })),
    ...STATIC_CHANGELOG.filter((e) => !dbVersions.has(e.version)),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Code2 className="w-7 h-7 text-gray-600" /> API Changelog
          </h1>
          <p className="text-muted-foreground">Version history and breaking changes for the RemitFlow API</p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />
            <div className="space-y-6 pl-12">
              {merged.map((entry) => {
                const cfg = TYPE_CONFIG[entry.type] ?? TYPE_CONFIG.feature;
                return (
                  <div key={entry.version} className="relative">
                    <div className="absolute -left-8 top-1 w-4 h-4 rounded-full bg-background border-2 border-primary" />
                    <Card>
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-3 flex-wrap">
                          <CardTitle className="text-lg font-mono">{entry.version}</CardTitle>
                          <Badge className={`text-xs flex items-center gap-1 ${cfg.color}`}>
                            {cfg.icon}{cfg.label}
                          </Badge>
                          <span className="text-sm text-muted-foreground">{entry.date}</span>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-1.5">
                          {entry.changes.map((c: string, i: number) => (
                            <li key={i} className="flex items-start gap-2 text-sm">
                              <span className="text-muted-foreground mt-0.5">•</span>
                              <span>{c}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
