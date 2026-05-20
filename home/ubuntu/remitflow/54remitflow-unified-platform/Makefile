# Production Readiness Baseline (PRB) v1 Verification
# Run `make verify` to check all production readiness criteria

.PHONY: verify verify-quick verify-no-credentials verify-no-mocks verify-no-todos verify-python-compile verify-docker-builds verify-pwa-build verify-persistence

# Full verification (all checks including Docker builds)
verify: verify-no-credentials verify-no-mocks verify-no-todos verify-python-compile verify-pwa-build verify-persistence
	@echo ""
	@echo "=========================================="
	@echo "PRB v1 VERIFICATION: ALL CHECKS PASSED"
	@echo "=========================================="

# Quick verification (no Docker builds - faster for local dev)
verify-quick: verify-no-credentials verify-no-mocks verify-no-todos verify-python-compile verify-pwa-build verify-persistence
	@echo ""
	@echo "=========================================="
	@echo "PRB v1 QUICK VERIFICATION: ALL CHECKS PASSED"
	@echo "=========================================="

# Individual verification targets
verify-no-credentials:
	@./scripts/verify_no_credentials.sh

verify-no-mocks:
	@./scripts/verify_no_mocks.sh

verify-no-todos:
	@./scripts/verify_no_todos.sh

verify-python-compile:
	@./scripts/verify_python_compile.sh

verify-docker-builds:
	@./scripts/verify_docker_builds.sh

verify-pwa-build:
	@./scripts/verify_pwa_build.sh

verify-persistence:
	@./scripts/verify_persistence.sh

# Help target
help:
	@echo "PRB v1 Verification Targets:"
	@echo "  make verify           - Run all verification checks"
	@echo "  make verify-quick     - Run all checks except Docker builds"
	@echo "  make verify-no-credentials - Check for hardcoded credentials"
	@echo "  make verify-no-mocks  - Check for mock functions in production"
	@echo "  make verify-no-todos  - Check for TODO/FIXME placeholders"
	@echo "  make verify-python-compile - Verify Python compilation"
	@echo "  make verify-docker-builds - Verify Dockerfile builds"
	@echo "  make verify-pwa-build - Verify PWA build"
	@echo "  make verify-persistence - Verify database persistence config"
