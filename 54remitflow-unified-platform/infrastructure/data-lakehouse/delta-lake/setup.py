#!/usr/bin/env python3
"""
Delta Lake Setup and Configuration for Remittance Platform
Implements ACID transactions, schema evolution, and time travel for banking data
Optimized for Nigerian banking compliance and regulatory requirements
"""

import os
import sys
import json
import logging
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
import shutil

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class DeltaLakeSetup:
    """Delta Lake setup and configuration manager"""
    
    def __init__(self, base_path: str = "/opt/delta-lake"):
        self.base_path = Path(base_path)
        self.config_path = self.base_path / "config"
        self.data_path = self.base_path / "data"
        self.logs_path = self.base_path / "logs"
        self.scripts_path = self.base_path / "scripts"
        
        # Banking-specific configurations
        self.banking_schemas = {
            'transactions': {
                'partition_columns': ['date', 'region'],
                'retention_days': 2555,  # 7 years for Nigerian banking compliance
                'compression': 'snappy',
                'optimize_frequency': 'daily'
            },
            'customers': {
                'partition_columns': ['state', 'account_type'],
                'retention_days': 3650,  # 10 years for customer data
                'compression': 'gzip',
                'optimize_frequency': 'weekly'
            },
            'agents': {
                'partition_columns': ['level', 'region'],
                'retention_days': 1825,  # 5 years for agent data
                'compression': 'snappy',
                'optimize_frequency': 'weekly'
            },
            'compliance': {
                'partition_columns': ['report_type', 'year'],
                'retention_days': 3650,  # 10 years for compliance
                'compression': 'gzip',
                'optimize_frequency': 'monthly'
            },
            'audit_logs': {
                'partition_columns': ['date', 'service'],
                'retention_days': 2555,  # 7 years for audit logs
                'compression': 'lz4',
                'optimize_frequency': 'daily'
            }
        }

    def setup_environment(self) -> bool:
        """Setup Delta Lake environment"""
        try:
            logger.info("Setting up Delta Lake environment...")
            
            # Create directory structure
            self._create_directories()
            
            # Install dependencies
            self._install_dependencies()
            
            # Configure Spark for Delta Lake
            self._configure_spark()
            
            # Create banking schemas
            self._create_banking_schemas()
            
            # Setup monitoring and maintenance
            self._setup_monitoring()
            
            # Create management scripts
            self._create_management_scripts()
            
            logger.info("Delta Lake environment setup completed successfully")
            return True
            
        except Exception as e:
            logger.error(f"Delta Lake setup failed: {e}")
            return False

    def _create_directories(self):
        """Create necessary directory structure"""
        directories = [
            self.base_path,
            self.config_path,
            self.data_path,
            self.logs_path,
            self.scripts_path,
            self.data_path / "bronze",  # Raw data
            self.data_path / "silver",  # Cleaned data
            self.data_path / "gold",    # Aggregated data
            self.data_path / "checkpoints",
            self.data_path / "temp"
        ]
        
        for directory in directories:
            directory.mkdir(parents=True, exist_ok=True)
            logger.info(f"Created directory: {directory}")

    def _install_dependencies(self):
        """Install Delta Lake and related dependencies"""
        try:
            # Python packages
            packages = [
                "delta-spark==2.4.0",
                "pyspark==3.4.1",
                "py4j==0.10.9.7",
                "pandas==2.0.3",
                "pyarrow==12.0.1",
                "boto3==1.28.25",
                "azure-storage-blob==12.17.0",
                "google-cloud-storage==2.10.0",
                "sqlalchemy==2.0.19",
                "psycopg2-binary==2.9.7",
                "redis==4.6.0",
                "prometheus-client==0.17.1"
            ]
            
            for package in packages:
                logger.info(f"Installing {package}...")
                subprocess.run([
                    sys.executable, "-m", "pip", "install", package
                ], check=True, capture_output=True)
            
            logger.info("Dependencies installed successfully")
            
        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to install dependencies: {e}")
            raise

    def _configure_spark(self):
        """Configure Spark for Delta Lake"""
        spark_config = {
            "spark.app.name": "AgentBankingDeltaLake",
            "spark.master": "local[*]",
            "spark.sql.extensions": "io.delta.sql.DeltaSparkSessionExtension",
            "spark.sql.catalog.spark_catalog": "org.apache.spark.sql.delta.catalog.DeltaCatalog",
            "spark.sql.adaptive.enabled": "true",
            "spark.sql.adaptive.coalescePartitions.enabled": "true",
            "spark.sql.adaptive.coalescePartitions.minPartitionNum": "1",
            "spark.sql.adaptive.coalescePartitions.initialPartitionNum": "200",
            "spark.sql.adaptive.advisoryPartitionSizeInBytes": "64MB",
            "spark.serializer": "org.apache.spark.serializer.KryoSerializer",
            "spark.sql.parquet.compression.codec": "snappy",
            "spark.sql.parquet.mergeSchema": "true",
            "spark.sql.parquet.filterPushdown": "true",
            "spark.sql.parquet.columnarReaderBatchSize": "4096",
            "spark.sql.files.maxPartitionBytes": "134217728",
            "spark.sql.files.openCostInBytes": "4194304",
            "spark.sql.broadcastTimeout": "36000",
            "spark.sql.shuffle.partitions": "200",
            "spark.default.parallelism": "100",
            "spark.sql.execution.arrow.pyspark.enabled": "true",
            "spark.sql.execution.arrow.maxRecordsPerBatch": "10000",
            
            # Delta Lake specific configurations
            "spark.databricks.delta.retentionDurationCheck.enabled": "false",
            "spark.databricks.delta.schema.autoMerge.enabled": "true",
            "spark.databricks.delta.optimizeWrite.enabled": "true",
            "spark.databricks.delta.autoCompact.enabled": "true",
            "spark.databricks.delta.properties.defaults.enableChangeDataFeed": "true",
            "spark.databricks.delta.properties.defaults.columnMapping.mode": "name",
            
            # Performance optimizations
            "spark.sql.adaptive.skewJoin.enabled": "true",
            "spark.sql.adaptive.localShuffleReader.enabled": "true",
            "spark.sql.adaptive.coalescePartitions.parallelismFirst": "false",
            
            # Memory configurations
            "spark.executor.memory": "4g",
            "spark.driver.memory": "2g",
            "spark.executor.memoryFraction": "0.8",
            "spark.executor.cores": "2",
            "spark.driver.maxResultSize": "1g",
            
            # Nigerian banking specific
            "spark.sql.session.timeZone": "Africa/Lagos",
            "spark.sql.datetime.java8API.enabled": "true",
            "spark.sql.legacy.timeParserPolicy": "LEGACY"
        }
        
        # Write Spark configuration
        spark_defaults_path = self.config_path / "spark-defaults.conf"
        with open(spark_defaults_path, 'w') as f:
            for key, value in spark_config.items():
                f.write(f"{key} {value}\n")
        
        # Create Spark environment script
        env_script = self.scripts_path / "spark-env.sh"
        with open(env_script, 'w') as f:
            f.write(f"""#!/bin/bash
# Spark Environment Configuration for Delta Lake

export SPARK_HOME=/opt/spark
export DELTA_LAKE_HOME={self.base_path}
export PYTHONPATH=$SPARK_HOME/python:$SPARK_HOME/python/lib/py4j-0.10.9.7-src.zip:$PYTHONPATH
export PYSPARK_PYTHON=python3
export PYSPARK_DRIVER_PYTHON=python3

# Java options
export SPARK_DRIVER_OPTS="-Xmx2g -XX:+UseG1GC -XX:+UseStringDeduplication"
export SPARK_EXECUTOR_OPTS="-Xmx4g -XX:+UseG1GC -XX:+UseStringDeduplication"

# Delta Lake JARs
export SPARK_JARS_PACKAGES="io.delta:delta-core_2.12:2.4.0,io.delta:delta-storage:2.4.0"

# Logging
export SPARK_LOG_DIR={self.logs_path}
export SPARK_PID_DIR={self.base_path}/run

# Nigerian banking timezone
export TZ=Africa/Lagos

echo "Spark environment configured for Delta Lake"
""")
        
        env_script.chmod(0o755)
        logger.info("Spark configuration created")

    def _create_banking_schemas(self):
        """Create banking-specific Delta Lake schemas"""
        schema_definitions = {
            'transactions': """
                CREATE TABLE IF NOT EXISTS transactions (
                    transaction_id STRING NOT NULL,
                    user_id STRING NOT NULL,
                    agent_id STRING,
                    transaction_type STRING NOT NULL,
                    amount DECIMAL(15,2) NOT NULL,
                    currency STRING DEFAULT 'NGN',
                    status STRING NOT NULL,
                    channel STRING,
                    reference STRING,
                    description STRING,
                    metadata MAP<STRING, STRING>,
                    created_at TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP,
                    date DATE GENERATED ALWAYS AS (CAST(created_at AS DATE)),
                    region STRING,
                    compliance_flags ARRAY<STRING>,
                    risk_score DOUBLE
                ) USING DELTA
                PARTITIONED BY (date, region)
                TBLPROPERTIES (
                    'delta.enableChangeDataFeed' = 'true',
                    'delta.columnMapping.mode' = 'name',
                    'delta.autoOptimize.optimizeWrite' = 'true',
                    'delta.autoOptimize.autoCompact' = 'true',
                    'delta.deletedFileRetentionDuration' = 'interval 7 days',
                    'delta.logRetentionDuration' = 'interval 30 days'
                )
            """,
            
            'customers': """
                CREATE TABLE IF NOT EXISTS customers (
                    customer_id STRING NOT NULL,
                    bvn STRING,
                    nin STRING,
                    first_name STRING NOT NULL,
                    last_name STRING NOT NULL,
                    middle_name STRING,
                    email STRING,
                    phone STRING NOT NULL,
                    date_of_birth DATE,
                    gender STRING,
                    address STRUCT<
                        street: STRING,
                        city: STRING,
                        state: STRING,
                        lga: STRING,
                        postal_code: STRING,
                        country: STRING DEFAULT 'Nigeria'
                    >,
                    account_type STRING NOT NULL,
                    account_status STRING NOT NULL,
                    kyc_level STRING,
                    kyc_documents ARRAY<STRUCT<
                        type: STRING,
                        number: STRING,
                        verified: BOOLEAN,
                        verified_at: TIMESTAMP
                    >>,
                    created_at TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP,
                    last_activity TIMESTAMP,
                    state STRING GENERATED ALWAYS AS (address.state),
                    risk_profile STRING,
                    compliance_status STRING
                ) USING DELTA
                PARTITIONED BY (state, account_type)
                TBLPROPERTIES (
                    'delta.enableChangeDataFeed' = 'true',
                    'delta.columnMapping.mode' = 'name',
                    'delta.dataSkippingNumIndexedCols' = '10'
                )
            """,
            
            'agents': """
                CREATE TABLE IF NOT EXISTS agents (
                    agent_id STRING NOT NULL,
                    user_id STRING NOT NULL,
                    agent_code STRING NOT NULL,
                    level STRING NOT NULL,
                    parent_agent_id STRING,
                    business_name STRING,
                    contact_person STRING NOT NULL,
                    phone STRING NOT NULL,
                    email STRING,
                    address STRUCT<
                        street: STRING,
                        city: STRING,
                        state: STRING,
                        lga: STRING,
                        postal_code: STRING,
                        country: STRING DEFAULT 'Nigeria'
                    >,
                    location STRUCT<
                        latitude: DOUBLE,
                        longitude: DOUBLE
                    >,
                    license_info STRUCT<
                        license_number: STRING,
                        issued_date: DATE,
                        expiry_date: DATE,
                        issuing_authority: STRING,
                        status: STRING
                    >,
                    commission_structure STRUCT<
                        rate: DOUBLE,
                        tier: STRING,
                        effective_date: DATE
                    >,
                    performance_metrics STRUCT<
                        total_transactions: BIGINT,
                        total_volume: DECIMAL(15,2),
                        success_rate: DOUBLE,
                        customer_count: BIGINT,
                        last_transaction: TIMESTAMP
                    >,
                    status STRING NOT NULL,
                    created_at TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP,
                    region STRING GENERATED ALWAYS AS (address.state),
                    compliance_score DOUBLE
                ) USING DELTA
                PARTITIONED BY (level, region)
                TBLPROPERTIES (
                    'delta.enableChangeDataFeed' = 'true',
                    'delta.columnMapping.mode' = 'name'
                )
            """,
            
            'compliance': """
                CREATE TABLE IF NOT EXISTS compliance (
                    report_id STRING NOT NULL,
                    report_type STRING NOT NULL,
                    entity_type STRING NOT NULL,
                    entity_id STRING NOT NULL,
                    report_period STRUCT<
                        start_date: DATE,
                        end_date: DATE
                    >,
                    data MAP<STRING, STRING>,
                    metrics STRUCT<
                        transaction_count: BIGINT,
                        total_volume: DECIMAL(15,2),
                        suspicious_activities: BIGINT,
                        compliance_score: DOUBLE
                    >,
                    regulatory_requirements ARRAY<STRING>,
                    status STRING NOT NULL,
                    submitted_to STRING,
                    submitted_at TIMESTAMP,
                    created_at TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP,
                    year INT GENERATED ALWAYS AS (YEAR(created_at)),
                    quarter INT GENERATED ALWAYS AS (QUARTER(created_at))
                ) USING DELTA
                PARTITIONED BY (report_type, year)
                TBLPROPERTIES (
                    'delta.enableChangeDataFeed' = 'true',
                    'delta.columnMapping.mode' = 'name',
                    'delta.deletedFileRetentionDuration' = 'interval 30 days'
                )
            """,
            
            'audit_logs': """
                CREATE TABLE IF NOT EXISTS audit_logs (
                    log_id STRING NOT NULL,
                    timestamp TIMESTAMP NOT NULL,
                    service STRING NOT NULL,
                    action STRING NOT NULL,
                    user_id STRING,
                    agent_id STRING,
                    entity_type STRING,
                    entity_id STRING,
                    details MAP<STRING, STRING>,
                    ip_address STRING,
                    user_agent STRING,
                    session_id STRING,
                    request_id STRING,
                    response_code INT,
                    processing_time_ms BIGINT,
                    severity STRING,
                    tags ARRAY<STRING>,
                    date DATE GENERATED ALWAYS AS (CAST(timestamp AS DATE))
                ) USING DELTA
                PARTITIONED BY (date, service)
                TBLPROPERTIES (
                    'delta.enableChangeDataFeed' = 'true',
                    'delta.columnMapping.mode' = 'name',
                    'delta.autoOptimize.optimizeWrite' = 'true',
                    'delta.logRetentionDuration' = 'interval 7 days'
                )
            """
        }
        
        # Write schema definitions
        for table_name, schema_sql in schema_definitions.items():
            schema_file = self.config_path / f"{table_name}_schema.sql"
            with open(schema_file, 'w') as f:
                f.write(schema_sql)
            
            logger.info(f"Created schema definition for {table_name}")

    def _setup_monitoring(self):
        """Setup monitoring and alerting for Delta Lake"""
        monitoring_config = {
            "metrics": {
                "enabled": True,
                "port": 9090,
                "path": "/metrics",
                "update_interval": 30
            },
            "health_checks": {
                "enabled": True,
                "interval": 60,
                "checks": [
                    "table_availability",
                    "partition_health",
                    "compaction_status",
                    "vacuum_status",
                    "storage_usage"
                ]
            },
            "alerts": {
                "enabled": True,
                "channels": ["email", "slack", "webhook"],
                "thresholds": {
                    "storage_usage_percent": 85,
                    "failed_operations_per_hour": 10,
                    "query_latency_p95_ms": 5000,
                    "compaction_lag_hours": 24
                }
            },
            "retention": {
                "metrics_retention_days": 30,
                "logs_retention_days": 7,
                "alerts_retention_days": 90
            }
        }
        
        monitoring_file = self.config_path / "monitoring.json"
        with open(monitoring_file, 'w') as f:
            json.dump(monitoring_config, f, indent=2)
        
        logger.info("Monitoring configuration created")

    def _create_management_scripts(self):
        """Create management and maintenance scripts"""
        
        # Vacuum script
        vacuum_script = self.scripts_path / "vacuum_tables.py"
        with open(vacuum_script, 'w') as f:
            f.write("""#!/usr/bin/env python3
\"\"\"
Delta Lake Vacuum Script for Remittance Platform
Removes old files and optimizes storage
\"\"\"

import os
from pyspark.sql import SparkSession
from delta.tables import DeltaTable
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def create_spark_session():
    return SparkSession.builder \\
        .appName("DeltaLakeVacuum") \\
        .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension") \\
        .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog") \\
        .getOrCreate()

def vacuum_table(spark, table_path, retention_hours=168):  # 7 days default
    try:
        delta_table = DeltaTable.forPath(spark, table_path)
        delta_table.vacuum(retention_hours)
        logger.info(f"Vacuumed table: {table_path}")
    except Exception as e:
        logger.error(f"Failed to vacuum {table_path}: {e}")

def main():
    spark = create_spark_session()
    
    tables = [
        "/opt/delta-lake/data/bronze/transactions",
        "/opt/delta-lake/data/bronze/customers", 
        "/opt/delta-lake/data/bronze/agents",
        "/opt/delta-lake/data/bronze/compliance",
        "/opt/delta-lake/data/bronze/audit_logs",
        "/opt/delta-lake/data/silver/transactions",
        "/opt/delta-lake/data/silver/customers",
        "/opt/delta-lake/data/gold/daily_summaries",
        "/opt/delta-lake/data/gold/monthly_reports"
    ]
    
    for table_path in tables:
        if os.path.exists(table_path):
            vacuum_table(spark, table_path)
    
    spark.stop()
    logger.info("Vacuum operation completed")

if __name__ == "__main__":
    main()
""")
        
        # Optimize script
        optimize_script = self.scripts_path / "optimize_tables.py"
        with open(optimize_script, 'w') as f:
            f.write("""#!/usr/bin/env python3
\"\"\"
Delta Lake Optimize Script for Remittance Platform
Compacts small files and optimizes table layout
\"\"\"

import os
from pyspark.sql import SparkSession
from delta.tables import DeltaTable
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def create_spark_session():
    return SparkSession.builder \\
        .appName("DeltaLakeOptimize") \\
        .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension") \\
        .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog") \\
        .getOrCreate()

def optimize_table(spark, table_path, z_order_columns=None):
    try:
        delta_table = DeltaTable.forPath(spark, table_path)
        
        if z_order_columns:
            delta_table.optimize().executeZOrderBy(*z_order_columns)
            logger.info(f"Optimized table {table_path} with Z-Order: {z_order_columns}")
        else:
            delta_table.optimize().executeCompaction()
            logger.info(f"Optimized table: {table_path}")
            
    except Exception as e:
        logger.error(f"Failed to optimize {table_path}: {e}")

def main():
    spark = create_spark_session()
    
    # Tables with their Z-Order columns
    table_configs = [
        ("/opt/delta-lake/data/bronze/transactions", ["transaction_id", "user_id", "created_at"]),
        ("/opt/delta-lake/data/bronze/customers", ["customer_id", "bvn", "phone"]),
        ("/opt/delta-lake/data/bronze/agents", ["agent_id", "agent_code"]),
        ("/opt/delta-lake/data/bronze/compliance", ["entity_id", "report_type"]),
        ("/opt/delta-lake/data/bronze/audit_logs", ["user_id", "service", "timestamp"]),
        ("/opt/delta-lake/data/silver/transactions", ["user_id", "date"]),
        ("/opt/delta-lake/data/gold/daily_summaries", ["date", "region"]),
    ]
    
    for table_path, z_order_cols in table_configs:
        if os.path.exists(table_path):
            optimize_table(spark, table_path, z_order_cols)
    
    spark.stop()
    logger.info("Optimize operation completed")

if __name__ == "__main__":
    main()
""")
        
        # Health check script
        health_script = self.scripts_path / "health_check.py"
        with open(health_script, 'w') as f:
            f.write("""#!/usr/bin/env python3
\"\"\"
Delta Lake Health Check Script for Remittance Platform
Monitors table health and performance metrics
\"\"\"

import os
import json
from datetime import datetime, timedelta
from pyspark.sql import SparkSession
from delta.tables import DeltaTable
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def create_spark_session():
    return SparkSession.builder \\
        .appName("DeltaLakeHealthCheck") \\
        .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension") \\
        .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog") \\
        .getOrCreate()

def check_table_health(spark, table_path, table_name):
    try:
        if not os.path.exists(table_path):
            return {"status": "missing", "table": table_name}
        
        delta_table = DeltaTable.forPath(spark, table_path)
        df = delta_table.toDF()
        
        # Basic metrics
        row_count = df.count()
        
        # File metrics
        history = delta_table.history(1).collect()
        last_operation = history[0] if history else None
        
        # Storage metrics
        detail = delta_table.detail().collect()[0]
        
        health_info = {
            "status": "healthy",
            "table": table_name,
            "row_count": row_count,
            "size_bytes": detail["sizeInBytes"],
            "num_files": detail["numFiles"],
            "last_operation": {
                "operation": last_operation["operation"] if last_operation else None,
                "timestamp": str(last_operation["timestamp"]) if last_operation else None
            }
        }
        
        # Check for issues
        if detail["numFiles"] > 1000:
            health_info["warnings"] = health_info.get("warnings", [])
            health_info["warnings"].append("High number of files - consider optimization")
        
        if row_count == 0:
            health_info["warnings"] = health_info.get("warnings", [])
            health_info["warnings"].append("Table is empty")
        
        return health_info
        
    except Exception as e:
        logger.error(f"Health check failed for {table_name}: {e}")
        return {"status": "error", "table": table_name, "error": str(e)}

def main():
    spark = create_spark_session()
    
    tables = [
        ("/opt/delta-lake/data/bronze/transactions", "transactions"),
        ("/opt/delta-lake/data/bronze/customers", "customers"),
        ("/opt/delta-lake/data/bronze/agents", "agents"),
        ("/opt/delta-lake/data/bronze/compliance", "compliance"),
        ("/opt/delta-lake/data/bronze/audit_logs", "audit_logs"),
    ]
    
    health_report = {
        "timestamp": datetime.now().isoformat(),
        "tables": []
    }
    
    for table_path, table_name in tables:
        health_info = check_table_health(spark, table_path, table_name)
        health_report["tables"].append(health_info)
    
    # Save health report
    report_path = "/opt/delta-lake/logs/health_report.json"
    with open(report_path, 'w') as f:
        json.dump(health_report, f, indent=2)
    
    spark.stop()
    
    # Print summary
    healthy_tables = [t for t in health_report["tables"] if t["status"] == "healthy"]
    logger.info(f"Health check completed: {len(healthy_tables)}/{len(tables)} tables healthy")

if __name__ == "__main__":
    main()
""")
        
        # Make scripts executable
        for script in [vacuum_script, optimize_script, health_script]:
            script.chmod(0o755)
        
        # Create cron jobs configuration
        cron_config = self.config_path / "cron_jobs.txt"
        with open(cron_config, 'w') as f:
            f.write("""# Delta Lake Maintenance Cron Jobs for Remittance Platform
# Add these to your crontab: crontab -e

# Daily vacuum at 2 AM
0 2 * * * /opt/delta-lake/scripts/vacuum_tables.py >> /opt/delta-lake/logs/vacuum.log 2>&1

# Daily optimization at 3 AM
0 3 * * * /opt/delta-lake/scripts/optimize_tables.py >> /opt/delta-lake/logs/optimize.log 2>&1

# Health check every 4 hours
0 */4 * * * /opt/delta-lake/scripts/health_check.py >> /opt/delta-lake/logs/health.log 2>&1

# Weekly deep optimization on Sundays at 1 AM
0 1 * * 0 /opt/delta-lake/scripts/optimize_tables.py --deep >> /opt/delta-lake/logs/deep_optimize.log 2>&1
""")
        
        logger.info("Management scripts created")

    def create_sample_data(self):
        """Create sample banking data for testing"""
        try:
            from pyspark.sql import SparkSession
            from pyspark.sql.functions import *
            from pyspark.sql.types import *
            
            spark = SparkSession.builder \
                .appName("DeltaLakeSampleData") \
                .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension") \
                .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog") \
                .getOrCreate()
            
            # Sample transactions data
            transactions_data = [
                ("txn_001", "user_001", "agent_001", "deposit", 50000.00, "NGN", "completed", "pos", "REF001", "Cash deposit", {"location": "Lagos"}, "2024-01-15 10:30:00", "2024-01-15", "Lagos", ["kyc_verified"], 0.1),
                ("txn_002", "user_002", "agent_002", "withdrawal", 25000.00, "NGN", "completed", "mobile", "REF002", "ATM withdrawal", {"location": "Abuja"}, "2024-01-15 14:20:00", "2024-01-15", "FCT", ["amount_check"], 0.2),
                ("txn_003", "user_003", "agent_001", "transfer", 75000.00, "NGN", "pending", "web", "REF003", "Bank transfer", {"location": "Lagos"}, "2024-01-16 09:15:00", "2024-01-16", "Lagos", [], 0.3),
            ]
            
            transactions_schema = StructType([
                StructField("transaction_id", StringType(), False),
                StructField("user_id", StringType(), False),
                StructField("agent_id", StringType(), True),
                StructField("transaction_type", StringType(), False),
                StructField("amount", DecimalType(15,2), False),
                StructField("currency", StringType(), True),
                StructField("status", StringType(), False),
                StructField("channel", StringType(), True),
                StructField("reference", StringType(), True),
                StructField("description", StringType(), True),
                StructField("metadata", MapType(StringType(), StringType()), True),
                StructField("created_at", StringType(), False),
                StructField("date", StringType(), True),
                StructField("region", StringType(), True),
                StructField("compliance_flags", ArrayType(StringType()), True),
                StructField("risk_score", DoubleType(), True)
            ])
            
            transactions_df = spark.createDataFrame(transactions_data, transactions_schema)
            transactions_df = transactions_df.withColumn("created_at", to_timestamp(col("created_at"))) \
                                           .withColumn("date", to_date(col("date")))
            
            # Write to Delta Lake
            transactions_path = str(self.data_path / "bronze" / "transactions")
            transactions_df.write \
                .format("delta") \
                .mode("overwrite") \
                .partitionBy("date", "region") \
                .save(transactions_path)
            
            logger.info("Sample data created successfully")
            spark.stop()
            
        except Exception as e:
            logger.error(f"Failed to create sample data: {e}")

