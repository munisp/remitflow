-- mart_daily_volume: Daily transaction volume by corridor
-- Tags: marts, daily
{{ config(materialized='table', tags=['marts','daily']) }}
with txns as (select * from {{ ref('stg_transactions') }})
select
    transaction_date,
    corridor,
    from_currency,
    to_currency,
    count(*)                        as transaction_count,
    sum(from_amount)                as total_from_amount,
    sum(to_amount)                  as total_to_amount,
    sum(fee_amount)                 as total_fees,
    avg(from_amount)                as avg_transaction_amount,
    max(from_amount)                as max_transaction_amount,
    count(*) filter (where transaction_status = 'completed') as completed_count,
    count(*) filter (where transaction_status = 'failed')    as failed_count,
    count(*) filter (where transaction_status = 'pending')   as pending_count
from txns
group by 1, 2, 3, 4
order by 1 desc, 5 desc
