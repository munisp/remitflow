#!/usr/bin/env python3
"""
AI/ML Platform Robustness Analyzer
Comprehensive analysis of AI/ML services implementation quality
"""

import os
import ast
import json
import subprocess
from pathlib import Path
from typing import Dict, List, Any, Tuple
from datetime import datetime
import re

class AIMLRobustnessAnalyzer:
    def __init__(self, platform_path: str):
        self.platform_path = Path(platform_path)
        self.aiml_path = self.platform_path / "services" / "ai-ml-platform"
        self.services = [
            "cocoindex-service",
            "epr-kgqa-service", 
            "falkordb-service",
            "ollama-service",
            "art-service",
            "lakehouse-integration",
            "gnn-service",
            "integration-orchestrator"
        ]
        
    def analyze_all_services(self) -> Dict[str, Any]:
        """Analyze all AI/ML services for robustness"""
        results = {
            "analysis_timestamp": datetime.now().isoformat(),
            "platform_path": str(self.platform_path),
            "services_analyzed": len(self.services),
            "overall_score": 0.0,
            "service_details": {},
            "integration_analysis": {},
            "performance_analysis": {},
            "production_readiness": {}
        }
        
        total_score = 0.0
        
        for service in self.services:
            service_path = self.aiml_path / service
            if service_path.exists():
                analysis = self.analyze_service(service, service_path)
                results["service_details"][service] = analysis
                total_score += analysis["robustness_score"]
            else:
                results["service_details"][service] = {
                    "status": "missing",
                    "robustness_score": 0.0
                }
        
        results["overall_score"] = total_score / len(self.services)
        results["integration_analysis"] = self.analyze_integrations()
        results["performance_analysis"] = self.analyze_performance_capabilities()
        results["production_readiness"] = self.assess_production_readiness()
        
        return results
    
    def analyze_service(self, service_name: str, service_path: Path) -> Dict[str, Any]:
        """Analyze individual service robustness"""
        analysis = {
            "service_name": service_name,
            "path": str(service_path),
            "robustness_score": 0.0,
            "implementation_quality": {},
            "features": {},
            "dependencies": {},
            "integration_points": {},
            "performance_indicators": {},
            "issues": []
        }
        
        # Check main implementation file
        main_files = list(service_path.glob("main.*"))
        if not main_files:
            analysis["issues"].append("No main implementation file found")
            return analysis
        
        main_file = main_files[0]
        
        # Analyze implementation
        if main_file.suffix == ".py":
            analysis.update(self.analyze_python_service(main_file))
        elif main_file.suffix == ".go":
            analysis.update(self.analyze_go_service(main_file))
        
        # Calculate robustness score
        analysis["robustness_score"] = self.calculate_robustness_score(analysis)
        
        return analysis
    
    def analyze_python_service(self, file_path: Path) -> Dict[str, Any]:
        """Analyze Python service implementation"""
        try:
            with open(file_path, 'r') as f:
                content = f.read()
            
            # Parse AST
            tree = ast.parse(content)
            
            analysis = {
                "language": "python",
                "file_size": len(content),
                "lines_of_code": len(content.split('\n')),
                "implementation_quality": {
                    "has_classes": len([n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]) > 0,
                    "has_functions": len([n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]) > 0,
                    "has_async_functions": len([n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef)]) > 0,
                    "has_error_handling": "try:" in content.lower(),
                    "has_logging": "logging" in content,
                    "has_type_hints": "typing" in content,
                    "has_dataclasses": "@dataclass" in content,
                    "has_pydantic": "pydantic" in content
                },
                "features": {
                    "ml_frameworks": self.detect_ml_frameworks(content),
                    "database_integration": self.detect_database_integration(content),
                    "api_endpoints": self.count_api_endpoints(content),
                    "websocket_support": "websocket" in content.lower(),
                    "caching": "redis" in content.lower() or "cache" in content.lower(),
                    "monitoring": "prometheus" in content.lower() or "metrics" in content.lower()
                },
                "dependencies": self.extract_python_imports(content),
                "integration_points": self.detect_integration_points(content),
                "performance_indicators": {
                    "async_support": "async" in content,
                    "batch_processing": "batch" in content.lower(),
                    "parallel_processing": "concurrent" in content or "multiprocessing" in content,
                    "streaming": "stream" in content.lower(),
                    "caching_strategy": "cache" in content.lower()
                }
            }
            
            return analysis
            
        except Exception as e:
            return {
                "language": "python",
                "error": str(e),
                "implementation_quality": {},
                "features": {},
                "dependencies": {},
                "integration_points": {},
                "performance_indicators": {}
            }
    
    def analyze_go_service(self, file_path: Path) -> Dict[str, Any]:
        """Analyze Go service implementation"""
        try:
            with open(file_path, 'r') as f:
                content = f.read()
            
            analysis = {
                "language": "go",
                "file_size": len(content),
                "lines_of_code": len(content.split('\n')),
                "implementation_quality": {
                    "has_structs": "type " in content and "struct" in content,
                    "has_interfaces": "type " in content and "interface" in content,
                    "has_methods": "func (" in content,
                    "has_error_handling": "error" in content,
                    "has_logging": "log." in content,
                    "has_context": "context." in content,
                    "has_goroutines": "go " in content,
                    "has_channels": "chan " in content
                },
                "features": {
                    "database_integration": self.detect_go_database_integration(content),
                    "api_endpoints": self.count_go_api_endpoints(content),
                    "websocket_support": "websocket" in content.lower(),
                    "caching": "redis" in content.lower() or "cache" in content.lower(),
                    "monitoring": "prometheus" in content.lower() or "metrics" in content.lower()
                },
                "dependencies": self.extract_go_imports(content),
                "integration_points": self.detect_integration_points(content),
                "performance_indicators": {
                    "concurrency": "goroutine" in content or "go " in content,
                    "channels": "chan " in content,
                    "context_usage": "context." in content,
                    "connection_pooling": "pool" in content.lower(),
                    "caching_strategy": "cache" in content.lower()
                }
            }
            
            return analysis
            
        except Exception as e:
            return {
                "language": "go",
                "error": str(e),
                "implementation_quality": {},
                "features": {},
                "dependencies": {},
                "integration_points": {},
                "performance_indicators": {}
            }
    
    def detect_ml_frameworks(self, content: str) -> List[str]:
        """Detect ML frameworks used"""
        frameworks = []
        framework_patterns = {
            "torch": ["torch", "pytorch"],
            "tensorflow": ["tensorflow", "tf."],
            "sklearn": ["sklearn", "scikit-learn"],
            "transformers": ["transformers", "huggingface"],
            "sentence_transformers": ["sentence_transformers"],
            "spacy": ["spacy"],
            "networkx": ["networkx"],
            "faiss": ["faiss"],
            "torch_geometric": ["torch_geometric", "pyg"]
        }
        
        for framework, patterns in framework_patterns.items():
            if any(pattern in content for pattern in patterns):
                frameworks.append(framework)
        
        return frameworks
    
    def detect_database_integration(self, content: str) -> List[str]:
        """Detect database integrations"""
        databases = []
        db_patterns = {
            "postgresql": ["psycopg2", "postgresql", "postgres"],
            "redis": ["redis"],
            "mongodb": ["pymongo", "mongodb"],
            "elasticsearch": ["elasticsearch"],
            "neo4j": ["neo4j"],
            "sqlite": ["sqlite"]
        }
        
        for db, patterns in db_patterns.items():
            if any(pattern in content for pattern in patterns):
                databases.append(db)
        
        return databases
    
    def detect_go_database_integration(self, content: str) -> List[str]:
        """Detect Go database integrations"""
        databases = []
        db_patterns = {
            "postgresql": ["lib/pq", "postgres"],
            "redis": ["go-redis", "redis"],
            "mongodb": ["mongo-driver"],
            "neo4j": ["neo4j-go-driver"]
        }
        
        for db, patterns in db_patterns.items():
            if any(pattern in content for pattern in patterns):
                databases.append(db)
        
        return databases
    
    def count_api_endpoints(self, content: str) -> int:
        """Count API endpoints in Python service"""
        patterns = [
            r'@app\.(get|post|put|delete|patch)',
            r'@router\.(get|post|put|delete|patch)',
            r'\.route\(',
            r'add_api_route\('
        ]
        
        count = 0
        for pattern in patterns:
            count += len(re.findall(pattern, content, re.IGNORECASE))
        
        return count
    
    def count_go_api_endpoints(self, content: str) -> int:
        """Count API endpoints in Go service"""
        patterns = [
            r'\.GET\(',
            r'\.POST\(',
            r'\.PUT\(',
            r'\.DELETE\(',
            r'\.PATCH\(',
            r'HandleFunc\('
        ]
        
        count = 0
        for pattern in patterns:
            count += len(re.findall(pattern, content))
        
        return count
    
    def extract_python_imports(self, content: str) -> List[str]:
        """Extract Python imports"""
        try:
            tree = ast.parse(content)
            imports = []
            
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        imports.append(alias.name)
                elif isinstance(node, ast.ImportFrom):
                    if node.module:
                        imports.append(node.module)
            
            return list(set(imports))
        except:
            return []
    
    def extract_go_imports(self, content: str) -> List[str]:
        """Extract Go imports"""
        import_pattern = r'import\s*\(\s*(.*?)\s*\)'
        single_import_pattern = r'import\s+"([^"]+)"'
        
        imports = []
        
        # Multi-line imports
        matches = re.findall(import_pattern, content, re.DOTALL)
        for match in matches:
            lines = match.split('\n')
            for line in lines:
                line = line.strip().strip('"')
                if line and not line.startswith('//'):
                    imports.append(line)
        
        # Single imports
        single_matches = re.findall(single_import_pattern, content)
        imports.extend(single_matches)
        
        return list(set(imports))
    
    def detect_integration_points(self, content: str) -> Dict[str, bool]:
        """Detect integration points with other services"""
        integrations = {
            "http_client": "httpx" in content or "requests" in content or "http.Client" in content,
            "websocket_client": "websocket" in content.lower(),
            "message_queue": "kafka" in content.lower() or "rabbitmq" in content.lower() or "pulsar" in content.lower(),
            "grpc": "grpc" in content.lower(),
            "rest_api": "fastapi" in content or "gin" in content or "router" in content,
            "database": "sql" in content.lower() or "db" in content.lower(),
            "cache": "redis" in content.lower() or "cache" in content.lower(),
            "monitoring": "prometheus" in content.lower() or "metrics" in content.lower()
        }
        
        return integrations
    
    def calculate_robustness_score(self, analysis: Dict[str, Any]) -> float:
        """Calculate robustness score based on analysis"""
        score = 0.0
        max_score = 100.0
        
        # Implementation quality (30 points)
        impl_quality = analysis.get("implementation_quality", {})
        quality_score = sum([
            10 if impl_quality.get("has_classes") or impl_quality.get("has_structs") else 0,
            5 if impl_quality.get("has_functions") or impl_quality.get("has_methods") else 0,
            5 if impl_quality.get("has_error_handling") else 0,
            5 if impl_quality.get("has_logging") else 0,
            5 if impl_quality.get("has_type_hints") or impl_quality.get("has_interfaces") else 0
        ])
        score += min(quality_score, 30)
        
        # Features (25 points)
        features = analysis.get("features", {})
        ml_frameworks = features.get("ml_frameworks", [])
        db_integration = features.get("database_integration", [])
        api_endpoints = features.get("api_endpoints", 0)
        
        feature_score = sum([
            10 if len(ml_frameworks) > 0 else 0,
            5 if len(db_integration) > 0 else 0,
            5 if api_endpoints > 0 else 0,
            3 if features.get("caching") else 0,
            2 if features.get("monitoring") else 0
        ])
        score += min(feature_score, 25)
        
        # Integration points (20 points)
        integrations = analysis.get("integration_points", {})
        integration_score = sum([
            5 if integrations.get("rest_api") else 0,
            4 if integrations.get("database") else 0,
            3 if integrations.get("http_client") else 0,
            3 if integrations.get("cache") else 0,
            3 if integrations.get("monitoring") else 0,
            2 if integrations.get("websocket_client") else 0
        ])
        score += min(integration_score, 20)
        
        # Performance indicators (15 points)
        performance = analysis.get("performance_indicators", {})
        perf_score = sum([
            5 if performance.get("async_support") or performance.get("concurrency") else 0,
            3 if performance.get("batch_processing") else 0,
            3 if performance.get("caching_strategy") else 0,
            2 if performance.get("parallel_processing") or performance.get("channels") else 0,
            2 if performance.get("streaming") else 0
        ])
        score += min(perf_score, 15)
        
        # Code size and complexity (10 points)
        lines_of_code = analysis.get("lines_of_code", 0)
        if lines_of_code > 1000:
            score += 10
        elif lines_of_code > 500:
            score += 7
        elif lines_of_code > 200:
            score += 5
        elif lines_of_code > 100:
            score += 3
        
        return min(score, max_score)
    
    def analyze_integrations(self) -> Dict[str, Any]:
        """Analyze bi-directional integrations between services"""
        integration_analysis = {
            "bi_directional_pairs": [],
            "integration_matrix": {},
            "communication_patterns": {},
            "data_flow_analysis": {}
        }
        
        # Check for bi-directional integrations
        service_files = {}
        for service in self.services:
            service_path = self.aiml_path / service
            main_files = list(service_path.glob("main.*"))
            if main_files:
                try:
                    with open(main_files[0], 'r') as f:
                        service_files[service] = f.read()
                except:
                    service_files[service] = ""
        
        # Analyze service-to-service references
        for service1 in self.services:
            integration_analysis["integration_matrix"][service1] = {}
            for service2 in self.services:
                if service1 != service2:
                    # Check if service1 references service2
                    content1 = service_files.get(service1, "")
                    references_service2 = (
                        service2.replace("-", "_") in content1 or
                        service2.replace("-", "") in content1 or
                        f"/{service2}/" in content1 or
                        f"{service2}:" in content1
                    )
                    
                    # Check if service2 references service1
                    content2 = service_files.get(service2, "")
                    references_service1 = (
                        service1.replace("-", "_") in content2 or
                        service1.replace("-", "") in content2 or
                        f"/{service1}/" in content2 or
                        f"{service1}:" in content2
                    )
                    
                    integration_type = "none"
                    if references_service2 and references_service1:
                        integration_type = "bi_directional"
                        integration_analysis["bi_directional_pairs"].append((service1, service2))
                    elif references_service2:
                        integration_type = "unidirectional_out"
                    elif references_service1:
                        integration_type = "unidirectional_in"
                    
                    integration_analysis["integration_matrix"][service1][service2] = integration_type
        
        return integration_analysis
    
    def analyze_performance_capabilities(self) -> Dict[str, Any]:
        """Analyze performance capabilities of the platform"""
        performance_analysis = {
            "high_throughput_services": [],
            "async_capable_services": [],
            "batch_processing_services": [],
            "streaming_services": [],
            "caching_services": [],
            "estimated_ops_per_second": {}
        }
        
        for service in self.services:
            service_path = self.aiml_path / service
            main_files = list(service_path.glob("main.*"))
            if main_files:
                try:
                    with open(main_files[0], 'r') as f:
                        content = f.read()
                    
                    # Analyze performance characteristics
                    if "async" in content or "goroutine" in content:
                        performance_analysis["async_capable_services"].append(service)
                    
                    if "batch" in content.lower():
                        performance_analysis["batch_processing_services"].append(service)
                    
                    if "stream" in content.lower():
                        performance_analysis["streaming_services"].append(service)
                    
                    if "redis" in content.lower() or "cache" in content.lower():
                        performance_analysis["caching_services"].append(service)
                    
                    # Estimate ops per second based on implementation
                    estimated_ops = self.estimate_ops_per_second(service, content)
                    performance_analysis["estimated_ops_per_second"][service] = estimated_ops
                    
                    if estimated_ops > 10000:
                        performance_analysis["high_throughput_services"].append(service)
                        
                except:
                    pass
        
        return performance_analysis
    
    def estimate_ops_per_second(self, service: str, content: str) -> int:
        """Estimate operations per second capability"""
        base_ops = 1000  # Base operations per second
        
        # Multipliers based on implementation characteristics
        multipliers = {
            "async": 5,
            "goroutine": 5,
            "batch": 10,
            "cache": 3,
            "redis": 3,
            "faiss": 20,  # Vector search is very fast
            "torch": 2,
            "concurrent": 4,
            "pool": 3,
            "stream": 8
        }
        
        total_multiplier = 1
        for keyword, multiplier in multipliers.items():
            if keyword in content.lower():
                total_multiplier *= multiplier
        
        # Service-specific adjustments
        service_adjustments = {
            "cocoindex-service": 15,  # Vector search is very fast
            "falkordb-service": 8,    # Graph queries can be optimized
            "gnn-service": 3,         # ML inference is slower
            "lakehouse-integration": 12,  # Data processing can be fast
            "ollama-service": 2       # LLM inference is slower
        }
        
        if service in service_adjustments:
            total_multiplier *= service_adjustments[service]
        
        return int(base_ops * min(total_multiplier, 100))  # Cap at 100k ops/sec per service
    
    def assess_production_readiness(self) -> Dict[str, Any]:
        """Assess production readiness of the platform"""
        readiness = {
            "overall_readiness_score": 0.0,
            "production_ready_services": [],
            "services_needing_work": [],
            "critical_issues": [],
            "recommendations": []
        }
        
        ready_count = 0
        total_services = len(self.services)
        
        for service in self.services:
            service_path = self.aiml_path / service
            if not service_path.exists():
                readiness["services_needing_work"].append(service)
                readiness["critical_issues"].append(f"{service}: Service directory missing")
                continue
            
            main_files = list(service_path.glob("main.*"))
            if not main_files:
                readiness["services_needing_work"].append(service)
                readiness["critical_issues"].append(f"{service}: No main implementation file")
                continue
            
            try:
                with open(main_files[0], 'r') as f:
                    content = f.read()
                
                # Check production readiness criteria
                has_error_handling = "try:" in content or "error" in content
                has_logging = "log" in content.lower()
                has_monitoring = "prometheus" in content.lower() or "metrics" in content.lower()
                has_database = "sql" in content.lower() or "db" in content.lower()
                has_api = "fastapi" in content or "gin" in content or "router" in content
                
                production_score = sum([
                    has_error_handling,
                    has_logging,
                    has_monitoring,
                    has_database,
                    has_api
                ])
                
                if production_score >= 4:
                    readiness["production_ready_services"].append(service)
                    ready_count += 1
                else:
                    readiness["services_needing_work"].append(service)
                    
            except:
                readiness["services_needing_work"].append(service)
        
        readiness["overall_readiness_score"] = (ready_count / total_services) * 100
        
        # Generate recommendations
        if readiness["overall_readiness_score"] < 80:
            readiness["recommendations"].append("Improve error handling across services")
            readiness["recommendations"].append("Add comprehensive logging to all services")
            readiness["recommendations"].append("Implement monitoring and metrics collection")
        
        return readiness

