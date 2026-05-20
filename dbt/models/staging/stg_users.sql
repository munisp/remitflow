-- stg_users: Staged users with risk profile fields
with source as (select * from {{ source('remitflow', 'users') }}),
staged as (
    select
        id as user_id, name, email, role,
        "kycStatus" as kyc_status,
        "createdAt" as created_at,
        date_trunc('month', "createdAt") as signup_month
    from source
)
select * from staged
