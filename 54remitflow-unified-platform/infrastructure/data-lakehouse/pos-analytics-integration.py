#!/usr/bin/env python3
"""
POS Analytics Data Lakehouse Integration
Integrates POS analytics data into Delta Lake-based data lakehouse architecture
"""

import os
import json
import logging
import asyncio
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
import warnings
warnings.filterwarnings('ignore')

# Delta Lake and Spark
from pyspark.sql import SparkSession, DataFrame
from pyspark.sql.functions import *
from pyspark.sql.types import *
from delta import *
from delta.tables import DeltaTable

# Database connections
import psycopg2
from sqlalchemy import create_engine
import redis
from pymongo import MongoClient

# Streaming and messaging
import kafka
from kafka import KafkaProducer, KafkaConsumer
import asyncio
import aiohttp

# ML and Analytics
from sklearn.preprocessing import StandardScaler
from sklearn.feature_extraction.text import TfidfVectorizer
import joblib

# Monitoring
from prometheus_client import Counter, Histogram, Gauge, start_http_server

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Prometheus metrics
lakehouse_ingestion_total = Counter('lakehouse_ingestion_total', 'Total records ingested', ['layer', 'table'])
lakehouse_processing_time = Histogram('lakehouse_processing_time_seconds', 'Processing time', ['operation'])
lakehouse_table_size = Gauge('lakehouse_table_size_mb', 'Table size in MB', ['layer', 'table'])
lakehouse_data_quality_score = Gauge('lakehouse_data_quality_score', 'Data quality score', ['table'])

