import { useState } from 'react'
import { Alert, Box, Tab, Tabs, Typography } from '@mui/material'
import GetMeHomePlanner from '../GetMeHomePlanner.tsx'
import { fixtureAdapter } from '../adapters/fixtureAdapter.ts'

// ---------------------------------------------------------------------------
// A stand-in for the host's component page: the same three tabs, in the same
// order, with the planner as the first. The other two are the host's, not
// ours, and only say so.
//
// This file is the one part of the folder that does NOT get ported. It is
// also the worked example of mounting the planner -- a theme around it, an
// adapter into it -- which is the whole of what the host has to do.
// ---------------------------------------------------------------------------
const TABS = ['Get Me Home Planner', 'Driver Home Time Schedule', 'Driver Load Plans']

export default function PreviewHost() {
  const [tab, setTab] = useState(0)

  return (
    <Box sx={{ px: 2, py: 1.5 }}>
      <Alert severity="info" sx={{ mb: 1 }}>
        Design preview with sample drivers. This page runs on the dev server only and is never deployed.
      </Alert>

      <Tabs value={tab} onChange={(_, next: number) => setTab(next)} sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        {TABS.map((label) => <Tab key={label} label={label} />)}
      </Tabs>

      {tab === 0 ? (
        <GetMeHomePlanner adapter={fixtureAdapter} organizationId="preview" />
      ) : (
        <Typography variant="body2" sx={{ color: 'text.secondary', p: 2 }}>
          {TABS[tab]} is another tab on the host page. It is not part of this feature.
        </Typography>
      )}
    </Box>
  )
}
