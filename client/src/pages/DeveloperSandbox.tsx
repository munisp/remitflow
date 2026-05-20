import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Code2, Play, RefreshCw, Copy, CheckCircle2, Terminal, Zap, Globe } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";

const TEST_CARDS = [
  { number: "4242 4242 4242 4242", type: "Visa", result: "Success" },
  { number: "4000 0000 0000 0002", type: "Visa", result: "Declined" },
  { number: "4000 0025 0000 3155", type: "Visa", result: "3D Secure" },
  { number: "5555 5555 5555 4444", type: "Mastercard", result: "Success" },
];

const SAMPLE_REQUESTS = [
  {
    name: "Create Transfer",
    method: "POST",
    endpoint: "/api/trpc/transfers.create",
    body: JSON.stringify({ fromCurrency: "USD", toCurrency: "NGN", amount: 100, recipientName: "John Doe", recipientAccount: "0123456789" }, null, 2),
  },
  {
    name: "Get FX Rate",
    method: "GET",
    endpoint: "/api/trpc/fx.rates?input=%7B%22from%22%3A%22USD%22%2C%22to%22%3A%22NGN%22%7D",
    body: null,
  },
  {
    name: "List Wallets",
    method: "GET",
    endpoint: "/api/trpc/wallets.list",
    body: null,
  },
];

