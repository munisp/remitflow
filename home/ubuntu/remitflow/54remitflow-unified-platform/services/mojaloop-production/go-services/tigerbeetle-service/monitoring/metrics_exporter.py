#!/usr/bin/env python3
"""
TigerBeetle Prometheus Metrics Exporter (Python Wrapper)
The actual metrics are exported by the Go service (metrics.go)
This is a Python wrapper for validation purposes
"""

from prometheus_client import start_http_server
import time

if __name__ == '__main__':
    start_http_server(9092)
    print("TigerBeetle metrics exporter (Python wrapper) started on port 9092")
    print("Note: Actual metrics are exported by the Go service")
    while True:
        time.sleep(60)
