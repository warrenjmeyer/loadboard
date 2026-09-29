import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material'
import PreviewHost from './PreviewHost.tsx'

// ---------------------------------------------------------------------------
// The design preview's entry point -- get-me-home.html loads this instead of
// src/main.jsx, so none of the load board (router, sign-in, styles.css) is
// on the page.
//
// The stock MUI theme. The look is not final; the host's own theme replaces
// this when the planner moves, and the planner itself only ever names
// palette colours, never values, so it follows whatever theme it is in.
// ---------------------------------------------------------------------------
const theme = createTheme()

const root = document.getElementById('root')
if (!root) throw new Error('get-me-home.html has no #root element to render into.')

createRoot(root).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <PreviewHost />
    </ThemeProvider>
  </StrictMode>
)
