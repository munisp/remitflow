import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Palette, Eye, Save, RefreshCw, Smartphone, Monitor, Tablet } from "lucide-react";
import { toast } from "sonner";

const FONT_OPTIONS = [
  { value: "Inter", label: "Inter (Default)" },
  { value: "Poppins", label: "Poppins" },
  { value: "Roboto", label: "Roboto" },
  { value: "Open Sans", label: "Open Sans" },
  { value: "Nunito", label: "Nunito" },
  { value: "DM Sans", label: "DM Sans" },
];

const PRESET_THEMES = [
  { name: "Purple Pro", primary: "#7c3aed", secondary: "#06b6d4", accent: "#f59e0b" },
  { name: "Ocean Blue", primary: "#1d4ed8", secondary: "#0891b2", accent: "#10b981" },
  { name: "Forest Green", primary: "#15803d", secondary: "#0d9488", accent: "#f59e0b" },
  { name: "Sunset Orange", primary: "#ea580c", secondary: "#db2777", accent: "#7c3aed" },
  { name: "Midnight", primary: "#1e1b4b", secondary: "#312e81", accent: "#6366f1" },
  { name: "Rose Gold", primary: "#be185d", secondary: "#9f1239", accent: "#f59e0b" },
];

type ViewMode = "desktop" | "tablet" | "mobile";

