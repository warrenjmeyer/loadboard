import { useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress } from '@mui/material'
import CandidateList from './CandidateList.tsx'
import { usePlanRead } from './usePlanRead.ts'
import type { DriveFn } from './rules.ts'
import type { LoadPlanAdapter, PlanLoad } from './contract.ts'

// ---------------------------------------------------------------------------
// MODULE: "who should take this load?" -- every driver ranked for one open
// load, with Assign.
//
//   <SuggestDriver adapter={a} loadId="L-30450" drive={driveFor} onClose={...} />
//
// A dialog: loadId null renders nothing. Reads the one load and what ranking
// drivers for it takes (loadCandidates): every driver, their plans, their
// stays -- everything suggesting needs, and no other open loads. OpenLoads
// opens it; so can a host's own load screen.
//
// Piece: CandidateList.
// ---------------------------------------------------------------------------
export interface SuggestDriverProps {
  adapter: LoadPlanAdapter
  /** null renders nothing: the dialog is closed. */
  loadId: string | null
  organizationId?: string | null
  now?: string | null
  /** The host's hours model (see rules.ts). Without it, legs are driving time. */
  drive?: DriveFn | null
  onClose: () => void
  /** Told once a driver is assigned, with the load as stored. */
  onAssigned?: ((load: PlanLoad) => void) | null
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

export default function SuggestDriver({ adapter, loadId, organizationId = null, now = null, drive = null, onClose, onAssigned = null }: SuggestDriverProps) {
  const { data, loading, error, changed } = usePlanRead(
    (signal) => (loadId ? adapter.loadCandidates({ organizationId, loadId, signal }) : Promise.resolve({ drivers: [], loads: [], stays: [] })),
    [adapter, organizationId, loadId],
  )
  const [busyCode, setBusyCode] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  if (!loadId) return null

  async function assignTo(driverCode: string) {
    if (!loadId) return
    setBusyCode(driverCode)
    setActionError(null)
    try {
      const stored = await adapter.assignLoad(loadId, driverCode)
      changed()
      onAssigned?.(stored)
      onClose()
    } catch (err) {
      setActionError(messageOf(err))
      changed() // taken meanwhile? read again, and the list says so
    } finally {
      setBusyCode(null)
    }
  }

  const ready = data && data.loads.some((l) => l.id === loadId)
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" scroll="paper" aria-labelledby="suggest-driver-title">
      <DialogTitle id="suggest-driver-title">Find a driver</DialogTitle>
      <DialogContent dividers>
        {loading && <LinearProgress sx={{ mb: 1 }} aria-label="Ranking drivers" />}
        {(error || actionError) && <Alert severity="error" sx={{ mb: 2 }}>{actionError || `Could not rank drivers: ${error}`}</Alert>}
        {ready && data
          ? <CandidateList data={data} loadId={loadId} now={now || data.asOf || new Date().toISOString()} drive={drive} busyCode={busyCode} onAssign={assignTo} />
          : !loading && !error && <Alert severity="info">{loadId} no longer exists.</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
