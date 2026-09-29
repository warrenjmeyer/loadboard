import { useEffect, useState } from 'react'
import ScheduleView from './ScheduleView.tsx'
import type { ScheduleAdapter, ScheduleData, Stay, StayAction, StayVerdict } from './contract.ts'

// ---------------------------------------------------------------------------
// THE ENTRY POINT for dispatch. The one component a host mounts in the
// Driver Home Time Schedule tab:
//
//   <HomeTimeSchedule adapter={myAdapter} organizationId={org} verdictFor={...} />
//
// It loads through the adapter, hands the data to ScheduleView, and puts each
// stay the adapter sends back into the list in place of the old one -- so
// what is on screen after a move is what was stored, not what was hoped.
// ---------------------------------------------------------------------------
export interface HomeTimeScheduleProps {
  adapter: ScheduleAdapter
  organizationId?: string | null
  now?: string | null
  verdictFor?: ((stay: Stay) => StayVerdict | null) | null
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

export default function HomeTimeSchedule({ adapter, organizationId = null, now = null, verdictFor = null }: HomeTimeScheduleProps) {
  const [data, setData] = useState<ScheduleData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [asked, setAsked] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    Promise.resolve()
      .then(() => adapter.loadSchedule({ organizationId, signal: controller.signal }))
      .then((d) => { if (!controller.signal.aborted) { setData(d); setLoading(false) } })
      .catch((err: unknown) => { if (!controller.signal.aborted) { setError(messageOf(err)); setLoading(false) } })
    return () => controller.abort()
  }, [adapter, organizationId, asked])

  async function onAction(id: string, action: StayAction) {
    const stored = await adapter.actOnStay(id, action) // a refusal rejects, and ScheduleView shows it
    setData((d) => (d ? { ...d, stays: d.stays.map((s) => (s.id === id ? stored : s)) } : d))
  }

  return (
    <ScheduleView
      data={data} loading={loading} error={error} now={now} verdictFor={verdictFor}
      onAction={onAction} onRefresh={() => setAsked((n) => n + 1)}
    />
  )
}
