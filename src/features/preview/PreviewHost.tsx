import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Box, Chip, Link, MenuItem, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import GetMeHomePlanner from '../get-me-home/GetMeHomePlanner.tsx'
import { loadboardAdapter } from '../get-me-home/adapters/loadboardAdapter.ts'
import HomeTimeSchedule from '../home-time-schedule/HomeTimeSchedule.tsx'
import DriverHomeTime from '../home-time-schedule/DriverHomeTime.tsx'
import { sampleScheduleAdapter } from '../home-time-schedule/adapters/sampleAdapter.ts'
import scheduleSample from '../home-time-schedule/fixtures/schedule.json'
import DriverLoadPlans from '../driver-load-plans/DriverLoadPlans.tsx'
import { driveFor, loadPlansOnSchedule, plannerOnSchedule, verdictFor } from './wiring.ts'
import { laptopDrivers, laptopLoadPlanAdapter, laptopScheduleAdapter, laptopScheduleAdapterFor, plannerOnLaptop, signedIn } from './laptopAdapters.ts'
import { makeVerdictFor, verdictUnavailable } from './verdict.ts'
import type { Stay, StayVerdict } from '../home-time-schedule/contract.ts'
import ModulesPage from './ModulesPage.tsx'
import { SAMPLE_NOW } from '../home-time-schedule/adapters/sampleAdapter.ts'

// ---------------------------------------------------------------------------
// A stand-in for the host's component page -- the same three tabs in the same
// order -- with the features built here mounted in them. Dev-only: served by
// get-me-home.html, never built, never deployed.
//
// Two kinds of data (?data=laptop):
//
//   SAMPLE DATA      made-up drivers, stays and loads on a fixed clock, held
//                    in memory until the page is reloaded. The tabs are
//                    joined the way a host joins them (wiring.ts).
//   LAPTOP DATABASE  the laptop's mvp-techgacity -- the host's tables, filled
//                    from Millstream -- read and written through the host's
//                    own SQL (tools/local-db/plugin.mjs, laptopAdapters.ts),
//                    with positions, hours and town locations from GeoTab
//                    through the deployed API. Real clock; real rows.
//
//   Get Me Home Planner        sample drivers, or live (?source=live)
//   Driver Home Time Schedule  as dispatch or as a driver
//   Driver Load Plans          timed with or without the planner's hours
//                              model (?hours=off)
//
// Which tab, which data and which view are kept in the address, so a reload
// or a pasted link lands in the same place.
// ---------------------------------------------------------------------------
const TABS = [
  { key: 'planner', label: 'Get Me Home Planner' },
  { key: 'schedule', label: 'Driver Home Time Schedule' },
  { key: 'loads', label: 'Driver Load Plans' },
] as const

type Data = 'sample' | 'laptop'
type Source = 'sample' | 'live'
type View = 'dispatch' | 'driver'
type Page = 'host' | 'modules'
type HoursModel = 'planner' | 'off'

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

const SAMPLE_DRIVERS = scheduleSample.drivers

