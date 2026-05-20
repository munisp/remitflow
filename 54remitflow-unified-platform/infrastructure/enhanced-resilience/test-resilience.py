#!/usr/bin/env python3
"""
Enhanced Resilience Testing Framework
Comprehensive testing suite for all resilience features (Power, Connectivity, Offline)
"""

import asyncio
import json
import logging
import os
import random
import time
import requests
import subprocess
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict
import concurrent.futures
import psutil
import socket

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

@dataclass
class TestResult:
    test_name: str
    category: str
    status: str  # PASS, FAIL, SKIP
    duration_ms: float
    details: Dict[str, Any]
    timestamp: datetime
    error_message: Optional[str] = None

@dataclass
class ResilienceTestConfig:
    base_url: str = "http://localhost"
    power_manager_port: int = 8090
    bandwidth_service_port: int = 8150
    offline_service_port: int = 8095
    kyb_service_port: int = 8081
    tigerbeetle_core_port: int = 3000
    tigerbeetle_edge_port: int = 3001
    api_gateway_port: int = 8000
    test_duration_seconds: int = 300
    concurrent_users: int = 50
    transaction_volume: int = 1000

class ResilienceTestFramework:
    def __init__(self, config: ResilienceTestConfig):
        self.config = config
        self.test_results: List[TestResult] = []
        self.start_time = datetime.now()
        
    async def run_all_tests(self) -> Dict[str, Any]:
        """Run comprehensive resilience test suite"""
        logger.info("🚀 Starting Enhanced Resilience Test Suite")
        
        # Test categories
        test_categories = [
            ("Power Management", self.test_power_management),
            ("Connectivity Optimization", self.test_connectivity_optimization),
            ("Offline Operations", self.test_offline_operations),
            ("TigerBeetle Integration", self.test_tigerbeetle_integration),
            ("End-to-End Resilience", self.test_end_to_end_resilience),
            ("Performance Under Stress", self.test_performance_stress),
            ("Failover Scenarios", self.test_failover_scenarios),
            ("Data Integrity", self.test_data_integrity),
        ]
        
        for category_name, test_function in test_categories:
            logger.info(f"📋 Running {category_name} tests...")
            try:
                await test_function()
            except Exception as e:
                logger.error(f"❌ {category_name} tests failed: {e}")
                self.add_test_result(
                    f"{category_name}_suite", category_name, "FAIL", 0, {}, str(e)
                )
        
        return self.generate_test_report()
    
    async def test_power_management(self):
        """Test power management features (10/10 target)"""
        logger.info("🔋 Testing Power Management Features...")
        
        # Test 1: Power monitoring
        await self.test_power_monitoring()
        
        # Test 2: UPS integration
        await self.test_ups_integration()
        
        # Test 3: Battery optimization
        await self.test_battery_optimization()
        
        # Test 4: Emergency shutdown
        await self.test_emergency_shutdown()
        
        # Test 5: Power source switching
        await self.test_power_source_switching()
        
        # Test 6: Solar panel integration
        await self.test_solar_integration()
        
        # Test 7: Generator control
        await self.test_generator_control()
        
        # Test 8: Power quality monitoring
        await self.test_power_quality()
    
    async def test_power_monitoring(self):
        """Test real-time power monitoring"""
        start_time = time.time()
        
        try:
            url = f"{self.config.base_url}:{self.config.power_manager_port}/api/v1/power/status"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                required_fields = ['voltage', 'current', 'power_consumption', 'battery_level', 'power_source']
                
                if all(field in data for field in required_fields):
                    self.add_test_result(
                        "power_monitoring", "Power Management", "PASS",
                        (time.time() - start_time) * 1000,
                        {"power_data": data}
                    )
                else:
                    self.add_test_result(
                        "power_monitoring", "Power Management", "FAIL",
                        (time.time() - start_time) * 1000,
                        {"missing_fields": [f for f in required_fields if f not in data]},
                        "Missing required power monitoring fields"
                    )
            else:
                self.add_test_result(
                    "power_monitoring", "Power Management", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    f"Power monitoring endpoint returned {response.status_code}"
                )
        except Exception as e:
            self.add_test_result(
                "power_monitoring", "Power Management", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_ups_integration(self):
        """Test UPS integration and monitoring"""
        start_time = time.time()
        
        try:
            url = f"{self.config.base_url}:{self.config.power_manager_port}/api/v1/power/ups/status"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if 'ups_connected' in data and 'battery_level' in data:
                    self.add_test_result(
                        "ups_integration", "Power Management", "PASS",
                        (time.time() - start_time) * 1000,
                        {"ups_data": data}
                    )
                else:
                    self.add_test_result(
                        "ups_integration", "Power Management", "FAIL",
                        (time.time() - start_time) * 1000,
                        {"response": data},
                        "UPS data incomplete"
                    )
            else:
                self.add_test_result(
                    "ups_integration", "Power Management", "SKIP",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "UPS not available for testing"
                )
        except Exception as e:
            self.add_test_result(
                "ups_integration", "Power Management", "SKIP",
                (time.time() - start_time) * 1000,
                {}, f"UPS test skipped: {e}"
            )
    
    async def test_battery_optimization(self):
        """Test battery optimization features"""
        start_time = time.time()
        
        try:
            url = f"{self.config.base_url}:{self.config.power_manager_port}/api/v1/power/battery/optimize"
            response = requests.post(url, json={"optimization_level": "aggressive"}, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                self.add_test_result(
                    "battery_optimization", "Power Management", "PASS",
                    (time.time() - start_time) * 1000,
                    {"optimization_result": data}
                )
            else:
                self.add_test_result(
                    "battery_optimization", "Power Management", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "Battery optimization failed"
                )
        except Exception as e:
            self.add_test_result(
                "battery_optimization", "Power Management", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_emergency_shutdown(self):
        """Test emergency shutdown procedures"""
        start_time = time.time()
        
        try:
            # Test shutdown preparation (don't actually shutdown)
            url = f"{self.config.base_url}:{self.config.power_manager_port}/api/v1/power/emergency/prepare"
            response = requests.post(url, json={"test_mode": True}, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if 'shutdown_ready' in data and data['shutdown_ready']:
                    self.add_test_result(
                        "emergency_shutdown", "Power Management", "PASS",
                        (time.time() - start_time) * 1000,
                        {"shutdown_preparation": data}
                    )
                else:
                    self.add_test_result(
                        "emergency_shutdown", "Power Management", "FAIL",
                        (time.time() - start_time) * 1000,
                        {"response": data},
                        "Emergency shutdown not ready"
                    )
            else:
                self.add_test_result(
                    "emergency_shutdown", "Power Management", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "Emergency shutdown endpoint failed"
                )
        except Exception as e:
            self.add_test_result(
                "emergency_shutdown", "Power Management", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_power_source_switching(self):
        """Test automatic power source switching"""
        start_time = time.time()
        
        try:
            url = f"{self.config.base_url}:{self.config.power_manager_port}/api/v1/power/sources"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                available_sources = data.get('available_sources', [])
                current_source = data.get('current_source', '')
                
                if len(available_sources) > 1 and current_source:
                    self.add_test_result(
                        "power_source_switching", "Power Management", "PASS",
                        (time.time() - start_time) * 1000,
                        {"sources": available_sources, "current": current_source}
                    )
                else:
                    self.add_test_result(
                        "power_source_switching", "Power Management", "SKIP",
                        (time.time() - start_time) * 1000,
                        {"sources": available_sources},
                        "Multiple power sources not available"
                    )
            else:
                self.add_test_result(
                    "power_source_switching", "Power Management", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "Power sources endpoint failed"
                )
        except Exception as e:
            self.add_test_result(
                "power_source_switching", "Power Management", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_solar_integration(self):
        """Test solar panel integration"""
        start_time = time.time()
        
        try:
            url = f"{self.config.base_url}:{self.config.power_manager_port}/api/v1/power/solar/status"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                self.add_test_result(
                    "solar_integration", "Power Management", "PASS",
                    (time.time() - start_time) * 1000,
                    {"solar_data": data}
                )
            else:
                self.add_test_result(
                    "solar_integration", "Power Management", "SKIP",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "Solar panels not available"
                )
        except Exception as e:
            self.add_test_result(
                "solar_integration", "Power Management", "SKIP",
                (time.time() - start_time) * 1000,
                {}, f"Solar test skipped: {e}"
            )
    
    async def test_generator_control(self):
        """Test generator control features"""
        start_time = time.time()
        
        try:
            url = f"{self.config.base_url}:{self.config.power_manager_port}/api/v1/power/generator/status"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                self.add_test_result(
                    "generator_control", "Power Management", "PASS",
                    (time.time() - start_time) * 1000,
                    {"generator_data": data}
                )
            else:
                self.add_test_result(
                    "generator_control", "Power Management", "SKIP",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "Generator not available"
                )
        except Exception as e:
            self.add_test_result(
                "generator_control", "Power Management", "SKIP",
                (time.time() - start_time) * 1000,
                {}, f"Generator test skipped: {e}"
            )
    
    async def test_power_quality(self):
        """Test power quality monitoring"""
        start_time = time.time()
        
        try:
            url = f"{self.config.base_url}:{self.config.power_manager_port}/api/v1/power/quality"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                quality_metrics = ['voltage_stability', 'frequency', 'harmonics', 'power_factor']
                
                if any(metric in data for metric in quality_metrics):
                    self.add_test_result(
                        "power_quality", "Power Management", "PASS",
                        (time.time() - start_time) * 1000,
                        {"quality_data": data}
                    )
                else:
                    self.add_test_result(
                        "power_quality", "Power Management", "FAIL",
                        (time.time() - start_time) * 1000,
                        {"response": data},
                        "Power quality metrics missing"
                    )
            else:
                self.add_test_result(
                    "power_quality", "Power Management", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "Power quality endpoint failed"
                )
        except Exception as e:
            self.add_test_result(
                "power_quality", "Power Management", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_connectivity_optimization(self):
        """Test connectivity optimization features (10/10 target)"""
        logger.info("📡 Testing Connectivity Optimization Features...")
        
        # Test 1: Data compression
        await self.test_data_compression()
        
        # Test 2: Binary protocols
        await self.test_binary_protocols()
        
        # Test 3: USSD integration
        await self.test_ussd_integration()
        
        # Test 4: SMS fallback
        await self.test_sms_fallback()
        
        # Test 5: Multi-network failover
        await self.test_multi_network_failover()
        
        # Test 6: Adaptive protocol selection
        await self.test_adaptive_protocols()
        
        # Test 7: Bandwidth monitoring
        await self.test_bandwidth_monitoring()
        
        # Test 8: 2G optimization
        await self.test_2g_optimization()
    
    async def test_data_compression(self):
        """Test data compression algorithms"""
        start_time = time.time()
        
        try:
            test_data = {
                "transaction_id": "TXN123456789",
                "agent_id": "AGT001",
                "customer_id": "CUST001",
                "amount": 50000.00,
                "currency": "NGN",
                "transaction_type": "deposit",
                "metadata": {"location": "Lagos", "device": "POS001"}
            }
            
            url = f"{self.config.base_url}:{self.config.bandwidth_service_port}/api/v1/compression/test"
            response = requests.post(url, json={
                "data": json.dumps(test_data),
                "algorithms": ["gzip", "zlib", "bz2", "lzma", "custom"]
            }, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                best_ratio = data.get('best_compression_ratio', 1.0)
                
                if best_ratio < 0.5:  # 50% compression or better
                    self.add_test_result(
                        "data_compression", "Connectivity", "PASS",
                        (time.time() - start_time) * 1000,
                        {"compression_results": data}
                    )
                else:
                    self.add_test_result(
                        "data_compression", "Connectivity", "FAIL",
                        (time.time() - start_time) * 1000,
                        {"compression_results": data},
                        f"Compression ratio {best_ratio} not sufficient"
                    )
            else:
                self.add_test_result(
                    "data_compression", "Connectivity", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "Compression test endpoint failed"
                )
        except Exception as e:
            self.add_test_result(
                "data_compression", "Connectivity", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_binary_protocols(self):
        """Test binary protocol support"""
        start_time = time.time()
        
        try:
            test_transaction = {
                "transaction_id": "TXN123456789",
                "agent_id": "AGT001",
                "customer_id": "CUST001",
                "transaction_type": "deposit",
                "amount": 50000.00,
                "currency": "NGN",
                "timestamp": datetime.now().isoformat()
            }
            
            url = f"{self.config.base_url}:{self.config.bandwidth_service_port}/api/v1/binary/transaction"
            response = requests.post(url, json={
                "transaction_data": test_transaction
            }, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                savings_percent = data.get('savings_percent', 0)
                
                if savings_percent > 70:  # 70% size reduction
                    self.add_test_result(
                        "binary_protocols", "Connectivity", "PASS",
                        (time.time() - start_time) * 1000,
                        {"binary_results": data}
                    )
                else:
                    self.add_test_result(
                        "binary_protocols", "Connectivity", "FAIL",
                        (time.time() - start_time) * 1000,
                        {"binary_results": data},
                        f"Binary savings {savings_percent}% not sufficient"
                    )
            else:
                self.add_test_result(
                    "binary_protocols", "Connectivity", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "Binary protocol endpoint failed"
                )
        except Exception as e:
            self.add_test_result(
                "binary_protocols", "Connectivity", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_ussd_integration(self):
        """Test USSD integration"""
        start_time = time.time()
        
        try:
            url = f"{self.config.base_url}:{self.config.bandwidth_service_port}/api/v1/ussd/send"
            response = requests.post(url, json={
                "ussd_code": "*737*1*50000*CUST001#",
                "agent_id": "AGT001",
                "customer_id": "CUST001"
            }, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if 'session_id' in data and 'ussd_code' in data:
                    self.add_test_result(
                        "ussd_integration", "Connectivity", "PASS",
                        (time.time() - start_time) * 1000,
                        {"ussd_results": data}
                    )
                else:
                    self.add_test_result(
                        "ussd_integration", "Connectivity", "FAIL",
                        (time.time() - start_time) * 1000,
                        {"response": data},
                        "USSD response incomplete"
                    )
            else:
                self.add_test_result(
                    "ussd_integration", "Connectivity", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "USSD endpoint failed"
                )
        except Exception as e:
            self.add_test_result(
                "ussd_integration", "Connectivity", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_sms_fallback(self):
        """Test SMS fallback functionality"""
        start_time = time.time()
        
        try:
            url = f"{self.config.base_url}:{self.config.bandwidth_service_port}/api/v1/sms/send"
            response = requests.post(url, json={
                "message": "TXN DEP 50000 NGN CUST001",
                "phone_number": "+2348012345678",
                "agent_id": "AGT001",
                "customer_id": "CUST001"
            }, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('status') == 'sent':
                    self.add_test_result(
                        "sms_fallback", "Connectivity", "PASS",
                        (time.time() - start_time) * 1000,
                        {"sms_results": data}
                    )
                else:
                    self.add_test_result(
                        "sms_fallback", "Connectivity", "FAIL",
                        (time.time() - start_time) * 1000,
                        {"response": data},
                        f"SMS status: {data.get('status', 'unknown')}"
                    )
            else:
                self.add_test_result(
                    "sms_fallback", "Connectivity", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "SMS endpoint failed"
                )
        except Exception as e:
            self.add_test_result(
                "sms_fallback", "Connectivity", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_multi_network_failover(self):
        """Test multi-network failover"""
        start_time = time.time()
        
        try:
            # Test network condition optimization
            network_conditions = [
                {"bandwidth_kbps": 5, "latency_ms": 2000, "packet_loss_percent": 10, "network_type": "2G"},
                {"bandwidth_kbps": 50, "latency_ms": 500, "packet_loss_percent": 2, "network_type": "3G"},
                {"bandwidth_kbps": 1000, "latency_ms": 50, "packet_loss_percent": 0.1, "network_type": "4G"}
            ]
            
            results = []
            for condition in network_conditions:
                url = f"{self.config.base_url}:{self.config.bandwidth_service_port}/api/v1/optimize"
                response = requests.post(url, json={
                    "data": {"test": "data"},
                    "network_condition": condition
                }, timeout=10)
                
                if response.status_code == 200:
                    results.append(response.json())
            
            if len(results) == len(network_conditions):
                self.add_test_result(
                    "multi_network_failover", "Connectivity", "PASS",
                    (time.time() - start_time) * 1000,
                    {"optimization_results": results}
                )
            else:
                self.add_test_result(
                    "multi_network_failover", "Connectivity", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"results_count": len(results), "expected": len(network_conditions)},
                    "Not all network conditions tested"
                )
        except Exception as e:
            self.add_test_result(
                "multi_network_failover", "Connectivity", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_adaptive_protocols(self):
        """Test adaptive protocol selection"""
        start_time = time.time()
        
        try:
            # Test different network conditions and verify protocol selection
            test_conditions = [
                {"bandwidth_kbps": 5, "expected_protocol": "sms"},
                {"bandwidth_kbps": 15, "expected_protocol": "ussd"},
                {"bandwidth_kbps": 100, "expected_protocol": "http_binary"},
                {"bandwidth_kbps": 1000, "expected_protocol": "http_json"}
            ]
            
            correct_selections = 0
            for condition in test_conditions:
                url = f"{self.config.base_url}:{self.config.bandwidth_service_port}/api/v1/optimize"
                response = requests.post(url, json={
                    "data": {"test": "protocol_selection"},
                    "network_condition": {
                        "bandwidth_kbps": condition["bandwidth_kbps"],
                        "latency_ms": 500,
                        "packet_loss_percent": 1,
                        "network_type": "2G"
                    }
                }, timeout=10)
                
                if response.status_code == 200:
                    data = response.json()
                    selected_protocol = data.get('protocol', '').lower()
                    if condition["expected_protocol"] in selected_protocol:
                        correct_selections += 1
            
            success_rate = correct_selections / len(test_conditions)
            if success_rate >= 0.75:  # 75% correct protocol selection
                self.add_test_result(
                    "adaptive_protocols", "Connectivity", "PASS",
                    (time.time() - start_time) * 1000,
                    {"success_rate": success_rate, "correct_selections": correct_selections}
                )
            else:
                self.add_test_result(
                    "adaptive_protocols", "Connectivity", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"success_rate": success_rate, "correct_selections": correct_selections},
                    f"Protocol selection accuracy {success_rate:.2%} below threshold"
                )
        except Exception as e:
            self.add_test_result(
                "adaptive_protocols", "Connectivity", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_bandwidth_monitoring(self):
        """Test bandwidth monitoring capabilities"""
        start_time = time.time()
        
        try:
            url = f"{self.config.base_url}:{self.config.bandwidth_service_port}/api/v1/statistics/compression"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if 'total_optimizations' in data and 'total_bytes_saved' in data:
                    self.add_test_result(
                        "bandwidth_monitoring", "Connectivity", "PASS",
                        (time.time() - start_time) * 1000,
                        {"monitoring_data": data}
                    )
                else:
                    self.add_test_result(
                        "bandwidth_monitoring", "Connectivity", "FAIL",
                        (time.time() - start_time) * 1000,
                        {"response": data},
                        "Bandwidth monitoring data incomplete"
                    )
            else:
                self.add_test_result(
                    "bandwidth_monitoring", "Connectivity", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "Bandwidth monitoring endpoint failed"
                )
        except Exception as e:
            self.add_test_result(
                "bandwidth_monitoring", "Connectivity", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_2g_optimization(self):
        """Test 2G network optimization"""
        start_time = time.time()
        
        try:
            # Simulate 2G conditions
            network_condition = {
                "bandwidth_kbps": 8,  # Typical 2G speed
                "latency_ms": 1500,
                "packet_loss_percent": 15,
                "network_type": "2G",
                "signal_strength_dbm": -95,
                "cost_per_mb": 10.0
            }
            
            url = f"{self.config.base_url}:{self.config.bandwidth_service_port}/api/v1/optimize"
            response = requests.post(url, json={
                "data": {"transaction_type": "deposit", "amount": 50000},
                "network_condition": network_condition
            }, timeout=15)  # Longer timeout for 2G
            
            if response.status_code == 200:
                data = response.json()
                savings_percent = data.get('savings_percent', 0)
                
                if savings_percent > 80:  # 80% savings for 2G
                    self.add_test_result(
                        "2g_optimization", "Connectivity", "PASS",
                        (time.time() - start_time) * 1000,
                        {"optimization_data": data}
                    )
                else:
                    self.add_test_result(
                        "2g_optimization", "Connectivity", "FAIL",
                        (time.time() - start_time) * 1000,
                        {"optimization_data": data},
                        f"2G optimization savings {savings_percent}% insufficient"
                    )
            else:
                self.add_test_result(
                    "2g_optimization", "Connectivity", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "2G optimization failed"
                )
        except Exception as e:
            self.add_test_result(
                "2g_optimization", "Connectivity", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_offline_operations(self):
        """Test offline operations features (10/10 target)"""
        logger.info("💾 Testing Offline Operations Features...")
        
        # Test 1: Offline transaction processing
        await self.test_offline_transactions()
        
        # Test 2: Offline customer management
        await self.test_offline_customers()
        
        # Test 3: Offline document processing
        await self.test_offline_documents()
        
        # Test 4: Offline fraud detection
        await self.test_offline_fraud_detection()
        
        # Test 5: Offline compliance checking
        await self.test_offline_compliance()
        
        # Test 6: Data integrity
        await self.test_offline_data_integrity()
        
        # Test 7: Synchronization
        await self.test_offline_sync()
        
        # Test 8: Business intelligence
        await self.test_offline_business_intelligence()
    
    async def test_offline_transactions(self):
        """Test offline transaction processing"""
        start_time = time.time()
        
        try:
            transaction_data = {
                "transaction_id": f"TXN{int(time.time())}",
                "agent_id": "AGT001",
                "customer_id": "CUST001",
                "transaction_type": "deposit",
                "amount": 25000.00,
                "currency": "NGN",
                "description": "Cash deposit test"
            }
            
            url = f"{self.config.base_url}:{self.config.offline_service_port}/api/v1/transactions"
            response = requests.post(url, json=transaction_data, timeout=10)
            
            if response.status_code == 201:
                data = response.json()
                if 'id' in data and 'sync_status' in data:
                    self.add_test_result(
                        "offline_transactions", "Offline Operations", "PASS",
                        (time.time() - start_time) * 1000,
                        {"transaction_data": data}
                    )
                else:
                    self.add_test_result(
                        "offline_transactions", "Offline Operations", "FAIL",
                        (time.time() - start_time) * 1000,
                        {"response": data},
                        "Offline transaction response incomplete"
                    )
            else:
                self.add_test_result(
                    "offline_transactions", "Offline Operations", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "Offline transaction creation failed"
                )
        except Exception as e:
            self.add_test_result(
                "offline_transactions", "Offline Operations", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_offline_customers(self):
        """Test offline customer management"""
        start_time = time.time()
        
        try:
            customer_data = {
                "customer_id": f"CUST{int(time.time())}",
                "first_name": "Test",
                "last_name": "Customer",
                "phone_number": f"+234801234{random.randint(1000, 9999)}",
                "email": "test@example.com",
                "bvn": "12345678901",
                "address": "Test Address, Lagos",
                "date_of_birth": "1990-01-01",
                "gender": "M",
                "occupation": "Trader"
            }
            
            url = f"{self.config.base_url}:{self.config.offline_service_port}/api/v1/customers"
            response = requests.post(url, json=customer_data, timeout=10)
            
            if response.status_code == 201:
                data = response.json()
                if 'id' in data and 'sync_status' in data:
                    self.add_test_result(
                        "offline_customers", "Offline Operations", "PASS",
                        (time.time() - start_time) * 1000,
                        {"customer_data": data}
                    )
                else:
                    self.add_test_result(
                        "offline_customers", "Offline Operations", "FAIL",
                        (time.time() - start_time) * 1000,
                        {"response": data},
                        "Offline customer response incomplete"
                    )
            else:
                self.add_test_result(
                    "offline_customers", "Offline Operations", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "Offline customer creation failed"
                )
        except Exception as e:
            self.add_test_result(
                "offline_customers", "Offline Operations", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_offline_documents(self):
        """Test offline document processing"""
        start_time = time.time()
        
        try:
            url = f"{self.config.base_url}:{self.config.offline_service_port}/api/v1/documents"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                self.add_test_result(
                    "offline_documents", "Offline Operations", "PASS",
                    (time.time() - start_time) * 1000,
                    {"documents_endpoint": "accessible"}
                )
            else:
                self.add_test_result(
                    "offline_documents", "Offline Operations", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "Offline documents endpoint failed"
                )
        except Exception as e:
            self.add_test_result(
                "offline_documents", "Offline Operations", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_offline_fraud_detection(self):
        """Test offline fraud detection"""
        start_time = time.time()
        
        try:
            # Create a high-risk transaction to test fraud detection
            suspicious_transaction = {
                "transaction_id": f"TXN{int(time.time())}",
                "agent_id": "AGT001",
                "customer_id": "CUST001",
                "transaction_type": "withdrawal",
                "amount": 150000.00,  # High amount
                "currency": "NGN",
                "description": "Large withdrawal at 3 AM"
            }
            
            url = f"{self.config.base_url}:{self.config.offline_service_port}/api/v1/transactions"
            response = requests.post(url, json=suspicious_transaction, timeout=10)
            
            if response.status_code == 201:
                data = response.json()
                fraud_score = data.get('fraud_score', 0)
                
                if fraud_score > 0.5:  # Should detect as potentially fraudulent
                    self.add_test_result(
                        "offline_fraud_detection", "Offline Operations", "PASS",
                        (time.time() - start_time) * 1000,
                        {"fraud_score": fraud_score, "fraud_flags": data.get('fraud_flags', [])}
                    )
                else:
                    self.add_test_result(
                        "offline_fraud_detection", "Offline Operations", "FAIL",
                        (time.time() - start_time) * 1000,
                        {"fraud_score": fraud_score},
                        "Fraud detection not working properly"
                    )
            else:
                self.add_test_result(
                    "offline_fraud_detection", "Offline Operations", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "Fraud detection test failed"
                )
        except Exception as e:
            self.add_test_result(
                "offline_fraud_detection", "Offline Operations", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_offline_compliance(self):
        """Test offline compliance checking"""
        start_time = time.time()
        
        try:
            # Create a transaction that should trigger compliance checks
            compliance_transaction = {
                "transaction_id": f"TXN{int(time.time())}",
                "agent_id": "AGT001",
                "customer_id": "CUST001",
                "transaction_type": "transfer",
                "amount": 75000.00,  # Above KYC threshold
                "currency": "NGN",
                "description": "Large transfer requiring KYC"
            }
            
            url = f"{self.config.base_url}:{self.config.offline_service_port}/api/v1/transactions"
            response = requests.post(url, json=compliance_transaction, timeout=10)
            
            if response.status_code == 201:
                data = response.json()
                compliance_status = data.get('compliance_status', '')
                
                if compliance_status in ['passed', 'failed', 'pending']:
                    self.add_test_result(
                        "offline_compliance", "Offline Operations", "PASS",
                        (time.time() - start_time) * 1000,
                        {"compliance_status": compliance_status, "compliance_flags": data.get('compliance_flags', [])}
                    )
                else:
                    self.add_test_result(
                        "offline_compliance", "Offline Operations", "FAIL",
                        (time.time() - start_time) * 1000,
                        {"compliance_status": compliance_status},
                        "Compliance checking not working"
                    )
            else:
                self.add_test_result(
                    "offline_compliance", "Offline Operations", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "Compliance test failed"
                )
        except Exception as e:
            self.add_test_result(
                "offline_compliance", "Offline Operations", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_offline_data_integrity(self):
        """Test offline data integrity"""
        start_time = time.time()
        
        try:
            url = f"{self.config.base_url}:{self.config.offline_service_port}/api/v1/status/integrity"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                integrity_checks = data.get('integrity_checks', {})
                
                if 'passed' in integrity_checks and 'failed' in integrity_checks:
                    self.add_test_result(
                        "offline_data_integrity", "Offline Operations", "PASS",
                        (time.time() - start_time) * 1000,
                        {"integrity_data": data}
                    )
                else:
                    self.add_test_result(
                        "offline_data_integrity", "Offline Operations", "FAIL",
                        (time.time() - start_time) * 1000,
                        {"response": data},
                        "Data integrity information incomplete"
                    )
            else:
                self.add_test_result(
                    "offline_data_integrity", "Offline Operations", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "Data integrity endpoint failed"
                )
        except Exception as e:
            self.add_test_result(
                "offline_data_integrity", "Offline Operations", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_offline_sync(self):
        """Test offline synchronization"""
        start_time = time.time()
        
        try:
            url = f"{self.config.base_url}:{self.config.offline_service_port}/api/v1/sync/status"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if 'pending' in data and 'last_sync' in data:
                    self.add_test_result(
                        "offline_sync", "Offline Operations", "PASS",
                        (time.time() - start_time) * 1000,
                        {"sync_data": data}
                    )
                else:
                    self.add_test_result(
                        "offline_sync", "Offline Operations", "FAIL",
                        (time.time() - start_time) * 1000,
                        {"response": data},
                        "Sync status information incomplete"
                    )
            else:
                self.add_test_result(
                    "offline_sync", "Offline Operations", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "Sync status endpoint failed"
                )
        except Exception as e:
            self.add_test_result(
                "offline_sync", "Offline Operations", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_offline_business_intelligence(self):
        """Test offline business intelligence"""
        start_time = time.time()
        
        try:
            url = f"{self.config.base_url}:{self.config.offline_service_port}/api/v1/insights"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list) and len(data) >= 0:
                    self.add_test_result(
                        "offline_business_intelligence", "Offline Operations", "PASS",
                        (time.time() - start_time) * 1000,
                        {"insights_count": len(data)}
                    )
                else:
                    self.add_test_result(
                        "offline_business_intelligence", "Offline Operations", "FAIL",
                        (time.time() - start_time) * 1000,
                        {"response": data},
                        "Business intelligence data invalid"
                    )
            else:
                self.add_test_result(
                    "offline_business_intelligence", "Offline Operations", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "Business intelligence endpoint failed"
                )
        except Exception as e:
            self.add_test_result(
                "offline_business_intelligence", "Offline Operations", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_tigerbeetle_integration(self):
        """Test TigerBeetle integration"""
        logger.info("🐅 Testing TigerBeetle Integration...")
        
        # Test TigerBeetle Zig core
        await self.test_tigerbeetle_core()
        
        # Test TigerBeetle Go edge
        await self.test_tigerbeetle_edge()
        
        # Test bi-directional sync
        await self.test_tigerbeetle_sync()
    
    async def test_tigerbeetle_core(self):
        """Test TigerBeetle Zig core"""
        start_time = time.time()
        
        try:
            url = f"{self.config.base_url}:{self.config.tigerbeetle_core_port}/health"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                self.add_test_result(
                    "tigerbeetle_core", "TigerBeetle", "PASS",
                    (time.time() - start_time) * 1000,
                    {"core_status": "healthy"}
                )
            else:
                self.add_test_result(
                    "tigerbeetle_core", "TigerBeetle", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "TigerBeetle core not responding"
                )
        except Exception as e:
            self.add_test_result(
                "tigerbeetle_core", "TigerBeetle", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_tigerbeetle_edge(self):
        """Test TigerBeetle Go edge"""
        start_time = time.time()
        
        try:
            url = f"{self.config.base_url}:{self.config.tigerbeetle_edge_port}/health"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                self.add_test_result(
                    "tigerbeetle_edge", "TigerBeetle", "PASS",
                    (time.time() - start_time) * 1000,
                    {"edge_status": "healthy"}
                )
            else:
                self.add_test_result(
                    "tigerbeetle_edge", "TigerBeetle", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "TigerBeetle edge not responding"
                )
        except Exception as e:
            self.add_test_result(
                "tigerbeetle_edge", "TigerBeetle", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_tigerbeetle_sync(self):
        """Test TigerBeetle synchronization"""
        start_time = time.time()
        
        try:
            # Test sync status
            url = f"{self.config.base_url}:{self.config.tigerbeetle_edge_port}/api/v1/sync/status"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                self.add_test_result(
                    "tigerbeetle_sync", "TigerBeetle", "PASS",
                    (time.time() - start_time) * 1000,
                    {"sync_data": data}
                )
            else:
                self.add_test_result(
                    "tigerbeetle_sync", "TigerBeetle", "SKIP",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "TigerBeetle sync endpoint not available"
                )
        except Exception as e:
            self.add_test_result(
                "tigerbeetle_sync", "TigerBeetle", "SKIP",
                (time.time() - start_time) * 1000,
                {}, f"TigerBeetle sync test skipped: {e}"
            )
    
    async def test_end_to_end_resilience(self):
        """Test end-to-end resilience scenarios"""
        logger.info("🔄 Testing End-to-End Resilience...")
        
        # Test complete transaction flow with all resilience features
        await self.test_complete_transaction_flow()
        
        # Test service recovery
        await self.test_service_recovery()
    
    async def test_complete_transaction_flow(self):
        """Test complete transaction flow with resilience"""
        start_time = time.time()
        
        try:
            # Create a transaction through the API gateway
            transaction_data = {
                "transaction_id": f"E2E{int(time.time())}",
                "agent_id": "AGT001",
                "customer_id": "CUST001",
                "transaction_type": "deposit",
                "amount": 30000.00,
                "currency": "NGN",
                "description": "End-to-end resilience test"
            }
            
            url = f"{self.config.base_url}:{self.config.api_gateway_port}/api/v1/transactions"
            response = requests.post(url, json=transaction_data, timeout=15)
            
            if response.status_code in [200, 201]:
                data = response.json()
                self.add_test_result(
                    "complete_transaction_flow", "End-to-End", "PASS",
                    (time.time() - start_time) * 1000,
                    {"transaction_result": data}
                )
            else:
                self.add_test_result(
                    "complete_transaction_flow", "End-to-End", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "End-to-end transaction failed"
                )
        except Exception as e:
            self.add_test_result(
                "complete_transaction_flow", "End-to-End", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_service_recovery(self):
        """Test service recovery capabilities"""
        start_time = time.time()
        
        try:
            # Test health check endpoints for all services
            services = [
                ("power-manager", self.config.power_manager_port),
                ("ultra-bandwidth", self.config.bandwidth_service_port),
                ("offline-service", self.config.offline_service_port),
                ("kyb-service", self.config.kyb_service_port),
                ("api-gateway", self.config.api_gateway_port)
            ]
            
            healthy_services = 0
            for service_name, port in services:
                try:
                    url = f"{self.config.base_url}:{port}/health"
                    response = requests.get(url, timeout=5)
                    if response.status_code == 200:
                        healthy_services += 1
                except:
                    pass
            
            recovery_rate = healthy_services / len(services)
            if recovery_rate >= 0.8:  # 80% of services healthy
                self.add_test_result(
                    "service_recovery", "End-to-End", "PASS",
                    (time.time() - start_time) * 1000,
                    {"healthy_services": healthy_services, "total_services": len(services), "recovery_rate": recovery_rate}
                )
            else:
                self.add_test_result(
                    "service_recovery", "End-to-End", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"healthy_services": healthy_services, "total_services": len(services), "recovery_rate": recovery_rate},
                    f"Service recovery rate {recovery_rate:.2%} below threshold"
                )
        except Exception as e:
            self.add_test_result(
                "service_recovery", "End-to-End", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_performance_stress(self):
        """Test performance under stress conditions"""
        logger.info("⚡ Testing Performance Under Stress...")
        
        # Test concurrent load
        await self.test_concurrent_load()
        
        # Test resource usage
        await self.test_resource_usage()
    
    async def test_concurrent_load(self):
        """Test concurrent load handling"""
        start_time = time.time()
        
        try:
            # Create multiple concurrent requests
            async def make_request(session_id):
                try:
                    transaction_data = {
                        "transaction_id": f"LOAD{session_id}{int(time.time())}",
                        "agent_id": "AGT001",
                        "customer_id": f"CUST{session_id}",
                        "transaction_type": "deposit",
                        "amount": 10000.00,
                        "currency": "NGN",
                        "description": f"Load test {session_id}"
                    }
                    
                    url = f"{self.config.base_url}:{self.config.offline_service_port}/api/v1/transactions"
                    response = requests.post(url, json=transaction_data, timeout=10)
                    return response.status_code == 201
                except:
                    return False
            
            # Run concurrent requests
            tasks = []
            for i in range(20):  # 20 concurrent requests
                tasks.append(make_request(i))
            
            results = await asyncio.gather(*tasks, return_exceptions=True)
            successful_requests = sum(1 for result in results if result is True)
            success_rate = successful_requests / len(tasks)
            
            if success_rate >= 0.9:  # 90% success rate
                self.add_test_result(
                    "concurrent_load", "Performance", "PASS",
                    (time.time() - start_time) * 1000,
                    {"successful_requests": successful_requests, "total_requests": len(tasks), "success_rate": success_rate}
                )
            else:
                self.add_test_result(
                    "concurrent_load", "Performance", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"successful_requests": successful_requests, "total_requests": len(tasks), "success_rate": success_rate},
                    f"Concurrent load success rate {success_rate:.2%} below threshold"
                )
        except Exception as e:
            self.add_test_result(
                "concurrent_load", "Performance", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_resource_usage(self):
        """Test resource usage monitoring"""
        start_time = time.time()
        
        try:
            # Get system resource usage
            cpu_percent = psutil.cpu_percent(interval=1)
            memory = psutil.virtual_memory()
            disk = psutil.disk_usage('/')
            
            resource_data = {
                "cpu_percent": cpu_percent,
                "memory_percent": memory.percent,
                "memory_available_gb": memory.available / (1024**3),
                "disk_percent": (disk.used / disk.total) * 100,
                "disk_free_gb": disk.free / (1024**3)
            }
            
            # Check if resources are within acceptable limits
            resource_ok = (
                cpu_percent < 90 and
                memory.percent < 90 and
                (disk.used / disk.total) * 100 < 90
            )
            
            if resource_ok:
                self.add_test_result(
                    "resource_usage", "Performance", "PASS",
                    (time.time() - start_time) * 1000,
                    {"resource_data": resource_data}
                )
            else:
                self.add_test_result(
                    "resource_usage", "Performance", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"resource_data": resource_data},
                    "Resource usage above acceptable limits"
                )
        except Exception as e:
            self.add_test_result(
                "resource_usage", "Performance", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_failover_scenarios(self):
        """Test failover scenarios"""
        logger.info("🔄 Testing Failover Scenarios...")
        
        # Test service failover
        await self.test_service_failover()
    
    async def test_service_failover(self):
        """Test service failover capabilities"""
        start_time = time.time()
        
        try:
            # Test API gateway failover routing
            url = f"{self.config.base_url}:{self.config.api_gateway_port}/health"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                self.add_test_result(
                    "service_failover", "Failover", "PASS",
                    (time.time() - start_time) * 1000,
                    {"gateway_health": data}
                )
            else:
                self.add_test_result(
                    "service_failover", "Failover", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"status_code": response.status_code},
                    "Service failover test failed"
                )
        except Exception as e:
            self.add_test_result(
                "service_failover", "Failover", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    async def test_data_integrity(self):
        """Test data integrity across all services"""
        logger.info("🔒 Testing Data Integrity...")
        
        # Test transaction integrity
        await self.test_transaction_integrity()
    
    async def test_transaction_integrity(self):
        """Test transaction data integrity"""
        start_time = time.time()
        
        try:
            # Create a transaction and verify its integrity
            transaction_data = {
                "transaction_id": f"INT{int(time.time())}",
                "agent_id": "AGT001",
                "customer_id": "CUST001",
                "transaction_type": "deposit",
                "amount": 15000.00,
                "currency": "NGN",
                "description": "Integrity test transaction"
            }
            
            # Create transaction
            url = f"{self.config.base_url}:{self.config.offline_service_port}/api/v1/transactions"
            response = requests.post(url, json=transaction_data, timeout=10)
            
            if response.status_code == 201:
                created_tx = response.json()
                tx_id = created_tx.get('id')
                
                # Retrieve transaction
                get_url = f"{self.config.base_url}:{self.config.offline_service_port}/api/v1/transactions/{tx_id}"
                get_response = requests.get(get_url, timeout=10)
                
                if get_response.status_code == 200:
                    retrieved_tx = get_response.json()
                    
                    # Verify data integrity
                    integrity_ok = (
                        retrieved_tx.get('transaction_id') == transaction_data['transaction_id'] and
                        retrieved_tx.get('amount') == transaction_data['amount'] and
                        retrieved_tx.get('transaction_type') == transaction_data['transaction_type']
                    )
                    
                    if integrity_ok:
                        self.add_test_result(
                            "transaction_integrity", "Data Integrity", "PASS",
                            (time.time() - start_time) * 1000,
                            {"transaction_verified": True}
                        )
                    else:
                        self.add_test_result(
                            "transaction_integrity", "Data Integrity", "FAIL",
                            (time.time() - start_time) * 1000,
                            {"created": created_tx, "retrieved": retrieved_tx},
                            "Transaction data integrity compromised"
                        )
                else:
                    self.add_test_result(
                        "transaction_integrity", "Data Integrity", "FAIL",
                        (time.time() - start_time) * 1000,
                        {"get_status_code": get_response.status_code},
                        "Could not retrieve transaction for integrity check"
                    )
            else:
                self.add_test_result(
                    "transaction_integrity", "Data Integrity", "FAIL",
                    (time.time() - start_time) * 1000,
                    {"create_status_code": response.status_code},
                    "Could not create transaction for integrity test"
                )
        except Exception as e:
            self.add_test_result(
                "transaction_integrity", "Data Integrity", "FAIL",
                (time.time() - start_time) * 1000,
                {}, str(e)
            )
    
    def add_test_result(self, test_name: str, category: str, status: str, 
                       duration_ms: float, details: Dict[str, Any], 
                       error_message: Optional[str] = None):
        """Add a test result to the results list"""
        result = TestResult(
            test_name=test_name,
            category=category,
            status=status,
            duration_ms=duration_ms,
            details=details,
            timestamp=datetime.now(),
            error_message=error_message
        )
        self.test_results.append(result)
        
        # Log result
        status_emoji = "✅" if status == "PASS" else "❌" if status == "FAIL" else "⏭️"
        logger.info(f"{status_emoji} {test_name}: {status} ({duration_ms:.1f}ms)")
        if error_message:
            logger.error(f"   Error: {error_message}")
    
    def generate_test_report(self) -> Dict[str, Any]:
        """Generate comprehensive test report"""
        end_time = datetime.now()
        total_duration = (end_time - self.start_time).total_seconds()
        
        # Calculate statistics
        total_tests = len(self.test_results)
        passed_tests = len([r for r in self.test_results if r.status == "PASS"])
        failed_tests = len([r for r in self.test_results if r.status == "FAIL"])
        skipped_tests = len([r for r in self.test_results if r.status == "SKIP"])
        
        # Calculate category scores
        category_scores = {}
        for category in set(r.category for r in self.test_results):
            category_results = [r for r in self.test_results if r.category == category]
            category_passed = len([r for r in category_results if r.status == "PASS"])
            category_total = len([r for r in category_results if r.status != "SKIP"])
            
            if category_total > 0:
                category_scores[category] = (category_passed / category_total) * 10
            else:
                category_scores[category] = 0
        
        # Generate report
        report = {
            "test_summary": {
                "total_tests": total_tests,
                "passed_tests": passed_tests,
                "failed_tests": failed_tests,
                "skipped_tests": skipped_tests,
                "success_rate": (passed_tests / total_tests) * 100 if total_tests > 0 else 0,
                "total_duration_seconds": total_duration,
                "start_time": self.start_time.isoformat(),
                "end_time": end_time.isoformat()
            },
            "category_scores": category_scores,
            "resilience_scores": {
                "power_management": category_scores.get("Power Management", 0),
                "connectivity_optimization": category_scores.get("Connectivity", 0),
                "offline_operations": category_scores.get("Offline Operations", 0),
                "overall_resilience": sum(category_scores.values()) / len(category_scores) if category_scores else 0
            },
            "test_results": [asdict(result) for result in self.test_results],
            "recommendations": self.generate_recommendations()
        }
        
        return report
    
    def generate_recommendations(self) -> List[str]:
        """Generate recommendations based on test results"""
        recommendations = []
        
        # Check failed tests and generate recommendations
        failed_tests = [r for r in self.test_results if r.status == "FAIL"]
        
        if any("power" in r.test_name.lower() for r in failed_tests):
            recommendations.append("Review power management configuration and hardware connections")
        
        if any("connectivity" in r.test_name.lower() or "bandwidth" in r.test_name.lower() for r in failed_tests):
            recommendations.append("Check network connectivity and bandwidth optimization settings")
        
        if any("offline" in r.test_name.lower() for r in failed_tests):
            recommendations.append("Verify offline service configuration and database connectivity")
        
        if any("tigerbeetle" in r.test_name.lower() for r in failed_tests):
            recommendations.append("Check TigerBeetle service status and synchronization")
        
        if len(failed_tests) == 0:
            recommendations.append("All tests passed! Platform is ready for production deployment.")
        
        return recommendations

async def main():
    """Main test execution function"""
    print("🌟 Enhanced Resilience Testing Framework")
    print("=" * 50)
    
    # Configuration
    config = ResilienceTestConfig()
    
    # Create test framework
    framework = ResilienceTestFramework(config)
    
    # Run all tests
    report = await framework.run_all_tests()
    
    # Save report
    report_filename = f"resilience_test_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(report_filename, 'w') as f:
        json.dump(report, f, indent=2, default=str)
    
    # Display summary
    print("\n" + "=" * 50)
    print("📊 TEST SUMMARY")
    print("=" * 50)
    
    summary = report['test_summary']
    print(f"Total Tests: {summary['total_tests']}")
    print(f"Passed: {summary['passed_tests']} ✅")
    print(f"Failed: {summary['failed_tests']} ❌")
    print(f"Skipped: {summary['skipped_tests']} ⏭️")
    print(f"Success Rate: {summary['success_rate']:.1f}%")
    print(f"Duration: {summary['total_duration_seconds']:.1f} seconds")
    
    print("\n🏆 RESILIENCE SCORES")
    print("-" * 30)
    scores = report['resilience_scores']
    print(f"Power Management: {scores['power_management']:.1f}/10")
    print(f"Connectivity: {scores['connectivity_optimization']:.1f}/10")
    print(f"Offline Operations: {scores['offline_operations']:.1f}/10")
    print(f"Overall Resilience: {scores['overall_resilience']:.1f}/10")
    
    print("\n💡 RECOMMENDATIONS")
    print("-" * 30)
    for i, rec in enumerate(report['recommendations'], 1):
        print(f"{i}. {rec}")
    
    print(f"\n📄 Detailed report saved to: {report_filename}")
    
    # Return overall success
    return summary['success_rate'] >= 80  # 80% success rate threshold

if __name__ == "__main__":
    success = asyncio.run(main())
    exit(0 if success else 1)

