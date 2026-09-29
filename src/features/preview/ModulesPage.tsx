import { useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Box, Button, Chip, Link, Paper, Stack, Typography } from '@mui/material'

import { MODULES as PLANNER_MODULES } from '../get-me-home/modules.ts'
import GetMeHomePlanner from '../get-me-home/GetMeHomePlanner.tsx'
import PlannerRoster from '../get-me-home/PlannerRoster.tsx'
import DriverTripHome from '../get-me-home/DriverTripHome.tsx'
import StatusChip from '../get-me-home/StatusChip.tsx'
import { STATUS_ORDER } from '../get-me-home/planHome.ts'

import { MODULES as SCHEDULE_MODULES } from '../home-time-schedule/modules.ts'
import HomeTimeSchedule from '../home-time-schedule/HomeTimeSchedule.tsx'
import DecisionQueue from '../home-time-schedule/DecisionQueue.tsx'
import ScheduleBoard from '../home-time-schedule/ScheduleBoard.tsx'
import StayDetails from '../home-time-schedule/StayDetails.tsx'
import DriverHomeTime from '../home-time-schedule/DriverHomeTime.tsx'
import RequestHomeTime from '../home-time-schedule/RequestHomeTime.tsx'
import { ScheduleSync } from '../home-time-schedule/sync.tsx'
import { SAMPLE_NOW, sampleScheduleAdapter } from '../home-time-schedule/adapters/sampleAdapter.ts'

import PlannerView from '../get-me-home/PlannerView.tsx'
import RosterTable from '../get-me-home/RosterTable.tsx'
import DriverPlan from '../get-me-home/DriverPlan.tsx'
import { planRoster } from '../get-me-home/planHome.ts'
import rosterJson from '../get-me-home/fixtures/roster.json'
import type { Roster } from '../get-me-home/contract.ts'

import ScheduleView from '../home-time-schedule/ScheduleView.tsx'
import DecisionList from '../home-time-schedule/DecisionList.tsx'
import Board from '../home-time-schedule/Board.tsx'
import StayDialog from '../home-time-schedule/StayDialog.tsx'
import DriverStays from '../home-time-schedule/DriverStays.tsx'
import RequestForm from '../home-time-schedule/RequestForm.tsx'
import { scopeDriver, scopeQueue } from '../home-time-schedule/scope.ts'
import scheduleJson from '../home-time-schedule/fixtures/schedule.json'
import type { ScheduleData } from '../home-time-schedule/contract.ts'

import { MODULES as LOAD_PLAN_MODULES } from '../driver-load-plans/modules.ts'
import DriverLoadPlans from '../driver-load-plans/DriverLoadPlans.tsx'
import OpenLoads from '../driver-load-plans/OpenLoads.tsx'
import SuggestDriver from '../driver-load-plans/SuggestDriver.tsx'
import LoadPlanBoard from '../driver-load-plans/LoadPlanBoard.tsx'
import DriverLoadPlan from '../driver-load-plans/DriverLoadPlan.tsx'
import LegChip from '../driver-load-plans/LegChip.tsx'
import { PlanSync } from '../driver-load-plans/sync.tsx'
import { SAMPLE_NOW as LOADS_NOW } from '../driver-load-plans/adapters/sampleAdapter.ts'

import LoadPlansView from '../driver-load-plans/LoadPlansView.tsx'
import OpenLoadList from '../driver-load-plans/OpenLoadList.tsx'
import CandidateList from '../driver-load-plans/CandidateList.tsx'
import PlanTimeline from '../driver-load-plans/PlanTimeline.tsx'
import PlanList from '../driver-load-plans/PlanList.tsx'
import { boardWindow as loadWeek, planWithLegs, suggestDrivers } from '../driver-load-plans/rules.ts'
import { scopeCandidates, scopeDriverPlan, scopeOpenLoads } from '../driver-load-plans/scope.ts'
import plansJson from '../driver-load-plans/fixtures/plans.json'
import type { LoadPlanData } from '../driver-load-plans/contract.ts'

import { driveFor, loadPlansOnSchedule, plannerOnSchedule, verdictFor } from './wiring.ts'

