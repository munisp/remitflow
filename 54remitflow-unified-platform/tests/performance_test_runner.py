#!/usr/bin/env python3
"""
Performance Testing Suite
Comprehensive performance testing for the Nigerian Remittance Platform
"""

import asyncio
import aiohttp
import json
import time
import statistics
import concurrent.futures
import psutil
import matplotlib.pyplot as plt
from datetime import datetime, timedelta
from typing import List, Dict, Any
import argparse

class PerformanceTestRunner:
    def __init__(self, base_url: str = "http://localhost:8000"):
        self.base_url = base_url
        self.results = {}
        
    async def run_load_test(self, concurrent_users: int = 100, duration: int = 60):
        """Run load testing with specified concurrent users"""
        print(f"🚀 Starting load test: {concurrent_users} users for {duration}s")
        
        start_time = time.time()
        end_time = start_time + duration
        
        # Create semaphore to limit concurrent requests
        semaphore = asyncio.Semaphore(concurrent_users)
        
        async with aiohttp.ClientSession() as session:
            tasks = []
            
            while time.time() < end_time:
                task = asyncio.create_task(self._make_request(session, semaphore))
                tasks.append(task)
                
                # Small delay to control request rate
                await asyncio.sleep(0.01)
            
            # Wait for all tasks to complete
            results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Process results
        successful_requests = [r for r in results if isinstance(r, dict) and r.get('success')]
        failed_requests = [r for r in results if isinstance(r, dict) and not r.get('success')]
        exceptions = [r for r in results if isinstance(r, Exception)]
        
        response_times = [r['response_time'] for r in successful_requests]
        
        load_test_results = {
            'test_type': 'load_test',
            'concurrent_users': concurrent_users,
            'duration': duration,
            'total_requests': len(results),
            'successful_requests': len(successful_requests),
            'failed_requests': len(failed_requests),
            'exceptions': len(exceptions),
            'success_rate': len(successful_requests) / len(results) * 100,
            'avg_response_time': statistics.mean(response_times) if response_times else 0,
            'min_response_time': min(response_times) if response_times else 0,
            'max_response_time': max(response_times) if response_times else 0,
            'p50_response_time': statistics.median(response_times) if response_times else 0,
            'p95_response_time': self._percentile(response_times, 95) if response_times else 0,
            'p99_response_time': self._percentile(response_times, 99) if response_times else 0,
            'requests_per_second': len(successful_requests) / duration,
            'timestamp': datetime.now().isoformat()
        }
        
        self.results['load_test'] = load_test_results
        return load_test_results
    
    async def run_spike_test(self, max_users: int = 1000, spike_duration: int = 30):
        """Run spike testing with sudden load increase"""
        print(f"⚡ Starting spike test: up to {max_users} users for {spike_duration}s")
        
        # Gradual ramp up
        ramp_up_time = 10
        steady_time = spike_duration
        ramp_down_time = 10
        
        results = []
        
        async with aiohttp.ClientSession() as session:
            # Ramp up phase
            for i in range(ramp_up_time):
                current_users = int((i + 1) / ramp_up_time * max_users)
                semaphore = asyncio.Semaphore(current_users)
                
                tasks = []
                for _ in range(current_users):
                    task = asyncio.create_task(self._make_request(session, semaphore))
                    tasks.append(task)
                
                batch_results = await asyncio.gather(*tasks, return_exceptions=True)
                results.extend(batch_results)
                
                await asyncio.sleep(1)
            
            # Steady state phase
            semaphore = asyncio.Semaphore(max_users)
            for i in range(steady_time):
                tasks = []
                for _ in range(max_users):
                    task = asyncio.create_task(self._make_request(session, semaphore))
                    tasks.append(task)
                
                batch_results = await asyncio.gather(*tasks, return_exceptions=True)
                results.extend(batch_results)
                
                await asyncio.sleep(1)
        
        # Process results
        successful_requests = [r for r in results if isinstance(r, dict) and r.get('success')]
        response_times = [r['response_time'] for r in successful_requests]
        
        spike_test_results = {
            'test_type': 'spike_test',
            'max_users': max_users,
            'spike_duration': spike_duration,
            'total_requests': len(results),
            'successful_requests': len(successful_requests),
            'success_rate': len(successful_requests) / len(results) * 100 if results else 0,
            'avg_response_time': statistics.mean(response_times) if response_times else 0,
            'p95_response_time': self._percentile(response_times, 95) if response_times else 0,
            'p99_response_time': self._percentile(response_times, 99) if response_times else 0,
            'peak_rps': len(successful_requests) / (ramp_up_time + steady_time),
            'timestamp': datetime.now().isoformat()
        }
        
        self.results['spike_test'] = spike_test_results
        return spike_test_results
    
    def run_memory_test(self, duration: int = 300):
        """Run memory testing to detect leaks"""
        print(f"🧠 Starting memory test for {duration}s")
        
        start_time = time.time()
        end_time = start_time + duration
        
        memory_samples = []
        cpu_samples = []
        
        # Monitor system resources
        while time.time() < end_time:
            # Get memory usage
            memory_info = psutil.virtual_memory()
            memory_samples.append({
                'timestamp': time.time(),
                'memory_percent': memory_info.percent,
                'memory_used': memory_info.used,
                'memory_available': memory_info.available
            })
            
            # Get CPU usage
            cpu_percent = psutil.cpu_percent(interval=1)
            cpu_samples.append({
                'timestamp': time.time(),
                'cpu_percent': cpu_percent
            })
            
            time.sleep(5)  # Sample every 5 seconds
        
        # Analyze memory trend
        memory_percentages = [s['memory_percent'] for s in memory_samples]
        memory_trend = self._calculate_trend(memory_percentages)
        
        memory_test_results = {
            'test_type': 'memory_test',
            'duration': duration,
            'samples': len(memory_samples),
            'avg_memory_percent': statistics.mean(memory_percentages),
            'max_memory_percent': max(memory_percentages),
            'min_memory_percent': min(memory_percentages),
            'memory_trend': memory_trend,
            'memory_leak_detected': memory_trend > 0.1,  # More than 0.1% increase per minute
            'avg_cpu_percent': statistics.mean([s['cpu_percent'] for s in cpu_samples]),
            'memory_samples': memory_samples,
            'cpu_samples': cpu_samples,
            'timestamp': datetime.now().isoformat()
        }
        
        self.results['memory_test'] = memory_test_results
        return memory_test_results
    
    async def run_endurance_test(self, users: int = 50, duration: int = 3600):
        """Run endurance testing for extended periods"""
        print(f"⏰ Starting endurance test: {users} users for {duration}s ({duration//3600}h)")
        
        start_time = time.time()
        end_time = start_time + duration
        
        interval_results = []
        interval_duration = 300  # 5-minute intervals
        
        async with aiohttp.ClientSession() as session:
            while time.time() < end_time:
                interval_start = time.time()
                interval_end = min(interval_start + interval_duration, end_time)
                
                # Run requests for this interval
                semaphore = asyncio.Semaphore(users)
                tasks = []
                
                while time.time() < interval_end:
                    task = asyncio.create_task(self._make_request(session, semaphore))
                    tasks.append(task)
                    await asyncio.sleep(0.1)  # Control request rate
                
                # Wait for interval tasks to complete
                results = await asyncio.gather(*tasks, return_exceptions=True)
                
                # Process interval results
                successful = [r for r in results if isinstance(r, dict) and r.get('success')]
                response_times = [r['response_time'] for r in successful]
                
                interval_result = {
                    'interval_start': interval_start,
                    'interval_duration': interval_end - interval_start,
                    'requests': len(results),
                    'successful': len(successful),
                    'success_rate': len(successful) / len(results) * 100 if results else 0,
                    'avg_response_time': statistics.mean(response_times) if response_times else 0,
                    'p95_response_time': self._percentile(response_times, 95) if response_times else 0
                }
                
                interval_results.append(interval_result)
                
                print(f"  Interval {len(interval_results)}: {interval_result['success_rate']:.1f}% success, "
                      f"{interval_result['avg_response_time']:.0f}ms avg")
        
        # Analyze endurance results
        success_rates = [r['success_rate'] for r in interval_results]
        response_times = [r['avg_response_time'] for r in interval_results]
        
        endurance_test_results = {
            'test_type': 'endurance_test',
            'users': users,
            'duration': duration,
            'intervals': len(interval_results),
            'avg_success_rate': statistics.mean(success_rates),
            'min_success_rate': min(success_rates),
            'avg_response_time': statistics.mean(response_times),
            'max_response_time': max(response_times),
            'performance_degradation': max(response_times) - min(response_times),
            'stability_score': min(success_rates),
            'interval_results': interval_results,
            'timestamp': datetime.now().isoformat()
        }
        
        self.results['endurance_test'] = endurance_test_results
        return endurance_test_results
    
    async def _make_request(self, session: aiohttp.ClientSession, semaphore: asyncio.Semaphore):
        """Make a single HTTP request"""
        async with semaphore:
            start_time = time.time()
            try:
                async with session.get(f"{self.base_url}/health", timeout=aiohttp.ClientTimeout(total=30)) as response:
                    response_time = (time.time() - start_time) * 1000  # Convert to milliseconds
                    return {
                        'success': response.status == 200,
                        'status_code': response.status,
                        'response_time': response_time
                    }
            except Exception as e:
                response_time = (time.time() - start_time) * 1000
                return {
                    'success': False,
                    'error': str(e),
                    'response_time': response_time
                }
    
    def _percentile(self, data: List[float], percentile: int) -> float:
        """Calculate percentile of data"""
        if not data:
            return 0
        sorted_data = sorted(data)
        index = int(len(sorted_data) * percentile / 100)
        return sorted_data[min(index, len(sorted_data) - 1)]
    
    def _calculate_trend(self, data: List[float]) -> float:
        """Calculate trend (slope) of data"""
        if len(data) < 2:
            return 0
        
        n = len(data)
        x = list(range(n))
        
        # Calculate linear regression slope
        x_mean = statistics.mean(x)
        y_mean = statistics.mean(data)
        
        numerator = sum((x[i] - x_mean) * (data[i] - y_mean) for i in range(n))
        denominator = sum((x[i] - x_mean) ** 2 for i in range(n))
        
        return numerator / denominator if denominator != 0 else 0
    
    def generate_report(self, output_file: str = "performance_report.json"):
        """Generate comprehensive performance report"""
        report = {
            'test_summary': {
                'total_tests': len(self.results),
                'test_types': list(self.results.keys()),
                'report_generated': datetime.now().isoformat()
            },
            'results': self.results,
            'recommendations': self._generate_recommendations()
        }
        
        with open(output_file, 'w') as f:
            json.dump(report, f, indent=2)
        
        print(f"📊 Performance report saved to {output_file}")
        return report
    
    def _generate_recommendations(self) -> List[str]:
        """Generate performance recommendations based on test results"""
        recommendations = []
        
        # Load test recommendations
        if 'load_test' in self.results:
            load_result = self.results['load_test']
            if load_result['success_rate'] < 95:
                recommendations.append("Load test success rate is below 95%. Consider optimizing error handling.")
            if load_result['p95_response_time'] > 1000:
                recommendations.append("95th percentile response time exceeds 1 second. Consider performance optimization.")
            if load_result['requests_per_second'] < 100:
                recommendations.append("Throughput is below 100 RPS. Consider scaling or optimization.")
        
        # Spike test recommendations
        if 'spike_test' in self.results:
            spike_result = self.results['spike_test']
            if spike_result['success_rate'] < 90:
                recommendations.append("Spike test shows poor performance under load. Implement circuit breakers.")
            if spike_result['p99_response_time'] > 5000:
                recommendations.append("99th percentile response time is very high during spikes. Implement request queuing.")
        
        # Memory test recommendations
        if 'memory_test' in self.results:
            memory_result = self.results['memory_test']
            if memory_result['memory_leak_detected']:
                recommendations.append("Memory leak detected. Implement object pooling and optimize garbage collection.")
            if memory_result['max_memory_percent'] > 90:
                recommendations.append("Memory usage exceeds 90%. Consider increasing memory or optimizing usage.")
        
        # Endurance test recommendations
        if 'endurance_test' in self.results:
            endurance_result = self.results['endurance_test']
            if endurance_result['stability_score'] < 95:
                recommendations.append("System stability degrades over time. Investigate resource leaks.")
            if endurance_result['performance_degradation'] > 500:
                recommendations.append("Significant performance degradation over time. Implement periodic cleanup.")
        
        return recommendations
    
    def create_visualizations(self):
        """Create performance visualization charts"""
        if 'memory_test' in self.results:
            self._create_memory_chart()
        
        if 'endurance_test' in self.results:
            self._create_endurance_chart()
    
    def _create_memory_chart(self):
        """Create memory usage chart"""
        memory_result = self.results['memory_test']
        samples = memory_result['memory_samples']
        
        timestamps = [s['timestamp'] for s in samples]
        memory_percentages = [s['memory_percent'] for s in samples]
        
        plt.figure(figsize=(12, 6))
        plt.plot(timestamps, memory_percentages, 'b-', linewidth=2)
        plt.title('Memory Usage Over Time')
        plt.xlabel('Time')
        plt.ylabel('Memory Usage (%)')
        plt.grid(True, alpha=0.3)
        plt.tight_layout()
        plt.savefig('memory_usage_chart.png', dpi=300, bbox_inches='tight')
        plt.close()
        
        print("📈 Memory usage chart saved to memory_usage_chart.png")
    
    def _create_endurance_chart(self):
        """Create endurance test chart"""
        endurance_result = self.results['endurance_test']
        intervals = endurance_result['interval_results']
        
        interval_numbers = list(range(1, len(intervals) + 1))
        success_rates = [r['success_rate'] for r in intervals]
        response_times = [r['avg_response_time'] for r in intervals]
        
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 10))
        
        # Success rate chart
        ax1.plot(interval_numbers, success_rates, 'g-', linewidth=2, marker='o')
        ax1.set_title('Success Rate Over Time')
        ax1.set_xlabel('Interval')
        ax1.set_ylabel('Success Rate (%)')
        ax1.grid(True, alpha=0.3)
        ax1.set_ylim(0, 100)
        
        # Response time chart
        ax2.plot(interval_numbers, response_times, 'r-', linewidth=2, marker='s')
        ax2.set_title('Average Response Time Over Time')
        ax2.set_xlabel('Interval')
        ax2.set_ylabel('Response Time (ms)')
        ax2.grid(True, alpha=0.3)
        
        plt.tight_layout()
        plt.savefig('endurance_test_chart.png', dpi=300, bbox_inches='tight')
        plt.close()
        
        print("📈 Endurance test chart saved to endurance_test_chart.png")

