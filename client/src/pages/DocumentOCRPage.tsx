import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, ScanLine, CheckCircle2, Clock, XCircle } from "lucide-react";

type DocType = "passport" | "national_id" | "drivers_license" | "utility_bill" | "bank_statement";

// Helper type for the extractedData Record<string, unknown>
import DashboardLayout from "@/components/DashboardLayout";
interface ExtractedData {
  documentType?: string;
  confidence?: number;
  engine?: string;
  fields?: Record<string, string>;
  rawTextPreview?: string;
  fraudIndicators?: string[];
  processingTime?: string;
  error?: string;
}

export default function DocumentOCRPage() {
  const [docUrl, setDocUrl] = useState("https://example.com/sample-passport.jpg");
  const [docType, setDocType] = useState<DocType>("passport");
  const [userId, setUserId] = useState(1);
  const [engine, setEngine] = useState<"auto" | "paddle" | "docling" | "fallback">("auto");
  const [page, setPage] = useState(0);

  const { data, isLoading, refetch } = trpc.v101.documentOCR.getDocuments.useQuery({
    limit: 20,
    offset: page * 20,
  });
  const { data: stats } = trpc.v101.documentOCR.getPipelineStats.useQuery();
  const processDoc = trpc.v101.documentOCR.processDocument.useMutation({
    onSuccess: (d) => {
      const ed = d.extractedData as ExtractedData;
      toast.success(
        `Document processed — Confidence: ${((ed.confidence ?? 0) * 100).toFixed(1)}% (${ed.engine ?? "unknown"} engine)`
      );
      void refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  // Safely typed extractedData
  const ed = (processDoc.data?.extractedData ?? {}) as ExtractedData;
  const edFields = ed.fields ?? {};
  const edFraud = ed.fraudIndicators ?? [];

  const statusIcon = (status: string) => {
    if (status === "approved" || status === "processed")
      return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    if (status === "pending") return <Clock className="w-4 h-4 text-yellow-500" />;
    return <XCircle className="w-4 h-4 text-red-500" />;
  };

  return (

    <DashboardLayout>
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Document OCR Pipeline</h1>
        <p className="text-muted-foreground">
          AI-powered document extraction using PaddleOCR, Docling, and DeepSeek VLM
        </p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: "Queued", value: stats.queued, color: "text-yellow-600" },
            { label: "Processed", value: stats.processed, color: "text-green-600" },
            { label: "Rejected", value: stats.rejected, color: "text-red-600" },
            { label: "Avg Time", value: stats.avgProcessingTime, color: "text-blue-600" },
            { label: "OCR Accuracy", value: stats.ocrAccuracy, color: "text-purple-600" },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4 text-center">
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScanLine className="w-5 h-5" />
            Process New Document
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <Label>Document URL</Label>
              <Input
                value={docUrl}
                onChange={(e) => setDocUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
            <div>
              <Label>Document Type</Label>
              <Select value={docType} onValueChange={(v) => setDocType(v as DocType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="passport">Passport</SelectItem>
                  <SelectItem value="national_id">National ID</SelectItem>
                  <SelectItem value="drivers_license">Driver's License</SelectItem>
                  <SelectItem value="utility_bill">Utility Bill</SelectItem>
                  <SelectItem value="bank_statement">Bank Statement</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>OCR Engine</Label>
              <Select value={engine} onValueChange={(v) => setEngine(v as typeof engine)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (Best Available)</SelectItem>
                  <SelectItem value="paddle">PaddleOCR</SelectItem>
                  <SelectItem value="docling">Docling</SelectItem>
                  <SelectItem value="fallback">Fallback (Regex)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>User ID</Label>
              <Input
                type="number"
                value={userId}
                onChange={(e) => setUserId(Number(e.target.value))}
              />
            </div>
          </div>
          <Button
            onClick={() =>
              processDoc.mutate({ documentUrl: docUrl, documentType: docType, userId, engine })
            }
            disabled={processDoc.isPending}
          >
            <ScanLine className="w-4 h-4 mr-2" />
            {processDoc.isPending ? "Processing..." : "Process Document"}
          </Button>

          {processDoc.data && (
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">Extraction Results</span>
                {ed.engine && (
                  <Badge variant="outline" className="text-xs">
                    Engine: {ed.engine}
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Document Type: </span>
                  <span className="font-medium">{ed.documentType ?? "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Confidence: </span>
                  <span className={`font-medium ${(ed.confidence ?? 0) >= 0.8 ? "text-green-600" : (ed.confidence ?? 0) >= 0.5 ? "text-yellow-600" : "text-red-600"}`}>
                    {((ed.confidence ?? 0) * 100).toFixed(1)}%
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Full Name: </span>
                  <span className="font-medium">{edFields.full_name ?? edFields.fullName ?? "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Doc Number: </span>
                  <span className="font-medium">{edFields.document_number ?? edFields.documentNumber ?? "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">DOB: </span>
                  <span className="font-medium">{edFields.date_of_birth ?? edFields.dateOfBirth ?? "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Expiry: </span>
                  <span className="font-medium">{edFields.expiry_date ?? edFields.expiryDate ?? "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Processing Time: </span>
                  <span className="font-medium">{ed.processingTime ?? "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Fraud Indicators: </span>
                  <span className={edFraud.length > 0 ? "font-medium text-red-600" : "font-medium text-green-600"}>
                    {edFraud.length === 0 ? "None" : edFraud.join(", ")}
                  </span>
                </div>
              </div>
              {ed.rawTextPreview && (
                <div className="mt-2">
                  <span className="text-xs text-muted-foreground">Raw Text Preview: </span>
                  <pre className="text-xs bg-background p-2 rounded mt-1 overflow-auto max-h-24">{ed.rawTextPreview}</pre>
                </div>
              )}
              {ed.error && (
                <div className="text-xs text-red-600 mt-1">Error: {ed.error}</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Document Queue
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.documents ?? []).map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-mono text-xs">{doc.id}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{doc.documentType}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {statusIcon(doc.status)}
                        <span className="capitalize text-sm">{doc.status}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {(data?.documents ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      No documents in queue
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
          {data && data.total > 20 && (
            <div className="flex justify-between items-center mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {Math.ceil(data.total / 20)}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * 20 >= data.total}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  

    </DashboardLayout>

  );
}
