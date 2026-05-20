import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Briefcase, Users, Globe, Clock, DollarSign, Star, CheckCircle2,
  Send, UserCircle, MapPin, Building2, Calendar, ChevronRight, Pencil, Loader2
} from "lucide-react";
import { useTranslation } from 'react-i18next';

const EXPERTISE_OPTIONS = [
  "Fintech", "Banking", "Healthcare", "Engineering", "Education", "Law",
  "Agriculture", "Technology", "Infrastructure", "Energy", "Real Estate", "Entrepreneurship"
];

const COUNTRY_OPTIONS = [
  "Nigeria", "Kenya", "Ghana", "Rwanda", "Senegal", "Ethiopia",
  "Tanzania", "Uganda", "South Africa", "Egypt", "Morocco", "Ivory Coast"
];

const AVAILABILITY_COLORS: Record<string, string> = {
  available: "bg-emerald-100 text-emerald-700",
  limited: "bg-amber-100 text-amber-700",
  unavailable: "bg-red-100 text-red-700",
};

export default function TalentBridge() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("opportunities");
  const [applyDialog, setApplyDialog] = useState<{ open: boolean; opportunity: any | null }>({ open: false, opportunity: null });
  const [applyMessage, setApplyMessage] = useState("");
  const [profileDialog, setProfileDialog] = useState(false);
  const [profileForm, setProfileForm] = useState({
    bio: "",
    expertise: [] as string[],
    countries: [] as string[],
    availability: "available" as "available" | "limited" | "unavailable",
    hourlyRate: "",
    currency: "USD",
    linkedinUrl: "",
  });

  const { data: myProfile, refetch: refetchProfile } = trpc.talent.getProfile.useQuery();
  const { data: opportunities = [], isLoading: loadingOpp } = trpc.talent.listOpportunities.useQuery();
  const { data: experts = [], isLoading: loadingExperts } = trpc.talent.listExperts.useQuery();
  const { data: myApplications = [] } = trpc.talent.listMyBookings.useQuery();

  const upsertProfile = trpc.talent.upsertProfile.useMutation({
    onSuccess: () => {
      toast.success("Profile saved", { description: "Your TalentBridge profile has been updated." });
      refetchProfile();
      setProfileDialog(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const applyMutation = trpc.talent.applyToOpportunity.useMutation({
    onSuccess: () => {
      toast.success("Application submitted", { description: "The institution will review your application within 5 business days." });
      setApplyDialog({ open: false, opportunity: null });
      setApplyMessage("");
    },
    onError: (e) => toast.error(e.message),
  });

  function openProfileDialog() {
    if (myProfile) {
      setProfileForm({
        bio: myProfile.bio ?? "",
        expertise: myProfile.expertise ?? [],
        countries: myProfile.countries ?? [],
        availability: myProfile.availability ?? "available",
        hourlyRate: myProfile.hourlyRate ? String(myProfile.hourlyRate) : "",
        currency: myProfile.currency ?? "USD",
        linkedinUrl: myProfile.linkedinUrl ?? "",
      });
    }
    setProfileDialog(true);
  }

  function toggleExpertise(val: string) {
    setProfileForm(f => ({
      ...f,
      expertise: f.expertise.includes(val) ? f.expertise.filter(e => e !== val) : [...f.expertise, val],
    }));
  }

  function toggleCountry(val: string) {
    setProfileForm(f => ({
      ...f,
      countries: f.countries.includes(val) ? f.countries.filter(c => c !== val) : [...f.countries, val],
    }));
  }

  function saveProfile() {
    upsertProfile.mutate({
      bio: profileForm.bio || undefined,
      expertise: profileForm.expertise,
      countries: profileForm.countries,
      availability: profileForm.availability,
      hourlyRate: profileForm.hourlyRate ? parseFloat(profileForm.hourlyRate) : undefined,
      currency: profileForm.currency,
      linkedinUrl: profileForm.linkedinUrl || undefined,
    });
  }

  const engagementBadgeColor: Record<string, string> = {
    advisory: "bg-blue-100 text-blue-700",
    mentorship: "bg-purple-100 text-purple-700",
    contract: "bg-emerald-100 text-emerald-700",
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Briefcase className="w-6 h-6 text-teal-600" />
              TalentBridge
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Connect your diaspora expertise with African institutions — advisory, mentorship, and project contracts.
            </p>
          </div>
          <Button variant="outline" onClick={openProfileDialog} className="flex items-center gap-2">
            <Pencil className="w-4 h-4" />
            {myProfile ? "Edit My Profile" : "Create Expert Profile"}
          </Button>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Open Opportunities", value: opportunities.length, icon: Briefcase, color: "text-blue-600" },
            { label: "Expert Profiles", value: experts.length, icon: Users, color: "text-teal-600" },
            { label: "My Applications", value: myApplications.length, icon: Send, color: "text-purple-600" },
            { label: "Countries", value: 12, icon: Globe, color: "text-emerald-600" },
          ].map(s => (
            <Card key={s.label} className="border-border/50">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-3">
                  <s.icon className={`w-5 h-5 ${s.color}`} />
                  <div>
                    <div className="text-xl font-bold">{s.value}</div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-3 w-full max-w-md">
            <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
            <TabsTrigger value="experts">Expert Directory</TabsTrigger>
            <TabsTrigger value="my-applications">My Applications</TabsTrigger>
          </TabsList>

          {/* Opportunities Tab */}
          <TabsContent value="opportunities" className="mt-4 space-y-4">
            {loadingOpp ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading opportunities…
              </div>
            ) : opportunities.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No open opportunities at this time.</div>
            ) : (
              opportunities.map((opp: any) => (
                <Card key={opp.id} className="border-border/50 hover:border-teal-500/40 transition-colors">
                  <CardContent className="pt-5 pb-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${engagementBadgeColor[opp.engagementType] ?? "bg-gray-100 text-gray-700"}`}>
                            {opp.engagementType}
                          </span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {opp.country}
                          </span>
                          {opp.durationWeeks && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Calendar className="w-3 h-3" /> {opp.durationWeeks} weeks
                            </span>
                          )}
                        </div>
                        <h3 className="font-semibold text-foreground">{opp.title}</h3>
                        <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Building2 className="w-3.5 h-3.5" /> {opp.institutionName}
                          {opp.institutionCountry && `, ${opp.institutionCountry}`}
                        </p>
                        <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{opp.description}</p>
                        {opp.compensation && (
                          <p className="text-sm font-medium text-emerald-600 mt-2 flex items-center gap-1">
                            <DollarSign className="w-3.5 h-3.5" /> {opp.compensation}
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        className="bg-teal-600 hover:bg-teal-700 text-white shrink-0"
                        onClick={() => { setApplyDialog({ open: true, opportunity: opp }); setApplyMessage(""); }}
                      >
                        Apply <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* Expert Directory Tab */}
          <TabsContent value="experts" className="mt-4">
            {loadingExperts ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading experts…
              </div>
            ) : experts.length === 0 ? (
              <div className="text-center py-12 space-y-3">
                <UserCircle className="w-12 h-12 text-muted-foreground mx-auto" />
                <p className="text-muted-foreground">No verified expert profiles yet.</p>
                <Button variant="outline" onClick={openProfileDialog}>Create your expert profile</Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {experts.map((expert: any) => (
                  <Card key={expert.id} className="border-border/50">
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-bold text-sm shrink-0">
                          {(expert.name ?? "?")[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">{expert.name}</span>
                            {expert.verified && <CheckCircle2 className="w-4 h-4 text-teal-600" />}
                            <span className={`text-xs px-2 py-0.5 rounded-full ${AVAILABILITY_COLORS[expert.availability] ?? ""}`}>
                              {expert.availability}
                            </span>
                          </div>
                          {expert.bio && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{expert.bio}</p>}
                          <div className="flex flex-wrap gap-1 mt-2">
                            {(expert.expertise ?? []).slice(0, 4).map((e: string) => (
                              <Badge key={e} variant="secondary" className="text-xs">{e}</Badge>
                            ))}
                          </div>
                          {expert.hourlyRate && (
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                              <Clock className="w-3 h-3" /> ${expert.hourlyRate}/{expert.currency ?? "hr"}
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* My Applications Tab */}
          <TabsContent value="my-applications" className="mt-4 space-y-3">
            {myApplications.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                You have not applied to any opportunities yet.
              </div>
            ) : (
              myApplications.map((app: any) => (
                <Card key={app.id} className="border-border/50">
                  <CardContent className="pt-4 pb-3 flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium text-sm">{app.opportunityTitle}</p>
                      <p className="text-xs text-muted-foreground">{app.institutionName}</p>
                    </div>
                    <Badge
                      className={
                        app.status === "accepted" ? "bg-emerald-100 text-emerald-700" :
                        app.status === "rejected" ? "bg-red-100 text-red-700" :
                        "bg-amber-100 text-amber-700"
                      }
                    >
                      {app.status}
                    </Badge>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Apply Dialog */}
      <Dialog open={applyDialog.open} onOpenChange={o => setApplyDialog({ open: o, opportunity: applyDialog.opportunity })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Apply to Opportunity</DialogTitle>
          </DialogHeader>
          {applyDialog.opportunity && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-3 text-sm">
                <p className="font-medium">{applyDialog.opportunity.title}</p>
                <p className="text-muted-foreground">{applyDialog.opportunity.institutionName}</p>
              </div>
              <div className="space-y-2">
                <Label>Cover message (optional)</Label>
                <Textarea
                  placeholder="Briefly describe your relevant experience and why you're a strong fit for this opportunity…"
                  value={applyMessage}
                  onChange={e => setApplyMessage(e.target.value)}
                  rows={4}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApplyDialog({ open: false, opportunity: null })}>Cancel</Button>
            <Button
              className="bg-teal-600 hover:bg-teal-700 text-white"
              onClick={() => applyMutation.mutate({ opportunityId: applyDialog.opportunity!.id, message: applyMessage || "" })}
              disabled={applyMutation.isPending}
            >
              {applyMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Submitting…</> : "Submit Application"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Profile Dialog */}
      <Dialog open={profileDialog} onOpenChange={setProfileDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{myProfile ? "Edit Expert Profile" : "Create Expert Profile"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Professional Bio</Label>
              <Textarea
                placeholder="Describe your background, expertise, and what you can offer to African institutions…"
                value={profileForm.bio}
                onChange={e => setProfileForm(f => ({ ...f, bio: e.target.value }))}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Areas of Expertise (select all that apply)</Label>
              <div className="flex flex-wrap gap-2">
                {EXPERTISE_OPTIONS.map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggleExpertise(opt)}
                    className={`text-xs px-3 py-1 rounded-full border transition-colors ${profileForm.expertise.includes(opt) ? "bg-teal-600 text-white border-teal-600" : "border-border text-muted-foreground hover:border-teal-500"}`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Countries of Focus</Label>
              <div className="flex flex-wrap gap-2">
                {COUNTRY_OPTIONS.map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggleCountry(opt)}
                    className={`text-xs px-3 py-1 rounded-full border transition-colors ${profileForm.countries.includes(opt) ? "bg-blue-600 text-white border-blue-600" : "border-border text-muted-foreground hover:border-blue-500"}`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Availability</Label>
                <Select value={profileForm.availability} onValueChange={v => setProfileForm(f => ({ ...f, availability: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="available">Available</SelectItem>
                    <SelectItem value="limited">Limited</SelectItem>
                    <SelectItem value="unavailable">Unavailable</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Hourly Rate (optional)</Label>
                <Input
                  type="number"
                  placeholder="e.g. 150"
                  value={profileForm.hourlyRate}
                  onChange={e => setProfileForm(f => ({ ...f, hourlyRate: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>LinkedIn URL (optional)</Label>
              <Input
                placeholder="https://linkedin.com/in/yourprofile"
                value={profileForm.linkedinUrl}
                onChange={e => setProfileForm(f => ({ ...f, linkedinUrl: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProfileDialog(false)}>Cancel</Button>
            <Button
              className="bg-teal-600 hover:bg-teal-700 text-white"
              onClick={saveProfile}
              disabled={upsertProfile.isPending}
            >
              {upsertProfile.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Saving…</> : "Save Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
