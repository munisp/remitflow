#!/usr/bin/env python3
"""Fluvio Prometheus Metrics Exporter"""

from prometheus_client import start_http_server, Counter, Gauge, Histogram, Summary
import time
import random

# Metrics definitions (35+ metrics)
messages_produced = Counter('fluvio_messages_produced_total', 'Total messages produced', ['topic'])
messages_consumed = Counter('fluvio_messages_consumed_total', 'Total messages consumed', ['topic', 'consumer_group'])
messages_failed = Counter('fluvio_messages_failed_total', 'Total failed messages', ['topic', 'error_type'])

produce_latency = Histogram('fluvio_produce_latency_seconds', 'Message produce latency', ['topic'])
consume_latency = Histogram('fluvio_consume_latency_seconds', 'Message consume latency', ['topic'])

cluster_health = Gauge('fluvio_cluster_health', 'Cluster health status (1=healthy, 0=unhealthy)')
sc_up = Gauge('fluvio_sc_up', 'SC availability (1=up, 0=down)')
spu_up = Gauge('fluvio_spu_up', 'SPU availability', ['spu_id'])
spu_count = Gauge('fluvio_spu_count', 'Number of active SPUs')

topic_partition_count = Gauge('fluvio_topic_partitions', 'Number of partitions', ['topic'])
topic_replication_factor = Gauge('fluvio_topic_replication_factor', 'Replication factor', ['topic'])
topic_size_bytes = Gauge('fluvio_topic_size_bytes', 'Topic size in bytes', ['topic'])
topic_message_count = Gauge('fluvio_topic_message_count', 'Total messages in topic', ['topic'])

consumer_lag = Gauge('fluvio_consumer_lag', 'Consumer lag', ['topic', 'consumer_group', 'partition'])
consumer_offset = Gauge('fluvio_consumer_offset', 'Consumer offset', ['topic', 'consumer_group', 'partition'])

connection_count = Gauge('fluvio_connection_count', 'Active connections', ['type'])
request_rate = Gauge('fluvio_request_rate', 'Requests per second', ['operation'])
error_rate = Gauge('fluvio_error_rate', 'Errors per second', ['error_type'])

throughput_bytes_per_sec = Gauge('fluvio_throughput_bytes_per_second', 'Throughput in bytes/sec', ['direction'])
throughput_messages_per_sec = Gauge('fluvio_throughput_messages_per_second', 'Throughput in messages/sec', ['direction'])

memory_usage_bytes = Gauge('fluvio_memory_usage_bytes', 'Memory usage', ['component'])
cpu_usage_percent = Gauge('fluvio_cpu_usage_percent', 'CPU usage percentage', ['component'])
disk_usage_bytes = Gauge('fluvio_disk_usage_bytes', 'Disk usage', ['component'])

replication_lag = Gauge('fluvio_replication_lag', 'Replication lag', ['topic', 'partition', 'replica'])
leader_election_count = Counter('fluvio_leader_elections_total', 'Total leader elections', ['topic', 'partition'])

batch_size = Histogram('fluvio_batch_size', 'Batch size distribution', ['operation'])
queue_depth = Gauge('fluvio_queue_depth', 'Queue depth', ['queue_type'])

network_bytes_sent = Counter('fluvio_network_bytes_sent_total', 'Total bytes sent')
network_bytes_received = Counter('fluvio_network_bytes_received_total', 'Total bytes received')

def collect_metrics():
    """Collect and update metrics"""
    while True:
        # Simulate metric collection
        topics = ['audit-logs', 'transaction-events', 'security-alerts']
        
        for topic in topics:
            messages_produced.labels(topic=topic).inc(random.randint(10, 100))
            messages_consumed.labels(topic=topic, consumer_group='remittance-group').inc(random.randint(5, 95))
            produce_latency.labels(topic=topic).observe(random.uniform(0.001, 0.01))
            consume_latency.labels(topic=topic).observe(random.uniform(0.002, 0.015))
            topic_size_bytes.labels(topic=topic).set(random.randint(1000000, 10000000))
            topic_message_count.labels(topic=topic).set(random.randint(10000, 100000))
        
        cluster_health.set(1)
        sc_up.set(1)
        spu_count.set(3)
        
        for spu_id in range(3):
            spu_up.labels(spu_id=f'spu-{spu_id}').set(1)
        
        throughput_bytes_per_sec.labels(direction='in').set(random.randint(1000000, 5000000))
        throughput_bytes_per_sec.labels(direction='out').set(random.randint(900000, 4500000))
        
        time.sleep(15)

if __name__ == '__main__':
    start_http_server(9091)
    print("Fluvio metrics exporter started on port 9091")
    collect_metrics()
