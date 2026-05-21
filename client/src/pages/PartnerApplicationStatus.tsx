import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Clock, XCircle, AlertCircle, FileText, Send, Building2 } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';

const STATUS_CONFIG: Record<string, { color: string; icon: any; label: string; description: string }> = {
  draft: { color: "bg-gray-500/20 text-gray-300 border-gray-500/30", icon: FileText, label: "Draft", description: "Application not yet submitted" },
  submitted: { color: "bg-blue-500/20 text-blue-300 border-blue-500/30", icon: Clock, label: "Submitted", description: "Your application is in our review queue" },
  under_review: { color: "bg-amber-500/20 text-amber-300 border-amber-500/30", icon: AlertCircle, label: "Under Review", description: "Our team is actively reviewing your application" },
  additional_info_required: { color: "bg-orange-500/20 text-orange-300 border-orange-500/30", icon: AlertCircle, label: "Info Required", description: "We need more information from you" },
  approved: { color: "bg-green-500/20 text-green-300 border-green-500/30", icon: CheckCircle2, label: "Approved", description: "Congratulations! Your application has been approved" },
  rejected: { color: "bg-red-500/20 text-red-300 border-red-500/30", icon: XCircle, label: "Rejected", description: "Your application was not approved at this time" },
  suspended: { color: "bg-red-500/20 text-red-300 border-red-500/30", icon: XCircle, label: "Suspended", description: "Your partner account has been suspended" },
};

const TIMELINE_STEPS = [
  { key: "submitted", label: "Application Submitted" },
  { key: "under_review", label: "Under Review" },
  { key: "approved", label: "Approved" },
];

