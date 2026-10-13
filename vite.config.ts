import { svelte } from '@sveltejs/vite-plugin-svelte'
import { execSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// The GitHub token lives in this origin's storage, so the built app may load nothing from other
// origins and may talk only to itself and api.github.com. Build only: the dev server uses inline scripts.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://api.github.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

const contentSecurityPolicy = (): Plugin => ({
  name: 'karticky-csp',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY }, injectTo: 'head-prepend' },
  ],
})

function buildCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'local'
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/karticky/',
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    __BUILD_COMMIT__: JSON.stringify(buildCommit()),
  },
  plugins: [
    svelte(),
    contentSecurityPolicy(),
    VitePWA({
      // 'prompt' never activates a new version while the app is open. We never show the prompt,
      // so the waiting version takes over the next time the app is launched.
      registerType: 'prompt',
      injectRegister: 'script',
      manifest: {
        id: '/karticky/',
        name: 'Kartičky',
        short_name: 'Kartičky',
        description: 'Czech vocabulary flashcards',
        lang: 'en',
        start_url: '/karticky/',
        scope: '/karticky/',
        display: 'standalone',
        // Chrome on Android colours an installed app's navigation bar from the manifest, which has no
        // dark variant; dark values avoid a white bar under the dark theme. index.html sets the page's own colour.
        theme_color: '#14171b',
        background_color: '#14171b',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
