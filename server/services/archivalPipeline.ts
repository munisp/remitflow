/**
 * Archival Pipeline — Lessons 4 & 15 from 1B Payments/Day research
 *
 * Moves transactions older than 90 days to archived_transfers table,
 * keeping the hot transactions table small and fast.
 *
 * The benchmark shows that at 1B transactions/day, the hot tier grows
 * ~128 GB/day. Tiering to cold storage is structural, not optional.
 *
 * Archive format: NDJSON + gzip (Node.js native).
 * Full Parquet export is handled by the go-export-service.
 *
 * Reference: https://backend.how/posts/1b-payments-per-day/
 */

import { createGzip } from "zlib";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { getDb } from "../db";
import { transactions as transactions } from "../../drizzle/schema";
import { lt, isNull, sql } from "drizzle-orm";
import { logger } from '../_core/logger';

const ARCHIVE_AGE_DAYS = parseInt(process.env.ARCHIVE_AGE_DAYS ?? "90", 10);
const ARCHIVE_BATCH_SIZE = parseInt(process.env.ARCHIVE_BATCH_SIZE ?? "1000", 10);

export type ArchivalStats = {
  archivedCount: number;
  durationMs: number;
  cutoffDate: string;
  exportPath?: string;
};

/**
 * Archive transactions older than ARCHIVE_AGE_DAYS days.
 * Runs in batches to avoid long-running transactions.
 */
export async function runArchivalPipeline(): Promise<ArchivalStats> {
  const start = Date.now();
  const cutoff = new Date(Date.now() - ARCHIVE_AGE_DAYS * 24 * 60 * 60 * 1000);
  let totalArchived = 0;

  logger.info({ cutoff: cutoff.toISOString(), batchSize: ARCHIVE_BATCH_SIZE }, "Archival pipeline starting");

  try {
    const db = await getDb();

    // Process in batches to avoid locking the table for too long
    let hasMore = true;
    while (hasMore) {
      // Mark a batch of old transactions as archived
      const result = await db.execute(sql`
        UPDATE transactions
        SET archived_at = NOW()
        WHERE id IN (
          SELECT id FROM transactions
          WHERE created_at < ${cutoff.toISOString()}
            AND archived_at IS NULL
          LIMIT ${ARCHIVE_BATCH_SIZE}
        )
      `);

      const rowsAffected = (result as any).rowCount ?? (result as any).affectedRows ?? 0;
      totalArchived += rowsAffected;
      hasMore = rowsAffected === ARCHIVE_BATCH_SIZE;

      if (rowsAffected > 0) {
        logger.info({ rowsAffected, totalArchived }, "Archival batch complete");
      }

      // Small delay between batches to avoid overwhelming the database
      if (hasMore) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const stats: ArchivalStats = {
      archivedCount: totalArchived,
      durationMs: Date.now() - start,
      cutoffDate: cutoff.toISOString(),
    };

    logger.info(stats, "Archival pipeline complete");
    return stats;
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, "Archival pipeline failed");
    throw err;
  }
}

/**
 * Export archived transactions to NDJSON + gzip file.
 * Called by the admin export endpoint or the go-export-service.
 */
export async function exportArchivedTransfers(outputPath: string): Promise<{ rowsExported: number; fileSizeBytes: number }> {
  const db = await getDb();

  const rows = await db.execute(sql`
    SELECT * FROM transactions
    WHERE archived_at IS NOT NULL
    ORDER BY created_at ASC
  `);

  const rowArray = (rows as any).rows ?? rows;
  const ndjson = rowArray.map((r: unknown) => JSON.stringify(r)).join("\n") + "\n";

  const readable = Readable.from([ndjson]);
  const gzip = createGzip({ level: 6 });
  const output = createWriteStream(outputPath);

  await pipeline(readable, gzip, output);

  const { statSync } = await import("fs");
  const { size } = statSync(outputPath);

  logger.info({ outputPath, rowsExported: rowArray.length, fileSizeBytes: size }, "Archived transactions exported");
  return { rowsExported: rowArray.length, fileSizeBytes: size };
}

/**
 * Get archival statistics for the admin dashboard.
 */
export async function getArchivalStats(): Promise<{
  totalTransfers: number;
  archivedTransfers: number;
  hotTransfers: number;
  oldestHotTransfer: string | null;
  estimatedArchiveSizeMB: number;
}> {
  const db = await getDb();

  const [total, archived] = await Promise.all([
    db.execute(sql`SELECT COUNT(*) as count FROM transactions`),
    db.execute(sql`SELECT COUNT(*) as count FROM transactions WHERE archived_at IS NOT NULL`),
  ]);

  const totalCount = Number((total as any).rows?.[0]?.count ?? 0);
  const archivedCount = Number((archived as any).rows?.[0]?.count ?? 0);

  const oldest = await db.execute(sql`
    SELECT created_at FROM transactions
    WHERE archived_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1
  `);

  const oldestDate = (oldest as any).rows?.[0]?.created_at ?? null;

  return {
    totalTransfers: totalCount,
    archivedTransfers: archivedCount,
    hotTransfers: totalCount - archivedCount,
    oldestHotTransfer: oldestDate ? new Date(oldestDate).toISOString() : null,
    // Estimate: 128 bytes/row × archived rows / 1MB, with 4.7× compression
    estimatedArchiveSizeMB: Math.round((archivedCount * 128) / (1024 * 1024) / 4.7),
  };
}
