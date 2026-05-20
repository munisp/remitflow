import { useTranslation } from 'react-i18next';
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Palette, Eye, Save, Globe, Mail, Type } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

const FONTS = ["Inter", "Poppins", "Roboto", "Nunito", "Lato", "Open Sans", "Montserrat"];

export default function AdminWhiteLabel() {
  const { t } = useTranslation();
  const { data: tenants } = trpc.tenants.list.useQuery({ limit: 50, offset: 0 });
  const [selectedTenant, setSelectedTenant] = useState<number | null>(null);
  const [config, setConfig] = useState({
    primaryColor: "#7C3AED", secondaryColor: "#4F46E5", accentColor: "#10B981",
    logoUrl: "", faviconUrl: "", appName: "RemitFlow", tagline: "Cross-Border Finance",
    supportEmail: "support@remitflow.app", customDomain: "", fontFamily: "Inter",
  });

  const { data: savedConfig } = trpc.whiteLabelPreview.getConfig.useQuery(
    { tenantId: selectedTenant! }, { enabled: !!selectedTenant }
  );
  const { data: cssPreview } = trpc.whiteLabelPreview.generateCSS.useQuery(
    { tenantId: selectedTenant! }, { enabled: !!selectedTenant }
  );
  const saveMutation = trpc.whiteLabelPreview.saveConfig.useMutation({
    onSuccess: () => toast.success("White-label config saved!"),
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    if (savedConfig) setConfig({ ...config, ...savedConfig });
  }, [savedConfig]);

  return (

    <DashboardLayout>
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-purple-100 rounded-lg"><Palette className="h-6 w-6 text-purple-600" /></div>
        <div>
          <h1 className="text-2xl font-bold">White-Label Configuration</h1>
          <p className="text-muted-foreground">Customize branding for each tenant partner</p>
        </div>
      </div>

      <div>
        <Label>Select Tenant</Label>
        <Select value={selectedTenant?.toString() ?? ""} onValueChange={v => setSelectedTenant(Number(v))}>
          <SelectTrigger className="mt-1 w-72"><SelectValue placeholder="Choose a tenant..." /></SelectTrigger>
          <SelectContent>
            {(tenants?.tenants as any[] ?? []).map((t: any) => (
              <SelectItem key={t.id} value={t.id.toString()}>{t.name} ({t.subdomain})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedTenant && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Config Form */}
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Type className="h-4 w-4" />Brand Identity</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div><Label>App Name</Label><Input className="mt-1" value={config.appName} onChange={e => setConfig(c => ({...c,appName:e.target.value}))} /></div>
                <div><Label>Tagline</Label><Input className="mt-1" value={config.tagline} onChange={e => setConfig(c => ({...c,tagline:e.target.value}))} /></div>
                <div>
                  <Label>Font Family</Label>
                  <Select value={config.fontFamily} onValueChange={v => setConfig(c => ({...c,fontFamily:v}))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{FONTS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Palette className="h-4 w-4" />Colors</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {[["primaryColor","Primary Color"],["secondaryColor","Secondary Color"],["accentColor","Accent Color"]].map(([key,label]) => (
                  <div key={key} className="flex items-center gap-3">
                    <input type="color" value={(config as any)[key]} onChange={e => setConfig(c => ({...c,[key]:e.target.value}))} className="w-10 h-10 rounded cursor-pointer border" />
                    <div className="flex-1">
                      <Label>{label}</Label>
                      <Input className="mt-1 font-mono" value={(config as any)[key]} onChange={e => setConfig(c => ({...c,[key]:e.target.value}))} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Globe className="h-4 w-4" />Domain & Contact</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div><Label>Custom Domain</Label><Input className="mt-1" placeholder="app.partner.com" value={config.customDomain} onChange={e => setConfig(c => ({...c,customDomain:e.target.value}))} /></div>
                <div><Label>Support Email</Label><Input className="mt-1" type="email" value={config.supportEmail} onChange={e => setConfig(c => ({...c,supportEmail:e.target.value}))} /></div>
                <div><Label>Logo URL</Label><Input className="mt-1" placeholder="https://cdn.partner.com/logo.png" value={config.logoUrl} onChange={e => setConfig(c => ({...c,logoUrl:e.target.value}))} /></div>
              </CardContent>
            </Card>

            <Button className="w-full" disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate({ tenantId: selectedTenant, ...config as any })}>
              <Save className="h-4 w-4 mr-2" />{saveMutation.isPending ? "Saving..." : "Save Configuration"}
            </Button>
          </div>

          {/* Live Preview */}
          <div>
            <Card className="sticky top-4">
              <CardHeader><CardTitle className="flex items-center gap-2"><Eye className="h-4 w-4" />Live Preview</CardTitle><CardDescription>How the dashboard looks for this tenant's users</CardDescription></CardHeader>
              <CardContent>
                <div className="rounded-lg border overflow-hidden" style={{ fontFamily: config.fontFamily }}>
                  {/* Mock nav */}
                  <div className="p-3 flex items-center gap-2" style={{ backgroundColor: config.primaryColor }}>
                    {config.logoUrl ? <img src={config.logoUrl} alt="logo" className="h-6 w-6 rounded object-contain bg-white" /> : <div className="h-6 w-6 rounded bg-white/30" />}
                    <span className="text-white font-bold text-sm">{config.appName}</span>
                  </div>
                  {/* Mock sidebar */}
                  <div className="flex">
                    <div className="w-32 bg-gray-50 p-2 space-y-1 text-xs">
                      {["Dashboard","Send Money","Wallet","Transactions","Settings"].map(item => (
                        <div key={item} className="p-1.5 rounded cursor-pointer hover:bg-gray-100">{item}</div>
                      ))}
                    </div>
                    {/* Mock content */}
                    <div className="flex-1 p-3 space-y-2">
                      <div className="rounded-lg p-3 text-white text-xs" style={{ background: `linear-gradient(135deg, ${config.primaryColor}, ${config.secondaryColor})` }}>
                        <div className="opacity-80">{config.tagline}</div>
                        <div className="text-xl font-bold mt-1">$2,450.00</div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded p-2 text-xs text-center text-white" style={{ backgroundColor: config.accentColor }}>Send Money</div>
                        <div className="rounded p-2 text-xs text-center border">Receive</div>
                      </div>
                      <div className="text-xs text-muted-foreground">Support: {config.supportEmail}</div>
                    </div>
                  </div>
                </div>

                {cssPreview?.css && (
                  <div className="mt-4">
                    <Label className="text-xs">Generated CSS Variables</Label>
                    <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-auto max-h-32">{cssPreview.css}</pre>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  

    </DashboardLayout>

  );
}
