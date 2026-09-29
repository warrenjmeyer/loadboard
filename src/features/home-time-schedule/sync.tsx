import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Keeping separately-loaded modules in step.
//
// Every module reads its own slice (see scope.ts), so approving a request in
// the DecisionQueue changes data the ScheduleBoard loaded separately. Rather
// than share one big dataset -- which is what scoping the reads undoes --
// modules share a VERSION: an action anywhere calls changed(), the version
// moves on, and every module under the same <ScheduleSync> reads its slice
// again.
//
// Modules work without one: alone, each keeps its own version and refreshes
// itself after its own actions. Put modules that share a page under one
// provider and they refresh together -- HomeTimeSchedule does exactly that.
// ---------------------------------------------------------------------------
interface SyncValue {
  version: number
  changed: () => void
}

const SyncContext = createContext<SyncValue | null>(null)

export function ScheduleSync({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0)
  const value = useMemo<SyncValue>(() => ({ version, changed: () => setVersion((v) => v + 1) }), [version])
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

export function useScheduleSync(): SyncValue {
  const shared = useContext(SyncContext)
  const [own, setOwn] = useState(0)
  return shared ?? { version: own, changed: () => setOwn((v) => v + 1) }
}
