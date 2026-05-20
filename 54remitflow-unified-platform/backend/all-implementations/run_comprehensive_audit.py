#!/usr/bin/env python3
"""
Comprehensive TigerBeetle Audit - Including New Implementations
"""

import os
import json
import re
from datetime import datetime

def run_comprehensive_audit():
    """Run comprehensive audit including new implementations"""
    
    print("🔍 Running Comprehensive TigerBeetle Architecture Audit...")
    
    audit_results = {
        "audit_timestamp": datetime.now().isoformat(),
        "audit_type": "comprehensive_post_fix",
        "total_files_scanned": 0,
        "services_analyzed": {},
        "architectural_issues": [],
        "correct_implementations": [],
        "files_needing_fixes": [],
        "compliance_score": 0,
        "implementation_status": {},
        "before_after_comparison": {}
    }
    
    # Define comprehensive patterns
    tigerbeetle_patterns = {
        "correct_usage": [
            r"PRIMARY_FINANCIAL_LEDGER",
            r"tigerbeetle\.Client",
            r"CreateTransfers",
            r"CreateAccounts",
            r"LookupAccounts",
            r"tigerbeetle_account_id",
            r"TIGERBEETLE_PRIMARY_LEDGER",
            r"enhanced-tigerbeetle",
            r"CrossBorderTransfer",
            r"processInTigerBeetle"
        ],
        "incorrect_usage": [
            r"balance.*postgres",
            r"amount.*postgres",
            r"INSERT.*INTO.*balances",
            r"UPDATE.*balance.*SET",
            r"financial.*postgresql",
            r"account_balance.*postgres"
        ],
        "metadata_only_patterns": [
            r"METADATA_ONLY",
            r"user_profiles",
            r"pix_key_mappings",
            r"transfer_metadata",
            r"compliance_records"
        ]
    }
    
    # Scan all relevant directories
    scan_directories = [
        "/home/ubuntu/tigerbeetle-proper-implementation",
        "/home/ubuntu/tigerbeetle-architecture", 
        "/home/ubuntu/nigerian-remittance-platform-PIX-INTEGRATION-v1.0.0",
        "/home/ubuntu/keda-integration"
    ]
    
    for directory in scan_directories:
        if os.path.exists(directory):
            print(f"📂 Scanning {directory}...")
            scan_directory_comprehensive(directory, audit_results, tigerbeetle_patterns)
    
    # Analyze specific implementations
    analyze_specific_implementations(audit_results)
    
    # Calculate compliance score
    calculate_compliance_score(audit_results)
    
    return audit_results

def scan_directory_comprehensive(directory, audit_results, patterns):
    """Comprehensive directory scan"""
    
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith(('.go', '.py', '.js', '.ts', '.yaml', '.yml', '.md')):
                file_path = os.path.join(root, file)
                audit_results["total_files_scanned"] += 1
                
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        analyze_file_comprehensive(file_path, content, audit_results, patterns)
                except Exception as e:
                    print(f"⚠️ Could not read {file_path}: {e}")

def analyze_file_comprehensive(file_path, content, audit_results, patterns):
    """Comprehensive file analysis"""
    
    service_name = extract_service_name_comprehensive(file_path)
    
    if service_name not in audit_results["services_analyzed"]:
        audit_results["services_analyzed"][service_name] = {
            "files_count": 0,
            "correct_usage": [],
            "incorrect_usage": [],
            "metadata_only_usage": [],
            "architectural_compliance": "unknown",
            "implementation_quality": "unknown"
        }
    
    audit_results["services_analyzed"][service_name]["files_count"] += 1
    
    # Check for correct TigerBeetle usage
    correct_matches = []
    for pattern in patterns["correct_usage"]:
        matches = re.findall(pattern, content, re.IGNORECASE)
        if matches:
            correct_matches.extend(matches)
    
    # Check for incorrect usage
    incorrect_matches = []
    for pattern in patterns["incorrect_usage"]:
        matches = re.findall(pattern, content, re.IGNORECASE)
        if matches:
            incorrect_matches.extend(matches)
    
    # Check for metadata-only patterns
    metadata_matches = []
    for pattern in patterns["metadata_only_patterns"]:
        matches = re.findall(pattern, content, re.IGNORECASE)
        if matches:
            metadata_matches.extend(matches)
    
    # Record findings
    if correct_matches:
        audit_results["services_analyzed"][service_name]["correct_usage"].extend(correct_matches)
        audit_results["correct_implementations"].append({
            "file": file_path,
            "service": service_name,
            "correct_patterns": correct_matches,
            "implementation_type": "tigerbeetle_primary_ledger"
        })
    
    if incorrect_matches:
        audit_results["services_analyzed"][service_name]["incorrect_usage"].extend(incorrect_matches)
        audit_results["architectural_issues"].append({
            "file": file_path,
            "service": service_name,
            "issue_type": "financial_data_in_postgresql",
            "incorrect_patterns": incorrect_matches,
            "severity": "high"
        })
        audit_results["files_needing_fixes"].append(file_path)
    
    if metadata_matches:
        audit_results["services_analyzed"][service_name]["metadata_only_usage"].extend(metadata_matches)
    
    # Determine compliance and quality
    determine_service_compliance(audit_results["services_analyzed"][service_name], correct_matches, incorrect_matches, metadata_matches)

