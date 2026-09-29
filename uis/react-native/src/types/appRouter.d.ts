/**
 * AppRouter type placeholder for THIS package's standalone type-check.
 *
 * The app previously did `import type { AppRouter } from '../../../../server/routers'`.
 * That pulls the entire server source graph (drizzle, express, kafkajs, …)
 * into this package's `tsc` program; the server's dependencies are not
 * installed for this package and the graph does not compile under the RN
 * compiler options (6,575 errors, none of them in mobile code).
 *
 * The type-only import is also a runtime hazard waiting to happen: one stray
 * non-`type` import of server code would bundle Node-only modules into the
 * mobile app.
 *
 * Trade-off (honest): procedure input/output types are NOT checked in this
 * package — trpc call sites are effectively `any`. End-to-end procedure
 * types are enforced by the server package's own type-check. If the repo
 * later adopts a shared typed-router package (e.g. a generated
 * `AppRouter` .d.ts published for mobile), restore the strong type here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AppRouter = any;
