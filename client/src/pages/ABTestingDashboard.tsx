import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FlaskConical, Plus, BarChart3 } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function ABTestingDashboard() {
  const experiments = trpc.abTesting.listExperiments.useQuery({ status: "all" });

  return (
    <div className="container mx-auto p-6 space-y-6" role="main" aria-label="A/B Testing Dashboard">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">A/B Testing</h1>
        <Button><Plus className="h-4 w-4 mr-2" /> New Experiment</Button>
      </div>
      <div className="space-y-4">
        {experiments.data?.experiments?.map((e: { id: string; name: string; status: string; variants: { name: string; weight: number }[]; startDate: string }, i: number) => (
          <Card key={i}>
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <FlaskConical className="h-5 w-5 text-purple-600" />
                <div>
                  <p className="font-medium">{e.name}</p>
                  <p className="text-xs text-muted-foreground">{e.variants?.length ?? 0} variants · Started {e.startDate}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={e.status === "running" ? "default" : "secondary"}>{e.status}</Badge>
                <Button variant="ghost" size="sm"><BarChart3 className="h-4 w-4" /></Button>
              </div>
            </CardContent>
          </Card>
        )) ?? <p className="text-muted-foreground">No experiments yet</p>}
      </div>
    </div>
  );
}
