import { useState } from 'react'
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormLabel, OutlinedInput, Stack, TextField,
} from '@mui/material'
import { checkNewStay } from './rules.ts'
import { fromLocalInput } from './format.ts'
import type { NewStay, Stay } from './contract.ts'

// ---------------------------------------------------------------------------
// A driver asking to go home: when they need to be there, when they can
// drive again, and why. The why is optional and is the most useful field on
// the page -- "son's homecoming game" gets a different answer from dispatch
// than a blank.
//
// The rules check the request here, before it is sent -- in the past, back
// out before home by, on top of another stay -- and say so in words.
//
// Dates use the browser's own date-time input rather than a picker library:
// it is a real input on every phone a driver carries, and it keeps the
// planner's dependency list at MUI alone. It is built from FormLabel and
// OutlinedInput, not a TextField with a label, because a floating label sits
// on top of the browser's own "mm/dd/yyyy" text and has to be told not to in
// a way that differs across MUI versions.
// ---------------------------------------------------------------------------
export default function RequestForm({ open, driverCode, existing, now, onSubmit, onClose }: {
  open: boolean
  driverCode: string
  existing: Stay[]
  now: string
  onSubmit: (stay: NewStay) => Promise<void>
  onClose: () => void
}) {
  const [homeBy, setHomeBy] = useState('')
  const [backOut, setBackOut] = useState('')
  const [note, setNote] = useState('')
  const [tried, setTried] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const request: NewStay = {
    driverCode,
    homeBy: fromLocalInput(homeBy) || '',
    backOut: fromLocalInput(backOut) || '',
    note: note.trim() || null,
  }
  // Checked on every keystroke, but only SHOWN once they have tried to send:
  // a form that shouts "required" at an empty page before anyone has typed is
  // telling them something they know.
  const problems = checkNewStay(request, existing, { now })

  async function send() {
    setTried(true)
    if (problems.length > 0) return
    setSending(true)
    setSendError(null)
    try {
      await onSubmit(request)
      setHomeBy(''); setBackOut(''); setNote(''); setTried(false)
      onClose()
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onClose={sending ? undefined : onClose} fullWidth maxWidth="xs" aria-labelledby="request-title">
      <DialogTitle id="request-title">Request home time</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <FormControl>
            <FormLabel htmlFor="request-home-by">Home by</FormLabel>
            <OutlinedInput id="request-home-by" type="datetime-local" size="small" value={homeBy} onChange={(e) => setHomeBy(e.target.value)} />
          </FormControl>
          <FormControl>
            <FormLabel htmlFor="request-back-out">Back out (ready to drive)</FormLabel>
            <OutlinedInput id="request-back-out" type="datetime-local" size="small" value={backOut} onChange={(e) => setBackOut(e.target.value)} />
          </FormControl>
          <TextField label="Why? (optional, helps dispatch)" value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} />
          {tried && problems.length > 0 && (
            <Alert severity="warning">{problems.map((p) => <div key={p}>{p}</div>)}</Alert>
          )}
          {sendError && <Alert severity="error">{sendError}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={sending}>Cancel</Button>
        <Button variant="contained" onClick={send} disabled={sending}>Send request</Button>
      </DialogActions>
    </Dialog>
  )
}