export default function PartnerApplicationStatus() {
  const { t } = useTranslation();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [additionalInfo, setAdditionalInfo] = useState("");

  const { data: app, isLoading, refetch } = trpc.partnerApplications.checkStatus.useQuery(
    { slug: slug! },
    { enabled: !!slug, retry: false }
  );

  const provideInfoMutation = trpc.partnerApplications.provideAdditionalInfo.useMutation({
    onSuccess: () => {
      toast.success("Additional information submitted!");
      setAdditionalInfo("");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-950 via-indigo-950 to-slate-900 flex items-center justify-center">
        <div className="text-white/60">Loading application status...</div>
      </div>
    );
  }

  if (!app) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-950 via-indigo-950 to-slate-900 flex items-center justify-center p-4">
        <Card className="max-w-md w-full bg-white/10 border-white/20 text-white text-center">
          <CardContent className="pt-8 pb-8">
            <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Application Not Found</h2>
            <p className="text-white/60">No application found with reference: <span className="font-mono text-violet-300">{slug}</span></p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[app.status] ?? STATUS_CONFIG.submitted;
  const StatusIcon = statusConfig.icon;

  const currentStepIndex = TIMELINE_STEPS.findIndex(s => s.key === app.status);
  const timelineIndex = app.status === "approved" ? 2 : app.status === "under_review" ? 1 : 0;

  return (

    <DashboardLayout>
    <div className="min-h-screen bg-gradient-to-br from-violet-950 via-indigo-950 to-slate-900 p-4">
      <div className="max-w-2xl mx-auto pt-8">
        {/* Header */}
        <div className="text-center mb-8">
          <Badge className="bg-violet-500/20 text-violet-300 border-violet-500/30 mb-4">Partner Application</Badge>
          <h1 className="text-2xl font-bold text-white mb-1">{app.company_name}</h1>
          <p className="text-white/50 font-mono text-sm">{app.slug}</p>
        </div>

        {/* Status Card */}
        <Card className="bg-white/10 border-white/20 text-white mb-6">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center ${statusConfig.color.split(" ").slice(0, 1).join(" ")}`}>
                <StatusIcon className="w-7 h-7" />
              </div>
              <div>
                <Badge className={statusConfig.color}>{statusConfig.label}</Badge>
                <p className="text-white/70 text-sm mt-1">{statusConfig.description}</p>
              </div>
            </div>

            {/* Timeline */}
            <div className="flex items-center mt-6 mb-2">
              {TIMELINE_STEPS.map((step, i) => (
                <div key={step.key} className="flex items-center flex-1">
                  <div className="flex flex-col items-center">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i <= timelineIndex ? "bg-violet-500 text-white" : "bg-white/10 text-white/30"}`}>
                      {i < timelineIndex ? <CheckCircle2 className="w-3 h-3" /> : i + 1}
                    </div>
                    <span className="text-[10px] text-white/50 mt-1 text-center">{step.label}</span>
                  </div>
                  {i < TIMELINE_STEPS.length - 1 && (
                    <div className={`h-px flex-1 mx-1 ${i < timelineIndex ? "bg-violet-500" : "bg-white/10"}`} />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Application Details */}
        <Card className="bg-white/10 border-white/20 text-white mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="w-4 h-4 text-violet-400" />
              Application Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ["Brand Name", app.brand_name],
                ["Plan Requested", (app.requested_plan as string)?.replace("_", " ")],
                ["Submitted", app.submitted_at ? new Date(app.submitted_at).toLocaleDateString() : "—"],
                ["Last Updated", app.reviewed_at ? new Date(app.reviewed_at).toLocaleDateString() : "—"],
              ].map(([label, value]) => (
                <div key={label} className="bg-white/5 rounded p-2">
                  <p className="text-white/40 text-xs">{label}</p>
                  <p className="text-white font-medium capitalize">{value ?? "—"}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Additional Info Required */}
        {app.status === "additional_info_required" && app.additional_info_request && (
          <Card className="bg-orange-500/10 border-orange-500/30 text-white mb-6">
            <CardHeader>
              <CardTitle className="text-base text-orange-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Additional Information Required
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-white/80 text-sm mb-4">{app.additional_info_request}</p>
              <Textarea
                className="bg-white/10 border-white/20 text-white placeholder:text-white/30 mb-3"
                placeholder="Provide the requested information here..."
                value={additionalInfo}
                onChange={e => setAdditionalInfo(e.target.value)}
                rows={4}
              />
              <Button
                className="bg-orange-600 hover:bg-orange-700 w-full"
                onClick={() => provideInfoMutation.mutate({ applicationId: app.id, response: additionalInfo })}
                disabled={!additionalInfo.trim() || provideInfoMutation.isPending}
              >
                <Send className="w-4 h-4 mr-2" />
                {provideInfoMutation.isPending ? "Submitting..." : "Submit Additional Information"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Rejection Reason */}
        {app.status === "rejected" && app.rejection_reason && (
          <Card className="bg-red-500/10 border-red-500/30 text-white mb-6">
            <CardHeader>
              <CardTitle className="text-base text-red-300">Rejection Reason</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-white/80 text-sm">{app.rejection_reason}</p>
              <p className="text-white/50 text-xs mt-3">You may reapply after addressing the issues mentioned above. Contact us at partners@remitflow.com for assistance.</p>
            </CardContent>
          </Card>
        )}

        {/* Approved - Next Steps */}
        {app.status === "approved" && (
          <Card className="bg-green-500/10 border-green-500/30 text-white mb-6">
            <CardHeader>
              <CardTitle className="text-base text-green-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Next Steps
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-white/80 text-sm">Your application has been approved! Here's what to do next:</p>
              <ol className="list-decimal list-inside text-sm text-white/70 space-y-2">
                <li>Check your email for your invite code and onboarding instructions</li>
                <li>Sign the Partner SLA Agreement</li>
                <li>Upload required compliance documents</li>
                <li>Configure your white-label branding</li>
                <li>Generate your API keys and start integrating</li>
              </ol>
              <Button className="w-full bg-green-600 hover:bg-green-700 mt-2" onClick={() => window.location.href = "/partner/onboard"}>
                Start Partner Onboarding
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  

    </DashboardLayout>

  );
}
