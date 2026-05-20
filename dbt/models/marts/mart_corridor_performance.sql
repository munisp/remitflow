-- mart_corridor_performance: Corridor-level KPIs
{{ config(materialized='table', tags=['marts','daily']) }}
with txns as (select * from {{ ref('stg_transactions') }})
select
    corridor,
    from_currency,
    to_currency,
    count(distinct user_id)                                         as unique_senders,
    count(*)                                                        as total_transactions,
    sum(from_amount)                                                as total_volume,
    sum(fee_amount)                                                 as total_revenue,
    avg(fee_amount / nullif(from_amount, 0) * 100)                  as avg_fee_pct,
    count(*) filter (where transaction_status = 'completed')::float
        / nullif(count(*), 0) * 100                                 as completion_rate_pct,
    min(created_at)                                                 as first_transaction_at,
    max(created_at)                                                 as last_transaction_at
from txns
group by 1, 2, 3
order by total_volume desc
