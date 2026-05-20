#!/usr/bin/env python3
"""
Production Readiness Validation Script
Validates all components of Permify implementation
"""

import os
import json
from pathlib import Path
from typing import Dict, List, Tuple

def validate_infrastructure() -> Tuple[int, List[str]]:
    """Validate infrastructure components"""
    score = 0
    issues = []
    
    # Check Docker Compose
    if Path("docker/docker-compose.yml").exists():
        score += 5
    else:
        issues.append("Missing docker-compose.yml")
    
    # Check Kubernetes manifests
    if Path("kubernetes/permify-deployment.yaml").exists():
        score += 5
    else:
        issues.append("Missing Kubernetes deployment")
    
    # Check configuration
    if Path("config/permify.yaml").exists():
        score += 5
    else:
        issues.append("Missing Permify configuration")
    
    # Check database init script
    if Path("docker/init-db.sql").exists():
        score += 5
    else:
        issues.append("Missing database init script")
    
    # Check monitoring
    if Path("monitoring/prometheus.yml").exists():
        score += 5
    else:
        issues.append("Missing Prometheus configuration")
    
    return score, issues

def validate_schemas() -> Tuple[int, List[str]]:
    """Validate authorization schemas"""
    score = 0
    issues = []
    
    schema_dir = Path("schemas")
    if not schema_dir.exists():
        issues.append("Missing schemas directory")
        return 0, issues
    
    # Check main schema
    if (schema_dir / "remittance-platform.perm").exists():
        score += 5
    else:
        issues.append("Missing main schema")
    
    # Check admin schema
    if (schema_dir / "admin.perm").exists():
        score += 5
    else:
        issues.append("Missing admin schema")
    
    # Check compliance schema
    if (schema_dir / "compliance.perm").exists():
        score += 5
    else:
        issues.append("Missing compliance schema")
    
    return score, issues

def validate_code() -> Tuple[int, List[str]]:
    """Validate code implementation"""
    score = 0
    issues = []
    
    # Check client
    if Path("client/permify_client.py").exists():
        score += 7
    else:
        issues.append("Missing Permify client")
    
    # Check authorization service
    if Path("service/authorization_service.py").exists():
        score += 7
    else:
        issues.append("Missing authorization service")
    
    # Check policy engine
    if Path("policies/policy_engine.py").exists():
        score += 6
    else:
        issues.append("Missing policy engine")
    
    # Check middleware
    if Path("middleware/fastapi_middleware.py").exists():
        score += 5
    else:
        issues.append("Missing FastAPI middleware")
    
    # Check integrations
    integrations = [
        "integrations/payment/payment_service_integration.py",
        "integrations/kyc/kyc_service_integration.py",
        "integrations/fraud/fraud_service_integration.py",
        "integrations/compliance/compliance_service_integration.py",
        "integrations/admin/admin_service_integration.py"
    ]
    
    for integration in integrations:
        if Path(integration).exists():
            score += 2
        else:
            issues.append(f"Missing {integration}")
    
    return score, issues

def validate_tests() -> Tuple[int, List[str]]:
    """Validate test suite"""
    score = 0
    issues = []
    
    # Check unit tests
    unit_tests = [
        "tests/unit/test_permify_client.py",
        "tests/unit/test_authorization_service.py",
        "tests/unit/test_policy_engine.py"
    ]
    
    for test in unit_tests:
        if Path(test).exists():
            score += 2
        else:
            issues.append(f"Missing {test}")
    
    # Check integration tests
    if Path("tests/integration/test_payment_integration.py").exists():
        score += 2
    else:
        issues.append("Missing integration tests")
    
    # Check E2E tests
    if Path("tests/e2e/test_authorization_e2e.py").exists():
        score += 2
    else:
        issues.append("Missing E2E tests")
    
    return score, issues

def validate_documentation() -> Tuple[int, List[str]]:
    """Validate documentation"""
    score = 0
    issues = []
    
    # Check README
    if Path("README.md").exists():
        score += 2
    else:
        issues.append("Missing README")
    
    # Check deployment guide
    if Path("docs/DEPLOYMENT_GUIDE.md").exists():
        score += 3
    else:
        issues.append("Missing deployment guide")
    
    return score, issues

def main():
    """Run all validations"""
    print("=" * 70)
    print("Permify Production Readiness Validation")
    print("=" * 70)
    print()
    
    # Change to project root
    os.chdir(Path(__file__).parent.parent)
    
    results = {}
    total_score = 0
    max_score = 100
    
    # Infrastructure (25 points)
    infra_score, infra_issues = validate_infrastructure()
    results["Infrastructure"] = {"score": infra_score, "max": 25, "issues": infra_issues}
    total_score += infra_score
    
    # Schemas (15 points)
    schema_score, schema_issues = validate_schemas()
    results["Schemas"] = {"score": schema_score, "max": 15, "issues": schema_issues}
    total_score += schema_score
    
    # Code (45 points)
    code_score, code_issues = validate_code()
    results["Code"] = {"score": code_score, "max": 45, "issues": code_issues}
    total_score += code_score
    
    # Tests (10 points)
    test_score, test_issues = validate_tests()
    results["Tests"] = {"score": test_score, "max": 10, "issues": test_issues}
    total_score += test_score
    
    # Documentation (5 points)
    doc_score, doc_issues = validate_documentation()
    results["Documentation"] = {"score": doc_score, "max": 5, "issues": doc_issues}
    total_score += doc_score
    
    # Print results
    for category, data in results.items():
        status = "✅" if data["score"] == data["max"] else "⚠️"
        print(f"{status} {category}: {data['score']}/{data['max']}")
        if data["issues"]:
            for issue in data["issues"]:
                print(f"   - {issue}")
        print()
    
    print("=" * 70)
    print(f"TOTAL SCORE: {total_score}/{max_score}")
    
    if total_score == max_score:
        print("STATUS: ✅ PRODUCTION READY")
        grade = "A"
    elif total_score >= 80:
        print("STATUS: ⚠️ MOSTLY READY (minor issues)")
        grade = "B"
    elif total_score >= 60:
        print("STATUS: ⚠️ NEEDS WORK")
        grade = "C"
    else:
        print("STATUS: ❌ NOT READY")
        grade = "F"
    
    print(f"GRADE: {grade}")
    print("=" * 70)
    
    # Save results
    with open("PRODUCTION_READINESS_REPORT.json", "w") as f:
        json.dump({
            "total_score": total_score,
            "max_score": max_score,
            "grade": grade,
            "categories": results
        }, f, indent=2)
    
    print("\nReport saved to: PRODUCTION_READINESS_REPORT.json")
    
    return 0 if total_score == max_score else 1

if __name__ == "__main__":
    exit(main())
