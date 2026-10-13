// Generates the app icons from public/icon.svg. Run `npm run icons` after changing the SVG,
// then commit the PNG and ICO files it writes to public/.
import { defineConfig } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  preset: {
    transparent: { sizes: [64, 192, 512], favicons: [[48, 'favicon.ico']] },
    maskable: { sizes: [512], padding: 0.18, resizeOptions: { background: '#2f5d8a' } },
    apple: { sizes: [] },
  },
  images: ['public/icon.svg'],
})
