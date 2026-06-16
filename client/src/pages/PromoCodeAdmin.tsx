import { toast } from 'sonner';
import React, { useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { trpc } from '@/lib/trpc';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { 
  Plus, 
  Search, 
  MoreHorizontal, 
  BarChart3, 
  Edit2, 
  PowerOff, 
  Calendar,
  Tag,
  ArrowRight,
  Loader2
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';

// --- Schemas ---

const promoCodeSchema = z.object({
  code: z.string().min(3, 'Code must be at least 3 characters').toUpperCase(),
  discountType: z.enum(['percentage', 'fixed']),
  discountValue: z.coerce.number().positive('Value must be positive'),
  minAmount: z.coerce.number().nonnegative('Minimum amount cannot be negative'),
  maxUses: z.coerce.number().int().positive('Max uses must be at least 1'),
  expiresAt: z.string().min(1, 'Expiry date is required'),
  description: z.string().min(5, 'Description must be at least 5 characters'),
});

type PromoCodeFormValues = z.infer<typeof promoCodeSchema>;

// --- Components ---

const PromoCodeStatsModal = ({ promoId, code }: { promoId: string; code: string }) => {
  const { data: stats, isLoading } = trpc.promoCodesAdmin.stats.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 py-4">
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-muted/50">
          <CardHeader className="pb-2">
            <CardDescription>Total Uses</CardDescription>
            <CardTitle className="text-2xl">{stats?.totalRedemptions ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-muted/50">
          <CardHeader className="pb-2">
            <CardDescription>Total Discount</CardDescription>
            <CardTitle className="text-2xl">${stats?.totalDiscountUsd?.toFixed(2) ?? '0.00'}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-muted/50">
          <CardHeader className="pb-2">
            <CardDescription>Avg. Order</CardDescription>
            <CardTitle className="text-2xl">${stats?.totalDiscountUsd?.toFixed(2) ?? '0.00'}</CardTitle>
          </CardHeader>
        </Card>
      </div>
      {/* Placeholder for a chart if needed in production */}
      <div className="h-[200px] w-full bg-muted/30 rounded-md flex items-center justify-center border border-dashed">
        <div className="text-center text-muted-foreground">
          <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-20" />
          <p className="text-sm">Usage analytics for {code}</p>
        </div>
      </div>
    </div>
  );
};

export default function PromoCodeAdmin() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingPromo, setEditingPromo] = useState<any>(null);
  const [statsPromo, setStatsPromo] = useState<{ id: string; code: string } | null>(null);

  const utils = trpc.useContext();

  // Queries
  const { data, isLoading, isError } = trpc.promoCodesAdmin.list.useQuery({
    page,
    search,
    limit: 10,
  });

  // Mutations
  const createMutation = trpc.promoCodesAdmin.create.useMutation({
    onSuccess: () => {
      toast.success('Success: Promo code created successfully');
      setIsCreateOpen(false);
      utils.promoCodesAdmin.list.invalidate();
    },
    onError: (err) => {
      toast.error("Error");
    },
  });

  const updateMutation = trpc.promoCodesAdmin.update.useMutation({
    onSuccess: () => {
      toast.success('Success: Promo code updated successfully');
      setEditingPromo(null);
      utils.promoCodesAdmin.list.invalidate();
    },
    onError: (err) => {
      toast.error("Error");
    },
  });

  const disableMutation = trpc.promoCodesAdmin.delete.useMutation({
    onSuccess: () => {
      toast.success('Success: Promo code disabled');
      utils.promoCodesAdmin.list.invalidate();
    },
    onError: (err) => {
      toast.error("Error");
    },
  });

  const form = useForm<PromoCodeFormValues>({
    resolver: zodResolver(promoCodeSchema) as any,
    defaultValues: {
      code: '',
      discountType: 'percentage',
      discountValue: 0,
      minAmount: 0,
      maxUses: 100,
      expiresAt: '',
      description: '',
    },
  });

  const onSubmit: React.FormEventHandler<HTMLFormElement> extends never ? never : (values: PromoCodeFormValues) => void = (values: PromoCodeFormValues) => {
    if (editingPromo) {
      updateMutation.mutate({ id: editingPromo.id, ...values });
    } else {
      createMutation.mutate(values);
    }
  };

  const handleEdit = (promo: any) => {
    setEditingPromo(promo);
    form.reset({
      code: promo.code,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
      minAmount: promo.minAmount,
      maxUses: promo.maxUses,
      expiresAt: format(new Date(promo.expiresAt), "yyyy-MM-dd'T'HH:mm"),
      description: promo.description,
    });
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Promo Codes</h1>
            <p className="text-muted-foreground">
              Manage discount codes and track their performance.
            </p>
          </div>
          <Dialog open={isCreateOpen || !!editingPromo} onOpenChange={(open) => {
            if (!open) {
              setIsCreateOpen(false);
              setEditingPromo(null);
              form.reset();
            }
          }}>
            <DialogTrigger asChild>
              <Button onClick={() => setIsCreateOpen(true)} className="bg-primary hover:bg-primary/90">
                <Plus className="mr-2 h-4 w-4" /> Create Promo Code
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[525px]">
              <DialogHeader>
                <DialogTitle>{editingPromo ? 'Edit Promo Code' : 'Create New Promo Code'}</DialogTitle>
                <DialogDescription>
                  Set up the discount rules and limitations for this code.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit as any)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control as any}
                      name="code"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Code</FormLabel>
                          <FormControl>
                            <Input placeholder="SUMMER20" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control as any}
                      name="discountType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Type</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="percentage">Percentage (%)</SelectItem>
                              <SelectItem value="fixed">Fixed Amount ($)</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control as any}
                      name="discountValue"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Value</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control as any}
                      name="minAmount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Min. Order Amount</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control as any}
                      name="maxUses"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Max Uses</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control as any}
                      name="expiresAt"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Expiry Date</FormLabel>
                          <FormControl>
                            <Input type="datetime-local" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control as any}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. 20% off for summer transfers" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                      {(createMutation.isPending || updateMutation.isPending) && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      {editingPromo ? 'Update' : 'Create'} Promo Code
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="border-none shadow-md bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by code..."
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-border/50 overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead className="w-[200px]">Usage</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                      </TableCell>
                    </TableRow>
                  ) : data?.items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                        No promo codes found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    data?.items.map((promo: any) => (
                      <TableRow key={promo.id} className="hover:bg-muted/30 transition-colors">
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <Tag className="h-4 w-4 text-primary" />
                            {promo.code}
                          </div>
                        </TableCell>
                        <TableCell className="capitalize">{promo.discountType}</TableCell>
                        <TableCell>
                          {promo.discountType === 'percentage' 
                            ? `${promo.discountValue}%` 
                            : `$${promo.discountValue}`}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span>{promo.totalRedemptions} / {promo.maxUses}</span>
                              <span>{Math.round((promo.totalRedemptions / promo.maxUses) * 100)}%</span>
                            </div>
                            <Progress value={(promo.totalRedemptions / promo.maxUses) * 100} className="h-1.5" />
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-sm">
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                            {format(new Date(promo.expiresAt), 'MMM d, yyyy')}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant={promo.status === 'active' ? 'default' : 'secondary'}
                            className={promo.status === 'active' ? 'bg-green-500/10 text-green-500 hover:bg-green-500/20 border-green-500/20' : ''}
                          >
                            {promo.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-[160px]">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => setStatsPromo({ id: promo.id, code: promo.code })}>
                                <BarChart3 className="mr-2 h-4 w-4" /> View Stats
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleEdit(promo)}>
                                <Edit2 className="mr-2 h-4 w-4" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                className="text-destructive focus:text-destructive"
                                onClick={() => disableMutation.mutate(promo.id)}
                                disabled={promo.status === 'disabled'}
                              >
                                <PowerOff className="mr-2 h-4 w-4" /> Disable
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            
            {/* Pagination */}
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground">
                Showing {data?.items.length ?? 0} of {data?.total ?? 0} codes
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1 || isLoading}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => p + 1)}
                  disabled={!((data?.total ?? 0) > (page * 10)) || isLoading}
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats Modal */}
        <Dialog open={!!statsPromo} onOpenChange={(open) => !open && setStatsPromo(null)}>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                Analytics: {statsPromo?.code}
              </DialogTitle>
              <DialogDescription>
                Detailed usage statistics and performance metrics for this promo code.
              </DialogDescription>
            </DialogHeader>
            {statsPromo && <PromoCodeStatsModal promoId={statsPromo.id} code={statsPromo.code} />}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStatsPromo(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}