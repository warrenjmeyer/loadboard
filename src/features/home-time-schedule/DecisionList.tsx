import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material'
import { formatAgo, formatDuration, formatShort } from './format.ts'
import { minutesSince, stayLength } from './rules.ts'
import type { ScheduleDriver, Stay, StayVerdict } from './contract.ts'

// ---------------------------------------------------------------------------
// Requests waiting on dispatch, oldest first -- the part of the tab that is a
// job to do rather than a picture to look at.
//
// Each one carries the planner's verdict when the host supplies it, right
// above the Approve button: "Can't make it -- earliest home Wed 10:07 AM".
// Approving is still allowed (the driver might take a later flight home, or
// dispatch might swap loads), but not without having seen it.
// ---------------------------------------------------------------------------
export default function DecisionList({ stays, drivers, now, verdictFor, busyId, onApprove, onDecline }: {
  stays: Stay[]
  drivers: ScheduleDriver[]
  now: string
  verdictFor?: ((stay: Stay) => StayVerdict | null) | null
  busyId: string | null
  onApprove: (stay: Stay) => void
  onDecline: (stay: Stay) => void
}) {
  const nameOf = (code: string) => drivers.find((d) => d.driverCode === code)?.name || code

  return (
    <Paper variant="outlined">
      {stays.map((stay, i) => {
        const verdict = verdictFor ? verdictFor(stay) : null
        const busy = busyId === stay.id
        return (
          <Box key={stay.id} sx={{ p: 2, borderTop: i > 0 ? 1 : 0, borderColor: 'divider' }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'flex-start' }, justifyContent: 'space-between' }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" component="h4">{nameOf(stay.driverCode)}</Typography>
                <Typography variant="body2">
                  Home by <strong>{formatShort(stay.homeBy, now)}</strong>, back out {formatShort(stay.backOut, now)}
                  <Box component="span" sx={{ color: 'text.secondary' }}> · {formatDuration(stayLength(stay))} at home</Box>
                </Typography>
                {stay.note && <Typography variant="body2" sx={{ fontStyle: 'italic', mt: 0.5 }}>“{stay.note}”</Typography>}
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Asked {formatAgo(minutesSince(stay.requestedAt, now))}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                <Button variant="contained" size="small" disabled={busy} onClick={() => onApprove(stay)}>Approve</Button>
                <Button variant="outlined" size="small" color="error" disabled={busy} onClick={() => onDecline(stay)}>Decline</Button>
              </Stack>
            </Stack>
            {verdict && (
              <Alert severity={verdict.severity} variant="outlined" sx={{ mt: 1.5, py: 0 }}>
                {verdict.text}
              </Alert>
            )}
          </Box>
        )
      })}
    </Paper>
  )
}
