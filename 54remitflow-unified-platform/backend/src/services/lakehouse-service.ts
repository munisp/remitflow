// lakehouse-service.ts - Data Lakehouse Integration
// Handles all analytics data ingestion to lakehouse

import { Pool } from 'pg';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

interface LakehouseEvent {
  table: string;
  data: any;
  timestamp: number;
  partition: string;
}

class LakehouseService {
  private s3Client: S3Client;
  private pgPool: Pool;
  private bucket: string = 'remittance-lakehouse';
  private batchSize: number = 1000;
  private eventBatch: LakehouseEvent[] = [];

  constructor() {
    this.s3Client = new S3Client({ region: 'us-east-1' });
    this.pgPool = new Pool({
      host: process.env.LAKEHOUSE_PG_HOST,
      port: parseInt(process.env.LAKEHOUSE_PG_PORT || '5432'),
      database: process.env.LAKEHOUSE_PG_DB,
      user: process.env.LAKEHOUSE_PG_USER,
      password: process.env.LAKEHOUSE_PG_PASSWORD,
      max: 20,
    });
  }

  async ingestEvent(table: string, data: any): Promise<void> {
    const event: LakehouseEvent = {
      table,
      data,
      timestamp: Date.now(),
      partition: this.getPartition(Date.now()),
    };

    this.eventBatch.push(event);

    if (this.eventBatch.length >= this.batchSize) {
      await this.flush();
    }
  }

  async ingestBatch(table: string, events: any[]): Promise<void> {
    const partition = this.getPartition(Date.now());

    // Write to S3 (Parquet format for lakehouse)
    const key = `${table}/year=${new Date().getFullYear()}/month=${new Date().getMonth() + 1}/day=${new Date().getDate()}/${Date.now()}.json`;
    
    await this.s3Client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: JSON.stringify(events),
      ContentType: 'application/json',
    }));

    // Also write to Postgres for immediate querying
    await this.writeToPostgres(table, events);

    console.log(`[LAKEHOUSE] Ingested ${events.length} events to ${table}`);
  }

  private async writeToPostgres(table: string, events: any[]): Promise<void> {
    const client = await this.pgPool.connect();
    
    try {
      await client.query('BEGIN');

      for (const event of events) {
        const columns = Object.keys(event);
        const values = Object.values(event);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

        const query = `
          INSERT INTO lakehouse.${table} (${columns.join(', ')})
          VALUES (${placeholders})
          ON CONFLICT DO NOTHING
        `;

        await client.query(query, values);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[LAKEHOUSE] Postgres write failed:', error);
    } finally {
      client.release();
    }
  }

  private async flush(): Promise<void> {
    if (this.eventBatch.length === 0) return;

    const batches = new Map<string, any[]>();

    for (const event of this.eventBatch) {
      if (!batches.has(event.table)) {
        batches.set(event.table, []);
      }
      batches.get(event.table)!.push(event.data);
    }

    this.eventBatch = [];

    for (const [table, events] of batches.entries()) {
      await this.ingestBatch(table, events);
    }
  }

  private getPartition(timestamp: number): string {
    const date = new Date(timestamp);
    return `year=${date.getFullYear()}/month=${date.getMonth() + 1}/day=${date.getDate()}`;
  }

  async query(sql: string): Promise<any[]> {
    const client = await this.pgPool.connect();
    try {
      const result = await client.query(sql);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async shutdown(): Promise<void> {
    await this.flush();
    await this.pgPool.end();
  }
}

export default new LakehouseService();