def determine_service_compliance(service_data, correct_matches, incorrect_matches, metadata_matches):
    """Determine service compliance level"""
    
    if correct_matches and not incorrect_matches:
        service_data["architectural_compliance"] = "fully_compliant"
        service_data["implementation_quality"] = "excellent"
    elif correct_matches and incorrect_matches:
        service_data["architectural_compliance"] = "partially_compliant"
        service_data["implementation_quality"] = "needs_improvement"
    elif incorrect_matches:
        service_data["architectural_compliance"] = "non_compliant"
        service_data["implementation_quality"] = "poor"
    elif metadata_matches:
        service_data["architectural_compliance"] = "metadata_only"
        service_data["implementation_quality"] = "appropriate"
    else:
        service_data["architectural_compliance"] = "no_financial_operations"
        service_data["implementation_quality"] = "not_applicable"

def analyze_specific_implementations(audit_results):
    """Analyze specific key implementations"""
    
    key_implementations = {
        "enhanced_tigerbeetle_service": {
            "expected_file": "/home/ubuntu/tigerbeetle-proper-implementation/service/enhanced_tigerbeetle_service.go",
            "expected_patterns": ["PRIMARY_FINANCIAL_LEDGER", "CreateTransfers", "1M+ TPS"],
            "status": "not_found"
        },
        "pix_gateway_fixed": {
            "expected_file": "/home/ubuntu/tigerbeetle-proper-implementation/service/pix_gateway_fixed.go",
            "expected_patterns": ["TIGERBEETLE_PRIMARY_LEDGER", "processInTigerBeetle"],
            "status": "not_found"
        },
        "postgres_metadata_service": {
            "expected_file": "/home/ubuntu/tigerbeetle-architecture/metadata/postgres_metadata_service.py",
            "expected_patterns": ["METADATA_ONLY", "NO financial data"],
            "status": "not_found"
        }
    }
    
    for impl_name, impl_config in key_implementations.items():
        if os.path.exists(impl_config["expected_file"]):
            try:
                with open(impl_config["expected_file"], 'r') as f:
                    content = f.read()
                    
                found_patterns = 0
                for pattern in impl_config["expected_patterns"]:
                    if pattern.lower() in content.lower():
                        found_patterns += 1
                
                if found_patterns == len(impl_config["expected_patterns"]):
                    impl_config["status"] = "fully_implemented"
                elif found_patterns > 0:
                    impl_config["status"] = "partially_implemented"
                else:
                    impl_config["status"] = "implemented_but_incomplete"
            except:
                impl_config["status"] = "file_exists_but_unreadable"
        
        audit_results["implementation_status"][impl_name] = impl_config

def calculate_compliance_score(audit_results):
    """Calculate overall compliance score"""
    
    total_services = len(audit_results["services_analyzed"])
    compliant_services = 0
    
    for service_name, service_data in audit_results["services_analyzed"].items():
        if service_data["architectural_compliance"] in ["fully_compliant", "metadata_only"]:
            compliant_services += 1
        elif service_data["architectural_compliance"] == "partially_compliant":
            compliant_services += 0.5
    
    if total_services > 0:
        audit_results["compliance_score"] = (compliant_services / total_services) * 100
    else:
        audit_results["compliance_score"] = 0
    
    # Implementation status score
    implemented_count = 0
    total_implementations = len(audit_results["implementation_status"])
    
    for impl_name, impl_data in audit_results["implementation_status"].items():
        if impl_data["status"] == "fully_implemented":
            implemented_count += 1
        elif impl_data["status"] == "partially_implemented":
            implemented_count += 0.5
    
    if total_implementations > 0:
        implementation_score = (implemented_count / total_implementations) * 100
        audit_results["implementation_score"] = implementation_score
    else:
        audit_results["implementation_score"] = 0

