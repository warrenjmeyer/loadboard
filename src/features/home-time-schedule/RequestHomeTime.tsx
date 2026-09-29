import { useState } from 'react'
import { Button } from '@mui/material'
import RequestForm from './RequestForm.tsx'
import { useScheduleRead } from './useScheduleRead.ts'
import type { NewStay, ScheduleAdapter } from './contract.ts'

// ---------------------------------------------------------------------------
// MODULE: a "Request home time" button, and the form behind it -- for any
// screen a driver uses, without the rest of their schedule around it.
//
//   <RequestHomeTime adapter={a} driverCode={me} />
//
// Reads this driver's stays (loadDriverStays), and only so the form can
// refuse, before anything is sent, a request on top of one they already
// have. Sends through requestStay, then tells every module under the same
// ScheduleSync that the schedule changed.
//
// Piece: RequestForm.
// ---------------------------------------------------------------------------
export interface RequestHomeTimeProps {
  adapter: ScheduleAdapter
  driverCode: string
  organizationId?: string | null
  now?: string | null
  /** The button's words. */
  label?: string
}

export default function RequestHomeTime({ adapter, driverCode, organizationId = null, now = null, label = 'Request home time' }: RequestHomeTimeProps) {
  const { data, changed } = useScheduleRead(
    (signal) => adapter.loadDriverStays({ organizationId, driverCode, signal }),
    [adapter, organizationId, driverCode],
  )
  const [open, setOpen] = useState(false)
  const asOf = now || data?.asOf || new Date().toISOString()

  async function send(stay: NewStay) {
    await adapter.requestStay(stay)
    changed()
  }

  return (
    <>
      <Button variant="contained" onClick={() => setOpen(true)} disabled={!data}>{label}</Button>
      <RequestForm
        open={open} driverCode={driverCode} existing={data?.stays || []} now={asOf}
        onSubmit={send} onClose={() => setOpen(false)}
      />
    </>
  )
}
