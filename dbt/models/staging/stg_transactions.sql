-- stg_transactions: Staged transactions with enriched fields
-- Tags: staging, daily
-- Materialization: view

with source as (
    select * from {{ source('remitflow', 'transactions') }}
),

staged as (
    select
        id                                          as transaction_id,
        "userId"                                    as user_id,
        type                                        as transaction_type,
        status                                      as transaction_status,
        "fromCurrency"                              as from_currency,
        cast("fromAmount" as decimal(18,2))         as from_amount,
        "toCurrency"                                as to_currency,
        cast("toAmount" as decimal(18,2))           as to_amount,
        cast(fee as decimal(18,2))                  as fee_amount,
        cast("fxRate" as decimal(18,6))             as fx_rate,
        reference,
        description,
        "recipientName"                             as recipient_name,
        "recipientAccount"                          as recipient_account,
        "recipientBank"                             as recipient_bank,
        "recipientCountry"                          as recipient_country,
        channel,
        metadata,
        "createdAt"                                 as created_at,
        "updatedAt"                                 as updated_at,
        -- Derived fields
        date_trunc('day', "createdAt")              as transaction_date,
        date_trunc('month', "createdAt")            as transaction_month,
        case
            when cast("fromAmount" as decimal) >= 10000 then 'high_value'
            when cast("fromAmount" as decimal) >= 1000  then 'medium_value'
            else 'low_value'
        end                                         as value_tier,
        concat("fromCurrency", '-', "toCurrency")   as corridor
    from source
)

select * from staged
