import { useEffect, useState } from 'react'
import { Alert, Box, Button, Chip, LinearProgress, Paper, Stack, Typography } from '@mui/material'
import RequestForm from './RequestForm.tsx'
import { homeTimeFor } from './rules.ts'
import { STAY_LOOK } from './status.ts'
import { formatShort, formatWhen } from './format.ts'
import type { NewStay, ScheduleAdapter, ScheduleData, Stay } from './contract.ts'

// ---------------------------------------------------------------------------
// THE DRIVER'S SIDE. One driver's own stays -- what they asked for, what
// dispatch said, what happened -- and the button to ask for more.
//
//   <DriverHomeTime adapter={myAdapter} driverCode={me} />
//
// Same adapter as the dispatch tab. The host decides what a driver may load
// and do (their own stays, and only request and cancel); this screen offers
// no more than that, but the server is where it is enforced.
// ---------------------------------------------------------------------------
export interface DriverHomeTimeProps {
  adapter: ScheduleAdapter
  driverCode: string
  organizationId?: string | null
  now?: string | null
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

export default function DriverHomeTime({ adapter, driverCode, organizationId = null, now = null }: DriverHomeTimeProps) {
  const [data, setData] = useState<ScheduleData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    Promise.resolve()
      .then(() => adapter.loadSchedule({ organizationId, signal: controller.signal }))
      .then((d) => { if (!controller.signal.aborted) setData(d) })
      .catch((err: unknown) => { if (!controller.signal.aborted) setError(messageOf(err)) })
    return () => controller.abort()
  }, [adapter, organizationId, driverCode])

  const asOf = now || data?.asOf || new Date().toISOString()
  const mine = (data?.stays || [])
    .filter((s) => s.driverCode === driverCode)
    .sort((a, b) => Date.parse(b.homeBy) - Date.parse(a.homeBy))
  const upcoming = mine.filter((s) => s.status === 'REQUESTED' || s.status === 'APPROVED' || s.status === 'HOME')
  const history = mine.filter((s) => !upcoming.includes(s)).slice(0, 5)
  const last = homeTimeFor(mine, driverCode, asOf).lastHomeAt
  const out = last ? Math.floor((Date.parse(asOf) - Date.parse(last)) / 86400000) : null

  async function request(stay: NewStay) {
    const stored = await adapter.requestStay(stay)
    setData((d) => (d ? { ...d, stays: [...d.stays, stored] } : d))
  }

  async function cancel(stay: Stay) {
    setBusyId(stay.id)
    setError(null)
    try {
      const stored = await adapter.actOnStay(stay.id, { type: 'cancel' })
      setData((d) => (d ? { ...d, stays: d.stays.map((s) => (s.id === stay.id ? stored : s)) } : d))
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusyId(null)
    }
  }

  if (!data && !error) return <LinearProgress aria-label="Loading your home time" />

  return (
    <Box sx={{ maxWidth: 640 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {out === null ? 'No record of your last time home.' : out === 0 ? 'You are home.' : `Out ${out} day${out === 1 ? '' : 's'} since you were last home.`}
        </Typography>
        <Button variant="contained" onClick={() => setAsking(true)} disabled={!data}>Request home time</Button>
      </Stack>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Typography variant="subtitle1" component="h3" sx={{ mb: 1 }}>Coming up</Typography>
      {upcoming.length === 0
        ? <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>Nothing requested yet.</Typography>
        : <StayList stays={upcoming} asOf={asOf} busyId={busyId} onCancel={cancel} />}

      {history.length > 0 && (
        <>
          <Typography variant="subtitle1" component="h3" sx={{ mt: 3, mb: 1 }}>Recent</Typography>
          <StayList stays={history} asOf={asOf} busyId={busyId} />
        </>
      )}

      <RequestForm
        open={asking} driverCode={driverCode} existing={mine} now={asOf}
        onSubmit={request} onClose={() => setAsking(false)}
      />
    </Box>
  )
}

function StayList({ stays, asOf, busyId, onCancel }: {
  stays: Stay[]
  asOf: string
  busyId: string | null
  onCancel?: (stay: Stay) => void
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
                Home by <strong title={formatWhen(s.homeBy)}>{formatShort(s.homeBy, asOf)}</strong>, back out {formatShort(s.backOut, asOf)}
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
