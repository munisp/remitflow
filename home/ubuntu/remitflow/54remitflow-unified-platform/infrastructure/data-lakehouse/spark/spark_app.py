#!/usr/bin/env python3
"""
Spark Application for Remittance Platform Data Processing
"""

from pyspark.sql import SparkSession
from pyspark.sql.functions import *
from pyspark.sql.types import *
from delta import *

class AgentBankingSparkApp:
    def __init__(self):
        self.spark = SparkSession.builder \
            .appName("AgentBankingDataLakehouse") \
            .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension") \
            .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog") \
            .getOrCreate()
        
        self.spark.sparkContext.setLogLevel("WARN")
    
    def process_transaction_data(self, input_path: str, output_path: str):
        """Process transaction data from bronze to silver layer"""
        
        # Read bronze data
        bronze_df = self.spark.read.format("delta").load(input_path)
        
        # Data cleaning and transformation
        silver_df = bronze_df \
            .filter(col("amount") > 0) \
            .withColumn("transaction_date", to_date(col("timestamp"))) \
            .withColumn("transaction_hour", hour(col("timestamp"))) \
            .withColumn("amount_usd", col("amount") / 1600)  # NGN to USD conversion \
            .withColumn("is_high_value", col("amount") > 100000) \
            .withColumn("merchant_category", 
                       when(col("merchant").contains("ATM"), "ATM")
                       .when(col("merchant").contains("Store"), "Retail")
                       .when(col("merchant").contains("Gas"), "Fuel")
                       .otherwise("Other"))
        
        # Write to silver layer
        silver_df.write \
            .format("delta") \
            .mode("overwrite") \
            .option("mergeSchema", "true") \
            .save(output_path)
        
        return silver_df
    
    def create_gold_aggregations(self, silver_path: str, gold_path: str):
        """Create gold layer aggregations"""
        
        silver_df = self.spark.read.format("delta").load(silver_path)
        
        # Daily transaction summary
        daily_summary = silver_df \
            .groupBy("transaction_date", "merchant_category") \
            .agg(
                count("*").alias("transaction_count"),
                sum("amount").alias("total_amount"),
                avg("amount").alias("avg_amount"),
                max("amount").alias("max_amount"),
                countDistinct("customer_id").alias("unique_customers")
            )
        
        # Write gold layer
        daily_summary.write \
            .format("delta") \
            .mode("overwrite") \
            .partitionBy("transaction_date") \
            .save(gold_path)
        
        return daily_summary
    
    def detect_anomalies(self, data_path: str):
        """Detect transaction anomalies"""
        
        df = self.spark.read.format("delta").load(data_path)
        
        # Calculate statistics for anomaly detection
        stats = df.select(
            mean("amount").alias("mean_amount"),
            stddev("amount").alias("stddev_amount")
        ).collect()[0]
        
        # Flag anomalies (transactions > 3 standard deviations)
        threshold = stats["mean_amount"] + (3 * stats["stddev_amount"])
        
        anomalies = df.filter(col("amount") > threshold) \
            .withColumn("anomaly_type", lit("high_amount")) \
            .withColumn("anomaly_score", (col("amount") - stats["mean_amount"]) / stats["stddev_amount"])
        
        return anomalies
    
    def stop(self):
        """Stop Spark session"""
        self.spark.stop()

if __name__ == "__main__":
    app = AgentBankingSparkApp()
    
    try:
        # Process data pipeline
        bronze_path = "/data/bronze/transactions"
        silver_path = "/data/silver/transactions"
        gold_path = "/data/gold/daily_summary"
        
        # Process bronze to silver
        silver_df = app.process_transaction_data(bronze_path, silver_path)
        print(f"Processed {silver_df.count()} transactions to silver layer")
        
        # Create gold aggregations
        gold_df = app.create_gold_aggregations(silver_path, gold_path)
        print(f"Created {gold_df.count()} daily summaries in gold layer")
        
        # Detect anomalies
        anomalies = app.detect_anomalies(silver_path)
        print(f"Detected {anomalies.count()} anomalies")
        
    finally:
        app.stop()
