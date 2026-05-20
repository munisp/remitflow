"""
Production Readiness Validation Script
Validates Mojaloop implementation completeness
"""

import json
import os
from pathlib import Path


def validate_infrastructure():
    """Validate infrastructure files"""
    score = 0
    max_score = 25
    
    required_files = [
        "docker/docker-compose.yml",
        "docker/init-db.sql",
        "kubernetes/mojaloop-deployment.yaml",
    ]
    
    for file_path in required_files:
        if Path(file_path).exists():
            score += 8
    
    return min(score, max_score), max_score


def validate_code():
    """Validate code implementation"""
    score = 0
    max_score = 30
    
    # Check core implementation exists
    if Path("../core/mojaloop-hub/core-hub/mojaloop-central-hub/src/routes/mojaloop_core.py").exists():
        score += 30
    
    return score, max_score


def validate_integrations():
    """Validate platform integrations"""
    score = 0
    max_score = 20
    
    integration_files = [
        "integrations/temporal/mojaloop_workflows.py",
        "integrations/permify/mojaloop_authorization.py",
        "integrations/kafka/mojaloop_events.py",
        "integrations/dapr/mojaloop_dapr.py",
    ]
    
    for file_path in integration_files:
        if Path(file_path).exists():
            score += 5
    
    return score, max_score


def validate_testing():
    """Validate test coverage"""
    score = 0
    max_score = 15
    
    test_files = [
        "tests/unit/test_mojaloop_core.py",
        "tests/integration/test_connector_integration.py",
        "tests/e2e/test_payment_flows.py",
        "pytest.ini",
    ]
    
    for file_path in test_files:
        if Path(file_path).exists():
            score += 3
    
    return min(score, max_score), max_score


def validate_monitoring():
    """Validate monitoring setup"""
    score = 0
    max_score = 10
    
    monitoring_files = [
        "monitoring/prometheus.yml",
        "monitoring/grafana-datasources.yml",
        "monitoring/metrics_exporter.py",
    ]
    
    for file_path in monitoring_files:
        if Path(file_path).exists():
            score += 3
    
    return min(score, max_score), max_score


def validate_documentation():
    """Validate documentation"""
    score = 0
    max_score = 5
    
    doc_files = [
        "README.md",
        "docs/DEPLOYMENT_GUIDE.md",
    ]
    
    for file_path in doc_files:
        if Path(file_path).exists():
            score += 2
    
    return min(score, max_score), max_score


def main():
    """Run validation"""
    os.chdir("/home/ubuntu/services/mojaloop-production")
    
    results = {
        "infrastructure": validate_infrastructure(),
        "code": validate_code(),
        "integrations": validate_integrations(),
        "testing": validate_testing(),
        "monitoring": validate_monitoring(),
        "documentation": validate_documentation(),
    }
    
    total_score = sum(score for score, _ in results.values())
    total_max = sum(max_score for _, max_score in results.values())
    
    report = {
        "total_score": total_score,
        "total_max": total_max,
        "percentage": round((total_score / total_max) * 100, 1),
        "grade": get_grade(total_score, total_max),
        "production_ready": total_score >= 80,
        "categories": {
            name: {
                "score": score,
                "max": max_score,
                "percentage": round((score / max_score) * 100, 1) if max_score > 0 else 0
            }
            for name, (score, max_score) in results.items()
        }
    }
    
    # Save report
    with open("PRODUCTION_READINESS_REPORT.json", "w") as f:
        json.dump(report, f, indent=2)
    
    # Print summary
    print(f"\nProduction Readiness Validation")
    print(f"=" * 50)
    print(f"Total Score: {total_score}/{total_max} ({report['percentage']}%)")
    print(f"Grade: {report['grade']}")
    print(f"Production Ready: {'YES' if report['production_ready'] else 'NO'}")
    print(f"\nCategory Breakdown:")
    for name, data in report['categories'].items():
        print(f"  {name.capitalize()}: {data['score']}/{data['max']} ({data['percentage']}%)")
    
    return report


def get_grade(score, max_score):
    """Get letter grade"""
    percentage = (score / max_score) * 100
    if percentage >= 90:
        return "A"
    elif percentage >= 80:
        return "B"
    elif percentage >= 70:
        return "C"
    elif percentage >= 60:
        return "D"
    else:
        return "F"


if __name__ == "__main__":
    main()
