import { Stack, Typography } from '@mui/material'
import DecisionQueue from './DecisionQueue.tsx'
import ScheduleBoard from './ScheduleBoard.tsx'
import { ScheduleSync } from './sync.tsx'
import type { ScheduleAdapter, Stay, StayVerdict } from './contract.ts'

// ---------------------------------------------------------------------------
// MODULE: the whole Driver Home Time Schedule tab, for dispatch.
//
//   <HomeTimeSchedule adapter={a} organizationId={org} verdictFor={v} />
//
// A composition, not a screen of its own: the DecisionQueue above the
// ScheduleBoard, each reading its own slice, under one ScheduleSync so that
// approving a request up top redraws the board below. A host that wants
// them apart -- the queue on a dashboard, the board on a wall screen --
// mounts the two modules separately and loses nothing.
//
// Piece: ScheduleView (the same screen drawn from data already held).
// ---------------------------------------------------------------------------
export interface HomeTimeScheduleProps {
  adapter: ScheduleAdapter
  organizationId?: string | null
  now?: string | null
  verdictFor?: ((stay: Stay) => StayVerdict | null) | null
}

export default function HomeTimeSchedule({ adapter, organizationId = null, now = null, verdictFor = null }: HomeTimeScheduleProps) {
  return (
    <ScheduleSync>
      <Stack spacing={3}>
        <section>
          <Typography variant="subtitle1" component="h3" sx={{ mb: 1 }}>Needs a decision</Typography>
          <DecisionQueue adapter={adapter} organizationId={organizationId} now={now} verdictFor={verdictFor} />
        </section>
        <section>
          <Typography variant="subtitle1" component="h3" sx={{ mb: 1 }}>The next two weeks</Typography>
          <ScheduleBoard adapter={adapter} organizationId={organizationId} now={now} verdictFor={verdictFor} />
        </section>
      </Stack>
    </ScheduleSync>
  )
}
