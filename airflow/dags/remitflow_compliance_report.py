"""
RemitFlow Compliance Report DAG
Runs daily at 06:00 UTC — generates SAR, CTR, and AML reports.

Implements real compliance logic:
- Screen transactions against OFAC/UN/EU sanctions lists (DB lookup)
- Generate CTRs for transactions >= $10,000 (FinCEN requirement)
- Generate SARs for flagged/suspicious patterns
- Update user risk scores based on transaction history
- Notify compliance team via webhook/email
"""
from datetime import datetime, timedelta
import json
import os

from airflow import DAG
from airflow.operators.python import PythonOperator

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://remitflow:remitflow123@localhost:5432/remitflow",
)

REPORT_PATH = os.environ.get("REPORT_PATH", "/data/compliance-reports")

default_args = {
    "owner": "remitflow-compliance",
    "depends_on_past": False,
    "start_date": datetime(2024, 1, 1),
    "email_on_failure": True,
    "retries": 2,
    "retry_delay": timedelta(minutes=5),
}


def screen_transactions(**context):
    """Screen yesterday's transactions against sanctions lists in DB."""
    import psycopg2
    import psycopg2.extras

    execution_date = context["ds"]
    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Get all transactions from yesterday
            cur.execute("""
                SELECT t.id, t."userId", t."fromAmount"::text as amount,
                       t."fromCurrency", t."toCurrency",
                       u.name as user_name, u.email,
                       t."createdAt" as created_at
                FROM transactions t
                JOIN users u ON u.id = t."userId"
                WHERE t."createdAt"::date = %s::date
                  AND t.status = 'completed'
                ORDER BY t."createdAt"
            """, (execution_date,))
            transactions = cur.fetchall()

            # Check against sanctions list (stored in DB)
            flagged = []
            for tx in transactions:
                cur.execute("""
                    SELECT id, list_name, match_type FROM sanctions_list
                    WHERE LOWER(name) = LOWER(%s) OR LOWER(name) LIKE LOWER(%s)
                    LIMIT 1
                """, (tx["user_name"], f"%{tx['user_name']}%"))
                match = cur.fetchone()
                if match:
                    flagged.append({
                        "transaction_id": tx["id"],
                        "user_id": tx["userId"],
                        "user_name": tx["user_name"],
                        "amount": tx["amount"],
                        "sanctions_list": match["list_name"],
                        "match_type": match["match_type"],
                    })

            # Also flag transactions from high-risk jurisdictions
            cur.execute("""
                SELECT t.id, t."userId", t."fromAmount"::text as amount,
                       t."toCurrency"
                FROM transactions t
                WHERE t."createdAt"::date = %s::date
                  AND t."toCurrency" IN ('IRR', 'KPW', 'SYP', 'CUP')
            """, (execution_date,))
            high_risk = cur.fetchall()

            for tx in high_risk:
                flagged.append({
                    "transaction_id": tx["id"],
                    "user_id": tx["userId"],
                    "amount": tx["amount"],
                    "reason": f"High-risk jurisdiction: {tx['toCurrency']}",
                })

        context["ti"].xcom_push(key="total_screened", value=len(transactions))
        context["ti"].xcom_push(key="flagged_count", value=len(flagged))
        context["ti"].xcom_push(key="flagged", value=flagged)
        print(f"Screened {len(transactions)} transactions, flagged {len(flagged)}")
    finally:
        conn.close()


