import { useState } from 'react'
import { Alert, Box, Button, LinearProgress, Paper, Stack, Typography } from '@mui/material'
import Board from './Board.tsx'
import DecisionList from './DecisionList.tsx'
import StayDialog from './StayDialog.tsx'
import { homeCounts, boardWindow, needsDecision } from './rules.ts'
import { formatWhen } from './format.ts'
import type { ScheduleData, Stay, StayAction, StayVerdict } from './contract.ts'

// ---------------------------------------------------------------------------
// The dispatch side of the schedule, given the data. It fetches nothing and
// changes nothing itself: every move goes out through onAction, and the new
// data comes back in through props. HomeTimeSchedule wires that to an
// adapter; a host with its own data layer can wire it to that instead.
//
// Tab-panel shaped, like the planner: no title, no organisation picker.
// ---------------------------------------------------------------------------
export interface ScheduleViewProps {
  data?: ScheduleData | null
  loading?: boolean
  error?: string | null
  /** Pin the clock (previews, tests). Leave it out in production. */
  now?: string | null
  /** The planner's opinion of a stay, if the host can give one. */
  verdictFor?: ((stay: Stay) => StayVerdict | null) | null
  /** Carry out a move. Reject with an Error whose message is fit to show. */
  onAction?: ((id: string, action: StayAction) => Promise<void>) | null
  onRefresh?: (() => void) | null
}

export default function ScheduleView({ data = null, loading = false, error = null, now = null, verdictFor = null, onAction = null, onRefresh = null }: ScheduleViewProps) {
  const asOf = now || data?.asOf || new Date().toISOString()
  const [open, setOpen] = useState<{ id: string; declining: boolean } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const stays = data?.stays || []
  const drivers = data?.drivers || []
  const waiting = needsDecision(stays)
  const board = boardWindow(asOf)
  const todayIndex = board.days.findIndex((d) => Date.parse(asOf) >= d.start && Date.parse(asOf) < d.end)
  const homeToday = data && todayIndex >= 0 ? homeCounts(stays, board)[todayIndex] ?? 0 : 0
  // Looked up by id each render, so the dialog shows the stay as it is NOW --
  // after an approve, the same dialog shows it approved, with the next moves.
  const openStay = open ? stays.find((s) => s.id === open.id) || null : null
  const nameOf = (code: string) => drivers.find((d) => d.driverCode === code)?.name || code

  async function act(stay: Stay, action: StayAction) {
    if (!onAction) return
    setBusyId(stay.id)
    setActionError(null)
    try {
      await onAction(stay.id, action)
      // Decisions close the dialog: the stay has left the list it was in.
      // Arriving and leaving keep it open, since the next move is right there.
      if (action.type === 'approve' || action.type === 'decline' || action.type === 'cancel') setOpen(null)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {data
            ? `${drivers.length} drivers · ${waiting.length} waiting for a decision · ${homeToday} home today · as of ${formatWhen(asOf)}`
            : loading ? 'Loading the schedule…' : ''}
        </Typography>
        {onRefresh && <Button size="small" variant="outlined" onClick={onRefresh} disabled={loading}>Refresh</Button>}
      </Stack>

      {loading && <LinearProgress sx={{ mb: 2 }} aria-label="Loading the schedule" />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>Could not load the schedule: {error}</Alert>}
      {actionError && !openStay && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>{actionError}</Alert>}

      {data && (
        <>
          <Typography variant="subtitle1" component="h3" sx={{ mb: 1 }}>Needs a decision</Typography>
          {waiting.length > 0 ? (
            <DecisionList
              stays={waiting} drivers={drivers} now={asOf} verdictFor={verdictFor} busyId={busyId}
              onApprove={(s) => act(s, { type: 'approve' })}
              onDecline={(s) => { setActionError(null); setOpen({ id: s.id, declining: true }) }}
            />
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>Nothing waiting. Every request has an answer.</Typography>
          )}

          <Typography variant="subtitle1" component="h3" sx={{ mt: 3, mb: 1 }}>The next two weeks</Typography>
          <Paper variant="outlined" sx={{ p: 1 }}>
            <Board drivers={drivers} stays={stays} now={asOf} onOpen={(s) => { setActionError(null); setOpen({ id: s.id, declining: false }) }} />
          </Paper>
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1 }}>
            Dashed: asked for. Filled: approved. Green: home now. Grey: was home. Times are in your time zone.
          </Typography>
        </>
      )}

      <StayDialog
        stay={openStay}
        driverName={openStay ? nameOf(openStay.driverCode) : ''}
        verdict={openStay && verdictFor ? verdictFor(openStay) : null}
        startDeclining={open?.declining ?? false}
        busy={openStay !== null && busyId === openStay.id}
        error={openStay ? actionError : null}
        onAction={act}
        onClose={() => { setOpen(null); setActionError(null) }}
      />
    </Box>
  )
}
