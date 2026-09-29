import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography,
} from '@mui/material'
import { MOVES, actionsFor } from './rules.ts'
import { STAY_LOOK } from './status.ts'
import { formatWhen } from './format.ts'
import type { Stay, StayAction, StayVerdict } from './contract.ts'

// ---------------------------------------------------------------------------
// One stay, everything about it, and the moves its status allows. The
// buttons come from actionsFor in rules.ts, so a DONE stay has none and a
// REQUESTED one has approve, decline and cancel -- this never decides that.
//
// Declining asks for the reason in place, before anything is sent: the rules
// refuse a decline without one, and saying so after a round trip is worse.
// ---------------------------------------------------------------------------
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
  const [declining, setDeclining] = useState(startDeclining)
  const [reason, setReason] = useState('')

  // A different stay is a fresh start.
  useEffect(() => {
    setDeclining(startDeclining)
    setReason('')
  }, [stay?.id, startDeclining])

  if (!stay) return null
  const look = STAY_LOOK[stay.status]
  const rows: [string, string][] = [
    ['Home by', formatWhen(stay.homeBy)],
    ['Back out', formatWhen(stay.backOut)],
  ]
  if (stay.arrivedAt) rows.push(['Arrived home', formatWhen(stay.arrivedAt)])
  if (stay.leftAt) rows.push(['Left home', formatWhen(stay.leftAt)])
  rows.push(['Asked', formatWhen(stay.requestedAt)])
  if (stay.decidedAt) rows.push([stay.status === 'DECLINED' ? 'Declined' : 'Decided', `${formatWhen(stay.decidedAt)}${stay.decidedBy ? ` by ${stay.decidedBy}` : ''}`])

  const actions = actionsFor(stay.status).filter((a) => a !== 'decline' || !declining)

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
        {declining && (
          <TextField
            label="Why not? The driver sees this."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            multiline minRows={2} fullWidth autoFocus sx={{ mt: 2 }}
          />
        )}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        {declining ? (
          <>
            <Button onClick={() => setDeclining(false)} disabled={busy}>Back</Button>
            <Button color="error" variant="contained" disabled={busy || !reason.trim()}
              onClick={() => onAction(stay, { type: 'decline', reason })}>
              Decline request
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>Close</Button>
            {actions.map((a) => (
              <Button
                key={a}
                disabled={busy}
                variant={a === 'approve' || a === 'arrive' || a === 'leave' ? 'contained' : 'outlined'}
                color={a === 'decline' || a === 'cancel' ? 'error' : 'primary'}
                onClick={() => (a === 'decline' ? setDeclining(true) : onAction(stay, { type: a } as StayAction))}
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
