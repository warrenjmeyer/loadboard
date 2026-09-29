import { useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Box, Link, MenuItem, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import GetMeHomePlanner from '../get-me-home/GetMeHomePlanner.tsx'
import { loadboardAdapter } from '../get-me-home/adapters/loadboardAdapter.ts'
import HomeTimeSchedule from '../home-time-schedule/HomeTimeSchedule.tsx'
import DriverHomeTime from '../home-time-schedule/DriverHomeTime.tsx'
import { sampleScheduleAdapter } from '../home-time-schedule/adapters/sampleAdapter.ts'
import scheduleSample from '../home-time-schedule/fixtures/schedule.json'
import { plannerOnSchedule, verdictFor } from './wiring.ts'
import ModulesPage from './ModulesPage.tsx'
import { SAMPLE_NOW } from '../home-time-schedule/adapters/sampleAdapter.ts'

// ---------------------------------------------------------------------------
// A stand-in for the host's component page -- the same three tabs in the same
// order -- with the features built here mounted in them. Dev-only: served by
// get-me-home.html, never built, never deployed.
//
//   Get Me Home Planner        sample drivers, or live (?source=live)
//   Driver Home Time Schedule  sample stays, as dispatch or as a driver
//   Driver Load Plans          the host's; not built here
//
// The planner's sample drivers take their home time from the schedule's
// stays (see wiring.ts), so the two tabs are one system: a decision in one
// shows in the other. Changes last until the page is reloaded.
//
// Which tab, which data and which view are kept in the address, so a reload
// or a pasted link lands in the same place.
// ---------------------------------------------------------------------------
const TABS = [
  { key: 'planner', label: 'Get Me Home Planner' },
  { key: 'schedule', label: 'Driver Home Time Schedule' },
  { key: 'loads', label: 'Driver Load Plans' },
] as const

type Source = 'sample' | 'live'
type View = 'dispatch' | 'driver'
type Page = 'host' | 'modules'

function param(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name)
}

// replace, not push: these are settings of the page, not places in it.
function setParam(name: string, value: string | null) {
  const url = new URL(window.location.href)
  if (value === null) url.searchParams.delete(name)
  else url.searchParams.set(name, value)
  window.history.replaceState(null, '', url)
}

const DRIVERS = scheduleSample.drivers

export default function PreviewHost() {
  const [tab, setTab] = useState(() => Math.max(0, TABS.findIndex((t) => t.key === param('tab'))))
  const [source, setSource] = useState<Source>(() => (param('source') === 'live' ? 'live' : 'sample'))
  const [view, setView] = useState<View>(() => (param('view') === 'driver' ? 'driver' : 'dispatch'))
  const [driverCode, setDriverCode] = useState(() => param('driver') || 'TBOONE')
  const [page, setPage] = useState<Page>(() => (param('page') === 'modules' ? 'modules' : 'host'))

  const chooseTab = (i: number) => { setTab(i); setParam('tab', i === 0 ? null : TABS[i]!.key) }
  const chooseSource = (next: Source | null) => { if (next) { setSource(next); setParam('source', next === 'live' ? 'live' : null) } }
  const chooseView = (next: View | null) => { if (next) { setView(next); setParam('view', next === 'driver' ? 'driver' : null) } }
  const chooseDriver = (code: string) => { setDriverCode(code); setParam('driver', code) }
  const choosePage = (next: Page | null) => { if (next) { setPage(next); setParam('page', next === 'modules' ? 'modules' : null) } }

  // Which page: the stand-in for the host's tabs, or the catalogue of modules.
  const header = (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', mb: 1.5 }}>
      <ToggleButtonGroup size="small" exclusive value={page} onChange={(_, next: Page | null) => choosePage(next)} aria-label="Which page">
        <ToggleButton value="host">Host page</ToggleButton>
        <ToggleButton value="modules">Modules</ToggleButton>
      </ToggleButtonGroup>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        Design preview. This page runs on the dev server only and is never deployed.
      </Typography>
    </Box>
  )

  if (page === 'modules') {
    return <Box sx={{ px: 2, py: 1.5 }}>{header}<ModulesPage /></Box>
  }

  return (
    <Box sx={{ px: 2, py: 1.5 }}>
      {header}

      <Tabs value={tab} onChange={(_, next: number) => chooseTab(next)} sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        {TABS.map((t) => <Tab key={t.key} label={t.label} />)}
      </Tabs>

      {tab === 0 && (
        <>
          <Bar>
            <ToggleButtonGroup size="small" exclusive value={source} onChange={(_, next: Source | null) => chooseSource(next)} aria-label="Where the drivers come from">
              <ToggleButton value="sample">Sample drivers</ToggleButton>
              <ToggleButton value="live">Live: API and GeoTab</ToggleButton>
            </ToggleButtonGroup>
          </Bar>
          {source === 'sample' ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              Nine made-up drivers, one for every status, on a fixed clock. Their home time comes from the
              schedule tab: decide a request there and this tab follows.
            </Alert>
          ) : (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Real drivers and loads from your database, positions and hours from GeoTab, read through
              the deployed API. It needs a dispatcher or admin signed in on this dev server
              -- <Link href="/signin">sign in here</Link>, then come back. Nothing records home time
              for real drivers yet, so nobody has a request or a count of days out.
            </Alert>
          )}
          <GetMeHomePlanner key={source} adapter={source === 'live' ? loadboardAdapter : plannerOnSchedule} organizationId="preview" />
        </>
      )}

      {tab === 1 && (
        <>
          <Bar>
            <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, next: View | null) => chooseView(next)} aria-label="Whose view">
              <ToggleButton value="dispatch">Dispatch</ToggleButton>
              <ToggleButton value="driver">Driver</ToggleButton>
            </ToggleButtonGroup>
            {view === 'driver' && (
              <TextField
                select size="small" label="Driver" value={driverCode} onChange={(e) => chooseDriver(e.target.value)} sx={{ minWidth: 200 }}
                // Ten names can outgrow a short window; MUI warns when its menu does.
                slotProps={{ select: { MenuProps: { slotProps: { paper: { sx: { maxHeight: 320 } } } } } }}
              >
                {DRIVERS.map((d) => <MenuItem key={d.driverCode} value={d.driverCode}>{d.name}</MenuItem>)}
              </TextField>
            )}
          </Bar>
          <Alert severity="info" sx={{ mb: 2 }}>
            Sample stays on the planner's clock. Approving, declining and requesting really change them --
            and the planner tab -- until the page is reloaded. There is no live schedule yet: nothing stores home time.
          </Alert>
          {view === 'dispatch'
            ? <HomeTimeSchedule adapter={sampleScheduleAdapter} organizationId="preview" now={SAMPLE_NOW} verdictFor={verdictFor} />
            : <DriverHomeTime key={driverCode} adapter={sampleScheduleAdapter} driverCode={driverCode} organizationId="preview" now={SAMPLE_NOW} />}
        </>
      )}

      {tab === 2 && (
        <Typography variant="body2" sx={{ color: 'text.secondary', p: 2 }}>
          Driver Load Plans is another tab on the host page. It is not built here.
        </Typography>
      )}
    </Box>
  )
}

function Bar({ children }: { children: ReactNode }) {
  return <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', mb: 1.5 }}>{children}</Box>
}
