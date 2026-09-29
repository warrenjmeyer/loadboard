import { useState } from 'react'
import { Alert, Box, LinearProgress } from '@mui/material'
import OpenLoadList from './OpenLoadList.tsx'
import SuggestDriver from './SuggestDriver.tsx'
import { boardWindow } from './rules.ts'
import { usePlanRead } from './usePlanRead.ts'
import type { DriveFn } from './rules.ts'
import type { LoadPlanAdapter, PlanLoad } from './contract.ts'

// ---------------------------------------------------------------------------
// MODULE: the loads nobody is hauling yet, picking up in the next seven days,
// each with "Find a driver".
//
//   <OpenLoads adapter={a} drive={driveFor} />
//
// Reads only the open loads in its window (loadOpenLoads) -- a list of work,
// with no drivers and no stays in it. "Find a driver" opens SuggestDriver,
// which reads what ranking takes. A dispatcher's dashboard can carry this on
// its own; the tab carries it above the board.
//
// Piece: OpenLoadList.
// ---------------------------------------------------------------------------
export interface OpenLoadsProps {
  adapter: LoadPlanAdapter
  organizationId?: string | null
  now?: string | null
  /** The host's hours model (see rules.ts). Without it, legs are driving time. */
  drive?: DriveFn | null
  onAssigned?: ((load: PlanLoad) => void) | null
}

export default function OpenLoads({ adapter, organizationId = null, now = null, drive = null, onAssigned = null }: OpenLoadsProps) {
  const asOf = now || new Date().toISOString()
  const week = boardWindow(asOf)
  const from = new Date(week.start).toISOString()
  const to = new Date(week.end).toISOString()

  const { data, loading, error, reload } = usePlanRead(
    (signal) => adapter.loadOpenLoads({ organizationId, from, to, signal }),
    [adapter, organizationId, from, to],
  )
  const [finding, setFinding] = useState<string | null>(null)

  return (
    <Box>
      {loading && <LinearProgress sx={{ mb: 1 }} aria-label="Loading open loads" />}
      {error && <Alert severity="error" sx={{ mb: 1 }}>Could not load the open loads: {error}</Alert>}
      {data && <OpenLoadList loads={data.loads} now={asOf} onFindDriver={(load) => setFinding(load.id)} />}
      <SuggestDriver adapter={adapter} organizationId={organizationId} loadId={finding} now={now} drive={drive}
        // Read again even with no PlanSync around: the load just assigned is no longer open.
        onAssigned={(load) => { reload(); onAssigned?.(load) }} onClose={() => setFinding(null)} />
    </Box>
  )
}
