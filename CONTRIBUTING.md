# Contributing to RemitFlow

Thank you for contributing! This guide covers our development workflow, code standards, and how to submit changes.

## Development Setup

```bash
# Prerequisites: Node.js 22+, pnpm 10+, PostgreSQL 16+
pnpm install
cp .env.example .env  # Configure DATABASE_URL, JWT_SECRET, etc.
pnpm db:push           # Push schema to database
pnpm dev               # Start dev server at http://localhost:3000
```

## Code Style

- **TypeScript strict mode** — `npx tsc --noEmit` must pass with 0 errors
- **React** — Functional components only, hooks for state management
- **Tailwind CSS** — Use design tokens from `index.css`, prefer shadcn/ui components
- **tRPC** — All API calls must be type-safe via tRPC. No raw fetch() for backend calls
- **i18n** — All user-facing strings must use `useTranslation()` from react-i18next
- **Error handling** — All tRPC queries must have `onError` handlers. All pages must show loading states
- **Imports** — Use `@/` alias for client imports. Keep imports organized: React → third-party → local

## File Structure

```
client/src/
  pages/          # 317 route pages (one per route)
  components/     # Shared UI components
  hooks/          # Custom React hooks
  lib/            # Utilities (trpc, haptics, currency, etc.)
  contexts/       # React contexts (Theme, Auth)
  i18n/           # Translation files (14 languages)
server/
  _core/          # Express app, middleware, logger
  routers/        # tRPC routers (72 modules)
  routers.ts      # Main router aggregation
  db.ts           # Drizzle ORM configuration
  security.middleware.ts  # OWASP Top 10 security middleware
drizzle/
  schema.ts       # Database schema (Drizzle tables)
  migrations/     # SQL migration files
services/         # Polyglot microservices (Go, Rust, Python)
```

## Branch Naming

- `feature/` — New features
- `fix/` — Bug fixes
- `chore/` — Maintenance, refactoring
- `docs/` — Documentation only

## Commit Messages

Use conventional commits:
```
feat: add delivery speed options to send flow
fix: dashboard showing undefined NaN for transactions
chore: consolidate docker-compose files
docs: add architecture diagram to README
```

## Pull Request Process

1. Create a feature branch from `main`
2. Write/update tests for your changes
3. Ensure all checks pass:
   - `npx tsc --noEmit` (TypeScript)
   - `pnpm test` (Vitest)
   - No console errors in browser
4. Update documentation if adding new features
5. Request review from at least one team member
6. Squash and merge after approval

## Testing

```bash
pnpm test                    # Run all tests
pnpm test --run --reporter=verbose  # Verbose output
pnpm test -- path/to/test    # Run specific test
```

### Test Categories
- **Unit tests** — `server/*.test.ts` (tRPC router tests)
- **Smoke tests** — `server/smoke*.test.ts` (API endpoint verification)
- **Load tests** — `tests/k6/` (k6 performance tests)

## Database Changes

1. Edit `drizzle/schema.ts` to add/modify tables
2. Run `pnpm db:push` to apply changes (development)
3. For production: create a migration file in `drizzle/migrations/`

## Security

- Never commit secrets or credentials
- Use environment variables for all sensitive values
- All admin routes require RBAC verification
- Stack traces are stripped in production responses
- CSP headers are enforced via Helmet middleware

## i18n

When adding user-facing text:
1. Add the English key to `client/src/i18n/en.json`
2. Use `t('key')` in the component
3. Add translations for all 14 supported languages:
   EN, ES, FR, PT, AR, YO, IG, HA, PCM, SW, AM, AK, WO, FF
