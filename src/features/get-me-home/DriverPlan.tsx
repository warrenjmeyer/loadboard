import { Alert, Box, Card, CardContent, Divider, Stack, Typography } from '@mui/material'
import StatusChip from './StatusChip.tsx'
import { BLOCK } from './status.ts'
import { formatDuration, formatMiles, formatTime, formatWhen, sameDay } from './format.ts'
import type { Block, Plan } from './planHome.ts'
import type { Place } from './contract.ts'

// ---------------------------------------------------------------------------
// One driver's trip home, laid out: where it starts, how far, every drive
// and every rest in order, and when they walk in the door.
//
// The rests are the point. "900 miles" sounds like tomorrow; "900 miles, two
// ten-hour rests and a restart" is Thursday, and the difference is exactly
// what a dispatcher has to tell the driver on the phone.
// ---------------------------------------------------------------------------
export default function DriverPlan({ plan }: { plan: Plan | null }) {
  if (!plan) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Pick a driver to see their trip home.
          </Typography>
        </CardContent>
      </Card>
    )
  }

  const { schedule } = plan
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" component="h3">{plan.name}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {[plan.unitNo, plan.jobType, plan.home?.place && `home ${plan.home.place}`].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
          <StatusChip status={plan.status} />
        </Stack>

        {plan.note && (
          <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>
            “{plan.note}”
          </Typography>
        )}

        <Facts plan={plan} />

        {schedule && schedule.blocks.length > 0 && plan.status !== 'home' && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" component="h4">The trip home</Typography>
            <TripBar blocks={schedule.blocks} />
            <Timeline blocks={schedule.blocks} arriveAt={schedule.arriveAt} home={plan.home} />
          </>
        )}

        {plan.warnings.length > 0 && (
          <Stack spacing={1} sx={{ mt: 2 }}>
            {plan.warnings.map((w) => (
              <Alert key={w.code} severity={w.level} variant="outlined">
                {w.text}
              </Alert>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  )
}

// The numbers, as label and value. A grid rather than a table: two columns
// of prose, not data anybody sorts.
function Facts({ plan }: { plan: Plan }) {
  const { start, route, schedule } = plan
  const rows: [label: string, value: string][] = []

  if (start) {
    rows.push(['Starts from', start.from === 'final-stop'
      ? `${start.place || 'the last stop'}, after delivering ${start.loadId || 'the current load'} · ${formatWhen(start.at)}`
      : `${start.place || 'where the truck is'} · now`])
  }
  if (route) {
    const drive = `${formatMiles(route.miles)} mi · ${formatDuration(route.driveSeconds)} driving`
    rows.push(['Distance', route.source === 'estimate' ? `${drive} (estimate)` : `${drive} (${route.source})`])
  }
  if (schedule && schedule.offSeconds > 0) {
    const parts = [
      schedule.rests > 0 && `${schedule.rests} rest${schedule.rests === 1 ? '' : 's'}`,
      schedule.restarts > 0 && `${schedule.restarts} restart`,
    ].filter(Boolean).join(', ')
    rows.push(['Off duty on the way', `${formatDuration(schedule.offSeconds)}${parts ? ` (${parts})` : ''}`])
  }
  if (schedule && plan.status !== 'home') rows.push(['Earliest home', formatWhen(schedule.arriveAt)])
  rows.push(['Asked to be home by', plan.requestedBy ? formatWhen(plan.requestedBy) : 'No request open'])
  if (plan.slackSeconds !== null) {
    rows.push(plan.slackSeconds < 0
      ? ['Short by', formatDuration(-plan.slackSeconds)]
      : ['Start home by', `${formatWhen(plan.leaveBy)} · ${formatDuration(plan.slackSeconds)} to spare`])
  }
  rows.push(['Days out', plan.daysOut === null ? 'Not known' : `${plan.daysOut} of ${plan.maxDaysOut} allowed`])

  return (
    <Box
      component="dl"
      sx={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 2, rowGap: 0.5, mt: 2, mb: 0 }}
    >
      {rows.map(([label, value]) => (
        <Box key={label} sx={{ display: 'contents' }}>
          <Box component="dt" sx={{ typography: 'body2', color: 'text.secondary' }}>{label}</Box>
          <Box component="dd" sx={{ typography: 'body2', m: 0 }}>{value}</Box>
        </Box>
      ))}
    </Box>
  )
}

// The whole trip as one bar, each block as wide as it is long. It is a
// picture of the list beneath it, so it is hidden from screen readers --
// the list says everything the bar does.
function TripBar({ blocks }: { blocks: Block[] }) {
  return (
    <Box
      aria-hidden="true"
      sx={{ display: 'flex', height: 10, borderRadius: 1, overflow: 'hidden', my: 1.5, bgcolor: 'action.hover' }}
    >
      {blocks.map((b, i) => (
        <Box
          key={i}
          sx={{
            flexGrow: b.seconds,
            flexBasis: 0,
            minWidth: 3,
            bgcolor: BLOCK[b.kind].color,
            opacity: b.assumed ? 0.5 : 1,
            borderRight: i < blocks.length - 1 ? 2 : 0,
            borderColor: 'background.paper',
          }}
        />
      ))}
    </Box>
  )
}

function Timeline({ blocks, arriveAt, home }: { blocks: Block[]; arriveAt: string; home: Place | null }) {
  return (
    <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {blocks.map((b, i) => (
        <Step key={i} color={BLOCK[b.kind].color} faded={b.assumed}
          label={blockLabel(b)}
          when={`${formatWhen(b.start)} – ${sameDay(b.start, b.end) ? formatTime(b.end) : formatWhen(b.end)}`}
        />
      ))}
      <Step color="success.main" label={`Home${home?.place ? `, ${home.place}` : ''}`} when={formatWhen(arriveAt)} strong />
    </Box>
  )
}

function Step({ color, label, when, faded = false, strong = false }: {
  color: string
  label: string
  when: string
  faded?: boolean
  strong?: boolean
}) {
  return (
    <Box component="li" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.5 }}>
      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color, opacity: faded ? 0.5 : 1, flexShrink: 0 }} />
      <Box sx={{ typography: 'body2', fontWeight: strong ? 500 : undefined, flex: 1, minWidth: 0 }}>{label}</Box>
      <Box sx={{ typography: 'body2', color: 'text.secondary', whiteSpace: 'nowrap' }}>{when}</Box>
    </Box>
  )
}

function blockLabel(b: Block): string {
  if (b.kind === 'drive') return `Drive ${formatDuration(b.seconds)}`
  if (b.kind === 'rest' && b.assumed) return '10-hour rest (assumed: hours not known)'
  if (b.kind === 'restart') return '34-hour restart (cycle spent)'
  return BLOCK[b.kind].label
}
