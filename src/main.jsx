import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Settlement from './pages/Settlement.jsx'
import './styles.css'

// This is the entry point -- the one place React connects to the real DOM.
// createRoot() takes over that <div id="root"> and renders into it.
//
// StrictMode is a development-only wrapper. It deliberately runs certain
// functions twice so bugs caused by impure code surface early. If you see a
// console.log fire twice in dev, that is StrictMode, not a bug. It does not
// happen in the production build.

// Which page? Read it from the query string, the same way the ColdFusion
// original did with url.id: ?id=JSMITH is a driver's settlement, anything else
// is the load board.
//
// This is not a router. A router earns its place when you have several routes,
// nested layouts, or links that should not reload the page -- see exercise 6 in
// the README. Two pages selected by one query parameter does not need one, and
// pretending otherwise means a dependency and a build-config change (`base`
// has to become '/') for no benefit yet.
const params = new URLSearchParams(window.location.search)
const driverCode = params.get('id')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {driverCode ? <Settlement driverCode={driverCode} /> : <App />}
  </StrictMode>
)
