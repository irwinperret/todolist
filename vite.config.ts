import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'TO DO LIST',
        short_name: 'TO DO LIST',
        start_url: '/',
        display: 'standalone',
        background_color: '#f9fafb',
        theme_color: '#111827',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      workbox: {
        // Take over immediately on update instead of waiting for every tab
        // to close, so new deploys actually reach the phone promptly.
        skipWaiting: true,
        clientsClaim: true,
        // Precache the whole app shell (HTML/JS/CSS) so it opens instantly
        // with no signal, like a native app.
        globPatterns: ['**/*.{js,css,html,svg,ico,png}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Cache Supabase REST reads so previously loaded data (tasks,
            // meetings, lists) is still visible with no connection. Writes
            // (POST/PATCH/DELETE) are handled separately by the offline
            // queue in src/lib/supabase.ts, not by the service worker.
            urlPattern: ({ url, request }) =>
              url.hostname.endsWith('.supabase.co') && request.method === 'GET',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-reads',
              networkTimeoutSeconds: 4,
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
      },
    }),
  ],
})