export default function DeveloperSandbox() {
  const [activeRequest, setActiveRequest] = useState(SAMPLE_REQUESTS[0]);
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [response, setResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const { data, isLoading, refetch } = trpc.developerSandbox.status.useQuery(undefined);

  const resetMutation = trpc.developerSandbox.resetTestData.useMutation({
    onSuccess: () => { toast.success("Sandbox session reset"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const testApiKey = data?.testApiKey ?? "sk_test_remitflow_sandbox_demo_key_001";

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
    toast.success("Copied to clipboard");
  };

  const runRequest = async () => {
    setLoading(true);
    setResponse(null);
    try {
      const endpoint = customEndpoint || activeRequest.endpoint;
      const res = await fetch(endpoint, {
        method: activeRequest.body ? "POST" : "GET",
        headers: { "Content-Type": "application/json", "X-API-Key": testApiKey },
        ...(activeRequest.body ? { body: activeRequest.body } : {}),
      });
      const json = await res.json();
      setResponse({ status: res.status, data: json, time: Date.now() });
    } catch (e: any) {
      setResponse({ status: 0, error: e.message, time: Date.now() });
    }
    setLoading(false);
  };

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Terminal className="w-6 h-6 text-primary" />
            Developer Sandbox
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Test API endpoints, simulate payments, and explore the RemitFlow API</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <div className="w-2 h-2 rounded-full bg-yellow-500" />
            Sandbox Mode
          </Badge>
          <Button variant="outline" size="sm" onClick={() => resetMutation.mutate()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Reset Session
          </Button>
        </div>
      </div>

      {/* Session Info */}
      <Card className="border-yellow-500/20 bg-yellow-500/5">
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <Zap className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-sm">Sandbox Environment Active</p>
              <p className="text-xs text-muted-foreground mt-1">All transactions are simulated. No real money moves. Use the test API key below.</p>
              <div className="flex items-center gap-2 mt-3">
                <code className="text-xs bg-muted px-2 py-1 rounded font-mono flex-1">{testApiKey}</code>
                <Button size="sm" variant="ghost" onClick={() => copy(testApiKey, "key")}>
                  {copied === "key" ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              {data && (
                <p className="text-xs text-muted-foreground mt-2">
                  Environment: <strong>{data.environment}</strong> ·
                  API Version: {data.apiVersion} ·
                  Rate limit: {data.rateLimits.requestsPerMinute} req/min
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="api-tester">
        <TabsList>
          <TabsTrigger value="api-tester">API Tester</TabsTrigger>
          <TabsTrigger value="test-cards">Test Cards</TabsTrigger>
          <TabsTrigger value="webhooks">Webhook Simulator</TabsTrigger>
          <TabsTrigger value="docs">Quick Reference</TabsTrigger>
        </TabsList>

        <TabsContent value="api-tester" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Sample Requests</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-3">
                {SAMPLE_REQUESTS.map(req => (
                  <button
                    key={req.name}
                    className={`w-full text-left p-2 rounded-lg text-sm transition-colors ${activeRequest.name === req.name ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                    onClick={() => setActiveRequest(req)}
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant={req.method === "POST" ? "default" : "secondary"} className="text-xs">{req.method}</Badge>
                      <span>{req.name}</span>
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>

            <div className="md:col-span-2 space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder={activeRequest.endpoint}
                  value={customEndpoint}
                  onChange={e => setCustomEndpoint(e.target.value)}
                  className="font-mono text-sm"
                />
                <Button onClick={runRequest} disabled={loading}>
                  {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                </Button>
              </div>
              {activeRequest.body && (
                <div className="relative">
                  <pre className="bg-muted rounded-lg p-3 text-xs font-mono overflow-auto max-h-40">{activeRequest.body}</pre>
                  <Button size="sm" variant="ghost" className="absolute top-2 right-2" onClick={() => copy(activeRequest.body!, "body")}>
                    {copied === "body" ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                  </Button>
                </div>
              )}
              {response && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant={response.status >= 200 && response.status < 300 ? "default" : "destructive"}>
                      {response.status || "Error"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">Response</span>
                  </div>
                  <pre className="bg-muted rounded-lg p-3 text-xs font-mono overflow-auto max-h-60">
                    {JSON.stringify(response.data ?? response.error, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="test-cards">
          <Card>
            <CardContent className="pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Card Number</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Expiry / CVC</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {TEST_CARDS.map(card => (
                    <TableRow key={card.number}>
                      <TableCell className="font-mono">{card.number}</TableCell>
                      <TableCell>{card.type}</TableCell>
                      <TableCell>
                        <Badge variant={card.result === "Success" ? "default" : card.result === "Declined" ? "destructive" : "secondary"}>
                          {card.result}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">12/34 / 123</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => copy(card.number.replace(/\s/g, ""), card.number)}>
                          {copied === card.number ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="webhooks">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <p className="text-sm text-muted-foreground">Simulate webhook events to test your integration endpoints.</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {(data?.availableSimulations ?? ["transfer.completed", "transfer.failed", "kyc.approved", "kyc.rejected", "payment.received", "fx_alert.triggered"]).map(event => (
                  <Button key={event} variant="outline" size="sm" className="justify-start font-mono text-xs"
                    onClick={() => {
                      toast.success(`Simulated: ${event}`);
                    }}>
                    <Zap className="w-3 h-3 mr-2 text-yellow-500" />
                    {event}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="docs">
          <Card>
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h3 className="font-semibold text-sm mb-2 flex items-center gap-2"><Globe className="w-4 h-4" />Base URL</h3>
                  <code className="text-xs bg-muted px-2 py-1 rounded block">https://your-domain.manus.space/api/trpc</code>
                </div>
                <div>
                  <h3 className="font-semibold text-sm mb-2 flex items-center gap-2"><Code2 className="w-4 h-4" />Authentication</h3>
                  <code className="text-xs bg-muted px-2 py-1 rounded block">X-API-Key: sk_live_your_key_here</code>
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-sm mb-2">Key Endpoints</h3>
                <div className="space-y-1">
                  {[
                    ["POST", "/transfers.create", "Initiate a transfer"],
                    ["GET", "/fx.rates", "Get live FX rates"],
                    ["GET", "/wallets.list", "List user wallets"],
                    ["POST", "/kyc.submitDocument", "Submit KYC document"],
                    ["GET", "/transfers.list", "List transfer history"],
                  ].map(([method, path, desc]) => (
                    <div key={path} className="flex items-center gap-3 text-xs">
                      <Badge variant={method === "POST" ? "default" : "secondary"} className="text-xs w-12 justify-center">{method}</Badge>
                      <code className="font-mono text-muted-foreground w-48">{path}</code>
                      <span className="text-muted-foreground">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  

    </DashboardLayout>

  );
}
