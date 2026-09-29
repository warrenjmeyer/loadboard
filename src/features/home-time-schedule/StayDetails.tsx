import { useState } from 'react'
import { Dialog, DialogContent, LinearProgress, Typography } from '@mui/material'
import StayDialog from './StayDialog.tsx'
import { useScheduleRead } from './useScheduleRead.ts'
import type { ScheduleAdapter, Stay, StayAction, StayVerdict } from './contract.ts'

// ---------------------------------------------------------------------------
// MODULE: one stay, by id, with the moves its status allows.
//
//   <StayDetails adapter={a} stayId="HT-1011" onClose={...} />
//
// Reads exactly one stay (loadStay) -- so it is always the stay as stored,
// wherever it is opened from. The board and the queue both open it rather
// than each carrying a copy of the dialog's logic, and a host can open it
// from anywhere else: a planner row, a notification, a link.
//
// Piece: StayDialog.
// ---------------------------------------------------------------------------
export interface StayDetailsProps {
  adapter: ScheduleAdapter
  /** null renders nothing: the dialog is closed. */
  stayId: string | null
  organizationId?: string | null
  verdictFor?: ((stay: Stay) => StayVerdict | null) | null
  /** Open straight into "why not?" -- the queue's Decline button does. */
  startDeclining?: boolean
  onClose: () => void
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

export default function StayDetails({ adapter, stayId, organizationId = null, verdictFor = null, startDeclining = false, onClose }: StayDetailsProps) {
  const { data, loading, error, changed } = useScheduleRead(
    (signal) => (stayId ? adapter.loadStay({ organizationId, id: stayId, signal }) : Promise.resolve({ drivers: [], stays: [] })),
    [adapter, organizationId, stayId],
  )
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  if (!stayId) return null
  const stay = data?.stays.find((s) => s.id === stayId) || null

  async function act(target: Stay, action: StayAction) {
    setBusy(true)
    setActionError(null)
    try {
      await adapter.actOnStay(target.id, action)
      changed() // every module under the same ScheduleSync reads again -- this one included
      if (action.type === 'approve' || action.type === 'decline' || action.type === 'cancel') onClose()
    } catch (err) {
      setActionError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  if (!stay) {
    // Still arriving, or gone: say which rather than flash an empty dialog.
    return (
      <Dialog open onClose={onClose} fullWidth maxWidth="sm">
        <DialogContent>
          {loading && !error
            ? <LinearProgress aria-label="Loading the stay" />
            : <Typography variant="body2">{error ? `Could not load that stay: ${error}` : 'That stay no longer exists.'}</Typography>}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <StayDialog
      stay={stay}
      driverName={data?.drivers.find((d) => d.driverCode === stay.driverCode)?.name || stay.driverCode}
      verdict={verdictFor ? verdictFor(stay) : null}
      startDeclining={startDeclining}
      busy={busy}
      error={actionError}
      onAction={act}
      onClose={onClose}
    />
  )
}
