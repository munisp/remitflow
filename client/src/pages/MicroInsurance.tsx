import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, Heart, Smartphone, Umbrella } from "lucide-react";
import { trpc } from "@/lib/trpc";

const PRODUCT_ICONS: Record<string, React.ReactNode> = {
  transfer_protection: <Shield className="h-6 w-6 text-blue-600" />,
  diaspora_health: <Heart className="h-6 w-6 text-red-600" />,
  device_insurance: <Smartphone className="h-6 w-6 text-purple-600" />,
};

export default function MicroInsurance() {
  const products = trpc.microInsurance.getProducts.useQuery();
  const policies = trpc.microInsurance.getMyPolicies.useQuery();

  return (
    <div className="container mx-auto p-6 space-y-6" role="main" aria-label="Micro-Insurance">
      <h1 className="text-2xl font-bold">Insurance Products</h1>
      <p className="text-muted-foreground">Protect your transfers and loved ones with affordable micro-insurance</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {products.data?.map((p: { id: string; name: string; description: string; premiumRatePercentage: string; maxCoverage: number }, i: number) => (
          <Card key={i} className="relative overflow-hidden">
            <CardHeader>
              <div className="flex items-center gap-3">
                {PRODUCT_ICONS[p.id] ?? <Umbrella className="h-6 w-6 text-green-600" />}
                <div>
                  <CardTitle className="text-lg">{p.name}</CardTitle>
                  <CardDescription>{p.description}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Premium</span><span className="font-medium">{p.premiumRatePercentage}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Max Coverage</span><span className="font-medium">₦{p.maxCoverage.toLocaleString()}</span></div>
              <Button className="w-full">Get Quote</Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <h2 className="text-xl font-bold mt-8">My Policies</h2>
      {policies.data?.policies?.length ? (
        <div className="space-y-3">
          {policies.data.policies.map((p: { id: string; productName: string; status: string; coverageAmount: number; expiresAt: string }, i: number) => (
            <Card key={i}>
              <CardContent className="flex items-center justify-between p-4">
                <div><p className="font-medium">{p.productName}</p><p className="text-sm text-muted-foreground">Coverage: ₦{p.coverageAmount.toLocaleString()}</p></div>
                <div className="text-right"><Badge variant={p.status === "active" ? "default" : "secondary"}>{p.status}</Badge><p className="text-xs text-muted-foreground mt-1">Expires: {p.expiresAt}</p></div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : <p className="text-muted-foreground">No active policies</p>}
    </div>
  );
}
