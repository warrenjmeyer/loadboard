import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite is the build tool. In dev it serves your files straight to the browser;
// `npm run build` compiles everything into a plain static ./dist folder, which
// is what Azure Static Web Apps publishes.
//
// base: './' makes the built index.html reference its assets with relative
// paths. Absolute paths ("/assets/...") also work, but relative keeps the build
// portable if you ever serve it from a subfolder. Note: this has to become '/'
// the day you add client-side routing, or a deep link like /loads/L-10412 will
// resolve ./assets against /loads/ and 404.

// Where the dev server sends /api. Defaults to the deployed app; point
// VITE_API_TARGET at http://localhost:7071 to use a local Functions host
// instead, with no code change.
const apiTarget =
  process.env.VITE_API_TARGET || 'https://wonderful-tree-0a929e80f.7.azurestaticapps.net'

export default defineConfig({
  plugins: [react()],
  base: './',

  // Dev-only. Vite serves the front end but has no /api of its own, so an
  // unproxied request falls through to the SPA fallback and returns
  // index.html -- with a 200, which is why it surfaces as a confusing JSON
  // parse error rather than a 404.
  //
  // Proxying means App.jsx calls the same same-origin '/api/loads' in dev and
  // in production. Nothing about the app's code differs between the two, and
  // there is no CORS to configure, because the browser only ever talks to the
  // origin it was served from.
  //
  // changeOrigin rewrites the Host header to the target. Azure routes on Host,
  // so without it the request arrives at Azure looking like it was meant for
  // localhost and does not reach the Function.
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})
