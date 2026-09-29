import { useState } from 'react'
import { Alert, Box, LinearProgress, Paper, Typography } from '@mui/material'
import Board from './Board.tsx'
import StayDetails from './StayDetails.tsx'
import { boardWindow, homeCounts } from './rules.ts'
import { useScheduleRead } from './useScheduleRead.ts'
import type { ScheduleAdapter, Stay, StayVerdict } from './contract.ts'

// ---------------------------------------------------------------------------
// MODULE: two weeks of who is home when, with a count of drivers home each
// day. Click a stay for StayDetails.
//
//   <ScheduleBoard adapter={a} />
//
// Reads every driver and only the stays in its window (loadBoard, from/to)
// -- not a year of history to draw fourteen days. Days out still show,
// because a scoped driver carries lastHomeAt.
//
// `now` sets the window; leave it out in production. The sample data pins
// its clock, so the preview passes it.
//
// Piece: Board.
// ---------------------------------------------------------------------------
export interface ScheduleBoardProps {
  adapter: ScheduleAdapter
  organizationId?: string | null
  now?: string | null
  verdictFor?: ((stay: Stay) => StayVerdict | null) | null
}

export default function ScheduleBoard({ adapter, organizationId = null, now = null, verdictFor = null }: ScheduleBoardProps) {
  const asOf = now || new Date().toISOString()
  const board = boardWindow(asOf)
  const from = new Date(board.start).toISOString()
  const to = new Date(board.end).toISOString()

  const { data, loading, error } = useScheduleRead(
    (signal) => adapter.loadBoard({ organizationId, from, to, signal }),
    [adapter, organizationId, from, to],
  )
  const [openId, setOpenId] = useState<string | null>(null)

  const nowMs = Date.parse(asOf)
  const todayIndex = board.days.findIndex((d) => nowMs >= d.start && nowMs < d.end)
  const homeToday = data && todayIndex >= 0 ? homeCounts(data.stays, board)[todayIndex] ?? 0 : null

  return (
    <Box>
      {loading && <LinearProgress sx={{ mb: 1 }} aria-label="Loading the board" />}
      {error && <Alert severity="error" sx={{ mb: 1 }}>Could not load the board: {error}</Alert>}
      {data && (
        <>
          {homeToday !== null && (
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>{homeToday} home today</Typography>
          )}
          <Paper variant="outlined" sx={{ p: 1 }}>
            <Board drivers={data.drivers} stays={data.stays} now={asOf} onOpen={(s) => setOpenId(s.id)} />
          </Paper>
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1 }}>
            Dashed: asked for. Filled: approved. Green: home now. Grey: was home. Times are in your time zone.
          </Typography>
        </>
      )}
      <StayDetails adapter={adapter} organizationId={organizationId} stayId={openId} verdictFor={verdictFor} onClose={() => setOpenId(null)} />
    </Box>
  )
}
