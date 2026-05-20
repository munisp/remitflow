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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Activity,
  Trash2,
  Play,
  History,
  CheckCircle2,
  XCircle,
  Loader2,
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

const EVENT_TYPES = [
  'transfer.completed',
  'transfer.failed',
  'transfer.pending',
  'kyc.approved',
  'kyc.rejected',
  'payment.failed',
  'payment.succeeded',
  'user.created',
];

interface WebhookFormValues {
  id?: string;
  url: string;
  description: string;
  secret: string;
  events: string[];
  isActive: boolean;
}

export default function WebhookAdmin() {
  const utils = trpc.useContext();
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedWebhook, setSelectedWebhook] = useState<WebhookFormValues | null>(null);
  const [logsWebhookId, setLogsWebhookId] = useState<string | null>(null);

  // Queries
  const { data: webhooks, isLoading, error } = trpc.webhooks.listEndpoints.useQuery();
  const { data: logs, isLoading: isLoadingLogs } = trpc.webhooks.listDeliveries.useQuery(
    { endpointId: Number(logsWebhookId ?? 0), limit: 20 },
    { enabled: !!logsWebhookId }
  );

  // Mutations
  const createMutation = trpc.webhooks.createEndpoint.useMutation({
    onSuccess: () => {
      toast.success('Webhook created successfully');
      setIsCreateDialogOpen(false);
      utils.webhooks.listEndpoints.invalidate();
    },
    onError: (err) => {
      toast.error("Error");
    },
  });

  const updateMutation = trpc.webhooks.updateEndpoint.useMutation({
    onSuccess: () => {
      toast.success('Webhook updated successfully');
      setSelectedWebhook(null);
      utils.webhooks.listEndpoints.invalidate();
    },
    onError: (err) => {
      toast.error("Error");
    },
  });

  const deleteMutation = trpc.webhooks.deleteEndpoint.useMutation({
    onSuccess: () => {
      toast.success('Webhook deleted successfully');
      utils.webhooks.listEndpoints.invalidate();
    },
    onError: (err) => {
      toast.error("Error");
    },
  });

  const testMutation = trpc.webhooks.rotateSecret.useMutation({
    onSuccess: () => {
      toast.success('Test payload dispatched');
    },
    onError: (err) => {
      toast.error("Test Failed");
    },
  });

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const values: WebhookFormValues = {
      url: formData.get('url') as string,
      description: formData.get('description') as string,
      secret: formData.get('secret') as string,
      events: EVENT_TYPES.filter((event) => formData.get(`event-${event}`) === 'on'),
      isActive: formData.get('isActive') === 'on',
    };

    if (selectedWebhook?.id) {
      updateMutation.mutate({ id: Number(selectedWebhook.id) as number, url: values.url, events: values.events, isActive: values.isActive, description: values.description });
    } else {
      createMutation.mutate(values);
    }
  };

  const filteredWebhooks = webhooks?.filter((w: any) =>
    w.url.toLowerCase().includes(searchQuery.toLowerCase()) ||
    w.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (error) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-[60vh]">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-destructive">Error Loading Webhooks</CardTitle>
              <CardDescription>{error.message}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => utils.webhooks.listEndpoints.invalidate()}>Retry</Button>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Webhooks</h1>
            <p className="text-muted-foreground">
              Manage outgoing webhooks for real-time event notifications.
            </p>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-purple-600 hover:bg-purple-700">
                <Plus className="mr-2 h-4 w-4" /> Create Webhook
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[525px]">
              <form onSubmit={handleSave}>
                <DialogHeader>
                  <DialogTitle>Create Webhook</DialogTitle>
                  <DialogDescription>
                    Configure a new endpoint to receive event notifications.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="url">Payload URL</Label>
                    <Input id="url" name="url" placeholder="https://api.example.com/webhook" required />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="description">Description</Label>
                    <Input id="description" name="description" placeholder="Production notifications" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="secret">Secret Token</Label>
                    <Input id="secret" name="secret" type="password" placeholder="••••••••" required />
                  </div>
                  <div className="grid gap-2">
                    <Label>Events to send</Label>
                    <div className="grid grid-cols-2 gap-2 border rounded-md p-3">
                      {EVENT_TYPES.map((event) => (
                        <div key={event} className="flex items-center space-x-2">
                          <Checkbox id={`event-${event}`} name={`event-${event}`} />
                          <label htmlFor={`event-${event}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            {event}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch id="isActive" name="isActive" defaultChecked />
                    <Label htmlFor="isActive">Active</Label>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create Webhook
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search webhooks..."
                  className="pl-8"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
              </div>
            ) : filteredWebhooks?.length === 0 ? (
              <div className="text-center py-10">
                <Activity className="mx-auto h-12 w-12 text-muted-foreground opacity-20" />
                <h3 className="mt-4 text-lg font-semibold">No webhooks found</h3>
                <p className="text-muted-foreground">Get started by creating your first webhook.</p>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>URL</TableHead>
                      <TableHead>Events</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Delivery</TableHead>
                      <TableHead>Success Rate</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredWebhooks?.map((webhook: any) => (
                      <TableRow key={webhook.id}>
                        <TableCell className="font-medium">
                          <div className="flex flex-col">
                            <span>{webhook.url}</span>
                            <span className="text-xs text-muted-foreground">{webhook.description}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {webhook.events.slice(0, 2).map((event: any) => (
                              <Badge key={event} variant="secondary" className="text-[10px]">
                                {event}
                              </Badge>
                            ))}
                            {webhook.events.length > 2 && (
                              <Badge variant="outline" className="text-[10px]">
                                +{webhook.events.length - 2}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={webhook.isActive}
                            onCheckedChange={(checked) =>
                              updateMutation.mutate({ id: Number(webhook.id), isActive: checked })
                            }
                          />
                        </TableCell>
                        <TableCell className="text-sm">
                          {webhook.lastDelivery ? format(new Date(webhook.lastDelivery), 'MMM d, HH:mm') : 'Never'}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-12 bg-secondary h-1.5 rounded-full overflow-hidden">
                              <div
                                className="bg-green-500 h-full"
                                style={{ width: `${webhook.successRate || 0}%` }}
                              />
                            </div>
                            <span className="text-xs">{webhook.successRate || 0}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => setSelectedWebhook(webhook)}>
                                <Settings2 className="mr-2 h-4 w-4" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setLogsWebhookId(webhook.id)}>
                                <History className="mr-2 h-4 w-4" /> View Logs
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => testMutation.mutate({ id: webhook.id })}>
                                <Play className="mr-2 h-4 w-4" /> Test Webhook
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => {
                                  if (confirm('Are you sure you want to delete this webhook?')) {
                                    deleteMutation.mutate({ id: webhook.id });
                                  }
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
          </CardContent>
        </Card>

        {/* Edit Dialog */}
        <Dialog open={!!selectedWebhook} onOpenChange={(open) => !open && setSelectedWebhook(null)}>
          <DialogContent className="sm:max-w-[525px]">
            <form onSubmit={handleSave}>
              <DialogHeader>
                <DialogTitle>Edit Webhook</DialogTitle>
                <DialogDescription>Update your webhook configuration.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-url">Payload URL</Label>
                  <Input
                    id="edit-url"
                    name="url"
                    defaultValue={selectedWebhook?.url}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-description">Description</Label>
                  <Input
                    id="edit-description"
                    name="description"
                    defaultValue={selectedWebhook?.description}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-secret">Secret Token</Label>
                  <Input
                    id="edit-secret"
                    name="secret"
                    type="password"
                    placeholder="Leave blank to keep current"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Events to send</Label>
                  <div className="grid grid-cols-2 gap-2 border rounded-md p-3">
                    {EVENT_TYPES.map((event) => (
                      <div key={event} className="flex items-center space-x-2">
                        <Checkbox
                          id={`edit-event-${event}`}
                          name={`event-${event}`}
                          defaultChecked={selectedWebhook?.events.includes(event)}
                        />
                        <label htmlFor={`edit-event-${event}`} className="text-sm font-medium leading-none">
                          {event}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="edit-isActive"
                    name="isActive"
                    defaultChecked={selectedWebhook?.isActive}
                  />
                  <Label htmlFor="edit-isActive">Active</Label>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Logs Drawer */}
        <Sheet open={!!logsWebhookId} onOpenChange={(open) => !open && setLogsWebhookId(null)}>
          <SheetContent className="sm:max-w-lg overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Delivery Logs</SheetTitle>
              <SheetDescription>
                Recent delivery attempts for this webhook.
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-4">
              {isLoadingLogs ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
                </div>
              ) : (logs?.deliveries?.length ?? 0) === 0 ? (
                <p className="text-center text-muted-foreground py-10">No delivery attempts yet.</p>
              ) : (
                (logs?.deliveries ?? []).map((log: any) => (
                  <div key={log.id} className="border rounded-lg p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {log.status >= 200 && log.status < 300 ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive" />
                        )}
                        <span className="font-mono text-sm font-bold">{log.status}</span>
                        <Badge variant="outline" className="text-[10px]">{log.event}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(log.timestamp), 'HH:mm:ss')}
                      </span>
                    </div>
                    <div className="text-xs bg-muted p-2 rounded font-mono overflow-x-auto">
                      <p className="font-bold mb-1">Response:</p>
                      <pre>{JSON.stringify(log.response, null, 2)}</pre>
                    </div>
                  </div>
                ))
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </DashboardLayout>
  );
}