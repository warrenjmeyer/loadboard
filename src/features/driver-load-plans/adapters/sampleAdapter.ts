import fixture from '../fixtures/plans.json'
import { assign, unassign } from '../rules.ts'
import { scopeCandidates, scopeDriverPlan, scopeOpenLoads, scopePlanBoard } from '../scope.ts'
import type { HomeStay, LoadPlanAdapter, LoadPlanData, PlanLoad } from '../contract.ts'

// ---------------------------------------------------------------------------
// The sample load plans, kept in memory for as long as the page is open, so
// assigning and taking back actually change them -- and a reload puts them
// back.
//
// It behaves the way the real server must:
//   - each read answers with its SCOPE and no more (scope.ts), so a module
//     that quietly depends on data it did not ask for breaks here first;
//   - every move runs through rules.ts, so a refused move is refused here
//     too, in the same words.
//
// The stays can come from somewhere else. On its own it uses the sample's;
// the preview hands it the home-time schedule's, as they stand, so approving
// home time there shows up here as a conflict -- the join a host makes
// between its own tables. See src/features/preview/wiring.ts.
//
// Does not port. The host's adapter talks to its API instead; this is the
// template for what that adapter promises.
// ---------------------------------------------------------------------------
const SAMPLE = fixture as LoadPlanData
export const SAMPLE_NOW = SAMPLE.asOf || new Date().toISOString()
const DELAY_MS = 250

// One store of loads for every adapter made here: the modules page and the
// tab are one company's loads.
let loads: PlanLoad[] = structuredClone(SAMPLE.loads)

// Refuses a signal that is already cancelled, as fetch and axios do -- an
// 'abort' listener added after the fact never fires.
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

export function makeSampleLoadPlanAdapter({ stays = () => SAMPLE.stays }: { stays?: () => readonly HomeStay[] } = {}): LoadPlanAdapter {
  // Everything the store holds, as of now -- the input to every scope.
  const everything = (): LoadPlanData => ({ asOf: SAMPLE_NOW, drivers: SAMPLE.drivers, loads, stays: [...stays()] })

  async function move(loadId: string, change: (load: PlanLoad) => { load: PlanLoad } | { error: string }): Promise<PlanLoad> {
    await pause()
    const load = loads.find((l) => l.id === loadId)
    if (!load) throw new Error(`${loadId} no longer exists.`)
    const result = change(load)
    if ('error' in result) throw new Error(result.error)
    loads = loads.map((l) => (l.id === loadId ? result.load : l))
    return structuredClone(result.load)
  }

  return {
    async loadPlanBoard({ from, to, signal }) {
      await pause(signal)
      return structuredClone(scopePlanBoard(everything(), { from, to }))
    },

    async loadDriverPlan({ driverCode, signal }) {
      await pause(signal)
      return structuredClone(scopeDriverPlan(everything(), driverCode))
    },

    async loadOpenLoads({ from, to, signal }) {
      await pause(signal)
      return structuredClone(scopeOpenLoads(everything(), { from, to }))
    },

    async loadCandidates({ loadId, signal }) {
      await pause(signal)
      return structuredClone(scopeCandidates(everything(), loadId))
    },

    assignLoad(loadId, driverCode) {
      if (!SAMPLE.drivers.some((d) => d.driverCode === driverCode)) return Promise.reject(new Error(`There is no driver ${driverCode}.`))
      // The server stamps Planned_At; the sample stamps its own clock.
      return move(loadId, (load) => {
        const result = assign(load, driverCode)
        return 'load' in result ? { load: { ...result.load, plannedAt: SAMPLE_NOW } } : result
      })
    },

    unassignLoad(loadId) {
      return move(loadId, unassign)
    },
  }
}

export const sampleLoadPlanAdapter: LoadPlanAdapter = makeSampleLoadPlanAdapter()