def main():
    analyzer = AIMLRobustnessAnalyzer("/home/ubuntu/nigerian-banking-platform-COMPREHENSIVE-PRODUCTION")
    results = analyzer.analyze_all_services()
    
    # Save results
    with open("/home/ubuntu/aiml_robustness_analysis.json", "w") as f:
        json.dump(results, f, indent=2)
    
    # Print summary
    print("🤖 AI/ML PLATFORM ROBUSTNESS ANALYSIS")
    print("=" * 50)
    print(f"Overall Robustness Score: {results['overall_score']:.1f}/100")
    print(f"Services Analyzed: {results['services_analyzed']}")
    print(f"Production Ready Services: {len(results['production_readiness']['production_ready_services'])}")
    print()
    
    print("📊 SERVICE SCORES:")
    for service, details in results["service_details"].items():
        score = details.get("robustness_score", 0)
        print(f"  {service}: {score:.1f}/100")
    
    print()
    print("🔗 BI-DIRECTIONAL INTEGRATIONS:")
    bi_pairs = results["integration_analysis"]["bi_directional_pairs"]
    if bi_pairs:
        for pair in bi_pairs:
            print(f"  {pair[0]} ↔ {pair[1]}")
    else:
        print("  No bi-directional integrations detected")
    
    print()
    print("⚡ PERFORMANCE CAPABILITIES:")
    perf = results["performance_analysis"]
    total_estimated_ops = sum(perf["estimated_ops_per_second"].values())
    print(f"  Total Estimated Ops/Sec: {total_estimated_ops:,}")
    print(f"  High Throughput Services: {len(perf['high_throughput_services'])}")
    print(f"  Async Capable Services: {len(perf['async_capable_services'])}")

if __name__ == "__main__":
    main()
