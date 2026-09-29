import { Box, Typography } from '@mui/material'
import { barFor, boardWindow, homeCounts, homeTimeFor, positionOf } from './rules.ts'
import { STAY_LOOK } from './status.ts'
import { dayHeading, formatWhen } from './format.ts'
import type { ScheduleDriver, Stay } from './contract.ts'
import type { BoardWindow } from './rules.ts'

// ---------------------------------------------------------------------------
// Two weeks, drivers down the side, days across the top -- three days back so
// the stays just finished are still in view, and eleven ahead.
//
// Each stay is a bar as long as it is, drawn by barFor in rules.ts: this
// component only turns fractions into percentages. The row of numbers under
// the dates is the question dispatch actually asks of a calendar: how many
// trucks are parked that day.
//
// A bar is a button: click it, or Tab to it and press Enter, for the stay.
// ---------------------------------------------------------------------------
const NAME_WIDTH = 170
const DAY_WIDTH = 56

export default function Board({ drivers, stays, now, onOpen }: {
  drivers: ScheduleDriver[]
  stays: Stay[]
  now: string
  onOpen: (stay: Stay) => void
}) {
  const board = boardWindow(now)
  const counts = homeCounts(stays, board)
  const today = positionOf(now, board)
  const nowMs = Date.parse(now)
  const ordered = [...drivers].sort((a, b) => a.name.localeCompare(b.name))
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

        {/* Trucks parked */}
        <Box sx={{ typography: 'caption', color: 'text.secondary', py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
          Drivers home
        </Box>
        {counts.map((n, i) => (
          <Box
            key={board.days[i]!.start}
            sx={{
              typography: 'caption', textAlign: 'center', py: 0.5, borderBottom: 1, borderColor: 'divider',
              bgcolor: board.days[i]!.weekend ? 'action.hover' : undefined,
              color: n > 0 ? 'text.primary' : 'text.disabled', fontWeight: n > 0 ? 600 : undefined,
            }}
          >
            {n}
          </Box>
        ))}

        {/* One row per driver */}
        {ordered.map((driver) => {
          const mine = stays.filter((s) => s.driverCode === driver.driverCode)
          const last = homeTimeFor(stays, driver.driverCode, now).lastHomeAt
          const out = last ? Math.floor((nowMs - Date.parse(last)) / 86400000) : null
          return (
            <Box key={driver.driverCode} sx={{ display: 'contents' }}>
              <Box sx={{ py: 0.75, pr: 1, borderBottom: 1, borderColor: 'divider', minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>{driver.name}</Typography>
                <Typography variant="caption" noWrap component="div" sx={{ color: 'text.secondary' }}>
                  {[driver.unitNo, out === null ? 'days out unknown' : out === 0 ? 'home' : `out ${out} d`].filter(Boolean).join(' · ')}
                </Typography>
              </Box>
              <Box sx={{ gridColumn: '2 / -1', position: 'relative', borderBottom: 1, borderColor: 'divider', minHeight: 44 }}>
                {/* Weekend shading, behind everything */}
                {board.days.map((day, i) => day.weekend && (
                  <Box key={day.start} sx={{
                    position: 'absolute', top: 0, bottom: 0, bgcolor: 'action.hover',
                    left: `${(i / board.days.length) * 100}%`, width: `${100 / board.days.length}%`,
                  }} />
                ))}
                {today !== null && (
                  <Box aria-hidden="true" sx={{ position: 'absolute', top: 0, bottom: 0, left: `${today * 100}%`, width: 2, bgcolor: 'error.main', opacity: 0.6, zIndex: 2 }} />
                )}
                {mine.map((stay) => <Bar key={stay.id} stay={stay} board={board} driverName={driver.name} onOpen={onOpen} />)}
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

function Bar({ stay, board, driverName, onOpen }: {
  stay: Stay
  board: BoardWindow
  driverName: string
  onOpen: (stay: Stay) => void
}) {
  const place = barFor(stay, board)
  const look = STAY_LOOK[stay.status]
  if (!place || !look.bar) return null
  const bar = look.bar
  const label = `${driverName}: ${look.label.toLowerCase()}, home ${formatWhen(stay.arrivedAt || stay.homeBy)} to ${formatWhen(stay.leftAt || stay.backOut)}`

  return (
    <Box
      component="button"
      type="button"
      onClick={() => onOpen(stay)}
      aria-label={label}
      title={label}
      sx={{
        position: 'absolute', top: 8, bottom: 8, zIndex: 1,
        left: `${place.left * 100}%`, width: `calc(${place.width * 100}% - 2px)`, minWidth: 6,
        bgcolor: bar.fill || 'background.paper',
        color: bar.text,
        border: 1.5, borderColor: bar.border, borderStyle: bar.dashed ? 'dashed' : 'solid',
        // A bar cut by the board's edge is square on that side: it goes on.
        borderTopLeftRadius: place.clippedStart ? 0 : 6, borderBottomLeftRadius: place.clippedStart ? 0 : 6,
        borderTopRightRadius: place.clippedEnd ? 0 : 6, borderBottomRightRadius: place.clippedEnd ? 0 : 6,
        font: 'inherit', typography: 'caption', fontWeight: 600, textAlign: 'left',
        px: 0.75, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', cursor: 'pointer',
        '&:hover': { filter: 'brightness(0.95)' },
        '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineOffset: 1 },
      }}
    >
      {look.label}
    </Box>
  )
}
