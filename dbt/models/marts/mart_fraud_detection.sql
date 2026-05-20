-- mart_fraud_detection.sql
-- Comprehensive fraud detection mart combining ML scores, rules, and behavioral signals
-- Feeds the Airflow retraining DAG and the RemitFlow fraud dashboard
-- Refresh: every 4 hours via Airflow DAG remitflow_fraud_model_retrain

{{
  config(
    materialized='incremental',
    unique_key='transaction_id',
    on_schema_change='append_new_columns',
    tags=['fraud', 'ml', 'compliance', 'pii_sensitive']
  )
}}

WITH base_transactions AS (
  SELECT
    t.id                          AS transaction_id,
    t.user_id,
    t.amount,
    t.source_currency,
    t.dest_currency,
    t.source_country,
    t.dest_country,
    t.status,
    t.created_at,
    t.beneficiary_id,
    COALESCE(t.fraud_score, 0)    AS fraud_score,
    t.risk_level,
    t.flagged_reason
  FROM {{ ref('stg_transactions') }} t
  {% if is_incremental() %}
  WHERE t.created_at > (SELECT MAX(created_at) FROM {{ this }})
  {% endif %}
),

user_velocity AS (
  SELECT
    user_id,
    COUNT(*)                                                    AS tx_count_24h,
    SUM(amount)                                                 AS tx_volume_24h,
    COUNT(DISTINCT beneficiary_id)                              AS unique_recipients_24h,
    COUNT(DISTINCT dest_country)                                AS unique_countries_24h,
    COUNT(CASE WHEN status = 'failed' THEN 1 END)               AS failed_count_7d,
    AVG(amount)                                                 AS avg_amount_30d,
    STDDEV(amount)                                              AS stddev_amount_30d,
    MAX(amount)                                                 AS max_amount_30d
  FROM {{ ref('stg_transactions') }}
  WHERE created_at >= NOW() - INTERVAL '30 days'
  GROUP BY user_id
),

corridor_risk AS (
  SELECT
    source_country || '→' || dest_country                      AS corridor,
    COUNT(CASE WHEN fraud_score >= 80 THEN 1 END) * 1.0
      / NULLIF(COUNT(*), 0)                                     AS fraud_rate_30d,
    AVG(amount)                                                 AS corridor_avg_amount,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY amount)        AS corridor_p95_amount
  FROM {{ ref('stg_transactions') }}
  WHERE created_at >= NOW() - INTERVAL '30 days'
  GROUP BY source_country, dest_country
),

structuring_signals AS (
  SELECT
    user_id,
    COUNT(CASE
      WHEN amount BETWEEN 9000 AND 10000 THEN 1
    END)                                                        AS near_threshold_count,
    COUNT(CASE
      WHEN ABS(amount - LAG(amount) OVER (PARTITION BY user_id ORDER BY created_at)) < 1
      THEN 1
    END)                                                        AS repeated_exact_amount_count
  FROM {{ ref('stg_transactions') }}
  WHERE created_at >= NOW() - INTERVAL '7 days'
  GROUP BY user_id
),

final AS (
  SELECT
    bt.transaction_id,
    bt.user_id,
    bt.amount,
    bt.source_currency,
    bt.dest_currency,
    bt.source_country,
    bt.dest_country,
    bt.status,
    bt.created_at,
    bt.fraud_score,
    bt.risk_level,
    bt.flagged_reason,

    -- Velocity features
    COALESCE(uv.tx_count_24h, 0)            AS user_tx_count_24h,
    COALESCE(uv.tx_volume_24h, 0)           AS user_tx_volume_24h,
    COALESCE(uv.unique_recipients_24h, 0)   AS user_unique_recipients_24h,
    COALESCE(uv.unique_countries_24h, 0)    AS user_unique_countries_24h,
    COALESCE(uv.failed_count_7d, 0)         AS user_failed_count_7d,
    COALESCE(uv.avg_amount_30d, 0)          AS user_avg_amount_30d,
    COALESCE(uv.stddev_amount_30d, 0)       AS user_stddev_amount_30d,

    -- Corridor risk
    COALESCE(cr.fraud_rate_30d, 0)          AS corridor_fraud_rate_30d,
    COALESCE(cr.corridor_avg_amount, 0)     AS corridor_avg_amount,
    COALESCE(cr.corridor_p95_amount, 0)     AS corridor_p95_amount,

    -- Structuring signals
    COALESCE(ss.near_threshold_count, 0)    AS near_threshold_count,
    COALESCE(ss.repeated_exact_amount_count, 0) AS repeated_exact_amount_count,

    -- Derived risk flags
    CASE WHEN bt.fraud_score >= 95 THEN TRUE ELSE FALSE END     AS is_critical_risk,
    CASE WHEN bt.fraud_score >= 80 THEN TRUE ELSE FALSE END     AS is_high_risk,
    CASE WHEN COALESCE(uv.tx_count_24h, 0) > 5 THEN TRUE ELSE FALSE END AS velocity_spike,
    CASE WHEN COALESCE(ss.near_threshold_count, 0) >= 2 THEN TRUE ELSE FALSE END AS structuring_flag,

    -- SAR requirement (FinCEN: $5,000+ with suspicion)
    CASE WHEN bt.amount >= 5000 AND bt.fraud_score >= 60 THEN TRUE ELSE FALSE END AS sar_required,

    -- CTR requirement (FinCEN: $10,000+)
    CASE WHEN bt.amount >= 10000 THEN TRUE ELSE FALSE END       AS ctr_required,

    NOW()                                                       AS mart_updated_at

  FROM base_transactions bt
  LEFT JOIN user_velocity uv ON bt.user_id = uv.user_id
  LEFT JOIN corridor_risk cr ON (bt.source_country || '→' || bt.dest_country) = cr.corridor
  LEFT JOIN structuring_signals ss ON bt.user_id = ss.user_id
)

SELECT * FROM final
