import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Leaf, TreePine, Globe, TrendingDown, Plus, Award } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function CarbonOffsetPage() {
  const { t } = useTranslation();
  const [purchaseDialog, setPurchaseDialog] = useState(false);
  const [projectType, setProjectType] = useState<"reforestation"|"solar"|"wind"|"cookstoves">("reforestation");
  const [co2Kg, setCo2Kg] = useState("10");

  const { data: footprint } = trpc.v100.carbonOffset.getFootprint.useQuery();
  const { data: projects } = trpc.v100.carbonOffset.getProjects.useQuery();

  const purchaseMutation = trpc.v100.carbonOffset.purchaseOffset.useMutation({
    onSuccess: (d) => {
      toast.success(`Purchased ${d.co2Kg}kg CO₂ offset — Certificate: ${d.certificate}`);
      setPurchaseDialog(false);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Leaf className="w-6 h-6 text-green-500" />Carbon Offset</h1>
          <p className="text-muted-foreground">Track your carbon footprint and purchase verified offsets</p>
        </div>
        <Dialog open={purchaseDialog} onOpenChange={setPurchaseDialog}>
          <DialogTrigger asChild>
            <Button className="bg-green-600 hover:bg-green-700"><Plus className="w-4 h-4 mr-2" />Purchase Offset</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Purchase Carbon Offset</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Project Type</Label>
                <Select value={projectType} onValueChange={(v) => setProjectType(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="reforestation">🌳 Reforestation</SelectItem>
                    <SelectItem value="solar">☀️ Solar Energy</SelectItem>
                    <SelectItem value="wind">💨 Wind Energy</SelectItem>
                    <SelectItem value="cookstoves">🍳 Clean Cookstoves</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>CO₂ to Offset (kg)</Label>
                <Input value={co2Kg} onChange={e => setCo2Kg(e.target.value)} type="number" min="1" step="1" />
                <p className="text-xs text-muted-foreground mt-1">Cost: ~${(Number(co2Kg) * 0.15).toFixed(2)} USD</p>
              </div>
              <Button className="w-full bg-green-600 hover:bg-green-700"
                onClick={() => purchaseMutation.mutate({ projectType, co2Kg: Number(co2Kg) })}
                disabled={purchaseMutation.isPending}>
                {purchaseMutation.isPending ? "Processing..." : `Purchase ${co2Kg}kg Offset`}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Footprint Summary */}
      {footprint && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-green-200 dark:border-green-800">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-1"><Globe className="w-3 h-3" />Total Transfers</p>
              <p className="text-2xl font-bold">{footprint.totalTransfers}</p>
              <p className="text-xs text-muted-foreground">All time</p>
            </CardContent>
          </Card>
          <Card className="border-green-200 dark:border-green-800">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-1"><TrendingDown className="w-3 h-3" />CO₂ Footprint</p>
              <p className="text-2xl font-bold">{footprint.totalCO2Kg.toFixed(2)}kg</p>
              <p className="text-xs text-muted-foreground">CO₂ equivalent</p>
            </CardContent>
          </Card>
          <Card className="border-green-200 dark:border-green-800">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-1"><TreePine className="w-3 h-3 text-green-500" />Offset Purchased</p>
              <p className="text-2xl font-bold text-green-500">{footprint.offsetPurchased.toFixed(2)}kg</p>
              <p className="text-xs text-muted-foreground">Verified credits</p>
            </CardContent>
          </Card>
          <Card className="border-green-200 dark:border-green-800">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-1"><Award className="w-3 h-3 text-yellow-500" />Status</p>
              <p className={`text-lg font-bold ${footprint.netCO2 <= 0 ? "text-green-500" : "text-orange-500"}`}>
                {footprint.status === "carbon_neutral" ? "Carbon Neutral" : `${footprint.netCO2.toFixed(2)}kg Net`}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Monthly Footprint */}
      {footprint && footprint.monthlyFootprint.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Monthly Footprint</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 h-32">
              {footprint.monthlyFootprint.map(m => {
                const maxCo2 = Math.max(...footprint.monthlyFootprint.map(x => x.co2Kg), 1);
                return (
                  <DashboardLayout>
                  <div key={m.month} className="flex flex-col items-center gap-1 flex-1">
                    <span className="text-xs text-muted-foreground">{m.co2Kg.toFixed(2)}kg</span>
                    <div className="w-full bg-orange-400 rounded-t" style={{ height: `${(m.co2Kg / maxCo2) * 80}px` }} />
                    <span className="text-xs text-muted-foreground">{m.month}</span>
                  </div>
                
                  </DashboardLayout>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Available Projects */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><TreePine className="w-4 h-4 text-green-500" />Available Projects</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(projects ?? []).map(project => (
              <div key={project.id} className="border rounded-lg p-4 hover:border-green-400 transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-semibold text-sm">{project.name}</p>
                    <p className="text-xs text-muted-foreground">{project.country}</p>
                  </div>
                  <Badge variant="outline" className="text-green-600 border-green-300">{project.verified}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-3 capitalize">{project.type}</p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Price per kg CO₂</p>
                    <p className="font-bold text-green-600">${project.pricePerKg}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Available</p>
                    <Badge variant={project.available ? "default" : "secondary"}>{project.available ? "Available" : "Sold Out"}</Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
