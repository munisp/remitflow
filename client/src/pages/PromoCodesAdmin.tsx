import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Tag, Pencil, Trash2, Users, TrendingDown, Search, Copy, CheckCircle, XCircle } from "lucide-react";
import { useTranslation } from 'react-i18next';

export default function PromoCodesAdmin() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editPromo, setEditPromo] = useState<any>(null);
  const [redemptionsPromo, setRedemptionsPromo] = useState<any>(null);
  const [form, setForm] = useState({
    code: "", description: "", discountType: "percentage" as "percentage" | "fixed",
    discountValue: "", minTransferAmount: "0", maxDiscountAmount: "",
    usageLimit: "", perUserLimit: "1", validFrom: "", validUntil: "", corridors: "",
  });

  const { data, isLoading } = trpc.promoCodesAdmin.list.useQuery({ search, activeOnly, page, limit: 20 });
  const { data: stats } = trpc.promoCodesAdmin.stats.useQuery();
  const { data: redemptions } = trpc.promoCodesAdmin.redemptions.useQuery(
    { promoCodeId: redemptionsPromo?.id ?? 0, limit: 50 },
    { enabled: !!redemptionsPromo }
  );

  const createMutation = trpc.promoCodesAdmin.create.useMutation({
    onSuccess: () => { toast.success("Promo code created"); utils.promoCodesAdmin.list.invalidate(); utils.promoCodesAdmin.stats.invalidate(); setCreateOpen(false); resetForm(); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.promoCodesAdmin.update.useMutation({
    onSuccess: () => { toast.success("Promo code updated"); utils.promoCodesAdmin.list.invalidate(); setEditPromo(null); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.promoCodesAdmin.delete.useMutation({
    onSuccess: () => { toast.success("Promo code deleted"); utils.promoCodesAdmin.list.invalidate(); utils.promoCodesAdmin.stats.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const resetForm = () => setForm({ code: "", description: "", discountType: "percentage", discountValue: "", minTransferAmount: "0", maxDiscountAmount: "", usageLimit: "", perUserLimit: "1", validFrom: "", validUntil: "", corridors: "" });

  const handleCreate = () => {
    if (!form.code || !form.discountValue) { toast.error("Code and discount value are required"); return; }
    createMutation.mutate({
      code: form.code.toUpperCase(),
      description: form.description || undefined,
      discountType: form.discountType,
      discountValue: Number(form.discountValue),
      minTransferAmount: Number(form.minTransferAmount) || 0,
      maxDiscountAmount: form.maxDiscountAmount ? Number(form.maxDiscountAmount) : undefined,
      usageLimit: form.usageLimit ? Number(form.usageLimit) : undefined,
      perUserLimit: Number(form.perUserLimit) || 1,
      validFrom: form.validFrom || undefined,
      validUntil: form.validUntil || undefined,
      corridors: form.corridors ? form.corridors.split(",").map(c => c.trim()) : undefined,
    });
  };

  const copyCode = (code: string) => { navigator.clipboard.writeText(code); toast.success("Code copied!"); };

  const isExpired = (promo: any) => promo.validUntil && new Date(promo.validUntil) < new Date();
  const isExhausted = (promo: any) => promo.usageLimit && promo.usageCount >= promo.usageLimit;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Promo Codes</h1>
            <p className="text-muted-foreground">Manage discount codes for transaction fees</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Create Code
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Codes", value: stats?.total ?? 0, icon: Tag },
            { label: "Active", value: stats?.active ?? 0, icon: CheckCircle, color: "text-green-500" },
            { label: "Total Redemptions", value: stats?.totalRedemptions ?? 0, icon: Users },
            { label: "Total Discounts", value: `$${(stats?.totalDiscountUsd ?? 0).toFixed(2)}`, icon: TrendingDown, color: "text-orange-500" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="p-4 flex items-center gap-3">
                <Icon className={`h-8 w-8 ${color ?? "text-primary"}`} />
                <div>
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="text-xl font-bold">{value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4 flex gap-4 flex-wrap items-center">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search codes..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={activeOnly} onCheckedChange={v => { setActiveOnly(v); setPage(1); }} />
              <Label>Active only</Label>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Discount</TableHead>
                  <TableHead>Usage</TableHead>
                  <TableHead>Valid Until</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                ) : !data?.items.length ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No promo codes found</TableCell></TableRow>
                ) : data.items.map((promo: any) => (
                  <TableRow key={promo.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-primary">{promo.code}</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyCode(promo.code)}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                      {promo.description && <p className="text-xs text-muted-foreground">{promo.description}</p>}
                    </TableCell>
                    <TableCell>
                      <span className="font-semibold text-green-600">
                        {promo.discountType === "percentage" ? `${promo.discountValue}%` : `$${promo.discountValue}`}
                      </span>
                      {promo.minTransferAmount > 0 && <p className="text-xs text-muted-foreground">Min: ${promo.minTransferAmount}</p>}
                    </TableCell>
                    <TableCell>
                      <span>{promo.usageCount}{promo.usageLimit ? ` / ${promo.usageLimit}` : " / ∞"}</span>
                      <p className="text-xs text-muted-foreground">Per user: {promo.perUserLimit ?? 1}</p>
                    </TableCell>
                    <TableCell>
                      {promo.validUntil ? (
                        <span className={isExpired(promo) ? "text-red-500" : ""}>{new Date(promo.validUntil).toLocaleDateString()}</span>
                      ) : <span className="text-muted-foreground">No expiry</span>}
                    </TableCell>
                    <TableCell>
                      {isExpired(promo) ? <Badge variant="destructive">Expired</Badge>
                        : isExhausted(promo) ? <Badge variant="secondary">Exhausted</Badge>
                        : promo.isActive ? <Badge className="bg-green-500">Active</Badge>
                        : <Badge variant="outline">Inactive</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRedemptionsPromo(promo)} title="View redemptions">
                          <Users className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditPromo(promo)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => { if (confirm("Delete this promo code?")) deleteMutation.mutate({ id: promo.id }); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Pagination */}
        {data && data.total > 20 && (
          <div className="flex justify-center gap-2">
            <Button variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <span className="flex items-center text-sm text-muted-foreground">Page {page} of {Math.ceil(data.total / 20)}</span>
            <Button variant="outline" disabled={page >= Math.ceil(data.total / 20)} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        )}

        {/* Create Dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create Promo Code</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>Code *</Label>
                <Input placeholder="SAVE20" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} className="font-mono" />
              </div>
              <div className="col-span-2">
                <Label>Description</Label>
                <Input placeholder="20% off for new users" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div>
                <Label>Discount Type</Label>
                <Select value={form.discountType} onValueChange={v => setForm(f => ({ ...f, discountType: v as "percentage" | "fixed" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage (%)</SelectItem>
                    <SelectItem value="fixed">Fixed Amount ($)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Discount Value *</Label>
                <Input type="number" placeholder={form.discountType === "percentage" ? "20" : "5.00"} value={form.discountValue} onChange={e => setForm(f => ({ ...f, discountValue: e.target.value }))} />
              </div>
              <div>
                <Label>Min Transfer Amount ($)</Label>
                <Input type="number" placeholder="0" value={form.minTransferAmount} onChange={e => setForm(f => ({ ...f, minTransferAmount: e.target.value }))} />
              </div>
              <div>
                <Label>Max Discount ($)</Label>
                <Input type="number" placeholder="No limit" value={form.maxDiscountAmount} onChange={e => setForm(f => ({ ...f, maxDiscountAmount: e.target.value }))} />
              </div>
              <div>
                <Label>Usage Limit</Label>
                <Input type="number" placeholder="Unlimited" value={form.usageLimit} onChange={e => setForm(f => ({ ...f, usageLimit: e.target.value }))} />
              </div>
              <div>
                <Label>Per User Limit</Label>
                <Input type="number" placeholder="1" value={form.perUserLimit} onChange={e => setForm(f => ({ ...f, perUserLimit: e.target.value }))} />
              </div>
              <div>
                <Label>Valid From</Label>
                <Input type="datetime-local" value={form.validFrom} onChange={e => setForm(f => ({ ...f, validFrom: e.target.value }))} />
              </div>
              <div>
                <Label>Valid Until</Label>
                <Input type="datetime-local" value={form.validUntil} onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label>Corridors (comma-separated, e.g. USD-NGN,GBP-NGN)</Label>
                <Input placeholder="All corridors" value={form.corridors} onChange={e => setForm(f => ({ ...f, corridors: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending}>Create Code</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={!!editPromo} onOpenChange={v => !v && setEditPromo(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Edit Promo Code: {editPromo?.code}</DialogTitle></DialogHeader>
            {editPromo && (
              <div className="space-y-4">
                <div>
                  <Label>Description</Label>
                  <Input value={editPromo.description ?? ""} onChange={e => setEditPromo((p: any) => ({ ...p, description: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Discount Value</Label>
                    <Input type="number" value={editPromo.discountValue} onChange={e => setEditPromo((p: any) => ({ ...p, discountValue: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Usage Limit</Label>
                    <Input type="number" value={editPromo.usageLimit ?? ""} onChange={e => setEditPromo((p: any) => ({ ...p, usageLimit: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Valid Until</Label>
                    <Input type="datetime-local" value={editPromo.validUntil ? new Date(editPromo.validUntil).toISOString().slice(0, 16) : ""} onChange={e => setEditPromo((p: any) => ({ ...p, validUntil: e.target.value }))} />
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <Switch checked={editPromo.isActive} onCheckedChange={v => setEditPromo((p: any) => ({ ...p, isActive: v }))} />
                    <Label>Active</Label>
                  </div>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditPromo(null)}>Cancel</Button>
              <Button onClick={() => updateMutation.mutate({ id: editPromo.id, description: editPromo.description, discountValue: Number(editPromo.discountValue), usageLimit: editPromo.usageLimit ? Number(editPromo.usageLimit) : undefined, validUntil: editPromo.validUntil, isActive: editPromo.isActive })} disabled={updateMutation.isPending}>Save Changes</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Redemptions Dialog */}
        <Dialog open={!!redemptionsPromo} onOpenChange={v => !v && setRedemptionsPromo(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Redemptions for {redemptionsPromo?.code}</DialogTitle></DialogHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Discount</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!redemptions?.length ? (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-4">No redemptions yet</TableCell></TableRow>
                ) : redemptions.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell><div className="font-medium">{r.userName ?? "Unknown"}</div><div className="text-xs text-muted-foreground">{r.userEmail}</div></TableCell>
                    <TableCell className="text-green-600 font-semibold">-${Number(r.discountApplied).toFixed(2)} {r.currency}</TableCell>
                    <TableCell>{new Date(r.redeemedAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
