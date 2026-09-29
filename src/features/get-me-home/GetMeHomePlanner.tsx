import PlannerView from './PlannerView.tsx'
import { useRosterRead } from './useRosterRead.ts'
import type { Adapter } from './contract.ts'

// ---------------------------------------------------------------------------
// MODULE: the whole Get Me Home Planner tab.
//
//   <GetMeHomePlanner adapter={myAdapter} organizationId={org} />
//
// Reads the roster (loadRoster) and hands it to PlannerView. That is all it
// does, and all it should do: everything about WHERE the data comes from is
// the adapter's business (see contract.ts), and everything about what it
// MEANS is planHome.ts's. The table and the single-driver card are modules
// of their own too -- PlannerRoster and DriverTripHome -- for a host that
// wants one without the other.
//
// `now` is for previews and tests -- pin the clock so the screen does not
// drift. Leave it out in production.
//
// Piece: PlannerView.
// ---------------------------------------------------------------------------
export interface GetMeHomePlannerProps {
  adapter: Adapter
  organizationId?: string | null
  now?: string | null
}

export default function GetMeHomePlanner({ adapter, organizationId = null, now = null }: GetMeHomePlannerProps) {
  const { roster, loading, error, reload } = useRosterRead(
    (signal) => {
      // The types say there is always an adapter. This is for the day they
      // are bypassed -- a JavaScript caller, an `as any` -- which should read
      // as a sentence on screen, not a TypeError in the console.
      if (!adapter || typeof adapter.loadRoster !== 'function') {
        return Promise.reject(new Error('the planner was given no adapter with a loadRoster() function.'))
      }
      return adapter.loadRoster({ organizationId, signal })
    },
    [adapter, organizationId],
  )

  return <PlannerView roster={roster} loading={loading} error={error} now={now} onRefresh={reload} />
}
