import { Stack, Typography } from '@mui/material'
import OpenLoads from './OpenLoads.tsx'
import LoadPlanBoard from './LoadPlanBoard.tsx'
import { PlanSync } from './sync.tsx'
import type { DriveFn } from './rules.ts'
import type { LoadPlanAdapter } from './contract.ts'

// ---------------------------------------------------------------------------
// MODULE: the whole Driver Load Plans tab, for dispatch.
//
//   <DriverLoadPlans adapter={a} organizationId={org} drive={driveFor} />
//
// A composition, not a screen of its own: OpenLoads above LoadPlanBoard,
// each reading its own slice, under one PlanSync so that assigning a load up
// top redraws the week below (and taking one back below puts it back up
// top). A host that wants them apart mounts the two modules separately.
//
// `drive` is the host's hours model -- the planner's, joined in by the host
// (see src/features/preview/wiring.ts). Without it every leg is driving time
// only, and says so.
//
// Piece: LoadPlansView (the same screen drawn from data already held).
// ---------------------------------------------------------------------------
export interface DriverLoadPlansProps {
  adapter: LoadPlanAdapter
  organizationId?: string | null
  now?: string | null
  drive?: DriveFn | null
}

export default function DriverLoadPlans({ adapter, organizationId = null, now = null, drive = null }: DriverLoadPlansProps) {
  return (
    <PlanSync>
      <Stack spacing={3}>
        <section>
          <Typography variant="subtitle1" component="h3" sx={{ mb: 1 }}>Open loads</Typography>
          <OpenLoads adapter={adapter} organizationId={organizationId} now={now} drive={drive} />
        </section>
        <section>
          <Typography variant="subtitle1" component="h3" sx={{ mb: 1 }}>The next seven days</Typography>
          <LoadPlanBoard adapter={adapter} organizationId={organizationId} now={now} drive={drive} />
        </section>
      </Stack>
    </PlanSync>
  )
}
