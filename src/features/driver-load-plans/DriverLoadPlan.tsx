import { useState } from 'react'
import { Alert, LinearProgress } from '@mui/material'
import PlanList from './PlanList.tsx'
import { usePlanRead } from './usePlanRead.ts'
import type { DriveFn } from './rules.ts'
import type { LoadPlanAdapter, PlanLoad } from './contract.ts'

// ---------------------------------------------------------------------------
// MODULE: one driver's plan -- each load, the empty miles into it, whether
// the truck makes the pickup, what it runs into -- with Take back on the
// loads not yet under way.
//
//   <DriverLoadPlan adapter={a} driverCode="PRAMAN" drive={driveFor} />
//
// Reads that driver alone (loadDriverPlan): their loads, their stays. The
// board opens it in a dialog; a host can put it on a driver's own page.
//
// Piece: PlanList.
// ---------------------------------------------------------------------------
export interface DriverLoadPlanProps {
  adapter: LoadPlanAdapter
  driverCode: string
  organizationId?: string | null
  now?: string | null
  /** The host's hours model (see rules.ts). Without it, legs are driving time. */
  drive?: DriveFn | null
  highlightId?: string | null
  /** Told after a load is taken back -- for a module that mounts this one
   * and should read again even when there is no PlanSync around both. */
  onChanged?: (() => void) | null
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

export default function DriverLoadPlan({ adapter, driverCode, organizationId = null, now = null, drive = null, highlightId = null, onChanged = null }: DriverLoadPlanProps) {
  const { data, loading, error, changed } = usePlanRead(
    (signal) => adapter.loadDriverPlan({ organizationId, driverCode, signal }),
    [adapter, organizationId, driverCode],
  )
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function takeBack(load: PlanLoad) {
    setBusyId(load.id)
    setActionError(null)
    try {
      await adapter.unassignLoad(load.id)
      changed() // the open loads and the board, if they share a PlanSync, read again too
      onChanged?.()
    } catch (err) {
      setActionError(messageOf(err))
    } finally {
      setBusyId(null)
    }
  }

  if (!data) {
    return error
      ? <Alert severity="error">Could not load the plan: {error}</Alert>
      : <LinearProgress aria-label="Loading the plan" />
  }

  return (
    <>
      {loading && <LinearProgress sx={{ mb: 1 }} aria-label="Refreshing" />}
      {(error || actionError) && <Alert severity="error" sx={{ mb: 2 }} onClose={actionError ? () => setActionError(null) : undefined}>{actionError || error}</Alert>}
      <PlanList data={data} driverCode={driverCode} now={now || data.asOf || new Date().toISOString()} drive={drive}
        highlightId={highlightId} busyId={busyId} onTakeBack={takeBack} />
    </>
  )
}