// ---------------------------------------------------------------------------
// THE MODULES PAGE: every reusable module built here for MyTechgacity, what
// it reads, how to mount it, and a live demo on sample data.
//
// Drawn from each feature's modules.ts, so a module registered there appears
// here -- and one without a demo below says so on the page, in amber, rather
// than silently missing. src/features/modules.test.ts checks the same thing
// before anything is committed.
//
// The schedule's demos share one ScheduleSync, the way a host page would:
// approve a request in the DecisionQueue demo and the ScheduleBoard demo
// under it reads again. (HomeTimeSchedule brings its own, as it does on a
// host.) The load plans' demos share one PlanSync the same way. Changes last
// until the page is reloaded.
// ---------------------------------------------------------------------------
const DEMOS: Record<string, () => ReactNode> = {
  GetMeHomePlanner: () => <GetMeHomePlanner adapter={plannerOnSchedule} organizationId="preview" />,
  PlannerRoster: () => <PlannerRosterDemo />,
  DriverTripHome: () => <Box sx={{ maxWidth: 480 }}><DriverTripHome adapter={plannerOnSchedule} driverCode="TBOONE" /></Box>,
  StatusChip: () => (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
      {STATUS_ORDER.map((s) => <StatusChip key={s} status={s} />)}
      <StatusChip status="TIGHT" count={2} />
    </Stack>
  ),
  HomeTimeSchedule: () => <HomeTimeSchedule adapter={sampleScheduleAdapter} now={SAMPLE_NOW} verdictFor={verdictFor} />,
  DecisionQueue: () => <DecisionQueue adapter={sampleScheduleAdapter} now={SAMPLE_NOW} verdictFor={verdictFor} />,
  ScheduleBoard: () => <ScheduleBoard adapter={sampleScheduleAdapter} now={SAMPLE_NOW} verdictFor={verdictFor} />,
  StayDetails: () => <StayDetailsDemo />,
  DriverHomeTime: () => <DriverHomeTime adapter={sampleScheduleAdapter} driverCode="TBOONE" now={SAMPLE_NOW} />,
  RequestHomeTime: () => <RequestHomeTime adapter={sampleScheduleAdapter} driverCode="HBARNETT" now={SAMPLE_NOW} />,
  DriverLoadPlans: () => <DriverLoadPlans adapter={loadPlansOnSchedule} now={LOADS_NOW} drive={driveFor} />,
  OpenLoads: () => <OpenLoads adapter={loadPlansOnSchedule} now={LOADS_NOW} drive={driveFor} />,
  SuggestDriver: () => <SuggestDriverDemo />,
  LoadPlanBoard: () => <LoadPlanBoard adapter={loadPlansOnSchedule} now={LOADS_NOW} drive={driveFor} />,
  DriverLoadPlan: () => <Box sx={{ maxWidth: 560 }}><DriverLoadPlan adapter={loadPlansOnSchedule} driverCode="PRAMAN" now={LOADS_NOW} drive={driveFor} /></Box>,
  LegChip: () => <LegChipDemo />,
}

// ---------------------------------------------------------------------------
// THE PIECES ALONE: each drawn straight from plain data -- no adapter, no
// wrapper, no tab around it -- the way a host that already holds the data
// would use it. If a piece only works inside its tab, this is where it shows.
//
// The data is the fixtures as they are on disk, not the live sample store,
// and callbacks go nowhere but a line under the demo saying what they were
// called with: that line is where a host takes over.
// ---------------------------------------------------------------------------
const ROSTER = rosterJson as Roster
const PLANNED = planRoster(ROSTER)
const SCHEDULE = scheduleJson as ScheduleData
const SCHEDULE_NOW = SCHEDULE.asOf || SAMPLE_NOW
const PLANS = plansJson as LoadPlanData
const PLANS_NOW = PLANS.asOf || LOADS_NOW

const PIECE_DEMOS: Record<string, () => ReactNode> = {
  PlannerView: () => <PlannerView roster={ROSTER} />,
  RosterTable: () => <RosterTablePiece />,
  DriverPlan: () => <Box sx={{ maxWidth: 480 }}><DriverPlan plan={PLANNED.plans.find((p) => p.driverCode === 'HBARNETT') || null} /></Box>,
  ScheduleView: () => <ScheduleViewPiece />,
  DecisionList: () => <DecisionListPiece />,
  Board: () => <BoardPiece />,
  StayDialog: () => <StayDialogPiece />,
  DriverStays: () => <DriverStaysPiece />,
  RequestForm: () => <RequestFormPiece />,
  LoadPlansView: () => <LoadPlansViewPiece />,
  OpenLoadList: () => <OpenLoadListPiece />,
  CandidateList: () => <CandidateListPiece />,
  PlanTimeline: () => <PlanTimelinePiece />,
  PlanList: () => <PlanListPiece />,
}