async def main():
    parser = argparse.ArgumentParser(description='Performance Testing Suite')
    parser.add_argument('--base-url', default='http://localhost:8000', help='Base URL for testing')
    parser.add_argument('--test-type', choices=['load', 'spike', 'memory', 'endurance', 'all'], 
                       default='all', help='Type of test to run')
    parser.add_argument('--users', type=int, default=100, help='Number of concurrent users')
    parser.add_argument('--duration', type=int, default=60, help='Test duration in seconds')
    parser.add_argument('--output', default='performance_report.json', help='Output report file')
    
    args = parser.parse_args()
    
    runner = PerformanceTestRunner(args.base_url)
    
    print("🚀 Starting Performance Testing Suite")
    print(f"Target: {args.base_url}")
    print(f"Test Type: {args.test_type}")
    print("=" * 50)
    
    try:
        if args.test_type in ['load', 'all']:
            await runner.run_load_test(args.users, args.duration)
        
        if args.test_type in ['spike', 'all']:
            await runner.run_spike_test(args.users * 2, args.duration // 2)
        
        if args.test_type in ['memory', 'all']:
            runner.run_memory_test(args.duration * 2)
        
        if args.test_type in ['endurance', 'all']:
            await runner.run_endurance_test(args.users // 2, args.duration * 10)
        
        # Generate report and visualizations
        report = runner.generate_report(args.output)
        runner.create_visualizations()
        
        print("\n🎉 Performance testing completed successfully!")
        print(f"📊 Report: {args.output}")
        
        # Print summary
        print("\n📋 Test Summary:")
        for test_type, result in runner.results.items():
            print(f"  {test_type}:")
            if 'success_rate' in result:
                print(f"    Success Rate: {result['success_rate']:.1f}%")
            if 'avg_response_time' in result:
                print(f"    Avg Response Time: {result['avg_response_time']:.0f}ms")
            if 'requests_per_second' in result:
                print(f"    Throughput: {result['requests_per_second']:.0f} RPS")
        
    except Exception as e:
        print(f"❌ Performance testing failed: {e}")
        return 1
    
    return 0

if __name__ == "__main__":
    exit(asyncio.run(main()))
