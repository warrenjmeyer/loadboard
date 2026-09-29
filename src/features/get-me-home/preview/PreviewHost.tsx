import { useState } from 'react'
import { Alert, Box, Link, Tab, Tabs, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import GetMeHomePlanner from '../GetMeHomePlanner.tsx'
import { fixtureAdapter } from '../adapters/fixtureAdapter.ts'
import { loadboardAdapter } from '../adapters/loadboardAdapter.ts'
import type { Adapter } from '../contract.ts'

// ---------------------------------------------------------------------------
// A stand-in for the host's component page: the same three tabs, in the same
// order, with the planner as the first. The other two are the host's, not
// ours, and only say so.
//
// Two sources of drivers, switched above the tabs:
//
//   Sample   fixtures/roster.json -- nine made-up drivers, one per status, a
//            fixed clock. The page to design against; it never changes.
//   Live     the load board's own API and GeoTab, through the dev server.
//            Needs a dispatcher or admin signed in at /signin.
//
// The choice is kept in the address (?source=live) so a reload keeps it, and
// the planner is remounted on a switch so nothing from one source -- the
// driver picked, a roster still arriving -- leaks into the other.
//
// This file is the one part of the folder that does NOT get ported. It is
// also the worked example of mounting the planner -- a theme around it, an
// adapter into it -- which is the whole of what the host has to do.
// ---------------------------------------------------------------------------
const TABS = ['Get Me Home Planner', 'Driver Home Time Schedule', 'Driver Load Plans']

type Source = 'sample' | 'live'

const ADAPTERS: Record<Source, Adapter> = { sample: fixtureAdapter, live: loadboardAdapter }

function sourceFromAddress(): Source {
  return new URLSearchParams(window.location.search).get('source') === 'live' ? 'live' : 'sample'
}

export default function PreviewHost() {
  const [tab, setTab] = useState(0)
  const [source, setSource] = useState<Source>(sourceFromAddress)

  const choose = (next: Source | null) => {
    if (!next || next === source) return // clicking the pressed button unpresses nothing
    setSource(next)
    const url = new URL(window.location.href)
    if (next === 'live') url.searchParams.set('source', 'live')
    else url.searchParams.delete('source')
    // replace, not push: which data the preview shows is a setting, not a
    // place, and Back should leave the page rather than flip the switch.
    window.history.replaceState(null, '', url)
  }

  return (
    <Box sx={{ px: 2, py: 1.5 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', mb: 1 }}>
        <ToggleButtonGroup size="small" exclusive value={source} onChange={(_, next: Source | null) => choose(next)} aria-label="Where the drivers come from">
          <ToggleButton value="sample">Sample drivers</ToggleButton>
          <ToggleButton value="live">Live: API and GeoTab</ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Design preview. This page runs on the dev server only and is never deployed.
        </Typography>
      </Box>

      {source === 'sample' ? (
        <Alert severity="info" sx={{ mb: 1 }}>
          Nine made-up drivers, one for every status, on a fixed clock -- the page to design against.
        </Alert>
      ) : (
        <Alert severity="warning" sx={{ mb: 1 }}>
          Real drivers and loads from your database, positions and hours from GeoTab, read through
          the deployed API. It needs a dispatcher or admin signed in on this dev server
          -- <Link href="/signin">sign in here</Link>, then come back to this page. Nothing records
          home time yet, so nobody has a request or a count of days out.
        </Alert>
      )}

      <Tabs value={tab} onChange={(_, next: number) => setTab(next)} sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        {TABS.map((label) => <Tab key={label} label={label} />)}
      </Tabs>

      {tab === 0 ? (
        <GetMeHomePlanner key={source} adapter={ADAPTERS[source]} organizationId="preview" />
      ) : (
        <Typography variant="body2" sx={{ color: 'text.secondary', p: 2 }}>
          {TABS[tab]} is another tab on the host page. It is not part of this feature.
        </Typography>
      )}
    </Box>
  )
}
