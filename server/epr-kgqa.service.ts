/**
 * RemitFlow — EPR-KGQA Service
 *
 * EPR-KGQA (Entity-Predicate-Relation Knowledge Graph Question Answering)
 * enables natural language queries over the RemitFlow knowledge graph.
 *
 * Pipeline:
 *  1. Parse NL question → extract entities (users, amounts, corridors, dates)
 *  2. Map entities to FalkorDB node types (User, Transaction, Beneficiary, Country)
 *  3. Generate Cypher query using LLM (Ollama local or Manus built-in)
 *  4. Execute Cypher on FalkorDB
 *  5. Format results as natural language answer
 *
 * Example questions:
 *  - "Who are the top 5 senders to Nigeria this month?"
 *  - "What is the average transaction amount for USD→NGN corridor?"
 *  - "Which users have high risk scores and sent money to Iran?"
 *  - "Show me all transactions above $5000 in the last 7 days"
 *  - "What is the fraud rate for first-time senders?"
 *
 * Knowledge Graph Schema (FalkorDB):
 *  Nodes: User, Transaction, Beneficiary, Country, Currency, ComplianceCase
 *  Edges: SENT, RECEIVED_BY, BELONGS_TO, FLAGGED_FOR, INVOLVES_CURRENCY
 */

import { kgqa as queryKnowledgeGraph } from "./falkordb.service.js";
type CypherResult = Awaited<ReturnType<typeof queryKnowledgeGraph>>;
import { ollamaChat } from "./ollama.service.js";

// ── Entity Types ──────────────────────────────────────────────────────────────
interface ExtractedEntity {
  type: "user" | "country" | "currency" | "amount" | "date" | "status" | "risk";
  value: string;
  normalized?: string;
}

// ── Entity Extraction ─────────────────────────────────────────────────────────
const COUNTRY_ALIASES: Record<string, string> = {
  nigeria: "NG", ghana: "GH", kenya: "KE", "south africa": "ZA",
  uk: "GB", "united kingdom": "GB", usa: "US", "united states": "US",
  india: "IN", philippines: "PH", mexico: "MX", brazil: "BR",
  iran: "IR", "north korea": "KP", syria: "SY",
};

const CURRENCY_CODES = ["USD", "EUR", "GBP", "NGN", "GHS", "KES", "ZAR", "INR", "PHP", "MXN", "BRL"];

function extractEntities(question: string): ExtractedEntity[] {
  const q = question.toLowerCase();
  const entities: ExtractedEntity[] = [];

  // Extract countries
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) {
    if (q.includes(alias)) {
      entities.push({ type: "country", value: alias, normalized: code });
    }
  }

  // Extract currencies
  for (const code of CURRENCY_CODES) {
    if (q.includes(code.toLowerCase()) || q.includes(code)) {
      entities.push({ type: "currency", value: code, normalized: code });
    }
  }

  // Extract amounts
  const amountMatch = q.match(/\$?([\d,]+(?:\.\d+)?)\s*(?:usd|dollars?)?/);
  if (amountMatch) {
    entities.push({
      type: "amount",
      value: amountMatch[0],
      normalized: amountMatch[1].replace(",", ""),
    });
  }

  // Extract time references
  if (q.includes("today")) entities.push({ type: "date", value: "today", normalized: "0 days" });
  if (q.includes("this week")) entities.push({ type: "date", value: "this week", normalized: "7 days" });
  if (q.includes("this month")) entities.push({ type: "date", value: "this month", normalized: "30 days" });
  if (q.includes("last 7 days")) entities.push({ type: "date", value: "last 7 days", normalized: "7 days" });
  if (q.includes("last 30 days")) entities.push({ type: "date", value: "last 30 days", normalized: "30 days" });

  // Extract status
  if (q.includes("pending")) entities.push({ type: "status", value: "pending" });
  if (q.includes("completed") || q.includes("success")) entities.push({ type: "status", value: "completed" });
  if (q.includes("failed")) entities.push({ type: "status", value: "failed" });
  if (q.includes("flagged") || q.includes("suspicious")) entities.push({ type: "status", value: "flagged" });

  // Extract risk references
  if (q.includes("high risk")) entities.push({ type: "risk", value: "high", normalized: "0.7" });
  if (q.includes("medium risk")) entities.push({ type: "risk", value: "medium", normalized: "0.4" });
  if (q.includes("low risk")) entities.push({ type: "risk", value: "low", normalized: "0.2" });

  return entities;
}

