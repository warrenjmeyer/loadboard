import { Box, Typography } from '@mui/material'
import { barFor, boardWindow, freeCounts, loadSpan, planWithLegs, plainDrive, positionOf, staySpan, summarize } from './rules.ts'
import { LOAD_LOOK, STAY_LOOK, VERDICT_LOOK } from './look.ts'
import { dayHeading, formatEmpty, formatMiles, formatWhen, formatWindow, lane } from './format.ts'
import type { BoardWindow, DriveFn, PlannedLoad } from './rules.ts'
import type { LoadPlanData, PlanLoad } from './contract.ts'

// ---------------------------------------------------------------------------
// A week of plans: drivers down the side, seven days across from today.
//
// Each driver's row holds, back to front: their home time (shaded), the
// empty miles into each load (a dotted line, from when the truck is free to
// when it reaches the pickup), and the loads themselves -- filled when under
// way, outlined when lined up, with a coloured edge when the leg into them is
// TIGHT or LATE and a red outline when they run into home time.
//
// The row of numbers under the dates is what a week of plans is for: how
// many trucks have nothing on that day. Positions come from barFor in
// rules.ts; this component only turns fractions into percentages.
// ---------------------------------------------------------------------------
const NAME_WIDTH = 180
const DAY_WIDTH = 104

export interface PlanTimelineProps {
  data: LoadPlanData
  now: string
  /** The host's hours model (see rules.ts). Without it, legs are driving time. */
  drive?: DriveFn | null
  onOpenDriver?: ((driverCode: string) => void) | null
  onOpenLoad?: ((load: PlanLoad) => void) | null
}

