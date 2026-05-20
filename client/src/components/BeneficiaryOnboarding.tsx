/**
 * BeneficiaryOnboarding — quick-start modal for first-time users.
 * Shown on the Dashboard when the user has no beneficiaries saved.
 * Guides them to add their first recipient so the second transfer takes < 10 seconds.
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Users, ArrowRight, CheckCircle, Zap } from "lucide-react";

const COUNTRIES = [
  "Nigeria", "Ghana", "Kenya", "Senegal", "Cameroon",
  "South Africa", "Uganda", "Tanzania", "UK", "USA", "Canada", "Germany",
];

const CURRENCIES = ["NGN", "GHS", "KES", "XOF", "XAF", "ZAR", "UGX", "TZS", "GBP", "USD", "EUR", "CAD"];

interface BeneficiaryOnboardingProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function BeneficiaryOnboarding({ open, onClose, onSuccess }: BeneficiaryOnboardingProps) {
  const [step, setStep] = useState<"intro" | "form" | "done">("intro");
  const [form, setForm] = useState({
    name: "",
    accountNumber: "",
    bankName: "",
    country: "Nigeria",
    currency: "NGN",
    phone: "",
    relationship: "Family",
  });

  const utils = trpc.useUtils();
  const addMutation = trpc.beneficiaries.add.useMutation({
    onSuccess: () => {
      utils.beneficiaries.list.invalidate();
      setStep("done");
    },
    onError: (err) => {
      toast.error(err.message || "Could not save recipient. Please try again.");
    },
  });

  const handleSubmit = () => {
    if (!form.name.trim()) { toast.error("Please enter the recipient's name."); return; }
    if (!form.accountNumber.trim()) { toast.error("Please enter an account number or phone."); return; }
    addMutation.mutate({
      name: form.name.trim(),
      accountNumber: form.accountNumber.trim(),
      bankName: form.bankName.trim() || undefined,
      country: form.country,
      currency: form.currency,
      phone: form.phone.trim() || undefined,
    });
  };

  const handleClose = () => {
    setStep("intro");
    setForm({ name: "", accountNumber: "", bankName: "", country: "Nigeria", currency: "NGN", phone: "", relationship: "Family" });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        {step === "intro" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <Users className="h-6 w-6 text-primary" />
                Save your first recipient
              </DialogTitle>
              <DialogDescription className="text-base leading-relaxed pt-1">
                Add a recipient once and every future transfer takes under 10 seconds.
                No re-typing bank details. No delays.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              {[
                { icon: Zap, text: "Instant transfers — just pick a name and enter an amount" },
                { icon: CheckCircle, text: "Saved securely — encrypted and never shared" },
                { icon: ArrowRight, text: "Send to multiple recipients in one batch payment" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-start gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <p className="text-sm text-muted-foreground pt-1.5">{text}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={handleClose}>
                Maybe later
              </Button>
              <Button className="flex-1 gap-2" onClick={() => setStep("form")}>
                Add a recipient <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}

        {step === "form" && (
          <>
            <DialogHeader>
              <DialogTitle>Add recipient details</DialogTitle>
              <DialogDescription>
                This takes about 30 seconds. You will never need to enter these details again.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Full name *</Label>
                <Input
                  placeholder="e.g. Mama Ngozi Okafor"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Country</Label>
                  <Select value={form.country} onValueChange={v => setForm(f => ({ ...f, country: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Currency</Label>
                  <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Bank account number or mobile money *</Label>
                <Input
                  placeholder="e.g. 0123456789 or +2348012345678"
                  value={form.accountNumber}
                  onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Bank name <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input
                  placeholder="e.g. GTBank, OPay, M-Pesa"
                  value={form.bankName}
                  onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Phone number <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input
                  placeholder="+234 801 234 5678"
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep("intro")}>
                Back
              </Button>
              <Button
                className="flex-1"
                disabled={addMutation.isPending}
                onClick={handleSubmit}
              >
                {addMutation.isPending ? "Saving..." : "Save recipient"}
              </Button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <CheckCircle className="h-6 w-6 text-emerald-500" />
                Recipient saved!
              </DialogTitle>
              <DialogDescription className="text-base pt-1">
                <strong>{form.name}</strong> has been added to your recipients.
                Your next transfer to them will take under 10 seconds.
              </DialogDescription>
            </DialogHeader>

            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-800">
              <p className="font-medium mb-1">What happens next?</p>
              <p>Head to <strong>Send Money</strong>, pick <strong>{form.name}</strong> from your recipients list, enter the amount, and confirm. Done.</p>
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={handleClose}>
                Close
              </Button>
              <Button className="flex-1 gap-2" onClick={() => { handleClose(); onSuccess?.(); }}>
                Send money now <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
