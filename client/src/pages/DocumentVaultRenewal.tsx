import { toast } from 'sonner';
import React, { useState, useMemo } from 'react';
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
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Upload,
  Calendar as CalendarIcon,
  History,
  Archive,
  ChevronRight,
  ChevronLeft,
  FileText,
} from 'lucide-react';
import { format, differenceInDays, isPast, addDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

// --- Types ---
type Document = {
  id: string;
  name: string;
  type: string;
  status: 'expired' | 'expiring_soon' | 'active';
  expiryDate: string;
  fileUrl: string;
  fileSize: number;
};

type RenewalHistory = {
  id: string;
  documentId: string;
  action: 'renewed' | 'archived';
  timestamp: string;
  details: string;
};

// --- Helper Components ---

const UrgencyBadge = ({ expiryDate }: { expiryDate: string }) => {
  const date = new Date(expiryDate);
  const daysRemaining = differenceInDays(date, new Date());
  const expired = isPast(date);

  if (expired) {
    return (
      <Badge variant="destructive" className="bg-red-600 hover:bg-red-700">
        Expired
      </Badge>
    );
  }

  if (daysRemaining < 7) {
    return (
      <Badge variant="outline" className="border-orange-500 text-orange-500 bg-orange-500/10">
        Expiring in {daysRemaining}d
      </Badge>
    );
  }

  if (daysRemaining < 30) {
    return (
      <Badge variant="outline" className="border-yellow-500 text-yellow-500 bg-yellow-500/10">
        Expiring in {daysRemaining}d
      </Badge>
    );
  }

  return <Badge variant="secondary">Active</Badge>;
};

const StepIndicator = ({ currentStep }: { currentStep: number }) => {
  const steps = [
    'Select Document',
    'Upload New Version',
    'Set Expiry Date',
    'Confirm & Archive',
  ];

  return (
    <div className="flex items-center justify-between mb-8">
      {steps.map((step, index) => (
        <React.Fragment key={step}>
          <div className="flex flex-col items-center gap-2">
            <div
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors",
                currentStep === index + 1
                  ? "border-primary bg-primary text-primary-foreground"
                  : currentStep > index + 1
                  ? "border-primary bg-primary/20 text-primary"
                  : "border-muted bg-muted/50 text-muted-foreground"
              )}
            >
              {currentStep > index + 1 ? (
                <CheckCircle2 className="w-6 h-6" />
              ) : (
                <span>{index + 1}</span>
              )}
            </div>
            <span className={cn(
              "text-xs font-medium",
              currentStep === index + 1 ? "text-primary" : "text-muted-foreground"
            )}>
              {step}
            </span>
          </div>
          {index < steps.length - 1 && (
            <div className={cn(
              "h-[2px] flex-1 mx-4 mb-6",
              currentStep > index + 1 ? "bg-primary" : "bg-muted"
            )} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

// --- Main Component ---

export default function DocumentVaultRenewal() {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [newFile, setNewFile] = useState<{ name: string; size: number; type: string; url: string } | null>(null);
  const [newDocumentId, setNewDocumentId] = useState<number>(0);
  const [newExpiryDate, setNewExpiryDate] = useState<string>('');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyDocId, setHistoryDocId] = useState<string | null>(null);

  // tRPC Queries
  const { data: documents, isLoading, refetch } = trpc.documentVault.list.useQuery();

  const { data: history, isLoading: isLoadingHistory } = trpc.documentVaultRenewal.listMyRenewals.useQuery();

  // tRPC Mutations
  const renewMutation = trpc.documentVaultRenewal.initiateRenewal.useMutation({
    onSuccess: () => {
      toast.success("Document Renewed: The document has been successfully updated and the old version archived.");
      resetWorkflow();
      refetch();
    },
    onError: (error) => {
      toast.error("Renewal Failed: " + error.message);
    },
  });

  const archiveMutation = trpc.documentVault.delete.useMutation({
    onSuccess: () => {
      toast.success("Document Archived: The document has been moved to the archive.");
      refetch();
    },
  });

  const resetWorkflow = () => {
    setCurrentStep(1);
    setSelectedDoc(null);
    setNewFile(null);
    setNewExpiryDate('');
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      // In a real app, we would upload the file here and get a URL
      setNewFile({
        name: file.name,
        size: file.size,
        type: file.type,
        url: URL.createObjectURL(file),
      });
    }
  };

  const handleRenew = () => {
    if (selectedDoc && newFile && newExpiryDate) {
      renewMutation.mutate({ documentId: Number(selectedDoc.id) });
    }
  };

  const handleArchive = (id: string) => {
    if (confirm('Are you sure you want to archive this document?')) {
      archiveMutation.mutate({ documentId: Number(selectedDoc?.id ?? id) } as any);
    }
  };

  const openHistory = (id: string) => {
    setHistoryDocId(id);
    setIsHistoryOpen(true);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl mx-auto">
        {/* Header Section */}
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Document Renewal</h1>
            <p className="text-muted-foreground">
              Manage expired and expiring documents in your vault.
            </p>
          </div>
          <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Clock className="w-4 h-4 mr-2" />}
            Refresh List
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Workflow Card */}
          <Card className="lg:col-span-2 bg-card/50 border-primary/20 backdrop-blur-sm">
            <CardHeader>
              <CardTitle>Renewal Workflow</CardTitle>
              <CardDescription>Follow the steps to renew your documents.</CardDescription>
            </CardHeader>
            <CardContent>
              <StepIndicator currentStep={currentStep} />

              {/* Step 1: Select Document */}
              {currentStep === 1 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-medium">Select a document to renew</h3>
                  </div>
                  {isLoading ? (
                    <div className="flex justify-center py-12">
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    </div>
                  ) : documents && documents.length > 0 ? (
                    <div className="border rounded-md overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Document Name</TableHead>
                            <TableHead>Expiry Date</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {documents.map((doc: any) => (
                            <TableRow 
                              key={doc.id} 
                              className={cn(
                                "cursor-pointer transition-colors",
                                selectedDoc?.id === doc.id ? "bg-primary/10" : "hover:bg-muted/50"
                              )}
                              onClick={() => setSelectedDoc(doc)}
                            >
                              <TableCell className="font-medium">
                                <div className="flex items-center gap-2">
                                  <FileText className="w-4 h-4 text-primary" />
                                  {doc.name}
                                </div>
                              </TableCell>
                              <TableCell>{format(new Date(doc.expiryDate), 'MMM dd, yyyy')}</TableCell>
                              <TableCell>
                                <UrgencyBadge expiryDate={doc.expiryDate} />
                              </TableCell>
                              <TableCell className="text-right">
                                <Button 
                                  variant={selectedDoc?.id === doc.id ? "default" : "ghost"} 
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedDoc(doc);
                                  }}
                                >
                                  Select
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="text-center py-12 border-2 border-dashed rounded-lg">
                      <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
                      <h3 className="text-lg font-medium">All caught up!</h3>
                      <p className="text-muted-foreground">No documents require immediate renewal.</p>
                    </div>
                  )}
                  <div className="flex justify-end mt-6">
                    <Button 
                      disabled={!selectedDoc} 
                      onClick={() => setCurrentStep(2)}
                    >
                      Next Step <ChevronRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 2: Upload New Version */}
              {currentStep === 2 && (
                <div className="space-y-6">
                  <div className="flex items-center gap-4 p-4 bg-primary/5 rounded-lg border border-primary/20">
                    <div className="p-2 bg-primary/10 rounded-full">
                      <FileText className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Renewing Document:</p>
                      <p className="text-lg font-bold">{selectedDoc?.name}</p>
                    </div>
                  </div>

                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleFileDrop}
                    className={cn(
                      "border-2 border-dashed rounded-xl p-12 text-center transition-all",
                      newFile ? "border-green-500 bg-green-500/5" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-primary/5"
                    )}
                  >
                    {newFile ? (
                      <div className="space-y-4">
                        <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
                          <CheckCircle2 className="w-8 h-8 text-green-500" />
                        </div>
                        <div>
                          <p className="font-medium text-lg">{newFile.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {(newFile.size / 1024 / 1024).toFixed(2)} MB • {newFile.type}
                          </p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setNewFile(null)}>
                          Replace File
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                          <Upload className="w-8 h-8 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium text-lg">Drag and drop your new document version</p>
                          <p className="text-sm text-muted-foreground">or click to browse files (PDF, JPG, PNG up to 10MB)</p>
                        </div>
                        <Input
                          type="file"
                          className="hidden"
                          id="file-upload"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              setNewFile({
                                name: file.name,
                                size: file.size,
                                type: file.type,
                                url: URL.createObjectURL(file),
                              });
                            }
                          }}
                        />
                        <Button asChild variant="secondary">
                          <label htmlFor="file-upload" className="cursor-pointer">
                            Select File
                          </label>
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between mt-6">
                    <Button variant="ghost" onClick={() => setCurrentStep(1)}>
                      <ChevronLeft className="w-4 h-4 mr-2" /> Back
                    </Button>
                    <Button disabled={!newFile} onClick={() => setCurrentStep(3)}>
                      Next Step <ChevronRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 3: Set Expiry Date */}
              {currentStep === 3 && (
                <div className="space-y-6">
                  <div className="flex items-center gap-4 p-4 bg-primary/5 rounded-lg border border-primary/20">
                    <div className="p-2 bg-primary/10 rounded-full">
                      <CalendarIcon className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">New Version:</p>
                      <p className="text-lg font-bold">{newFile?.name}</p>
                    </div>
                  </div>

                  <div className="space-y-4 max-w-md mx-auto">
                    <label className="text-sm font-medium">New Expiry Date</label>
                    <div className="flex gap-4">
                      <Input
                        type="date"
                        value={newExpiryDate}
                        onChange={(e) => setNewExpiryDate(e.target.value)}
                        min={format(new Date(), 'yyyy-MM-dd')}
                        className="flex-1"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setNewExpiryDate(format(addDays(new Date(), 180), 'yyyy-MM-dd'))}
                      >
                        + 6 Months
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setNewExpiryDate(format(addDays(new Date(), 365), 'yyyy-MM-dd'))}
                      >
                        + 1 Year
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Setting a clear expiry date helps us notify you before the document becomes invalid.
                    </p>
                  </div>

                  <div className="flex justify-between mt-6">
                    <Button variant="ghost" onClick={() => setCurrentStep(2)}>
                      <ChevronLeft className="w-4 h-4 mr-2" /> Back
                    </Button>
                    <Button disabled={!newExpiryDate} onClick={() => setCurrentStep(4)}>
                      Next Step <ChevronRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 4: Confirm and Archive */}
              {currentStep === 4 && (
                <div className="space-y-6">
                  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 flex gap-3">
                    <AlertCircle className="w-5 h-5 text-yellow-500 shrink-0" />
                    <p className="text-sm text-yellow-200/80">
                      Confirming this renewal will upload the new version and automatically archive the current version of <strong>{selectedDoc?.name}</strong>.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Current Version</p>
                      <div className="p-4 rounded-lg border bg-muted/30">
                        <p className="font-medium truncate">{selectedDoc?.name}</p>
                        <p className="text-xs text-muted-foreground">Expired: {selectedDoc && format(new Date(selectedDoc.expiryDate), 'MMM dd, yyyy')}</p>
                        <Badge variant="outline" className="mt-2">To be Archived</Badge>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-wider text-primary font-semibold">New Version</p>
                      <div className="p-4 rounded-lg border border-primary/30 bg-primary/5">
                        <p className="font-medium truncate">{newFile?.name}</p>
                        <p className="text-xs text-primary/80">Expires: {newExpiryDate && format(new Date(newExpiryDate), 'MMM dd, yyyy')}</p>
                        <Badge className="mt-2 bg-primary">New Active</Badge>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between mt-6">
                    <Button variant="ghost" onClick={() => setCurrentStep(3)}>
                      <ChevronLeft className="w-4 h-4 mr-2" /> Back
                    </Button>
                    <Button 
                      className="bg-primary hover:bg-primary/90"
                      onClick={handleRenew}
                      disabled={renewMutation.isPending}
                    >
                      {renewMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                      )}
                      Confirm Renewal
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sidebar: Quick Actions & History */}
          <div className="space-y-6">
            <Card className="bg-card/50 border-primary/20">
              <CardHeader>
                <CardTitle className="text-lg">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button 
                  variant="outline" 
                  className="w-full justify-start" 
                  onClick={() => resetWorkflow()}
                >
                  <Clock className="w-4 h-4 mr-2" /> Reset Workflow
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start text-red-400 hover:text-red-300 hover:bg-red-400/10"
                  disabled={!selectedDoc}
                  onClick={() => selectedDoc && handleArchive(selectedDoc.id)}
                >
                  <Archive className="w-4 h-4 mr-2" /> Archive Selected
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start"
                  disabled={!selectedDoc}
                  onClick={() => selectedDoc && openHistory(selectedDoc.id)}
                >
                  <History className="w-4 h-4 mr-2" /> View History
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-primary/20">
              <CardHeader>
                <CardTitle className="text-lg">Renewal Tips</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-3">
                <div className="flex gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  <p>Ensure the new document is clear and all text is legible.</p>
                </div>
                <div className="flex gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  <p>The file size should not exceed 10MB.</p>
                </div>
                <div className="flex gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  <p>Double-check the expiry date against the physical document.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* History Dialog */}
        <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Renewal History</DialogTitle>
              <DialogDescription>
                Timeline of actions for this document.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              {isLoadingHistory ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : history && history.length > 0 ? (
                <div className="space-y-6 relative before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-muted">
                  {history.map((item: any) => (
                    <div key={item.id} className="relative pl-8">
                      <div className={cn(
                        "absolute left-0 top-1 w-5 h-5 rounded-full border-2 bg-background flex items-center justify-center",
                        item.action === 'renewed' ? "border-primary" : "border-muted-foreground"
                      )}>
                        <div className={cn(
                          "w-2 h-2 rounded-full",
                          item.action === 'renewed' ? "bg-primary" : "bg-muted-foreground"
                        )} />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{item.details}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(item.timestamp), 'MMM dd, yyyy HH:mm')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No history found for this document.
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => setIsHistoryOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}