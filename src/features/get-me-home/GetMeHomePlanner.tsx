import { useEffect, useState } from 'react'
import PlannerView from './PlannerView.tsx'
import type { Adapter, Roster } from './contract.ts'

// ---------------------------------------------------------------------------
// THE ENTRY POINT. The one component a host app mounts:
//
//   <GetMeHomePlanner adapter={myAdapter} organizationId={org} />
//
// It asks the adapter for a roster and hands it to PlannerView. That is all
// it does, and all it should do: everything about WHERE the data comes from
// is the adapter's business (see contract.ts), and everything about what it
// MEANS is planHome.ts's.
//
// `now` is for previews and tests -- pin the clock so the screen does not
// drift. Leave it out in production.
// ---------------------------------------------------------------------------
export interface GetMeHomePlannerProps {
  adapter: Adapter
  organizationId?: string | null
  now?: string | null
}

interface LoadState {
  roster: Roster | null
  loading: boolean
  error: string | null
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export default function GetMeHomePlanner({ adapter, organizationId = null, now = null }: GetMeHomePlannerProps) {
  const [state, setState] = useState<LoadState>({ roster: null, loading: true, error: null })

  // Bumped by the Refresh button. Part of the effect's dependencies, so a
  // new number is a new request -- the React way to say "do that again".
  const [asked, setAsked] = useState(0)

  useEffect(() => {
    // The types say there is always an adapter. This is for the day they are
    // bypassed -- a JavaScript caller, an `as any` -- which should read as a
    // sentence on screen, not a TypeError in the console.
    if (!adapter || typeof adapter.loadRoster !== 'function') {
      setState({ roster: null, loading: false, error: 'the planner was given no adapter with a loadRoster() function.' })
      return undefined
    }

    // An AbortController rather than a `cancelled` flag: the flag only stops
    // us USING a late answer, while the signal lets the adapter stop ASKING
    // -- fetch and axios both take it. Switching organisation mid-load then
    // cancels the first request instead of letting it race the second.
    const controller = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))

    Promise.resolve()
      .then(() => adapter.loadRoster({ organizationId, signal: controller.signal }))
      .then((roster) => {
        if (!controller.signal.aborted) setState({ roster, loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        // The previous roster stays on screen under the error: a refresh that
        // failed has not made the last good answer wrong.
        setState((s) => ({ ...s, loading: false, error: messageOf(err) }))
      })

    return () => controller.abort()
  }, [adapter, organizationId, asked])

  return (
    <PlannerView
      roster={state.roster}
      loading={state.loading}
      error={state.error}
      now={now}
      onRefresh={() => setAsked((n) => n + 1)}
    />
  )
}