// Each feature's demos, wrapped the way a host page would wrap them.
const FEATURES: { key: string; title: string; folder: string; modules: typeof PLANNER_MODULES; wrap: (cards: ReactNode) => ReactNode }[] = [
  { key: 'get-me-home', title: 'Get Me Home Planner', folder: 'src/features/get-me-home', modules: PLANNER_MODULES, wrap: (cards) => cards },
  { key: 'home-time-schedule', title: 'Driver Home Time Schedule', folder: 'src/features/home-time-schedule', modules: SCHEDULE_MODULES, wrap: (cards) => <ScheduleSync>{cards}</ScheduleSync> },
  { key: 'driver-load-plans', title: 'Driver Load Plans', folder: 'src/features/driver-load-plans', modules: LOAD_PLAN_MODULES, wrap: (cards) => <PlanSync>{cards}</PlanSync> },
]

export default function ModulesPage() {
  return (
    <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
      <Box component="nav" aria-label="Modules" sx={{ position: 'sticky', top: 16, width: 220, flexShrink: 0, display: { xs: 'none', md: 'block' } }}>
        {FEATURES.map((f) => (
          <Box key={f.key} sx={{ mb: 2 }}>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>{f.title}</Typography>
            {f.modules.map((m) => (
              <Link key={m.name} href={`#${m.name}`} underline="hover" sx={{ display: 'block', typography: 'body2', py: 0.25 }}>{m.name}</Link>
            ))}
          </Box>
        ))}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="h5" component="h1">Modules</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, mb: 3, maxWidth: 760 }}>
          Every reusable module built for MyTechgacity. Each is a loading wrapper, which reads exactly what its
          screen shows through the adapter, around a piece that only draws. Both are exported, so a host can
          mount the wrapper or feed the piece its own data. Demos run on sample data; changes last until reload.
        </Typography>

        {FEATURES.map((f) => {
          const cards = f.modules.map((m) => <ModuleCard key={m.name} info={m} folder={f.folder} />)
          return (
            <Box key={f.key} component="section" sx={{ mb: 5 }}>
              <Typography variant="h6" component="h2" sx={{ mb: 2 }}>{f.title}</Typography>
              <Stack spacing={3}>{f.wrap(cards)}</Stack>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

function ModuleCard({ info, folder }: { info: (typeof PLANNER_MODULES)[number]; folder: string }) {
  const demo = DEMOS[info.name]
  return (
    <Paper variant="outlined" id={info.name} sx={{ p: 2, scrollMarginTop: 16 }}>
      <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>{info.name}</Typography>
      <Typography variant="body2" sx={{ mb: 1.5 }}>{info.summary}</Typography>

      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
        {info.reads.length > 0
          ? info.reads.map((r) => <Chip key={r} size="small" color="primary" variant="outlined" label={`reads ${r}`} />)
          : <Chip size="small" variant="outlined" label="reads nothing" />}
        <Chip size="small" variant="outlined" label={info.piece ? `piece ${info.piece}` : 'is its own piece'} />
        <Chip size="small" variant="outlined" label={`${folder}/${info.file}`} />
      </Stack>

      <Box component="pre" sx={{ m: 0, mb: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, overflowX: 'auto', typography: 'body2', fontFamily: 'monospace' }}>
        {info.usage}
      </Box>

      <DemoBox title={info.piece ? `The module: ${info.name}, loading through the adapter` : `${info.name}: reads nothing, so the module is the piece`}>
        {demo ? demo() : <Alert severity="warning">No demo for {info.name}. Add one to DEMOS in src/features/preview/ModulesPage.tsx.</Alert>}
      </DemoBox>

      {info.piece && (
        <DemoBox title={`The piece alone: ${info.piece}, from data already held, with no adapter`}>
          {PIECE_DEMOS[info.piece]
            ? PIECE_DEMOS[info.piece]!()
            : <Alert severity="warning">No piece demo for {info.piece}. Add one to PIECE_DEMOS in src/features/preview/ModulesPage.tsx.</Alert>}
        </DemoBox>
      )}
    </Paper>
  )
}

function DemoBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mb: 0.5 }}>{title}</Typography>
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}>{children}</Box>
    </Box>
  )
}

