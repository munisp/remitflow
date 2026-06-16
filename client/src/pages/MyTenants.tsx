import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getLoginUrl } from "@/const";
import { Building2, Plus, ArrowRight, Globe, Users, Settings, Zap } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

export default function MyTenants() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { user, loading } = useAuth();

  const { data: tenants = [], isLoading, isError } = trpc.partnerOnboarding.myTenants.useQuery(undefined, {
    enabled: !!user,
  });

  if (loading || isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Card className="bg-white/5 border-white/10 max-w-sm w-full mx-4">
          <CardContent className="pt-8 pb-6 text-center space-y-4">
            <Building2 className="w-12 h-12 text-violet-400 mx-auto" />
            <h2 className="text-white font-bold text-lg">Sign In Required</h2>
            <p className="text-white/50 text-sm">Sign in to manage your white-label tenants.</p>
            <Button className="w-full bg-violet-600 hover:bg-violet-700 text-white"
              onClick={() => window.location.href = getLoginUrl("/partner/my-tenants")}>
              Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusColor: Record<string, string> = {
    trial: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    active: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    suspended: "bg-red-500/20 text-red-300 border-red-500/30",
    cancelled: "bg-gray-500/20 text-gray-300 border-gray-500/30",
  };

  const planColor: Record<string, string> = {
    starter: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    growth: "bg-violet-500/20 text-violet-300 border-violet-500/30",
    enterprise: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  };

  return (

    <DashboardLayout>
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/30 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-bold text-white text-sm">RemitFlow</p>
              <p className="text-xs text-white/50">Partner Portal</p>
            </div>
          </div>
          <Button className="bg-violet-600 hover:bg-violet-700 text-white gap-2 text-sm"
            onClick={() => navigate("/partner/onboard")}>
            <Plus className="w-4 h-4" /> New Platform
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">My Platforms</h1>
          <p className="text-white/50 mt-1">Manage your white-label RemitFlow instances</p>
        </div>

        {tenants.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 rounded-2xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center mx-auto mb-6">
              <Building2 className="w-10 h-10 text-violet-400" />
            </div>
            <h2 className="text-white text-xl font-bold mb-2">No Platforms Yet</h2>
            <p className="text-white/50 text-sm mb-6 max-w-sm mx-auto">
              Create your first white-label remittance platform. You'll need a partner invite code to get started.
            </p>
            <Button className="bg-violet-600 hover:bg-violet-700 text-white gap-2"
              onClick={() => navigate("/partner/onboard")}>
              <Plus className="w-4 h-4" /> Create Your First Platform
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tenants.map((tenant: any) => (
              <div key={tenant.id}
                className="group relative rounded-2xl bg-white/5 border border-white/10 p-5 hover:bg-white/8 hover:border-white/20 transition-all cursor-pointer"
                onClick={() => navigate(`/tenant/${tenant.slug}/dashboard`)}>
                {/* Color accent */}
                <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl" style={{ background: tenant.primaryColor ?? "#7c3aed" }} />

                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    {tenant.logoUrl ? (
                      <img src={tenant.logoUrl} alt="logo" className="w-11 h-11 rounded-xl object-contain border border-white/10" />
                    ) : (
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-lg"
                        style={{ background: tenant.primaryColor ?? "#7c3aed" }}>
                        {tenant.brandName?.charAt(0) ?? "T"}
                      </div>
                    )}
                    <div>
                      <p className="text-white font-semibold">{tenant.brandName}</p>
                      <p className="text-white/40 text-xs">/{tenant.slug}</p>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <Badge className={`text-xs capitalize ${statusColor[tenant.status ?? "trial"]}`}>{tenant.status}</Badge>
                    <Badge className={`text-xs capitalize ${planColor[tenant.plan ?? "starter"]}`}>{tenant.plan}</Badge>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { icon: Users, label: "Members", value: "—" },
                    { icon: Globe, label: "Domain", value: tenant.customDomain ? "Custom" : "Default" },
                    { icon: Settings, label: "Role", value: tenant.role },
                  ].map(({ icon: Icon, label, value }) => (
                    <div key={label} className="rounded-lg bg-white/5 p-2.5 text-center">
                      <Icon className="w-3.5 h-3.5 text-white/40 mx-auto mb-1" />
                      <p className="text-white text-xs font-medium capitalize">{value}</p>
                      <p className="text-white/30 text-xs">{label}</p>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-white/30 text-xs">Created {new Date(tenant.createdAt).toLocaleDateString()}</span>
                  <div className="flex items-center gap-1 text-violet-400 text-xs group-hover:gap-2 transition-all">
                    Manage <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>
            ))}

            {/* Add new card */}
            <div className="rounded-2xl border border-dashed border-white/20 p-5 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-violet-500/40 hover:bg-violet-600/5 transition-all min-h-[200px]"
              onClick={() => navigate("/partner/onboard")}>
              <div className="w-11 h-11 rounded-xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center">
                <Plus className="w-5 h-5 text-violet-400" />
              </div>
              <div className="text-center">
                <p className="text-white/60 font-medium text-sm">Add New Platform</p>
                <p className="text-white/30 text-xs mt-0.5">Requires an invite code</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  

    </DashboardLayout>

  );
}
