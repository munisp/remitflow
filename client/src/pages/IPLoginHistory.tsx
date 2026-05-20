import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Shield, MapPin, AlertTriangle, CheckCircle, Ban } from "lucide-react";

const RISK_COLORS: Record<string, string> = {
  low: "text-green-500",
  medium: "text-yellow-500",
  high: "text-red-500",
};

export default function IPLoginHistory() {

  const { data: history, refetch } = trpc.v98.ipLogin.getHistory.useQuery({ limit: 50 });
  const { data: suspicious } = trpc.v98.ipLogin.getSuspicious.useQuery({ limit: 20 });

  const blockIp = trpc.v98.ipLogin.blockIp.useMutation({
    onSuccess: (d) => {
      toast.success(d.message);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">IP Login History</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Track login attempts, detect suspicious IPs, and manage blocks
        </p>
      </div>

      {/* Suspicious Logins Alert */}
      {suspicious && suspicious.length > 0 && (
        <Card className="border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-4 w-4" />
              Suspicious Login Activity ({suspicious.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {suspicious.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between p-2 bg-white dark:bg-red-950/50 rounded border border-red-200 dark:border-red-800">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium font-mono">{s.ipAddress}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.failedAttempts} failed attempts · User #{s.userId} · {new Date(s.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="destructive" className="text-xs capitalize">{s.riskLevel}</Badge>
                    {!s.isBlocked && (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs"
                        onClick={() => blockIp.mutate({ ipAddress: s.ipAddress, reason: "Suspicious login activity" })}
                        disabled={blockIp.isPending}
                      >
                        <Ban className="h-3 w-3 mr-1" />
                        Block
                      </Button>
                    )}
                    {s.isBlocked && (
                      <Badge variant="outline" className="text-xs text-red-500 border-red-500">Blocked</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Login History Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Recent Login Attempts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!history?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle className="h-10 w-10 mx-auto mb-2 opacity-30 text-green-500" />
              <p>No login history recorded yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-3">IP Address</th>
                    <th className="text-left pr-3">User</th>
                    <th className="text-left pr-3">Country</th>
                    <th className="text-left pr-3">Result</th>
                    <th className="text-left pr-3">Risk</th>
                    <th className="text-right pr-3">Attempts</th>
                    <th className="text-left">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry: any) => (
                    <tr key={entry.id} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="py-2 pr-3 font-mono text-xs">
                        <div className="flex items-center gap-1">
                          {entry.isBlocked && <Ban className="h-3 w-3 text-red-500" />}
                          {entry.ipAddress}
                        </div>
                      </td>
                      <td className="pr-3 text-xs">User #{entry.userId}</td>
                      <td className="pr-3 text-xs">
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3 w-3 text-muted-foreground" />
                          {entry.country ?? "Unknown"}
                        </div>
                      </td>
                      <td className="pr-3">
                        <Badge
                          variant={entry.loginSuccess ? "default" : "destructive"}
                          className="text-xs"
                        >
                          {entry.loginSuccess ? "Success" : "Failed"}
                        </Badge>
                      </td>
                      <td className="pr-3">
                        <span className={`text-xs font-medium capitalize ${RISK_COLORS[entry.riskLevel] ?? ""}`}>
                          {entry.riskLevel}
                        </span>
                      </td>
                      <td className="text-right pr-3 text-xs">{entry.failedAttempts}</td>
                      <td className="text-xs text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