export default function BrandingPreview() {
  const [tenantId] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>("desktop");
  const [primaryColor, setPrimaryColor] = useState("#7c3aed");
  const [secondaryColor, setSecondaryColor] = useState("#06b6d4");
  const [accentColor, setAccentColor] = useState("#f59e0b");
  const [fontFamily, setFontFamily] = useState("Inter");
  const [borderRadius, setBorderRadius] = useState(8);
  const [companyName, setCompanyName] = useState("RemitFlow Partner");
  const [tagline, setTagline] = useState("Send money home, fast and secure");
  const [darkMode, setDarkMode] = useState(false);
  const [logoUrl, setLogoUrl] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  // Load existing white-label config from the dedicated whiteLabelConfig router
  const { data: wlConfig } = trpc.whiteLabelConfig.get.useQuery();

  useEffect(() => {
    if (wlConfig) {
      if (wlConfig.primaryColor) setPrimaryColor(wlConfig.primaryColor);
      if (wlConfig.secondaryColor) setSecondaryColor(wlConfig.secondaryColor);
      if (wlConfig.logoUrl) setLogoUrl(wlConfig.logoUrl);
      if (wlConfig.appName) setCompanyName(wlConfig.appName);
    }
  }, [wlConfig]);

  // Use the dedicated whiteLabelConfig.update endpoint (not partnerApplications.submit)
  const saveMutation = trpc.whiteLabelConfig.update.useMutation({
    onSuccess: () => { toast.success("Branding configuration saved"); setIsDirty(false); },
    onError: (e) => toast.error(e.message),
  });

  const handleChange = (fn: () => void) => { fn(); setIsDirty(true); };

  const applyPreset = (preset: typeof PRESET_THEMES[0]) => {
    setPrimaryColor(preset.primary);
    setSecondaryColor(preset.secondary);
    setAccentColor(preset.accent);
    setIsDirty(true);
  };

  const handleSave = () => {
    saveMutation.mutate({
      tenantId,
      primaryColor,
      secondaryColor,
      logoUrl: logoUrl || undefined,
      appName: companyName || "RemitFlow Partner",
    });
  };

  const previewWidth = viewMode === "desktop" ? "100%" : viewMode === "tablet" ? "768px" : "375px";

  return (
    <DashboardLayout>
      <div className="space-y-5 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Palette className="w-6 h-6 text-purple-500" />
              Branding Preview
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Customize your white-label appearance and preview in real-time</p>
          </div>
          <div className="flex items-center gap-3">
            {isDirty && <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>}
            <Button variant="outline" size="sm" onClick={() => { setIsDirty(false); }}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Reset
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending || !isDirty}>
              <Save className="w-4 h-4 mr-2" />
              {saveMutation.isPending ? "Saving..." : "Save Branding"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Controls Panel */}
          <div className="space-y-4">
            <Tabs defaultValue="colors">
              <TabsList className="w-full">
                <TabsTrigger value="colors" className="flex-1">Colors</TabsTrigger>
                <TabsTrigger value="typography" className="flex-1">Typography</TabsTrigger>
                <TabsTrigger value="identity" className="flex-1">Identity</TabsTrigger>
              </TabsList>

              {/* Colors Tab */}
              <TabsContent value="colors" className="space-y-4 mt-4">
                {/* Presets */}
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide mb-2 block">Quick Presets</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {PRESET_THEMES.map((preset) => (
                      <button
                        key={preset.name}
                        onClick={() => applyPreset(preset)}
                        className="p-2 rounded-lg border hover:border-purple-400 transition-colors text-left"
                        title={preset.name}
                      >
                        <div className="flex gap-1 mb-1">
                          <div className="w-4 h-4 rounded-full" style={{ background: preset.primary }} />
                          <div className="w-4 h-4 rounded-full" style={{ background: preset.secondary }} />
                          <div className="w-4 h-4 rounded-full" style={{ background: preset.accent }} />
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{preset.name}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-sm mb-1.5 block">Primary Color</Label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={primaryColor} onChange={(e) => handleChange(() => setPrimaryColor(e.target.value))} className="w-10 h-10 rounded cursor-pointer border" />
                    <Input value={primaryColor} onChange={(e) => handleChange(() => setPrimaryColor(e.target.value))} className="font-mono text-sm" />
                  </div>
                </div>
                <div>
                  <Label className="text-sm mb-1.5 block">Secondary Color</Label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={secondaryColor} onChange={(e) => handleChange(() => setSecondaryColor(e.target.value))} className="w-10 h-10 rounded cursor-pointer border" />
                    <Input value={secondaryColor} onChange={(e) => handleChange(() => setSecondaryColor(e.target.value))} className="font-mono text-sm" />
                  </div>
                </div>
                <div>
                  <Label className="text-sm mb-1.5 block">Accent Color</Label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={accentColor} onChange={(e) => handleChange(() => setAccentColor(e.target.value))} className="w-10 h-10 rounded cursor-pointer border" />
                    <Input value={accentColor} onChange={(e) => handleChange(() => setAccentColor(e.target.value))} className="font-mono text-sm" />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Dark Mode Default</Label>
                  <Switch checked={darkMode} onCheckedChange={(v) => handleChange(() => setDarkMode(v))} />
                </div>
              </TabsContent>

              {/* Typography Tab */}
              <TabsContent value="typography" className="space-y-4 mt-4">
                <div>
                  <Label className="text-sm mb-1.5 block">Font Family</Label>
                  <Select value={fontFamily} onValueChange={(v) => handleChange(() => setFontFamily(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FONT_OPTIONS.map(f => (
                        <SelectItem key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm mb-3 block">Border Radius: {borderRadius}px</Label>
                  <Slider
                    value={[borderRadius]}
                    onValueChange={([v]) => handleChange(() => setBorderRadius(v))}
                    min={0}
                    max={24}
                    step={2}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>Sharp (0px)</span>
                    <span>Rounded (24px)</span>
                  </div>
                </div>
                <div className="p-3 bg-muted/30 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-2">Preview</p>
                  <div style={{ fontFamily, borderRadius: `${borderRadius}px`, background: primaryColor, color: "white", padding: "8px 16px", display: "inline-block" }}>
                    Send Money
                  </div>
                </div>
              </TabsContent>

              {/* Identity Tab */}
              <TabsContent value="identity" className="space-y-4 mt-4">
                <div>
                  <Label className="text-sm mb-1.5 block">Company Name</Label>
                  <Input value={companyName} onChange={(e) => handleChange(() => setCompanyName(e.target.value))} />
                </div>
                <div>
                  <Label className="text-sm mb-1.5 block">Tagline</Label>
                  <Input value={tagline} onChange={(e) => handleChange(() => setTagline(e.target.value))} />
                </div>
                <div>
                  <Label className="text-sm mb-1.5 block">Logo URL</Label>
                  <Input value={logoUrl} onChange={(e) => handleChange(() => setLogoUrl(e.target.value))} placeholder="https://your-cdn.com/logo.png" />
                  {logoUrl && (
                    <div className="mt-2 p-2 border rounded-lg">
                      <img src={logoUrl} alt="Logo preview" className="h-10 object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Preview Panel */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Eye className="w-4 h-4" />
                    Live Preview
                  </span>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant={viewMode === "desktop" ? "default" : "ghost"} onClick={() => setViewMode("desktop")}>
                      <Monitor className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant={viewMode === "tablet" ? "default" : "ghost"} onClick={() => setViewMode("tablet")}>
                      <Tablet className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant={viewMode === "mobile" ? "default" : "ghost"} onClick={() => setViewMode("mobile")}>
                      <Smartphone className="w-4 h-4" />
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-auto border rounded-lg" style={{ background: darkMode ? "#0f172a" : "#f8fafc", minHeight: "500px" }}>
                  <div style={{ width: previewWidth, margin: "0 auto", transition: "width 0.3s ease" }}>
                    {/* Simulated App Preview */}
                    <div style={{ fontFamily, color: darkMode ? "#f1f5f9" : "#0f172a" }}>
                      {/* Header */}
                      <div style={{ background: primaryColor, padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          {logoUrl ? (
                            <img src={logoUrl} alt="Logo" style={{ height: "32px", objectFit: "contain" }} onError={(e) => (e.currentTarget.style.display = "none")} />
                          ) : (
                            <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: "rgba(255,255,255,0.3)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: "bold", fontSize: "14px" }}>
                              {companyName.charAt(0)}
                            </div>
                          )}
                          <span style={{ color: "white", fontWeight: "700", fontSize: "18px" }}>{companyName}</span>
                        </div>
                        <div style={{ display: "flex", gap: "8px" }}>
                          {["Send", "Receive", "History"].map(item => (
                            <span key={item} style={{ color: "rgba(255,255,255,0.8)", fontSize: "13px", cursor: "pointer" }}>{item}</span>
                          ))}
                        </div>
                      </div>

                      {/* Hero */}
                      <div style={{ padding: "32px 24px", textAlign: "center", background: darkMode ? "#1e293b" : "white" }}>
                        <h1 style={{ fontSize: "28px", fontWeight: "800", marginBottom: "8px" }}>{tagline}</h1>
                        <p style={{ color: darkMode ? "#94a3b8" : "#64748b", fontSize: "14px", marginBottom: "24px" }}>
                          Fast, secure international money transfers
                        </p>
                        <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
                          <button style={{ background: primaryColor, color: "white", border: "none", padding: "12px 28px", borderRadius: `${borderRadius}px`, fontFamily, fontWeight: "600", cursor: "pointer", fontSize: "14px" }}>
                            Send Money
                          </button>
                          <button style={{ background: "transparent", color: primaryColor, border: `2px solid ${primaryColor}`, padding: "12px 28px", borderRadius: `${borderRadius}px`, fontFamily, fontWeight: "600", cursor: "pointer", fontSize: "14px" }}>
                            Learn More
                          </button>
                        </div>
                      </div>

                      {/* FX Calculator Preview */}
                      <div style={{ padding: "24px", background: darkMode ? "#0f172a" : "#f8fafc" }}>
                        <div style={{ background: darkMode ? "#1e293b" : "white", borderRadius: `${borderRadius}px`, padding: "20px", maxWidth: "480px", margin: "0 auto", boxShadow: "0 4px 6px rgba(0,0,0,0.05)" }}>
                          <h3 style={{ fontWeight: "700", marginBottom: "16px", fontSize: "16px" }}>Quick Calculator</h3>
                          <div style={{ display: "flex", gap: "12px", marginBottom: "12px" }}>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: "11px", color: darkMode ? "#94a3b8" : "#64748b", display: "block", marginBottom: "4px" }}>You Send</label>
                              <div style={{ display: "flex", border: `1px solid ${darkMode ? "#334155" : "#e2e8f0"}`, borderRadius: `${borderRadius}px`, overflow: "hidden" }}>
                                <input style={{ flex: 1, padding: "10px 12px", border: "none", background: "transparent", color: "inherit", fontFamily, fontSize: "14px" }} defaultValue="500" />
                                <span style={{ padding: "10px 12px", background: darkMode ? "#334155" : "#f1f5f9", fontSize: "13px", fontWeight: "600" }}>USD</span>
                              </div>
                            </div>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: "11px", color: darkMode ? "#94a3b8" : "#64748b", display: "block", marginBottom: "4px" }}>They Receive</label>
                              <div style={{ display: "flex", border: `1px solid ${darkMode ? "#334155" : "#e2e8f0"}`, borderRadius: `${borderRadius}px`, overflow: "hidden" }}>
                                <input style={{ flex: 1, padding: "10px 12px", border: "none", background: "transparent", color: "inherit", fontFamily, fontSize: "14px" }} defaultValue="769,230" readOnly />
                                <span style={{ padding: "10px 12px", background: darkMode ? "#334155" : "#f1f5f9", fontSize: "13px", fontWeight: "600" }}>NGN</span>
                              </div>
                            </div>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: darkMode ? "#94a3b8" : "#64748b", marginBottom: "16px" }}>
                            <span>Rate: 1 USD = 1,538.46 NGN</span>
                            <span style={{ color: accentColor, fontWeight: "600" }}>Fee: $3.99</span>
                          </div>
                          <button style={{ width: "100%", background: primaryColor, color: "white", border: "none", padding: "12px", borderRadius: `${borderRadius}px`, fontFamily, fontWeight: "600", cursor: "pointer", fontSize: "14px" }}>
                            Send Now →
                          </button>
                        </div>
                      </div>

                      {/* Features Row */}
                      <div style={{ padding: "24px", display: "flex", gap: "16px", background: darkMode ? "#1e293b" : "white" }}>
                        {[
                          { icon: "⚡", title: "Instant", desc: "Transfers in minutes" },
                          { icon: "🔒", title: "Secure", desc: "Bank-grade encryption" },
                          { icon: "💰", title: "Low Fees", desc: "Best rates guaranteed" },
                        ].map(f => (
                          <div key={f.title} style={{ flex: 1, textAlign: "center", padding: "16px", borderRadius: `${borderRadius}px`, background: darkMode ? "#0f172a" : "#f8fafc" }}>
                            <div style={{ fontSize: "24px", marginBottom: "8px" }}>{f.icon}</div>
                            <div style={{ fontWeight: "700", fontSize: "14px", marginBottom: "4px", color: primaryColor }}>{f.title}</div>
                            <div style={{ fontSize: "12px", color: darkMode ? "#94a3b8" : "#64748b" }}>{f.desc}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
