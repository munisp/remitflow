import { useState, useEffect, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TrendingUp, TrendingDown, RefreshCw, Activity, Bell } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const RANGES = [
  { label: "1H", value: "1h", points: 12, intervalMs: 5 * 60 * 1000 },
  { label: "24H", value: "24h", points: 24, intervalMs: 60 * 60 * 1000 },
  { label: "7D", value: "7d", points: 28, intervalMs: 6 * 60 * 60 * 1000 },
  { label: "30D", value: "30d", points: 30, intervalMs: 24 * 60 * 60 * 1000 },
];

const CURRENCY_PAIRS = [
  "USD/NGN", "USD/KES", "USD/GHS", "USD/ZAR", "USD/TZS", "USD/UGX",
  "EUR/NGN", "EUR/USD", "GBP/USD", "GBP/NGN", "USD/EGP", "USD/MAD",
  "USD/XOF", "USD/RWF", "USD/CNY", "USD/INR", "USD/AED", "USD/SAR",
];

interface DataPoint {
  time: string;
  rate: number;
  open?: number;
  high?: number;
  low?: number;
}

interface FxRateChartProps {
  fromCurrency?: string;
  toCurrency?: string;
  className?: string;
}

function generateMockHistory(baseRate: number, points: number, intervalMs: number): DataPoint[] {
  const now = Date.now();
  const data: DataPoint[] = [];
  let rate = baseRate * 1.0; // deterministic start at base rate
  for (let i = points - 1; i >= 0; i--) {
    const ts = now - i * intervalMs;
    const change = Math.sin(i * 0.31 + baseRate * 0.001) * baseRate * 0.004; // deterministic wave
    rate = Math.max(baseRate * 0.9, Math.min(baseRate * 1.1, rate + change));
    const open = rate;
    const high = rate * (1 + Math.abs(Math.sin(i * 0.7)) * 0.003);
    const low = rate * (1 - Math.abs(Math.cos(i * 0.7)) * 0.003);
    data.push({
      time: new Date(ts).toLocaleString(undefined, {
        month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
      }),
      rate: parseFloat(rate.toFixed(4)),
      open: parseFloat(open.toFixed(4)),
      high: parseFloat(high.toFixed(4)),
      low: parseFloat(low.toFixed(4)),
    });
  }
  return data;
}

