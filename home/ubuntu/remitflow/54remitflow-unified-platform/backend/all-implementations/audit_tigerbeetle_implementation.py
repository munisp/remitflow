#!/usr/bin/env python3
"""
Comprehensive Audit of TigerBeetle Implementation Across Platform
"""

import os
import json
import re
from datetime import datetime

def audit_platform_files():
    """Audit all platform files for TigerBeetle implementation"""
    
    print("🔍 Auditing TigerBeetle Implementation Across Platform...")
    
    audit_results = {
        "audit_timestamp": datetime.now().isoformat(),
        "total_files_scanned": 0,
        "services_analyzed": {},
        "architectural_issues": [],
        "correct_implementations": [],
        "files_needing_fixes": [],
        "compliance_score": 0
    }
    
    # Define what we're looking for
    tigerbeetle_patterns = {
        "correct_usage": [
            r"tigerbeetle\.Client",
            r"CreateTransfers",
            r"CreateAccounts", 
            r"LookupAccounts",
            r"PRIMARY_FINANCIAL_LEDGER",
            r"tigerbeetle_account_id"
        ],
        "incorrect_usage": [
            r"balance.*postgres",
            r"amount.*postgres",
            r"transaction.*postgres.*amount",
            r"INSERT.*balances",
            r"UPDATE.*balance",
            r"financial.*postgresql"
        ]
    }
    
    # Scan platform directories
    platform_dirs = [
        "/home/ubuntu/nigerian-remittance-platform-COMPREHENSIVE-PRODUCTION",
        "/home/ubuntu/nigerian-remittance-platform-PIX-INTEGRATION-v1.0.0",
        "/home/ubuntu/tigerbeetle-architecture",
        "/home/ubuntu/ui-ux-improvements"
    ]
    
    for platform_dir in platform_dirs:
        if os.path.exists(platform_dir):
            print(f"📂 Scanning {platform_dir}...")
            scan_directory(platform_dir, audit_results, tigerbeetle_patterns)
    
    # Calculate compliance score
    total_issues = len(audit_results["architectural_issues"])
    total_correct = len(audit_results["correct_implementations"])
    
    if total_issues + total_correct > 0:
        audit_results["compliance_score"] = (total_correct / (total_issues + total_correct)) * 100
    else:
        audit_results["compliance_score"] = 0
    
    return audit_results

def scan_directory(directory, audit_results, patterns):
    """Recursively scan directory for TigerBeetle usage"""
    
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith(('.go', '.py', '.js', '.ts', '.yaml', '.yml', '.md')):
                file_path = os.path.join(root, file)
                audit_results["total_files_scanned"] += 1
                
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        analyze_file_content(file_path, content, audit_results, patterns)
                except Exception as e:
                    print(f"⚠️ Could not read {file_path}: {e}")

def analyze_file_content(file_path, content, audit_results, patterns):
    """Analyze file content for TigerBeetle usage patterns"""
    
    service_name = extract_service_name(file_path)
    
    if service_name not in audit_results["services_analyzed"]:
        audit_results["services_analyzed"][service_name] = {
            "files_count": 0,
            "correct_usage": [],
            "incorrect_usage": [],
            "architectural_compliance": "unknown"
        }
    
    audit_results["services_analyzed"][service_name]["files_count"] += 1
    
    # Check for correct TigerBeetle usage
    correct_matches = []
    for pattern in patterns["correct_usage"]:
        matches = re.findall(pattern, content, re.IGNORECASE)
        if matches:
            correct_matches.extend(matches)
    
    # Check for incorrect usage (financial data in PostgreSQL)
    incorrect_matches = []
    for pattern in patterns["incorrect_usage"]:
        matches = re.findall(pattern, content, re.IGNORECASE)
        if matches:
            incorrect_matches.extend(matches)
    
    # Record findings
    if correct_matches:
        audit_results["services_analyzed"][service_name]["correct_usage"].extend(correct_matches)
        audit_results["correct_implementations"].append({
            "file": file_path,
            "service": service_name,
            "correct_patterns": correct_matches
        })
    
    if incorrect_matches:
        audit_results["services_analyzed"][service_name]["incorrect_usage"].extend(incorrect_matches)
        audit_results["architectural_issues"].append({
            "file": file_path,
            "service": service_name,
            "issue_type": "financial_data_in_postgresql",
            "incorrect_patterns": incorrect_matches
        })
        audit_results["files_needing_fixes"].append(file_path)
    
    # Determine service compliance
    if correct_matches and not incorrect_matches:
        audit_results["services_analyzed"][service_name]["architectural_compliance"] = "compliant"
    elif incorrect_matches:
        audit_results["services_analyzed"][service_name]["architectural_compliance"] = "non_compliant"
    else:
        audit_results["services_analyzed"][service_name]["architectural_compliance"] = "no_financial_operations"