// What a callback was called with -- where a host would take over.
function useSaid(): [ReactNode, (text: string) => void] {
  const [said, setSaid] = useState<string | null>(null)
  const line = (
    <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1, fontFamily: 'monospace' }}>
      {said || 'Callbacks called will show here.'}
    </Typography>
  )
  return [line, setSaid]
}

function RosterTablePiece() {
  const [picked, setPicked] = useState<string | null>(null)
  const [line, say] = useSaid()
  return (
    <>
      <Paper variant="outlined">
        <RosterTable plans={PLANNED.plans} asOf={PLANNED.asOf} selectedCode={picked} onSelect={(c) => { setPicked(c); say(`onSelect("${c}")`) }} />
      </Paper>
      {line}
    </>
  )
}

function ScheduleViewPiece() {
  const [line, say] = useSaid()
  return (
    <>
      <ScheduleView data={SCHEDULE} now={SCHEDULE_NOW} verdictFor={verdictFor}
        onAction={async (id, action) => { say(`onAction("${id}", ${JSON.stringify(action)})`) }} />
      {line}
    </>
  )
}

function DecisionListPiece() {
  const queue = scopeQueue(SCHEDULE)
  const [line, say] = useSaid()
  return (
    <>
      <DecisionList stays={queue.stays} drivers={queue.drivers} now={SCHEDULE_NOW} verdictFor={verdictFor} busyId={null}
        onApprove={(s) => say(`onApprove("${s.id}")`)} onDecline={(s) => say(`onDecline("${s.id}")`)} />
      {line}
    </>
  )
}

function BoardPiece() {
  const [line, say] = useSaid()
  return (
    <>
      <Board drivers={SCHEDULE.drivers} stays={SCHEDULE.stays} now={SCHEDULE_NOW} onOpen={(s) => say(`onOpen("${s.id}")`)} />
      {line}
    </>
  )
}

function StayDialogPiece() {
  const stay = SCHEDULE.stays.find((s) => s.id === 'HT-1011') || null
  const [open, setOpen] = useState(false)
  const [line, say] = useSaid()
  return (
    <>
      <Button variant="outlined" size="small" onClick={() => setOpen(true)}>Open HT-1011 from data</Button>
      {open && stay && (
        <StayDialog stay={stay} driverName="Terrell Boone" verdict={verdictFor(stay)} busy={false} error={null}
          onAction={(s, action) => { say(`onAction("${s.id}", ${JSON.stringify(action)})`); setOpen(false) }}
          onClose={() => setOpen(false)} />
      )}
      {line}
    </>
  )
}

function DriverStaysPiece() {
  const [line, say] = useSaid()
  return (
    <>
      <DriverStays data={scopeDriver(SCHEDULE, 'TBOONE')} driverCode="TBOONE" now={SCHEDULE_NOW}
        onRequest={() => say('onRequest()')} onCancel={(s) => say(`onCancel("${s.id}")`)} />
      {line}
    </>
  )
}

function RequestFormPiece() {
  const [open, setOpen] = useState(false)
  const [line, say] = useSaid()
  return (
    <>
      <Button variant="outlined" size="small" onClick={() => setOpen(true)}>Open the form for Hollis Barnett</Button>
      <RequestForm open={open} driverCode="HBARNETT" existing={scopeDriver(SCHEDULE, 'HBARNETT').stays} now={SCHEDULE_NOW}
        onSubmit={async (stay) => { say(`onSubmit(${JSON.stringify(stay)})`) }} onClose={() => setOpen(false)} />
      {line}
    </>
  )
}

// A roster with nowhere to go on select, so say where the host would go.
function PlannerRosterDemo() {
  const [picked, setPicked] = useState<string | null>(null)
  return (
    <>
      <PlannerRoster adapter={plannerOnSchedule} selectedCode={picked} onSelect={setPicked} />
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1 }}>
        {picked ? `onSelect("${picked}") -- a host would open that driver here.` : 'Pick a row: the module calls onSelect with the driver code.'}
      </Typography>
    </>
  )
}