def extract_service_name_comprehensive(file_path):
    """Extract service name with better logic"""
    
    # Check for specific service patterns
    if "enhanced_tigerbeetle_service" in file_path:
        return "enhanced_tigerbeetle_service"
    elif "pix_gateway_fixed" in file_path:
        return "pix_gateway_fixed"
    elif "postgres_metadata_service" in file_path:
        return "postgres_metadata_service"
    elif "tigerbeetle" in file_path.lower():
        return "tigerbeetle_service"
    elif "pix-gateway" in file_path.lower():
        return "pix_gateway"
    elif "brl-liquidity" in file_path.lower():
        return "brl_liquidity_manager"
    elif "orchestrator" in file_path.lower():
        return "integration_orchestrator"
    elif "keda" in file_path.lower():
        return "keda_autoscaling"
    else:
        # Extract from directory structure
        path_parts = file_path.split('/')
        for part in path_parts:
            if any(keyword in part.lower() for keyword in ['service', 'gateway', 'manager', 'orchestrator']):
                return part.lower().replace('-', '_')
        
        return "unknown_service"

def create_detailed_audit_report(audit_results):
    """Create comprehensive audit report"""
    
    report = f"""# 🔍 COMPREHENSIVE TIGERBEETLE ARCHITECTURE AUDIT REPORT

## 📊 **EXECUTIVE SUMMARY**

- **Audit Date**: {audit_results['audit_timestamp']}
- **Audit Type**: {audit_results['audit_type']}
- **Files Scanned**: {audit_results['total_files_scanned']}
- **Services Analyzed**: {len(audit_results['services_analyzed'])}
- **Compliance Score**: {audit_results['compliance_score']:.1f}%
- **Implementation Score**: {audit_results.get('implementation_score', 0):.1f}%
- **Architectural Issues**: {len(audit_results['architectural_issues'])}
- **Correct Implementations**: {len(audit_results['correct_implementations'])}

## 🎯 **OVERALL COMPLIANCE STATUS**

"""
    
    if audit_results['compliance_score'] >= 90:
        report += "✅ **EXCELLENT** - TigerBeetle architecture properly implemented\n\n"
    elif audit_results['compliance_score'] >= 70:
        report += "⚠️ **GOOD** - Minor architectural issues remain\n\n"
    elif audit_results['compliance_score'] >= 50:
        report += "🔶 **MODERATE** - Significant improvements made but more work needed\n\n"
    else:
        report += "❌ **POOR** - Major architectural issues still present\n\n"
    
    # Key implementations status
    report += "## 🏗️ **KEY IMPLEMENTATIONS STATUS**\n\n"
    
    for impl_name, impl_data in audit_results['implementation_status'].items():
        status_icon = {
            "fully_implemented": "✅",
            "partially_implemented": "⚠️",
            "implemented_but_incomplete": "🔶",
            "not_found": "❌",
            "file_exists_but_unreadable": "❓"
        }.get(impl_data['status'], "❓")
        
        report += f"### {status_icon} **{impl_name.upper()}**\n"
        report += f"- **Status**: {impl_data['status']}\n"
        report += f"- **Expected File**: `{impl_data['expected_file']}`\n"
        report += f"- **Expected Patterns**: {', '.join(impl_data['expected_patterns'])}\n\n"
    
    # Service-by-service analysis
    report += "## 🔍 **SERVICE-BY-SERVICE ANALYSIS**\n\n"
    
    for service_name, service_data in audit_results['services_analyzed'].items():
        compliance_icon = {
            "fully_compliant": "✅",
            "partially_compliant": "⚠️",
            "non_compliant": "❌",
            "metadata_only": "ℹ️",
            "no_financial_operations": "➖",
            "unknown": "❓"
        }.get(service_data['architectural_compliance'], "❓")
        
        quality_icon = {
            "excellent": "🌟",
            "appropriate": "✅",
            "needs_improvement": "⚠️",
            "poor": "❌",
            "not_applicable": "➖",
            "unknown": "❓"
        }.get(service_data['implementation_quality'], "❓")
        
        report += f"### {compliance_icon} **{service_name.upper()}** {quality_icon}\n"
        report += f"- **Files**: {service_data['files_count']}\n"
        report += f"- **Compliance**: {service_data['architectural_compliance']}\n"
        report += f"- **Quality**: {service_data['implementation_quality']}\n"
        report += f"- **Correct Usage**: {len(service_data['correct_usage'])} instances\n"
        report += f"- **Incorrect Usage**: {len(service_data['incorrect_usage'])} instances\n"
        report += f"- **Metadata Only**: {len(service_data.get('metadata_only_usage', []))} instances\n\n"
    
    # Correct implementations
    if audit_results['correct_implementations']:
        report += "## ✅ **CORRECT IMPLEMENTATIONS FOUND**\n\n"
        
        for impl in audit_results['correct_implementations']:
            report += f"### ✅ {impl['service']} - {impl['implementation_type']}\n"
            report += f"- **File**: `{impl['file']}`\n"
            report += f"- **Patterns**: {', '.join(impl['correct_patterns'])}\n\n"
    
    # Architectural issues
    if audit_results['architectural_issues']:
        report += "## ❌ **ARCHITECTURAL ISSUES FOUND**\n\n"
        
        for issue in audit_results['architectural_issues']:
            report += f"### 🚨 {issue['service']} - {issue['issue_type']} ({issue['severity']})\n"
            report += f"- **File**: `{issue['file']}`\n"
            report += f"- **Issues**: {', '.join(issue['incorrect_patterns'])}\n\n"
    
    # Recommendations
    report += "## 🎯 **RECOMMENDATIONS**\n\n"
    
    if audit_results['compliance_score'] < 100:
        report += "### 🔧 **Next Steps**\n\n"
        
        if audit_results.get('implementation_score', 0) < 100:
            report += "1. **Complete Key Implementations**\n"
            report += "   - Deploy enhanced TigerBeetle service\n"
            report += "   - Update PIX Gateway to use TigerBeetle\n"
            report += "   - Implement PostgreSQL metadata-only service\n\n"
        
        if audit_results['architectural_issues']:
            report += "2. **Fix Remaining Issues**\n"
            report += "   - Remove financial data from PostgreSQL\n"
            report += "   - Update services to use TigerBeetle as primary ledger\n"
            report += "   - Ensure proper separation of concerns\n\n"
        
        report += "3. **Verify Implementation**\n"
        report += "   - Run verification scripts\n"
        report += "   - Test financial operations\n"
        report += "   - Validate performance metrics\n\n"
    else:
        report += "### 🎉 **Implementation Complete**\n\n"
        report += "TigerBeetle architecture has been properly implemented across the platform!\n\n"
    
    return report

