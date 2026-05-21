/**
 * In-App Support — P2 Business 9.6
 * Ticketing system with auto-categorization, smart routing, and canned responses.
 */

type TicketCategory = "transfer" | "kyc" | "wallet" | "fees" | "security" | "account" | "technical" | "general";
type TicketPriority = "low" | "medium" | "high" | "urgent";
type TicketStatus = "new" | "assigned" | "in_progress" | "waiting_customer" | "resolved" | "closed";

interface SupportTicket {
  id: string;
  userId: number;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  subject: string;
  description: string;
  transactionId?: string;
  assignedAgent?: string;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  messages: Array<{
    id: string;
    from: "user" | "agent" | "system";
    message: string;
    timestamp: number;
    attachments?: string[];
  }>;
  satisfaction?: 1 | 2 | 3 | 4 | 5;
}

const tickets = new Map<string, SupportTicket>();

const CATEGORY_KEYWORDS: Record<TicketCategory, string[]> = {
  transfer: ["transfer", "send", "payment", "remit", "money", "recipient", "beneficiary", "delivery", "tracking"],
  kyc: ["kyc", "verification", "identity", "document", "id", "passport", "bvn", "nin", "selfie"],
  wallet: ["wallet", "balance", "deposit", "withdraw", "fund", "top-up"],
  fees: ["fee", "charge", "cost", "rate", "exchange", "fx", "pricing"],
  security: ["security", "password", "login", "2fa", "hack", "unauthorized", "suspicious", "locked"],
  account: ["account", "profile", "settings", "email", "phone", "close", "delete"],
  technical: ["bug", "error", "crash", "slow", "loading", "broken", "not working"],
  general: [],
};

const CANNED_RESPONSES: Record<TicketCategory, string> = {
  transfer: "Thank you for reaching out about your transfer. I can see your transaction and will look into this right away. Could you confirm the transaction reference number?",
  kyc: "I understand you need help with verification. Our KYC process typically takes 24-48 hours. Let me check the status of your submission.",
  wallet: "I'll look into your wallet issue right away. For security, please don't share any sensitive account details in this chat.",
  fees: "I'd be happy to explain our fee structure. RemitFlow charges a small transfer fee plus a transparent exchange rate margin. Let me check the specific details for your corridor.",
  security: "Your account security is our top priority. I've flagged this for immediate review. Please don't share any passwords or security codes.",
  account: "I can help with your account settings. Let me pull up your profile now.",
  technical: "Sorry for the inconvenience. I've logged this technical issue and our engineering team will investigate. Could you tell me which device and browser you're using?",
  general: "Thank you for contacting RemitFlow support. How can I help you today?",
};

function autoCategorizeFn(subject: string, description: string): TicketCategory {
  const text = `${subject} ${description}`.toLowerCase();
  let bestCategory: TicketCategory = "general";
  let bestScore = 0;

  const categories = Object.entries(CATEGORY_KEYWORDS) as Array<[TicketCategory, string[]]>;
  for (const [category, keywords] of categories) {
    const score = keywords.filter((kw) => text.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

function autoPriority(category: TicketCategory): TicketPriority {
  if (category === "security") return "urgent";
  if (category === "transfer") return "high";
  if (category === "kyc" || category === "wallet") return "medium";
  return "low";
}

export function createTicket(params: {
  userId: number;
  subject: string;
  description: string;
  transactionId?: string;
  category?: TicketCategory;
}): SupportTicket {
  const category = params.category ?? autoCategorizeFn(params.subject, params.description);
  const priority = autoPriority(category);

  const ticket: SupportTicket = {
    id: `TKT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    userId: params.userId,
    category,
    priority,
    status: "new",
    subject: params.subject,
    description: params.description,
    transactionId: params.transactionId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [
      {
        id: `msg_${Date.now()}`,
        from: "user",
        message: params.description,
        timestamp: Date.now(),
      },
      {
        id: `msg_${Date.now() + 1}`,
        from: "system",
        message: CANNED_RESPONSES[category],
        timestamp: Date.now() + 1,
      },
    ],
  };

  tickets.set(ticket.id, ticket);
  return ticket;
}

export function addMessage(ticketId: string, from: "user" | "agent", message: string, attachments?: string[]): boolean {
  const ticket = tickets.get(ticketId);
  if (!ticket) return false;

  ticket.messages.push({
    id: `msg_${Date.now()}`,
    from,
    message,
    timestamp: Date.now(),
    attachments,
  });

  ticket.updatedAt = Date.now();
  if (from === "agent") ticket.status = "in_progress";
  if (from === "user" && ticket.status === "waiting_customer") ticket.status = "in_progress";

  return true;
}

export function resolveTicket(ticketId: string, resolution: string): boolean {
  const ticket = tickets.get(ticketId);
  if (!ticket) return false;

  ticket.status = "resolved";
  ticket.resolvedAt = Date.now();
  ticket.updatedAt = Date.now();
  ticket.messages.push({
    id: `msg_${Date.now()}`,
    from: "system",
    message: `Ticket resolved: ${resolution}`,
    timestamp: Date.now(),
  });

  return true;
}

export function rateTicket(ticketId: string, rating: 1 | 2 | 3 | 4 | 5): boolean {
  const ticket = tickets.get(ticketId);
  if (!ticket) return false;

  ticket.satisfaction = rating;
  return true;
}

export function getUserTickets(userId: number): SupportTicket[] {
  const results: SupportTicket[] = [];
  tickets.forEach((t) => {
    if (t.userId === userId) results.push(t);
  });
  return results.sort((a, b) => b.createdAt - a.createdAt);
}

export function getSupportStats(): {
  total: number;
  open: number;
  resolved: number;
  avgResolutionMinutes: number;
  avgSatisfaction: number;
  byCategory: Record<string, number>;
} {
  let total = 0, open = 0, resolved = 0;
  const resolutionTimes: number[] = [];
  const ratings: number[] = [];
  const byCategory: Record<string, number> = {};

  tickets.forEach((t) => {
    total++;
    byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;
    if (t.status === "resolved" || t.status === "closed") {
      resolved++;
      if (t.resolvedAt) resolutionTimes.push(t.resolvedAt - t.createdAt);
    } else {
      open++;
    }
    if (t.satisfaction) ratings.push(t.satisfaction);
  });

  return {
    total,
    open,
    resolved,
    avgResolutionMinutes: resolutionTimes.length > 0
      ? Math.round(resolutionTimes.reduce((s, t) => s + t, 0) / resolutionTimes.length / 60_000)
      : 0,
    avgSatisfaction: ratings.length > 0
      ? Math.round(ratings.reduce((s, r) => s + r, 0) / ratings.length * 10) / 10
      : 0,
    byCategory,
  };
}

export function getCannedResponse(category: TicketCategory): string {
  return CANNED_RESPONSES[category];
}
