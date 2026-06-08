import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Workflow, Split, PiggyBank, CalendarClock, Lock } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function ProgrammableMoney() {
  return (
    <div className="container mx-auto p-6 space-y-6" role="main" aria-label="Programmable Money">
      <h1 className="text-2xl font-bold">Programmable Money</h1>
      <p className="text-muted-foreground">Automate your transfers with smart rules, splits, and conditions</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader><div className="flex items-center gap-2"><Workflow className="h-6 w-6 text-blue-600" /><div><CardTitle>Conditional Transfers</CardTitle><CardDescription>IF balance &gt; X AND rate &lt; Y THEN send</CardDescription></div></div></CardHeader>
          <CardContent><p className="text-sm text-muted-foreground mb-3">Set rules that automatically trigger transfers when conditions are met</p><Button className="w-full">Create Rule</Button></CardContent>
        </Card>
        <Card>
          <CardHeader><div className="flex items-center gap-2"><Split className="h-6 w-6 text-green-600" /><div><CardTitle>Split Transfers</CardTitle><CardDescription>One payment, multiple recipients</CardDescription></div></div></CardHeader>
          <CardContent><p className="text-sm text-muted-foreground mb-3">Split a single transfer across 2-10 beneficiaries with custom amounts</p><Button className="w-full">Create Split</Button></CardContent>
        </Card>
        <Card>
          <CardHeader><div className="flex items-center gap-2"><PiggyBank className="h-6 w-6 text-purple-600" /><div><CardTitle>Round-Up Savings</CardTitle><CardDescription>Save the change automatically</CardDescription></div></div></CardHeader>
          <CardContent><p className="text-sm text-muted-foreground mb-3">Round up every transfer and save the difference toward your goal</p><Button className="w-full">Enable Round-Up</Button></CardContent>
        </Card>
        <Card>
          <CardHeader><div className="flex items-center gap-2"><CalendarClock className="h-6 w-6 text-amber-600" /><div><CardTitle>Subscriptions</CardTitle><CardDescription>Recurring automated payments</CardDescription></div></div></CardHeader>
          <CardContent><p className="text-sm text-muted-foreground mb-3">Schedule weekly, monthly, or quarterly payments that never miss</p><Button className="w-full">Set Up</Button></CardContent>
        </Card>
        <Card>
          <CardHeader><div className="flex items-center gap-2"><Lock className="h-6 w-6 text-red-600" /><div><CardTitle>Escrow Transfers</CardTitle><CardDescription>Hold funds until conditions are met</CardDescription></div></div></CardHeader>
          <CardContent><p className="text-sm text-muted-foreground mb-3">Fund an escrow, release when condition met or document uploaded</p><Button className="w-full">Create Escrow</Button></CardContent>
        </Card>
      </div>
    </div>
  );
}