def main():
    """Main audit function"""
    print("🔍 Starting Comprehensive TigerBeetle Architecture Audit")
    
    # Run comprehensive audit
    audit_results = run_comprehensive_audit()
    
    # Create detailed report
    detailed_report = create_detailed_audit_report(audit_results)
    
    # Save results
    with open("/home/ubuntu/comprehensive_tigerbeetle_audit.json", "w") as f:
        json.dump(audit_results, f, indent=4)
    
    with open("/home/ubuntu/COMPREHENSIVE_TIGERBEETLE_AUDIT_REPORT.md", "w") as f:
        f.write(detailed_report)
    
    # Print summary
    print("✅ Comprehensive TigerBeetle Audit Completed!")
    print(f"📊 Compliance Score: {audit_results['compliance_score']:.1f}%")
    print(f"🏗️ Implementation Score: {audit_results.get('implementation_score', 0):.1f}%")
    print(f"📁 Files Scanned: {audit_results['total_files_scanned']}")
    print(f"🔧 Services Analyzed: {len(audit_results['services_analyzed'])}")
    print(f"❌ Issues Found: {len(audit_results['architectural_issues'])}")
    print(f"✅ Correct Implementations: {len(audit_results['correct_implementations'])}")
    
    print("\n🏗️ Key Implementation Status:")
    for impl_name, impl_data in audit_results['implementation_status'].items():
        status_icon = {"fully_implemented": "✅", "partially_implemented": "⚠️", "not_found": "❌"}.get(impl_data['status'], "❓")
        print(f"{status_icon} {impl_name}: {impl_data['status']}")
    
    # Overall assessment
    overall_score = (audit_results['compliance_score'] + audit_results.get('implementation_score', 0)) / 2
    
    if overall_score >= 90:
        print("\n🎉 AUDIT RESULT: TigerBeetle architecture is properly implemented!")
    elif overall_score >= 70:
        print("\n⚠️ AUDIT RESULT: Good progress, minor issues remain")
    else:
        print("\n🔧 AUDIT RESULT: Implementation in progress, more work needed")
    
    return audit_results

if __name__ == "__main__":
    main()