// ── Cypher Query Templates ────────────────────────────────────────────────────
const CYPHER_TEMPLATES: Array<{
  pattern: RegExp;
  generate: (q: string, entities: ExtractedEntity[]) => string;
  description: string;
}> = [
  {
    pattern: /top \d+ senders?/i,
    description: "Top senders by volume",
    generate: (q) => {
      const limitMatch = q.match(/top (\d+)/i);
      const limit = limitMatch?.[1] || "5";
      const countryEntity = extractEntities(q).find((e) => e.type === "country");
      const countryFilter = countryEntity
        ? `WHERE t.destination_country = '${countryEntity.normalized}'`
        : "";
      return `MATCH (u:User)-[:SENT]->(t:Transaction) ${countryFilter} RETURN u.name AS sender, SUM(t.amount) AS totalAmount, COUNT(t) AS txCount ORDER BY totalAmount DESC LIMIT ${limit}`;
    },
  },
  {
    pattern: /average.*amount|avg.*transaction/i,
    description: "Average transaction amount",
    generate: (q, entities) => {
      const from = entities.find((e) => e.type === "currency" && q.toLowerCase().indexOf(e.value.toLowerCase()) < q.toLowerCase().indexOf("→") || q.toLowerCase().indexOf(e.value.toLowerCase()) < q.toLowerCase().indexOf("to"));
      const to = entities.find((e) => e.type === "currency" && e !== from);
      const filter = from && to
        ? `WHERE t.currency = '${from.normalized}' AND t.to_currency = '${to?.normalized}'`
        : from ? `WHERE t.currency = '${from.normalized}'` : "";
      return `MATCH (t:Transaction) ${filter} RETURN AVG(t.amount) AS avgAmount, COUNT(t) AS txCount, t.currency AS currency`;
    },
  },
  {
    pattern: /high risk.*sent|flagged.*users?/i,
    description: "High risk users",
    generate: (q, entities) => {
      const countryEntity = entities.find((e) => e.type === "country");
      const riskThreshold = "0.7";
      const countryFilter = countryEntity
        ? `AND t.destination_country = '${countryEntity.normalized}'`
        : "";
      return `MATCH (u:User)-[:SENT]->(t:Transaction) WHERE u.risk_score >= ${riskThreshold} ${countryFilter} RETURN u.name, u.email, u.risk_score, COUNT(t) AS txCount ORDER BY u.risk_score DESC LIMIT 20`;
    },
  },
  {
    pattern: /transactions? above|transactions? over|large transactions?/i,
    description: "Large transactions filter",
    generate: (q, entities) => {
      const amountEntity = entities.find((e) => e.type === "amount");
      const threshold = amountEntity?.normalized || "5000";
      const dateEntity = entities.find((e) => e.type === "date");
      const daysBack = dateEntity?.normalized?.replace(" days", "") || "30";
      return `MATCH (u:User)-[:SENT]->(t:Transaction) WHERE t.amount > ${threshold} AND t.created_at > datetime() - duration({days: ${daysBack}}) RETURN u.name, t.amount, t.currency, t.status, t.destination_country ORDER BY t.amount DESC LIMIT 50`;
    },
  },
  {
    pattern: /fraud rate|fraud.*first.?time|first.?time.*fraud/i,
    description: "Fraud rate analysis",
    generate: () => {
      return `MATCH (u:User)-[:SENT]->(t:Transaction) WITH u, COUNT(t) AS txCount, SUM(CASE WHEN t.status = 'flagged' THEN 1 ELSE 0 END) AS flaggedCount WHERE txCount = 1 RETURN COUNT(u) AS firstTimeSenders, SUM(flaggedCount) AS flaggedFirstTime, toFloat(SUM(flaggedCount)) / COUNT(u) AS fraudRate`;
    },
  },
  {
    pattern: /corridor|route.*from|from.*to/i,
    description: "Corridor analytics",
    generate: (q, entities) => {
      const currencies = entities.filter((e) => e.type === "currency");
      const from = currencies[0]?.normalized || "USD";
      const to = currencies[1]?.normalized;
      const filter = to
        ? `WHERE t.currency = '${from}' AND t.to_currency = '${to}'`
        : `WHERE t.currency = '${from}'`;
      return `MATCH (t:Transaction) ${filter} RETURN t.currency AS fromCurrency, t.to_currency AS toCurrency, t.destination_country AS country, COUNT(t) AS txCount, SUM(t.amount) AS totalVolume, AVG(t.risk_score) AS avgRisk ORDER BY totalVolume DESC LIMIT 20`;
    },
  },
];

