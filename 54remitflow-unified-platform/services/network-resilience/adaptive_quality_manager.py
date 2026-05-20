#!/usr/bin/env python3
"""
Network Resilience and Adaptive Quality Manager
Handles network condition monitoring, adaptive quality streaming, and automatic retry mechanisms
"""

import os
import sys
import json
import time
import uuid
import threading
import logging
import subprocess
import statistics
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any, Union
from dataclasses import dataclass, asdict
from enum import Enum
from pathlib import Path
import queue
import asyncio

import requests
import psutil
from flask import Flask, request, jsonify
from flask_cors import CORS
import schedule

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class NetworkQuality(Enum):
    """Network quality levels"""
    EXCELLENT = "excellent"
    GOOD = "good"
    FAIR = "fair"
    POOR = "poor"
    VERY_POOR = "very_poor"
    OFFLINE = "offline"

class ConnectionType(Enum):
    """Connection types"""
    WIFI = "wifi"
    CELLULAR_5G = "cellular_5g"
    CELLULAR_4G = "cellular_4g"
    CELLULAR_3G = "cellular_3g"
    CELLULAR_2G = "cellular_2g"
    ETHERNET = "ethernet"
    UNKNOWN = "unknown"

class VideoQuality(Enum):
    """Video quality levels"""
    ULTRA_HIGH = "ultra_high"  # 1080p+
    HIGH = "high"              # 720p
    MEDIUM = "medium"          # 480p
    LOW = "low"                # 360p
    VERY_LOW = "very_low"      # 240p
    MINIMAL = "minimal"        # 144p

@dataclass
class NetworkMetrics:
    """Network performance metrics"""
    timestamp: datetime
    latency_ms: float
    download_speed_mbps: float
    upload_speed_mbps: float
    packet_loss_percent: float
    jitter_ms: float
    connection_type: ConnectionType
    signal_strength: Optional[int]  # For cellular connections
    quality: NetworkQuality

@dataclass
class QualityProfile:
    """Video quality profile"""
    quality: VideoQuality
    resolution: Tuple[int, int]
    bitrate_kbps: int
    fps: int
    codec: str
    min_bandwidth_mbps: float
    max_latency_ms: float
    max_packet_loss_percent: float

@dataclass
class RetryPolicy:
    """Retry policy configuration"""
    max_retries: int
    initial_delay_ms: int
    max_delay_ms: int
    backoff_multiplier: float
    jitter: bool
    retry_on_status_codes: List[int]

@dataclass
class AdaptationEvent:
    """Quality adaptation event"""
    id: str
    timestamp: datetime
    old_quality: VideoQuality
    new_quality: VideoQuality
    trigger: str
    network_metrics: NetworkMetrics
    success: bool

