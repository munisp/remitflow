import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function TermsOfService() {
  const { t } = useTranslation();
  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6 p-6">
        <h1 className="text-3xl font-bold">{t("legal.termsOfService", "Terms of Service")}</h1>
        <p className="text-sm text-muted-foreground">{t("legal.lastUpdated", "Last Updated")}: January 15, 2026</p>

        <Card>
          <CardHeader><CardTitle>1. Introduction</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none space-y-3">
            <p>Welcome to RemitFlow ("we", "our", "us"). These Terms of Service ("Terms") govern your use of the RemitFlow platform, including our website, mobile applications (iOS and Android), APIs, and all related services (collectively, the "Platform").</p>
            <p>By accessing or using the Platform, you agree to be bound by these Terms. If you do not agree, you must not use the Platform.</p>
            <p>RemitFlow is operated by RemitFlow Ltd, a company registered in England and Wales, authorized by the Financial Conduct Authority (FCA) as a Payment Institution, and registered as a Money Services Business (MSB) with FINTRAC (Canada) and FinCEN (United States).</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>2. Eligibility</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none space-y-3">
            <p>To use the Platform, you must:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Be at least 18 years of age (or the age of majority in your jurisdiction)</li>
              <li>Be a resident of a country where RemitFlow operates</li>
              <li>Complete identity verification (KYC) as required by applicable regulations</li>
              <li>Not be subject to any sanctions, embargoes, or restrictions under applicable law</li>
              <li>Not have been previously suspended or terminated from the Platform</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>3. Account Registration and KYC</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none space-y-3">
            <p>You must register for an account and complete our Know Your Customer (KYC) verification process. We offer three tiers of verification:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Tier 1 (Basic):</strong> Email and phone verification. Daily limit: $500, monthly limit: $2,000.</li>
              <li><strong>Tier 2 (Standard):</strong> Government-issued ID and proof of address. Daily limit: $5,000, monthly limit: $20,000.</li>
              <li><strong>Tier 3 (Enhanced):</strong> Additional documentation and source of funds verification. Daily limit: $50,000, monthly limit: $200,000.</li>
            </ul>
            <p>You are responsible for maintaining the accuracy of your account information. We reserve the right to suspend accounts with outdated or incorrect information.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>4. Services</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none space-y-3">
            <p>RemitFlow provides the following services:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Cross-border money transfers via multiple payment rails (Mojaloop, SWIFT, CIPS, PIX, UPI, SEPA)</li>
              <li>Multi-currency wallet management</li>
              <li>Foreign exchange services at competitive rates</li>
              <li>Bill payment and airtime top-up services</li>
              <li>Savings goals and financial planning tools</li>
              <li>Business payment services (batch payments, recurring transfers)</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>5. Fees and Exchange Rates</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none space-y-3">
            <p>Our fees are transparently displayed before you confirm any transaction. Fees vary by corridor, payment rail, and transfer amount. Exchange rates are provided in real-time and may fluctuate between quote and execution unless you use our Rate Lock feature.</p>
            <p>We reserve the right to modify our fee structure with 30 days' notice to users.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>6. Anti-Money Laundering and Compliance</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none space-y-3">
            <p>We comply with all applicable anti-money laundering (AML), counter-terrorism financing (CTF), and sanctions regulations, including but not limited to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>UK Money Laundering Regulations 2017</li>
              <li>US Bank Secrecy Act and FinCEN regulations</li>
              <li>Canada Proceeds of Crime (Money Laundering) and Terrorist Financing Act</li>
              <li>Nigeria Money Laundering (Prevention and Prohibition) Act</li>
              <li>EU Anti-Money Laundering Directives</li>
              <li>FATF Recommendations and Travel Rule requirements</li>
            </ul>
            <p>We automatically file Currency Transaction Reports (CTR), Suspicious Activity Reports (SAR), and other regulatory reports as required. Transactions may be delayed, frozen, or declined for compliance reasons.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>7. Prohibited Activities</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none space-y-3">
            <p>You may not use the Platform for:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Money laundering, terrorist financing, or other illegal activities</li>
              <li>Transactions involving sanctioned countries, entities, or individuals</li>
              <li>Structuring transactions to avoid reporting thresholds</li>
              <li>Fraud, identity theft, or impersonation</li>
              <li>Circumventing our security measures or KYC requirements</li>
              <li>Any activity that violates applicable laws or regulations</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>8. Limitation of Liability</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none space-y-3">
            <p>To the maximum extent permitted by law, RemitFlow shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Platform. Our total liability shall not exceed the fees paid by you in the 12 months preceding the claim.</p>
            <p>We are not liable for delays or failures caused by payment rail providers, banking partners, regulatory actions, or force majeure events.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>9. Governing Law and Dispute Resolution</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none space-y-3">
            <p>These Terms are governed by the laws of England and Wales. Any disputes shall be resolved through binding arbitration administered by the London Court of International Arbitration (LCIA), except where prohibited by local consumer protection laws.</p>
            <p>For users in Nigeria, disputes may alternatively be resolved through the CBN Consumer Protection Framework. For users in the EU, you retain the right to bring proceedings in your local courts.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>10. Contact</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none">
            <p>For questions about these Terms, contact us at: <a href="mailto:legal@remitflow.com" className="text-indigo-500 hover:underline">legal@remitflow.com</a></p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
