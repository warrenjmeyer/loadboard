import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormLabel, OutlinedInput,
  Stack, TextField, Typography,
} from '@mui/material'
import { MOVES, actionsFor } from './rules.ts'
import { STAY_LOOK } from './status.ts'
import { formatWhen, fromLocalInput, toLocalInput } from './format.ts'
import type { Stay, StayAction, StaySource, StayVerdict } from './contract.ts'

// ---------------------------------------------------------------------------
// One stay, everything about it, and the moves its status allows. The
// buttons come from actionsFor in rules.ts, so this never decides that.
//
// Two moves need more than a click, and ask for it in place, before anything
// is sent:
//
//   Decline         the reason, which the driver sees.
//   Correct times   the arrival (and, once they have left, the departure)
//                   as they really were. GeoTab records these on its own; a
//                   dispatcher who knows better fixes them here, and the
//                   stay then says "by dispatch" instead of "by GeoTab".
// ---------------------------------------------------------------------------
type Mode = 'view' | 'declining' | 'correcting'

const SOURCE_WORDS: Record<StaySource, string> = { geotab: 'by GeoTab', dispatch: 'by dispatch' }

// The moves that are one click: everything but the two above.
type SimpleMove = Exclude<StayAction['type'], 'decline' | 'correct'>
const simple = (type: SimpleMove): StayAction => ({ type })

export default function StayDialog({ stay, driverName, verdict, startDeclining = false, busy, error, onAction, onClose }: {
  stay: Stay | null
  driverName: string
  verdict?: StayVerdict | null
  startDeclining?: boolean
  busy: boolean
  error: string | null
  onAction: (stay: Stay, action: StayAction) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<Mode>(startDeclining ? 'declining' : 'view')
  const [reason, setReason] = useState('')
  const [arrived, setArrived] = useState('')
  const [left, setLeft] = useState('')

  // A different stay is a fresh start.
  useEffect(() => {
    setMode(startDeclining ? 'declining' : 'view')
    setReason('')
  }, [stay?.id, startDeclining])

  // A correction that landed shows as the stay's new times: back to viewing.
  useEffect(() => {
    setMode((m) => (m === 'correcting' ? 'view' : m))
  }, [stay?.arrivedAt, stay?.leftAt])

  if (!stay) return null
  const look = STAY_LOOK[stay.status]
  const said = (source: StaySource | null | undefined) => (source ? ` · ${SOURCE_WORDS[source]}` : '')

  const rows: [string, string][] = [
    ['Home by', formatWhen(stay.homeBy)],
    ['Back out', formatWhen(stay.backOut)],
  ]
  if (stay.arrivedAt) rows.push(['Arrived home', `${formatWhen(stay.arrivedAt)}${said(stay.arrivedSource)}`])
  if (stay.leftAt) rows.push(['Left home', `${formatWhen(stay.leftAt)}${said(stay.leftSource)}`])
  rows.push(['Asked', formatWhen(stay.requestedAt)])
  if (stay.decidedAt) rows.push([stay.status === 'DECLINED' ? 'Declined' : 'Decided', `${formatWhen(stay.decidedAt)}${stay.decidedBy ? ` by ${stay.decidedBy}` : ''}`])

  function startCorrecting() {
    setArrived(toLocalInput(stay!.arrivedAt))
    setLeft(toLocalInput(stay!.leftAt))
    setMode('correcting')
  }

  // Only what changed is sent: re-saving a time GeoTab got right should not
  // relabel it as dispatch's.
  function saveCorrection() {
    const action: Extract<StayAction, { type: 'correct' }> = { type: 'correct' }
    if (arrived !== toLocalInput(stay!.arrivedAt)) action.arrivedAt = fromLocalInput(arrived) || undefined
    if (stay!.status === 'DONE' && left !== toLocalInput(stay!.leftAt)) action.leftAt = fromLocalInput(left) || undefined
    if (!action.arrivedAt && !action.leftAt) {
      setMode('view') // nothing changed
      return
    }
    onAction(stay!, action)
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="stay-title">
      <DialogTitle id="stay-title" sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        {driverName}
        <Chip size="small" label={look.label} color={look.chip.color} variant={look.chip.variant} />
      </DialogTitle>
      <DialogContent>
        {stay.note && <Typography variant="body2" sx={{ fontStyle: 'italic', mb: 1.5 }}>“{stay.note}”</Typography>}
        <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 2, rowGap: 0.5, m: 0 }}>
          {rows.map(([label, value]) => (
            <Box key={label} sx={{ display: 'contents' }}>
              <Box component="dt" sx={{ typography: 'body2', color: 'text.secondary' }}>{label}</Box>
              <Box component="dd" sx={{ typography: 'body2', m: 0 }}>{value}</Box>
            </Box>
          ))}
        </Box>
        {stay.declineReason && <Alert severity="error" variant="outlined" sx={{ mt: 2 }}>Declined: {stay.declineReason}</Alert>}
        {verdict && (stay.status === 'REQUESTED' || stay.status === 'APPROVED') && (
          <Alert severity={verdict.severity} variant="outlined" sx={{ mt: 2 }}>{verdict.text}</Alert>
        )}
        {mode === 'declining' && (
          <TextField
            label="Why not? The driver sees this."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            multiline minRows={2} fullWidth autoFocus sx={{ mt: 2 }}
          />
        )}
        {mode === 'correcting' && (
          <Stack spacing={2} sx={{ mt: 2 }}>
            <FormControl>
              <FormLabel htmlFor="correct-arrived">Arrived home</FormLabel>
              <OutlinedInput id="correct-arrived" type="datetime-local" size="small" value={arrived} onChange={(e) => setArrived(e.target.value)} />
            </FormControl>
            {stay.status === 'DONE' && (
              <FormControl>
                <FormLabel htmlFor="correct-left">Left home</FormLabel>
                <OutlinedInput id="correct-left" type="datetime-local" size="small" value={left} onChange={(e) => setLeft(e.target.value)} />
              </FormControl>
            )}
          </Stack>
        )}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        {mode === 'declining' && (
          <>
            <Button onClick={() => setMode('view')} disabled={busy}>Back</Button>
            <Button color="error" variant="contained" disabled={busy || !reason.trim()}
              onClick={() => onAction(stay, { type: 'decline', reason })}>
              Decline request
            </Button>
          </>
        )}
        {mode === 'correcting' && (
          <>
            <Button onClick={() => setMode('view')} disabled={busy}>Back</Button>
            <Button variant="contained" disabled={busy} onClick={saveCorrection}>Save times</Button>
          </>
        )}
        {mode === 'view' && (
          <>
            <Button onClick={onClose} disabled={busy}>Close</Button>
            {actionsFor(stay.status).map((a) => (
              <Button
                key={a}
                disabled={busy}
                variant={a === 'approve' || a === 'arrive' || a === 'leave' ? 'contained' : 'outlined'}
                color={a === 'decline' || a === 'cancel' ? 'error' : 'primary'}
                onClick={() => {
                  if (a === 'decline') setMode('declining')
                  else if (a === 'correct') startCorrecting()
                  else onAction(stay, simple(a))
                }}
              >
                {MOVES[a].label}
              </Button>
            ))}
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