class NetworkMonitor:
    """Network condition monitoring"""
    
    def __init__(self, monitoring_interval: int = 5):
        self.monitoring_interval = monitoring_interval
        self.monitoring = False
        self.metrics_history = []
        self.callbacks = []
        
        # Test endpoints for network quality assessment
        self.test_endpoints = [
            "https://www.google.com",
            "https://www.cloudflare.com",
            "https://httpbin.org/get"
        ]
        
    def start_monitoring(self):
        """Start network monitoring"""
        self.monitoring = True
        
        def monitor_loop():
            while self.monitoring:
                try:
                    metrics = self.measure_network_metrics()
                    
                    if metrics:
                        self.metrics_history.append(metrics)
                        
                        # Keep only last 100 measurements
                        if len(self.metrics_history) > 100:
                            self.metrics_history.pop(0)
                            
                        # Notify callbacks
                        for callback in self.callbacks:
                            try:
                                callback(metrics)
                            except Exception as e:
                                logger.error(f"Error in network callback: {e}")
                                
                    time.sleep(self.monitoring_interval)
                    
                except Exception as e:
                    logger.error(f"Error in network monitoring: {e}")
                    time.sleep(self.monitoring_interval)
                    
        threading.Thread(target=monitor_loop, daemon=True).start()
        logger.info("Network monitoring started")
        
    def stop_monitoring(self):
        """Stop network monitoring"""
        self.monitoring = False
        logger.info("Network monitoring stopped")
        
    def add_callback(self, callback):
        """Add network change callback"""
        self.callbacks.append(callback)
        
    def measure_network_metrics(self) -> Optional[NetworkMetrics]:
        """Measure current network metrics"""
        try:
            # Measure latency
            latency = self._measure_latency()
            
            # Measure bandwidth
            download_speed, upload_speed = self._measure_bandwidth()
            
            # Measure packet loss
            packet_loss = self._measure_packet_loss()
            
            # Measure jitter
            jitter = self._measure_jitter()
            
            # Detect connection type
            connection_type = self._detect_connection_type()
            
            # Get signal strength (for cellular)
            signal_strength = self._get_signal_strength()
            
            # Determine quality
            quality = self._determine_quality(latency, download_speed, packet_loss)
            
            return NetworkMetrics(
                timestamp=datetime.now(),
                latency_ms=latency,
                download_speed_mbps=download_speed,
                upload_speed_mbps=upload_speed,
                packet_loss_percent=packet_loss,
                jitter_ms=jitter,
                connection_type=connection_type,
                signal_strength=signal_strength,
                quality=quality
            )
            
        except Exception as e:
            logger.error(f"Error measuring network metrics: {e}")
            return None
            
    def _measure_latency(self) -> float:
        """Measure network latency"""
        try:
            latencies = []
            
            for endpoint in self.test_endpoints[:2]:  # Test 2 endpoints
                try:
                    start_time = time.time()
                    response = requests.get(endpoint, timeout=5)
                    end_time = time.time()
                    
                    if response.status_code == 200:
                        latency_ms = (end_time - start_time) * 1000
                        latencies.append(latency_ms)
                        
                except Exception:
                    continue
                    
            return statistics.mean(latencies) if latencies else 1000.0
            
        except Exception:
            return 1000.0
            
    def _measure_bandwidth(self) -> Tuple[float, float]:
        """Measure download and upload bandwidth"""
        try:
            # Simple bandwidth test using a small file
            test_url = "https://httpbin.org/bytes/1024"  # 1KB test
            
            # Download test
            start_time = time.time()
            response = requests.get(test_url, timeout=10)
            end_time = time.time()
            
            if response.status_code == 200:
                download_time = end_time - start_time
                file_size_mb = len(response.content) / (1024 * 1024)
                download_speed = file_size_mb / download_time if download_time > 0 else 0
            else:
                download_speed = 0
                
            # Upload test (simplified - using POST to httpbin)
            test_data = b"x" * 1024  # 1KB test data
            start_time = time.time()
            response = requests.post("https://httpbin.org/post", data=test_data, timeout=10)
            end_time = time.time()
            
            if response.status_code == 200:
                upload_time = end_time - start_time
                file_size_mb = len(test_data) / (1024 * 1024)
                upload_speed = file_size_mb / upload_time if upload_time > 0 else 0
            else:
                upload_speed = 0
                
            return download_speed, upload_speed
            
        except Exception as e:
            logger.error(f"Error measuring bandwidth: {e}")
            return 0.0, 0.0
            
    def _measure_packet_loss(self) -> float:
        """Measure packet loss using ping"""
        try:
            # Use ping to measure packet loss
            result = subprocess.run(
                ["ping", "-c", "10", "8.8.8.8"],
                capture_output=True,
                text=True,
                timeout=15
            )
            
            if result.returncode == 0:
                output = result.stdout
                
                # Parse packet loss from ping output
                for line in output.split('\n'):
                    if 'packet loss' in line:
                        # Extract percentage
                        parts = line.split()
                        for i, part in enumerate(parts):
                            if 'packet' in part and i > 0:
                                loss_str = parts[i-1].replace('%', '')
                                try:
                                    return float(loss_str)
                                except ValueError:
                                    continue
                                    
            return 0.0
            
        except Exception as e:
            logger.error(f"Error measuring packet loss: {e}")
            return 0.0
            
    def _measure_jitter(self) -> float:
        """Measure network jitter"""
        try:
            latencies = []
            
            # Measure multiple latencies quickly
            for _ in range(5):
                start_time = time.time()
                response = requests.get(self.test_endpoints[0], timeout=3)
                end_time = time.time()
                
                if response.status_code == 200:
                    latency_ms = (end_time - start_time) * 1000
                    latencies.append(latency_ms)
                    
                time.sleep(0.1)  # Small delay between measurements
                
            if len(latencies) > 1:
                return statistics.stdev(latencies)
            else:
                return 0.0
                
        except Exception:
            return 0.0
            
    def _detect_connection_type(self) -> ConnectionType:
        """Detect connection type"""
        try:
            # Check network interfaces
            interfaces = psutil.net_if_stats()
            
            for interface_name, stats in interfaces.items():
                if stats.isup:
                    name_lower = interface_name.lower()
                    
                    if 'eth' in name_lower or 'en' in name_lower:
                        return ConnectionType.ETHERNET
                    elif 'wlan' in name_lower or 'wifi' in name_lower:
                        return ConnectionType.WIFI
                    elif 'cellular' in name_lower or 'mobile' in name_lower:
                        return ConnectionType.CELLULAR_4G  # Default to 4G
                        
            return ConnectionType.UNKNOWN
            
        except Exception:
            return ConnectionType.UNKNOWN
            
    def _get_signal_strength(self) -> Optional[int]:
        """Get cellular signal strength"""
        try:
            # This would typically require platform-specific APIs
            # For now, return None (not available)
            return None
            
        except Exception:
            return None
            
    def _determine_quality(self, latency: float, download_speed: float, 
                          packet_loss: float) -> NetworkQuality:
        """Determine network quality based on metrics"""
        try:
            # Quality scoring based on multiple factors
            score = 100
            
            # Latency scoring
            if latency > 500:
                score -= 40
            elif latency > 200:
                score -= 25
            elif latency > 100:
                score -= 15
            elif latency > 50:
                score -= 5
                
            # Bandwidth scoring
            if download_speed < 0.1:
                score -= 30
            elif download_speed < 0.5:
                score -= 20
            elif download_speed < 1.0:
                score -= 10
            elif download_speed < 2.0:
                score -= 5
                
            # Packet loss scoring
            if packet_loss > 10:
                score -= 30
            elif packet_loss > 5:
                score -= 20
            elif packet_loss > 2:
                score -= 10
            elif packet_loss > 1:
                score -= 5
                
            # Determine quality level
            if score >= 90:
                return NetworkQuality.EXCELLENT
            elif score >= 75:
                return NetworkQuality.GOOD
            elif score >= 60:
                return NetworkQuality.FAIR
            elif score >= 40:
                return NetworkQuality.POOR
            elif score >= 20:
                return NetworkQuality.VERY_POOR
            else:
                return NetworkQuality.OFFLINE
                
        except Exception:
            return NetworkQuality.UNKNOWN
            
    def get_current_metrics(self) -> Optional[NetworkMetrics]:
        """Get current network metrics"""
        if self.metrics_history:
            return self.metrics_history[-1]
        return None
        
    def get_average_metrics(self, duration_minutes: int = 5) -> Optional[NetworkMetrics]:
        """Get average metrics over specified duration"""
        try:
            cutoff_time = datetime.now() - timedelta(minutes=duration_minutes)
            recent_metrics = [
                m for m in self.metrics_history 
                if m.timestamp >= cutoff_time
            ]
            
            if not recent_metrics:
                return None
                
            # Calculate averages
            avg_latency = statistics.mean([m.latency_ms for m in recent_metrics])
            avg_download = statistics.mean([m.download_speed_mbps for m in recent_metrics])
            avg_upload = statistics.mean([m.upload_speed_mbps for m in recent_metrics])
            avg_packet_loss = statistics.mean([m.packet_loss_percent for m in recent_metrics])
            avg_jitter = statistics.mean([m.jitter_ms for m in recent_metrics])
            
            # Use most recent connection type and quality
            latest = recent_metrics[-1]
            
            return NetworkMetrics(
                timestamp=datetime.now(),
                latency_ms=avg_latency,
                download_speed_mbps=avg_download,
                upload_speed_mbps=avg_upload,
                packet_loss_percent=avg_packet_loss,
                jitter_ms=avg_jitter,
                connection_type=latest.connection_type,
                signal_strength=latest.signal_strength,
                quality=self._determine_quality(avg_latency, avg_download, avg_packet_loss)
            )
            
        except Exception as e:
            logger.error(f"Error calculating average metrics: {e}")
            return None

