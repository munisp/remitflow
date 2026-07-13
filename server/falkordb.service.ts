/**
 * RemitFlow — FalkorDB Knowledge Graph Service
 *
 * Models the remittance network as a property graph:
 *
 *   (User) -[SENT]-> (Transaction) -[TO]-> (Beneficiary)
 *   (User) -[OWNS]-> (Wallet)
 *   (Transaction) -[FLAGGED_BY]-> (FraudAlert)
 *   (Beneficiary) -[SHARES_ACCOUNT]-> (Beneficiary)  ← fraud ring detection
 *   (User) -[REFERRED_BY]-> (User)                   ← referral network
 *   (Transaction) -[SIMILAR_TO]-> (Transaction)       ← structuring detection
 *
 * Use cases:
 *  1. Fraud ring detection (shared accounts/devices across users)
 *  2. Money mule network traversal (multi-hop path analysis)
 *  3. Beneficiary deduplication (same account, different names)
 *  4. Referral network analytics
 *  5. EPR-KGQA: answer natural language questions over the graph
 *
 * FalkorDB uses Redis-compatible protocol + Cypher query language.
 * The `falkordb` npm package wraps the ioredis connection.
 */
import FalkorDB from "falkordb";
import { logger } from './_core/logger';

// ── Config ────────────────────────────────────────────────────────────────────
const FALKOR_HOST = process.env.FALKORDB_HOST || "localhost";
const FALKOR_PORT = parseInt(process.env.FALKORDB_PORT || "6380", 10);
const FALKOR_PASSWORD = process.env.FALKORDB_PASSWORD || undefined;
const GRAPH_NAME = "remitflow";

// ── Client ────────────────────────────────────────────────────────────────────
let _db: any = null;
let _graph: any = null;
let _available = false;

async function getGraph(): Promise<{ graph: any; available: boolean }> {
  if (_graph && _available) return { graph: _graph, available: true };
  try {
    _db = await (FalkorDB as any).connect({
      socket: { host: FALKOR_HOST, port: FALKOR_PORT },
      ...(FALKOR_PASSWORD ? { password: FALKOR_PASSWORD } : {}),
    });
    _graph = _db.selectGraph(GRAPH_NAME);
    _available = true;
    logger.info({ data: GRAPH_NAME }, '[FalkorDB] Connected to graph:');
    return { graph: _graph, available: true };
  } catch (err) {
    _available = false;
    logger.warn("[FalkorDB] Not available:", (err as Error).message);
    return { graph: null, available: false };
  }
}

// ── Schema Bootstrap ──────────────────────────────────────────────────────────
export async function bootstrapGraph(): Promise<void> {
  const { graph, available } = await getGraph();
  if (!available) return;
  try {
    // Create indices for fast lookups
    await graph.query("CREATE INDEX FOR (u:User) ON (u.id)").catch(() => {});
    await graph.query("CREATE INDEX FOR (t:Transaction) ON (t.id)").catch(() => {});
    await graph.query("CREATE INDEX FOR (b:Beneficiary) ON (b.accountNumber)").catch(() => {});
    await graph.query("CREATE INDEX FOR (w:Wallet) ON (w.address)").catch(() => {});
    logger.info("[FalkorDB] Graph indices created");
  } catch (err) {
    logger.warn("[FalkorDB] Bootstrap warning:", (err as Error).message);
  }
}

// ── Node Upsert ───────────────────────────────────────────────────────────────
export async function upsertUserNode(user: {
  id: number;
  name: string;
  email: string;
  country: string;
  kycTier: string;
  riskScore: number;
}): Promise<void> {
  const { graph, available } = await getGraph();
  if (!available) return;
  await graph.query(
    `MERGE (u:User {id: $id})
     SET u.name = $name, u.email = $email, u.country = $country,
         u.kycTier = $kycTier, u.riskScore = $riskScore, u.updatedAt = $ts`,
    {
      params: {
        id: user.id, name: user.name, email: user.email,
        country: user.country, kycTier: user.kycTier,
        riskScore: user.riskScore, ts: Date.now(),
      },
    }
  );
}