export default function PreviewHost() {
  const [tab, setTab] = useState(() => Math.max(0, TABS.findIndex((t) => t.key === param('tab'))))
  const [data, setData] = useState<Data>(() => (param('data') === 'laptop' ? 'laptop' : 'sample'))
  const [source, setSource] = useState<Source>(() => (param('source') === 'live' ? 'live' : 'sample'))
  const [view, setView] = useState<View>(() => (param('view') === 'driver' ? 'driver' : 'dispatch'))
  const [driverCode, setDriverCode] = useState(() => param('driver') || 'TBOONE')
  const [page, setPage] = useState<Page>(() => (param('page') === 'modules' ? 'modules' : 'host'))
  const [hours, setHours] = useState<HoursModel>(() => (param('hours') === 'off' ? 'off' : 'planner'))

  const chooseTab = (i: number) => { setTab(i); setParam('tab', i === 0 ? null : TABS[i]!.key) }
  const chooseData = (next: Data | null) => { if (next) { setData(next); setParam('data', next === 'laptop' ? 'laptop' : null) } }
  const chooseSource = (next: Source | null) => { if (next) { setSource(next); setParam('source', next === 'live' ? 'live' : null) } }
  const chooseView = (next: View | null) => { if (next) { setView(next); setParam('view', next === 'driver' ? 'driver' : null) } }
  const chooseDriver = (code: string) => { setDriverCode(code); setParam('driver', code) }
  const choosePage = (next: Page | null) => { if (next) { setPage(next); setParam('page', next === 'modules' ? 'modules' : null) } }
  const chooseHours = (next: HoursModel | null) => { if (next) { setHours(next); setParam('hours', next === 'off' ? 'off' : null) } }

  const laptop = data === 'laptop'
  const { user, drivers: laptopList } = useLaptop(laptop)
  const laptopVerdictFor = useLaptopVerdict(laptop && tab === 1)
  const drivers = laptop ? laptopList : SAMPLE_DRIVERS

  // Which page: the stand-in for the host's tabs, or the catalogue of modules.
  const header = (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', mb: 1.5 }}>
      <ToggleButtonGroup size="small" exclusive value={page} onChange={(_, next: Page | null) => choosePage(next)} aria-label="Which page">
        <ToggleButton value="host">Host page</ToggleButton>
        <ToggleButton value="modules">Modules</ToggleButton>
      </ToggleButtonGroup>
      {page === 'host' && (
        <ToggleButtonGroup size="small" exclusive value={data} onChange={(_, next: Data | null) => chooseData(next)} aria-label="Which data">
          <ToggleButton value="sample">Sample data</ToggleButton>
          <ToggleButton value="laptop">Laptop database</ToggleButton>
        </ToggleButtonGroup>
      )}
      {page === 'host' && laptop && (user === undefined ? null : user ? (
        <Chip size="small" color={user.role === 'dispatcher' || user.role === 'admin' ? 'success' : 'warning'} variant="outlined"
          label={`Signed in: ${user.name} (${user.role})`} />
      ) : (
        <Chip size="small" color="warning" label="Not signed in: no GeoTab" component="a" href="/signin" clickable />
      ))}
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        Design preview. This page runs on the dev server only and is never deployed.
      </Typography>
    </Box>
  )

  if (page === 'modules') {
    return <Box sx={{ px: 2, py: 1.5 }}>{header}<ModulesPage /></Box>
  }

  const geotabNote = (
    <>
      Positions, hours and town locations come from GeoTab through the deployed API, which needs a dispatcher
      or admin signed in on this dev server -- <Link href="/signin">sign in here</Link>, then come back.
    </>
  )

  return (
    <Box sx={{ px: 2, py: 1.5 }}>
      {header}

      <Tabs value={tab} onChange={(_, next: number) => chooseTab(next)} sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        {TABS.map((t) => <Tab key={t.key} label={t.label} />)}
      </Tabs>

      {tab === 0 && (laptop ? (
        <>
          <Alert severity="info" sx={{ mb: 2 }}>
            Your real drivers and their loads from Millstream, with their home time from the laptop's stays -- ask
            for or decide home time in the schedule tab and this tab follows. {geotabNote}
          </Alert>
          <GetMeHomePlanner key="laptop" adapter={plannerOnLaptop} organizationId="preview" />
        </>
      ) : (
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
              for real drivers there yet, so nobody has a request or a count of days out.
            </Alert>
          )}
          <GetMeHomePlanner key={source} adapter={source === 'live' ? loadboardAdapter : plannerOnSchedule} organizationId="preview" />
        </>
      ))}

      {tab === 1 && (
        <>
          <Bar>
            <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, next: View | null) => chooseView(next)} aria-label="Whose view">
              <ToggleButton value="dispatch">Dispatch</ToggleButton>
              <ToggleButton value="driver">Driver</ToggleButton>
            </ToggleButtonGroup>
            {view === 'driver' && (
              <TextField
                select size="small" label="Driver" value={drivers.some((d) => d.driverCode === driverCode) ? driverCode : ''}
                onChange={(e) => chooseDriver(e.target.value)} sx={{ minWidth: 200 }}
                // Two dozen names outgrow a short window; MUI warns when its menu does.
                slotProps={{ select: { MenuProps: { slotProps: { paper: { sx: { maxHeight: 320 } } } } } }}
              >
                {drivers.map((d) => <MenuItem key={d.driverCode} value={d.driverCode}>{d.name}</MenuItem>)}
              </TextField>
            )}
          </Bar>
          {laptop ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              Stays in the laptop's database, read and written through the host's own SQL -- every request,
              approval and decline is a real row there. The driver view acts AS that driver, so the host's
              who-may checks decide what it gets. The planner's verdict beside Approve plans your real drivers
              from GeoTab, so it needs a dispatcher or admin signed in; it appears once they have loaded.
            </Alert>
          ) : (
            <Alert severity="info" sx={{ mb: 2 }}>
              Sample stays on the planner's clock. Approving, declining and requesting really change them --
              and the planner tab -- until the page is reloaded.
            </Alert>
          )}
          {view === 'dispatch'
            ? <HomeTimeSchedule key={data} adapter={laptop ? laptopScheduleAdapter : sampleScheduleAdapter} organizationId="preview"
                now={laptop ? null : SAMPLE_NOW} verdictFor={laptop ? laptopVerdictFor : verdictFor} />
            : <DriverHomeTime key={`${data}-${driverCode}`} adapter={laptop ? laptopScheduleAdapterFor(driverCode) : sampleScheduleAdapter}
                driverCode={driverCode} organizationId="preview" now={laptop ? null : SAMPLE_NOW} />}
        </>
      )}

      {tab === 2 && (
        <>
          <Bar>
            <ToggleButtonGroup size="small" exclusive value={hours} onChange={(_, next: HoursModel | null) => chooseHours(next)} aria-label="How legs are timed">
              <ToggleButton value="planner">Planner's hours model</ToggleButton>
              <ToggleButton value="off">Driving time only</ToggleButton>
            </ToggleButtonGroup>
          </Bar>
          {laptop ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              Loads, plans and home time from the laptop's database, through the host's own SQL -- assigning and
              taking back write real rows there. {geotabNote}
            </Alert>
          ) : (
            <Alert severity="info" sx={{ mb: 2 }}>
              Sample loads on the planner's clock, with the planner's drivers. Home time is the schedule tab's:
              approve a request there and a load here that runs into it says so. Assigning and taking back really
              change the loads until the page is reloaded.
            </Alert>
          )}
          <DriverLoadPlans key={`${data}-${hours}`} adapter={laptop ? laptopLoadPlanAdapter : loadPlansOnSchedule} organizationId="preview"
            now={laptop ? null : SAMPLE_NOW} drive={hours === 'planner' ? driveFor : null} />
        </>
      )}
    </Box>
  )
}