class QualityAdapter:
    """Adaptive quality management"""
    
    def __init__(self):
        self.quality_profiles = self._create_quality_profiles()
        self.current_quality = VideoQuality.MEDIUM
        self.adaptation_history = []
        
    def _create_quality_profiles(self) -> Dict[VideoQuality, QualityProfile]:
        """Create video quality profiles"""
        return {
            VideoQuality.ULTRA_HIGH: QualityProfile(
                quality=VideoQuality.ULTRA_HIGH,
                resolution=(1920, 1080),
                bitrate_kbps=4000,
                fps=30,
                codec="h264",
                min_bandwidth_mbps=5.0,
                max_latency_ms=100,
                max_packet_loss_percent=1.0
            ),
            
            VideoQuality.HIGH: QualityProfile(
                quality=VideoQuality.HIGH,
                resolution=(1280, 720),
                bitrate_kbps=2500,
                fps=30,
                codec="h264",
                min_bandwidth_mbps=3.0,
                max_latency_ms=150,
                max_packet_loss_percent=2.0
            ),
            
            VideoQuality.MEDIUM: QualityProfile(
                quality=VideoQuality.MEDIUM,
                resolution=(854, 480),
                bitrate_kbps=1500,
                fps=25,
                codec="h264",
                min_bandwidth_mbps=2.0,
                max_latency_ms=200,
                max_packet_loss_percent=3.0
            ),
            
            VideoQuality.LOW: QualityProfile(
                quality=VideoQuality.LOW,
                resolution=(640, 360),
                bitrate_kbps=800,
                fps=20,
                codec="h264",
                min_bandwidth_mbps=1.0,
                max_latency_ms=300,
                max_packet_loss_percent=5.0
            ),
            
            VideoQuality.VERY_LOW: QualityProfile(
                quality=VideoQuality.VERY_LOW,
                resolution=(426, 240),
                bitrate_kbps=400,
                fps=15,
                codec="h264",
                min_bandwidth_mbps=0.5,
                max_latency_ms=500,
                max_packet_loss_percent=8.0
            ),
            
            VideoQuality.MINIMAL: QualityProfile(
                quality=VideoQuality.MINIMAL,
                resolution=(256, 144),
                bitrate_kbps=200,
                fps=10,
                codec="h264",
                min_bandwidth_mbps=0.25,
                max_latency_ms=1000,
                max_packet_loss_percent=15.0
            )
        }
        
    def adapt_quality(self, network_metrics: NetworkMetrics) -> Optional[VideoQuality]:
        """Adapt video quality based on network conditions"""
        try:
            # Find best quality that meets network conditions
            suitable_qualities = []
            
            for quality, profile in self.quality_profiles.items():
                if (network_metrics.download_speed_mbps >= profile.min_bandwidth_mbps and
                    network_metrics.latency_ms <= profile.max_latency_ms and
                    network_metrics.packet_loss_percent <= profile.max_packet_loss_percent):
                    suitable_qualities.append(quality)
                    
            if not suitable_qualities:
                # If no quality meets requirements, use minimal
                new_quality = VideoQuality.MINIMAL
            else:
                # Choose highest suitable quality
                quality_order = [
                    VideoQuality.ULTRA_HIGH,
                    VideoQuality.HIGH,
                    VideoQuality.MEDIUM,
                    VideoQuality.LOW,
                    VideoQuality.VERY_LOW,
                    VideoQuality.MINIMAL
                ]
                
                for quality in quality_order:
                    if quality in suitable_qualities:
                        new_quality = quality
                        break
                else:
                    new_quality = suitable_qualities[0]
                    
            # Check if adaptation is needed
            if new_quality != self.current_quality:
                # Log adaptation event
                event = AdaptationEvent(
                    id=str(uuid.uuid4()),
                    timestamp=datetime.now(),
                    old_quality=self.current_quality,
                    new_quality=new_quality,
                    trigger="network_conditions",
                    network_metrics=network_metrics,
                    success=True
                )
                
                self.adaptation_history.append(event)
                
                # Keep only last 50 events
                if len(self.adaptation_history) > 50:
                    self.adaptation_history.pop(0)
                    
                self.current_quality = new_quality
                
                logger.info(f"Quality adapted from {event.old_quality.value} to {event.new_quality.value}")
                
                return new_quality
                
            return None
            
        except Exception as e:
            logger.error(f"Error adapting quality: {e}")
            return None
            
    def get_current_profile(self) -> QualityProfile:
        """Get current quality profile"""
        return self.quality_profiles[self.current_quality]
        
    def set_quality(self, quality: VideoQuality, trigger: str = "manual") -> bool:
        """Manually set video quality"""
        try:
            if quality in self.quality_profiles:
                old_quality = self.current_quality
                self.current_quality = quality
                
                # Log adaptation event
                event = AdaptationEvent(
                    id=str(uuid.uuid4()),
                    timestamp=datetime.now(),
                    old_quality=old_quality,
                    new_quality=quality,
                    trigger=trigger,
                    network_metrics=None,
                    success=True
                )
                
                self.adaptation_history.append(event)
                
                logger.info(f"Quality manually set to {quality.value}")
                return True
                
            return False
            
        except Exception as e:
            logger.error(f"Error setting quality: {e}")
            return False