// ── LLM-based Cypher Generation ───────────────────────────────────────────────
async function generateCypherWithLLM(question: string): Promise<string> {
  const schema = `
Graph Schema:
- Node: User {id, name, email, country, kyc_tier, risk_score}
- Node: Transaction {id, amount, currency, to_currency, destination_country, status, risk_score, reference, created_at}
- Node: Beneficiary {id, name, account_number, bank_name, country, currency}
- Node: Country {code, name, risk_level}
- Edge: (User)-[:SENT]->(Transaction)
- Edge: (Transaction)-[:RECEIVED_BY]->(Beneficiary)
- Edge: (User)-[:HAS_BENEFICIARY]->(Beneficiary)
- Edge: (Transaction)-[:TO_COUNTRY]->(Country)`;

  const response = await ollamaChat([
    {
      role: "system",
      content: `You are a Cypher query generator for FalkorDB. Generate a valid Cypher query for the given question.
${schema}
Rules:
- Return only the Cypher query, no explanation
- Use LIMIT 50 unless a specific limit is requested
- Use proper FalkorDB syntax (no APOC procedures)
- Always include ORDER BY for aggregations`,
    },
    { role: "user", content: `Generate a Cypher query for: "${question}"` },
  ]);

  // Extract just the Cypher query
  const content = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  const cypherMatch = content.match(/(?:MATCH|WITH|RETURN|CREATE|MERGE)[\s\S]+/);
  return cypherMatch?.[0]?.trim() || "MATCH (t:Transaction) RETURN t.id, t.amount, t.currency, t.status LIMIT 10";
}

// ── Main KGQA Function ────────────────────────────────────────────────────────
export interface KGQAResult {
  question: string;
  entities: ExtractedEntity[];
  cypherQuery: string;
  cypherSource: "template" | "llm";
  rawResults: CypherResult;
  naturalLanguageAnswer: string;
  executionTimeMs: number;
  confidence: number;
}

export async function answerKGQuestion(question: string): Promise<KGQAResult> {
  const start = Date.now();
  const entities = extractEntities(question);

  // Try template matching first (faster, more reliable)
  let cypherQuery = "";
  let cypherSource: "template" | "llm" = "template";

  const matchedTemplate = CYPHER_TEMPLATES.find((t) => t.pattern.test(question));
  if (matchedTemplate) {
    cypherQuery = matchedTemplate.generate(question, entities);
  } else {
    // Fall back to LLM-generated Cypher
    cypherQuery = await generateCypherWithLLM(question);
    cypherSource = "llm";
  }

  // Execute on FalkorDB
  const rawResults = await queryKnowledgeGraph(cypherQuery);

  // Generate natural language answer
  const resultSummary = rawResults.available
    ? `Found ${rawResults.results?.length || 0} results: ${JSON.stringify(rawResults.results?.slice(0, 3))}`
    : `Query failed: ${rawResults.available === false && "Query failed"}`;

  const nlResponse = await ollamaChat([
    {
      role: "system",
      content: "You are a financial data analyst. Summarize query results in 2-3 clear sentences. Be specific with numbers.",
    },
    {
      role: "user",
      content: `Question: "${question}"\nResults: ${resultSummary}\nProvide a concise natural language answer.`,
    },
  ]);

  return {
    question,
    entities,
    cypherQuery,
    cypherSource,
    rawResults,
    naturalLanguageAnswer: typeof nlResponse.content === "string" ? nlResponse.content : JSON.stringify(nlResponse.content),
    executionTimeMs: Date.now() - start,
    confidence: cypherSource === "template" ? 0.92 : 0.75,
  };
}

// ── Suggested Questions ───────────────────────────────────────────────────────
export function getSuggestedQuestions(): string[] {
  return [
    "Who are the top 5 senders to Nigeria this month?",
    "What is the average transaction amount for USD to NGN corridor?",
    "Show me all transactions above $5000 in the last 7 days",
    "Which users have high risk scores and sent money to Iran?",
    "What is the fraud rate for first-time senders?",
    "Show corridor analytics from USD to GHS",
    "How many pending transactions are there today?",
    "What is the total volume sent to Kenya this month?",
  ];
}
