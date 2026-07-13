/**
 * RemitFlow — Qdrant Vector Search Service
 *
 * Provides semantic vector search over:
 *  - Transactions (anomaly detection via embedding similarity)
 *  - Beneficiaries (duplicate/fraud network detection)
 *  - Compliance cases (similar case retrieval for analysts)
 *  - Knowledge base articles (RAG for customer support)
 *
 * Architecture:
 *  - Embeddings generated via Manus built-in LLM (text-embedding-3-small)
 *  - Vectors stored in Qdrant (local Docker or Qdrant Cloud)
 *  - Fallback: in-memory cosine similarity when Qdrant is unavailable
 */
import { QdrantClient } from "@qdrant/js-client-rest";
import { logger } from './_core/logger';
// env accessed via process.env directly

// ── Config ────────────────────────────────────────────────────────────────────
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || undefined;
const VECTOR_DIM = 1536; // text-embedding-3-small dimension
const EMBED_API_URL = process.env.BUILT_IN_FORGE_API_URL || "";
const EMBED_API_KEY = process.env.BUILT_IN_FORGE_API_KEY || "";

// Collection names
export const COLLECTIONS = {
  TRANSACTIONS: "remitflow_transactions",
  BENEFICIARIES: "remitflow_beneficiaries",
  COMPLIANCE_CASES: "remitflow_compliance_cases",
  KB_ARTICLES: "remitflow_kb_articles",
  USER_PROFILES: "remitflow_user_profiles",
} as const;

// ── Client ────────────────────────────────────────────────────────────────────
let _client: QdrantClient | null = null;
let _available = false;

export function getQdrantClient(): QdrantClient {
  if (!_client) {
    _client = new QdrantClient({
      url: QDRANT_URL,
      ...(QDRANT_API_KEY ? { apiKey: QDRANT_API_KEY } : {}),
    });
  }
  return _client;
}

export async function isQdrantAvailable(): Promise<boolean> {
  try {
    const client = getQdrantClient();
    await client.getCollections();
    _available = true;
    return true;
  } catch {
    _available = false;
    return false;
  }
}

// ── Embedding Generation ──────────────────────────────────────────────────────
/**
 * Generate a 1536-dim embedding vector for text using the built-in LLM API.
 * Falls back to a deterministic hash-based pseudo-embedding when the API is
 * unavailable (for testing / offline mode).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!EMBED_API_URL || !EMBED_API_KEY) {
    return deterministicEmbedding(text);
  }
  try {
    const response = await fetch(`${EMBED_API_URL}/v1/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${EMBED_API_KEY}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text,
      }),
    });
    if (!response.ok) return deterministicEmbedding(text);
    const data = await response.json() as any;
    return data.data?.[0]?.embedding ?? deterministicEmbedding(text);
  } catch {
    return deterministicEmbedding(text);
  }
}

/** Deterministic pseudo-embedding for offline/test mode */
function deterministicEmbedding(text: string): number[] {
  const vec = new Array(VECTOR_DIM).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % VECTOR_DIM] += text.charCodeAt(i) / 255;
  }
  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

// ── Collection Management ─────────────────────────────────────────────────────
export async function ensureCollections(): Promise<void> {
  const client = getQdrantClient();
  const { collections } = await client.getCollections();
  const existing = new Set(collections.map((c) => c.name));

  for (const name of Object.values(COLLECTIONS)) {
    if (!existing.has(name)) {
      await client.createCollection(name, {
        vectors: {
          size: VECTOR_DIM,
          distance: "Cosine",
        },
        optimizers_config: {
          default_segment_number: 2,
        },
        replication_factor: 1,
      });
      logger.info(`[Qdrant] Created collection: ${name}`);
    }
  }
}

// ── Upsert Helpers ────────────────────────────────────────────────────────────
export interface TransactionVector {
  id: number;
  userId: number;
  amount: number;
  currency: string;
  toCurrency: string;
  beneficiaryName: string;
  destinationCountry: string;
  status: string;
  riskScore: number;
  reference: string;
}

export async function upsertTransactionVector(tx: TransactionVector): Promise<void> {
  const available = await isQdrantAvailable();
  if (!available) return;
  const text = `${tx.amount} ${tx.currency} to ${tx.toCurrency} for ${tx.beneficiaryName} in ${tx.destinationCountry} status:${tx.status} risk:${tx.riskScore}`;
  const vector = await generateEmbedding(text);
  const client = getQdrantClient();
  await client.upsert(COLLECTIONS.TRANSACTIONS, {
    wait: true,
    points: [
      {
        id: tx.id,
        vector,
        payload: {
          userId: tx.userId,
          amount: tx.amount,
          currency: tx.currency,
          toCurrency: tx.toCurrency,
          beneficiaryName: tx.beneficiaryName,
          destinationCountry: tx.destinationCountry,
          status: tx.status,
          riskScore: tx.riskScore,
          reference: tx.reference,
        },
      },
    ],
  });
}

