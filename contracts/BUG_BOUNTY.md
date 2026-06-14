# RemitFlow Bug Bounty Program

## Overview

RemitFlow operates a bug bounty program to incentivize responsible disclosure of security vulnerabilities in our smart contracts and platform infrastructure.

**Program hosted on:** [Immunefi](https://immunefi.com) (pending registration)

## Scope

### In Scope

| Asset | Type | Severity |
|-------|------|----------|
| `RemitFlowVault.sol` | Smart Contract | Critical |
| `RemitFlowEscrow.sol` | Smart Contract | Critical |
| `RemitFlowBridge.sol` | Smart Contract | Critical |
| `RemitFlowTimelock.sol` | Smart Contract | Critical |
| Liquidity Provider API (TypeScript) | Web/API | High |
| Settlement Engine (Go) | Web/API | High |
| Pool Manager (Rust) | Web/API | High |
| Analytics Service (Python) | Web/API | Medium |

### Out of Scope

- Third-party contracts (OpenZeppelin, Chainlink)
- Frontend/UI vulnerabilities (XSS, CSRF)
- Denial of service attacks
- Social engineering
- Already reported vulnerabilities
- Issues on testnet deployments

## Rewards

### Smart Contract Vulnerabilities

| Severity | Reward | Examples |
|----------|--------|---------|
| **Critical** | $50,000 – $500,000 | Direct theft of funds, permanent freezing of funds > $1M, manipulation of governance |
| **High** | $10,000 – $50,000 | Theft of unclaimed yield, temporary freezing of funds, manipulation of oracle data |
| **Medium** | $2,500 – $10,000 | Griefing attacks causing gas waste, incorrect event emissions, edge case DoS |
| **Low** | $500 – $2,500 | Informational findings, gas optimizations, code quality |

### Backend/API Vulnerabilities

| Severity | Reward | Examples |
|----------|--------|---------|
| **Critical** | $10,000 – $50,000 | Authentication bypass, unauthorized fund transfer, SQL injection in financial queries |
| **High** | $5,000 – $10,000 | Privilege escalation, rate limit bypass on financial endpoints, information disclosure of keys |
| **Medium** | $1,000 – $5,000 | IDOR on non-financial endpoints, insufficient input validation |
| **Low** | $250 – $1,000 | Information disclosure, verbose error messages |

## Rules

1. **No public disclosure** until fix is deployed and verified
2. **First reporter** gets the bounty (timestamp-based)
3. **Provide proof of concept** — reproducible exploit or test case
4. **No interaction with mainnet** — test on forks only
5. **No social engineering or phishing**
6. **Report within 24 hours** of discovery
7. **One vulnerability per report** (unless chained)

## Reporting

### Via Immunefi (Preferred)
Submit at: https://immunefi.com/bounty/remitflow (pending)

### Direct Disclosure
Email: security@remitflow.io
PGP Key: [published on keyserver]

### Report Format

```
Title: [Brief description]
Severity: [Critical/High/Medium/Low]
Asset: [Contract/API affected]
Chain: [If applicable]

## Description
[Detailed description of the vulnerability]

## Impact
[What can an attacker achieve?]

## Proof of Concept
[Step-by-step reproduction OR Foundry test case]

## Recommended Fix
[Suggested remediation]
```

## Response SLA

| Action | Timeframe |
|--------|-----------|
| Acknowledge receipt | < 24 hours |
| Initial triage | < 48 hours |
| Severity assessment | < 5 business days |
| Fix deployed (Critical) | < 48 hours |
| Fix deployed (High) | < 1 week |
| Fix deployed (Medium/Low) | < 2 weeks |
| Bounty paid | < 30 days after fix |

## Coverage Period

- **Smart Contracts:** From mainnet deployment date
- **Backend APIs:** From production launch date
- **Total Program Budget:** $500,000 (Year 1)

## Known Issues

The following are known limitations and will NOT be rewarded:

1. Mock liquidity provider returns simulated data (by design for dev/staging)
2. Hardcoded FX rates when ExchangeRate API key is not configured
3. Circle/Yellow Card clients fall back to mock when API keys are absent
4. Proof of reserves Merkle tree does not verify against actual on-chain state without Fireblocks credentials
5. Bridge validator set is managed by admin without on-chain governance vote

## Legal

- Safe harbor applies to all good-faith security research
- No legal action will be taken against researchers acting in compliance with this policy
- Researchers must not violate any applicable laws
- RemitFlow reserves the right to adjust severity classifications
