import { useState } from 'react'
import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material'
import LegChip from './LegChip.tsx'
import { LegLine } from './PlanList.tsx'
import { plainDrive, suggestDrivers, whyNot } from './rules.ts'
import { formatMiles, formatMoney, formatWindow, lane } from './format.ts'
import type { Candidate, DriveFn } from './rules.ts'
import type { LoadPlanData } from './contract.ts'

// ---------------------------------------------------------------------------
// Who should take an open load. Every driver, ranked by rules.ts: first the
// ones who can -- free then, reaching the pickup in its window, clear of
// their home time -- nearest first; then the rest, each with the reason.
//
// Assigning someone who cannot is allowed (a dispatcher may know the
// customer will wait), but it says "Assign anyway", so nobody does it
// without having seen why not.
// ---------------------------------------------------------------------------
export interface CandidateListProps {
  /** The load and every driver's plan and stays: a loadCandidates answer, or more. */
  data: LoadPlanData
  loadId: string
  now: string
  /** The host's hours model (see rules.ts). Without it, legs are driving time. */
  drive?: DriveFn | null
  busyCode?: string | null
  /** Put the load on this driver's plan. Left out, no buttons are offered. */
  onAssign?: ((driverCode: string) => void) | null
}

export default function CandidateList({ data, loadId, now, drive = null, busyCode = null, onAssign = null }: CandidateListProps) {
  const [showAll, setShowAll] = useState(false)
  const load = data.loads.find((l) => l.id === loadId)
  if (!load) return <Typography variant="body2">{loadId} no longer exists.</Typography>

  const nameOf = (code: string | null) => data.drivers.find((d) => d.driverCode === code)?.name || code
  const money = formatMoney(load.rate)
  const header = (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>{load.id}: {lane(load)}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        Pick up {formatWindow(load.pickupStart, load.pickupEnd, now)} · deliver {formatWindow(load.deliveryStart, load.deliveryEnd, now)}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {[formatMiles(load.miles), load.equipment, money].filter(Boolean).join(' · ')}
      </Typography>
    </Box>
  )

  if (load.status !== 'Available') {
    return (
      <>
        {header}
        <Alert severity="info">
          {load.id} is {load.status}{load.driverCode ? ` with ${nameOf(load.driverCode)}` : ''} now. Someone got to it first.
        </Alert>
      </>
    )
  }

  const ranked = suggestDrivers(data, loadId, { now, drive: drive ?? plainDrive })
  const can = ranked.filter((c) => c.canTake)
  const cannot = ranked.filter((c) => !c.canTake)

  return (
    <Box>
      {header}
      {can.length === 0 && <Alert severity="warning" sx={{ mb: 1.5 }}>Nobody can take this one as things stand. The reasons are below.</Alert>}
      <Stack spacing={1}>
        {can.map((c, i) => <Row key={c.driverCode} candidate={c} best={i === 0} now={now} busy={busyCode === c.driverCode} onAssign={onAssign} />)}
      </Stack>
      {cannot.length > 0 && (
        can.length > 0 && !showAll ? (
          <Button size="small" sx={{ mt: 1 }} onClick={() => setShowAll(true)}>
            Show the {cannot.length} who can't, and why
          </Button>
        ) : (
          <>
            <Typography variant="overline" component="p" sx={{ color: 'text.secondary', mt: 2 }}>Can't take it</Typography>
            <Stack spacing={1}>
              {cannot.map((c) => <Row key={c.driverCode} candidate={c} best={false} now={now} busy={busyCode === c.driverCode} onAssign={onAssign} />)}
            </Stack>
          </>
        )
      )}
    </Box>
  )
}

function Row({ candidate: c, best, now, busy, onAssign }: {
  candidate: Candidate
  best: boolean
  now: string
  busy: boolean
  onAssign: ((driverCode: string) => void) | null
}) {
  const reason = whyNot(c)
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderColor: best ? 'success.main' : 'divider' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
        <Typography variant="subtitle2" component="h4">{c.name}</Typography>
        {c.unitNo && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{c.unitNo}</Typography>}
        {/* "Suggested", not "best": the nearest who can may still be a long way off, and the miles say so. */}
        {best && <Chip size="small" color="success" label="Suggested" />}
        <LegChip leg={c.leg} />
        <Box sx={{ flex: 1 }} />
        {onAssign && (
          <Button size="small" disabled={busy} variant={c.canTake ? 'contained' : 'outlined'} color={c.canTake ? 'primary' : 'warning'}
            onClick={() => onAssign(c.driverCode)}>
            {c.canTake ? 'Assign' : 'Assign anyway'}
          </Button>
        )}
      </Stack>
      {/* An unplaced truck's reason is the leg's own words, which the line below already says. */}
      {reason && reason !== c.leg.unknownBecause && <Typography variant="body2" sx={{ color: 'error.main', mt: 0.5 }}>{reason}</Typography>}
      <LegLine leg={c.leg} now={now} />
      {c.conflicts.map((s) => (
        <Typography key={s.homeBy} variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
          {s.status === 'HOME' ? 'Home' : 'Approved home time'}: {formatWindow(s.homeBy, s.backOut, now)}
        </Typography>
      ))}
    </Paper>
  )
}
