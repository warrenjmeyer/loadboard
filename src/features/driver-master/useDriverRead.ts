import { useEffect, useState } from 'react'
import { useDriverSync } from './sync.tsx'

// ---------------------------------------------------------------------------
// The one loading pattern every driver-master wrapper uses, written once (the
// other tabs', copied, so this folder moves on its own):
//
//   - read through the adapter, with an AbortSignal the adapter passes on,
//     so a module that unmounts or asks again cancels the old request;
//   - keep the last good data on screen while reading again, so a refresh
//     is a progress bar and not a blank;
//   - read again when the shared version moves (another module changed
//     something) or when the module asks (reload).
//
// Generic over what is read: the list is a DriverList, the editor's read a
// DriverRecord or null. `read` is called fresh each time and deliberately
// not a dependency; `deps` are what it reads BY -- the adapter and the scope.
// ---------------------------------------------------------------------------
export interface DriverRead<T> {
  /** undefined until the first answer -- null can BE an answer (no such driver). */
  data: T | undefined
  loading: boolean
  error: string | null
  reload: () => void
  /** Tell every module under the same DriverSync that data changed. */
  changed: () => void
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function useDriverRead<T>(read: ((signal: AbortSignal) => Promise<T>) | null, deps: readonly unknown[]): DriverRead<T> {
  const sync = useDriverSync()
  const [data, setData] = useState<T | undefined>(undefined)
  const [loading, setLoading] = useState(read !== null)
  const [error, setError] = useState<string | null>(null)
  const [asked, setAsked] = useState(0)

  useEffect(() => {
    // Nothing to read (a form for a driver not yet made): nothing to wait for.
    if (!read) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    // Started a tick later (so a read that throws becomes a rejection), and
    // not started at all if cancelled by then -- strict mode mounts twice in
    // development and cancels the first.
    Promise.resolve()
      .then(() => (controller.signal.aborted ? undefined : read(controller.signal)))
      .then((d) => { if (!controller.signal.aborted) { setData(d); setLoading(false) } })
      .catch((err: unknown) => { if (!controller.signal.aborted) { setError(messageOf(err)); setLoading(false) } })
    return () => controller.abort()
  }, [...deps, read === null, sync.version, asked]) // `read` itself left out on purpose -- see above

  return { data, loading, error, reload: () => setAsked((n) => n + 1), changed: sync.changed }
}