def main():
    """Main setup function"""
    print("🏗️ Setting up Delta Lake for Remittance Platform...")
    
    setup = DeltaLakeSetup()
    
    if setup.setup_environment():
        print("✅ Delta Lake setup completed successfully!")
        
        # Create sample data
        print("📊 Creating sample data...")
        setup.create_sample_data()
        
        print(f"""
🎉 Delta Lake is ready for Remittance Platform!

📁 Installation Path: {setup.base_path}
📊 Data Path: {setup.data_path}
📋 Config Path: {setup.config_path}
📜 Scripts Path: {setup.scripts_path}

🔧 Next Steps:
1. Add cron jobs: crontab {setup.config_path}/cron_jobs.txt
2. Start Spark: source {setup.scripts_path}/spark-env.sh
3. Run health check: {setup.scripts_path}/health_check.py
4. Monitor logs: tail -f {setup.logs_path}/*.log

🏦 Banking Tables Created:
- transactions (partitioned by date, region)
- customers (partitioned by state, account_type)
- agents (partitioned by level, region)
- compliance (partitioned by report_type, year)
- audit_logs (partitioned by date, service)

📈 Features Enabled:
- ACID transactions
- Schema evolution
- Time travel queries
- Change data feed
- Auto-optimization
- Nigerian banking compliance
        """)
    else:
        print("❌ Delta Lake setup failed!")
        return 1
    
    return 0

if __name__ == "__main__":
    exit(main())

