import { useEffect, useState } from 'react'
import { Alert, LinearProgress } from '@mui/material'
import DriverTable from './DriverTable.tsx'
import { useDriverRead } from './useDriverRead.ts'
import type { DriverList, DriverMasterAdapter } from './contract.ts'

// ---------------------------------------------------------------------------
// MODULE: the driver list -- find a driver, open them, add one.
//
//   <DriverDirectory adapter={a} onOpen={(code) => ...} onAdd={() => ...} />
//
// Reads a line per driver (loadDriverList) and nothing more: no address, no
// SSN, no pay -- the list does not show them, so it does not receive them.
// Including drivers who have left is a wider read, made only when the
// switch asks for it.
//
// Piece: DriverTable.
// ---------------------------------------------------------------------------
export interface DriverDirectoryProps {
  adapter: DriverMasterAdapter
  organizationId?: string | null
  selectedCode?: string | null
  onOpen?: ((driverCode: string) => void) | null
  onAdd?: (() => void) | null
  /** Told each time the list arrives -- DriverMaster takes the codes in use
   * from it, for a new driver's code. */
  onLoaded?: ((list: DriverList) => void) | null
}

export default function DriverDirectory({ adapter, organizationId = null, selectedCode = null, onOpen = null, onAdd = null, onLoaded = null }: DriverDirectoryProps) {
  const [showInactive, setShowInactive] = useState(false)
  const { data, loading, error } = useDriverRead<DriverList>(
    (signal) => adapter.loadDriverList({ organizationId, includeInactive: showInactive, signal }),
    [adapter, organizationId, showInactive],
  )
  useEffect(() => { if (data) onLoaded?.(data) }, [data]) // told once per answer, not when onLoaded is a new function

  if (!data) {
    return error
      ? <Alert severity="error">Could not load the drivers: {error}</Alert>
      : <LinearProgress aria-label="Loading the drivers" />
  }

  return (
    <>
      {loading && <LinearProgress sx={{ mb: 1 }} aria-label="Refreshing" />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <DriverTable list={data} showInactive={showInactive} onShowInactive={setShowInactive}
        selectedCode={selectedCode} onOpen={onOpen} onAdd={onAdd} />
    </>
  )
}