export function FxRateChart({ fromCurrency = "USD", toCurrency = "NGN", className }: FxRateChartProps) {
  const [range, setRange] = useState("24h");
  const [pair, setPair] = useState(`${fromCurrency}/${toCurrency}`);
  const [chartData, setChartData] = useState<DataPoint[]>([]);
  const [isLive, setIsLive] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertTarget, setAlertTarget] = useState("");
  const [alertDirection, setAlertDirection] = useState<"above" | "below">("above");

  const [from] = pair.split("/");
  const { data: fxRateData } = trpc.fx.liveRates.useQuery({ base: from });
  const utils = trpc.useUtils();

  const createAlert = trpc.fx.createAlert.useMutation({
    onSuccess: () => {
      toast.success(`Alert set: You'll be notified when ${pair} goes ${alertDirection} ${alertTarget}`);
      setAlertOpen(false);
      setAlertTarget("");
      utils.fx.alerts.invalidate();
    },
    onError: (err) => {
      toast.error(`Failed to set alert: ${err.message}`);
    },
  });

  const buildChart = useCallback(() => {
    const [from, to] = pair.split("/");
    const rangeConfig = RANGES.find(r => r.value === range) ?? RANGES[1];
    let baseRate = 1;
    if (fxRateData && typeof fxRateData === "object" && "rates" in fxRateData) {
      const rates = (fxRateData as any).rates as Record<string, number>;
      if (rates[to]) baseRate = rates[to];
      else if (from !== "USD" && rates["USD"] && rates[to]) {
        baseRate = rates[to] / rates[from];
      }
    } else {
      const fallback: Record<string, number> = {
        "USD/NGN": 1580, "USD/KES": 129, "USD/GHS": 15.2, "USD/ZAR": 18.5,
        "USD/TZS": 2700, "USD/UGX": 3750, "EUR/NGN": 1720, "EUR/USD": 1.09,
        "GBP/USD": 1.27, "GBP/NGN": 2005, "USD/EGP": 49.5, "USD/MAD": 10.1,
        "USD/XOF": 615, "USD/RWF": 1310, "USD/CNY": 7.24, "USD/INR": 83.5,
        "USD/AED": 3.67, "USD/SAR": 3.75,
      };
      baseRate = fallback[pair] ?? 1;
    }
    const data = generateMockHistory(baseRate, rangeConfig.points, rangeConfig.intervalMs);
    setChartData(data);
    setLastUpdated(new Date());
  }, [pair, range, fxRateData]);

  useEffect(() => { buildChart(); }, [buildChart]);

  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(() => {
      setChartData(prev => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        const change = Math.sin(Date.now() * 0.00001) * last.rate * 0.001; // deterministic wave
        const newRate = parseFloat((last.rate + change).toFixed(4));
        const newPoint: DataPoint = {
          time: new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
          rate: newRate,
        };
        setLastUpdated(new Date());
        return [...prev.slice(1), newPoint];
      });
    }, 15000);
    return () => clearInterval(interval);
  }, [isLive]);

  useEffect(() => {
    setPair(`${fromCurrency}/${toCurrency}`);
  }, [fromCurrency, toCurrency]);

  const currentRate = chartData[chartData.length - 1]?.rate ?? 0;
  const openRate = chartData[0]?.rate ?? 0;
  const change = currentRate - openRate;
  const changePct = openRate > 0 ? (change / openRate) * 100 : 0;
  const isPositive = change >= 0;
  const high = Math.max(...chartData.map(d => d.rate));
  const low = Math.min(...chartData.map(d => d.rate));

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-background border rounded-lg shadow-lg p-3 text-sm">
        <p className="font-medium mb-1">{label}</p>
        <p className="text-primary font-bold">{payload[0]?.value?.toFixed(4)} {pair.split("/")[1]}</p>
        {payload[0]?.payload?.high && (
          <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
            <p>H: {payload[0].payload.high?.toFixed(4)}</p>
            <p>L: {payload[0].payload.low?.toFixed(4)}</p>
          </div>
        )}
      </div>
    );
  };

  const handleCreateAlert = () => {
    const target = parseFloat(alertTarget);
    if (isNaN(target) || target <= 0) {
      toast.error("Invalid rate: Please enter a valid target rate");
      return;
    }
    const [fromCurr, toCurr] = pair.split("/");
    createAlert.mutate({
      fromCurrency: fromCurr,
      toCurrency: toCurr,
      targetRate: target,
      direction: alertDirection,
    });
  };

  return (
    <>
      <Card className={className}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  Live FX Rate
                </CardTitle>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-2xl font-bold">{currentRate.toFixed(4)}</span>
                  <span className="text-sm text-muted-foreground">{pair.split("/")[1]}</span>
                  <Badge className={isPositive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}>
                    {isPositive ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                    {isPositive ? "+" : ""}{changePct.toFixed(2)}%
                  </Badge>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={pair} onValueChange={setPair}>
                <SelectTrigger className="w-32 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCY_PAIRS.map(p => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex gap-1">
                {RANGES.map(r => (
                  <Button key={r.value} size="sm" variant={range === r.value ? "default" : "ghost"}
                    className="h-7 px-2 text-xs" onClick={() => setRange(r.value)}>
                    {r.label}
                  </Button>
                ))}
              </div>
              <Button size="sm" variant="ghost" className="h-7 px-2"
                onClick={() => { setIsLive(l => !l); }}
                title={isLive ? "Pause live updates" : "Resume live updates"}>
                <RefreshCw className={`h-3.5 w-3.5 ${isLive ? "animate-spin text-green-500" : "text-muted-foreground"}`} />
              </Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1"
                onClick={() => {
                  setAlertTarget(currentRate.toFixed(4));
                  setAlertOpen(true);
                }}
                title="Set price alert">
                <Bell className="h-3.5 w-3.5" />
                Set Alert
              </Button>
            </div>
          </div>

          {/* Stats row */}
          <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
            <span>H: <span className="text-foreground font-medium">{high.toFixed(4)}</span></span>
            <span>L: <span className="text-foreground font-medium">{low.toFixed(4)}</span></span>
            <span>Chg: <span className={isPositive ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
              {isPositive ? "+" : ""}{change.toFixed(4)}
            </span></span>
            <span className="ml-auto">Updated: {lastUpdated.toLocaleTimeString()}</span>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  tickFormatter={(v) => v.split(",")[1]?.trim() ?? v}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  domain={["auto", "auto"]}
                  width={55}
                  tickFormatter={(v) => v.toFixed(2)}
                />
                <Tooltip content={<CustomTooltip />} />
                {openRate > 0 && (
                  <ReferenceLine y={openRate} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeWidth={1} />
                )}
                <Line
                  type="monotone"
                  dataKey="rate"
                  stroke={isPositive ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)"}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: isPositive ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <p className="text-xs text-muted-foreground mt-2 text-center">
            Indicative rate · Not a guaranteed quote · {isLive ? "Live" : "Paused"} · 1 {pair.split("/")[0]} = {currentRate.toFixed(4)} {pair.split("/")[1]}
          </p>
        </CardContent>
      </Card>

      {/* Set Alert Dialog */}
      <Dialog open={alertOpen} onOpenChange={setAlertOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-primary" />
              Set FX Rate Alert — {pair}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Current Rate</Label>
              <p className="text-2xl font-bold">{currentRate.toFixed(4)} <span className="text-sm font-normal text-muted-foreground">{pair.split("/")[1]}</span></p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="alert-direction">Alert when rate goes</Label>
              <Select value={alertDirection} onValueChange={(v) => setAlertDirection(v as "above" | "below")}>
                <SelectTrigger id="alert-direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="above">Above target</SelectItem>
                  <SelectItem value="below">Below target</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="alert-target">Target Rate ({pair.split("/")[1]})</Label>
              <Input
                id="alert-target"
                type="number"
                step="0.0001"
                value={alertTarget}
                onChange={(e) => setAlertTarget(e.target.value)}
                placeholder={`e.g. ${(currentRate * 1.02).toFixed(4)}`}
              />
              <p className="text-xs text-muted-foreground">
                You'll receive an in-app notification when 1 {pair.split("/")[0]} = {alertTarget || "?"} {pair.split("/")[1]}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAlertOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateAlert} disabled={createAlert.isPending}>
              <Bell className="h-4 w-4 mr-2" />
              {createAlert.isPending ? "Creating..." : "Create Alert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
