import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material'
import { homeTimeFor } from './rules.ts'
import { STAY_LOOK } from './status.ts'
import { formatShort, formatWhen } from './format.ts'
import type { ScheduleData, Stay } from './contract.ts'

// ---------------------------------------------------------------------------
// PIECE: one driver's stays, as they see them -- what is coming up, what
// dispatch said (a decline's reason included), what happened -- and the
// buttons to ask for more or withdraw a request. Data in, callbacks out;
// DriverHomeTime is the module that loads it.
// ---------------------------------------------------------------------------
export interface DriverStaysProps {
  data: ScheduleData
  driverCode: string
  now: string
  busyId?: string | null
  onRequest?: (() => void) | null
  onCancel?: ((stay: Stay) => void) | null
}

export default function DriverStays({ data, driverCode, now, busyId = null, onRequest = null, onCancel = null }: DriverStaysProps) {
  const mine = data.stays
    .filter((s) => s.driverCode === driverCode)
    .sort((a, b) => Date.parse(b.homeBy) - Date.parse(a.homeBy))
  const upcoming = mine.filter((s) => s.status === 'REQUESTED' || s.status === 'APPROVED' || s.status === 'HOME')
  const history = mine.filter((s) => !upcoming.includes(s)).slice(0, 5)
  const driver = data.drivers.find((d) => d.driverCode === driverCode)
  const last = driver?.lastHomeAt !== undefined ? driver.lastHomeAt : homeTimeFor(mine, driverCode, now).lastHomeAt
  const out = last ? Math.floor((Date.parse(now) - Date.parse(last)) / 86400000) : null

  return (
    <Box sx={{ maxWidth: 640 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2, gap: 2 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {out === null ? 'No record of your last time home.' : out === 0 ? 'You are home.' : `Out ${out} day${out === 1 ? '' : 's'} since you were last home.`}
        </Typography>
        {onRequest && <Button variant="contained" onClick={onRequest}>Request home time</Button>}
      </Stack>

      <Typography variant="subtitle1" component="h3" sx={{ mb: 1 }}>Coming up</Typography>
      {upcoming.length === 0
        ? <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>Nothing requested yet.</Typography>
        : <StayList stays={upcoming} now={now} busyId={busyId} onCancel={onCancel} />}

      {history.length > 0 && (
        <>
          <Typography variant="subtitle1" component="h3" sx={{ mt: 3, mb: 1 }}>Recent</Typography>
          <StayList stays={history} now={now} busyId={busyId} onCancel={null} />
        </>
      )}
    </Box>
  )
}

function StayList({ stays, now, busyId, onCancel }: {
  stays: Stay[]
  now: string
  busyId: string | null
  onCancel: ((stay: Stay) => void) | null
}) {
  return (
    <Paper variant="outlined">
      {stays.map((s, i) => {
        const look = STAY_LOOK[s.status]
        const cancellable = onCancel && (s.status === 'REQUESTED' || s.status === 'APPROVED')
        return (
          <Box key={s.id} sx={{ p: 1.5, borderTop: i > 0 ? 1 : 0, borderColor: 'divider', display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2">
                Home by <strong title={formatWhen(s.homeBy)}>{formatShort(s.homeBy, now)}</strong>, back out {formatShort(s.backOut, now)}
              </Typography>
              {s.note && <Typography variant="body2" sx={{ fontStyle: 'italic' }}>“{s.note}”</Typography>}
              {s.declineReason && <Typography variant="body2" sx={{ color: 'error.main' }}>Dispatch: {s.declineReason}</Typography>}
            </Box>
            <Chip size="small" label={look.label} color={look.chip.color} variant={look.chip.variant} />
            {cancellable && (
              <Button size="small" color="error" disabled={busyId === s.id} onClick={() => onCancel(s)}>Cancel</Button>
            )}
          </Box>
        )
      })}
    </Paper>
  )
}