export default function PlanTimeline({ data, now, drive = null, onOpenDriver = null, onOpenLoad = null }: PlanTimelineProps) {
  const board = boardWindow(now)
  const free = freeCounts(data, board)
  const today = positionOf(now, board)
  const nowMs = Date.parse(now)
  const ordered = [...data.drivers].sort((a, b) => a.name.localeCompare(b.name))
  const columns = `${NAME_WIDTH}px repeat(${board.days.length}, minmax(${DAY_WIDTH}px, 1fr))`

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: columns, minWidth: NAME_WIDTH + board.days.length * DAY_WIDTH }}>
        {/* Dates */}
        <Box />
        {board.days.map((day) => {
          const { weekday, date } = dayHeading(day.start)
          const isToday = nowMs >= day.start && nowMs < day.end
          return (
            <Box key={day.start} sx={{ textAlign: 'center', py: 0.5, bgcolor: day.weekend ? 'action.hover' : undefined }}>
              <Box sx={{ typography: 'caption', color: isToday ? 'primary.main' : 'text.secondary', fontWeight: isToday ? 700 : undefined }}>{weekday}</Box>
              <Box sx={{ typography: 'body2', color: isToday ? 'primary.main' : undefined, fontWeight: isToday ? 700 : undefined }}>{date}</Box>
            </Box>
          )
        })}

        {/* Trucks with nothing on */}
        <Box sx={{ typography: 'caption', color: 'text.secondary', py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
          Trucks free
        </Box>
        {free.map((n, i) => (
          <Box key={board.days[i]!.start} sx={{
            typography: 'caption', textAlign: 'center', py: 0.5, borderBottom: 1, borderColor: 'divider',
            bgcolor: board.days[i]!.weekend ? 'action.hover' : undefined,
            color: n > 0 ? 'text.primary' : 'text.disabled', fontWeight: n > 0 ? 600 : undefined,
          }}>
            {n}
          </Box>
        ))}

        {/* One row per driver */}
        {ordered.map((driver) => {
          const planned = planWithLegs(data, driver.driverCode, { now, drive: drive ?? plainDrive })
          const totals = summarize(planned)
          const stays = data.stays.filter((s) => s.driverCode === driver.driverCode)
          const flags = [totals.late && `${totals.late} late`, totals.clashes && `${totals.clashes} clash${totals.clashes === 1 ? '' : 'es'}`].filter(Boolean).join(' · ')
          return (
            <Box key={driver.driverCode} sx={{ display: 'contents' }}>
              <Box
                component={onOpenDriver ? 'button' : 'div'}
                type={onOpenDriver ? 'button' : undefined}
                onClick={onOpenDriver ? () => onOpenDriver(driver.driverCode) : undefined}
                aria-label={onOpenDriver ? `${driver.name}'s plan` : undefined}
                sx={{
                  py: 0.75, pr: 1, pl: 0, minWidth: 0, textAlign: 'left', bgcolor: 'transparent', font: 'inherit', color: 'inherit',
                  border: 'none', borderBottom: 1, borderColor: 'divider',
                  cursor: onOpenDriver ? 'pointer' : undefined,
                  '&:hover': onOpenDriver ? { bgcolor: 'action.hover' } : undefined,
                  '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineOffset: -2 },
                }}
              >
                <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>{driver.name}</Typography>
                <Typography variant="caption" noWrap component="div" sx={{ color: 'text.secondary' }}>
                  {totals.loads === 0 ? 'nothing planned' : [`${totals.loads} load${totals.loads === 1 ? '' : 's'}`, formatEmpty(totals)].filter(Boolean).join(' · ')}
                </Typography>
                {flags && <Typography variant="caption" noWrap component="div" sx={{ color: 'error.main', fontWeight: 600 }}>{flags}</Typography>}
              </Box>
              <Box sx={{ gridColumn: '2 / -1', position: 'relative', borderBottom: 1, borderColor: 'divider', minHeight: 52 }}>
                {board.days.map((day, i) => day.weekend && (
                  <Box key={day.start} sx={{
                    position: 'absolute', top: 0, bottom: 0, bgcolor: 'action.hover',
                    left: `${(i / board.days.length) * 100}%`, width: `${100 / board.days.length}%`,
                  }} />
                ))}
                {stays.map((s) => {
                  const place = barFor(staySpan(s), board)
                  const look = STAY_LOOK[s.status]
                  return place && (
                    <Box key={s.homeBy} title={`${look.label}: ${formatWindow(s.homeBy, s.backOut, now)}`} sx={{
                      position: 'absolute', top: 0, bottom: 0, left: `${place.left * 100}%`, width: `${place.width * 100}%`,
                      bgcolor: look.fill, opacity: 0.45,
                    }}>
                      <Box sx={{ position: 'absolute', left: 4, bottom: 1, typography: 'caption', fontSize: 10, color: 'text.primary', whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '100%' }}>
                        {look.label}
                      </Box>
                    </Box>
                  )
                })}
                {today !== null && (
                  <Box aria-hidden="true" sx={{ position: 'absolute', top: 0, bottom: 0, left: `${today * 100}%`, width: 2, bgcolor: 'error.main', opacity: 0.6, zIndex: 3 }} />
                )}
                {planned.map((p) => <Deadhead key={`dh-${p.load.id}`} planned={p} board={board} />)}
                {planned.map((p) => <LoadBar key={p.load.id} planned={p} board={board} onOpen={onOpenLoad} />)}
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

// The empty miles into a load: a dotted line from free to at the pickup.
function Deadhead({ planned, board }: { planned: PlannedLoad; board: BoardWindow }) {
  const leg = planned.leg
  if (!leg || !leg.arriveAt || !leg.deadheadMiles) return null
  const place = barFor({ start: Date.parse(leg.readyAt), end: Date.parse(leg.arriveAt) }, board)
  if (!place) return null
  return (
    <Box title={`${formatMiles(leg.deadheadMiles)} empty to ${planned.load.origin.place || 'the pickup'}`} sx={{
      position: 'absolute', top: '50%', height: 0, zIndex: 1,
      left: `${place.left * 100}%`, width: `${place.width * 100}%`,
      borderTop: 2, borderTopStyle: 'dotted', borderColor: VERDICT_LOOK[leg.verdict].mark || 'text.secondary',
    }} />
  )
}

function LoadBar({ planned, board, onOpen }: {
  planned: PlannedLoad
  board: BoardWindow
  onOpen: ((load: PlanLoad) => void) | null
}) {
  const { load, leg, conflicts, overlapsLoad } = planned
  const place = barFor(loadSpan(load), board)
  const bar = LOAD_LOOK[load.status].bar
  if (!place || !bar) return null
  const clash = conflicts.length > 0 || overlapsLoad !== null
  const mark = leg ? VERDICT_LOOK[leg.verdict].mark : null
  const said = [
    `${load.id}, ${lane(load)}`,
    LOAD_LOOK[load.status].label.toLowerCase(),
    `pick up ${formatWhen(load.pickupStart)}`,
    leg && VERDICT_LOOK[leg.verdict].label.toLowerCase(),
    conflicts.length > 0 && 'runs into home time',
    overlapsLoad && `overlaps ${overlapsLoad}`,
  ].filter(Boolean).join(', ')

  return (
    <Box
      component={onOpen ? 'button' : 'div'}
      type={onOpen ? 'button' : undefined}
      onClick={onOpen ? () => onOpen(load) : undefined}
      aria-label={said}
      title={said}
      sx={{
        position: 'absolute', top: 10, bottom: 10, zIndex: 2,
        left: `${place.left * 100}%`, width: `calc(${place.width * 100}% - 2px)`, minWidth: 8,
        bgcolor: bar.fill || 'background.paper', color: bar.text,
        border: clash ? 2 : 1.5, borderColor: clash ? 'error.main' : bar.border,
        borderLeftWidth: mark ? 5 : undefined, borderLeftColor: mark || undefined,
        borderRadius: 1,
        borderTopLeftRadius: place.clippedStart ? 0 : undefined, borderBottomLeftRadius: place.clippedStart ? 0 : undefined,
        borderTopRightRadius: place.clippedEnd ? 0 : undefined, borderBottomRightRadius: place.clippedEnd ? 0 : undefined,
        font: 'inherit', typography: 'caption', fontWeight: 600, textAlign: 'left', lineHeight: 1.2,
        px: 0.75, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
        cursor: onOpen ? 'pointer' : undefined,
        '&:hover': onOpen ? { filter: 'brightness(0.95)' } : undefined,
        '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineOffset: 1 },
      }}
    >
      {load.id} <Box component="span" sx={{ fontWeight: 400 }}>{lane(load)}</Box>
    </Box>
  )
}
