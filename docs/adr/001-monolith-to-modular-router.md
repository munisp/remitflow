# ADR-001: Split Monolith Router into Domain Modules

## Status
Accepted

## Context
`server/routers.ts` grew to 6,500+ lines — the single largest file in the codebase. It contains inline route handlers mixed with router imports, business logic, FX rate fetching, and utility functions. This makes it:
- Hard to navigate and review
- Prone to merge conflicts (every feature touches the same file)
- Impossible to test individual domains in isolation
- Slow for IDE indexing and type checking

## Decision
Keep `server/routers.ts` as a thin orchestration file that only:
1. Imports domain routers
2. Composes them into `appRouter`
3. Exports `AppRouter` type

All business logic moves into domain-specific files under `server/routers/`:
- `server/routers/transferLimits.ts` — corridor/tier transfer limits
- `server/routers/rateLock.ts` — FX rate locking
- `server/routers/doubleEntry.ts` — double-entry bookkeeping
- `server/routers/receiptGeneration.ts` — transfer receipts

## Consequences
- **Better**: Each domain can be tested independently
- **Better**: Merge conflicts are reduced (files are smaller)
- **Better**: IDE performance improves
- **Trade-off**: More files to navigate (mitigated by clear naming)
- **Trade-off**: Need to update imports when adding new domains
