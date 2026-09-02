import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Settlement from './pages/Settlement.jsx'
import Settlements from './pages/Settlements.jsx'
import SignIn from './pages/SignIn.jsx'
import Register from './pages/Register.jsx'
import SetPassword from './pages/SetPassword.jsx'
import VerifyEmail from './pages/VerifyEmail.jsx'
import Admin from './pages/Admin.jsx'
import { takeTokenFromUrl } from './lib/auth.js'
import './styles.css'

// This is the entry point -- the one place React connects to the real DOM.
// createRoot() takes over that <div id="root"> and renders into it.
//
// StrictMode is a development-only wrapper. It deliberately runs certain
// functions twice so bugs caused by impure code surface early. If you see a
// console.log fire twice in dev, that is StrictMode, not a bug. It does not
// happen in the production build. (VerifyEmail has to guard against it -- see
// the comment there, because spending a single-use token twice is not the kind
// of impurity you want surfaced by breaking the link.)

// Which page? Read it from the query string, the same way the ColdFusion
// original did with url.id:
//
//   ?verify=TOKEN         the link from a registration email
//   ?reset=TOKEN          the link from a password-reset email
//   ?signin=1             the sign-in form
//   ?register=1           create an account
//   ?view=admin           approve accounts and set roles (admins only)
//   ?id=JSMITH            one driver's settlement (optionally &date=...)
//   ?view=settlements     the settlements board
//   anything else         the load board
//
// THE TOKENS ARE READ FIRST, before anything else touches the query string.
// takeTokenFromUrl removes them from the address bar as it reads them, so a
// credential does not linger in browser history or in a screenshot -- and
// everything below has to see the URL as it is afterwards.
const verifyToken = takeTokenFromUrl('verify')
const resetToken = takeTokenFromUrl('reset')

const params = new URLSearchParams(window.location.search)
const driverCode = params.get('id')
const view = params.get('view')

// This is still not a router, and it is now past the point of comfort. Eight
// pages selected by query parameter is over the limit; the honest tell
// will be the first time one of these needs to be linked to with state, or the
// first time going back from a statement should restore the filters behind it.
// See exercise 6 in the README.
function Page() {
  if (verifyToken) return <VerifyEmail token={verifyToken} />
  if (resetToken) return <SetPassword token={resetToken} />

  // A full page load rather than a state change. There is no shared state to
  // preserve, and reloading is the simplest way to make every component see
  // the new session at once -- the cookie is HttpOnly, so nothing in the
  // browser can read it and pass it around anyway.
  if (params.get('signin')) return <SignIn onSignedIn={() => { window.location.href = '/' }} />
  if (params.get('register')) return <Register />

  if (driverCode) {
    return <Settlement driverCode={driverCode} initialCheckDate={params.get('date')} />
  }
  if (view === 'settlements') return <Settlements />
  if (view === 'admin') return <Admin />
  return <App initialSearch={params.get('search') || ''} />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Page />
  </StrictMode>
)
