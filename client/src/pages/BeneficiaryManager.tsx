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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { 
  Search, 
  Plus, 
  MoreHorizontal, 
  Trash2, 
  Edit2, 
  CheckCircle2, 
  AlertCircle, 
  Loader2,
  ChevronLeft,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

// --- Schemas ---

const beneficiarySchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  accountNumber: z.string().min(5, 'Account number is too short'),
  bankCode: z.string().min(2, 'Bank code is required'),
  country: z.string().length(2, 'Use 2-letter ISO country code'),
  currency: z.string().length(3, 'Use 3-letter currency code'),
  type: z.enum(['individual', 'business']),
});

type BeneficiaryFormValues = z.infer<typeof beneficiarySchema>;

// --- Component ---

export default function BeneficiaryManager() {
  const { t } = useTranslation();
  // State
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingBeneficiary, setEditingBeneficiary] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const limit = 10;

  // Queries
  const { data, isLoading, refetch } = trpc.beneficiaryCrud.list.useQuery({
    page,
    limit,
    search,
    
  });

  // Mutations
  const createMutation = trpc.beneficiaryCrud.create.useMutation({
    onSuccess: () => {
      toast.success('Beneficiary created successfully');
      setIsAddDialogOpen(false);
      refetch();
    },
    onError: (err) => toast.error(`Failed to create: ${err.message}`),
  });

  const updateMutation = trpc.beneficiaryCrud.update.useMutation({
    onSuccess: () => {
      toast.success('Beneficiary updated successfully');
      setEditingBeneficiary(null);
      refetch();
    },
    onError: (err) => toast.error(`Failed to update: ${err.message}`),
  });

  const deleteMutation = trpc.beneficiaryCrud.delete.useMutation({
    onSuccess: () => {
      toast.success('Beneficiary deleted');
      refetch();
    },
    onError: (err) => toast.error(`Failed to delete: ${err.message}`),
  });

  const verifyMutation = trpc.beneficiaryCrud.update.useMutation({
    onSuccess: () => {
      toast.success('Beneficiary verified');
      refetch();
    },
    onError: (err) => toast.error(`Verification failed: ${err.message}`),
  });

  // Form setup
  const form = useForm<BeneficiaryFormValues>({
    resolver: zodResolver(beneficiarySchema),
    defaultValues: {
      name: '',
      accountNumber: '',
      bankCode: '',
      country: '',
      currency: '',
      type: 'individual',
    },
  });

  const onSubmit = (values: BeneficiaryFormValues) => {
    if (editingBeneficiary) {
      updateMutation.mutate({ id: Number(editingBeneficiary.id), ...values });
    } else {
      createMutation.mutate(values);
    }
  };

  const handleEdit = (beneficiary: any) => {
    setEditingBeneficiary(beneficiary);
    form.reset({
      name: beneficiary.name,
      accountNumber: beneficiary.accountNumber,
      bankCode: beneficiary.bankCode,
      country: beneficiary.country,
      currency: beneficiary.currency,
      type: beneficiary.type,
    });
  };

  const handleBulkDelete = async () => {
    if (window.confirm(`Are you sure you want to delete ${selectedIds.length} beneficiaries?`)) {
      for (const id of selectedIds) {
        await deleteMutation.mutateAsync({ id: Number(id) });
      }
      setSelectedIds([]);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Beneficiaries</h1>
            <p className="text-muted-foreground">Manage your global recipients and bank accounts.</p>
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.length > 0 && (
              <Button variant="destructive" onClick={handleBulkDelete}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete ({selectedIds.length})
              </Button>
            )}
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-purple-600 hover:bg-purple-700 text-white">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Beneficiary
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[525px] bg-slate-900 text-white border-slate-800">
                <DialogHeader>
                  <DialogTitle>Add New Beneficiary</DialogTitle>
                  <DialogDescription className="text-slate-400">
                    Enter the bank details for your new recipient.
                  </DialogDescription>
                </DialogHeader>
                <BeneficiaryForm form={form} onSubmit={onSubmit} isLoading={createMutation.isPending} />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, account, or country..."
                  className="pl-10 bg-slate-950 border-slate-800 text-white"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px] bg-slate-950 border-slate-800 text-white">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-white">
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-4">
                <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
                <p className="text-muted-foreground">Loading beneficiaries...</p>
              </div>
            ) : !data?.beneficiaries || data.beneficiaries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="bg-slate-800 p-4 rounded-full mb-4">
                  <Search className="h-8 w-8 text-slate-500" />
                </div>
                <h3 className="text-lg font-medium text-white">No beneficiaries found</h3>
                <p className="text-muted-foreground max-w-xs mx-auto">
                  Try adjusting your search or filters, or add a new beneficiary to get started.
                </p>
              </div>
            ) : (
              <div className="rounded-md border border-slate-800 overflow-hidden">
                <Table>
                  <TableHeader className="bg-slate-950">
                    <TableRow className="border-slate-800 hover:bg-transparent">
                      <TableHead className="w-[50px]">
                        <input 
                          type="checkbox" 
                          className="rounded border-slate-700 bg-slate-800"
                          checked={selectedIds.length === data.beneficiaries.length}
                          onChange={() => {
                            if (selectedIds.length === data.beneficiaries.length) setSelectedIds([]);
                            else setSelectedIds(data.beneficiaries.map((i: any) => i.id));
                          }}
                        />
                      </TableHead>
                      <TableHead className="text-slate-400">Name</TableHead>
                      <TableHead className="text-slate-400">Account</TableHead>
                      <TableHead className="text-slate-400">Bank</TableHead>
                      <TableHead className="text-slate-400">Country</TableHead>
                      <TableHead className="text-slate-400">Currency</TableHead>
                      <TableHead className="text-slate-400">Status</TableHead>
                      <TableHead className="text-slate-400">Verified</TableHead>
                      <TableHead className="text-right text-slate-400">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.beneficiaries.map((item: any) => (
                      <TableRow key={item.id} className="border-slate-800 hover:bg-slate-800/30">
                        <TableCell>
                          <input 
                            type="checkbox" 
                            className="rounded border-slate-700 bg-slate-800"
                            checked={selectedIds.includes(item.id)}
                            onChange={() => toggleSelect(item.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium text-white">
                          <div className="flex flex-col">
                            <span>{item.name}</span>
                            <span className="text-xs text-muted-foreground capitalize">{item.type}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-300 font-mono text-sm">{item.accountNumber}</TableCell>
                        <TableCell className="text-slate-300">{item.bankCode}</TableCell>
                        <TableCell className="text-slate-300">{item.country}</TableCell>
                        <TableCell className="text-slate-300">{item.currency}</TableCell>
                        <TableCell>
                          <Badge 
                            variant="outline" 
                            className={
                              item.status === 'active' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
                              item.status === 'pending' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                              'bg-rose-500/10 text-rose-500 border-rose-500/20'
                            }
                          >
                            {item.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {item.isVerified ? (
                            <ShieldCheck className="h-5 w-5 text-emerald-500" />
                          ) : (
                            <AlertCircle className="h-5 w-5 text-slate-600" />
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-white">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-slate-900 border-slate-800 text-white">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => handleEdit(item)}>
                                <Edit2 className="mr-2 h-4 w-4" /> Edit
                              </DropdownMenuItem>
                              {!item.isVerified && (
                                <DropdownMenuItem onClick={() => verifyMutation.mutate({ id: Number({ id: Number(item.id) }) })}>
                                  <CheckCircle2 className="mr-2 h-4 w-4" /> Verify
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator className="bg-slate-800" />
                              <DropdownMenuItem 
                                className="text-rose-500 focus:text-rose-500"
                                onClick={() => {
                                  if (confirm('Delete this beneficiary?')) deleteMutation.mutate({ id: Number(item.id) });
                                }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Pagination */}
            {data && data.total > limit && (
              <div className="flex items-center justify-between mt-6">
                <p className="text-sm text-muted-foreground">
                  Showing {(page - 1) * limit + 1} to {Math.min(page * limit, data.total)} of {data.total}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-slate-950 border-slate-800 text-white"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-slate-950 border-slate-800 text-white"
                    onClick={() => setPage(p => p + 1)}
                    disabled={page * limit >= data.total}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Edit Dialog */}
        <Dialog open={!!editingBeneficiary} onOpenChange={(open) => !open && setEditingBeneficiary(null)}>
          <DialogContent className="sm:max-w-[525px] bg-slate-900 text-white border-slate-800">
            <DialogHeader>
              <DialogTitle>Edit Beneficiary</DialogTitle>
              <DialogDescription className="text-slate-400">
                Update the information for this recipient.
              </DialogDescription>
            </DialogHeader>
            <BeneficiaryForm 
              form={form} 
              onSubmit={onSubmit} 
              isLoading={updateMutation.isPending} 
              isEdit 
            />
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

// --- Sub-components ---

function BeneficiaryForm({ form, onSubmit, isLoading, isEdit = false }: any) {
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
        <FormField
          control={form.control as any}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full Name / Business Name</FormLabel>
              <FormControl>
                <Input {...field} className="bg-slate-950 border-slate-800" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control as any}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Type</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger className="bg-slate-950 border-slate-800">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="bg-slate-900 border-slate-800 text-white">
                    <SelectItem value="individual">Individual</SelectItem>
                    <SelectItem value="business">Business</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control as any}
            name="currency"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Currency (ISO)</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="USD" className="bg-slate-950 border-slate-800" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control as any}
          name="accountNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Account Number / IBAN</FormLabel>
              <FormControl>
                <Input {...field} className="bg-slate-950 border-slate-800" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control as any}
            name="bankCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Bank Code / SWIFT</FormLabel>
                <FormControl>
                  <Input {...field} className="bg-slate-950 border-slate-800" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control as any}
            name="country"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Country (ISO)</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="US" className="bg-slate-950 border-slate-800" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <DialogFooter className="pt-4">
          <Button 
            type="submit" 
            className="w-full bg-purple-600 hover:bg-purple-700 text-white"
            disabled={isLoading}
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? 'Update Beneficiary' : 'Add Beneficiary'}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}