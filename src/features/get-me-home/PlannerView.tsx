import { useMemo, useState } from 'react'
import { Alert, Box, Button, LinearProgress, Paper, Stack, Typography } from '@mui/material'
import RosterTable from './RosterTable.tsx'
import DriverPlan from './DriverPlan.tsx'
import StatusChip from './StatusChip.tsx'
import { planRoster, ESTIMATE } from './planHome.ts'
import { ATTENTION } from './status.ts'
import { formatWhen } from './format.ts'
import type { Roster } from './contract.ts'

// ---------------------------------------------------------------------------
// The planner's screen, given a roster. It fetches nothing.
//
// Split from GetMeHomePlanner so the screen can be drawn from plain data --
// by the render check, by a design preview, or by a host app that would
// rather load the roster its own way (react-query, a parent that already
// has it) and skip the adapter altogether.
//
// Shaped for a TAB PANEL: no page title (the tab is the title), no
// organisation picker (the host's header already chose one), no routes. It
// fills the width it is given and stacks the plan under the table when that
// width runs out.
//
// "The width it is given" is meant literally. The side-by-side layout
// switches on a CONTAINER query -- the planner's own width -- not on the
// window's. On the host this is a tab inside someone else's page, with
// whatever navigation drawer they have beside it, and a 1,600-pixel window
// with a drawer open is not 1,600 pixels of planner.
// ---------------------------------------------------------------------------

// The table needs about a thousand pixels before it has to scroll sideways,
// and the plan about four hundred. Below the sum of the two, they stack.
const SIDE_BY_SIDE = '@container (min-width: 1440px)'
const PLAN_WIDTH = 420

export interface PlannerViewProps {
  roster?: Roster | null
  loading?: boolean
  error?: string | null
  /** Pin the clock (previews, tests). Leave it out in production. */
  now?: string | null
  onRefresh?: (() => void) | null
}

export default function PlannerView({ roster = null, loading = false, error = null, now = null, onRefresh = null }: PlannerViewProps) {
  // Derived, not stored: the plans are a function of the roster and the
  // moment, and are recomputed whenever either changes.
  const result = useMemo(() => (roster ? planRoster(roster, { now: now || undefined }) : null), [roster, now])
  const plans = result ? result.plans : []

  // Held by driver code, not by index, so a refresh that reorders the roster
  // keeps the same driver open. Nothing picked means the most urgent one.
  const [picked, setPicked] = useState<string | null>(null)
  const selected = plans.find((p) => p.driverCode === picked) || plans[0] || null

  const estimated = plans.some((p) => p.route?.source === 'estimate')

  return (
    <Box sx={{ containerType: 'inline-size' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between', mb: 2 }}
      >
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {result
            ? `${plans.length} driver${plans.length === 1 ? '' : 's'} · as of ${formatWhen(result.asOf)}`
            : loading ? 'Loading the roster…' : ''}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          {result && ATTENTION.filter((s) => result.counts[s]).map((s) => (
            <StatusChip key={s} status={s} count={result.counts[s]} />
          ))}
          {onRefresh && (
            <Button size="small" variant="outlined" onClick={onRefresh} disabled={loading}>
              Refresh
            </Button>
          )}
        </Stack>
      </Stack>

      {/* Kept above the content during a refresh rather than replacing it:
          the old plans stay readable while the new ones arrive. */}
      {loading && <LinearProgress sx={{ mb: 2 }} aria-label="Loading the roster" />}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load the roster: {error}
        </Alert>
      )}

      {result && plans.length === 0 && (
        <Alert severity="info">There are no drivers to plan for.</Alert>
      )}

      {result && plans.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, [SIDE_BY_SIDE]: { flexDirection: 'row', alignItems: 'flex-start' } }}>
          <Paper variant="outlined" sx={{ flex: '1 1 auto', minWidth: 0 }}>
            <RosterTable plans={plans} asOf={result.asOf} selectedCode={selected?.driverCode} onSelect={setPicked} />
          </Paper>
          <Box sx={{ flex: '0 0 auto', minWidth: 0, [SIDE_BY_SIDE]: { width: PLAN_WIDTH } }}>
            <DriverPlan plan={selected} />
          </Box>
        </Box>
      )}

      {plans.length > 0 && (
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 2 }}>
          Times are in your time zone.
          {estimated && ` Miles marked (est.) are a straight line × ${ESTIMATE.roadFactor} at ${ESTIMATE.mph} mph, not a truck route.`}
          {' '}Rests follow the US 11/14/70-hour rules and never make an arrival look earlier than it is.
        </Typography>
      )}
    </Box>
  )
}