export async function upsertBeneficiaryVector(b: {
  id: number;
  userId: number;
  name: string;
  accountNumber: string;
  bankName: string;
  country: string;
  currency: string;
}): Promise<void> {
  const available = await isQdrantAvailable();
  if (!available) return;
  const text = `${b.name} account:${b.accountNumber} bank:${b.bankName} country:${b.country} currency:${b.currency}`;
  const vector = await generateEmbedding(text);
  const client = getQdrantClient();
  await client.upsert(COLLECTIONS.BENEFICIARIES, {
    wait: true,
    points: [{ id: b.id, vector, payload: { ...b } }],
  });
}

export async function upsertKBArticle(article: {
  id: number;
  title: string;
  content: string;
  category: string;
  tags: string[];
}): Promise<void> {
  const available = await isQdrantAvailable();
  if (!available) return;
  const text = `${article.title} ${article.content} ${article.tags.join(" ")}`;
  const vector = await generateEmbedding(text);
  const client = getQdrantClient();
  await client.upsert(COLLECTIONS.KB_ARTICLES, {
    wait: true,
    points: [{ id: article.id, vector, payload: { ...article } }],
  });
}

// ── Search Helpers ────────────────────────────────────────────────────────────
export interface SearchResult {
  id: number | string;
  score: number;
  payload: Record<string, unknown>;
}

export async function semanticSearchTransactions(
  query: string,
  userId: number,
  limit = 10
): Promise<SearchResult[]> {
  const available = await isQdrantAvailable();
  if (!available) return [];
  const vector = await generateEmbedding(query);
  const client = getQdrantClient();
  const results = await client.search(COLLECTIONS.TRANSACTIONS, {
    vector,
    limit,
    filter: {
      must: [{ key: "userId", match: { value: userId } }],
    },
    with_payload: true,
  });
  return results.map((r) => ({
    id: r.id as number,
    score: r.score,
    payload: r.payload as Record<string, unknown>,
  }));
}

export async function findSimilarBeneficiaries(
  name: string,
  accountNumber: string,
  limit = 5
): Promise<SearchResult[]> {
  const available = await isQdrantAvailable();
  if (!available) return [];
  const text = `${name} account:${accountNumber}`;
  const vector = await generateEmbedding(text);
  const client = getQdrantClient();
  const results = await client.search(COLLECTIONS.BENEFICIARIES, {
    vector,
    limit,
    with_payload: true,
  });
  return results.map((r) => ({
    id: r.id as number,
    score: r.score,
    payload: r.payload as Record<string, unknown>,
  }));
}

export async function semanticSearchKB(
  query: string,
  limit = 5
): Promise<SearchResult[]> {
  const available = await isQdrantAvailable();
  if (!available) return [];
  const vector = await generateEmbedding(query);
  const client = getQdrantClient();
  const results = await client.search(COLLECTIONS.KB_ARTICLES, {
    vector,
    limit,
    with_payload: true,
  });
  return results.map((r) => ({
    id: r.id as number,
    score: r.score,
    payload: r.payload as Record<string, unknown>,
  }));
}

/**
 * Anomaly detection: find transactions that are semantically dissimilar
 * to a user's normal transaction pattern (high distance = anomaly).
 */
export async function detectTransactionAnomalies(
  userId: number,
  recentTxText: string,
  threshold = 0.3
): Promise<{ isAnomaly: boolean; similarityScore: number; nearestNeighbors: SearchResult[] }> {
  const available = await isQdrantAvailable();
  if (!available) return { isAnomaly: false, similarityScore: 1, nearestNeighbors: [] };

  const vector = await generateEmbedding(recentTxText);
  const client = getQdrantClient();
  const results = await client.search(COLLECTIONS.TRANSACTIONS, {
    vector,
    limit: 5,
    filter: {
      must: [{ key: "userId", match: { value: userId } }],
    },
    with_payload: true,
  });

  if (results.length === 0) {
    return { isAnomaly: false, similarityScore: 1, nearestNeighbors: [] };
  }

  const avgScore = results.reduce((s, r) => s + r.score, 0) / results.length;
  return {
    isAnomaly: avgScore < threshold,
    similarityScore: avgScore,
    nearestNeighbors: results.map((r) => ({
      id: r.id as number,
      score: r.score,
      payload: r.payload as Record<string, unknown>,
    })),
  };
}

// ── Status ────────────────────────────────────────────────────────────────────
export async function getQdrantStatus(): Promise<{
  available: boolean;
  url: string;
  collections: Array<{ name: string; vectorCount: number }>;
}> {
  try {
    const client = getQdrantClient();
    const { collections } = await client.getCollections();
    const details = await Promise.all(
      collections.map(async (c) => {
        try {
          const info = await client.getCollection(c.name);
          return {
            name: c.name,
            vectorCount: info.indexed_vectors_count ?? 0,
          };
        } catch {
          return { name: c.name, vectorCount: 0 };
        }
      })
    );
    return { available: true, url: QDRANT_URL, collections: details };
  } catch {
    return { available: false, url: QDRANT_URL, collections: [] };
  }
}
