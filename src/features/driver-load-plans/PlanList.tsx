import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material'
import LegChip from './LegChip.tsx'
import { planWithLegs, plainDrive, summarize } from './rules.ts'
import { LOAD_LOOK, STAY_LOOK } from './look.ts'
import { formatDuration, formatMiles, formatMoney, formatShort, formatWindow, lane, placeName } from './format.ts'
import type { DriveFn, Leg, PlannedLoad } from './rules.ts'
import type { LoadPlanData, PlanLoad } from './contract.ts'

// ---------------------------------------------------------------------------
// One driver's plan, load by load: the one under way, then the ones lined up
// -- and for each, the empty miles to reach it, when the truck gets there,
// and whether that is in the pickup window. Home time the plan runs into, and
// loads that overlap each other, are said out loud on the load they spoil.
//
// Draws from any LoadPlanData that holds the driver: their own scoped read,
// or the whole board. Worked out by rules.ts; this only lays it out.
// ---------------------------------------------------------------------------
export interface PlanListProps {
  data: LoadPlanData
  driverCode: string
  now: string
  /** The host's hours model (see rules.ts). Without it, legs are driving time. */
  drive?: DriveFn | null
  /** Draw this load out -- the one clicked on the board, say. */
  highlightId?: string | null
  busyId?: string | null
  /** Take a planned load back off. Left out, no button is offered. */
  onTakeBack?: ((load: PlanLoad) => void) | null
}

export default function PlanList({ data, driverCode, now, drive = null, highlightId = null, busyId = null, onTakeBack = null }: PlanListProps) {
  const driver = data.drivers.find((d) => d.driverCode === driverCode)
  const planned = planWithLegs(data, driverCode, { now, drive: drive ?? plainDrive })
  const totals = summarize(planned)
  const stays = data.stays.filter((s) => s.driverCode === driverCode)

  return (
    <Box>
      <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
        {driver?.name || driverCode}
        {driver?.unitNo && <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}> · {driver.unitNo}</Box>}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {driver?.position
          ? <>Near {placeName(driver.position)}{driver.position.reportedAt ? `, ${formatShort(driver.position.reportedAt, now)}` : ''}</>
          : 'GeoTab has no position for this truck.'}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        {totals.loads === 0
          ? 'Nothing planned.'
          : `${totals.loads} load${totals.loads === 1 ? '' : 's'} · ${formatMiles(totals.loadedMiles)} loaded · ${formatMiles(totals.deadheadMiles)} empty`}
      </Typography>

      {stays.length > 0 && (
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mt: 1 }}>
          {stays.map((s) => (
            <Chip key={`${s.homeBy}-${s.status}`} size="small" variant="outlined" color={s.status === 'HOME' ? 'success' : 'info'}
              label={`${STAY_LOOK[s.status].label}: ${formatWindow(s.homeBy, s.backOut, now)}`} />
          ))}
        </Stack>
      )}

      <Stack spacing={1.5} sx={{ mt: 2 }}>
        {planned.map((p) => (
          <LoadCard key={p.load.id} planned={p} now={now} highlighted={p.load.id === highlightId}
            busy={busyId === p.load.id} onTakeBack={onTakeBack} />
        ))}
      </Stack>
    </Box>
  )
}

function LoadCard({ planned, now, highlighted, busy, onTakeBack }: {
  planned: PlannedLoad
  now: string
  highlighted: boolean
  busy: boolean
  onTakeBack: ((load: PlanLoad) => void) | null
}) {
  const { load, leg, conflicts, overlapsLoad } = planned
  const money = formatMoney(load.rate)
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderColor: highlighted ? 'primary.main' : 'divider', borderWidth: highlighted ? 2 : 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
        <Typography variant="subtitle2" component="h4">{load.id}</Typography>
        <Chip size="small" variant={load.status === 'In Transit' ? 'filled' : 'outlined'} color="primary" label={LOAD_LOOK[load.status].label} />
        <LegChip leg={leg} />
        <Box sx={{ flex: 1 }} />
        {onTakeBack && load.status === 'Covered' && (
          <Button size="small" variant="outlined" color="inherit" disabled={busy} onClick={() => onTakeBack(load)}>Take back</Button>
        )}
      </Stack>
      <Typography variant="body2" sx={{ mt: 0.75, fontWeight: 500 }}>{lane(load)}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        Pick up {formatWindow(load.pickupStart, load.pickupEnd, now)} · deliver {formatWindow(load.deliveryStart, load.deliveryEnd, now)}
      </Typography>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
        {[formatMiles(load.miles), load.equipment, money].filter(Boolean).join(' · ')}
      </Typography>

      {leg && <LegLine leg={leg} now={now} />}

      {conflicts.map((s) => (
        <Alert key={s.homeBy} severity="error" variant="outlined" sx={{ mt: 1, py: 0 }}>
          Runs into {s.status === 'HOME' ? 'the time this driver is home' : 'approved home time'}: {formatWindow(s.homeBy, s.backOut, now)}.
        </Alert>
      ))}
      {overlapsLoad && (
        <Alert severity="error" variant="outlined" sx={{ mt: 1, py: 0 }}>Overlaps {overlapsLoad}: one truck, two loads at once.</Alert>
      )}
    </Paper>
  )
}

// "Empty from Joliet, IL: 0 mi, there Mon 4:00 PM" -- the leg into a load.
export function LegLine({ leg, now }: { leg: Leg; now: string }) {
  const from = leg.after.kind === 'load' ? `where ${leg.after.loadId} delivers` : leg.after.kind === 'home' ? 'home' : 'where the truck is'
  return (
    <Box sx={{ mt: 1, pl: 1, borderLeft: 3, borderColor: leg.verdict === 'LATE' ? 'error.main' : leg.verdict === 'TIGHT' ? 'warning.main' : 'divider' }}>
      {leg.verdict === 'UNKNOWN' ? (
        <Typography variant="body2">{leg.unknownBecause}</Typography>
      ) : (
        <Typography variant="body2">
          {formatMiles(leg.deadheadMiles)} empty from {from} ({placeName(leg.from)}), free {formatShort(leg.readyAt, now)} ·
          at the pickup <strong>{formatShort(leg.arriveAt, now)}</strong>
          {leg.restSeconds > 0 && <> · after {formatDuration(leg.restSeconds)} of rest</>}
        </Typography>
      )}
      {leg.timingNote && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{leg.timingNote}</Typography>}
    </Box>
  )
}
