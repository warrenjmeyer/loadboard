import { useMemo } from 'react'
import { Alert, Box, LinearProgress, Paper } from '@mui/material'
import RosterTable from './RosterTable.tsx'
import { planRoster } from './planHome.ts'
import { useRosterRead } from './useRosterRead.ts'
import type { Adapter } from './contract.ts'

// ---------------------------------------------------------------------------
// MODULE: every driver's trip home as a table, most urgent first -- without
// the plan card beside it.
//
//   <PlannerRoster adapter={a} onSelect={(code) => openDriver(code)} />
//
// For a host that shows a driver somewhere else when their row is picked (a
// driver page, DriverTripHome in a drawer). Reads the roster (loadRoster).
//
// Piece: RosterTable.
// ---------------------------------------------------------------------------
export interface PlannerRosterProps {
  adapter: Adapter
  organizationId?: string | null
  now?: string | null
  selectedCode?: string | null
  onSelect?: (driverCode: string) => void
}

export default function PlannerRoster({ adapter, organizationId = null, now = null, selectedCode = null, onSelect }: PlannerRosterProps) {
  const { roster, loading, error } = useRosterRead(
    (signal) => adapter.loadRoster({ organizationId, signal }),
    [adapter, organizationId],
  )
  const result = useMemo(() => (roster ? planRoster(roster, { now: now || undefined }) : null), [roster, now])

  return (
    <Box>
      {loading && <LinearProgress sx={{ mb: 1 }} aria-label="Loading the roster" />}
      {error && <Alert severity="error" sx={{ mb: 1 }}>Could not load the roster: {error}</Alert>}
      {result && (
        <Paper variant="outlined">
          <RosterTable plans={result.plans} asOf={result.asOf} selectedCode={selectedCode} onSelect={onSelect} />
        </Paper>
      )}
    </Box>
  )
}
