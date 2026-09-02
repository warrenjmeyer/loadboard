// ---------------------------------------------------------------------------
// Smoke-render every page component through React's server renderer.
//
//   node src/render.check.mjs
//
// This catches what `vite build` cannot. The build resolves imports and parses
// JSX; it never runs a component. A page that calls an undefined function
// during render, misuses a hook, or has a typo inside a JSX expression builds
// perfectly and then shows a blank screen with a stack trace in the console.
//
// Effects do not run under server rendering, so nothing here touches the
// network or the database. It answers one question -- does this component
// render at all, in each of its states -- which is exactly the question
// nothing else in this repo was asking.
//
// .mjs because the repo is ESM at the root but this needs to be run directly
// rather than bundled, and .check so `node --test` leaves it alone.
// ---------------------------------------------------------------------------
import { createServer } from 'vite'
import { renderToString } from 'react-dom/server'
import React from 'react'

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

// Each entry is a state the component can actually be in. Rendering only the
// happy path would miss the branches that exist precisely because something
// went wrong -- which are the ones nobody looks at until they matter.
const cases = [
  ['SignIn', '/src/pages/SignIn.jsx', { onSignedIn() {} }],
  ['Register', '/src/pages/Register.jsx', {}],
  ['SetPassword', '/src/pages/SetPassword.jsx', { token: 'x'.repeat(43) }],
  ['VerifyEmail', '/src/pages/VerifyEmail.jsx', { token: 'x'.repeat(43) }],

  ['AccessNotice 401', '/src/components/AccessNotice.jsx', { error: 'Sign in to continue.', status: 401 }],
  ['AccessNotice 403', '/src/components/AccessNotice.jsx', { error: 'Not yours.', status: 403 }],
  ['AccessNotice 500', '/src/components/AccessNotice.jsx', { error: 'boom', status: 500 }],

  ['AddLoadForm unknown', '/src/components/AddLoadForm.jsx', { user: undefined, onAddLoad() {} }],
  ['AddLoadForm anon', '/src/components/AddLoadForm.jsx', { user: null, canAdd: false, onAddLoad() {} }],
  ['AddLoadForm pending', '/src/components/AddLoadForm.jsx',
    { user: { email: 'a@b.co', role: 'none', pendingApproval: true }, canAdd: false, onAddLoad() {} }],
  ['AddLoadForm driver', '/src/components/AddLoadForm.jsx',
    { user: { email: 'a@b.co', role: 'driver', pendingApproval: false }, canAdd: false, onAddLoad() {} }],
  ['AddLoadForm dispatcher', '/src/components/AddLoadForm.jsx',
    { user: { email: 'a@b.co', role: 'dispatcher', pendingApproval: false }, canAdd: true, onAddLoad() {} }],
]

let failed = 0

for (const [label, path, props] of cases) {
  try {
    const mod = await vite.ssrLoadModule(path)
    const html = renderToString(React.createElement(mod.default, props))

    // Strip tags so the log shows what a person would actually read. A
    // component that renders 400 bytes of empty divs is not obviously broken
    // from a byte count, but it is obvious from a blank string.
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

    if (label.endsWith('unknown')) {
      // The one case that SHOULD render nothing: /api/me has not answered yet,
      // and guessing would flash the wrong prompt at someone.
      if (html !== '') throw new Error(`expected nothing while identity is unknown, got ${html.length} bytes`)
      console.log(`  ok  ${label.padEnd(24)} renders nothing, correctly`)
      continue
    }

    if (!text) throw new Error('rendered no readable text')
    console.log(`  ok  ${label.padEnd(24)} "${text.slice(0, 56)}${text.length > 56 ? '...' : ''}"`)
  } catch (err) {
    failed++
    console.log(`  FAIL ${label}: ${err.message}`)
  }
}

await vite.close()
console.log(failed ? `\n${failed} FAILED` : `\nALL RENDER (${cases.length} states)`)
process.exit(failed ? 1 : 0)
