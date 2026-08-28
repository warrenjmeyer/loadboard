import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

// This is the entry point -- the one place React connects to the real DOM.
// createRoot() takes over that <div id="root"> and renders <App /> into it.
//
// StrictMode is a development-only wrapper. It deliberately runs certain
// functions twice so bugs caused by impure code surface early. If you see a
// console.log fire twice in dev, that is StrictMode, not a bug. It does not
// happen in the production build.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