// Who is signed in (GeoTab needs dispatch), and the laptop's drivers for the
// driver picker -- asked once, when the laptop database is chosen.
function useLaptop(on: boolean): { user: { name: string; role: string } | null | undefined; drivers: { driverCode: string; name: string }[] } {
  const [user, setUser] = useState<{ name: string; role: string } | null | undefined>(undefined)
  const [drivers, setDrivers] = useState<{ driverCode: string; name: string }[]>([])
  useEffect(() => {
    if (!on) return
    let live = true
    signedIn().then((u) => { if (live) setUser(u) })
    laptopDrivers().then((d) => { if (live) setDrivers(d) }).catch(() => { /* the tabs say what is wrong */ })
    return () => { live = false }
  }, [on])
  return { user, drivers }
}

// The planner's verdict on the laptop data: the live roster -- Millstream's
// drivers, GeoTab's positions and hours, the laptop's home time -- loaded
// when the schedule tab opens, and every request planned against it. Until
// it arrives there is no verdict; if it cannot arrive, every request says why.
type VerdictFor = (stay: Stay) => StayVerdict | null
function useLaptopVerdict(on: boolean): VerdictFor | null {
  const [verdict, setVerdict] = useState<VerdictFor | null>(null)
  useEffect(() => {
    if (!on) return
    const controller = new AbortController()
    plannerOnLaptop.loadRoster({ organizationId: 'preview', signal: controller.signal })
      .then((roster) => setVerdict(() => makeVerdictFor(roster)))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        const message = err instanceof Error ? err.message : String(err)
        setVerdict(() => verdictUnavailable(/not signed in/.test(message)
          ? 'it plans your real drivers from GeoTab, which needs a dispatcher or admin signed in on this dev server. Sign in at /signin, then reload.'
          : message))
      })
    return () => controller.abort()
  }, [on])
  return on ? verdict : null
}

function Bar({ children }: { children: ReactNode }) {
  return <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', mb: 1.5 }}>{children}</Box>
}
