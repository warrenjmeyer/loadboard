import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// Dev only: the preview's "Laptop database" data. See tools/local-db/plugin.mjs.
import { localDb } from './tools/local-db/plugin.mjs'

// Vite is the build tool. In dev it serves your files straight to the browser;
// `npm run build` compiles everything into a plain static ./dist folder, which
// is what Azure Static Web Apps publishes.
//
// base: '/' -- this WAS './', and changing it is a required part of adding the
// router, not a tidy-up.
//
// With './', the built index.html asks for ./assets/index-abc123.js, resolved
// relative to the directory of the current URL. At / that is /assets/... and
// everything works. Open the deep link /settlements/JSMITH and the browser
// resolves it against /settlements/, asks for /settlements/assets/index-...js,
// and gets the SPA fallback -- index.html, with a 200 and a text/html
// content-type where a script was expected. The tab renders blank and the only
// clue is a console line about an unexpected MIME type.
//
// '/' makes the paths absolute, so they are the same from any depth.
//
// The other half of this is public/staticwebapp.config.json: navigationFallback
// rewrites unmatched paths to /index.html, because /settlements/JSMITH is not a
// file on disk and Static Web Apps would otherwise 404 before React ever runs.
// It already excludes /assets/* -- that exclusion is what makes a genuinely
// missing bundle 404 honestly instead of silently returning HTML.

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
//
// TWO POSTS ARE LET THROUGH: signing in and signing out. They write a session
// row, not freight, and without them the dev server could never read anything
// a role guards -- the Get Me Home planner's live data is GeoTab hours, which
// only a dispatcher may see. The proxy strips the Domain Azure adds to the
// session cookie (see cookieDomainRewrite below), so it lands on localhost,
// and the browser hands it back on every GET.
// Register, verify, forgot and reset stay refused: they create accounts and
// send email, which is a write to somebody's inbox.
// ---------------------------------------------------------------------------
const DEV_ALLOWED_POSTS = new Set(['/api/login', '/api/logout'])

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
        // Compared without the query string, and only for POST.
        const isSession = req.method === 'POST' && DEV_ALLOWED_POSTS.has(req.url.split('?')[0])
        if (explicitTarget || !isApi || isRead || isSession) return next()

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
  plugins: [react(), refuseDevWrites(), localDb()],
  base: '/',

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
    // Listen on both IP stacks. Vite otherwise binds "localhost", which Node
    // resolves to ::1 alone on Windows -- so http://localhost:5173 works while
    // http://127.0.0.1:5173 is refused outright, with nothing listening on the
    // IPv4 address at all. Chrome papers over the difference for the hostname;
    // anything pinned to the numeric address does not, which covers pasted
    // links, Postman, WSL, and `netstat -p tcp` when you go looking for why.
    host: true,

    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        // Strip the Domain from every cookie on the way back. The API's own
        // code sets none, but the deployed response arrives with
        // `domain=wonderful-tree-...azurestaticapps.net` added by Azure -- and a
        // browser on localhost silently discards a cookie that names another
        // host. Signing in then "worked", answered 200, and left nobody
        // signed in. With no Domain the cookie is localhost's own.
        cookieDomainRewrite: { '*': '' },
      },

      // /.auth is served by Static Web Apps itself, not by our function, so
      // it needs proxying for the same reason /api does -- otherwise
      // /.auth/me returns the SPA fallback and the page cannot tell whether
      // anyone is signed in.
      //
      // Proxying it does not sign you in on localhost: a cookie from the
      // deployed origin is never sent to a different host. /.auth is the
      // PLATFORM's login (GitHub), and stays signed out here. The app's own
      // login is different -- POST /api/login through the proxy, which
      // refuseDevWrites lets past, sets lb_session on localhost itself.
      '/.auth': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})
