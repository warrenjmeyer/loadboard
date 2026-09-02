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
const explicitTarget = process.env.VITE_API_TARGET
const apiTarget = explicitTarget || 'https://wonderful-tree-0a929e80f.7.azurestaticapps.net'

// ---------------------------------------------------------------------------
// The dev server will not write to production.
//
// Reading the live database from a laptop is fine, and this repo has done it
// from the start. Writing to it is not: `npm run dev` proxies /api to the
// deployed app, so the first time you test the add form, the test load is a
// real row on the real board, added by a browser nobody deployed.
//
// So non-GET requests through the proxy are refused here, before they leave
// the machine -- unless VITE_API_TARGET was set explicitly, which is the
// deliberate act that says "I know where this is going." Point it at a local
// Functions host and writes work; point it at the deployed URL by hand and
// they work too, because at that point you have said so out loud.
//
// To exercise writes against real infrastructure without this, open a pull
// request: Static Web Apps builds it a preview environment on its own URL,
// and tearing that down is closing the PR.
// ---------------------------------------------------------------------------
function refuseDevWrites() {
  return {
    name: 'refuse-dev-writes',

    // configureServer WITHOUT returning a function installs this ahead of
    // Vite's internal middlewares -- the proxy among them. Return a function
    // instead and it runs after, which here would mean after the request had
    // already been sent to Azure.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const isApi = req.url === '/api' || req.url.startsWith('/api/')
        const isRead = req.method === 'GET' || req.method === 'HEAD'
        if (explicitTarget || !isApi || isRead) return next()

        res.statusCode = 403
        res.setHeader('Content-Type', 'application/json')
        res.end(
          JSON.stringify({
            error:
              `The dev server refuses to ${req.method} to the deployed API. ` +
              'Set VITE_API_TARGET to say where writes should go, or test them on a PR preview.',
          })
        )
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), refuseDevWrites()],
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

      // /.auth is served by Static Web Apps itself, not by our function, so
      // it needs proxying for the same reason /api does -- otherwise
      // /.auth/me returns the SPA fallback and the page cannot tell whether
      // anyone is signed in.
      //
      // Proxying it does not sign you in on localhost, and cannot: the auth
      // cookie belongs to the deployed origin and is never sent to a
      // different host. So dev shows you as signed out, always. That is the
      // same seam as the API proxy -- dev is pointed at production and only
      // production knows who you are -- and it is the other half of why
      // writes are refused above.
      '/.auth': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})
