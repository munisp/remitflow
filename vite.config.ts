import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// =============================================================================
// Build Metadata — inject BUILD_HASH + BUILD_TIMESTAMP for cache busting
// Every production build gets a unique content-derived hash. The service worker
// and client-side stale-detection both key off this value.
// =============================================================================

const BUILD_TIMESTAMP = new Date().toISOString();

function generateBuildHash(): string {
  const src = path.resolve(import.meta.dirname, "uis", "pwa", "src");
  const hash = createHash("sha256");
  hash.update(BUILD_TIMESTAMP);
  try {
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(dir, entry.name));
        else if (/\.(tsx?|jsx?|css)$/.test(entry.name)) {
          hash.update(fs.readFileSync(path.join(dir, entry.name)));
        }
      }
    };
    walk(src);
  } catch { /* fallback to timestamp only */ }
  return hash.digest("hex").slice(0, 12);
}

const BUILD_HASH = generateBuildHash();

function vitePluginBuildMetadata(): Plugin {
  return {
    name: "remitflow-build-metadata",
    config(_, { command }) {
      if (command === "build") {
        return {
          define: {
            "__BUILD_HASH__": JSON.stringify(BUILD_HASH),
            "__BUILD_TIMESTAMP__": JSON.stringify(BUILD_TIMESTAMP),
          },
        };
      }
      return {
        define: {
          "__BUILD_HASH__": JSON.stringify("dev"),
          "__BUILD_TIMESTAMP__": JSON.stringify(BUILD_TIMESTAMP),
        },
      };
    },
    // Write build manifest for deployment scripts
    closeBundle() {
      const manifest = { hash: BUILD_HASH, timestamp: BUILD_TIMESTAMP, version: `v-${BUILD_HASH}` };
      const outDir = path.resolve(import.meta.dirname, "dist", "public");
      try {
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, "build-manifest.json"), JSON.stringify(manifest, null, 2));
      } catch { /* non-fatal */ }
    },
  };
}

const pwaPlugin = VitePWA({
  registerType: "autoUpdate",
  injectRegister: "auto",
  devOptions: {
    enabled: false,
  },
  manifest: {
    name: "RemitFlow — Send Money Home",
    short_name: "RemitFlow",
    description: "Send money home to family, invest in your roots, save together with your community — the app built for the diaspora.",
    theme_color: "#0f172a",
    background_color: "#0f172a",
    display: "standalone",
    orientation: "portrait-primary",
    scope: "/",
    start_url: "/",
    lang: "en",
    categories: ["finance", "money", "investment"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
    shortcuts: [
      {
        name: "Send Money",
        short_name: "Send",
        description: "Send money home to family",
        url: "/send-money",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Invest",
        short_name: "Invest",
        description: "Invest in your home country",
        url: "/beyond-remittance",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Community Savings",
        short_name: "Savings",
        description: "Save together with your community",
        url: "/community",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Family Dashboard",
        short_name: "Family",
        description: "Manage family budgets and transfers",
        url: "/family",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  },
  workbox: {
    globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
    runtimeCaching: [
      {
        urlPattern: /^\/api\/trpc\//,
        handler: "NetworkFirst",
        options: {
          cacheName: "trpc-api-cache",
          expiration: { maxEntries: 100, maxAgeSeconds: 5 * 60 },
          networkTimeoutSeconds: 60,
        },
      },
      {
        urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
        handler: "CacheFirst",
        options: {
          cacheName: "google-fonts",
          expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 },
        },
      },
      {
        urlPattern: /^\/icons\//,
        handler: "CacheFirst",
        options: {
          cacheName: "app-icons",
          expiration: { maxEntries: 20, maxAgeSeconds: 7 * 24 * 60 * 60 },
        },
      },
    ],
    navigateFallback: null,
    navigateFallbackDenylist: [/^\/api\//],
  },
});

// jsxLocPlugin has enforce:"pre" which runs before react() and prevents React Fast Refresh
// preamble injection in dev mode. Disable it in dev; it only adds JSX source location for
// production debugging and is not needed during local development.
// We detect dev mode via NODE_ENV (set to 'development' by the dev script).
const isDev = process.env.NODE_ENV !== 'production';
const plugins = [
  react(),
  ...(isDev ? [] : [jsxLocPlugin()]),
  vitePluginBuildMetadata(),
  pwaPlugin,
];
export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "uis", "pwa", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "uis", "pwa"),
  publicDir: path.resolve(import.meta.dirname, "uis", "pwa", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Content-hash filenames guarantee unique URLs per build.
        // Browsers cache these immutably; new deploys produce new hashes.
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks(id: string) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'vendor-react';
          if (id.includes('node_modules/@radix-ui')) return 'vendor-ui';
          if (id.includes('node_modules/recharts')) return 'vendor-charts';
          if (id.includes('node_modules/react-hook-form') || id.includes('node_modules/@hookform')) return 'vendor-forms';
          if (id.includes('node_modules/i18next') || id.includes('node_modules/react-i18next')) return 'vendor-i18n';
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 1000,
    sourcemap: true,
  },
  server: {
    host: true,
    allowedHosts: [
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      allow: [path.resolve(import.meta.dirname)],
      deny: ["**/.*"],
    },
  },
});
