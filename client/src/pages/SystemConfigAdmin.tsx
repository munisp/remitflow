import React, { useState, useMemo } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { trpc } from '@/lib/trpc';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { 
  Plus, 
  Search, 
  Download, 
  Trash2, 
  Edit2, 
  Eye, 
  EyeOff, 
  History, 
  Settings,
  ShieldCheck,
  Bell,
  TrendingUp,
  Sliders
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface ConfigEntry {
  key: string;
  value: string;
  description: string;
  isSecret: boolean;
  updatedAt: string;
}

const CONFIG_GROUPS = [
  { id: 'ALL', label: 'All Configs', icon: Settings, prefix: '' },
  { id: 'FX', label: 'FX Rates', icon: TrendingUp, prefix: 'FX_' },
  { id: 'COMPLIANCE', label: 'Compliance', icon: ShieldCheck, prefix: 'COMPLIANCE_' },
  { id: 'LIMITS', label: 'Limits', icon: Sliders, prefix: 'LIMITS_' },
  { id: 'NOTIFICATIONS', label: 'Notifications', icon: Bell, prefix: 'NOTIFICATIONS_' },
];

export default function SystemConfigAdmin() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('ALL');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  
  // Form state for new config
  const [newConfig, setNewConfig] = useState({
    key: '',
    value: '',
    description: '',
    isSecret: false,
  });

  const utils = trpc.useContext();
  const { data: configs, isLoading, error } = trpc.systemConfig.list.useQuery();
  
  const setMutation = trpc.systemConfig.set.useMutation({
    onSuccess: () => {
      toast.success('Configuration updated successfully');
      utils.systemConfig.list.invalidate();
      setIsAddDialogOpen(false);
      setEditingKey(null);
      setNewConfig({ key: '', value: '', description: '', isSecret: false });
    },
    onError: (err) => {
      toast.error(`Failed to update configuration: ${err.message}`);
    },
  });

  const hotReloadMutation = trpc.systemConfigHotReload.reloadAll.useMutation({
    onSuccess: () => { utils.systemConfig.list.invalidate(); },
  });
  const deleteMutation = trpc.systemConfig.delete.useMutation({
    onSuccess: () => {
      toast.success('Configuration deleted');
      utils.systemConfig.list.invalidate();
    },
    onError: (err) => {
      toast.error(`Failed to delete: ${err.message}`);
    },
  });

  const filteredConfigs = useMemo(() => {
    if (!configs) return [];
    let result = configs;
    
    // Filter by tab/prefix
    const currentGroup = CONFIG_GROUPS.find(g => g.id === activeTab);
    if (currentGroup && currentGroup.prefix) {
      result = result.filter(c => c.key.startsWith(currentGroup.prefix));
    }
    
    // Filter by search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(c => 
        c.key.toLowerCase().includes(query) || 
        c.description.toLowerCase().includes(query)
      );
    }
    
    return result;
  }, [configs, activeTab, searchQuery]);

  const handleExport = () => {
    const dataStr = JSON.stringify(configs, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `system_config_${format(new Date(), 'yyyy-MM-dd')}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    toast.success('Configuration exported to JSON');
  };

  const handleAddConfig = (e: React.FormEvent) => {
    e.preventDefault();
    setMutation.mutate(newConfig);
  };

  const handleInlineEdit = (config: ConfigEntry) => {
    setEditingKey(config.key);
    setEditValue(config.value);
  };

  const saveInlineEdit = (config: ConfigEntry) => {
    if (editValue === config.value) {
      setEditingKey(null);
      return;
    }
    setMutation.mutate({
      key: config.key,
      value: editValue,
      description: config.description,
      isSecret: config.isSecret,
    });
  };

  if (error) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-[60vh]">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-destructive">Error Loading Config</CardTitle>
              <CardDescription>{error.message}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => utils.systemConfig.list.invalidate()}>Retry</Button>
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
            <h1 className="text-3xl font-bold tracking-tight">System Configuration</h1>
            <p className="text-muted-foreground">Manage platform-wide settings, FX rates, and compliance limits.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => hotReloadMutation.mutate()} disabled={hotReloadMutation.isPending}>
              {hotReloadMutation.isPending ? 'Reloading...' : '🔄 Hot Reload'}
            </Button>
            <Button variant="outline" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              Export JSON
            </Button>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-purple-600 hover:bg-purple-700">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Config
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <form onSubmit={handleAddConfig}>
                  <DialogHeader>
                    <DialogTitle>Add New Configuration</DialogTitle>
                    <DialogDescription>
                      Create a new system-wide configuration entry.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="key">Key (e.g. FX_USD_EUR)</Label>
                      <Input 
                        id="key" 
                        value={newConfig.key} 
                        onChange={(e) => setNewConfig({...newConfig, key: e.target.value.toUpperCase()})}
                        placeholder="PREFIX_KEY_NAME"
                        required
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="value">Value</Label>
                      <Input 
                        id="value" 
                        value={newConfig.value} 
                        onChange={(e) => setNewConfig({...newConfig, value: e.target.value})}
                        required
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="description">Description</Label>
                      <Textarea 
                        id="description" 
                        value={newConfig.description} 
                        onChange={(e) => setNewConfig({...newConfig, description: e.target.value})}
                        placeholder="What is this config for?"
                      />
                    </div>
                    <div className="flex items-center space-x-2">
                      <Switch 
                        id="isSecret" 
                        checked={newConfig.isSecret}
                        onCheckedChange={(checked) => setNewConfig({...newConfig, isSecret: checked})}
                      />
                      <Label htmlFor="isSecret">Mask value (Secret)</Label>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={setMutation.isPending}>
                      {setMutation.isPending ? 'Saving...' : 'Save Configuration'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3 space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="relative w-full max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search keys or descriptions..."
                      className="pl-8"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="ALL" onValueChange={setActiveTab}>
                  <TabsList className="mb-4 bg-muted/50">
                    {CONFIG_GROUPS.map((group) => (
                      <TabsTrigger key={group.id} value={group.id} className="flex items-center gap-2">
                        <group.icon className="h-4 w-4" />
                        <span className="hidden sm:inline">{group.label}</span>
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[250px]">Key</TableHead>
                          <TableHead>Value</TableHead>
                          <TableHead className="hidden md:table-cell">Description</TableHead>
                          <TableHead className="hidden lg:table-cell">Last Modified</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {isLoading ? (
                          <TableRow>
                            <TableCell colSpan={5} className="h-24 text-center">
                              Loading configurations...
                            </TableCell>
                          </TableRow>
                        ) : filteredConfigs.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="h-24 text-center">
                              No configurations found.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredConfigs.map((config) => (
                            <TableRow key={config.key} className="group">
                              <TableCell className="font-mono text-sm font-medium">
                                {config.key}
                                {config.isSecret && (
                                  <Badge variant="outline" className="ml-2 text-[10px] uppercase py-0">Secret</Badge>
                                )}
                              </TableCell>
                              <TableCell onDoubleClick={() => handleInlineEdit(config)}>
                                {editingKey === config.key ? (
                                  <div className="flex items-center gap-2">
                                    <Input 
                                      size={1}
                                      className="h-8 text-sm"
                                      value={editValue}
                                      onChange={(e) => setEditValue(e.target.value)}
                                      onBlur={() => saveInlineEdit(config)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') saveInlineEdit(config);
                                        if (e.key === 'Escape') setEditingKey(null);
                                      }}
                                      autoFocus
                                    />
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2 cursor-pointer group-hover:text-purple-400 transition-colors">
                                    <span className="font-mono text-sm">
                                      {config.isSecret ? '••••••••' : config.value}
                                    </span>
                                    <Edit2 className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-[200px] truncate">
                                {config.description}
                              </TableCell>
                              <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                                {format(new Date(config.updatedAt), 'MMM d, HH:mm')}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-8 w-8"
                                    onClick={() => handleInlineEdit(config)}
                                  >
                                    <Edit2 className="h-4 w-4" />
                                  </Button>
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                    onClick={() => {
                                      if (confirm(`Are you sure you want to delete ${config.key}?`)) {
                                        deleteMutation.mutate({ key: config.key });
                                      }
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <History className="h-5 w-5 text-purple-500" />
                  Audit Trail
                </CardTitle>
                <CardDescription>Recent configuration changes</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Mock audit trail as per spec requirement */}
                  {[
                    { user: 'admin_jane', action: 'Updated', key: 'FX_USD_EUR', time: '2 mins ago' },
                    { user: 'system', action: 'Created', key: 'LIMITS_DAILY_MAX', time: '1 hour ago' },
                    { user: 'admin_bob', action: 'Deleted', key: 'OLD_TEST_KEY', time: '3 hours ago' },
                    { user: 'admin_jane', action: 'Updated', key: 'NOTIFICATIONS_EMAIL', time: '5 hours ago' },
                  ].map((log, i) => (
                    <div key={i} className="flex flex-col gap-1 border-l-2 border-purple-500/30 pl-3 pb-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-purple-400">{log.user}</span>
                        <span className="text-muted-foreground">{log.time}</span>
                      </div>
                      <p className="text-sm">
                        <span className="text-muted-foreground">{log.action}</span>{' '}
                        <code className="bg-muted px-1 rounded text-[11px]">{log.key}</code>
                      </p>
                    </div>
                  ))}
                </div>
                <Button variant="link" className="w-full mt-4 text-xs text-purple-400">
                  View Full Audit Log
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-purple-900/10 border-purple-500/20">
              <CardHeader>
                <CardTitle className="text-sm font-medium">Quick Tips</CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-2 text-muted-foreground">
                <p>• Double-click any value to edit it inline.</p>
                <p>• Use prefixes like <code className="text-purple-400">FX_</code> to group settings.</p>
                <p>• Secret values are masked in the UI and encrypted at rest.</p>
                <p>• Changes take effect immediately across all services.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}