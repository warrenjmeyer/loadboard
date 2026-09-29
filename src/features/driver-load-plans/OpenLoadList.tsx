import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material'
import { pickupCloses } from './rules.ts'
import { formatMiles, formatMoney, formatWindow, lane } from './format.ts'
import type { PlanLoad } from './contract.ts'

// ---------------------------------------------------------------------------
// Loads nobody is hauling yet, the soonest pickup first -- the part of the
// tab that is a job to do. Each has "Find a driver", which is where the
// suggesting happens; this list only says what is waiting and how soon.
// ---------------------------------------------------------------------------
const SOON_MS = 12 * 3600 * 1000

export interface OpenLoadListProps {
  loads: PlanLoad[]
  now: string
  /** Rank drivers for this load. Left out, no button is offered. */
  onFindDriver?: ((load: PlanLoad) => void) | null
}

export default function OpenLoadList({ loads, now, onFindDriver = null }: OpenLoadListProps) {
  const nowMs = Date.parse(now)
  const open = loads
    .filter((l) => l.status === 'Available')
    .sort((a, b) => {
      const ca = pickupCloses(a)
      const cb = pickupCloses(b)
      // Compared, not subtracted: two loads with no window would be NaN apart.
      if (ca !== cb) return ca === null ? 1 : cb === null ? -1 : ca - cb
      return a.id.localeCompare(b.id)
    })

  if (open.length === 0) {
    return <Typography variant="body2" sx={{ color: 'text.secondary' }}>No open loads this week. Every load has a driver.</Typography>
  }

  return (
    <Paper variant="outlined">
      {open.map((load, i) => {
        const closes = pickupCloses(load)
        const left = closes === null ? null : closes - nowMs
        const money = formatMoney(load.rate)
        return (
          <Box key={load.id} sx={{ p: 1.5, borderTop: i > 0 ? 1 : 0, borderColor: 'divider' }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                  <Typography variant="subtitle2" component="h4">{load.id}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>{lane(load)}</Typography>
                  {left !== null && left < 0 && <Chip size="small" color="error" label="Pickup window passed" />}
                  {left !== null && left >= 0 && left < SOON_MS && <Chip size="small" color="warning" label="Picks up soon" />}
                </Stack>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Pick up {formatWindow(load.pickupStart, load.pickupEnd, now)} · deliver {formatWindow(load.deliveryStart, load.deliveryEnd, now)}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {[formatMiles(load.miles), load.equipment, money].filter(Boolean).join(' · ')}
                </Typography>
              </Box>
              {onFindDriver && (
                <Button size="small" variant="outlined" sx={{ flexShrink: 0, alignSelf: { xs: 'flex-start', sm: 'center' } }} onClick={() => onFindDriver(load)}>
                  Find a driver
                </Button>
              )}
            </Stack>
          </Box>
        )
      })}
    </Paper>
  )
}
