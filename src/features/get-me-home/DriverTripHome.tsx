import { useMemo } from 'react'
import { Alert, LinearProgress, Typography } from '@mui/material'
import DriverPlan from './DriverPlan.tsx'
import { planRoster } from './planHome.ts'
import { useRosterRead } from './useRosterRead.ts'
import type { Adapter } from './contract.ts'

// ---------------------------------------------------------------------------
// MODULE: one driver's trip home -- where it starts, every drive and rest,
// when they walk in the door.
//
//   <DriverTripHome adapter={a} driverCode="TBOONE" />
//
// Reads one driver (loadDriver), not the roster: a card on a driver's page
// has no business fetching the fleet. Plans them exactly as the tab does,
// because it runs the same planRoster.
//
// Piece: DriverPlan.
// ---------------------------------------------------------------------------
export interface DriverTripHomeProps {
  adapter: Adapter
  driverCode: string
  organizationId?: string | null
  now?: string | null
}

export default function DriverTripHome({ adapter, driverCode, organizationId = null, now = null }: DriverTripHomeProps) {
  const { roster, loading, error } = useRosterRead(
    (signal) => adapter.loadDriver({ organizationId, driverCode, signal }),
    [adapter, organizationId, driverCode],
  )
  const plan = useMemo(() => (roster ? planRoster(roster, { now: now || undefined }).plans[0] || null : null), [roster, now])

  if (error) return <Alert severity="error">Could not load {driverCode}: {error}</Alert>
  if (!roster) return <LinearProgress aria-label={`Loading ${driverCode}`} />
  if (!plan) return <Typography variant="body2" sx={{ color: 'text.secondary' }}>No driver {driverCode}.</Typography>
  return (
    <>
      {loading && <LinearProgress sx={{ mb: 1 }} aria-label="Refreshing" />}
      <DriverPlan plan={plan} />
    </>
  )
}