def extract_service_name(file_path):
    """Extract service name from file path"""
    
    # Common service patterns
    service_patterns = [
        r"tigerbeetle",
        r"pix-gateway",
        r"brl-liquidity",
        r"compliance",
        r"orchestrator",
        r"user-management",
        r"notifications",
        r"stablecoin",
        r"gnn",
        r"api-gateway"
    ]
    
    for pattern in service_patterns:
        if pattern in file_path.lower():
            return pattern
    
    # Extract from directory structure
    path_parts = file_path.split('/')
    for part in path_parts:
        if 'service' in part.lower() or 'gateway' in part.lower():
            return part
    
    return "unknown_service"

def create_detailed_audit_report(audit_results):
    """Create detailed audit report"""
    
    report = f"""# 🔍 TIGERBEETLE ARCHITECTURE AUDIT REPORT

## 📊 **AUDIT SUMMARY**

- **Audit Date**: {audit_results['audit_timestamp']}
- **Files Scanned**: {audit_results['total_files_scanned']}
- **Services Analyzed**: {len(audit_results['services_analyzed'])}
- **Compliance Score**: {audit_results['compliance_score']:.1f}%
- **Architectural Issues**: {len(audit_results['architectural_issues'])}
- **Correct Implementations**: {len(audit_results['correct_implementations'])}

## 🎯 **COMPLIANCE STATUS**

"""
    
    if audit_results['compliance_score'] >= 90:
        report += "✅ **EXCELLENT** - Platform follows TigerBeetle architecture correctly\n\n"
    elif audit_results['compliance_score'] >= 70:
        report += "⚠️ **GOOD** - Minor architectural issues need attention\n\n"
    elif audit_results['compliance_score'] >= 50:
        report += "🔶 **MODERATE** - Significant architectural issues found\n\n"
    else:
        report += "❌ **POOR** - Major architectural overhaul needed\n\n"
    
    # Service-by-service analysis
    report += "## 🔍 **SERVICE-BY-SERVICE ANALYSIS**\n\n"
    
    for service_name, service_data in audit_results['services_analyzed'].items():
        compliance_icon = {
            "compliant": "✅",
            "non_compliant": "❌", 
            "no_financial_operations": "ℹ️",
            "unknown": "❓"
        }.get(service_data['architectural_compliance'], "❓")
        
        report += f"### {compliance_icon} **{service_name.upper()}**\n"
        report += f"- **Files**: {service_data['files_count']}\n"
        report += f"- **Compliance**: {service_data['architectural_compliance']}\n"
        report += f"- **Correct Usage**: {len(service_data['correct_usage'])} instances\n"
        report += f"- **Incorrect Usage**: {len(service_data['incorrect_usage'])} instances\n\n"
    
    # Architectural issues
    if audit_results['architectural_issues']:
        report += "## ❌ **ARCHITECTURAL ISSUES FOUND**\n\n"
        
        for issue in audit_results['architectural_issues']:
            report += f"### 🚨 {issue['service']} - {issue['issue_type']}\n"
            report += f"- **File**: `{issue['file']}`\n"
            report += f"- **Issues**: {', '.join(issue['incorrect_patterns'])}\n\n"
    
    # Correct implementations
    if audit_results['correct_implementations']:
        report += "## ✅ **CORRECT IMPLEMENTATIONS**\n\n"
        
        for impl in audit_results['correct_implementations'][:10]:  # Show first 10
            report += f"### ✅ {impl['service']}\n"
            report += f"- **File**: `{impl['file']}`\n"
            report += f"- **Patterns**: {', '.join(impl['correct_patterns'])}\n\n"
    
    # Recommendations
    report += "## 🎯 **RECOMMENDATIONS**\n\n"
    
    if audit_results['compliance_score'] < 100:
        report += "### 🔧 **Immediate Actions Required**\n\n"
        
        if audit_results['architectural_issues']:
            report += "1. **Fix Financial Data Storage**\n"
            report += "   - Move all balances and amounts to TigerBeetle\n"
            report += "   - Remove financial calculations from PostgreSQL\n"
            report += "   - Update services to use TigerBeetle as primary ledger\n\n"
        
        report += "2. **Update Service Integration**\n"
        report += "   - Ensure all services use TigerBeetle for financial operations\n"
        report += "   - PostgreSQL should only store metadata\n"
        report += "   - Implement proper TigerBeetle client connections\n\n"
        
        report += "3. **Performance Optimization**\n"
        report += "   - Leverage TigerBeetle's 1M+ TPS capability\n"
        report += "   - Remove application-level financial calculations\n"
        report += "   - Use atomic transfers for cross-border operations\n\n"
    
    return report

