import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Keeping separately-loaded modules in step -- the other tabs' pattern,
// written again so this folder moves on its own.
//
// The list and the editor each read their own slice (see scope.ts), so a
// save in DriverEditor changes a line DriverDirectory loaded separately.
// Modules share a VERSION, not a dataset: a change anywhere calls changed(),
// and every module under the same <DriverSync> reads its slice again.
//
// Modules work without one: alone, each keeps its own version and refreshes
// itself after its own changes. DriverMaster puts its two under one.
// ---------------------------------------------------------------------------
interface SyncValue {
  version: number
  changed: () => void
}

const SyncContext = createContext<SyncValue | null>(null)

export function DriverSync({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0)
  const value = useMemo<SyncValue>(() => ({ version, changed: () => setVersion((v) => v + 1) }), [version])
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

export function useDriverSync(): SyncValue {
  const shared = useContext(SyncContext)
  const [own, setOwn] = useState(0)
  return shared ?? { version: own, changed: () => setOwn((v) => v + 1) }
}
