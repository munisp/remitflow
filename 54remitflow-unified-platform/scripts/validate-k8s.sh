#!/bin/bash
# Kubernetes Manifest Validation Script
# Validates all Kubernetes manifests in the HA components directory

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
HA_COMPONENTS_DIR="$PROJECT_ROOT/infrastructure/ha-components"
REPORT_FILE="$PROJECT_ROOT/documentation/test-results/k8s-validation-report.md"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
TOTAL_FILES=0
VALID_FILES=0
INVALID_FILES=0
WARNINGS=0

echo "=========================================="
echo "Kubernetes Manifest Validation"
echo "=========================================="
echo ""

# Create report directory if it doesn't exist
mkdir -p "$(dirname "$REPORT_FILE")"

# Start report
cat > "$REPORT_FILE" << EOF
# Kubernetes Manifest Validation Report

**Generated:** $(date -u +"%Y-%m-%d %H:%M:%S UTC")
**Validated Directory:** infrastructure/ha-components/

## Summary

EOF

# Function to validate YAML syntax
validate_yaml_syntax() {
    local file="$1"
    if python3 -c "import yaml; yaml.safe_load_all(open('$file'))" 2>/dev/null; then
        return 0
    else
        return 1
    fi
}

# Function to check for required fields in Kubernetes manifests
check_k8s_required_fields() {
    local file="$1"
    local has_api_version=$(grep -c "^apiVersion:" "$file" 2>/dev/null || echo "0")
    local has_kind=$(grep -c "^kind:" "$file" 2>/dev/null || echo "0")
    local has_metadata=$(grep -c "^metadata:" "$file" 2>/dev/null || echo "0")
    
    if [[ "$has_api_version" -gt 0 && "$has_kind" -gt 0 && "$has_metadata" -gt 0 ]]; then
        return 0
    else
        return 1
    fi
}

# Function to check for security best practices
check_security_practices() {
    local file="$1"
    local warnings=""
    
    # Check for runAsRoot
    if grep -q "runAsUser: 0" "$file" 2>/dev/null; then
        warnings+="- Running as root (runAsUser: 0)\n"
    fi
    
    # Check for privileged containers
    if grep -q "privileged: true" "$file" 2>/dev/null; then
        warnings+="- Privileged container detected\n"
    fi
    
    # Check for hostNetwork
    if grep -q "hostNetwork: true" "$file" 2>/dev/null; then
        warnings+="- Using host network\n"
    fi
    
    echo -e "$warnings"
}

# Function to check for HA best practices
check_ha_practices() {
    local file="$1"
    local warnings=""
    
    # Check for replicas > 1 for Deployments/StatefulSets
    if grep -q "kind: Deployment\|kind: StatefulSet" "$file" 2>/dev/null; then
        local replicas=$(grep "replicas:" "$file" | head -1 | awk '{print $2}')
        if [[ -n "$replicas" && "$replicas" -lt 2 ]]; then
            warnings+="- Single replica (replicas: $replicas) - consider HA\n"
        fi
    fi
    
    # Check for PodDisruptionBudget
    if grep -q "kind: Deployment\|kind: StatefulSet" "$file" 2>/dev/null; then
        if ! grep -q "kind: PodDisruptionBudget" "$file" 2>/dev/null; then
            warnings+="- No PodDisruptionBudget defined in same file\n"
        fi
    fi
    
    # Check for resource limits
    if grep -q "containers:" "$file" 2>/dev/null; then
        if ! grep -q "limits:" "$file" 2>/dev/null; then
            warnings+="- No resource limits defined\n"
        fi
    fi
    
    echo -e "$warnings"
}

# Validate all YAML files in HA components
echo "Validating Kubernetes manifests..."
echo ""

# Find all YAML files
while IFS= read -r -d '' file; do
    TOTAL_FILES=$((TOTAL_FILES + 1))
    relative_path="${file#$PROJECT_ROOT/}"
    
    echo -n "Validating: $relative_path ... "
    
    # Check YAML syntax
    if ! validate_yaml_syntax "$file"; then
        echo -e "${RED}INVALID (YAML syntax error)${NC}"
        INVALID_FILES=$((INVALID_FILES + 1))
        echo "| $relative_path | INVALID | YAML syntax error |" >> "$REPORT_FILE.tmp"
        continue
    fi
    
    # Check required Kubernetes fields
    if ! check_k8s_required_fields "$file"; then
        echo -e "${YELLOW}WARNING (missing required fields)${NC}"
        WARNINGS=$((WARNINGS + 1))
        VALID_FILES=$((VALID_FILES + 1))
        echo "| $relative_path | WARNING | Missing apiVersion/kind/metadata |" >> "$REPORT_FILE.tmp"
        continue
    fi
    
    # Check security practices
    security_warnings=$(check_security_practices "$file")
    
    # Check HA practices
    ha_warnings=$(check_ha_practices "$file")
    
    if [[ -n "$security_warnings" || -n "$ha_warnings" ]]; then
        echo -e "${YELLOW}VALID (with warnings)${NC}"
        WARNINGS=$((WARNINGS + 1))
        VALID_FILES=$((VALID_FILES + 1))
        echo "| $relative_path | VALID | Has warnings |" >> "$REPORT_FILE.tmp"
    else
        echo -e "${GREEN}VALID${NC}"
        VALID_FILES=$((VALID_FILES + 1))
        echo "| $relative_path | VALID | - |" >> "$REPORT_FILE.tmp"
    fi
    
done < <(find "$HA_COMPONENTS_DIR" -name "*.yaml" -o -name "*.yml" -print0 2>/dev/null)

# Complete the report
cat >> "$REPORT_FILE" << EOF
| Metric | Count |
|--------|-------|
| Total Files | $TOTAL_FILES |
| Valid Files | $VALID_FILES |
| Invalid Files | $INVALID_FILES |
| Files with Warnings | $WARNINGS |

## Validation Results

| File | Status | Notes |
|------|--------|-------|
EOF

if [[ -f "$REPORT_FILE.tmp" ]]; then
    cat "$REPORT_FILE.tmp" >> "$REPORT_FILE"
    rm "$REPORT_FILE.tmp"
fi

cat >> "$REPORT_FILE" << EOF

## Validation Checks Performed

1. **YAML Syntax Validation** - Ensures valid YAML structure
2. **Required Fields Check** - Verifies apiVersion, kind, and metadata presence
3. **Security Best Practices** - Checks for:
   - Running as root
   - Privileged containers
   - Host network usage
4. **HA Best Practices** - Checks for:
   - Multiple replicas
   - PodDisruptionBudget presence
   - Resource limits

## Recommendations

- All manifests should have resource limits defined
- Use PodDisruptionBudgets for critical services
- Avoid running containers as root unless necessary
- Use NetworkPolicies to restrict traffic

---
*Report generated by validate-k8s.sh*
EOF

echo ""
echo "=========================================="
echo "Validation Complete"
echo "=========================================="
echo ""
echo -e "Total Files:    $TOTAL_FILES"
echo -e "Valid Files:    ${GREEN}$VALID_FILES${NC}"
echo -e "Invalid Files:  ${RED}$INVALID_FILES${NC}"
echo -e "Warnings:       ${YELLOW}$WARNINGS${NC}"
echo ""
echo "Report saved to: $REPORT_FILE"

# Exit with error if any invalid files
if [[ $INVALID_FILES -gt 0 ]]; then
    exit 1
fi

exit 0