def check_specific_services():
    """Check specific services for TigerBeetle implementation"""
    
    print("🔍 Checking Specific Services...")
    
    service_checks = {
        "enhanced_tigerbeetle": {
            "expected_files": ["tigerbeetle_service.go", "main.go"],
            "expected_patterns": ["CreateTransfers", "CreateAccounts", "PRIMARY_FINANCIAL_LEDGER"],
            "status": "unknown"
        },
        "pix_gateway": {
            "expected_files": ["main.go", "pix_gateway.go"],
            "expected_patterns": ["tigerbeetle", "account_id"],
            "status": "unknown"
        },
        "brl_liquidity": {
            "expected_files": ["main.py", "liquidity_manager.py"],
            "expected_patterns": ["tigerbeetle_account_id", "balance"],
            "status": "unknown"
        },
        "integration_orchestrator": {
            "expected_files": ["main.go", "orchestrator.go"],
            "expected_patterns": ["tigerbeetle", "CreateTransfers"],
            "status": "unknown"
        }
    }
    
    # Check each service
    for service_name, check_config in service_checks.items():
        found_files = 0
        found_patterns = 0
        
        # Search for service files
        for root, dirs, files in os.walk("/home/ubuntu"):
            for file in files:
                if any(expected in file for expected in check_config["expected_files"]):
                    file_path = os.path.join(root, file)
                    if service_name.replace("_", "-") in file_path or service_name in file_path:
                        found_files += 1
                        
                        # Check file content for patterns
                        try:
                            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                                content = f.read()
                                for pattern in check_config["expected_patterns"]:
                                    if pattern.lower() in content.lower():
                                        found_patterns += 1
                        except:
                            pass
        
        # Determine status
        if found_files > 0 and found_patterns > 0:
            service_checks[service_name]["status"] = "implemented"
        elif found_files > 0:
            service_checks[service_name]["status"] = "partial"
        else:
            service_checks[service_name]["status"] = "missing"
    
    return service_checks

def main():
    """Main audit function"""
    print("🔍 Starting Comprehensive TigerBeetle Architecture Audit")
    
    # Perform platform audit
    audit_results = audit_platform_files()
    
    # Check specific services
    service_checks = check_specific_services()
    
    # Create detailed report
    detailed_report = create_detailed_audit_report(audit_results)
    
    # Save audit results
    with open("/home/ubuntu/tigerbeetle_audit_results.json", "w") as f:
        json.dump(audit_results, f, indent=4)
    
    with open("/home/ubuntu/service_implementation_check.json", "w") as f:
        json.dump(service_checks, f, indent=4)
    
    with open("/home/ubuntu/TIGERBEETLE_AUDIT_REPORT.md", "w") as f:
        f.write(detailed_report)
    
    # Print summary
    print("✅ TigerBeetle Architecture Audit Completed!")
    print(f"📊 Compliance Score: {audit_results['compliance_score']:.1f}%")
    print(f"📁 Files Scanned: {audit_results['total_files_scanned']}")
    print(f"🔧 Services Analyzed: {len(audit_results['services_analyzed'])}")
    print(f"❌ Issues Found: {len(audit_results['architectural_issues'])}")
    print(f"✅ Correct Implementations: {len(audit_results['correct_implementations'])}")
    
    print("\n🔍 Service Implementation Status:")
    for service, check in service_checks.items():
        status_icon = {"implemented": "✅", "partial": "⚠️", "missing": "❌"}[check["status"]]
        print(f"{status_icon} {service}: {check['status']}")
    
    # Determine overall status
    if audit_results['compliance_score'] >= 90:
        print("\n🎉 AUDIT RESULT: TigerBeetle architecture is properly implemented!")
    elif audit_results['compliance_score'] >= 70:
        print("\n⚠️ AUDIT RESULT: Minor issues found, mostly compliant")
    else:
        print("\n❌ AUDIT RESULT: Significant architectural issues need fixing")
    
    return audit_results, service_checks

if __name__ == "__main__":
    main()

