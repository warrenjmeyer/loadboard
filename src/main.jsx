import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import App from './App.jsx'
import LoadDetail from './pages/LoadDetail.jsx'
import MyLoads from './pages/MyLoads.jsx'
import Fleet from './pages/Fleet.jsx'
import Customers from './pages/Customers.jsx'
import CustomerDetail from './pages/CustomerDetail.jsx'
import Payroll from './pages/Payroll.jsx'
import Deductions from './pages/Deductions.jsx'
import Billing from './pages/Billing.jsx'
import Invoices from './pages/Invoices.jsx'
import Invoice from './pages/Invoice.jsx'
import Settlement from './pages/Settlement.jsx'
import Settlements from './pages/Settlements.jsx'
import SignIn from './pages/SignIn.jsx'
import Register from './pages/Register.jsx'
import SetPassword from './pages/SetPassword.jsx'
import VerifyEmail from './pages/VerifyEmail.jsx'
import Admin from './pages/Admin.jsx'
import { takeTokenFromUrl } from './lib/auth.js'
import './styles.css'

// ---------------------------------------------------------------------------
// The entry point -- the one place React connects to the real DOM.
//
// This file used to be a chain of `if (params.get('view') === ...)` statements.
// That worked, and it was the honest first step from the ColdFusion original's
// url.id, but it had no answer for three things a router gives you for free:
//
//   1. Going "back" did nothing useful, because nothing ever pushed a history
//      entry. Every navigation was a full page load.
//   2. A link could not carry state. ?id=JSMITH&date=2026-08-28 worked only
//      because both values are strings that survive a page reload.
//   3. Every navigation threw the whole app away and re-fetched everything,
//      including /api/me, which is the one request that should not repeat.
//
// StrictMode is unchanged and still development-only: it deliberately runs
// certain functions twice so impure code surfaces early. If a console.log fires
// twice in dev, that is StrictMode, not a bug. It does not happen in the
// production build.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// THE TOKENS ARE READ FIRST, at module scope, BEFORE the router mounts.
//
// This ordering is not stylistic and it is the subtlest thing in the file.
// takeTokenFromUrl calls history.replaceState to strip the credential out of
// the address bar as it reads it. BrowserRouter snapshots window.location when
// it mounts and owns history from that moment on -- so a replaceState that runs
// after the router is up is a change the router does not know about, and the
// first navigation puts the token back.
//
// Reading here, before createRoot, means the router only ever sees the scrubbed
// URL. That is the whole trick.
//
// Why these two are NOT routes like /verify/:token -- and this is the part
// worth remembering: a path parameter is *more* exposed than a query
// parameter, not less. Both sit in history; only the query string can be
// rewritten away without navigating. Putting a single-use credential in the
// path would mean it is still in the URL bar while the page renders, still in
// the back stack, and still in any screenshot. The email links in
// api/src/functions/register.js therefore keep their existing shape:
//
//   /?verify=TOKEN     and     /?reset=TOKEN
//
// which is also why no already-sent email breaks when this file changes.
// ---------------------------------------------------------------------------
const verifyToken = takeTokenFromUrl('verify')
const resetToken = takeTokenFromUrl('reset')

function NotFound() {
  return (
    <div className="page auth-page">
      <h1>Page not found</h1>
      <p className="muted">There is nothing at this address.</p>
      <nav className="board-nav">
        <Link to="/">← The load board</Link>
      </nav>
    </div>
  )
}

function Root() {
  // The token pages are terminal: someone arrives from an email, one thing
  // happens, and they leave via a link. There is nothing to navigate between,
  // so they render OUTSIDE the router rather than as routes. Their internal
  // links stay plain <a> elements -- a full page load into the app is exactly
  // what you want after a credential has been spent.
  if (verifyToken) return <VerifyEmail token={verifyToken} />
  if (resetToken) return <SetPassword token={resetToken} />

  return (
    <BrowserRouter>
      <Routes>
        {/* Each Route maps a URL pattern to an element. React Router walks the
            list and renders the best match -- "best", not "first": a literal
            /settlements beats the dynamic /settlements/:driverCode, so their
            order here does not matter the way the old if-chain's did. That is
            the practical difference between routing and a switch statement. */}
        <Route path="/" element={<App />} />

        {/* One load. Same shape as /settlements/:driverCode below -- the
            path names the thing, and there is no query string because
            nothing about viewing a load is a setting. */}
        <Route path="/loads/:id" element={<LoadDetail />} />

        {/* The driver's own view: what they are on, and what they have run. */}
        <Route path="/my-loads" element={<MyLoads />} />

        {/* Trucks and trailers: read by any role, edited by dispatch. */}
        <Route path="/fleet" element={<Fleet />} />

        {/* Who the freight belongs to. */}
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />

        {/* Delivered loads become settlements. Admin only. */}
        <Route path="/payroll" element={<Payroll />} />
        <Route path="/payroll/deductions" element={<Deductions />} />

        {/* Delivered loads become invoices. The run is admin's; the list and
            the document are dispatch's too. */}
        <Route path="/billing" element={<Billing />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/invoices/:invoiceNo" element={<Invoice />} />

        <Route path="/settlements" element={<Settlements />} />

        {/* The colon makes :driverCode a parameter. Settlement.jsx reads it
            with useParams() instead of taking it as a prop -- see that file,
            it is the worked example for this migration. */}
        <Route path="/settlements/:driverCode" element={<Settlement />} />

        {/* A Route element is ordinary JSX, so props still work -- there is no
            special mechanism for passing data to a routed component.

            onSignedIn stays a full page load rather than a navigate(), and
            deliberately: the session cookie is HttpOnly, so nothing in the
            browser can read it and hand it around. Reloading is the simplest
            way to make every component ask /api/me again at once. A router
            does not change that; it only makes it a choice instead of the
            only option. */}
        <Route
          path="/signin"
          element={<SignIn onSignedIn={() => { window.location.href = '/' }} />}
        />
        <Route path="/register" element={<Register />} />
        <Route path="/admin" element={<Admin />} />

        {/* "*" catches everything unmatched. Without it a typo renders a blank
            page with no error, which is a genuinely miserable half hour. */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
