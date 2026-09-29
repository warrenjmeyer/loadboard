import { useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, LinearProgress, Paper, Typography } from '@mui/material'
import PlanTimeline from './PlanTimeline.tsx'
import DriverLoadPlan from './DriverLoadPlan.tsx'
import { boardWindow } from './rules.ts'
import { usePlanRead } from './usePlanRead.ts'
import type { DriveFn } from './rules.ts'
import type { LoadPlanAdapter } from './contract.ts'

// ---------------------------------------------------------------------------
// MODULE: a week of every driver's plan -- loads, the empty miles into them,
// home time -- with how many trucks are free each day. Click a driver or a
// load for that driver's plan.
//
//   <LoadPlanBoard adapter={a} drive={driveFor} />
//
// Reads every driver and only the planned loads and stays that touch its
// seven days (loadPlanBoard, from/to). The plan it opens reads that driver
// alone (DriverLoadPlan), so it is the plan as stored, with Take back.
//
// `now` sets the window; leave it out in production. The sample data pins
// its clock, so the preview passes it.
//
// Piece: PlanTimeline.
// ---------------------------------------------------------------------------
export interface LoadPlanBoardProps {
  adapter: LoadPlanAdapter
  organizationId?: string | null
  now?: string | null
  /** The host's hours model (see rules.ts). Without it, legs are driving time. */
  drive?: DriveFn | null
}

export default function LoadPlanBoard({ adapter, organizationId = null, now = null, drive = null }: LoadPlanBoardProps) {
  const asOf = now || new Date().toISOString()
  const week = boardWindow(asOf)
  const from = new Date(week.start).toISOString()
  const to = new Date(week.end).toISOString()

  const { data, loading, error, reload } = usePlanRead(
    (signal) => adapter.loadPlanBoard({ organizationId, from, to, signal }),
    [adapter, organizationId, from, to],
  )
  const [open, setOpen] = useState<{ driverCode: string; loadId: string | null } | null>(null)

  return (
    <Box>
      {loading && <LinearProgress sx={{ mb: 1 }} aria-label="Loading the plans" />}
      {error && <Alert severity="error" sx={{ mb: 1 }}>Could not load the plans: {error}</Alert>}
      {data && (
        <>
          <Paper variant="outlined" sx={{ p: 1 }}>
            <PlanTimeline data={data} now={asOf} drive={drive}
              onOpenDriver={(driverCode) => setOpen({ driverCode, loadId: null })}
              onOpenLoad={(load) => load.driverCode && setOpen({ driverCode: load.driverCode, loadId: load.id })} />
          </Paper>
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1 }}>
            Filled: under way. Outlined: planned. Dotted: empty miles to the pickup. Orange or red edge: tight or late
            for the pickup. Red outline: runs into home time. Shaded: home time. Times are in your time zone.
          </Typography>
        </>
      )}
      {open && (
        <Dialog open onClose={() => setOpen(null)} fullWidth maxWidth="sm" scroll="paper" aria-label="Driver's plan">
          <DialogContent dividers>
            <DriverLoadPlan adapter={adapter} organizationId={organizationId} driverCode={open.driverCode}
              now={now} drive={drive} highlightId={open.loadId} onChanged={reload} />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(null)}>Close</Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  )
}