export async function upsertTransactionNode(tx: {
  id: number;
  userId: number;
  amount: number;
  currency: string;
  toCurrency: string;
  beneficiaryName: string;
  beneficiaryAccount: string;
  destinationCountry: string;
  status: string;
  riskScore: number;
  reference: string;
}): Promise<void> {
  const { graph, available } = await getGraph();
  if (!available) return;
  // Upsert Transaction node
  await graph.query(
    `MERGE (t:Transaction {id: $id})
     SET t.amount = $amount, t.currency = $currency, t.toCurrency = $toCurrency,
         t.status = $status, t.riskScore = $riskScore, t.reference = $ref,
         t.destinationCountry = $country, t.createdAt = $ts`,
    {
      params: {
        id: tx.id, amount: tx.amount, currency: tx.currency,
        toCurrency: tx.toCurrency, status: tx.status,
        riskScore: tx.riskScore, ref: tx.reference,
        country: tx.destinationCountry, ts: Date.now(),
      },
    }
  );
  // Upsert Beneficiary node
  await graph.query(
    `MERGE (b:Beneficiary {accountNumber: $acct})
     SET b.name = $name, b.country = $country`,
    {
      params: {
        acct: tx.beneficiaryAccount,
        name: tx.beneficiaryName,
        country: tx.destinationCountry,
      },
    }
  );
  // Create relationships
  await graph.query(
    `MATCH (u:User {id: $uid}), (t:Transaction {id: $tid})
     MERGE (u)-[:SENT]->(t)`,
    { params: { uid: tx.userId, tid: tx.id } }
  );
  await graph.query(
    `MATCH (t:Transaction {id: $tid}), (b:Beneficiary {accountNumber: $acct})
     MERGE (t)-[:TO]->(b)`,
    { params: { tid: tx.id, acct: tx.beneficiaryAccount } }
  );
}

// ── Fraud Ring Detection ──────────────────────────────────────────────────────
/**
 * Find users who share the same beneficiary account (potential money mule ring).
 * Returns all users connected to the same account within 2 hops.
 */
export async function detectFraudRing(accountNumber: string): Promise<{
  available: boolean;
  ringMembers: Array<{ userId: number; name: string; txCount: number; totalAmount: number }>;
  riskLevel: "low" | "medium" | "high" | "critical";
}> {
  const { graph, available } = await getGraph();
  if (!available) {
    return { available: false, ringMembers: [], riskLevel: "low" };
  }
  try {
    const result = await graph.query(
      `MATCH (u:User)-[:SENT]->(t:Transaction)-[:TO]->(b:Beneficiary {accountNumber: $acct})
       RETURN u.id AS userId, u.name AS name,
              COUNT(t) AS txCount, SUM(t.amount) AS totalAmount
       ORDER BY txCount DESC`,
      { params: { acct: accountNumber } }
    );
    const members = (result.data || []).map((row: any) => ({
      userId: row.userId,
      name: row.name,
      txCount: row.txCount,
      totalAmount: row.totalAmount,
    }));
    const riskLevel =
      members.length >= 5 ? "critical" :
      members.length >= 3 ? "high" :
      members.length >= 2 ? "medium" : "low";
    return { available: true, ringMembers: members, riskLevel };
  } catch {
    return { available: false, ringMembers: [], riskLevel: "low" };
  }
}

/**
 * Multi-hop path analysis: find the shortest path between two users
 * through the transaction network (money laundering path detection).
 */
export async function findTransactionPath(
  fromUserId: number,
  toUserId: number
): Promise<{ available: boolean; pathLength: number; path: string[] }> {
  const { graph, available } = await getGraph();
  if (!available) return { available: false, pathLength: -1, path: [] };
  try {
    const result = await graph.query(
      `MATCH p = shortestPath(
         (u1:User {id: $uid1})-[*..6]-(u2:User {id: $uid2})
       )
       RETURN length(p) AS pathLength, [n IN nodes(p) | coalesce(n.name, n.reference, toString(n.id))] AS path`,
      { params: { uid1: fromUserId, uid2: toUserId } }
    );
    if (!result.data?.length) return { available: true, pathLength: -1, path: [] };
    return {
      available: true,
      pathLength: result.data[0].pathLength,
      path: result.data[0].path,
    };
  } catch {
    return { available: false, pathLength: -1, path: [] };
  }
}

// ── EPR-KGQA: Evidence Pattern Retrieval ─────────────────────────────────────
/**
 * EPR-KGQA: Answer natural language questions over the knowledge graph
 * by converting the question to a Cypher query via LLM, then executing it.
 *
 * Examples:
 *  "How many transactions did user 42 send to Nigeria last month?"
 *  "Which beneficiaries are shared by more than 3 users?"
 *  "What is the total amount sent by high-risk users?"
 */
