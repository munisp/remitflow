import { useTranslation } from 'react-i18next';
import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  CheckCircle2, ArrowRight, ArrowLeft, Wallet, Shield, Send,
  User, Phone, MapPin, Banknote, Sparkles, Globe
} from "lucide-react";

const STEPS = [
  { id: 1, title: "Welcome", icon: Sparkles, description: "Let's get you set up" },
  { id: 2, title: "Profile", icon: User, description: "Complete your profile" },
  { id: 3, title: "Verify Identity", icon: Shield, description: "KYC verification" },
  { id: 4, title: "Link Bank", icon: Banknote, description: "Connect your account" },
  { id: 5, title: "First Transfer", icon: Send, description: "Send your first payment" },
  { id: 6, title: "All Done!", icon: CheckCircle2, description: "You're ready to go" },
];

export default function UserOnboarding() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("NG");
  const [address, setAddress] = useState("");
  const [dob, setDob] = useState("");
  const [idType, setIdType] = useState("national_id");
  const [idNumber, setIdNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [skipTransfer, setSkipTransfer] = useState(false);

  const completeOnboarding = trpc.userOnboarding.complete.useMutation({
    onSuccess: () => {
      setStep(6);
      // Mark all steps complete in onboardingProgress
      upsertProgress.mutate({ profileCompleted: true, kycStarted: true, kycCompleted: true, bankLinked: !!bankName, firstTransferMade: !skipTransfer });
    },
    onError: (err) => toast.error(err.message),
  });

  // Persist step-by-step progress to backend
  const upsertProgress = trpc.onboardingProgress.upsert.useMutation();

  const progress = ((step - 1) / (STEPS.length - 1)) * 100;

  const handleNext = () => {
    if (step === 2) {
      // Profile step completed
      upsertProgress.mutate({ profileCompleted: true });
    } else if (step === 3) {
      // KYC step started
      upsertProgress.mutate({ kycStarted: true });
    } else if (step === 4) {
      // Bank linked
      if (bankName) upsertProgress.mutate({ bankLinked: true });
    }
    if (step === 5) {
      completeOnboarding.mutate({
        phone,
        country,
        address,
        dateOfBirth: dob || undefined,
        idType,
        idNumber: idNumber || undefined,
        bankName: bankName || undefined,
        accountNumber: accountNumber || undefined,
      });
    } else {
      setStep(s => s + 1);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-950 via-indigo-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-violet-500/20 flex items-center justify-center mx-auto mb-2">
            <Globe className="w-6 h-6 text-violet-400" />
          </div>
          <p className="text-white/60 text-sm">RemitFlow Setup</p>
        </div>

        {/* Progress */}
        <div className="mb-6">
          <div className="flex justify-between mb-2">
            {STEPS.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.id} className={`flex flex-col items-center ${step >= s.id ? "opacity-100" : "opacity-30"}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center ${step > s.id ? "bg-green-500" : step === s.id ? "bg-violet-500" : "bg-white/10"}`}>
                    {step > s.id ? <CheckCircle2 className="w-4 h-4 text-white" /> : <Icon className="w-3 h-3 text-white" />}
                  </div>
                </div>
              );
            })}
          </div>
          <Progress value={progress} className="h-1 bg-white/10" />
        </div>

        {/* Step Card */}
        <Card className="bg-white/10 border-white/20 text-white">
          <CardContent className="pt-6 pb-6">
            {/* Step 1: Welcome */}
            {step === 1 && (
              <div className="text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-violet-500/20 flex items-center justify-center mx-auto">
                  <Sparkles className="w-8 h-8 text-violet-400" />
                </div>
                <h2 className="text-2xl font-bold">Welcome{user?.name ? `, ${user.name.split(" ")[0]}` : ""}! 👋</h2>
                <p className="text-white/70">Let's set up your RemitFlow account so you can send money globally in minutes.</p>
                <div className="grid grid-cols-3 gap-3 text-center mt-4">
                  {[
                    { icon: "⚡", label: "Fast", desc: "Instant transfers" },
                    { icon: "🔒", label: "Secure", desc: "Bank-grade security" },
                    { icon: "💸", label: "Low Fees", desc: "Best exchange rates" },
                  ].map(({ icon, label, desc }) => (
                    <div key={label} className="bg-white/5 rounded-lg p-3">
                      <div className="text-2xl mb-1">{icon}</div>
                      <p className="font-semibold text-sm">{label}</p>
                      <p className="text-xs text-white/50">{desc}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-white/40">This will take about 3 minutes</p>
              </div>
            )}

            {/* Step 2: Profile */}
            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-bold mb-1">Complete Your Profile</h2>
                  <p className="text-white/60 text-sm">We need a few details to personalize your experience</p>
                </div>
                <div>
                  <Label className="text-white/80">Phone Number *</Label>
                  <div className="flex gap-2 mt-1">
                    <Select value={country} onValueChange={setCountry}>
                      <SelectTrigger className="w-24 bg-white/10 border-white/20 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[["NG","+234"],["GH","+233"],["KE","+254"],["ZA","+27"],["GB","+44"],["US","+1"]].map(([code, dial]) => (
                          <SelectItem key={code} value={code}>{code} {dial}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      className="flex-1 bg-white/10 border-white/20 text-white placeholder:text-white/30"
                      placeholder="800 000 0000"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-white/80">Home Address</Label>
                  <Input
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/30 mt-1"
                    placeholder="123 Main Street, Lagos"
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-white/80">Date of Birth</Label>
                  <Input
                    type="date"
                    className="bg-white/10 border-white/20 text-white mt-1"
                    value={dob}
                    onChange={e => setDob(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Step 3: KYC */}
            {step === 3 && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-bold mb-1">Verify Your Identity</h2>
                  <p className="text-white/60 text-sm">Required by regulators to prevent fraud and money laundering</p>
                </div>
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                  <p className="text-blue-300 text-sm">🔒 Your documents are encrypted and stored securely. We never share them with third parties.</p>
                </div>
                <div>
                  <Label className="text-white/80">ID Type *</Label>
                  <Select value={idType} onValueChange={setIdType}>
                    <SelectTrigger className="bg-white/10 border-white/20 text-white mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="national_id">National ID</SelectItem>
                      <SelectItem value="passport">Passport</SelectItem>
                      <SelectItem value="drivers_license">Driver's License</SelectItem>
                      <SelectItem value="voters_card">Voter's Card</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-white/80">ID Number</Label>
                  <Input
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/30 mt-1"
                    placeholder="Enter your ID number"
                    value={idNumber}
                    onChange={e => setIdNumber(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {["Front of ID", "Selfie with ID"].map((label) => (
                    <label key={label} className="border-2 border-dashed border-white/20 rounded-lg p-4 text-center cursor-pointer hover:border-violet-400 transition-colors block">
                      <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { if (e.target.files?.[0]) toast.success(`${label} selected — will be verified`); }} />
                      <div className="text-2xl mb-1">📷</div>
                      <p className="text-xs text-white/60">{label}</p>
                      <p className="text-xs text-violet-400 mt-1">Tap to upload</p>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-white/40">Verification usually takes 1–2 minutes. You can continue while we verify.</p>
              </div>
            )}

            {/* Step 4: Link Bank */}
            {step === 4 && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-bold mb-1">Link Your Bank Account</h2>
                  <p className="text-white/60 text-sm">Add a bank account to fund your transfers</p>
                </div>
                <div>
                  <Label className="text-white/80">Bank Name</Label>
                  <Select value={bankName} onValueChange={setBankName}>
                    <SelectTrigger className="bg-white/10 border-white/20 text-white mt-1">
                      <SelectValue placeholder="Select your bank" />
                    </SelectTrigger>
                    <SelectContent>
                      {["Access Bank", "GTBank", "First Bank", "Zenith Bank", "UBA", "Stanbic IBTC", "FCMB", "Fidelity Bank", "Polaris Bank", "Sterling Bank"].map(b => (
                        <SelectItem key={b} value={b}>{b}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-white/80">Account Number</Label>
                  <Input
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/30 mt-1"
                    placeholder="0123456789"
                    maxLength={10}
                    value={accountNumber}
                    onChange={e => setAccountNumber(e.target.value)}
                  />
                </div>
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                  <p className="text-green-300 text-sm">✅ We use bank-grade encryption. Your credentials are never stored.</p>
                </div>
                <button className="w-full text-center text-sm text-white/50 hover:text-white/80" onClick={() => { setSkipTransfer(true); setStep(6); }}>
                  Skip for now →
                </button>
              </div>
            )}

            {/* Step 5: First Transfer */}
            {step === 5 && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-bold mb-1">Make Your First Transfer</h2>
                  <p className="text-white/60 text-sm">Try sending money to see how fast and easy it is</p>
                </div>
                <div className="bg-violet-500/10 border border-violet-500/30 rounded-lg p-4 space-y-3">
                  <div>
                    <p className="text-xs text-white/50 mb-1">You send</p>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold">$50</span>
                      <Badge className="bg-white/10">USD</Badge>
                    </div>
                  </div>
                  <div className="text-white/40 text-xs">→ Exchange rate: 1 USD = ₦1,538</div>
                  <div>
                    <p className="text-xs text-white/50 mb-1">Recipient gets</p>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold">₦76,900</span>
                      <Badge className="bg-white/10">NGN</Badge>
                    </div>
                  </div>
                  <div className="text-xs text-white/40">Fee: $1.99 · Arrives: Instantly</div>
                </div>
                <Button className="w-full bg-violet-600 hover:bg-violet-700" onClick={() => navigate("/send")}>
                  <Send className="w-4 h-4 mr-2" /> Send $50 Now
                </Button>
                <button className="w-full text-center text-sm text-white/50 hover:text-white/80" onClick={handleNext}>
                  Skip, I'll send later →
                </button>
              </div>
            )}

            {/* Step 6: Done */}
            {step === 6 && (
              <div className="text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8 text-green-400" />
                </div>
                <h2 className="text-2xl font-bold">You're all set! 🎉</h2>
                <p className="text-white/70">Your RemitFlow account is ready. Start sending money to family and friends worldwide.</p>
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <Button className="bg-violet-600 hover:bg-violet-700" onClick={() => navigate("/send")}>
                    <Send className="w-4 h-4 mr-2" /> Send Money
                  </Button>
                  <Button variant="outline" className="border-white/20 text-white hover:bg-white/10" onClick={() => navigate("/dashboard")}>
                    <Wallet className="w-4 h-4 mr-2" /> Dashboard
                  </Button>
                </div>
                <div className="bg-white/5 rounded-lg p-3 text-left">
                  <p className="text-xs text-white/50 mb-2">Quick tips:</p>
                  <ul className="text-xs text-white/70 space-y-1">
                    <li>💡 Add beneficiaries to send faster next time</li>
                    <li>📱 Enable push notifications for transfer updates</li>
                    <li>🎁 Refer friends to earn $10 per referral</li>
                  </ul>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Navigation */}
        {step < 6 && (
          <div className="flex justify-between mt-4">
            <Button
              variant="outline"
              className="border-white/20 text-white hover:bg-white/10"
              onClick={() => step > 1 ? setStep(s => s - 1) : navigate("/")}
              disabled={completeOnboarding.isPending}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              {step === 1 ? "Cancel" : "Back"}
            </Button>
            {step < 5 && (
              <Button className="bg-violet-600 hover:bg-violet-700" onClick={handleNext}>
                {step === 1 ? "Get Started" : "Continue"}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}
            {step === 5 && (
              <Button className="bg-violet-600 hover:bg-violet-700" onClick={handleNext} disabled={completeOnboarding.isPending}>
                {completeOnboarding.isPending ? "Saving..." : "Finish Setup"}
                <CheckCircle2 className="w-4 h-4 ml-2" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
