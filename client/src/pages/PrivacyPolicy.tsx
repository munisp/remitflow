import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function PrivacyPolicy() {
  const { t } = useTranslation();
  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6 p-6">
        <h1 className="text-3xl font-bold">{t("legal.privacyPolicy", "Privacy Policy")}</h1>
        <p className="text-sm text-muted-foreground">{t("legal.lastUpdated", "Last Updated")}: January 15, 2026</p>
        <p className="text-muted-foreground">This Privacy Policy applies to all users of the RemitFlow platform worldwide. We comply with GDPR (EU), NDPR (Nigeria), POPIA (South Africa), PIPEDA (Canada), and other applicable data protection laws.</p>

        <Card>
          <CardHeader><CardTitle>1. Data Controller</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none space-y-3">
            <p>RemitFlow Ltd is the data controller responsible for your personal data. Our Data Protection Officer can be contacted at <a href="mailto:dpo@remitflow.com" className="text-indigo-500 hover:underline">dpo@remitflow.com</a>.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>2. Data We Collect</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none space-y-3">
            <p><strong>Identity Data:</strong> Full name, date of birth, nationality, government-issued ID (passport, national ID, driver's license), BVN/NIN (Nigeria), photographs.</p>
            <p><strong>Contact Data:</strong> Email address, phone number, residential address, proof of address documents.</p>
            <p><strong>Financial Data:</strong> Bank account details, card details (tokenized via Stripe), transaction history, wallet balances, source of funds documentation.</p>
            <p><strong>Technical Data:</strong> IP address, device fingerprint, browser type, operating system, app version, geolocation (with consent).</p>
            <p><strong>Biometric Data:</strong> Facial recognition data (for KYC liveness checks via Onfido/SumSub/Veriff), fingerprint hashes (for device authentication, stored locally only).</p>
            <p><strong>Usage Data:</strong> Pages visited, features used, transaction patterns, session duration, referral source.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>3. Legal Basis for Processing</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none space-y-3">
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Contract:</strong> Processing necessary to provide our money transfer services</li>
              <li><strong>Legal Obligation:</strong> AML/KYC compliance, tax reporting, regulatory filings (CTR, SAR, Travel Rule, PBoC LTR, SAFE declarations)</li>
              <li><strong>Legitimate Interest:</strong> Fraud prevention, platform security, service improvement</li>
              <li><strong>Consent:</strong> Marketing communications, non-essential cookies, biometric data collection</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>4. Data Sharing</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none space-y-3">
            <p>We share personal data with:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Payment Partners:</strong> Banks, mobile money operators (M-Pesa, Alipay, WeChat Pay), payment rails (Mojaloop, SWIFT, CIPS, PIX, UPI)</li>
              <li><strong>KYC Providers:</strong> Onfido, SumSub, Veriff (identity verification)</li>
              <li><strong>Compliance Partners:</strong> Sanctions screening providers, regulatory authorities (FINTRAC, FinCEN, FCA, CBN, PBoC, NFIU)</li>
              <li><strong>Infrastructure Providers:</strong> AWS (hosting), Stripe (payments), Twilio (SMS)</li>
            </ul>
            <p>We do not sell your personal data. Cross-border transfers of data are protected by Standard Contractual Clauses (SCCs) or adequacy decisions.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>5. Data Retention</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none space-y-3">
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Transaction Records:</strong> 7 years (AML regulatory requirement)</li>
              <li><strong>KYC Documents:</strong> 5 years after account closure</li>
              <li><strong>Communication Records:</strong> 3 years</li>
              <li><strong>Technical Logs:</strong> 90 days</li>
              <li><strong>Marketing Consent:</strong> Until withdrawn</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>6. Your Rights</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none space-y-3">
            <p>Subject to applicable law, you have the right to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Access:</strong> Request a copy of your personal data</li>
              <li><strong>Rectification:</strong> Correct inaccurate personal data</li>
              <li><strong>Erasure:</strong> Request deletion of your data (subject to regulatory retention requirements)</li>
              <li><strong>Portability:</strong> Receive your data in a machine-readable format</li>
              <li><strong>Restriction:</strong> Restrict processing of your data</li>
              <li><strong>Objection:</strong> Object to processing based on legitimate interest</li>
              <li><strong>Withdraw Consent:</strong> Withdraw consent at any time for consent-based processing</li>
            </ul>
            <p>To exercise these rights, visit Settings &gt; GDPR Data in the app, or email <a href="mailto:privacy@remitflow.com" className="text-indigo-500 hover:underline">privacy@remitflow.com</a>.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>7. Security</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none space-y-3">
            <p>We protect your data using:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>AES-256-GCM encryption at rest for PII (BVN, NIN, passport numbers)</li>
              <li>TLS 1.3 for all data in transit</li>
              <li>Hardware security modules (HSM) for cryptographic key management</li>
              <li>SOC 2 Type II certified infrastructure</li>
              <li>Regular penetration testing by CREST-certified firms</li>
              <li>Zero-trust network architecture with Kubernetes network policies</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>8. Cookies</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none">
            <p>We use essential cookies for authentication and security. For details on analytics and marketing cookies, see our <a href="/cookie-policy" className="text-indigo-500 hover:underline">Cookie Policy</a>.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>9. Contact</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none">
            <p>Data Protection Officer: <a href="mailto:dpo@remitflow.com" className="text-indigo-500 hover:underline">dpo@remitflow.com</a></p>
            <p>EU Representative: RemitFlow EU GmbH, Frankfurt, Germany</p>
            <p>UK ICO Registration Number: ZB123456</p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
