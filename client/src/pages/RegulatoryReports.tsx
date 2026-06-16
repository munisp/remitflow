import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Download, Calendar } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function RegulatoryReports() {
  const history = trpc.regReportsV2.getReportHistory.useQuery({ limit: 20 });

  return (
    <div className="container mx-auto p-6 space-y-6" role="main" aria-label="Regulatory Reports">
      <h1 className="text-2xl font-bold">Regulatory Report Generation</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader><CardTitle>CBN eFASS</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">Nigeria Central Bank regulatory filings</p>
            <div className="space-y-1 text-sm"><Badge variant="outline">Monthly Returns</Badge> <Badge variant="outline">Quarterly Returns</Badge></div>
            <Button className="w-full mt-2"><FileText className="h-4 w-4 mr-2" /> Generate</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>FinCEN BSA</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">US Bank Secrecy Act filings</p>
            <div className="space-y-1 text-sm"><Badge variant="outline">CTR</Badge> <Badge variant="outline">SAR</Badge> <Badge variant="outline">FBAR</Badge></div>
            <Button className="w-full mt-2"><FileText className="h-4 w-4 mr-2" /> Generate</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>FINTRAC</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">Canadian financial intelligence filings</p>
            <div className="space-y-1 text-sm"><Badge variant="outline">LCTR</Badge> <Badge variant="outline">STR</Badge> <Badge variant="outline">EFTR</Badge></div>
            <Button className="w-full mt-2"><FileText className="h-4 w-4 mr-2" /> Generate</Button>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Report History</CardTitle></CardHeader>
        <CardContent>
          {history.data?.reports?.map((r: { id: string; regulator: string; type: string; generatedAt: string; status: string }, i: number) => (
            <div key={i} className="flex items-center justify-between py-3 border-b last:border-0">
              <div className="flex items-center gap-3">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <div><p className="font-medium">{r.regulator.toUpperCase()} — {r.type}</p><p className="text-xs text-muted-foreground">{r.generatedAt}</p></div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={r.status === "completed" ? "default" : "secondary"}>{r.status}</Badge>
                <Button variant="ghost" size="sm"><Download className="h-4 w-4" /></Button>
              </div>
            </div>
          )) ?? <p className="text-muted-foreground">No reports generated yet</p>}
        </CardContent>
      </Card>
    </div>
  );
}
