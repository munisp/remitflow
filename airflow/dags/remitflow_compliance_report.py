"""
RemitFlow Compliance Report DAG
Runs daily at 06:00 UTC — generates SAR, CTR, and AML reports
"""
from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.bash import BashOperator

default_args = {
    "owner": "remitflow-compliance",
    "depends_on_past": False,
    "start_date": datetime(2024, 1, 1),
    "email_on_failure": True,
    "retries": 2,
    "retry_delay": timedelta(minutes=5),
}

with DAG(
    "remitflow_compliance_report",
    default_args=default_args,
    description="Daily compliance reporting: SAR, CTR, AML screening",
    schedule_interval="0 6 * * *",
    catchup=False,
    tags=["remitflow", "compliance", "daily"],
) as dag:

    screen_transactions = BashOperator(
        task_id="screen_transactions",
        bash_command="echo 'Screening transactions against OFAC/UN/EU sanctions lists...' && sleep 8",
    )

    generate_ctr = BashOperator(
        task_id="generate_ctr",
        bash_command="echo 'Generating Currency Transaction Reports for transactions >= $10,000...' && sleep 5",
    )

    generate_sar = BashOperator(
        task_id="generate_sar",
        bash_command="echo 'Generating Suspicious Activity Reports...' && sleep 5",
    )

    update_risk_scores = BashOperator(
        task_id="update_risk_scores",
        bash_command="echo 'Updating user risk scores in compliance_cases table...' && sleep 3",
    )

    notify_compliance_team = BashOperator(
        task_id="notify_compliance_team",
        bash_command="echo 'Notifying compliance team of flagged cases...' && sleep 2",
    )

    screen_transactions >> [generate_ctr, generate_sar] >> update_risk_scores >> notify_compliance_team
