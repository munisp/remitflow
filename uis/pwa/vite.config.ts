import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'Nigerian Remittance Platform',
        short_name: 'Remittance',
        description: 'Send money across Africa securely',
        theme_color: '#1a56db',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // PERF (wave14): precache narrowed to the app shell only — the
        // previous '**/*.{js,css,...}' glob precached EVERY lazy route chunk
        // (~1.15 MB / 67 entries) on SW install, most of it never visited.
        // Now: entry HTML/JS/CSS, the eager vendor chunks, and the
        // self-hosted font. Lazy route chunks stay network-only (no runtime
        // caching per the CLI-004 security note below).
        globPatterns: [
          'index.html',
          'assets/index-*.js',
          'assets/index-*.css',
          'assets/react-vendor-*.js',
          'assets/i18n-*.js',
          'assets/trpc-*.js',
          'fonts/*.woff2',
          '*.{ico,png,svg,webmanifest}',
        ],
        // SECURITY (CLI-004): no runtimeCaching for API responses.
        // The previous NetworkFirst rule cached ALL authenticated
        // api.remittance.com responses (balances, transactions, PII, KYC
        // status) in Cache Storage for 24h, readable after logout by any
        // script on the origin or another user on a shared device. Only
        // static build assets (globPatterns above) are precached; API
        // traffic always goes to the network and honors the server's
        // Cache-Control headers.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // PERF (wave14): maps are still generated for debugging but no
    // `//# sourceMappingURL` comment is shipped ('hidden'), so browsers do
    // not fetch multi-MB .map files in production.
    sourcemap: 'hidden',
    // es2020: native async/await + optional chaining — less downlevel
    // transform, smaller output, still covers all supported PWA targets.
    target: 'es2020',
    rollupOptions: {
      output: {
        // Groups verified against actual imports (grep over src/):
        // - forms group from the audit is intentionally absent:
        //   react-hook-form and @hookform/resolvers have ZERO importers in
        //   this app, so the chunk would be empty.
        // - map: maplibre-gl is imported only by OperationsMap, and is
        //   currently dead-code-eliminated when VITE_MAP_STYLE_URL is unset;
        //   the group is kept so a configured build splits it out of the
        //   OperationsMap route chunk automatically.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          i18n: ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
          trpc: [
            '@trpc/client',
            '@trpc/react-query',
            '@tanstack/react-query',
            'superjson',
          ],
          map: ['maplibre-gl'],
        },
      },
    },
  },
});
