# RemitFlow — Quality Assurance Suite

Comprehensive QA framework ensuring **accuracy, security, and guaranteed fund delivery** for the RemitFlow financial platform.

## Quick Start

```bash
# Run everything locally
make -f qa/Makefile all

# Run specific suite
make -f qa/Makefile security
make -f qa/Makefile load BASE_URL=https://staging.remitflow.io
make -f qa/Makefile compliance
```

## Suite Overview

| Suite | Purpose | Frequency | CI Job |
|-------|---------|-----------|--------|
| **Unit Tests** | tRPC endpoint correctness, business logic | Every PR | `qa-pipeline / unit-tests` |
| **Security Scan** | OWASP Top 10, dependency vulns, contract audit | Every PR | `qa-pipeline / security` |
| **Load Testing** | 10K concurrent users, p95 < 500ms | Nightly | `qa-pipeline / load-testing` |
| **Soak Testing** | 30-min sustained load, memory leak detection | Nightly | `nightly-soak` |
| **Financial Reconciliation** | Zero discrepancy tolerance on money flow | Nightly + Every PR | `qa-pipeline / load-testing` |
| **Chaos Engineering** | Service kill, network partition, DB exhaust | Nightly | `qa-pipeline / chaos-engineering` |
| **Disaster Recovery** | PG backup/restore, Redis rebuild, full restore | Weekly | `qa-pipeline / disaster-recovery` |
| **Compliance** | CBN, FCA, FATF, PCI-DSS regulatory checks | Every PR | `qa-pipeline / compliance` |
| **Canary Verification** | Pre-promotion health + latency + ledger check | Every deploy | `deploy-gate / deploy` |

## Architecture

```
qa/
├── Makefile                        # Local runner (make -f qa/Makefile <target>)
├── README.md                       # This file
├── load-testing/
│   ├── k6-transfer-load.js        # 10K user load test
│   ├── k6-api-soak.js             # 30-min soak test
│   └── k6-financial-reconciliation.js  # Money integrity validation
├── security/
│   ├── owasp-api-scan.sh          # OWASP API Top 10
│   ├── dependency-audit.sh        # npm/cargo/pip/go vulnerability scan
│   ├── smart-contract-audit.sh    # Slither + Mythril
│   └── results/                   # Scan outputs (gitignored)
├── chaos-engineering/
│   ├── chaos-runner.sh            # Service kill, network, memory chaos
│   └── results/
├── disaster-recovery/
│   ├── dr-test-suite.sh           # PG backup, TB snapshot, Redis rebuild
│   ├── backups/                   # Test backups (gitignored)
│   └── results/
├── regulatory-sandbox/
│   ├── compliance-test-suite.sh   # CBN/FCA/FATF/PCI-DSS
│   └── results/
└── canary/
    ├── canary-deploy.yaml         # Argo Rollouts config
    ├── canary-verify.sh           # Pre-promotion verification
    └── results/
```

## CI/CD Integration

### GitHub Actions Workflows

| Workflow | Trigger | Duration |
|----------|---------|----------|
| `qa-pipeline.yml` | Push, PR, nightly, manual | ~15 min |
| `nightly-soak.yml` | 3am UTC daily | ~35 min |
| `deploy-gate.yml` | Manual (pre-deploy) | ~10 min |

### Running in CI

All scripts are self-contained and exit with appropriate codes:
- `exit 0` = passed
- `exit 1` = failed (blocks deployment)

Scripts produce JSON reports in their respective `results/` directories for artifact collection.

### Thresholds

| Metric | Threshold | Enforcement |
|--------|-----------|-------------|
| p95 latency | < 500ms | k6 threshold (hard fail) |
| Error rate | < 1% | k6 threshold (hard fail) |
| Financial discrepancies | 0 | k6 threshold (zero tolerance) |
| Critical npm vulns | 0 | Security gate (hard fail) |
| Compliance failures | 0 | Compliance gate (hard fail) |
| Ledger imbalance | 0 | Canary analysis (instant rollback) |

## Financial Integrity Guarantees

1. **Double-Entry Verification**: Every debit has a matching credit (TigerBeetle)
2. **Reconciliation Tests**: Automated checks that `sum(debits) == sum(credits)`
3. **Swap Symmetry**: Forward rate × reverse rate ≈ 1 (within spread)
4. **Batch Totals**: Sum of recipients = reported total (zero tolerance)
5. **Fee Accuracy**: Calculated fees match quoted fees exactly
6. **Settlement Matching**: Payout amounts match expected after FX conversion

## Adding New Tests

1. Create script in appropriate directory
2. Make it executable and self-contained (accepts `BASE_URL` parameter)
3. Exit with code 1 on failure
4. Write JSON report to `results/` directory
5. Add Makefile target
6. Add to appropriate CI workflow job
