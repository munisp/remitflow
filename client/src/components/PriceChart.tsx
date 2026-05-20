/**
 * PriceChart — sparkline + candlestick chart for investment assets.
 * Uses recharts (already installed). Supports 7d / 30d / 90d range selection.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  BarChart,
  Bar,
  ComposedChart,
  Line,
} from "recharts";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, BarChart2, Activity } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface PricePoint {
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string | null;
  timestamp: Date | string;
}

interface PriceChartProps {
  symbol: string;
  currentPrice: number;
  /** compact = small sparkline only (for asset cards) */
  compact?: boolean;
  className?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(v: number) {
  if (v >= 1000) return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
  if (v >= 1) return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 8 }).format(v);
}

function fmtDate(ts: Date | string, compact = false) {
  const d = new Date(ts);
  if (compact) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

const RANGE_LIMITS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

// ─── Custom Candlestick Bar ───────────────────────────────────────────────────
function CandlestickBar(props: any) {
  const { x, y, width, height, open, close, high, low, index } = props;
  if (!open || !close) return null;
  const isUp = Number(close) >= Number(open);
  const color = isUp ? "#10b981" : "#ef4444";
  const bodyTop = Math.min(y, y + height);
  const bodyH = Math.abs(height) || 1;
  const midX = x + width / 2;
  return (
    <g key={`candle-${index}`}>
      {/* Wick */}
      <line x1={midX} y1={props.highY} x2={midX} y2={props.lowY} stroke={color} strokeWidth={1} />
      {/* Body */}
      <rect x={x + 1} y={bodyTop} width={Math.max(width - 2, 1)} height={bodyH} fill={color} opacity={0.85} />
    </g>
  );
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const isUp = Number(d.close) >= Number(d.open);
  return (
    <div className="rounded-lg bg-slate-800 border border-slate-600 p-3 text-xs shadow-xl min-w-[160px]">
      <p className="text-slate-400 mb-2">{fmtDate(d.timestamp)}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">Open</span>
          <span className="text-white">{fmt(Number(d.open))}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">High</span>
          <span className="text-emerald-400">{fmt(Number(d.high))}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">Low</span>
          <span className="text-red-400">{fmt(Number(d.low))}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">Close</span>
          <span className={`font-semibold ${isUp ? "text-emerald-400" : "text-red-400"}`}>{fmt(Number(d.close))}</span>
        </div>
        {d.volume && (
          <div className="flex justify-between gap-4 border-t border-slate-700 pt-1 mt-1">
            <span className="text-slate-400">Volume</span>
            <span className="text-slate-300">{Number(d.volume).toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sparkline (compact inline chart) ────────────────────────────────────────
export function Sparkline({ symbol, currentPrice }: { symbol: string; currentPrice: number }) {
  const { data = [] } = trpc.investment.getPriceHistory.useQuery(
    { symbol, interval: "1d", limit: 30 },
    { staleTime: 5 * 60 * 1000 }
  );

  const points = useMemo(() =>
    data.map(d => ({ close: Number(d.close), timestamp: d.timestamp })),
    [data]
  );

  if (points.length < 2) {
    return <div className="h-12 w-full bg-slate-800/50 rounded animate-pulse" />;
  }

  const first = points[0].close;
  const last = points[points.length - 1].close;
  const isUp = last >= first;
  const color = isUp ? "#10b981" : "#ef4444";
  const pct = ((last - first) / first) * 100;

  return (
    <div className="flex items-center gap-2">
      <div className="h-12 w-24 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
            <defs>
              <linearGradient id={`sg-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="close"
              stroke={color}
              strokeWidth={1.5}
              fill={`url(#sg-${symbol})`}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <span className={`text-xs font-medium ${isUp ? "text-emerald-400" : "text-red-400"}`}>
        {isUp ? "+" : ""}{pct.toFixed(2)}%
      </span>
    </div>
  );
}

// ─── Full Price Chart ─────────────────────────────────────────────────────────
export default function PriceChart({ symbol, currentPrice, compact = false, className = "" }: PriceChartProps) {
  const [range, setRange] = useState<"7d" | "30d" | "90d">("30d");
  const [chartType, setChartType] = useState<"area" | "candle">("area");

  const limit = RANGE_LIMITS[range];
  const { data = [], isLoading } = trpc.investment.getPriceHistory.useQuery(
    { symbol, interval: "1d", limit },
    { staleTime: 5 * 60 * 1000 }
  );

  const points = useMemo(() =>
    data.map(d => ({
      open: Number(d.open),
      high: Number(d.high),
      low: Number(d.low),
      close: Number(d.close),
      volume: d.volume ? Number(d.volume) : 0,
      timestamp: d.timestamp,
      label: fmtDate(d.timestamp, true),
    })),
    [data]
  );

  const firstClose = points[0]?.close ?? currentPrice;
  const lastClose = points[points.length - 1]?.close ?? currentPrice;
  const isUp = lastClose >= firstClose;
  const pct = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;
  const color = isUp ? "#10b981" : "#ef4444";
  const minClose = Math.min(...points.map(p => p.low));
  const maxClose = Math.max(...points.map(p => p.high));
  const padding = (maxClose - minClose) * 0.08;

  if (compact) {
    return (
      <div className={`h-16 w-full ${className}`}>
        {isLoading ? (
          <div className="h-full w-full bg-slate-800/50 rounded animate-pulse" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
              <defs>
                <linearGradient id={`cg-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="close" stroke={color} strokeWidth={2} fill={`url(#cg-${symbol})`} dot={false} isAnimationActive={false} />
              <Tooltip content={<ChartTooltip />} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-1 text-sm font-medium ${isUp ? "text-emerald-400" : "text-red-400"}`}>
            {isUp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            {isUp ? "+" : ""}{pct.toFixed(2)}% ({range})
          </span>
          <span className="text-xs text-slate-500">{points.length} data points</span>
        </div>
        <div className="flex items-center gap-1">
          {/* Chart type toggle */}
          <Button
            size="sm"
            variant={chartType === "area" ? "default" : "outline"}
            onClick={() => setChartType("area")}
            className="h-7 px-2 text-xs"
          >
            <Activity className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant={chartType === "candle" ? "default" : "outline"}
            onClick={() => setChartType("candle")}
            className="h-7 px-2 text-xs"
          >
            <BarChart2 className="h-3 w-3" />
          </Button>
          {/* Range selector */}
          <div className="ml-2 flex gap-1">
            {(["7d", "30d", "90d"] as const).map(r => (
              <Button
                key={r}
                size="sm"
                variant={range === r ? "default" : "outline"}
                onClick={() => setRange(r)}
                className="h-7 px-2 text-xs"
              >
                {r}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Main chart */}
      {isLoading ? (
        <div className="h-48 w-full bg-slate-800/50 rounded-lg animate-pulse" />
      ) : (
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {chartType === "area" ? (
              <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                <defs>
                  <linearGradient id={`ag-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#64748b", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[minClose - padding, maxClose + padding]}
                  tick={{ fill: "#64748b", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => fmt(v)}
                  width={70}
                />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine y={firstClose} stroke="#475569" strokeDasharray="4 4" />
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke={color}
                  strokeWidth={2}
                  fill={`url(#ag-${symbol})`}
                  dot={false}
                  activeDot={{ r: 4, fill: color }}
                />
              </AreaChart>
            ) : (
              <ComposedChart data={points} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#64748b", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[minClose - padding, maxClose + padding]}
                  tick={{ fill: "#64748b", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => fmt(v)}
                  width={70}
                />
                <Tooltip content={<ChartTooltip />} />
                {/* Render high-low range as a bar */}
                <Bar
                  dataKey="high"
                  fill="transparent"
                  stroke="transparent"
                  isAnimationActive={false}
                />
                {/* Close line */}
                <Line
                  type="monotone"
                  dataKey="close"
                  stroke={color}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            )}
          </ResponsiveContainer>
        </div>
      )}

      {/* Volume bar */}
      {!isLoading && points.some(p => p.volume > 0) && (
        <div className="h-14 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points} margin={{ top: 0, right: 4, bottom: 0, left: 0 }}>
              <XAxis dataKey="label" hide />
              <YAxis hide />
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <div className="rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-slate-300">
                      Vol: {Number(payload[0].value).toLocaleString()}
                    </div>
                  ) : null
                }
              />
              <Bar
                dataKey="volume"
                fill="#475569"
                opacity={0.6}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-center text-xs text-slate-600 -mt-1">Volume</p>
        </div>
      )}
    </div>
  );
}