class RetryManager:
    """Automatic retry mechanism"""
    
    def __init__(self):
        self.default_policy = RetryPolicy(
            max_retries=3,
            initial_delay_ms=1000,
            max_delay_ms=30000,
            backoff_multiplier=2.0,
            jitter=True,
            retry_on_status_codes=[408, 429, 500, 502, 503, 504]
        )
        
        self.retry_stats = {
            'total_requests': 0,
            'total_retries': 0,
            'success_rate': 0.0,
            'average_retries': 0.0
        }
        
    def execute_with_retry(self, func, *args, policy: Optional[RetryPolicy] = None, **kwargs):
        """Execute function with retry logic"""
        retry_policy = policy or self.default_policy
        
        self.retry_stats['total_requests'] += 1
        
        for attempt in range(retry_policy.max_retries + 1):
            try:
                result = func(*args, **kwargs)
                
                # Check if result indicates success
                if self._is_success(result, retry_policy):
                    if attempt > 0:
                        self.retry_stats['total_retries'] += attempt
                        
                    self._update_success_rate(True)
                    return result
                    
                # If not success and not last attempt, retry
                if attempt < retry_policy.max_retries:
                    delay = self._calculate_delay(attempt, retry_policy)
                    logger.info(f"Retrying in {delay}ms (attempt {attempt + 1}/{retry_policy.max_retries})")
                    time.sleep(delay / 1000.0)
                    
            except Exception as e:
                logger.error(f"Attempt {attempt + 1} failed: {e}")
                
                if attempt < retry_policy.max_retries:
                    delay = self._calculate_delay(attempt, retry_policy)
                    time.sleep(delay / 1000.0)
                else:
                    # Final attempt failed
                    self.retry_stats['total_retries'] += retry_policy.max_retries
                    self._update_success_rate(False)
                    raise
                    
        # All retries exhausted
        self.retry_stats['total_retries'] += retry_policy.max_retries
        self._update_success_rate(False)
        raise Exception(f"All {retry_policy.max_retries} retries exhausted")
        
    def _is_success(self, result, policy: RetryPolicy) -> bool:
        """Check if result indicates success"""
        try:
            # If result is a requests.Response object
            if hasattr(result, 'status_code'):
                return result.status_code not in policy.retry_on_status_codes
                
            # If result is a boolean
            if isinstance(result, bool):
                return result
                
            # If result is not None, consider it success
            return result is not None
            
        except Exception:
            return False
            
    def _calculate_delay(self, attempt: int, policy: RetryPolicy) -> int:
        """Calculate retry delay with exponential backoff"""
        try:
            delay = policy.initial_delay_ms * (policy.backoff_multiplier ** attempt)
            delay = min(delay, policy.max_delay_ms)
            
            # Add jitter if enabled
            if policy.jitter:
                import random
                jitter_range = delay * 0.1  # 10% jitter
                delay += random.uniform(-jitter_range, jitter_range)
                
            return int(max(delay, 0))
            
        except Exception:
            return policy.initial_delay_ms
            
    def _update_success_rate(self, success: bool):
        """Update success rate statistics"""
        try:
            total = self.retry_stats['total_requests']
            if total > 0:
                # Simple moving average
                current_rate = self.retry_stats['success_rate']
                new_rate = (current_rate * (total - 1) + (1.0 if success else 0.0)) / total
                self.retry_stats['success_rate'] = new_rate
                
                # Update average retries
                if self.retry_stats['total_requests'] > 0:
                    self.retry_stats['average_retries'] = (
                        self.retry_stats['total_retries'] / self.retry_stats['total_requests']
                    )
                    
        except Exception as e:
            logger.error(f"Error updating success rate: {e}")
            
    def get_stats(self) -> Dict[str, Any]:
        """Get retry statistics"""
        return self.retry_stats.copy()

