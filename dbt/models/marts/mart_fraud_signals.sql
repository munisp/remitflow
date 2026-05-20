-- mart_fraud_signals: Aggregated fraud indicators per user
{{ config(materialized='table', tags=['marts','daily']) }}
with txns as (select * from {{ ref('stg_transactions') }}),
user_stats as (
    select
        user_id,
        count(*)                                        as total_txns,
        count(*) filter (where transaction_status = 'failed') as failed_txns,
        count(distinct corridor)                        as corridors_used,
        count(distinct recipient_account)               as unique_recipients,
        sum(from_amount)                                as total_volume,
        max(from_amount)                                as max_single_txn,
        count(*) filter (where value_tier = 'high_value') as high_value_txns
    from txns
    group by 1
)
select
    user_id,
    total_txns,
    failed_txns,
    round(failed_txns::numeric / nullif(total_txns, 0) * 100, 2) as failure_rate_pct,
    corridors_used,
    unique_recipients,
    total_volume,
    max_single_txn,
    high_value_txns,
    case
        when failed_txns::float / nullif(total_txns, 0) > 0.3 then 'high'
        when high_value_txns > 5 then 'medium'
        when corridors_used > 5 then 'medium'
        else 'low'
    end as fraud_risk_tier
from user_stats
