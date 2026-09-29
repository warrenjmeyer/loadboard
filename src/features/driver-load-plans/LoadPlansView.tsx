import { useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Paper, Stack, Typography } from '@mui/material'
import OpenLoadList from './OpenLoadList.tsx'
import PlanTimeline from './PlanTimeline.tsx'
import PlanList from './PlanList.tsx'
import CandidateList from './CandidateList.tsx'
import { boardWindow, freeCounts, picksUpWithin } from './rules.ts'
import { formatWhen } from './format.ts'
import type { DriveFn } from './rules.ts'
import type { LoadPlanData, PlanLoad } from './contract.ts'

// ---------------------------------------------------------------------------
// The dispatch side of load plans, given the data. It fetches nothing and
// changes nothing itself: assigning and taking back go out through onAssign
// and onTakeBack, and the new data comes back in through props.
// DriverLoadPlans wires that to an adapter; a host with its own data layer
// can wire it to that instead.
//
// Tab-panel shaped, like the other two: no title, no organisation picker.
// ---------------------------------------------------------------------------
export interface LoadPlansViewProps {
  /** Drivers, their planned and open loads, and their stays. */
  data?: LoadPlanData | null
  loading?: boolean
  error?: string | null
  /** Pin the clock (previews, tests). Leave it out in production. */
  now?: string | null
  /** The host's hours model (see rules.ts). Without it, legs are driving time. */
  drive?: DriveFn | null
  /** Put a load on a driver's plan. Reject with an Error whose message is fit to show. */
  onAssign?: ((loadId: string, driverCode: string) => Promise<void>) | null
  /** Take a planned load back off. Reject the same way. */
  onTakeBack?: ((loadId: string) => Promise<void>) | null
  onRefresh?: (() => void) | null
}

type Open = { kind: 'find'; loadId: string } | { kind: 'plan'; driverCode: string; loadId: string | null }

export default function LoadPlansView({ data = null, loading = false, error = null, now = null, drive = null, onAssign = null, onTakeBack = null, onRefresh = null }: LoadPlansViewProps) {
  const asOf = now || data?.asOf || new Date().toISOString()
  const [open, setOpen] = useState<Open | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const week = boardWindow(asOf)
  // The open loads picking up this week -- the same cut loadOpenLoads makes.
  const from = new Date(week.start).toISOString()
  const to = new Date(week.end).toISOString()
  const openLoads = (data?.loads || []).filter((l) => picksUpWithin(l, from, to))
  const nowMs = Date.parse(asOf)
  const todayIndex = week.days.findIndex((d) => nowMs >= d.start && nowMs < d.end)
  const freeToday = data && todayIndex >= 0 ? freeCounts(data, week)[todayIndex] ?? 0 : 0

  async function run(key: string, work: () => Promise<void>, closeAfter: boolean) {
    setBusy(key)
    setActionError(null)
    try {
      await work()
      if (closeAfter) setOpen(null)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {data
            ? `${data.drivers.length} drivers · ${openLoads.length} open load${openLoads.length === 1 ? '' : 's'} this week · ${freeToday} truck${freeToday === 1 ? '' : 's'} free today · as of ${formatWhen(asOf)}`
            : loading ? 'Loading the plans…' : ''}
        </Typography>
        {onRefresh && <Button size="small" variant="outlined" onClick={onRefresh} disabled={loading}>Refresh</Button>}
      </Stack>

      {loading && <LinearProgress sx={{ mb: 2 }} aria-label="Loading the plans" />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>Could not load the plans: {error}</Alert>}

      {data && (
        <Stack spacing={3}>
          <section>
            <Typography variant="subtitle1" component="h3" sx={{ mb: 1 }}>Open loads</Typography>
            <OpenLoadList loads={openLoads} now={asOf} onFindDriver={(l: PlanLoad) => { setActionError(null); setOpen({ kind: 'find', loadId: l.id }) }} />
          </section>
          <section>
            <Typography variant="subtitle1" component="h3" sx={{ mb: 1 }}>The next seven days</Typography>
            <Paper variant="outlined" sx={{ p: 1 }}>
              <PlanTimeline data={data} now={asOf} drive={drive}
                onOpenDriver={(driverCode) => { setActionError(null); setOpen({ kind: 'plan', driverCode, loadId: null }) }}
                onOpenLoad={(l) => { if (l.driverCode) { setActionError(null); setOpen({ kind: 'plan', driverCode: l.driverCode, loadId: l.id }) } }} />
            </Paper>
          </section>
        </Stack>
      )}

      {open && data && (
        <Dialog open onClose={() => setOpen(null)} fullWidth maxWidth={open.kind === 'find' ? 'md' : 'sm'} scroll="paper" aria-label={open.kind === 'find' ? 'Find a driver' : "Driver's plan"}>
          {open.kind === 'find' && <DialogTitle>Find a driver</DialogTitle>}
          <DialogContent dividers>
            {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}
            {open.kind === 'find' ? (
              <CandidateList data={data} loadId={open.loadId} now={asOf} drive={drive} busyCode={busy}
                onAssign={onAssign ? (code) => { const id = open.loadId; void run(code, () => onAssign(id, code), true) } : null} />
            ) : (
              <PlanList data={data} driverCode={open.driverCode} now={asOf} drive={drive} highlightId={open.loadId} busyId={busy}
                onTakeBack={onTakeBack ? (l) => { void run(l.id, () => onTakeBack(l.id), false) } : null} />
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(null)}>Close</Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  )
}
