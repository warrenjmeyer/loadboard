import { Chip } from '@mui/material'
import { VERDICT_LOOK } from './look.ts'
import { formatDuration } from './format.ts'
import type { Leg } from './rules.ts'

// ---------------------------------------------------------------------------
// MODULE (its own piece): whether a truck reaches a pickup in time, as a chip.
//
//   <LegChip leg={leg} />              "Late by 9h 30m"
//   <LegChip leg={leg} compact />      "Late"
//
// Shows no data of its own, so it has no wrapper -- the planner's StatusChip
// is the same kind of module. A null leg is a load already under way.
// ---------------------------------------------------------------------------
export default function LegChip({ leg, compact = false }: { leg: Leg | null; compact?: boolean }) {
  if (!leg) return <Chip size="small" variant="outlined" color="primary" label="Under way" />
  const look = VERDICT_LOOK[leg.verdict]
  const slack = leg.slackSeconds
  let label = look.label
  if (!compact && slack !== null) {
    if (leg.verdict === 'LATE') label = `Late by ${formatDuration(-slack)}`
    else if (leg.verdict === 'ON_TIME' || leg.verdict === 'TIGHT') label = `${look.label} · ${formatDuration(slack)} to spare`
  }
  return (
    <Chip
      size="small"
      color={look.color}
      variant={leg.verdict === 'ON_TIME' ? 'outlined' : 'filled'}
      label={label}
      // "Can't tell" alone reads as a shrug; the reason is a hover away.
      title={leg.unknownBecause || leg.timingNote || undefined}
    />
  )
}
