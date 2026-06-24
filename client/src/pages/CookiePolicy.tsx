import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function CookiePolicy() {
  const { t } = useTranslation();
  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6 p-6">
        <h1 className="text-3xl font-bold">{t("legal.cookiePolicy", "Cookie Policy")}</h1>
        <p className="text-sm text-muted-foreground">{t("legal.lastUpdated", "Last Updated")}: January 15, 2026</p>

        <Card>
          <CardHeader><CardTitle>What Are Cookies</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none">
            <p>Cookies are small text files stored on your device when you visit our platform. They help us provide essential functionality, remember your preferences, and improve your experience.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Cookies We Use</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cookie</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-mono text-xs">session_id</TableCell>
                  <TableCell>Essential</TableCell>
                  <TableCell>Authentication and session management</TableCell>
                  <TableCell>Session</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">csrf-token</TableCell>
                  <TableCell>Essential</TableCell>
                  <TableCell>Cross-site request forgery protection</TableCell>
                  <TableCell>Session</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">theme</TableCell>
                  <TableCell>Functional</TableCell>
                  <TableCell>Dark/light mode preference</TableCell>
                  <TableCell>1 year</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">i18next</TableCell>
                  <TableCell>Functional</TableCell>
                  <TableCell>Language preference</TableCell>
                  <TableCell>1 year</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs">_rf_consent</TableCell>
                  <TableCell>Essential</TableCell>
                  <TableCell>Records your cookie consent choice</TableCell>
                  <TableCell>1 year</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Managing Cookies</CardTitle></CardHeader>
          <CardContent className="prose dark:prose-invert max-w-none space-y-3">
            <p>You can control cookies through your browser settings. Disabling essential cookies may prevent you from using the Platform. We do not use third-party advertising or tracking cookies.</p>
            <p>For more information about your privacy rights, see our <a href="/privacy-policy" className="text-indigo-500 hover:underline">Privacy Policy</a>.</p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