class POSAnalyticsLakehouseIntegration:
    """POS Analytics Data Lakehouse Integration Service"""
    
    def __init__(self):
        self.spark = None
        self.delta_lake_path = os.getenv('DELTA_LAKE_PATH', '/opt/delta-lake')
        self.setup_configuration()
        self.setup_spark_session()
        self.setup_connections()
        self.setup_schemas()
        
    def setup_configuration(self):
        """Setup configuration parameters"""
        self.config = {
            # Database connections
            'postgres_url': os.getenv('POSTGRES_URL', os.getenv('DATABASE_URL', 'postgresql://postgres:password@localhost:5432/remittance')),
            'redis_url': os.getenv('REDIS_URL', os.getenv('REDIS_URL', 'redis://localhost:6379')),
            'mongo_url': os.getenv('MONGO_URL', os.getenv('MONGO_URL', 'mongodb://localhost:27017/')),
            
            # Kafka configuration
            'kafka_bootstrap_servers': os.getenv('KAFKA_BOOTSTRAP_SERVERS', os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')),
            'kafka_topics': {
                'pos_transactions': 'pos-transactions',
                'pos_devices': 'pos-devices',
                'pos_analytics': 'pos-analytics',
                'fraud_alerts': 'fraud-alerts'
            },
            
            # Delta Lake paths
            'bronze_path': f"{self.delta_lake_path}/bronze",
            'silver_path': f"{self.delta_lake_path}/silver", 
            'gold_path': f"{self.delta_lake_path}/gold",
            'feature_store_path': f"{self.delta_lake_path}/feature-store",
            
            # Processing configuration
            'batch_size': int(os.getenv('BATCH_SIZE', '10000')),
            'processing_interval': int(os.getenv('PROCESSING_INTERVAL', '300')),  # 5 minutes
            'retention_days': int(os.getenv('RETENTION_DAYS', '365')),
            
            # Data quality thresholds
            'quality_thresholds': {
                'completeness': 0.95,
                'accuracy': 0.98,
                'consistency': 0.99,
                'timeliness': 0.90
            }
        }
        
    def setup_spark_session(self):
        """Setup Spark session with Delta Lake configuration"""
        try:
            builder = SparkSession.builder \
                .appName("POSAnalyticsLakehouse") \
                .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension") \
                .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog") \
                .config("spark.sql.adaptive.enabled", "true") \
                .config("spark.sql.adaptive.coalescePartitions.enabled", "true") \
                .config("spark.serializer", "org.apache.spark.serializer.KryoSerializer") \
                .config("spark.sql.streaming.checkpointLocation", f"{self.delta_lake_path}/checkpoints") \
                .config("spark.databricks.delta.retentionDurationCheck.enabled", "false") \
                .config("spark.databricks.delta.schema.autoMerge.enabled", "true")
            
            self.spark = configure_spark_with_delta_pip(builder).getOrCreate()
            self.spark.sparkContext.setLogLevel("WARN")
            
            logger.info("Spark session with Delta Lake configured successfully")
            
        except Exception as e:
            logger.error(f"Failed to setup Spark session: {e}")
            raise
    
    def setup_connections(self):
        """Setup external connections"""
        try:
            # PostgreSQL connection
            self.pg_engine = create_engine(self.config['postgres_url'])
            
            # Redis connection
            self.redis_client = redis.from_url(self.config['redis_url'])
            
            # MongoDB connection
            self.mongo_client = MongoClient(self.config['mongo_url'])
            self.analytics_db = self.mongo_client.pos_analytics
            
            # Kafka producer
            self.kafka_producer = KafkaProducer(
                bootstrap_servers=self.config['kafka_bootstrap_servers'],
                value_serializer=lambda v: json.dumps(v).encode('utf-8'),
                key_serializer=lambda k: str(k).encode('utf-8') if k else None
            )
            
            logger.info("External connections established")
            
        except Exception as e:
            logger.error(f"Failed to setup connections: {e}")
            raise
    
    def setup_schemas(self):
        """Setup Delta Lake table schemas"""
        
        # Bronze layer schemas (raw data)
        self.bronze_schemas = {
            'pos_transactions': StructType([
                StructField("id", StringType(), False),
                StructField("pos_device_id", StringType(), False),
                StructField("transaction_id", StringType(), False),
                StructField("type", StringType(), True),
                StructField("amount", DoubleType(), True),
                StructField("currency", StringType(), True),
                StructField("status", StringType(), True),
                StructField("customer_id", StringType(), True),
                StructField("agent_id", StringType(), True),
                StructField("metadata", MapType(StringType(), StringType()), True),
                StructField("created_at", TimestampType(), False),
                StructField("ingestion_timestamp", TimestampType(), False)
            ]),
            
            'pos_devices': StructType([
                StructField("id", StringType(), False),
                StructField("serial_number", StringType(), True),
                StructField("model", StringType(), True),
                StructField("manufacturer", StringType(), True),
                StructField("agent_id", StringType(), True),
                StructField("location_id", StringType(), True),
                StructField("status", StringType(), True),
                StructField("performance_metrics", MapType(StringType(), StringType()), True),
                StructField("network_info", MapType(StringType(), StringType()), True),
                StructField("security_info", MapType(StringType(), StringType()), True),
                StructField("last_heartbeat", TimestampType(), True),
                StructField("created_at", TimestampType(), False),
                StructField("updated_at", TimestampType(), True),
                StructField("ingestion_timestamp", TimestampType(), False)
            ]),
            
            'fraud_alerts': StructType([
                StructField("id", StringType(), False),
                StructField("device_id", StringType(), True),
                StructField("transaction_id", StringType(), True),
                StructField("alert_type", StringType(), False),
                StructField("severity", StringType(), False),
                StructField("fraud_score", DoubleType(), True),
                StructField("confidence_score", DoubleType(), True),
                StructField("description", StringType(), True),
                StructField("details", MapType(StringType(), StringType()), True),
                StructField("resolved", BooleanType(), True),
                StructField("created_at", TimestampType(), False),
                StructField("ingestion_timestamp", TimestampType(), False)
            ])
        }
        
        # Silver layer schemas (cleaned and enriched)
        self.silver_schemas = {
            'transactions_enriched': StructType([
                StructField("transaction_id", StringType(), False),
                StructField("pos_device_id", StringType(), False),
                StructField("amount", DoubleType(), True),
                StructField("amount_usd", DoubleType(), True),
                StructField("transaction_type", StringType(), True),
                StructField("status", StringType(), True),
                StructField("customer_id", StringType(), True),
                StructField("agent_id", StringType(), True),
                StructField("location_id", StringType(), True),
                StructField("device_model", StringType(), True),
                StructField("transaction_hour", IntegerType(), True),
                StructField("transaction_day_of_week", IntegerType(), True),
                StructField("transaction_month", IntegerType(), True),
                StructField("is_weekend", BooleanType(), True),
                StructField("is_business_hours", BooleanType(), True),
                StructField("fraud_score", DoubleType(), True),
                StructField("anomaly_score", DoubleType(), True),
                StructField("processing_time_ms", LongType(), True),
                StructField("created_at", TimestampType(), False),
                StructField("processed_at", TimestampType(), False)
            ]),
            
            'device_health_metrics': StructType([
                StructField("device_id", StringType(), False),
                StructField("timestamp", TimestampType(), False),
                StructField("cpu_usage", DoubleType(), True),
                StructField("memory_usage", DoubleType(), True),
                StructField("disk_usage", DoubleType(), True),
                StructField("network_latency", DoubleType(), True),
                StructField("transaction_tps", DoubleType(), True),
                StructField("error_rate", DoubleType(), True),
                StructField("uptime_hours", DoubleType(), True),
                StructField("health_score", DoubleType(), True),
                StructField("status", StringType(), True),
                StructField("agent_id", StringType(), True),
                StructField("location_id", StringType(), True),
                StructField("processed_at", TimestampType(), False)
            ])
        }
        
        # Gold layer schemas (business aggregates)
        self.gold_schemas = {
            'daily_transaction_summary': StructType([
                StructField("date", DateType(), False),
                StructField("agent_id", StringType(), False),
                StructField("location_id", StringType(), True),
                StructField("total_transactions", LongType(), True),
                StructField("total_volume", DoubleType(), True),
                StructField("avg_transaction_amount", DoubleType(), True),
                StructField("success_rate", DoubleType(), True),
                StructField("fraud_rate", DoubleType(), True),
                StructField("unique_customers", LongType(), True),
                StructField("peak_hour", IntegerType(), True),
                StructField("device_count", LongType(), True),
                StructField("processed_at", TimestampType(), False)
            ]),
            
            'device_performance_summary': StructType([
                StructField("date", DateType(), False),
                StructField("device_id", StringType(), False),
                StructField("agent_id", StringType(), True),
                StructField("avg_cpu_usage", DoubleType(), True),
                StructField("avg_memory_usage", DoubleType(), True),
                StructField("avg_health_score", DoubleType(), True),
                StructField("uptime_percentage", DoubleType(), True),
                StructField("transaction_count", LongType(), True),
                StructField("error_count", LongType(), True),
                StructField("maintenance_required", BooleanType(), True),
                StructField("processed_at", TimestampType(), False)
            ])
        }
        
        # Feature store schemas
        self.feature_schemas = {
            'fraud_detection_features': StructType([
                StructField("feature_id", StringType(), False),
                StructField("transaction_id", StringType(), True),
                StructField("device_id", StringType(), True),
                StructField("amount_normalized", DoubleType(), True),
                StructField("hour_of_day", DoubleType(), True),
                StructField("day_of_week", DoubleType(), True),
                StructField("transaction_velocity", DoubleType(), True),
                StructField("device_health_score", DoubleType(), True),
                StructField("historical_fraud_rate", DoubleType(), True),
                StructField("location_risk_score", DoubleType(), True),
                StructField("customer_risk_score", DoubleType(), True),
                StructField("agent_risk_score", DoubleType(), True),
                StructField("created_at", TimestampType(), False)
            ]),
            
            'device_health_features': StructType([
                StructField("feature_id", StringType(), False),
                StructField("device_id", StringType(), False),
                StructField("cpu_trend", DoubleType(), True),
                StructField("memory_trend", DoubleType(), True),
                StructField("error_rate_trend", DoubleType(), True),
                StructField("transaction_volume_trend", DoubleType(), True),
                StructField("uptime_trend", DoubleType(), True),
                StructField("maintenance_history", DoubleType(), True),
                StructField("age_days", DoubleType(), True),
                StructField("location_factor", DoubleType(), True),
                StructField("created_at", TimestampType(), False)
            ])
        }
        
        logger.info("Delta Lake schemas configured")
    
    def create_delta_tables(self):
        """Create Delta Lake tables if they don't exist"""
        try:
            # Create bronze layer tables
            for table_name, schema in self.bronze_schemas.items():
                table_path = f"{self.config['bronze_path']}/{table_name}"
                if not DeltaTable.isDeltaTable(self.spark, table_path):
                    self.spark.createDataFrame([], schema) \
                        .write \
                        .format("delta") \
                        .mode("overwrite") \
                        .option("path", table_path) \
                        .saveAsTable(f"bronze_{table_name}")
                    logger.info(f"Created bronze table: {table_name}")
            
            # Create silver layer tables
            for table_name, schema in self.silver_schemas.items():
                table_path = f"{self.config['silver_path']}/{table_name}"
                if not DeltaTable.isDeltaTable(self.spark, table_path):
                    self.spark.createDataFrame([], schema) \
                        .write \
                        .format("delta") \
                        .mode("overwrite") \
                        .option("path", table_path) \
                        .saveAsTable(f"silver_{table_name}")
                    logger.info(f"Created silver table: {table_name}")
            
            # Create gold layer tables
            for table_name, schema in self.gold_schemas.items():
                table_path = f"{self.config['gold_path']}/{table_name}"
                if not DeltaTable.isDeltaTable(self.spark, table_path):
                    self.spark.createDataFrame([], schema) \
                        .write \
                        .format("delta") \
                        .mode("overwrite") \
                        .option("path", table_path) \
                        .saveAsTable(f"gold_{table_name}")
                    logger.info(f"Created gold table: {table_name}")
            
            # Create feature store tables
            for table_name, schema in self.feature_schemas.items():
                table_path = f"{self.config['feature_store_path']}/{table_name}"
                if not DeltaTable.isDeltaTable(self.spark, table_path):
                    self.spark.createDataFrame([], schema) \
                        .write \
                        .format("delta") \
                        .mode("overwrite") \
                        .option("path", table_path) \
                        .saveAsTable(f"features_{table_name}")
                    logger.info(f"Created feature store table: {table_name}")
            
            logger.info("All Delta Lake tables created successfully")
            
        except Exception as e:
            logger.error(f"Failed to create Delta Lake tables: {e}")
            raise
    
    # Bronze Layer - Raw Data Ingestion
    def ingest_pos_transactions(self):
        """Ingest POS transaction data into bronze layer"""
        try:
            with lakehouse_processing_time.labels(operation='bronze_transactions').time():
                # Read from PostgreSQL
                query = """
                SELECT 
                    id, pos_device_id, transaction_id, type, amount, currency,
                    status, customer_id, agent_id, metadata, created_at
                FROM transactions
                WHERE created_at > NOW() - INTERVAL '1 hour'
                """
                
                df = pd.read_sql(query, self.pg_engine)
                
                if not df.empty:
                    # Convert to Spark DataFrame
                    spark_df = self.spark.createDataFrame(df)
                    
                    # Add ingestion timestamp
                    spark_df = spark_df.withColumn("ingestion_timestamp", current_timestamp())
                    
                    # Write to Delta Lake
                    table_path = f"{self.config['bronze_path']}/pos_transactions"
                    spark_df.write \
                        .format("delta") \
                        .mode("append") \
                        .option("mergeSchema", "true") \
                        .save(table_path)
                    
                    # Update metrics
                    lakehouse_ingestion_total.labels(layer='bronze', table='pos_transactions').inc(len(df))
                    
                    logger.info(f"Ingested {len(df)} transaction records to bronze layer")
                
        except Exception as e:
            logger.error(f"Failed to ingest POS transactions: {e}")
    
    def ingest_pos_devices(self):
        """Ingest POS device data into bronze layer"""
        try:
            with lakehouse_processing_time.labels(operation='bronze_devices').time():
                # Read from PostgreSQL
                query = """
                SELECT 
                    id, serial_number, model, manufacturer, agent_id, location_id,
                    status, performance_metrics, network_info, security_info,
                    last_heartbeat, created_at, updated_at
                FROM pos_devices
                WHERE updated_at > NOW() - INTERVAL '1 hour'
                """
                
                df = pd.read_sql(query, self.pg_engine)
                
                if not df.empty:
                    # Convert JSON columns
                    for col in ['performance_metrics', 'network_info', 'security_info']:
                        df[col] = df[col].apply(lambda x: json.loads(x) if isinstance(x, str) else x)
                    
                    # Convert to Spark DataFrame
                    spark_df = self.spark.createDataFrame(df)
                    
                    # Add ingestion timestamp
                    spark_df = spark_df.withColumn("ingestion_timestamp", current_timestamp())
                    
                    # Write to Delta Lake
                    table_path = f"{self.config['bronze_path']}/pos_devices"
                    spark_df.write \
                        .format("delta") \
                        .mode("append") \
                        .option("mergeSchema", "true") \
                        .save(table_path)
                    
                    # Update metrics
                    lakehouse_ingestion_total.labels(layer='bronze', table='pos_devices').inc(len(df))
                    
                    logger.info(f"Ingested {len(df)} device records to bronze layer")
                
        except Exception as e:
            logger.error(f"Failed to ingest POS devices: {e}")
    
    def ingest_fraud_alerts(self):
        """Ingest fraud alerts from MongoDB into bronze layer"""
        try:
            with lakehouse_processing_time.labels(operation='bronze_fraud_alerts').time():
                # Read from MongoDB
                one_hour_ago = datetime.now() - timedelta(hours=1)
                alerts = list(self.analytics_db.alerts.find({
                    'timestamp': {'$gte': one_hour_ago}
                }))
                
                if alerts:
                    # Convert to DataFrame
                    df = pd.DataFrame(alerts)
                    df = df.drop('_id', axis=1, errors='ignore')
                    
                    # Rename timestamp to created_at
                    if 'timestamp' in df.columns:
                        df = df.rename(columns={'timestamp': 'created_at'})
                    
                    # Convert to Spark DataFrame
                    spark_df = self.spark.createDataFrame(df)
                    
                    # Add ingestion timestamp
                    spark_df = spark_df.withColumn("ingestion_timestamp", current_timestamp())
                    
                    # Write to Delta Lake
                    table_path = f"{self.config['bronze_path']}/fraud_alerts"
                    spark_df.write \
                        .format("delta") \
                        .mode("append") \
                        .option("mergeSchema", "true") \
                        .save(table_path)
                    
                    # Update metrics
                    lakehouse_ingestion_total.labels(layer='bronze', table='fraud_alerts').inc(len(df))
                    
                    logger.info(f"Ingested {len(df)} fraud alert records to bronze layer")
                
        except Exception as e:
            logger.error(f"Failed to ingest fraud alerts: {e}")
    
    # Silver Layer - Data Cleaning and Enrichment
    def process_transactions_to_silver(self):
        """Process bronze transactions to silver layer with enrichment"""
        try:
            with lakehouse_processing_time.labels(operation='silver_transactions').time():
                # Read from bronze layer
                bronze_transactions = self.spark.read.format("delta").load(
                    f"{self.config['bronze_path']}/pos_transactions"
                ).filter(col("ingestion_timestamp") > (current_timestamp() - expr("INTERVAL 1 HOUR")))
                
                bronze_devices = self.spark.read.format("delta").load(
                    f"{self.config['bronze_path']}/pos_devices"
                )
                
                if bronze_transactions.count() > 0:
                    # Join with device data for enrichment
                    enriched_df = bronze_transactions.alias("t") \
                        .join(bronze_devices.alias("d"), 
                              col("t.pos_device_id") == col("d.id"), "left") \
                        .select(
                            col("t.transaction_id"),
                            col("t.pos_device_id"),
                            col("t.amount"),
                            (col("t.amount") * 0.0027).alias("amount_usd"),  # NGN to USD conversion
                            col("t.type").alias("transaction_type"),
                            col("t.status"),
                            col("t.customer_id"),
                            col("t.agent_id"),
                            col("d.location_id"),
                            col("d.model").alias("device_model"),
                            hour(col("t.created_at")).alias("transaction_hour"),
                            dayofweek(col("t.created_at")).alias("transaction_day_of_week"),
                            month(col("t.created_at")).alias("transaction_month"),
                            (dayofweek(col("t.created_at")).isin([1, 7])).alias("is_weekend"),
                            ((hour(col("t.created_at")) >= 8) & (hour(col("t.created_at")) <= 18)).alias("is_business_hours"),
                            lit(0.0).alias("fraud_score"),  # Placeholder for ML scoring
                            lit(0.0).alias("anomaly_score"),  # Placeholder for anomaly scoring
                            lit(0).alias("processing_time_ms"),
                            col("t.created_at"),
                            current_timestamp().alias("processed_at")
                        )
                    
                    # Write to silver layer
                    table_path = f"{self.config['silver_path']}/transactions_enriched"
                    enriched_df.write \
                        .format("delta") \
                        .mode("append") \
                        .option("mergeSchema", "true") \
                        .save(table_path)
                    
                    # Update metrics
                    record_count = enriched_df.count()
                    lakehouse_ingestion_total.labels(layer='silver', table='transactions_enriched').inc(record_count)
                    
                    logger.info(f"Processed {record_count} transactions to silver layer")
                
        except Exception as e:
            logger.error(f"Failed to process transactions to silver: {e}")
    
    def process_device_metrics_to_silver(self):
        """Process device metrics to silver layer"""
        try:
            with lakehouse_processing_time.labels(operation='silver_device_metrics').time():
                # Read from bronze layer
                bronze_devices = self.spark.read.format("delta").load(
                    f"{self.config['bronze_path']}/pos_devices"
                ).filter(col("ingestion_timestamp") > (current_timestamp() - expr("INTERVAL 1 HOUR")))
                
                if bronze_devices.count() > 0:
                    # Extract and flatten performance metrics
                    metrics_df = bronze_devices.select(
                        col("id").alias("device_id"),
                        col("last_heartbeat").alias("timestamp"),
                        col("performance_metrics.cpu_usage").cast("double").alias("cpu_usage"),
                        col("performance_metrics.memory_usage").cast("double").alias("memory_usage"),
                        col("performance_metrics.disk_usage").cast("double").alias("disk_usage"),
                        col("network_info.latency").cast("double").alias("network_latency"),
                        col("performance_metrics.transaction_tps").cast("double").alias("transaction_tps"),
                        col("performance_metrics.error_rate").cast("double").alias("error_rate"),
                        col("performance_metrics.uptime_hours").cast("double").alias("uptime_hours"),
                        lit(0.0).alias("health_score"),  # Calculated later
                        col("status"),
                        col("agent_id"),
                        col("location_id"),
                        current_timestamp().alias("processed_at")
                    )
                    
                    # Calculate health score
                    metrics_df = metrics_df.withColumn(
                        "health_score",
                        (
                            (1.0 - coalesce(col("cpu_usage"), lit(0.0)) / 100.0) * 0.3 +
                            (1.0 - coalesce(col("memory_usage"), lit(0.0)) / 100.0) * 0.3 +
                            (1.0 - coalesce(col("error_rate"), lit(0.0))) * 0.4
                        )
                    )
                    
                    # Write to silver layer
                    table_path = f"{self.config['silver_path']}/device_health_metrics"
                    metrics_df.write \
                        .format("delta") \
                        .mode("append") \
                        .option("mergeSchema", "true") \
                        .save(table_path)
                    
                    # Update metrics
                    record_count = metrics_df.count()
                    lakehouse_ingestion_total.labels(layer='silver', table='device_health_metrics').inc(record_count)
                    
                    logger.info(f"Processed {record_count} device metrics to silver layer")
                
        except Exception as e:
            logger.error(f"Failed to process device metrics to silver: {e}")
    
    # Gold Layer - Business Aggregates
    def create_daily_transaction_summary(self):
        """Create daily transaction summary in gold layer"""
        try:
            with lakehouse_processing_time.labels(operation='gold_daily_summary').time():
                # Read from silver layer
                transactions = self.spark.read.format("delta").load(
                    f"{self.config['silver_path']}/transactions_enriched"
                ).filter(col("created_at") >= (current_date() - 1))
                
                if transactions.count() > 0:
                    # Create daily summary
                    daily_summary = transactions.groupBy(
                        to_date(col("created_at")).alias("date"),
                        col("agent_id"),
                        col("location_id")
                    ).agg(
                        count("*").alias("total_transactions"),
                        sum("amount").alias("total_volume"),
                        avg("amount").alias("avg_transaction_amount"),
                        (sum(when(col("status") == "completed", 1).otherwise(0)) / count("*")).alias("success_rate"),
                        (sum(when(col("fraud_score") > 0.8, 1).otherwise(0)) / count("*")).alias("fraud_rate"),
                        countDistinct("customer_id").alias("unique_customers"),
                        first("transaction_hour").alias("peak_hour"),  # Simplified
                        countDistinct("pos_device_id").alias("device_count"),
                        current_timestamp().alias("processed_at")
                    )
                    
                    # Write to gold layer
                    table_path = f"{self.config['gold_path']}/daily_transaction_summary"
                    daily_summary.write \
                        .format("delta") \
                        .mode("append") \
                        .option("mergeSchema", "true") \
                        .save(table_path)
                    
                    # Update metrics
                    record_count = daily_summary.count()
                    lakehouse_ingestion_total.labels(layer='gold', table='daily_transaction_summary').inc(record_count)
                    
                    logger.info(f"Created {record_count} daily transaction summary records")
                
        except Exception as e:
            logger.error(f"Failed to create daily transaction summary: {e}")
    
    def create_device_performance_summary(self):
        """Create device performance summary in gold layer"""
        try:
            with lakehouse_processing_time.labels(operation='gold_device_summary').time():
                # Read from silver layer
                device_metrics = self.spark.read.format("delta").load(
                    f"{self.config['silver_path']}/device_health_metrics"
                ).filter(col("timestamp") >= (current_date() - 1))
                
                if device_metrics.count() > 0:
                    # Create device performance summary
                    performance_summary = device_metrics.groupBy(
                        to_date(col("timestamp")).alias("date"),
                        col("device_id"),
                        col("agent_id")
                    ).agg(
                        avg("cpu_usage").alias("avg_cpu_usage"),
                        avg("memory_usage").alias("avg_memory_usage"),
                        avg("health_score").alias("avg_health_score"),
                        (sum(when(col("status") == "online", 1).otherwise(0)) / count("*") * 100).alias("uptime_percentage"),
                        sum(when(col("transaction_tps").isNotNull(), col("transaction_tps")).otherwise(0)).alias("transaction_count"),
                        sum(when(col("error_rate") > 0, 1).otherwise(0)).alias("error_count"),
                        (avg("health_score") < 0.5).alias("maintenance_required"),
                        current_timestamp().alias("processed_at")
                    )
                    
                    # Write to gold layer
                    table_path = f"{self.config['gold_path']}/device_performance_summary"
                    performance_summary.write \
                        .format("delta") \
                        .mode("append") \
                        .option("mergeSchema", "true") \
                        .save(table_path)
                    
                    # Update metrics
                    record_count = performance_summary.count()
                    lakehouse_ingestion_total.labels(layer='gold', table='device_performance_summary').inc(record_count)
                    
                    logger.info(f"Created {record_count} device performance summary records")
                
        except Exception as e:
            logger.error(f"Failed to create device performance summary: {e}")
    
    # Feature Store
    def create_fraud_detection_features(self):
        """Create fraud detection features for ML models"""
        try:
            with lakehouse_processing_time.labels(operation='features_fraud_detection').time():
                # Read from silver layer
                transactions = self.spark.read.format("delta").load(
                    f"{self.config['silver_path']}/transactions_enriched"
                ).filter(col("created_at") >= (current_timestamp() - expr("INTERVAL 24 HOURS")))
                
                device_metrics = self.spark.read.format("delta").load(
                    f"{self.config['silver_path']}/device_health_metrics"
                )
                
                if transactions.count() > 0:
                    # Join transactions with device metrics
                    features_df = transactions.alias("t") \
                        .join(device_metrics.alias("d"), 
                              (col("t.pos_device_id") == col("d.device_id")) & 
                              (abs(unix_timestamp(col("t.created_at")) - unix_timestamp(col("d.timestamp"))) < 3600),
                              "left") \
                        .select(
                            concat(col("t.transaction_id"), lit("_"), col("t.pos_device_id")).alias("feature_id"),
                            col("t.transaction_id"),
                            col("t.pos_device_id").alias("device_id"),
                            (col("t.amount") / 100000.0).alias("amount_normalized"),  # Normalize to 0-1 range
                            (col("t.transaction_hour") / 24.0).alias("hour_of_day"),
                            (col("t.transaction_day_of_week") / 7.0).alias("day_of_week"),
                            lit(0.0).alias("transaction_velocity"),  # Calculate from historical data
                            coalesce(col("d.health_score"), lit(0.5)).alias("device_health_score"),
                            lit(0.0).alias("historical_fraud_rate"),  # Calculate from historical data
                            lit(0.0).alias("location_risk_score"),  # Calculate from location data
                            lit(0.0).alias("customer_risk_score"),  # Calculate from customer history
                            lit(0.0).alias("agent_risk_score"),  # Calculate from agent history
                            col("t.created_at")
                        )
                    
                    # Write to feature store
                    table_path = f"{self.config['feature_store_path']}/fraud_detection_features"
                    features_df.write \
                        .format("delta") \
                        .mode("append") \
                        .option("mergeSchema", "true") \
                        .save(table_path)
                    
                    # Update metrics
                    record_count = features_df.count()
                    lakehouse_ingestion_total.labels(layer='features', table='fraud_detection_features').inc(record_count)
                    
                    logger.info(f"Created {record_count} fraud detection feature records")
                
        except Exception as e:
            logger.error(f"Failed to create fraud detection features: {e}")
    
    def create_device_health_features(self):
        """Create device health features for ML models"""
        try:
            with lakehouse_processing_time.labels(operation='features_device_health').time():
                # Read from silver layer
                device_metrics = self.spark.read.format("delta").load(
                    f"{self.config['silver_path']}/device_health_metrics"
                ).filter(col("timestamp") >= (current_timestamp() - expr("INTERVAL 7 DAYS")))
                
                if device_metrics.count() > 0:
                    # Calculate trends and features
                    window_spec = Window.partitionBy("device_id").orderBy("timestamp")
                    
                    features_df = device_metrics.withColumn(
                        "cpu_trend", 
                        col("cpu_usage") - lag("cpu_usage", 1).over(window_spec)
                    ).withColumn(
                        "memory_trend",
                        col("memory_usage") - lag("memory_usage", 1).over(window_spec)
                    ).withColumn(
                        "error_rate_trend",
                        col("error_rate") - lag("error_rate", 1).over(window_spec)
                    ).select(
                        concat(col("device_id"), lit("_"), unix_timestamp(col("timestamp"))).alias("feature_id"),
                        col("device_id"),
                        coalesce(col("cpu_trend"), lit(0.0)).alias("cpu_trend"),
                        coalesce(col("memory_trend"), lit(0.0)).alias("memory_trend"),
                        coalesce(col("error_rate_trend"), lit(0.0)).alias("error_rate_trend"),
                        lit(0.0).alias("transaction_volume_trend"),  # Calculate from transaction data
                        coalesce(col("uptime_hours"), lit(0.0)).alias("uptime_trend"),
                        lit(0.0).alias("maintenance_history"),  # Calculate from maintenance records
                        lit(30.0).alias("age_days"),  # Calculate from device creation date
                        lit(1.0).alias("location_factor"),  # Calculate from location data
                        col("timestamp").alias("created_at")
                    ).filter(col("cpu_trend").isNotNull())
                    
                    # Write to feature store
                    table_path = f"{self.config['feature_store_path']}/device_health_features"
                    features_df.write \
                        .format("delta") \
                        .mode("append") \
                        .option("mergeSchema", "true") \
                        .save(table_path)
                    
                    # Update metrics
                    record_count = features_df.count()
                    lakehouse_ingestion_total.labels(layer='features', table='device_health_features').inc(record_count)
                    
                    logger.info(f"Created {record_count} device health feature records")
                
        except Exception as e:
            logger.error(f"Failed to create device health features: {e}")
    
    # Data Quality and Monitoring
    def check_data_quality(self):
        """Check data quality across all layers"""
        try:
            quality_scores = {}
            
            # Check bronze layer quality
            for table_name in self.bronze_schemas.keys():
                table_path = f"{self.config['bronze_path']}/{table_name}"
                if DeltaTable.isDeltaTable(self.spark, table_path):
                    df = self.spark.read.format("delta").load(table_path)
                    
                    total_records = df.count()
                    if total_records > 0:
                        # Completeness check
                        non_null_records = df.filter(col("id").isNotNull()).count()
                        completeness = non_null_records / total_records
                        
                        # Timeliness check (records from last 24 hours)
                        recent_records = df.filter(
                            col("ingestion_timestamp") >= (current_timestamp() - expr("INTERVAL 24 HOURS"))
                        ).count()
                        timeliness = min(1.0, recent_records / (total_records * 0.1))  # Expect 10% recent
                        
                        quality_score = (completeness + timeliness) / 2
                        quality_scores[f"bronze_{table_name}"] = quality_score
                        
                        # Update Prometheus metric
                        lakehouse_data_quality_score.labels(table=f"bronze_{table_name}").set(quality_score)
            
            # Check silver layer quality
            for table_name in self.silver_schemas.keys():
                table_path = f"{self.config['silver_path']}/{table_name}"
                if DeltaTable.isDeltaTable(self.spark, table_path):
                    df = self.spark.read.format("delta").load(table_path)
                    
                    total_records = df.count()
                    if total_records > 0:
                        # Consistency check (no duplicate keys)
                        if "transaction_id" in df.columns:
                            unique_records = df.select("transaction_id").distinct().count()
                            consistency = unique_records / total_records
                        elif "device_id" in df.columns:
                            unique_records = df.select("device_id", "timestamp").distinct().count()
                            consistency = unique_records / total_records
                        else:
                            consistency = 1.0
                        
                        quality_score = consistency
                        quality_scores[f"silver_{table_name}"] = quality_score
                        
                        # Update Prometheus metric
                        lakehouse_data_quality_score.labels(table=f"silver_{table_name}").set(quality_score)
            
            logger.info(f"Data quality check completed: {quality_scores}")
            
        except Exception as e:
            logger.error(f"Failed to check data quality: {e}")
    
    def optimize_tables(self):
        """Optimize Delta Lake tables"""
        try:
            # Optimize bronze tables
            for table_name in self.bronze_schemas.keys():
                table_path = f"{self.config['bronze_path']}/{table_name}"
                if DeltaTable.isDeltaTable(self.spark, table_path):
                    delta_table = DeltaTable.forPath(self.spark, table_path)
                    delta_table.optimize().executeCompaction()
                    logger.info(f"Optimized bronze table: {table_name}")
            
            # Optimize silver tables
            for table_name in self.silver_schemas.keys():
                table_path = f"{self.config['silver_path']}/{table_name}"
                if DeltaTable.isDeltaTable(self.spark, table_path):
                    delta_table = DeltaTable.forPath(self.spark, table_path)
                    delta_table.optimize().executeCompaction()
                    logger.info(f"Optimized silver table: {table_name}")
            
            # Optimize gold tables
            for table_name in self.gold_schemas.keys():
                table_path = f"{self.config['gold_path']}/{table_name}"
                if DeltaTable.isDeltaTable(self.spark, table_path):
                    delta_table = DeltaTable.forPath(self.spark, table_path)
                    delta_table.optimize().executeCompaction()
                    logger.info(f"Optimized gold table: {table_name}")
            
            logger.info("Table optimization completed")
            
        except Exception as e:
            logger.error(f"Failed to optimize tables: {e}")
    
    def cleanup_old_data(self):
        """Clean up old data based on retention policy"""
        try:
            retention_timestamp = current_timestamp() - expr(f"INTERVAL {self.config['retention_days']} DAYS")
            
            # Vacuum bronze tables
            for table_name in self.bronze_schemas.keys():
                table_path = f"{self.config['bronze_path']}/{table_name}"
                if DeltaTable.isDeltaTable(self.spark, table_path):
                    delta_table = DeltaTable.forPath(self.spark, table_path)
                    delta_table.vacuum(retentionHours=24 * self.config['retention_days'])
                    logger.info(f"Vacuumed bronze table: {table_name}")
            
            logger.info("Data cleanup completed")
            
        except Exception as e:
            logger.error(f"Failed to cleanup old data: {e}")
    
    # Main Processing Pipeline
    def run_bronze_pipeline(self):
        """Run bronze layer data ingestion pipeline"""
        logger.info("Starting bronze layer pipeline")
        self.ingest_pos_transactions()
        self.ingest_pos_devices()
        self.ingest_fraud_alerts()
        logger.info("Bronze layer pipeline completed")
    
    def run_silver_pipeline(self):
        """Run silver layer data processing pipeline"""
        logger.info("Starting silver layer pipeline")
        self.process_transactions_to_silver()
        self.process_device_metrics_to_silver()
        logger.info("Silver layer pipeline completed")
    
    def run_gold_pipeline(self):
        """Run gold layer aggregation pipeline"""
        logger.info("Starting gold layer pipeline")
        self.create_daily_transaction_summary()
        self.create_device_performance_summary()
        logger.info("Gold layer pipeline completed")
    
    def run_feature_pipeline(self):
        """Run feature store pipeline"""
        logger.info("Starting feature store pipeline")
        self.create_fraud_detection_features()
        self.create_device_health_features()
        logger.info("Feature store pipeline completed")
    
    def run_maintenance_pipeline(self):
        """Run maintenance and optimization pipeline"""
        logger.info("Starting maintenance pipeline")
        self.check_data_quality()
        self.optimize_tables()
        self.cleanup_old_data()
        logger.info("Maintenance pipeline completed")
    
    def run_full_pipeline(self):
        """Run the complete data lakehouse pipeline"""
        try:
            logger.info("Starting full lakehouse pipeline")
            
            # Create tables if they don't exist
            self.create_delta_tables()
            
            # Run data processing pipelines
            self.run_bronze_pipeline()
            self.run_silver_pipeline()
            self.run_gold_pipeline()
            self.run_feature_pipeline()
            
            # Run maintenance
            self.run_maintenance_pipeline()
            
            logger.info("Full lakehouse pipeline completed successfully")
            
        except Exception as e:
            logger.error(f"Failed to run full pipeline: {e}")
            raise
    
    def start_streaming_pipeline(self):
        """Start real-time streaming pipeline"""
        try:
            logger.info("Starting streaming pipeline")
            
            # Kafka consumer for real-time data
            consumer = KafkaConsumer(
                *self.config['kafka_topics'].values(),
                bootstrap_servers=self.config['kafka_bootstrap_servers'],
                value_deserializer=lambda m: json.loads(m.decode('utf-8')),
                group_id='lakehouse-consumer'
            )
            
            for message in consumer:
                try:
                    topic = message.topic
                    data = message.value
                    
                    # Process based on topic
                    if topic == self.config['kafka_topics']['pos_transactions']:
                        self.process_streaming_transaction(data)
                    elif topic == self.config['kafka_topics']['pos_devices']:
                        self.process_streaming_device(data)
                    elif topic == self.config['kafka_topics']['fraud_alerts']:
                        self.process_streaming_alert(data)
                    
                except Exception as e:
                    logger.error(f"Failed to process streaming message: {e}")
            
        except Exception as e:
            logger.error(f"Failed to start streaming pipeline: {e}")
    
    def process_streaming_transaction(self, data):
        """Process streaming transaction data"""
        try:
            # Convert to DataFrame
            df = self.spark.createDataFrame([data])
            df = df.withColumn("ingestion_timestamp", current_timestamp())
            
            # Write to bronze layer
            table_path = f"{self.config['bronze_path']}/pos_transactions"
            df.write \
                .format("delta") \
                .mode("append") \
                .save(table_path)
            
            # Update metrics
            lakehouse_ingestion_total.labels(layer='bronze', table='pos_transactions').inc()
            
        except Exception as e:
            logger.error(f"Failed to process streaming transaction: {e}")
    
    def process_streaming_device(self, data):
        """Process streaming device data"""
        try:
            # Convert to DataFrame
            df = self.spark.createDataFrame([data])
            df = df.withColumn("ingestion_timestamp", current_timestamp())
            
            # Write to bronze layer
            table_path = f"{self.config['bronze_path']}/pos_devices"
            df.write \
                .format("delta") \
                .mode("append") \
                .save(table_path)
            
            # Update metrics
            lakehouse_ingestion_total.labels(layer='bronze', table='pos_devices').inc()
            
        except Exception as e:
            logger.error(f"Failed to process streaming device: {e}")
    
    def process_streaming_alert(self, data):
        """Process streaming alert data"""
        try:
            # Convert to DataFrame
            df = self.spark.createDataFrame([data])
            df = df.withColumn("ingestion_timestamp", current_timestamp())
            
            # Write to bronze layer
            table_path = f"{self.config['bronze_path']}/fraud_alerts"
            df.write \
                .format("delta") \
                .mode("append") \
                .save(table_path)
            
            # Update metrics
            lakehouse_ingestion_total.labels(layer='bronze', table='fraud_alerts').inc()
            
        except Exception as e:
            logger.error(f"Failed to process streaming alert: {e}")

