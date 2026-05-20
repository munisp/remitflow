/**
 * LiveTransferTicker — scrolling banner showing anonymised recent transfers
 * Adds social proof and urgency to the landing page.
 */
import { useEffect, useRef, useState } from "react";
import { TrendingUp } from "lucide-react";

interface TickerItem {
  id: number;
  text: string;
  time: string;
}

const SEED_ITEMS: Omit<TickerItem, "id">[] = [
  { text: "Someone in London just sent ₦180,000 to Lagos", time: "2 min ago" },
  { text: "A transfer of $500 arrived in Accra, Ghana", time: "4 min ago" },
  { text: "₦250,000 delivered to Abuja in under 3 minutes", time: "6 min ago" },
  { text: "Someone in Toronto sent KES 65,000 to Nairobi", time: "8 min ago" },
  { text: "A diaspora investor backed a Lagos startup — $2,000", time: "11 min ago" },
  { text: "Someone in Paris sent XOF 300,000 to Dakar", time: "13 min ago" },
  { text: "₦500,000 community fund contribution from Manchester", time: "15 min ago" },
  { text: "$1,200 sent from New York to Lagos — fee: $2.40", time: "17 min ago" },
  { text: "Someone in Dubai sent ₦400,000 home to Enugu", time: "20 min ago" },
  { text: "GHS 8,500 delivered to Kumasi, Ghana", time: "22 min ago" },
  { text: "A family in Nairobi received KES 45,000 from Stockholm", time: "25 min ago" },
  { text: "₦150,000 school fees paid for a student in Ibadan", time: "28 min ago" },
  { text: "Someone in Berlin sent €800 worth of naira to Port Harcourt", time: "31 min ago" },
  { text: "$300 airtime top-up delivered to Lagos instantly", time: "33 min ago" },
  { text: "A savings goal of ₦1,000,000 was reached in Abuja", time: "36 min ago" },
];

// New items that get injected periodically to simulate live activity
const LIVE_ADDITIONS: Omit<TickerItem, "id">[] = [
  { text: "Someone in Houston just sent ₦220,000 to Benin City", time: "just now" },
  { text: "$750 transfer to Accra completed in 90 seconds", time: "just now" },
  { text: "₦600,000 property deposit sent from London to Lagos", time: "just now" },
  { text: "Someone in Amsterdam sent XOF 500,000 to Dakar", time: "just now" },
  { text: "A community fund in Birmingham raised £5,000 for Nairobi", time: "just now" },
];

export default function LiveTransferTicker() {
  const [items, setItems] = useState<TickerItem[]>(
    SEED_ITEMS.map((item, i) => ({ ...item, id: i + 1 }))
  );
  const nextId = useRef(SEED_ITEMS.length + 1);
  const additionIdx = useRef(0);

  // Inject a new "live" item every 12 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const newItem = LIVE_ADDITIONS[additionIdx.current % LIVE_ADDITIONS.length];
      additionIdx.current++;
      setItems(prev => [
        { ...newItem, id: nextId.current++ },
        ...prev.slice(0, 19), // keep max 20 items
      ]);
    }, 12000);
    return () => clearInterval(interval);
  }, []);

  // Duplicate items for seamless infinite scroll
  const displayItems = [...items, ...items];

  return (
    <div className="bg-emerald-950/80 border-b border-emerald-800/50 overflow-hidden py-2">
      <div className="flex items-center gap-3">
        {/* Label */}
        <div className="flex-shrink-0 flex items-center gap-1.5 bg-emerald-500 text-black text-xs font-bold px-3 py-1 ml-4 rounded-full">
          <TrendingUp className="h-3 w-3" />
          <span>LIVE</span>
          <span className="inline-block h-2 w-2 rounded-full bg-black animate-pulse" />
        </div>

        {/* Scrolling track */}
        <div className="flex-1 overflow-hidden relative">
          <div className="flex animate-ticker whitespace-nowrap gap-12">
            {displayItems.map((item, idx) => (
              <span
                key={`${item.id}-${idx}`}
                className="inline-flex items-center gap-2 text-xs text-emerald-200 flex-shrink-0"
              >
                <span className="text-emerald-400">●</span>
                {item.text}
                <span className="text-emerald-600 text-[10px]">{item.time}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
