/**
 * LiveVoteCounter
 * Real-time vote tally for community fund proposals.
 * Polls the `community.liveVotes` tRPC procedure every 5 seconds and
 * also listens to the Go SSE community feed for instant updates.
 */
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ThumbsUp, ThumbsDown, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface LiveVoteCounterProps {
  proposalId: number;
  initialFor?: number;
  initialAgainst?: number;
  className?: string;
  compact?: boolean;
}

export function LiveVoteCounter({
  proposalId,
  initialFor = 0,
  initialAgainst = 0,
  className,
  compact = false,
}: LiveVoteCounterProps) {
  const [votesFor, setVotesFor] = useState(initialFor);
  const [votesAgainst, setVotesAgainst] = useState(initialAgainst);
  const [isLive, setIsLive] = useState(false);
  const [justUpdated, setJustUpdated] = useState(false);
  const prevTotal = useRef(initialFor + initialAgainst);

  // Poll via tRPC every 5 seconds
  const { data } = trpc.community.liveVotes.useQuery(
    { proposalId },
    { refetchInterval: 5000, staleTime: 4000 }
  );

  useEffect(() => {
    if (!data) return;
    const newTotal = data.votesFor + data.votesAgainst;
    if (newTotal !== prevTotal.current) {
      setJustUpdated(true);
      setTimeout(() => setJustUpdated(false), 1500);
      prevTotal.current = newTotal;
    }
    setVotesFor(data.votesFor);
    setVotesAgainst(data.votesAgainst);
  }, [data]);

  // Listen to Go SSE feed for instant vote events
  useEffect(() => {
    const FEED_URL = "/api/community-feed/stream";
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      try {
        es = new EventSource(FEED_URL);
        es.onopen = () => setIsLive(true);
        es.onerror = () => {
          setIsLive(false);
          es?.close();
          retryTimeout = setTimeout(connect, 10000);
        };
        es.onmessage = (e) => {
          try {
            const event = JSON.parse(e.data);
            if (
              event.type === "community_vote" &&
              event.metadata?.proposalId === proposalId
            ) {
              const vf = Number(event.metadata.votesFor ?? 0);
              const va = Number(event.metadata.votesAgainst ?? 0);
              setVotesFor(vf);
              setVotesAgainst(va);
              setJustUpdated(true);
              setTimeout(() => setJustUpdated(false), 1500);
              prevTotal.current = vf + va;
            }
          } catch { /* ignore parse errors */ }
        };
      } catch {
        setIsLive(false);
      }
    }

    connect();
    return () => {
      clearTimeout(retryTimeout);
      es?.close();
    };
  }, [proposalId]);

  const total = votesFor + votesAgainst;
  const forPct = total > 0 ? Math.round((votesFor / total) * 100) : 50;
  const againstPct = 100 - forPct;

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2 text-xs", className)}>
        <span className="flex items-center gap-1 text-green-400 font-medium">
          <ThumbsUp className="h-3 w-3" />
          {votesFor}
        </span>
        <span className="text-muted-foreground">/</span>
        <span className="flex items-center gap-1 text-red-400 font-medium">
          <ThumbsDown className="h-3 w-3" />
          {votesAgainst}
        </span>
        {isLive && (
          <Badge variant="outline" className="text-[10px] px-1 py-0 border-green-500/50 text-green-400 gap-0.5">
            <Zap className="h-2.5 w-2.5" />
            LIVE
          </Badge>
        )}
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {/* Header */}
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground">Community Vote</span>
        <div className="flex items-center gap-1.5">
          {isLive && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-green-500/50 text-green-400 gap-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
              </span>
              LIVE
            </Badge>
          )}
          <span className={cn(
            "text-muted-foreground transition-colors duration-300",
            justUpdated && "text-yellow-400 font-semibold"
          )}>
            {total} vote{total !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative h-2 rounded-full overflow-hidden bg-red-500/20">
        <div
          className={cn(
            "absolute left-0 top-0 h-full rounded-full bg-green-500 transition-all duration-700",
            justUpdated && "bg-green-400"
          )}
          style={{ width: `${forPct}%` }}
        />
      </div>

      {/* Counts */}
      <div className="flex items-center justify-between text-xs">
        <span className={cn(
          "flex items-center gap-1 font-medium transition-colors duration-300",
          justUpdated ? "text-green-300" : "text-green-400"
        )}>
          <ThumbsUp className="h-3 w-3" />
          {votesFor} YES ({forPct}%)
        </span>
        <span className={cn(
          "flex items-center gap-1 font-medium transition-colors duration-300",
          justUpdated ? "text-red-300" : "text-red-400"
        )}>
          {votesAgainst} NO ({againstPct}%)
          <ThumbsDown className="h-3 w-3" />
        </span>
      </div>
    </div>
  );
}
