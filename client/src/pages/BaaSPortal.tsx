import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Key, Webhook, BarChart3, Code2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function BaaSPortal() {
  const usage = trpc.baasApi.getApiUsage.useQuery({ days: 30 });

  return (
    <div className="container mx-auto p-6 space-y-6" role="main" aria-label="BaaS Partner Portal">
      <h1 className="text-2xl font-bold">Embedded Finance Portal</h1>
      <p className="text-muted-foreground">Integrate RemitFlow's payment infrastructure into your platform</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">API Requests (30d)</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{usage.data?.totalRequests?.toLocaleString() ?? "—"}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Success Rate</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{usage.data?.successRate ?? "—"}%</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Avg Latency</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{usage.data?.avgLatencyMs ?? "—"}ms</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">P99 Latency</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{usage.data?.p99LatencyMs ?? "—"}ms</p></CardContent></Card>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><div className="flex items-center gap-2"><Key className="h-5 w-5" /><CardTitle>API Keys</CardTitle></div><CardDescription>Manage your API credentials</CardDescription></CardHeader>
          <CardContent><Button>Generate New Key</Button></CardContent>
        </Card>
        <Card>
          <CardHeader><div className="flex items-center gap-2"><Webhook className="h-5 w-5" /><CardTitle>Webhooks</CardTitle></div><CardDescription>Configure event notifications</CardDescription></CardHeader>
          <CardContent><Button variant="outline">Manage Webhooks</Button></CardContent>
        </Card>
        <Card>
          <CardHeader><div className="flex items-center gap-2"><Code2 className="h-5 w-5" /><CardTitle>API Documentation</CardTitle></div><CardDescription>Explore endpoints and schemas</CardDescription></CardHeader>
          <CardContent><Button variant="outline">View Docs</Button></CardContent>
        </Card>
        <Card>
          <CardHeader><div className="flex items-center gap-2"><BarChart3 className="h-5 w-5" /><CardTitle>Usage Analytics</CardTitle></div><CardDescription>Monitor API consumption</CardDescription></CardHeader>
          <CardContent><Button variant="outline">View Analytics</Button></CardContent>
        </Card>
      </div>
    </div>
  );
}
