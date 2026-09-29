import { useState } from 'react'
import { Alert, LinearProgress } from '@mui/material'
import DriverStays from './DriverStays.tsx'
import RequestForm from './RequestForm.tsx'
import { useScheduleRead } from './useScheduleRead.ts'
import type { NewStay, ScheduleAdapter, Stay } from './contract.ts'

// ---------------------------------------------------------------------------
// MODULE: the driver's side. Their own stays, dispatch's answers, and the
// button to ask for more.
//
//   <DriverHomeTime adapter={a} driverCode={me} />
//
// Reads only this driver's stays (loadDriverStays) -- never anybody else's,
// which is the point of scoping this read. The host decides what a driver may
// do (request, and cancel their own); this offers no more than that, but the
// server is where it is enforced.
//
// Piece: DriverStays (with RequestForm).
// ---------------------------------------------------------------------------
export interface DriverHomeTimeProps {
  adapter: ScheduleAdapter
  driverCode: string
  organizationId?: string | null
  now?: string | null
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

export default function DriverHomeTime({ adapter, driverCode, organizationId = null, now = null }: DriverHomeTimeProps) {
  const { data, loading, error, changed } = useScheduleRead(
    (signal) => adapter.loadDriverStays({ organizationId, driverCode, signal }),
    [adapter, organizationId, driverCode],
  )
  const [asking, setAsking] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const asOf = now || data?.asOf || new Date().toISOString()

  async function request(stay: NewStay) {
    await adapter.requestStay(stay) // a refusal rejects, and RequestForm shows it
    changed()
  }

  async function cancel(stay: Stay) {
    setBusyId(stay.id)
    setActionError(null)
    try {
      await adapter.actOnStay(stay.id, { type: 'cancel' })
      changed()
    } catch (err) {
      setActionError(messageOf(err))
    } finally {
      setBusyId(null)
    }
  }

  if (!data) {
    return error
      ? <Alert severity="error">Could not load your home time: {error}</Alert>
      : <LinearProgress aria-label="Loading your home time" />
  }

  return (
    <>
      {loading && <LinearProgress sx={{ mb: 1 }} aria-label="Refreshing" />}
      {(error || actionError) && <Alert severity="error" sx={{ mb: 2 }}>{actionError || error}</Alert>}
      <DriverStays data={data} driverCode={driverCode} now={asOf} busyId={busyId} onRequest={() => setAsking(true)} onCancel={cancel} />
      <RequestForm
        open={asking} driverCode={driverCode} existing={data.stays} now={asOf}
        onSubmit={request} onClose={() => setAsking(false)}
      />
    </>
  )
}
