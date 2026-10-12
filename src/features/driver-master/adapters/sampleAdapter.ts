import fixture from '../fixtures/drivers.json'
import { applyActive, applyChanges, checkNewDriver, normalizeCode, normalizeDetails, sentence } from '../rules.ts'
import { REFUSED, allowed, scopeDriver, scopeDriverList } from '../scope.ts'
import type { Caller } from '../scope.ts'
import type { DriverMasterAdapter, DriverPay, DriverRecord } from '../contract.ts'

// ---------------------------------------------------------------------------
// The sample drivers, kept in memory for as long as the page is open, so
// saving, adding and deactivating actually change them -- and a reload puts
// them back.
//
// It behaves the way the real server must:
//   - each read answers with its SCOPE and no more (scope.ts), pay taken out
//     for anyone but an admin;
//   - every change runs through rules.ts, on the version read, so a refused
//     change is refused here too, in the same words;
//   - WHO: made as a caller, it refuses what that caller may not do.
//
// Does not port. The host's adapter talks to its API instead; this is the
// template for what that adapter promises.
// ---------------------------------------------------------------------------
type Stored = DriverRecord & { pay: DriverPay }

const DELAY_MS = 250

// One store for every adapter made here: the modules page and the tab are one
// company's drivers, whoever is looking.
let drivers: Stored[] = structuredClone((fixture as { drivers: Stored[] }).drivers)

// Refuses a signal that is already cancelled, as fetch and axios do.
function pause(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Cancelled.', 'AbortError'))
    const timer = setTimeout(resolve, DELAY_MS)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Cancelled.', 'AbortError'))
    })
  })
}

const next = (version: string) => String(Number(version) + 1)

export function makeSampleDriverAdapter({ caller = 'admin' }: { caller?: Caller } = {}): DriverMasterAdapter {
  const may = allowed(caller)
  const refuse = () => Promise.reject(new Error(REFUSED))
  const answer = (code: string) => structuredClone(scopeDriver(drivers, code, { caller })!)

  async function change(code: string, work: (d: Stored) => { record: Stored } | { error: string }): Promise<DriverRecord> {
    await pause()
    const found = drivers.find((d) => d.driverCode === code)
    if (!found) throw new Error(`There is no driver ${code}.`)
    const result = work(found)
    if ('error' in result) throw new Error(result.error)
    const stored = { ...result.record, version: next(found.version) }
    drivers = drivers.map((d) => (d.driverCode === code ? stored : d))
    return answer(code)
  }

  return {
    async loadDriverList({ includeInactive, signal }) {
      if (!may.read) return refuse()
      await pause(signal)
      return structuredClone(scopeDriverList(drivers, { includeInactive, caller }))
    },

    async loadDriver({ driverCode, signal }) {
      if (!may.read) return refuse()
      await pause(signal)
      return structuredClone(scopeDriver(drivers, driverCode, { caller }))
    },

    saveDriver(driverCode, version, changes) {
      if (!may.read) return refuse()
      return change(driverCode, (d) => applyChanges(d, version, changes, { canChangePay: may.admin }))
    },

    async addDriver(driver) {
      if (!may.admin) throw new Error('Only an admin adds drivers.')
      await pause()
      const problems = checkNewDriver(driver, drivers.map((d) => d.driverCode))
      if (Object.keys(problems).length > 0) throw new Error(sentence(problems))
      const code = normalizeCode(driver.driverCode)
      const stored: Stored = {
        ...normalizeDetails(driver), driverCode: code, driverType: driver.driverType,
        pay: { ...driver.pay, ssnLast4: driver.pay.ssnLast4.trim(), payGroup: driver.pay.payGroup.trim() },
        isActive: true, hasLogin: false, version: '1',
      }
      drivers = [...drivers, stored]
      return answer(code)
    },

    setDriverActive(driverCode, version, active) {
      if (!may.read) return refuse()
      return change(driverCode, (d) => applyActive(d, version, active))
    },
  }
}

/** An admin: sees and changes everything, pay included. */
export const sampleDriverAdapter: DriverMasterAdapter = makeSampleDriverAdapter({ caller: 'admin' })
/** Dispatch: the same drivers, no pay, no adding. */
export const sampleDispatchDriverAdapter: DriverMasterAdapter = makeSampleDriverAdapter({ caller: 'dispatch' })
