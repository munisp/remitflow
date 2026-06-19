# RemitFlow — QA Automation Makefile
#
# Provides convenient targets for running QA suites locally.
# All scripts are designed to be reusable in CI/CD (GitHub Actions).
#
# Usage:
#   make -f qa/Makefile help
#   make -f qa/Makefile all
#   make -f qa/Makefile security
#   make -f qa/Makefile load BASE_URL=https://staging.remitflow.io

.PHONY: help all unit security contracts load soak reconciliation chaos dr compliance canary pentest uat clean

BASE_URL ?= http://localhost:3001
K6 ?= k6

help:
	@echo "╔══════════════════════════════════════════════════════════════╗"
	@echo "║  RemitFlow QA Suite                                         ║"
	@echo "╚══════════════════════════════════════════════════════════════╝"
	@echo ""
	@echo "  make -f qa/Makefile all             Run everything"
	@echo "  make -f qa/Makefile unit            Unit + integration tests"
	@echo "  make -f qa/Makefile security        OWASP + dependency scan"
	@echo "  make -f qa/Makefile contracts       Smart contract audit"
	@echo "  make -f qa/Makefile load            k6 load test (10K users)"
	@echo "  make -f qa/Makefile soak            30-min soak test"
	@echo "  make -f qa/Makefile reconciliation  Financial reconciliation"
	@echo "  make -f qa/Makefile chaos           Chaos engineering"
	@echo "  make -f qa/Makefile dr              Disaster recovery"
	@echo "  make -f qa/Makefile compliance      Regulatory compliance"
	@echo "  make -f qa/Makefile canary          Canary verification"
	@echo "  make -f qa/Makefile clean           Remove results"
	@echo ""
	@echo "  Options:"
	@echo "    BASE_URL=<url>  Target server (default: http://localhost:3001)"
	@echo ""

all: unit security contracts load reconciliation chaos dr compliance pentest uat

unit:
	@echo "── Running Unit & Integration Tests ──"
	npx vitest run

security:
	@echo "── Running Security Suite ──"
	chmod +x qa/security/owasp-api-scan.sh qa/security/dependency-audit.sh
	./qa/security/owasp-api-scan.sh $(BASE_URL)
	./qa/security/dependency-audit.sh

contracts:
	@echo "── Running Smart Contract Audit ──"
	chmod +x qa/security/smart-contract-audit.sh
	./qa/security/smart-contract-audit.sh

load:
	@echo "── Running Load Test (10K users) ──"
	mkdir -p qa/load-testing/results
	$(K6) run qa/load-testing/k6-transfer-load.js --env BASE_URL=$(BASE_URL)

soak:
	@echo "── Running 30-min Soak Test ──"
	mkdir -p qa/load-testing/results
	$(K6) run qa/load-testing/k6-api-soak.js --env BASE_URL=$(BASE_URL)

reconciliation:
	@echo "── Running Financial Reconciliation ──"
	mkdir -p qa/load-testing/results
	$(K6) run qa/load-testing/k6-financial-reconciliation.js --env BASE_URL=$(BASE_URL)

chaos:
	@echo "── Running Chaos Engineering ──"
	chmod +x qa/chaos-engineering/chaos-runner.sh
	./qa/chaos-engineering/chaos-runner.sh all $(BASE_URL)

dr:
	@echo "── Running Disaster Recovery Tests ──"
	chmod +x qa/disaster-recovery/dr-test-suite.sh
	./qa/disaster-recovery/dr-test-suite.sh all

compliance:
	@echo "── Running Regulatory Compliance ──"
	chmod +x qa/regulatory-sandbox/compliance-test-suite.sh
	./qa/regulatory-sandbox/compliance-test-suite.sh all $(BASE_URL)

canary:
	@echo "── Running Canary Verification ──"
	chmod +x qa/canary/canary-verify.sh
	./qa/canary/canary-verify.sh $(BASE_URL)

pentest:
	@echo "── Running Authenticated Penetration Test ──"
	chmod +x qa/security/pentest-authenticated.sh
	./qa/security/pentest-authenticated.sh $(BASE_URL)

uat:
	@echo "── Running User Acceptance Tests ──"
	chmod +x qa/uat/uat-scenarios.sh
	mkdir -p qa/uat/results
	./qa/uat/uat-scenarios.sh $(BASE_URL) all

clean:
	rm -rf qa/security/results/*.json
	rm -rf qa/chaos-engineering/results/*.json
	rm -rf qa/disaster-recovery/results/*.json
	rm -rf qa/disaster-recovery/backups/*
	rm -rf qa/regulatory-sandbox/results/*.json
	rm -rf qa/canary/results/*.json
	rm -rf qa/load-testing/results/*.json
	rm -rf qa/uat/results/*.json
	@echo "Results cleaned"