def main():
    """Main entry point"""
    try:
        # Start Prometheus metrics server
        start_http_server(8097)
        
        # Initialize lakehouse integration
        lakehouse = POSAnalyticsLakehouseIntegration()
        
        logger.info("🏗️ POS Analytics Lakehouse Integration v2.0 starting")
        logger.info(f"📊 Delta Lake path: {lakehouse.delta_lake_path}")
        logger.info(f"⚡ Batch size: {lakehouse.config['batch_size']}")
        logger.info(f"🔄 Processing interval: {lakehouse.config['processing_interval']} seconds")
        logger.info(f"📈 Metrics server: http://0.0.0.0:8097/metrics")
        
        # Run initial full pipeline
        lakehouse.run_full_pipeline()
        
        # Start streaming pipeline in background
        import threading
        streaming_thread = threading.Thread(target=lakehouse.start_streaming_pipeline, daemon=True)
        streaming_thread.start()
        
        # Run periodic batch processing
        import schedule
        import time
        
        schedule.every(lakehouse.config['processing_interval']).seconds.do(lakehouse.run_bronze_pipeline)
        schedule.every(lakehouse.config['processing_interval'] * 2).seconds.do(lakehouse.run_silver_pipeline)
        schedule.every(lakehouse.config['processing_interval'] * 4).seconds.do(lakehouse.run_gold_pipeline)
        schedule.every(lakehouse.config['processing_interval'] * 2).seconds.do(lakehouse.run_feature_pipeline)
        schedule.every().hour.do(lakehouse.run_maintenance_pipeline)
        
        logger.info("🚀 Lakehouse integration started successfully")
        
        while True:
            schedule.run_pending()
            time.sleep(60)
            
    except KeyboardInterrupt:
        logger.info("Shutting down lakehouse integration")
    except Exception as e:
        logger.error(f"Failed to start lakehouse integration: {e}")
        raise

if __name__ == '__main__':
    main()

