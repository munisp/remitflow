import express, { type Express, type Request, type Response, type NextFunction } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

// ── Build Manifest ───────────────────────────────────────────────────────────
// Read once at startup; used by the /api/version endpoint and cache headers.

interface BuildManifest {
  hash: string;
  timestamp: string;
  version: string;
}

let buildManifest: BuildManifest = { hash: "dev", timestamp: new Date().toISOString(), version: "dev" };

function loadBuildManifest(distPath: string): void {
  try {
    const raw = fs.readFileSync(path.join(distPath, "build-manifest.json"), "utf-8");
    buildManifest = JSON.parse(raw);
  } catch {
    // Not a production build or manifest missing — use dev defaults
  }
}

export function getBuildManifest(): BuildManifest {
  return buildManifest;
}

// ── Content-Hash Aware Cache Headers ─────────────────────────────────────────
// Files under /assets/ contain content hashes in their filenames and are safe to
// cache immutably.  Everything else (index.html, sw.js, manifest.json) MUST
// revalidate on every request so browsers pick up new asset references.

const HASHED_ASSET_RE = /\/assets\/[^/]+-[a-f0-9]{8,}\.(js|css|woff2?|ttf|eot|png|jpg|jpeg|gif|svg|webp|avif|ico)$/;
const NEVER_CACHE_RE = /\/(sw\.js|workbox-[^.]+\.js|manifest\.json|build-manifest\.json)$/;

function cacheBustingHeaders(req: Request, res: Response, next: NextFunction): void {
  const p = req.path;

  if (HASHED_ASSET_RE.test(p)) {
    // Content-hashed files — immutable forever
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("CDN-Cache-Control", "public, max-age=31536000, immutable");
  } else if (NEVER_CACHE_RE.test(p)) {
    // Service worker & manifests — always revalidate
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.setHeader("CDN-Cache-Control", "no-cache");
  } else if (p.startsWith("/api/")) {
    // API responses — never cache in shared caches
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
  } else if (p.endsWith(".html") || p === "/") {
    // HTML documents — always revalidate to pick up new asset hashes
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.setHeader("CDN-Cache-Control", "no-cache");
  } else if (p.match(/\.(png|jpg|jpeg|gif|svg|ico|webp|avif|woff2?|ttf|eot)$/)) {
    // Non-hashed static assets (public/ files like favicon) — short cache
    res.setHeader("Cache-Control", "public, max-age=3600, must-revalidate");
  }

  next();
}

// ── Version Endpoint ─────────────────────────────────────────────────────────
// Clients poll this to detect when a new deploy has happened.

function registerVersionEndpoint(app: Express): void {
  app.get("/api/version", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(buildManifest);
  });
}

// ── Vite Dev Server ──────────────────────────────────────────────────────────

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  registerVersionEndpoint(app);
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      let page = await vite.transformIndexHtml(url, template);
      // Inject the per-request CSP nonce into every inline <script> tag that
      // Vite generates (React Fast Refresh preamble, HMR client, etc.).
      // Without this the browser's CSP blocks those inline scripts and
      // window.$RefreshReg$ is never set, causing the "can't detect preamble" error.
      const nonce: string = (res.locals as any).cspNonce || "";
      if (nonce) {
        page = page.replace(/<script((?![^>]*\bnonce=)[^>]*)>/g, `<script$1 nonce="${nonce}">`);
      }
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

// ── Production Static Server ─────────────────────────────────────────────────

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  loadBuildManifest(distPath);
  registerVersionEndpoint(app);

  // Cache busting headers BEFORE express.static so they apply to all responses
  app.use(cacheBustingHeaders);

  app.use(express.static(distPath, {
    // Let our cacheBustingHeaders middleware handle Cache-Control
    setHeaders: (res, filePath) => {
      // express.static sets its own headers — we override for hashed assets
      if (HASHED_ASSET_RE.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }));

  // fall through to index.html if the file doesn't exist (SPA routing)
  app.use("*", (_req, res) => {
    // index.html must never be cached so new deploys are picked up
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
