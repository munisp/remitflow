#!/usr/bin/env node
/**
 * generate-approuter-types.mjs
 *
 * Emits a STRUCTURAL AppRouter type for the React Native client so that
 * calling a non-existent ("phantom") tRPC procedure is a COMPILE ERROR in
 * uis/react-native. Until this existed, RN's `trpc` client was `any`-typed
 * (see git history of uis/react-native/src/types/appRouter.d.ts) and stale
 * procedure names never failed typecheck.
 *
 * Why structural (Path B) instead of `tsc --emitDeclarationOnly` over the
 * server (Path A): declaration emit over the full server graph
 * (server/routers.ts ~7.9k lines + ~400 router modules + drizzle + zod v4
 * inference) does not complete within the sandbox's practical execution
 * limits, and the emitted tree would drag server-only type dependencies
 * into the mobile package. This generator reads a checked-in audit snapshot
 * of the server router registry instead:
 *
 *   input : scripts/routers.snapshot.json
 *           (copy of the routers.json audit of server/routers.ts @ bdc-integration;
 *            refresh by re-running the audit and re-copying)
 *   output: uis/react-native/src/types/appRouter.d.ts
 *
 * Fidelity contract:
 *   - procedure NAMES and query/mutation KIND are checked (phantom calls and
 *     wrong-hook-kind calls are compile errors);
 *   - inputs are typed `unknown` and outputs `unknown` at the contract level
 *     (AppRouter); the RN hook surface (AppRouterHooks) intentionally widens
 *     call signatures to `(...args: any[]) => any` because the snapshot does
 *     not record input/output schemas — arg-shape and payload-field checking
 *     remain the server package's job (`npm run check` at repo root);
 *   - legacy-gated routers (LEGACY_FEATURE_PACKS_ENABLED mount at
 *     server/routers.ts:~487, OFF by default) are emitted in a separate
 *     DO-NOT-USE section that is NOT part of AppRouter, so calling them is a
 *     compile error.
 *
 * Usage: npm run gen:approuter-types
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SNAPSHOT = join(HERE, 'routers.snapshot.json');
const OUT = join(ROOT, 'uis/react-native/src/types/appRouter.d.ts');

const LEGACY_KIND = 'conditional:LEGACY_PACKS_ENABLED';
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const audit = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));

/** Registration kinds that are actually mounted on appRouter. */
const isMounted = (r) => r.registration != null;
const isLegacy = (r) => r.registration != null && r.registration.kind === LEGACY_KIND;

const keyOf = (name) => (IDENT.test(name) ? name : JSON.stringify(name));

/**
 * Build a nested tree: { [ns]: { ... , '': [{name,type}] } } from dotted
 * procedure names ("travelRule.checkThreshold" -> travelRule -> checkThreshold).
 * '(root)' router procedures become top-level leaves.
 */
function buildTree(routers) {
  const root = { children: new Map(), procs: [] };
  for (const r of routers) {
    const base = r.router === '(root)' ? root : getChild(root, r.router);
    for (const p of r.procedures) {
      const parts = p.name.split('.');
      let node = base;
      for (const seg of parts.slice(0, -1)) node = getChild(node, seg);
      node.procs.push({ name: parts[parts.length - 1], type: p.type });
    }
  }
  return root;
}

function getChild(node, name) {
  if (!node.children.has(name)) node.children.set(name, { children: new Map(), procs: [] });
  return node.children.get(name);
}

function assertNoCollisions(node, path) {
  for (const [name, child] of node.children) {
    if (node.procs.some((p) => p.name === name)) {
      throw new Error(`Snapshot collision: "${[...path, name].join('.')}" is both a procedure and a namespace`);
    }
    assertNoCollisions(child, [...path, name]);
  }
}

function emitTree(node, indent) {
  const pad = '  '.repeat(indent);
  const lines = [];
  for (const p of [...node.procs].sort((a, b) => a.name.localeCompare(b.name))) {
    const t = p.type === 'mutation' ? 'M' : p.type === 'query' ? 'Q' : null;
    if (!t) throw new Error(`Unsupported procedure type "${p.type}" in snapshot`);
    lines.push(`${pad}${keyOf(p.name)}: ${t};`);
  }
  for (const [name, child] of [...node.children].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${pad}${keyOf(name)}: {`);
    lines.push(...emitTree(child, indent + 1));
    lines.push(`${pad}};`);
  }
  return lines;
}

function emitLegacyTree(node, indent) {
  const pad = '  '.repeat(indent);
  const lines = [];
  for (const p of [...node.procs].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`${pad}/** LEGACY — never mounted by default. DO NOT USE. */`);
    lines.push(`${pad}${keyOf(p.name)}: never;`);
  }
  for (const [name, child] of [...node.children].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${pad}${keyOf(name)}: {`);
    lines.push(...emitLegacyTree(child, indent + 1));
    lines.push(`${pad}};`);
  }
  return lines;
}

