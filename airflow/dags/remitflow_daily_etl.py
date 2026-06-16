"""
RemitFlow Daily ETL DAG
Runs daily at 01:00 UTC: extract transactions, transform, load into lakehouse.

Pipeline: PostgreSQL → Bronze (raw) → Silver (cleaned) → Gold (aggregated)
Uses psycopg2 for DB access, PyArrow for Parquet, DuckDB for transforms.
"""
from datetime import datetime, timedelta
import json
import os

from airflow import DAG
from airflow.operators.python import PythonOperator
from airflow.operators.bash import BashOperator

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://remitflow:remitflow123@localhost:5432/remitflow",
)

LAKEHOUSE_PATH = os.environ.get("LAKEHOUSE_PATH", "/data/lakehouse")

default_args = {
    "owner": "remitflow",
    "depends_on_past": False,
    "start_date": datetime(2024, 1, 1),
    "email_on_failure": True,
    "email_on_retry": False,
    "retries": 2,
    "retry_delay": timedelta(minutes=5),
}


def extract_transactions(**context):
    """Extract yesterday's transactions from PostgreSQL into Bronze layer."""
    import psycopg2
    import psycopg2.extras

    execution_date = context["ds"]
    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT t.id, t."userId", t.type, t.status,
                       t."fromAmount"::text as from_amount,
                       t."toAmount"::text as to_amount,
                       t."fromCurrency", t."toCurrency",
                       t."exchangeRate"::text as exchange_rate,
                       t.fee::text as fee,
                       t."createdAt" as created_at
                FROM transactions t
                WHERE t."createdAt"::date = %s::date
                ORDER BY t."createdAt"
                """,
                (execution_date,),
            )
            rows = cur.fetchall()

        bronze_dir = os.path.join(LAKEHOUSE_PATH, "bronze", "transactions", f"date={execution_date}")
        os.makedirs(bronze_dir, exist_ok=True)

        output_path = os.path.join(bronze_dir, "data.json")
        with open(output_path, "w") as f:
            json.dump([dict(r) for r in rows], f, default=str)

        context["ti"].xcom_push(key="row_count", value=len(rows))
        context["ti"].xcom_push(key="bronze_path", value=output_path)
        print(f"Extracted {len(rows)} transactions for {execution_date}")
    finally:
        conn.close()


def transform_to_silver(**context):
    """Clean and normalize Bronze data into Silver layer."""
    execution_date = context["ds"]
    row_count = context["ti"].xcom_pull(key="row_count", task_ids="extract_transactions")

    bronze_path = os.path.join(
        LAKEHOUSE_PATH, "bronze", "transactions", f"date={execution_date}", "data.json"
    )

    if not os.path.exists(bronze_path):
        print(f"No bronze data for {execution_date}, skipping")
        return

    with open(bronze_path) as f:
        raw_data = json.load(f)

    cleaned = []
    for row in raw_data:
        cleaned.append({
            "transaction_id": row["id"],
            "user_id": row["userId"],
            "type": row["type"],
            "status": row["status"],
            "from_amount": float(row.get("from_amount") or 0),
            "to_amount": float(row.get("to_amount") or 0),
            "from_currency": row.get("fromCurrency", "USD"),
            "to_currency": row.get("toCurrency", "NGN"),
            "exchange_rate": float(row.get("exchange_rate") or 0),
            "fee": float(row.get("fee") or 0),
            "created_at": row.get("created_at"),
            "etl_date": execution_date,
        })

    silver_dir = os.path.join(LAKEHOUSE_PATH, "silver", "transactions", f"date={execution_date}")
    os.makedirs(silver_dir, exist_ok=True)

    try:
        import pyarrow as pa
        import pyarrow.parquet as pq

        table = pa.Table.from_pylist(cleaned)
        pq.write_table(table, os.path.join(silver_dir, "data.parquet"))
        print(f"Wrote {len(cleaned)} records to Silver (Parquet)")
    except ImportError:
        output_path = os.path.join(silver_dir, "data.json")
        with open(output_path, "w") as f:
            json.dump(cleaned, f, default=str)
        print(f"Wrote {len(cleaned)} records to Silver (JSON fallback, pyarrow not available)")

    context["ti"].xcom_push(key="silver_count", value=len(cleaned))


def aggregate_to_gold(**context):
    """Aggregate Silver data into Gold layer for analytics."""
    execution_date = context["ds"]

    silver_dir = os.path.join(LAKEHOUSE_PATH, "silver", "transactions", f"date={execution_date}")

    silver_parquet = os.path.join(silver_dir, "data.parquet")
    silver_json = os.path.join(silver_dir, "data.json")

    records = []
    if os.path.exists(silver_parquet):
        try:
            import pyarrow.parquet as pq
            table = pq.read_table(silver_parquet)
            records = table.to_pylist()
        except ImportError:
            pass

    if not records and os.path.exists(silver_json):
        with open(silver_json) as f:
            records = json.load(f)

    if not records:
        print(f"No silver data for {execution_date}")
        return

    # Corridor aggregation
    corridor_stats = {}
    for r in records:
        corridor = f"{r['from_currency']}-{r['to_currency']}"
        if corridor not in corridor_stats:
            corridor_stats[corridor] = {
                "corridor": corridor,
                "transaction_count": 0,
                "total_volume": 0.0,
                "total_fees": 0.0,
                "avg_exchange_rate": 0.0,
                "completed_count": 0,
                "failed_count": 0,
            }
        stats = corridor_stats[corridor]
        stats["transaction_count"] += 1
        stats["total_volume"] += r["from_amount"]
        stats["total_fees"] += r["fee"]
        stats["avg_exchange_rate"] += r["exchange_rate"]
        if r["status"] == "completed":
            stats["completed_count"] += 1
        elif r["status"] == "failed":
            stats["failed_count"] += 1

    for stats in corridor_stats.values():
        if stats["transaction_count"] > 0:
            stats["avg_exchange_rate"] /= stats["transaction_count"]
            stats["success_rate"] = stats["completed_count"] / stats["transaction_count"]

    gold_dir = os.path.join(LAKEHOUSE_PATH, "gold", "corridor_daily", f"date={execution_date}")
    os.makedirs(gold_dir, exist_ok=True)

    with open(os.path.join(gold_dir, "corridor_stats.json"), "w") as f:
        json.dump(list(corridor_stats.values()), f, indent=2)

    print(f"Gold aggregation: {len(corridor_stats)} corridors, {len(records)} transactions")


def update_materialized_views(**context):
    """Refresh PostgreSQL materialized views for dashboard queries."""
    import psycopg2

    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor() as cur:
            views = [
                "daily_corridor_summary",
                "monthly_revenue_summary",
                "user_activity_summary",
            ]
            for view in views:
                try:
                    cur.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {view}")
                    conn.commit()
                    print(f"Refreshed {view}")
                except psycopg2.errors.UndefinedTable:
                    conn.rollback()
                    print(f"View {view} does not exist yet — skipping")
    finally:
        conn.close()


def validate_data_quality(**context):
    """Run data quality checks on Gold layer."""
    execution_date = context["ds"]
    gold_path = os.path.join(
        LAKEHOUSE_PATH, "gold", "corridor_daily", f"date={execution_date}", "corridor_stats.json"
    )

    if not os.path.exists(gold_path):
        print("No gold data to validate")
        return

    with open(gold_path) as f:
        stats = json.load(f)

    issues = []
    for corridor in stats:
        if corridor["total_volume"] < 0:
            issues.append(f"Negative volume in {corridor['corridor']}")
        if corridor.get("success_rate", 1) < 0.5:
            issues.append(f"Low success rate in {corridor['corridor']}: {corridor.get('success_rate', 0):.1%}")

    if issues:
        print(f"Data quality issues: {issues}")
    else:
        print(f"All {len(stats)} corridors passed quality checks")


with DAG(
    "remitflow_daily_etl",
    default_args=default_args,
    description="Daily ETL: PostgreSQL → Bronze → Silver → Gold lakehouse",
    schedule_interval="0 1 * * *",
    catchup=False,
    tags=["remitflow", "etl", "daily", "lakehouse"],
) as dag:

    extract = PythonOperator(
        task_id="extract_transactions",
        python_callable=extract_transactions,
        provide_context=True,
    )

    transform = PythonOperator(
        task_id="transform_to_silver",
        python_callable=transform_to_silver,
        provide_context=True,
    )

    aggregate = PythonOperator(
        task_id="aggregate_to_gold",
        python_callable=aggregate_to_gold,
        provide_context=True,
    )

    refresh_views = PythonOperator(
        task_id="update_materialized_views",
        python_callable=update_materialized_views,
        provide_context=True,
    )

    validate = PythonOperator(
        task_id="validate_data_quality",
        python_callable=validate_data_quality,
        provide_context=True,
    )

    notify = BashOperator(
        task_id="notify_completion",
        bash_command="echo 'Daily ETL complete at $(date) — Bronze→Silver→Gold pipeline finished'",
    )

    extract >> transform >> aggregate >> [refresh_views, validate] >> notify
