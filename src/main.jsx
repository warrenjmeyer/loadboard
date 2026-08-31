import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Settlement from './pages/Settlement.jsx'
import Settlements from './pages/Settlements.jsx'
import './styles.css'

// This is the entry point -- the one place React connects to the real DOM.
// createRoot() takes over that <div id="root"> and renders into it.
//
// StrictMode is a development-only wrapper. It deliberately runs certain
// functions twice so bugs caused by impure code surface early. If you see a
// console.log fire twice in dev, that is StrictMode, not a bug. It does not
// happen in the production build.

// Which page? Read it from the query string, the same way the ColdFusion
// original did with url.id:
//
//   ?id=JSMITH            one driver's settlement (optionally &date=...)
//   ?view=settlements     the settlements board
//   anything else         the load board
//
// This is still not a router. A router earns its place when you have nested
// layouts, or links that should not reload the page -- see exercise 6 in the
// README. Three pages selected by a query parameter does not need one, and
// pretending otherwise means a dependency and a build-config change (`base`
// has to become '/') for no benefit yet.
//
// The honest tell that this is reaching its limit: when a fourth page arrives,
// or when going back from a statement to a filtered board should restore those
// filters. Neither is true yet.
const params = new URLSearchParams(window.location.search)
const driverCode = params.get('id')
const view = params.get('view')

function Page() {
  if (driverCode) {
    return <Settlement driverCode={driverCode} initialCheckDate={params.get('date')} />
  }
  if (view === 'settlements') return <Settlements />
  return <App initialSearch={params.get('search') || ''} />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Page />
  </StrictMode>
)
