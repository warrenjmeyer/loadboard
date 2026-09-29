import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Keeping separately-loaded modules in step -- the schedule's pattern, written
// again so this folder moves on its own.
//
// Every module reads its own slice (see scope.ts), so assigning a load in
// SuggestDriver changes data that OpenLoads and LoadPlanBoard loaded
// separately. Modules share a VERSION, not a dataset: an action anywhere
// calls changed(), and every module under the same <PlanSync> reads its
// slice again.
//
// Modules work without one: alone, each keeps its own version and refreshes
// itself after its own actions. DriverLoadPlans puts its modules under one.
// ---------------------------------------------------------------------------
interface SyncValue {
  version: number
  changed: () => void
}

const SyncContext = createContext<SyncValue | null>(null)

export function PlanSync({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0)
  const value = useMemo<SyncValue>(() => ({ version, changed: () => setVersion((v) => v + 1) }), [version])
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

export function usePlanSync(): SyncValue {
  const shared = useContext(SyncContext)
  const [own, setOwn] = useState(0)
  return shared ?? { version: own, changed: () => setOwn((v) => v + 1) }
}
