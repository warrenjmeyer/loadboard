import { useState } from 'react'
import { Alert, Box, LinearProgress, Typography } from '@mui/material'
import DecisionList from './DecisionList.tsx'
import StayDetails from './StayDetails.tsx'
import { needsDecision } from './rules.ts'
import { useScheduleRead } from './useScheduleRead.ts'
import type { ScheduleAdapter, Stay, StayVerdict } from './contract.ts'

// ---------------------------------------------------------------------------
// MODULE: requests waiting on dispatch, oldest first, with Approve and
// Decline -- and the planner's verdict above them when the host supplies it.
//
//   <DecisionQueue adapter={a} verdictFor={v} />
//
// Reads only the queue (loadQueue): the waiting requests and their drivers.
// Decline opens StayDetails straight into "why not?". A dispatcher's
// dashboard can carry this on its own; the schedule tab carries it above
// the board.
//
// Piece: DecisionList.
// ---------------------------------------------------------------------------
export interface DecisionQueueProps {
  adapter: ScheduleAdapter
  organizationId?: string | null
  now?: string | null
  verdictFor?: ((stay: Stay) => StayVerdict | null) | null
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

export default function DecisionQueue({ adapter, organizationId = null, now = null, verdictFor = null }: DecisionQueueProps) {
  const { data, loading, error, changed } = useScheduleRead(
    (signal) => adapter.loadQueue({ organizationId, signal }),
    [adapter, organizationId],
  )
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [declining, setDeclining] = useState<string | null>(null)

  const asOf = now || data?.asOf || new Date().toISOString()
  const waiting = needsDecision(data?.stays || [])

  async function approve(stay: Stay) {
    setBusyId(stay.id)
    setActionError(null)
    try {
      await adapter.actOnStay(stay.id, { type: 'approve' })
      changed()
    } catch (err) {
      setActionError(messageOf(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Box>
      {loading && <LinearProgress sx={{ mb: 1 }} aria-label="Loading requests" />}
      {error && <Alert severity="error" sx={{ mb: 1 }}>Could not load the requests: {error}</Alert>}
      {actionError && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setActionError(null)}>{actionError}</Alert>}
      {data && (waiting.length > 0 ? (
        <DecisionList
          stays={waiting} drivers={data.drivers} now={asOf} verdictFor={verdictFor} busyId={busyId}
          onApprove={approve} onDecline={(s) => setDeclining(s.id)}
        />
      ) : (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>Nothing waiting. Every request has an answer.</Typography>
      ))}
      <StayDetails
        adapter={adapter} organizationId={organizationId} stayId={declining} verdictFor={verdictFor}
        startDeclining onClose={() => setDeclining(null)}
      />
    </Box>
  )
}