class AdaptiveQualityManager:
    """Main adaptive quality and network resilience manager"""
    
    def __init__(self):
        self.app = Flask(__name__)
        CORS(self.app, origins="*")
        
        # Initialize components
        self.network_monitor = NetworkMonitor()
        self.quality_adapter = QualityAdapter()
        self.retry_manager = RetryManager()
        
        # Setup network monitoring callback
        self.network_monitor.add_callback(self._on_network_change)
        
        # Setup routes
        self.setup_routes()
        
        # Start monitoring
        self.network_monitor.start_monitoring()
        
        logger.info("Adaptive Quality Manager initialized")
        
    def setup_routes(self):
        """Setup Flask routes"""
        
        @self.app.route('/health', methods=['GET'])
        def health_check():
            return jsonify({
                'status': 'healthy',
                'timestamp': datetime.now().isoformat(),
                'service': 'adaptive-quality-manager',
                'version': '1.0.0'
            })
            
        @self.app.route('/network/metrics', methods=['GET'])
        def get_network_metrics():
            return self.get_network_metrics_handler()
            
        @self.app.route('/quality/current', methods=['GET'])
        def get_current_quality():
            return self.get_current_quality_handler()
            
        @self.app.route('/quality/set', methods=['POST'])
        def set_quality():
            return self.set_quality_handler()
            
        @self.app.route('/quality/profiles', methods=['GET'])
        def get_quality_profiles():
            return self.get_quality_profiles_handler()
            
        @self.app.route('/adaptation/history', methods=['GET'])
        def get_adaptation_history():
            return self.get_adaptation_history_handler()
            
        @self.app.route('/retry/stats', methods=['GET'])
        def get_retry_stats():
            return self.get_retry_stats_handler()
            
        @self.app.route('/retry/execute', methods=['POST'])
        def execute_with_retry():
            return self.execute_with_retry_handler()
            
    def get_network_metrics_handler(self):
        """Handle network metrics requests"""
        try:
            current_metrics = self.network_monitor.get_current_metrics()
            average_metrics = self.network_monitor.get_average_metrics()
            
            return jsonify({
                'success': True,
                'current': asdict(current_metrics) if current_metrics else None,
                'average_5min': asdict(average_metrics) if average_metrics else None,
                'history_count': len(self.network_monitor.metrics_history)
            })
            
        except Exception as e:
            logger.error(f"Error getting network metrics: {e}")
            return jsonify({'error': str(e)}), 500
            
    def get_current_quality_handler(self):
        """Handle current quality requests"""
        try:
            profile = self.quality_adapter.get_current_profile()
            
            return jsonify({
                'success': True,
                'current_quality': self.quality_adapter.current_quality.value,
                'profile': asdict(profile)
            })
            
        except Exception as e:
            logger.error(f"Error getting current quality: {e}")
            return jsonify({'error': str(e)}), 500
            
    def set_quality_handler(self):
        """Handle set quality requests"""
        try:
            data = request.get_json()
            quality_str = data.get('quality')
            
            try:
                quality = VideoQuality(quality_str)
            except ValueError:
                return jsonify({'error': f'Invalid quality: {quality_str}'}), 400
                
            success = self.quality_adapter.set_quality(quality, "manual")
            
            return jsonify({
                'success': success,
                'quality': quality.value,
                'profile': asdict(self.quality_adapter.get_current_profile())
            })
            
        except Exception as e:
            logger.error(f"Error setting quality: {e}")
            return jsonify({'error': str(e)}), 500
            
    def get_quality_profiles_handler(self):
        """Handle quality profiles requests"""
        try:
            profiles = {
                quality.value: asdict(profile)
                for quality, profile in self.quality_adapter.quality_profiles.items()
            }
            
            return jsonify({
                'success': True,
                'profiles': profiles
            })
            
        except Exception as e:
            logger.error(f"Error getting quality profiles: {e}")
            return jsonify({'error': str(e)}), 500
            
    def get_adaptation_history_handler(self):
        """Handle adaptation history requests"""
        try:
            limit = int(request.args.get('limit', 20))
            
            history = self.quality_adapter.adaptation_history[-limit:] if limit > 0 else self.quality_adapter.adaptation_history
            
            return jsonify({
                'success': True,
                'history': [asdict(event) for event in history],
                'total_adaptations': len(self.quality_adapter.adaptation_history)
            })
            
        except Exception as e:
            logger.error(f"Error getting adaptation history: {e}")
            return jsonify({'error': str(e)}), 500
            
    def get_retry_stats_handler(self):
        """Handle retry stats requests"""
        try:
            stats = self.retry_manager.get_stats()
            
            return jsonify({
                'success': True,
                'stats': stats
            })
            
        except Exception as e:
            logger.error(f"Error getting retry stats: {e}")
            return jsonify({'error': str(e)}), 500
            
    def execute_with_retry_handler(self):
        """Handle execute with retry requests"""
        try:
            data = request.get_json()
            url = data.get('url')
            method = data.get('method', 'GET')
            headers = data.get('headers', {})
            payload = data.get('payload')
            
            if not url:
                return jsonify({'error': 'URL is required'}), 400
                
            # Define function to retry
            def make_request():
                if method.upper() == 'GET':
                    return requests.get(url, headers=headers, timeout=10)
                elif method.upper() == 'POST':
                    return requests.post(url, json=payload, headers=headers, timeout=10)
                elif method.upper() == 'PUT':
                    return requests.put(url, json=payload, headers=headers, timeout=10)
                else:
                    raise ValueError(f"Unsupported method: {method}")
                    
            # Execute with retry
            response = self.retry_manager.execute_with_retry(make_request)
            
            return jsonify({
                'success': True,
                'status_code': response.status_code,
                'response': response.json() if response.headers.get('content-type', '').startswith('application/json') else response.text,
                'retry_stats': self.retry_manager.get_stats()
            })
            
        except Exception as e:
            logger.error(f"Error executing with retry: {e}")
            return jsonify({'error': str(e)}), 500
            
    def _on_network_change(self, metrics: NetworkMetrics):
        """Handle network condition changes"""
        try:
            # Adapt quality based on network conditions
            new_quality = self.quality_adapter.adapt_quality(metrics)
            
            if new_quality:
                logger.info(f"Network change triggered quality adaptation to {new_quality.value}")
                
        except Exception as e:
            logger.error(f"Error handling network change: {e}")
            
    def run(self, host='0.0.0.0', port=8096, debug=False):
        """Run the adaptive quality manager"""
        logger.info(f"Starting Adaptive Quality Manager on {host}:{port}")
        self.app.run(host=host, port=port, debug=debug, threaded=True)
        
    def shutdown(self):
        """Shutdown the manager"""
        self.network_monitor.stop_monitoring()
        logger.info("Adaptive Quality Manager shutdown")

if __name__ == '__main__':
    manager = AdaptiveQualityManager()
    
    try:
        port = int(os.getenv('PORT', 8096))
        debug = os.getenv('DEBUG', 'false').lower() == 'true'
        
        manager.run(port=port, debug=debug)
    except KeyboardInterrupt:
        manager.shutdown()

