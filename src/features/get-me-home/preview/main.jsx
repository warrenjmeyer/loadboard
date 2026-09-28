import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material'
import PreviewHost from './PreviewHost.jsx'

// ---------------------------------------------------------------------------
// The design preview's entry point -- get-me-home.html loads this instead of
// src/main.jsx, so none of the load board (router, sign-in, styles.css) is
// on the page.
//
// The stock MUI theme, on purpose. The MyTechgacity page looks like stock
// MUI -- the blue tab underline, the outlined selects -- so designing
// against the default is designing against the host. When their real theme
// is known, it goes here and nowhere else: the planner itself only ever
// names palette colours, never values.
// ---------------------------------------------------------------------------
const theme = createTheme()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <PreviewHost />
    </ThemeProvider>
  </StrictMode>
)
