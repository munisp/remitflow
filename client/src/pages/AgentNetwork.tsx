import { useTranslation } from 'react-i18next';
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { MapPin, Search, Plus, Phone, Mail, Clock, Users, Building2, Edit, Trash2 } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

const COUNTRIES = ["NG","KE","GH","TZ","UG","SN","CM","ZA","GB","US"];
const COUNTRY_NAMES: Record<string, string> = { NG:"Nigeria",KE:"Kenya",GH:"Ghana",TZ:"Tanzania",UG:"Uganda",SN:"Senegal",CM:"Cameroon",ZA:"South Africa",GB:"United Kingdom",US:"United States" };

export default function AgentNetwork() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState<string | undefined>();
  const [status, setStatus] = useState<"active"|"inactive"|"suspended"|undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [editAgent, setEditAgent] = useState<any>(null);
  const [form, setForm] = useState({ name:"", country:"NG", city:"", address:"", phone:"", email:"", operatingHours:"9:00-17:00", dailyLimit:5000 });

  const { data, refetch } = trpc.agentNetworkExt.list.useQuery(search || country || status ? { search: search || undefined, country: country || undefined, status: (status as any) || undefined, limit: 50, offset: 0 } : undefined);
  const { data: stats } = trpc.agentNetworkExt.stats.useQuery();
  const createMutation = trpc.agentNetworkExt.create.useMutation({
    onSuccess: () => { toast.success("Agent created"); setCreateOpen(false); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.agentNetworkExt.update.useMutation({
    onSuccess: () => { toast.success("Agent updated"); setEditAgent(null); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.agentNetworkExt.delete.useMutation({
    onSuccess: () => { toast.success("Agent removed"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const statusColor: Record<string, string> = { active:"bg-green-100 text-green-800", inactive:"bg-gray-100 text-gray-800", suspended:"bg-red-100 text-red-800" };

  return (

    <DashboardLayout>
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-100 rounded-lg"><MapPin className="h-6 w-6 text-orange-600" /></div>
          <div>
            <h1 className="text-2xl font-bold">Agent Network</h1>
            <p className="text-muted-foreground">Find cash-in/cash-out agents near you</p>
          </div>
        </div>
        {isAdmin && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Add Agent</Button></DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Add New Agent</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                {[["name","Agent Name"],["city","City"],["address","Address"],["phone","Phone"],["email","Email (optional)"],["operatingHours","Operating Hours"]].map(([key,label]) => (
                  <div key={key} className={key === "address" ? "col-span-2" : ""}>
                    <Label>{label}</Label>
                    <Input className="mt-1" value={(form as any)[key]} onChange={e => setForm(f => ({...f,[key]:e.target.value}))} />
                  </div>
                ))}
                <div>
                  <Label>Country</Label>
                  <Select value={form.country} onValueChange={v => setForm(f => ({...f,country:v}))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{COUNTRIES.map(c => <SelectItem key={c} value={c}>{COUNTRY_NAMES[c]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Daily Limit (USD)</Label>
                  <Input type="number" className="mt-1" value={form.dailyLimit} onChange={e => setForm(f => ({...f,dailyLimit:Number(e.target.value)}))} />
                </div>
              </div>
              <Button className="w-full mt-2" disabled={createMutation.isPending || !form.name || !form.city}
                onClick={() => createMutation.mutate(form as any)}>
                {createMutation.isPending ? "Creating..." : "Create Agent"}
              </Button>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold">{stats.total}</div><div className="text-sm text-muted-foreground">Total Agents</div></CardContent></Card>
          {(stats.byStatus as any[]).map((s: any) => (
            <Card key={s.status}><CardContent className="p-4 text-center"><div className="text-2xl font-bold">{s.cnt}</div><div className="text-sm text-muted-foreground capitalize">{s.status}</div></CardContent></Card>
          ))}
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search agents..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={country ?? "all"} onValueChange={v => setCountry(v === "all" ? undefined : v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All Countries" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Countries</SelectItem>
            {COUNTRIES.map(c => <SelectItem key={c} value={c}>{COUNTRY_NAMES[c]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status ?? "all"} onValueChange={v => setStatus(v === "all" ? undefined : v as any)}>
          <SelectTrigger className="w-36"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {!(data as any)?.agents?.length ? (
          <div className="col-span-3 text-center py-12 text-muted-foreground">No agents found matching your criteria.</div>
        ) : ((data as any)?.agents ?? []).map((agent: any) => (
          <Card key={agent.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex justify-between items-start mb-2">
                <div className="font-semibold">{agent.name}</div>
                <Badge className={statusColor[agent.status] ?? "bg-gray-100 text-gray-800"}>{agent.status}</Badge>
              </div>
              <div className="space-y-1 text-sm text-muted-foreground">
                <div className="flex items-center gap-1"><MapPin className="h-3 w-3" />{agent.city}, {COUNTRY_NAMES[agent.country] ?? agent.country}</div>
                <div className="flex items-center gap-1"><Building2 className="h-3 w-3" />{agent.address}</div>
                <div className="flex items-center gap-1"><Phone className="h-3 w-3" />{agent.phone}</div>
                {agent.email && <div className="flex items-center gap-1"><Mail className="h-3 w-3" />{agent.email}</div>}
                <div className="flex items-center gap-1"><Clock className="h-3 w-3" />{agent.operating_hours}</div>
                <div className="flex items-center gap-1"><Users className="h-3 w-3" />Daily limit: ${agent.daily_limit?.toLocaleString()}</div>
              </div>
              {isAdmin && (
                <div className="flex gap-2 mt-3">
                  <Button size="sm" variant="outline" onClick={() => setEditAgent(agent)}><Edit className="h-3 w-3 mr-1" />Edit</Button>
                  <Button size="sm" variant="outline" className="text-red-600" onClick={() => { if(confirm("Remove this agent?")) deleteMutation.mutate({ id: agent.id }); }}><Trash2 className="h-3 w-3 mr-1" />Remove</Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {editAgent && (
        <Dialog open={!!editAgent} onOpenChange={() => setEditAgent(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit Agent: {editAgent.name}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              {[["name","Name"],["phone","Phone"],["email","Email"]].map(([key,label]) => (
                <div key={key}>
                  <Label>{label}</Label>
                  <Input className="mt-1" defaultValue={editAgent[key]} onChange={e => setEditAgent((a: any) => ({...a,[key]:e.target.value}))} />
                </div>
              ))}
              <div>
                <Label>Status</Label>
                <Select defaultValue={editAgent.status} onValueChange={v => setEditAgent((a: any) => ({...a,status:v}))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full" disabled={updateMutation.isPending}
                onClick={() => updateMutation.mutate({ id: editAgent.id, name: editAgent.name, status: editAgent.status, phone: editAgent.phone, email: editAgent.email })}>
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  

    </DashboardLayout>

  );
}
