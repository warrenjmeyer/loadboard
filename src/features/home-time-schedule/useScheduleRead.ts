import { useEffect, useState } from 'react'
import { useScheduleSync } from './sync.tsx'
import type { ScheduleData } from './contract.ts'

// ---------------------------------------------------------------------------
// The one loading pattern every schedule wrapper uses, written once:
//
//   - read through the adapter, with an AbortSignal the adapter passes on,
//     so a module that unmounts or asks again cancels the old request;
//   - keep the last good data on screen while reading again, so a refresh
//     is a progress bar and not a blank;
//   - read again when the shared version moves (another module acted) or
//     when the module asks (reload).
//
// `read` is called fresh each time and deliberately not a dependency: it is
// an inline function, new every render. `deps` are what it reads BY -- the
// adapter and the scope (a driver, a window, an id).
// ---------------------------------------------------------------------------
export interface ScheduleRead {
  data: ScheduleData | null
  loading: boolean
  error: string | null
  reload: () => void
  /** Tell every module under the same ScheduleSync that data changed. */
  changed: () => void
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function useScheduleRead(read: (signal: AbortSignal) => Promise<ScheduleData>, deps: readonly unknown[]): ScheduleRead {
  const sync = useScheduleSync()
  const [data, setData] = useState<ScheduleData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [asked, setAsked] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    // Started a tick later (so a read that throws becomes a rejection), and
    // not started at all if cancelled by then -- React's strict mode mounts
    // twice in development and cancels the first, and a read begun after its
    // own cancel would otherwise still go out.
    Promise.resolve()
      .then(() => (controller.signal.aborted ? null : read(controller.signal)))
      .then((d) => { if (d && !controller.signal.aborted) { setData(d); setLoading(false) } })
      .catch((err: unknown) => { if (!controller.signal.aborted) { setError(messageOf(err)); setLoading(false) } })
    return () => controller.abort()
  }, [...deps, sync.version, asked]) // `read` left out on purpose -- see above

  return { data, loading, error, reload: () => setAsked((n) => n + 1), changed: sync.changed }
}
