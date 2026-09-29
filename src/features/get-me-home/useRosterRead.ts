import { useEffect, useState } from 'react'
import type { Roster } from './contract.ts'

// ---------------------------------------------------------------------------
// The one loading pattern every planner wrapper uses, written once: read
// through the adapter with an AbortSignal, keep the last good roster on
// screen while reading again, read again on reload().
//
// `read` is called fresh each time and deliberately not a dependency (it is
// an inline function, new every render); `deps` are what it reads BY -- the
// adapter and the scope. The schedule has its own copy of this hook, so each
// folder still moves on its own.
// ---------------------------------------------------------------------------
export interface RosterRead {
  roster: Roster | null
  loading: boolean
  error: string | null
  reload: () => void
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function useRosterRead(read: (signal: AbortSignal) => Promise<Roster>, deps: readonly unknown[]): RosterRead {
  const [roster, setRoster] = useState<Roster | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [asked, setAsked] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    // Not started at all if cancelled by the time it would start: React's
    // strict mode mounts twice in development and cancels the first.
    Promise.resolve()
      .then(() => (controller.signal.aborted ? null : read(controller.signal)))
      .then((r) => { if (r && !controller.signal.aborted) { setRoster(r); setLoading(false) } })
      .catch((err: unknown) => { if (!controller.signal.aborted) { setError(messageOf(err)); setLoading(false) } })
    return () => controller.abort()
  }, [...deps, asked]) // `read` left out on purpose -- see above

  return { roster, loading, error, reload: () => setAsked((n) => n + 1) }
}
