"""
RemitFlow Fraud Model Retraining DAG
Runs weekly on Sunday at 02:00 UTC
"""
from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.bash import BashOperator

default_args = {
    "owner": "remitflow-ml",
    "depends_on_past": False,
    "start_date": datetime(2024, 1, 1),
    "email_on_failure": True,
    "retries": 1,
    "retry_delay": timedelta(minutes=10),
}

with DAG(
    "remitflow_fraud_model_retrain",
    default_args=default_args,
    description="Weekly fraud model retraining pipeline",
    schedule_interval="0 2 * * 0",
    catchup=False,
    tags=["remitflow", "ml", "fraud", "weekly"],
) as dag:

    prepare_training_data = BashOperator(
        task_id="prepare_training_data",
        bash_command="echo 'Preparing fraud training dataset from mart_fraud_signals...' && sleep 10",
    )

    train_xgboost_model = BashOperator(
        task_id="train_xgboost_model",
        bash_command="echo 'Training XGBoost fraud detection model...' && sleep 30",
    )

    evaluate_model = BashOperator(
        task_id="evaluate_model",
        bash_command="echo 'Evaluating model: AUC, precision, recall, F1...' && sleep 5",
    )

    deploy_model = BashOperator(
        task_id="deploy_model",
        bash_command="echo 'Deploying model to production inference endpoint...' && sleep 5",
    )

    update_qdrant_embeddings = BashOperator(
        task_id="update_qdrant_embeddings",
        bash_command="echo 'Updating Qdrant transaction embeddings with new model...' && sleep 10",
    )

    prepare_training_data >> train_xgboost_model >> evaluate_model >> deploy_model >> update_qdrant_embeddings
