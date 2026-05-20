-- dbt model: revenue_daily
-- Aggregates daily revenue from the transfers_fact Iceberg table.
-- Scheduled to run nightly via Airflow DAG.

{{ config(
    materialized='incremental',
    incremental_strategy='merge',
    unique_key=['revenue_date', 'corridor', 'product'],
    file_format='iceberg',
    partition_by=[{'field': 'revenue_year', 'data_type': 'int'}]
) }}

SELECT
    DATE(created_at)                        AS revenue_date,
    YEAR(created_at)                        AS revenue_year,
    corridor,
    COALESCE(purpose_code, 'UNKNOWN')       AS product,
    COUNT(*)                                AS transfer_count,
    SUM(amount_usd)                         AS total_volume_usd,
    SUM(fee_usd)                            AS fee_income_usd,
    SUM(fx_spread_usd)                      AS fx_spread_usd,
    SUM(amount_usd) * 0.005                 AS float_income_usd,  -- 0.5% float yield estimate
    SUM(fee_usd) + SUM(fx_spread_usd) + SUM(amount_usd) * 0.005 AS total_revenue_usd
FROM {{ source('remitflow', 'transfers_fact') }}
WHERE status = 'COMPLETED'
{% if is_incremental() %}
  AND created_at >= DATE_SUB(CURRENT_DATE(), 2)
{% endif %}
GROUP BY
    DATE(created_at),
    YEAR(created_at),
    corridor,
    COALESCE(purpose_code, 'UNKNOWN')