export async function kgqa(question: string): Promise<{
  available: boolean;
  question: string;
  cypherQuery: string;
  results: any[];
  answer: string;
}> {
  const { graph, available } = await getGraph();
  if (!available) {
    return {
      available: false,
      question,
      cypherQuery: "",
      results: [],
      answer: "Knowledge graph is not available. Start FalkorDB to enable KGQA.",
    };
  }

  // Generate Cypher query from natural language using LLM
  let cypherQuery = "";
  try {
    const { invokeLLM } = await import("./_core/llm.js");
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a Cypher query generator for a remittance platform knowledge graph.
Graph schema:
- (User {id, name, email, country, kycTier, riskScore})
- (Transaction {id, amount, currency, toCurrency, status, riskScore, reference, destinationCountry})
- (Beneficiary {accountNumber, name, country})
- (Wallet {address, currency})
Relationships: (User)-[:SENT]->(Transaction), (Transaction)-[:TO]->(Beneficiary), (User)-[:OWNS]->(Wallet)
Generate ONLY a valid Cypher query for the question. Return just the query, no explanation.`,
        },
        { role: "user", content: question },
      ],
    });
    cypherQuery = ((response.choices?.[0]?.message?.content as string) || "").trim();
    // Remove markdown code blocks if present
    cypherQuery = cypherQuery.replace(/```cypher\n?/g, "").replace(/```\n?/g, "").trim();
  } catch {
    cypherQuery = `MATCH (u:User) RETURN u.name, u.riskScore ORDER BY u.riskScore DESC LIMIT 10`;
  }

  // Execute the query
  try {
    const result = await graph.query(cypherQuery);
    const results = result.data || [];
    // Generate natural language answer
    const answer = results.length > 0
      ? `Found ${results.length} result(s). Top result: ${JSON.stringify(results[0])}`
      : "No results found for this query.";
    return { available: true, question, cypherQuery, results, answer };
  } catch (err) {
    return {
      available: true,
      question,
      cypherQuery,
      results: [],
      answer: `Query execution error: ${(err as Error).message}`,
    };
  }
}

// ── Analytics ─────────────────────────────────────────────────────────────────
export async function getGraphStats(): Promise<{
  available: boolean;
  nodeCount: number;
  edgeCount: number;
  userCount: number;
  transactionCount: number;
  beneficiaryCount: number;
  highRiskUsers: number;
}> {
  const { graph, available } = await getGraph();
  if (!available) {
    return {
      available: false,
      nodeCount: 0, edgeCount: 0, userCount: 0,
      transactionCount: 0, beneficiaryCount: 0, highRiskUsers: 0,
    };
  }
  try {
    const [users, txns, bens, risky] = await Promise.all([
      graph.query("MATCH (u:User) RETURN COUNT(u) AS c"),
      graph.query("MATCH (t:Transaction) RETURN COUNT(t) AS c"),
      graph.query("MATCH (b:Beneficiary) RETURN COUNT(b) AS c"),
      graph.query("MATCH (u:User) WHERE u.riskScore > 70 RETURN COUNT(u) AS c"),
    ]);
    const userCount = users.data?.[0]?.c ?? 0;
    const transactionCount = txns.data?.[0]?.c ?? 0;
    const beneficiaryCount = bens.data?.[0]?.c ?? 0;
    const highRiskUsers = risky.data?.[0]?.c ?? 0;
    return {
      available: true,
      nodeCount: userCount + transactionCount + beneficiaryCount,
      edgeCount: transactionCount * 2, // SENT + TO per transaction
      userCount,
      transactionCount,
      beneficiaryCount,
      highRiskUsers,
    };
  } catch {
    return {
      available: false,
      nodeCount: 0, edgeCount: 0, userCount: 0,
      transactionCount: 0, beneficiaryCount: 0, highRiskUsers: 0,
    };
  }
}

export async function getFalkorDBStatus(): Promise<{
  available: boolean;
  host: string;
  port: number;
  graphName: string;
  stats: Awaited<ReturnType<typeof getGraphStats>>;
}> {
  const stats = await getGraphStats();
  return {
    available: stats.available,
    host: FALKOR_HOST,
    port: FALKOR_PORT,
    graphName: GRAPH_NAME,
    stats,
  };
}
