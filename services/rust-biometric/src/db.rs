//! PostgreSQL persistence for biometric embeddings (table created by
//! drizzle/0095_kyc_wave15.sql; the CREATE here is an idempotent safety net,
//! byte-identical in shape to the migration — additive only).
//!
//! Cosine similarity is computed IN SQL over `double precision[]` because
//! pgvector is deferred (infra TODO in 0095). All embeddings are stored
//! L2-normalized, so cosine == dot product.

use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::time::Duration;

#[derive(Clone)]
pub struct Db {
    pool: PgPool,
}

/// One row of a dedup scan result.
#[derive(Debug, Clone)]
pub struct ScanMatch {
    pub user_id: i32,
    pub similarity: f64,
}

impl Db {
    pub async fn connect(url: &str) -> Result<Db, sqlx::Error> {
        let pool = PgPoolOptions::new()
            .max_connections(8)
            .acquire_timeout(Duration::from_secs(5))
            .connect(url)
            .await?;
        let db = Db { pool };
        db.ensure_table().await?;
        Ok(db)
    }

    /// Idempotent safety net — the authoritative DDL lives in
    /// drizzle/0095_kyc_wave15.sql. IF NOT EXISTS only; never alters.
    async fn ensure_table(&self) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"CREATE TABLE IF NOT EXISTS biometric_embeddings (
                 id bigserial PRIMARY KEY,
                 "userId" integer NOT NULL UNIQUE,
                 model varchar(32) NOT NULL,
                 embedding double precision[] NOT NULL,
                 source varchar(24),
                 created_at timestamptz NOT NULL DEFAULT now(),
                 updated_at timestamptz NOT NULL DEFAULT now()
               )"#,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn ping(&self) -> bool {
        sqlx::query("SELECT 1").execute(&self.pool).await.is_ok()
    }

    /// Enroll / re-enroll: upsert on the UNIQUE "userId".
    pub async fn upsert(
        &self,
        user_id: i32,
        model: &str,
        embedding: &[f64],
        source: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"INSERT INTO biometric_embeddings ("userId", model, embedding, source)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT ("userId") DO UPDATE SET
                 model      = EXCLUDED.model,
                 embedding  = EXCLUDED.embedding,
                 source     = EXCLUDED.source,
                 updated_at = now()"#,
        )
        .bind(user_id)
        .bind(model)
        .bind(embedding)
        .bind(source)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Fetch a user's stored embedding (model label + vector).
    pub async fn get(&self, user_id: i32) -> Result<Option<(String, Vec<f64>)>, sqlx::Error> {
        let row: Option<(String, Vec<f64>)> = sqlx::query_as(
            r#"SELECT model, embedding FROM biometric_embeddings WHERE "userId" = $1"#,
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    pub async fn count(&self) -> Result<i64, sqlx::Error> {
        let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM biometric_embeddings")
            .fetch_one(&self.pool)
            .await?;
        Ok(n)
    }

    /// 1:N cosine scan in SQL (no pgvector): dot product over the array
    /// elements via generate_subscripts. Embeddings are L2-normalized on
    /// write, so the dot product IS the cosine. Only rows of the same model
    /// and same dimensionality are comparable — everything else is excluded.
    pub async fn scan(
        &self,
        probe: &[f64],
        model: &str,
        min_similarity: f64,
        limit: i64,
    ) -> Result<Vec<ScanMatch>, sqlx::Error> {
        let rows: Vec<(i32, f64)> = sqlx::query_as(
            r#"SELECT user_id, similarity FROM (
                 SELECT "userId" AS user_id,
                        (SELECT SUM(embedding[i] * ($1::float8[])[i])
                           FROM generate_subscripts(embedding, 1) AS g(i))::float8 AS similarity
                 FROM biometric_embeddings
                 WHERE model = $2
                   AND cardinality(embedding) = array_length($1::float8[], 1)
               ) t
               WHERE similarity IS NOT NULL AND similarity >= $3
               ORDER BY similarity DESC
               LIMIT $4"#,
        )
        .bind(probe)
        .bind(model)
        .bind(min_similarity)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(user_id, similarity)| ScanMatch {
                user_id,
                similarity,
            })
            .collect())
    }
}
