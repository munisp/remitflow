import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function SavingsCircles() {
  const circles = trpc.socialRemittance.getMyCircles.useQuery();
  const milestones = trpc.socialRemittance.milestones.useQuery();

  return (
    <div className="container mx-auto p-6 space-y-6" role="main" aria-label="Savings Circles">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Savings Circles</h1>
          <p className="text-muted-foreground">Join ajo, esusu, or chama savings groups with your community</p>
        </div>
        <Button><Plus className="h-4 w-4 mr-2" /> Create Circle</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {circles.data?.circles?.map((c: { id: string; name: string; type: string; memberCount: number; totalContributed: number; targetAmount: number; currency: string }, i: number) => (
          <Card key={i}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{c.name}</CardTitle>
                <Badge variant="outline">{c.type.replace("_", " ")}</Badge>
              </div>
              <CardDescription className="flex items-center gap-1"><Users className="h-3 w-3" /> {c.memberCount} members</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between text-sm"><span>Progress</span><span>{c.currency} {c.totalContributed.toLocaleString()} / {c.targetAmount.toLocaleString()}</span></div>
                <div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, (c.totalContributed / c.targetAmount) * 100)}%` }} /></div>
                <Button variant="outline" className="w-full mt-2">Contribute</Button>
              </div>
            </CardContent>
          </Card>
        )) ?? <p className="text-muted-foreground">No circles yet</p>}
      </div>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Trophy className="h-5 w-5 text-yellow-600" /> Milestones</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          {milestones.data?.achievedMilestones?.map((m: { badge: string; amount: number; emoji: string }, i: number) => (
            <div key={i} className="flex flex-col items-center gap-1 p-3 rounded-lg bg-yellow-50">
              <span className="text-2xl">{m.emoji}</span>
              <span className="text-xs font-medium">{m.badge}</span>
              <span className="text-xs text-muted-foreground">₦{m.amount.toLocaleString()}</span>
            </div>
          )) ?? <p className="text-muted-foreground">Loading milestones...</p>}
        </CardContent>
      </Card>
    </div>
  );
}