const mounted = audit.filter((r) => isMounted(r) && !isLegacy(r));
const legacy = audit.filter(isLegacy);
const mountedTree = buildTree(mounted);
const legacyTree = buildTree(legacy);
assertNoCollisions(mountedTree, []);
assertNoCollisions(legacyTree, []);

const mountedProcCount = mounted.reduce((n, r) => n + r.procedures.length, 0);
const legacyProcCount = legacy.reduce((n, r) => n + r.procedures.length, 0);

const out = `/* eslint-disable */
// GENERATED — do not hand-edit.
//
// Generated by:  node scripts/generate-approuter-types.mjs (npm run gen:approuter-types)
// Generated from: scripts/routers.snapshot.json (audit of server/routers.ts @ bdc-integration)
// Regenerate after ANY server router change and re-run the RN typecheck.
//
// Scope: ${mounted.length} mounted routers / ${mountedProcCount} procedures typed below.
//        ${legacy.length} legacy-gated routers / ${legacyProcCount} procedures are listed in the
//        DO-NOT-USE section at the bottom and are intentionally NOT part of
//        AppRouter (legacy packs are unmounted unless LEGACY_FEATURE_PACKS_ENABLED,
//        server/routers.ts:~487 — off by default).
//
// Fidelity: procedure names + query/mutation kind are enforced by the RN trpc
// client wiring (src/services/trpc.ts). Inputs/outputs are \`unknown\` here by
// design (the snapshot has no schema info); arg-shape drift is caught by the
// server typecheck, not the mobile one. See scripts/generate-approuter-types.mjs
// for why this is structural rather than a tsc-emitted server declaration.

import type {
  MutationProcedure,
  QueryProcedure,
  TRPCBuiltRouter,
} from '@trpc/server';

interface ProcDef {
  meta: unknown;
  input: unknown;
  output: unknown;
}
type Q = QueryProcedure<ProcDef>;
type M = MutationProcedure<ProcDef>;

/** Mirror of the server's mounted procedure tree (record shape). */
export type AppRouterRecord = {
${emitTree(mountedTree, 1).join('\n')}
};

/** Structural AppRouter: satisfies tRPC v11's \`AnyRouter\` constraint. */
export type AppRouter = TRPCBuiltRouter<any, AppRouterRecord>;

// ── RN hook surface ──────────────────────────────────────────────────────────
// The snapshot carries no input/output schemas, so the hook surface widens
// every hook to \`(...args: any[]) => any\` while KEEPING the procedure tree
// (names + query/mutation kind) exact. Net effect at call sites:
//   trpc.<realNs>.<realProc>.useQuery(...)   -> compiles
//   trpc.<realNs>.<phantom>.useQuery(...)    -> COMPILE ERROR
//   trpc.<mutation>.useQuery(...)            -> COMPILE ERROR (wrong kind)
//   trpc.<legacyNs>....                      -> COMPILE ERROR (not mounted)

type AnyHook = (...args: any[]) => any;

export interface TrpcQueryHooks {
  useQuery: AnyHook;
  useSuspenseQuery: AnyHook;
  useInfiniteQuery: AnyHook;
  useSuspenseInfiniteQuery: AnyHook;
}

export interface TrpcMutationHooks {
  useMutation: AnyHook;
}

type HooksOf<T> = T extends Q
  ? TrpcQueryHooks
  : T extends M
    ? TrpcMutationHooks
    : { [K in keyof T]: HooksOf<T[K]> };

/** Procedure tree mapped to hook bags; intersected with the real tRPC base
 * (Provider, createClient, useUtils, …) in src/services/trpc.ts. */
export type AppRouterHooks = HooksOf<AppRouterRecord>;

// ────────────────────────────────────────────────────────────────────────────
// LEGACY-GATED ROUTERS — DO NOT USE.
// Mounted only when LEGACY_FEATURE_PACKS_ENABLED=true (off by default).
// Listed for audit completeness only; every leaf is \`never\` and this type is
// not referenced by AppRouter or AppRouterHooks.
export type LegacyAppRouter_DO_NOT_USE = {
${emitLegacyTree(legacyTree, 1).join('\n')}
};
`;

writeFileSync(OUT, out);
console.log(
  `gen:approuter-types -> wrote ${OUT}\n` +
    `  mounted: ${mounted.length} routers, ${mountedProcCount} procedures\n` +
    `  legacy (DO-NOT-USE section): ${legacy.length} routers, ${legacyProcCount} procedures`,
);