// A dialog module needs something to open it.
function StayDetailsDemo() {
  const [id, setId] = useState<string | null>(null)
  return (
    <>
      <Stack direction="row" spacing={1}>
        <Button variant="outlined" size="small" onClick={() => setId('HT-1011')}>Open HT-1011 (requested)</Button>
        <Button variant="outlined" size="small" onClick={() => setId('HT-1010')}>Open HT-1010 (home)</Button>
      </Stack>
      <StayDetails adapter={sampleScheduleAdapter} stayId={id} verdictFor={verdictFor} onClose={() => setId(null)} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Driver Load Plans: the pieces from the fixture on disk, and the demos that
// need something to open them.
// ---------------------------------------------------------------------------
function LoadPlansViewPiece() {
  const [line, say] = useSaid()
  return (
    <>
      <LoadPlansView data={PLANS} now={PLANS_NOW} drive={driveFor}
        onAssign={async (loadId, driverCode) => { say(`onAssign("${loadId}", "${driverCode}")`) }}
        onTakeBack={async (loadId) => { say(`onTakeBack("${loadId}")`) }} />
      {line}
    </>
  )
}

function OpenLoadListPiece() {
  const w = loadWeek(PLANS_NOW)
  const open = scopeOpenLoads(PLANS, { from: new Date(w.start).toISOString(), to: new Date(w.end).toISOString() })
  const [line, say] = useSaid()
  return (
    <>
      <OpenLoadList loads={open.loads} now={PLANS_NOW} onFindDriver={(l) => say(`onFindDriver("${l.id}")`)} />
      {line}
    </>
  )
}

function CandidateListPiece() {
  const [line, say] = useSaid()
  return (
    <>
      <CandidateList data={scopeCandidates(PLANS, 'L-30450')} loadId="L-30450" now={PLANS_NOW} drive={driveFor}
        onAssign={(code) => say(`onAssign("${code}")`)} />
      {line}
    </>
  )
}

function PlanTimelinePiece() {
  const [line, say] = useSaid()
  return (
    <>
      <PlanTimeline data={PLANS} now={PLANS_NOW} drive={driveFor}
        onOpenDriver={(code) => say(`onOpenDriver("${code}")`)} onOpenLoad={(l) => say(`onOpenLoad("${l.id}")`)} />
      {line}
    </>
  )
}

function PlanListPiece() {
  const [line, say] = useSaid()
  return (
    <Box sx={{ maxWidth: 560 }}>
      <PlanList data={scopeDriverPlan(PLANS, 'HBARNETT')} driverCode="HBARNETT" now={PLANS_NOW} drive={driveFor}
        onTakeBack={(l) => say(`onTakeBack("${l.id}")`)} />
      {line}
    </Box>
  )
}

// A dialog module needs something to open it.
function SuggestDriverDemo() {
  const [id, setId] = useState<string | null>(null)
  return (
    <>
      <Stack direction="row" spacing={1}>
        <Button variant="outlined" size="small" onClick={() => setId('L-30450')}>Find a driver for L-30450</Button>
        <Button variant="outlined" size="small" onClick={() => setId('L-30452')}>Find a driver for L-30452</Button>
      </Stack>
      <SuggestDriver adapter={loadPlansOnSchedule} loadId={id} now={LOADS_NOW} drive={driveFor} onClose={() => setId(null)} />
    </>
  )
}

// Every verdict a leg can have, from real legs in the fixture.
function LegChipDemo() {
  const legOf = (code: string, id: string) => planWithLegs(PLANS, code, { now: PLANS_NOW, drive: driveFor }).find((p) => p.load.id === id)?.leg ?? null
  const rey = suggestDrivers(PLANS, 'L-30450', { now: PLANS_NOW, drive: driveFor }).find((c) => c.driverCode === 'RVASQUEZ')?.leg ?? null
  const legs = [legOf('PRAMAN', 'L-30430'), legOf('PRAMAN', 'L-30433'), legOf('HBARNETT', 'L-30421'), rey]
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
      {legs.map((leg, i) => <LegChip key={i} leg={leg} />)}
      <LegChip leg={legs[2] ?? null} compact />
      <LegChip leg={null} />
    </Stack>
  )
}
