#!/usr/bin/env python3
"""OpenAppSec Prometheus Metrics Exporter"""

from prometheus_client import start_http_server, Counter, Gauge, Histogram
import time
import random

# WAF metrics
attacks_detected = Counter('openappsec_attacks_detected_total', 'Total attacks detected', ['attack_type'])
attacks_blocked = Counter('openappsec_attacks_blocked_total', 'Total attacks blocked', ['attack_type'])
false_positives = Counter('openappsec_false_positives_total', 'Total false positives')

# Performance metrics
request_latency = Histogram('openappsec_request_latency_seconds', 'Request latency')
throughput = Gauge('openappsec_throughput_rps', 'Throughput in requests per second')

# Status metrics
waf_up = Gauge('openappsec_waf_up', 'WAF status (1=up, 0=down)')
detection_rate = Gauge('openappsec_detection_rate', 'Attack detection rate')
false_positive_rate = Gauge('openappsec_false_positive_rate', 'False positive rate')

# Resource metrics
memory_usage = Gauge('openappsec_memory_usage_bytes', 'Memory usage')
cpu_usage = Gauge('openappsec_cpu_usage_percent', 'CPU usage percentage')

def collect_metrics():
    """Collect and update metrics"""
    while True:
        # Simulate metrics
        attack_types = ['sql_injection', 'xss', 'csrf', 'command_injection']
        
        for attack_type in attack_types:
            attacks_detected.labels(attack_type=attack_type).inc(random.randint(0, 10))
            attacks_blocked.labels(attack_type=attack_type).inc(random.randint(0, 10))
        
        request_latency.observe(random.uniform(0.0001, 0.001))
        throughput.set(random.randint(5000, 10000))
        
        waf_up.set(1)
        detection_rate.set(random.uniform(0.95, 0.99))
        false_positive_rate.set(random.uniform(0.0001, 0.001))
        
        memory_usage.set(random.randint(1000000000, 2000000000))
        cpu_usage.set(random.uniform(20, 40))
        
        time.sleep(15)

if __name__ == '__main__':
    start_http_server(9093)
    print("OpenAppSec metrics exporter started on port 9093")
    collect_metrics()