def generate_ctr(**context):
    """Generate Currency Transaction Reports for transactions >= $10,000."""
    import psycopg2
    import psycopg2.extras

    execution_date = context["ds"]
    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT t.id, t."userId", t."fromAmount"::float as amount,
                       t."fromCurrency", t."toCurrency",
                       u.name as user_name, u.email,
                       t."createdAt" as created_at
                FROM transactions t
                JOIN users u ON u.id = t."userId"
                WHERE t."createdAt"::date = %s::date
                  AND t."fromAmount"::numeric >= 10000
                  AND t.status = 'completed'
                ORDER BY t."fromAmount"::numeric DESC
            """, (execution_date,))
            large_txs = cur.fetchall()

        report_dir = os.path.join(REPORT_PATH, "ctr", execution_date)
        os.makedirs(report_dir, exist_ok=True)

        ctrs = []
        for tx in large_txs:
            ctrs.append({
                "report_type": "CTR",
                "transaction_id": tx["id"],
                "user_id": tx["userId"],
                "user_name": tx["user_name"],
                "amount": tx["amount"],
                "currency": tx["fromCurrency"],
                "filing_date": execution_date,
                "threshold": 10000,
            })

        with open(os.path.join(report_dir, "ctr_report.json"), "w") as f:
            json.dump(ctrs, f, indent=2, default=str)

        context["ti"].xcom_push(key="ctr_count", value=len(ctrs))
        print(f"Generated {len(ctrs)} CTRs for transactions >= $10,000")
    finally:
        conn.close()


def generate_sar(**context):
    """Generate Suspicious Activity Reports from flagged transactions."""
    flagged = context["ti"].xcom_pull(key="flagged", task_ids="screen_transactions") or []
    execution_date = context["ds"]

    report_dir = os.path.join(REPORT_PATH, "sar", execution_date)
    os.makedirs(report_dir, exist_ok=True)

    sars = []
    for item in flagged:
        sars.append({
            "report_type": "SAR",
            "transaction_id": item.get("transaction_id"),
            "user_id": item.get("user_id"),
            "reason": item.get("reason") or f"Sanctions match: {item.get('sanctions_list', 'unknown')}",
            "amount": item.get("amount"),
            "filing_date": execution_date,
            "priority": "high" if "sanctions_list" in item else "medium",
        })

    with open(os.path.join(report_dir, "sar_report.json"), "w") as f:
        json.dump(sars, f, indent=2)

    context["ti"].xcom_push(key="sar_count", value=len(sars))
    print(f"Generated {len(sars)} SARs")


def update_risk_scores(**context):
    """Update user risk scores based on transaction patterns."""
    import psycopg2

    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor() as cur:
            # Update risk scores based on transaction velocity and volume
            cur.execute("""
                UPDATE users SET "riskScore" = subquery.new_score
                FROM (
                    SELECT t."userId",
                           LEAST(100, GREATEST(0,
                               COALESCE(u."riskScore", 50) +
                               CASE WHEN COUNT(t.id) > 20 THEN 10
                                    WHEN COUNT(t.id) > 10 THEN 5
                                    ELSE 0 END +
                               CASE WHEN MAX(t."fromAmount"::numeric) > 50000 THEN 15
                                    WHEN MAX(t."fromAmount"::numeric) > 10000 THEN 5
                                    ELSE 0 END
                           )) as new_score
                    FROM transactions t
                    JOIN users u ON u.id = t."userId"
                    WHERE t."createdAt" > NOW() - INTERVAL '30 days'
                    GROUP BY t."userId", u."riskScore"
                ) subquery
                WHERE users.id = subquery."userId"
            """)
            updated = cur.rowcount
            conn.commit()

        context["ti"].xcom_push(key="scores_updated", value=updated)
        print(f"Updated {updated} user risk scores")
    except Exception as e:
        conn.rollback()
        print(f"Risk score update skipped: {e}")
    finally:
        conn.close()


def notify_compliance_team(**context):
    """Send compliance summary to team via webhook or log."""
    total_screened = context["ti"].xcom_pull(key="total_screened", task_ids="screen_transactions") or 0
    flagged_count = context["ti"].xcom_pull(key="flagged_count", task_ids="screen_transactions") or 0
    ctr_count = context["ti"].xcom_pull(key="ctr_count", task_ids="generate_ctr") or 0
    sar_count = context["ti"].xcom_pull(key="sar_count", task_ids="generate_sar") or 0
    scores_updated = context["ti"].xcom_pull(key="scores_updated", task_ids="update_risk_scores") or 0

    summary = {
        "date": context["ds"],
        "transactions_screened": total_screened,
        "sanctions_flagged": flagged_count,
        "ctrs_generated": ctr_count,
        "sars_generated": sar_count,
        "risk_scores_updated": scores_updated,
    }

    report_dir = os.path.join(REPORT_PATH, "daily_summary")
    os.makedirs(report_dir, exist_ok=True)
    with open(os.path.join(report_dir, f"{context['ds']}.json"), "w") as f:
        json.dump(summary, f, indent=2)

    # In production: send to Slack/Teams webhook
    webhook_url = os.environ.get("COMPLIANCE_WEBHOOK_URL")
    if webhook_url:
        import urllib.request
        req = urllib.request.Request(
            webhook_url,
            data=json.dumps({"text": f"Daily compliance report: {json.dumps(summary)}"}).encode(),
            headers={"Content-Type": "application/json"},
        )
        try:
            urllib.request.urlopen(req, timeout=10)
        except Exception:
            pass

    print(f"Compliance summary: {json.dumps(summary)}")


with DAG(
    "remitflow_compliance_report",
    default_args=default_args,
    description="Daily compliance reporting: SAR, CTR, AML screening",
    schedule_interval="0 6 * * *",
    catchup=False,
    tags=["remitflow", "compliance", "daily"],
) as dag:

    screen = PythonOperator(
        task_id="screen_transactions",
        python_callable=screen_transactions,
    )

    ctr = PythonOperator(
        task_id="generate_ctr",
        python_callable=generate_ctr,
    )

    sar = PythonOperator(
        task_id="generate_sar",
        python_callable=generate_sar,
    )

    risk = PythonOperator(
        task_id="update_risk_scores",
        python_callable=update_risk_scores,
    )

    notify = PythonOperator(
        task_id="notify_compliance_team",
        python_callable=notify_compliance_team,
    )

    screen >> [ctr, sar] >> risk >> notify
